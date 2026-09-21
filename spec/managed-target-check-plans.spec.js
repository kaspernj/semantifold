// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {createGeneratedArtifactSet, createTargetCheckPlan, languageCapabilities} from "../index.js"
import {csharpProjectManifest} from "../src/backends/csharp.js"

const expectedChecks = new Map([
  ["php", {stages: ["validate"], supported: true, toolchains: ["php82"]}],
  ["ruby", {stages: ["validate"], supported: true, toolchains: ["ruby"]}],
  ["javascript", {stages: ["validate"], supported: true, toolchains: ["node"]}],
  ["typescript", {stages: ["compile"], supported: true, toolchains: ["tsc"]}],
  ["kotlin", {stages: ["compile"], supported: true, toolchains: ["kotlinc"]}],
  ["python", {stages: ["compile"], supported: true, toolchains: ["python"]}],
  ["csharp", {stages: ["restore", "compile"], supported: true, toolchains: ["dotnet"]}]
])

const synthetic = Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: "Task 041 plan fixture", relatedOrigins: Object.freeze([])})
const fixtures = new Map([
  ["php", [["program.php", "<?php\nprint(1);\n", "application/x-httpd-php", "entry"]]],
  ["ruby", [["program.rb", "puts(1)\n", "text/x-ruby", "entry"]]],
  ["javascript", [["program.js", "console.log(1)\n", "text/javascript", "entry"]]],
  ["typescript", [["program.ts", "console.log(1)\n", "text/typescript", "entry"]]],
  ["kotlin", [["Program.kt", "fun main() { println(1) }\n", "text/x-kotlin", "entry"]]],
  ["python", [["program.py", "print(1)\n", "text/x-python", "entry"]]],
  ["csharp", [
    ["Program.cs", "namespace Semantifold.Generated; internal static class Program { private static void Main() {} }\n", "text/x-csharp", "entry"],
    ["Semantifold.csproj", csharpProjectManifest, "application/xml", "manifest"]
  ]]
])

/** @param {string} target */
function artifactsFor(target) {
  const artifacts = /** @type {Array<[string, string, string, string]>} */ (fixtures.get(target))

  return createGeneratedArtifactSet({
    artifacts: artifacts.map(([artifactPath, content, mediaType, role]) => ({
      content,
      contentKind: /** @type {const} */ ("text"),
      mediaType,
      ownership: /** @type {const} */ ("generated"),
      path: artifactPath,
      provenance: synthetic,
      role
    })),
    target
  })
}

/** @param {string} id */
function tool(id) {
  const command = new Map([["php82", "php"], ["python", "python3"]]).get(id) ?? id

  return Object.freeze({
    command,
    executable: `/opt/semantifold-tools/${command}`,
    id,
    source: /** @type {const} */ ("override"),
    version: `${id} fixture`,
    versionArguments: Object.freeze(["--version"]),
    versionOutput: `${id} fixture`
  })
}

/** @param {string} target */
async function planFor(target) {
  const root = await mkdtemp(path.join(os.tmpdir(), `semantifold-task041-${target}-plan-`))
  const sourcePath = path.join(root, "source")
  const buildPath = path.join(root, "build")
  const artifacts = artifactsFor(target)

  await mkdir(sourcePath)
  await mkdir(buildPath)
  for (const artifact of artifacts.artifacts) {
    await mkdir(path.dirname(path.join(sourcePath, artifact.path)), {recursive: true})
    await writeFile(path.join(sourcePath, artifact.path), /** @type {string} */ (artifact.content))
  }
  const capability = /** @type {{toolchains: string[]}} */ (expectedChecks.get(target))
  const plan = createTargetCheckPlan({
    artifacts,
    buildPath,
    projectId: "managed-project",
    sourcePath,
    targetId: `${target}-main`,
    tools: capability.toolchains.map(tool)
  })

  return {buildPath, plan, root, sourcePath}
}

