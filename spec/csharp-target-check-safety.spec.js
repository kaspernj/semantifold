// @ts-check

import {access, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  createTargetCheckPlan,
  discoverCanonicalToolchain,
  generateArtifactSet,
  parse,
  SemantifoldDiagnostic,
  TargetCheckRunner
} from "../index.js"

const synthetic = Object.freeze({
  kind: /** @type {const} */ ("synthetic"),
  reason: "Task 041 C# correction fixture",
  relatedOrigins: Object.freeze([])
})

function generatedCSharp() {
  const module = parse({
    filename: "fixture.ts",
    language: "typescript",
    source: "function message(left: string, right: string): string { return left + right }\n" +
      "console.log(message(\"A\", \"B\"))\n"
  })

  return generateArtifactSet({language: "csharp", module})
}

/**
 * Stages one immutable C# artifact set and returns its real check context.
 * @param {string} root - Fixture root.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} artifacts - Complete staged artifacts.
 * @returns {Promise<{buildPath: string, plan: import("../src/semantic/types.js").TargetCheckPlan, sourcePath: string}>} Staged plan.
 */
async function stagedPlan(root, artifacts) {
  const sourcePath = path.join(root, "candidate/source")
  const buildPath = path.join(root, "candidate/build")

  await mkdir(sourcePath, {recursive: true})
  await mkdir(buildPath, {recursive: true})
  for (const artifact of artifacts.artifacts) {
    const filename = path.join(sourcePath, artifact.path)

    await mkdir(path.dirname(filename), {recursive: true})
    await writeFile(filename, artifact.content)
  }
  const dotnet = await discoverCanonicalToolchain("dotnet")
  const plan = createTargetCheckPlan({
    artifacts,
    buildPath,
    projectId: "csharp-safety-project",
    sourcePath,
    targetId: "csharp-main",
    tools: [dotnet]
  })

  return {buildPath, plan, sourcePath}
}

/** @param {string} filename */
async function exists(filename) {
  try {
    await access(filename)

    return true
  } catch (error) {
    if (error && typeof error == "object" && "code" in error && error.code == "ENOENT") return false
    throw error
  }
}

describe("C# target-check safety correction", () => {
  it("rejects project-defined build actions before they can mutate staged source", {timeoutMs: 120_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task041-csharp-project-action-"))

    try {
      const good = generatedCSharp()
      const malicious = createGeneratedArtifactSet({
        artifacts: good.artifacts.map(artifact => artifact.path == "Semantifold.csproj"
          ? {...artifact, content: /** @type {string} */ (artifact.content).replace("</Project>", `  <Target Name="ReviewMutation" BeforeTargets="CoreCompile">
    <WriteLinesToFile File="$(MSBuildProjectDirectory)/executed.txt" Lines="project target ran" Overwrite="true" />
  </Target>
</Project>`), provenance: synthetic}
          : artifact),
        target: "csharp"
      })
      let failure
      const sourcePath = path.join(root, "candidate/source")

      try {
        const staged = await stagedPlan(root, malicious)

        await new TargetCheckRunner().run(staged.plan, {timeoutMs: 60_000})
      } catch (error) {
        failure = error
      }

      expect(await exists(path.join(sourcePath, "executed.txt"))).toBeFalse()
      expect(failure instanceof SemantifoldDiagnostic && failure.code == "INVALID_TARGET_CHECK_PLAN").toBeTrue()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("disables ancestor MSBuild customization for restore and compile", {timeoutMs: 120_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task041-csharp-ancestor-"))
    const propsMarker = path.join(root, "ancestor-props-executed.txt")
    const targetsMarker = path.join(root, "ancestor-targets-executed.txt")

    try {
      await writeFile(path.join(root, "Directory.Build.props"), `<Project InitialTargets="ReviewAncestorPropsMutation">
  <Target Name="ReviewAncestorPropsMutation">
    <WriteLinesToFile File="$(MSBuildThisFileDirectory)ancestor-props-executed.txt" Lines="ancestor props ran" Overwrite="true" />
  </Target>
</Project>
`)
      await writeFile(path.join(root, "Directory.Build.targets"), `<Project>
  <Target Name="ReviewAncestorMutation" BeforeTargets="CoreCompile">
    <WriteLinesToFile File="$(MSBuildThisFileDirectory)ancestor-targets-executed.txt" Lines="ancestor target ran" Overwrite="true" />
  </Target>
</Project>
`)
      const good = generatedCSharp()
      const program = /** @type {string} */ (good.artifacts.find(artifact => artifact.path == "Program.cs")?.content)
      const staged = await stagedPlan(root, good)

      await new TargetCheckRunner().run(staged.plan, {timeoutMs: 60_000})
      expect(await exists(propsMarker)).toBeFalse()
      expect(await exists(targetsMarker)).toBeFalse()
      expect(await readFile(path.join(staged.sourcePath, "Program.cs"), "utf8")).toEqual(program)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("passes every declared C# source to the real compiler in deterministic order", {timeoutMs: 120_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task041-csharp-complete-sources-"))

    try {
      const good = generatedCSharp()
      const withBrokenSource = createGeneratedArtifactSet({
        artifacts: [...good.artifacts, {
          content: "namespace Semantifold.Generated; internal static class Broken { this is not valid C# }\n",
          contentKind: /** @type {const} */ ("text"),
          mediaType: "text/x-csharp",
          ownership: /** @type {const} */ ("generated"),
          path: "Broken.cs",
          provenance: synthetic,
          role: /** @type {const} */ ("source")
        }],
        target: "csharp"
      })
      const staged = await stagedPlan(root, withBrokenSource)
      let failure

      try {
        await new TargetCheckRunner().run(staged.plan, {timeoutMs: 60_000})
      } catch (error) {
        failure = error
      }

      expect(failure instanceof SemantifoldDiagnostic && failure.code == "TARGET_CHECK_NONZERO_EXIT" &&
        failure.stage == "compile" && `${failure.stdout}${failure.stderr}`.includes("Broken.cs")).toBeTrue()
      expect(staged.plan.stages[1].argv).toContain("--property:SemantifoldCompileItems=Broken.cs%3BProgram.cs")
      expect(await readFile(path.join(staged.sourcePath, "Broken.cs"), "utf8"))
        .toEqual("namespace Semantifold.Generated; internal static class Broken { this is not valid C# }\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