describe("interpreted and managed target check plans", () => {
  it("reports exact developer-check capabilities for the seven-target cohort", () => {
    for (const [target, check] of expectedChecks) {
      expect(languageCapabilities.find(({id}) => id == target)?.check).toEqual(check)
    }
  })

  it("constructs immutable target-owned exact argv without an execution stage", async () => {
    /** @type {string[]} */
    const roots = []

    try {
      const planned = new Map()

      for (const target of expectedChecks.keys()) {
        const staged = await planFor(target)

        roots.push(staged.root)
        planned.set(target, staged)
        expect(staged.plan.artifactPaths).toEqual(artifactsFor(target).artifacts
          .map(({path: artifactPath}) => path.join(staged.sourcePath, artifactPath))
          .sort((left, right) => left.localeCompare(right, "en")))
        expect(staged.plan.stages.some(({stage}) => stage == "execute")).toBeFalse()
        expect(Object.isFrozen(staged.plan)).toBeTrue()
        expect(Object.isFrozen(staged.plan.artifactPaths)).toBeTrue()
        for (const stage of staged.plan.stages) {
          expect(Object.isFrozen(stage)).toBeTrue()
          expect(Object.isFrozen(stage.argv)).toBeTrue()
          expect(Object.isFrozen(stage.environment)).toBeTrue()
          expect(Object.isFrozen(stage.environmentPaths)).toBeTrue()
          expect(Object.isFrozen(stage.inputs)).toBeTrue()
          expect(Object.isFrozen(stage.pathArguments)).toBeTrue()
          expect(stage.environment).toMatchObject({LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC"})
        }
      }

      const php = planned.get("php")
      const ruby = planned.get("ruby")
      const javascript = planned.get("javascript")
      const typescript = planned.get("typescript")
      const kotlin = planned.get("kotlin")
      const python = planned.get("python")
      const csharp = planned.get("csharp")

      expect(php.plan.stages[0].argv).toEqual(["-n", "-l", php.plan.artifactPaths[0]])
      expect(ruby.plan.stages[0].argv).toEqual(["--disable=gems", "-c", ruby.plan.artifactPaths[0]])
      expect(javascript.plan.stages[0].argv).toEqual(["--check", javascript.plan.artifactPaths[0]])
      expect(typescript.plan.stages[0].argv).toEqual([
        "--pretty", "false", "--noEmit", "--incremental", "false", "--target", "ES2024", "--module", "NodeNext",
        "--moduleResolution", "NodeNext", "--typeRoots", path.join(typescript.buildPath, "types"),
        ...typescript.plan.artifactPaths
      ])
      expect(kotlin.plan.stages[0].argv).toEqual([
        "-language-version", "2.4", "-api-version", "2.4", "-jvm-target", "25", "-Werror",
        ...kotlin.plan.artifactPaths, "-d", path.join(kotlin.buildPath, "classes")
      ])
      expect(python.plan.stages[0].argv).toEqual([
        "-I", "-B", "-c",
        "import py_compile,sys;[py_compile.compile(sys.argv[index],cfile=sys.argv[index+1],dfile=sys.argv[index+2],doraise=True,invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH) for index in range(1,len(sys.argv),3)]",
        python.plan.artifactPaths[0], path.join(python.buildPath, "program.pyc"), "program.py"
      ])
      expect(csharp.plan.stages.map(({stage}) => stage)).toEqual(["restore", "compile"])
      expect(csharp.plan.stages[0]).toMatchObject({
        argv: [
          "restore", path.join(csharp.sourcePath, "Semantifold.csproj"), "--source", csharp.sourcePath,
          "--packages", path.join(csharp.buildPath, "nuget-packages"), "--no-cache", "--force", "--disable-parallel",
          "--nologo", "--property:ImportDirectoryBuildProps=false", "--property:ImportDirectoryBuildTargets=false",
          `--property:BaseIntermediateOutputPath=${path.join(csharp.buildPath, "obj")}/`,
          `--property:MSBuildProjectExtensionsPath=${path.join(csharp.buildPath, "obj")}/`
        ],
        inputHash: (() => {
          const projectName = "Semantifold.csproj"
          const projectContent = /** @type {string} */ (artifactsFor("csharp").artifacts[1].content)

          return createHash("sha256").update(`${Buffer.byteLength(projectName)}:`).update(projectName)
            .update(`${Buffer.byteLength(projectContent)}:`).update(projectContent).digest("hex")
        })(),
        inputs: [path.join(csharp.sourcePath, "Semantifold.csproj")],
        output: null,
        stage: "restore"
      })
      expect(csharp.plan.stages[1].argv).toEqual([
        "build", path.join(csharp.sourcePath, "Semantifold.csproj"), "--configuration", "Release", "--no-restore",
        "--nologo", "--warnaserror", "--disable-build-servers", "--output", path.join(csharp.buildPath, "bin"),
        "--property:ImportDirectoryBuildProps=false", "--property:ImportDirectoryBuildTargets=false",
        "--property:SemantifoldCompileItems=Program.cs",
        "--property:UseSharedCompilation=false",
        `--property:BaseIntermediateOutputPath=${path.join(csharp.buildPath, "obj")}/`,
        `--property:MSBuildProjectExtensionsPath=${path.join(csharp.buildPath, "obj")}/`
      ])
      expect(csharp.plan.stages[0].environment).toMatchObject({
        DOTNET_CLI_HOME: path.join(csharp.buildPath, "dotnet-home"),
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_CLI_USE_MSBUILD_SERVER: "0",
        DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: "1",
        DOTNET_NOLOGO: "1",
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
        NUGET_HTTP_CACHE_PATH: path.join(csharp.buildPath, "nuget-http-cache"),
        NUGET_PACKAGES: path.join(csharp.buildPath, "nuget-packages"),
        NUGET_PLUGINS_CACHE_PATH: path.join(csharp.buildPath, "nuget-plugins-cache"),
        XDG_CACHE_HOME: path.join(csharp.buildPath, "cache")
      })
    } finally {
      await Promise.all(roots.map(root => rm(root, {force: true, recursive: true})))
    }
  })

  it("hashes only ordered C# restore inputs while compiling the complete project", async () => {
    const first = await planFor("csharp")
    const second = await planFor("csharp")
    const changedArtifacts = artifactsFor("csharp")
    const changedProgram = createGeneratedArtifactSet({
      artifacts: changedArtifacts.artifacts.map(artifact => artifact.path == "Program.cs"
        ? {...artifact, content: `${artifact.content}// source-only change\n`}
        : artifact),
      target: "csharp"
    })
    const changedProject = createGeneratedArtifactSet({
      artifacts: changedArtifacts.artifacts.map(artifact => artifact.path == "Semantifold.csproj"
        ? {...artifact, content: `${artifact.content}<!-- restore-input change -->\n`}
        : artifact),
      target: "csharp"
    })
    const lockedProject = createGeneratedArtifactSet({
      artifacts: [...changedArtifacts.artifacts, {
        content: "{\"version\":1,\"dependencies\":{}}\n",
        contentKind: /** @type {const} */ ("text"),
        mediaType: "application/json",
        ownership: /** @type {const} */ ("generated"),
        path: "packages.lock.json",
        provenance: synthetic,
        role: /** @type {const} */ ("manifest")
      }],
      target: "csharp"
    })
    const changedLockedProject = createGeneratedArtifactSet({
      artifacts: lockedProject.artifacts.map(artifact => artifact.path == "packages.lock.json"
        ? {...artifact, content: "{\"version\":1,\"dependencies\":{},\"changed\":true}\n"}
        : artifact),
      target: "csharp"
    })
    const replan = (artifacts) => createTargetCheckPlan({
      artifacts,
      buildPath: first.buildPath,
      projectId: "managed-project",
      sourcePath: first.sourcePath,
      targetId: "csharp-main",
      tools: [tool("dotnet")]
    })

    try {
      expect(first.plan.stages[0].inputHash).toEqual(second.plan.stages[0].inputHash)
      expect(replan(changedProgram).stages[0].inputHash).toEqual(first.plan.stages[0].inputHash)
      assert.throws(() => replan(changedProject), error =>
        error instanceof Error && "code" in error && error.code == "INVALID_TARGET_CHECK_PLAN")
      const lockedPlan = replan(lockedProject)

      expect(lockedPlan.stages[0].inputHash == first.plan.stages[0].inputHash).toBeFalse()
      expect(replan(changedLockedProject).stages[0].inputHash == lockedPlan.stages[0].inputHash).toBeFalse()
      expect(lockedPlan.stages[0].argv).toContain("--locked-mode")
      expect(lockedPlan.stages[0].inputs).toEqual([
        path.join(first.sourcePath, "packages.lock.json"), path.join(first.sourcePath, "Semantifold.csproj")
      ])
      expect(first.plan.stages[1].inputs).toEqual(first.plan.artifactPaths)
    } finally {
      await Promise.all([first.root, second.root].map(root => rm(root, {force: true, recursive: true})))
    }
  })
})
