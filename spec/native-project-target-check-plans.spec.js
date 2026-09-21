// @ts-check

import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  createTargetCheckPlan,
  generateArtifactSet,
  languageCapabilities,
  parse,
  SemantifoldDiagnostic
} from "../index.js"
import {createTargetCheckRunner} from "../src/target-check.js"

const targets = ["go", "c", "cpp", "rust", "swift", "dart", "zig"]
const expectedChecks = new Map([
  ["go", {stages: ["compile", "validate"], supported: true, toolchains: ["go"]}],
  ["c", {stages: ["compile", "link"], supported: true, toolchains: ["clang"]}],
  ["cpp", {stages: ["compile", "link"], supported: true, toolchains: ["clangpp"]}],
  ["rust", {stages: ["compile", "validate"], supported: true, toolchains: ["rustc", "cargo"]}],
  ["swift", {stages: ["compile"], supported: true, toolchains: ["swiftc"]}],
  ["dart", {stages: ["restore", "compile", "validate"], supported: true, toolchains: ["dart"]}],
  ["zig", {stages: ["compile", "validate"], supported: true, toolchains: ["zig"]}]
])
const synthetic = Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: "Task 042 plan fixture", relatedOrigins: Object.freeze([])})
const module = parse({
  filename: "fixture.js",
  language: "javascript",
  source: `/**
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
function add(left, right) { return left + right }
console.log(add(2, 3))
`
})

/** @param {string} id */
function tool(id) {
  const commands = new Map([["clangpp", "clang++"], ["swiftc", "swiftc"]])
  const directories = new Map([["cargo", "/opt/semantifold-cargo/bin"], ["rustc", "/opt/semantifold-rust/bin"]])
  const command = commands.get(id) ?? id

  return Object.freeze({
    command,
    executable: path.join(directories.get(id) ?? "/opt/semantifold-tools", command),
    id,
    source: /** @type {const} */ ("override"),
    version: `${id} fixture`,
    versionArguments: Object.freeze(["--version"]),
    versionOutput: `${id} fixture`
  })
}

/** @param {string} target */
async function planFor(target) {
  const root = await mkdtemp(path.join(os.tmpdir(), `semantifold-task042-${target}-plan-`))
  const sourcePath = path.join(root, "source")
  const buildPath = path.join(root, "build")
  const artifacts = generateArtifactSet({language: /** @type {any} */ (target), module})
  const capability = /** @type {{toolchains: string[]}} */ (expectedChecks.get(target))

  await Promise.all([mkdir(sourcePath), mkdir(buildPath)])
  for (const artifact of artifacts.artifacts) {
    const filename = path.join(sourcePath, artifact.path)

    await mkdir(path.dirname(filename), {recursive: true})
    await writeFile(filename, /** @type {string} */ (artifact.content))
  }
  const input = {
    artifacts,
    buildPath,
    projectId: "native-project",
    sourcePath,
    targetId: `${target}-main`,
    tools: capability.toolchains.map(tool)
  }

  return {artifacts, buildPath, input, plan: createTargetCheckPlan(input), root, sourcePath}
}

describe("native and project target check plans", () => {
  it("reports exact developer-check capabilities for all seven targets", () => {
    for (const [target, check] of expectedChecks) {
      expect(languageCapabilities.find(({id}) => id == target)?.check).toEqual(check)
    }
  })

  it("constructs immutable target-owned non-executing plans with exact qualified profiles", async () => {
    /** @type {Awaited<ReturnType<typeof planFor>>[]} */
    const planned = []

    try {
      for (const target of targets) {
        const staged = await planFor(target)

        planned.push(staged)
        expect(staged.plan.artifactPaths).toEqual(staged.artifacts.artifacts.map(({path: artifactPath}) =>
          path.join(staged.sourcePath, artifactPath)).sort((left, right) => left.localeCompare(right, "en")))
        expect(staged.plan.stages.some(({stage}) => stage == "execute")).toBeFalse()
        expect(Object.isFrozen(staged.plan)).toBeTrue()
        expect(Object.isFrozen(staged.plan.artifactPaths)).toBeTrue()
        expect(Object.isFrozen(staged.plan.stages)).toBeTrue()
        for (const stage of staged.plan.stages) {
          expect(Object.isFrozen(stage)).toBeTrue()
          expect(Object.isFrozen(stage.argv)).toBeTrue()
          expect(Object.isFrozen(stage.environment)).toBeTrue()
          expect(Object.isFrozen(stage.environmentPaths)).toBeTrue()
          expect(Object.isFrozen(stage.inputs)).toBeTrue()
          expect(Object.isFrozen(stage.pathArguments)).toBeTrue()
          expect(Object.isFrozen(stage.transientPaths)).toBeTrue()
          expect(stage.environment).toMatchObject({LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC"})
        }
      }

      const byTarget = new Map(planned.map(staged => [staged.plan.target, staged]))
      const go = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("go"))
      const c = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("c"))
      const cpp = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("cpp"))
      const rust = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("rust"))
      const swift = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("swift"))
      const dart = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("dart"))
      const zig = /** @type {Awaited<ReturnType<typeof planFor>>} */ (byTarget.get("zig"))

      expect(go.plan.stages.map(({argv, stage}) => [stage, argv])).toEqual([
        ["compile", ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o",
          path.join(go.buildPath, "semantifold-go"), "."]],
        ["validate", ["vet", "-mod=readonly", "."]]
      ])
      expect(go.plan.stages[0].environment).toMatchObject({
        CGO_ENABLED: "0", GOARCH: "amd64", GOENV: "off", GOOS: "linux", GOPROXY: "off", GOSUMDB: "off",
        GOTOOLCHAIN: "local", GOVCS: "off", GOWORK: "off", GO_TELEMETRY_CHILD: "2"
      })
      expect(c.plan.stages.map(({stage}) => stage)).toEqual(["compile", "link"])
      expect(c.plan.stages[0].argv).toContain("-std=c17")
      expect(c.plan.stages[0].argv).toContain("-O0")
      expect(c.plan.stages[0].argv).toContain("-Werror")
      expect(c.plan.stages[1].argv.at(-1)).toEqual(path.join(c.buildPath, "semantifold-c"))
      expect(c.plan.stages.flatMap(({argv}) => argv)).not.toContain("-fsanitize=address,undefined")
      expect(cpp.plan.stages.map(({stage}) => stage)).toEqual(["compile", "link"])
      expect(cpp.plan.stages[0].argv).toContain("-std=c++20")
      expect(cpp.plan.stages[0].argv).toContain("-stdlib=libstdc++")
      expect(cpp.plan.stages[0].argv).toContain("-fno-exceptions")
      expect(cpp.plan.stages[1].argv.at(-1)).toEqual(path.join(cpp.buildPath, "semantifold-cpp"))
      expect(rust.plan.stages.map(({argv, stage}) => [stage, argv])).toEqual([
        ["compile", ["build", "--offline", "--locked", "--target-dir", path.join(rust.buildPath, "cargo-target")]],
        ["validate", ["check", "--offline", "--locked", "--target-dir", path.join(rust.buildPath, "cargo-target")]]
      ])
      expect(rust.plan.stages[0].environment).toMatchObject({CARGO_INCREMENTAL: "0", CARGO_NET_OFFLINE: "true",
        CARGO_TERM_COLOR: "never", RUSTC: "/opt/semantifold-rust/bin/rustc"})
      expect(rust.plan.stages[0].environment.PATH.split(path.delimiter).slice(0, 2)).toEqual([
        "/opt/semantifold-rust/bin", "/opt/semantifold-cargo/bin"
      ])
      expect(rust.plan.stages[0].environmentPaths).toContainEqual({
        name: "RUSTC", ownership: "tool", tool: tool("rustc")
      })
      expect(swift.plan.stages.map(({stage}) => stage)).toEqual(["compile", "compile", "compile"])
      expect(swift.plan.stages.map(({argv}) => argv)).toEqual([
        ["--driver-mode=swiftc", "-warnings-as-errors", "-typecheck", "-module-name", "SemantifoldGenerated",
          swift.plan.artifactPaths[0]],
        ["--driver-mode=swiftc", "-warnings-as-errors", "-c", swift.plan.artifactPaths[0],
          "-module-name", "SemantifoldGenerated", "-o", "program.o"],
        ["--driver-mode=swiftc", path.join(swift.buildPath, "objects/program.o"), "-Xlinker", "--build-id=none",
          "-o", path.join(swift.buildPath, "semantifold-swift")]
      ])
      expect(swift.plan.stages[1].cwd).toEqual(path.join(swift.buildPath, "objects"))
      expect(dart.plan.stages.map(({stage}) => stage)).toEqual(["restore", "compile", "validate", "validate"])
      expect(dart.plan.stages[0].argv).toEqual([
        "pub", "get", "--offline", "--dry-run", "--enforce-lockfile", "--no-precompile"
      ])
      expect(dart.plan.stages[1].argv).toEqual([
        "compile", "exe", path.join(dart.sourcePath, "bin/program.dart"), "-o",
        path.join(dart.buildPath, "native-output/semantifold-dart")
      ])
      expect(dart.plan.stages[1].output).toEqual(null)
      expect(dart.plan.stages[1].transientPaths).toEqual([path.join(dart.buildPath, "native-output")])
      expect(dart.plan.stages[2].argv).toEqual([
        "format", "--output=none", "--set-exit-if-changed", path.join(dart.sourcePath, "bin/program.dart")
      ])
      expect(dart.plan.stages[3].argv).toEqual(["analyze", "--fatal-infos", "--fatal-warnings", dart.sourcePath])
      expect(dart.plan.stages[0].inputHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(dart.plan.stages[0].environment).toMatchObject({CI: "true", DART_SUPPRESS_ANALYTICS: "true",
        PUB_HOSTED_URL: "http://127.0.0.1:9"})
      expect(zig.plan.stages.map(({argv, stage}) => [stage, argv])).toEqual([
        ["compile", ["build", "-Doptimize=Debug", "--prefix", path.join(zig.buildPath, "output")]],
        ["validate", ["fmt", "--check", path.join(zig.sourcePath, "build.zig"), path.join(zig.sourcePath, "src/main.zig")]]
      ])
      expect(zig.plan.stages[0].output).toEqual(null)
      expect(zig.plan.stages[0].transientPaths).toEqual([path.join(zig.buildPath, "output")])
      expect(zig.plan.stages[0].environment).toMatchObject({HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: ""})
    } finally {
      await Promise.all(planned.map(({root}) => rm(root, {force: true, recursive: true})))
    }
  })

  it("keys Dart offline restore only to exact generated package inputs", async () => {
    const staged = await planFor("dart")
    const changed = createGeneratedArtifactSet({
      artifacts: staged.artifacts.artifacts.map(artifact => artifact.path == "bin/program.dart"
        ? {...artifact, content: `${artifact.content}// source-only change\n`, provenance: synthetic}
        : artifact),
      target: "dart"
    })

    try {
      const replanned = createTargetCheckPlan({...staged.input, artifacts: changed})

      expect(replanned.stages[0].inputHash).toEqual(staged.plan.stages[0].inputHash)
      expect(replanned.stages[0].inputs).toEqual([
        path.join(staged.sourcePath, "pubspec.lock"), path.join(staged.sourcePath, "pubspec.yaml")
      ])
      assert.throws(() => createTargetCheckPlan({...staged.input, artifacts: createGeneratedArtifactSet({
        artifacts: staged.artifacts.artifacts.map(artifact => artifact.path == "pubspec.yaml"
          ? {...artifact, content: `${artifact.content}dependencies:\n  unsafe: any\n`}
          : artifact),
        target: "dart"
      })}), error => error instanceof Error && "code" in error && error.code == "INVALID_TARGET_CHECK_PLAN")
    } finally {
      await rm(staged.root, {force: true, recursive: true})
    }
  })

  it("rejects missing, mismatched, mutable, or undeclared tool environment bindings before launch", async () => {
    const staged = await planFor("rust")
    const stage = staged.plan.stages[0]
    const rustcBinding = stage.environmentPaths.find(({name}) => name == "RUSTC")
    let executions = 0
    const runner = createTargetCheckRunner({
      async execute() {
        executions += 1
        return {stderr: "", stdout: ""}
      },
      now: () => 0
    })

    assert.ok(rustcBinding)
    const replacements = [
      {...stage, environmentPaths: Object.freeze(stage.environmentPaths.filter(({name}) => name != "RUSTC"))},
      {...stage, environment: Object.freeze({...stage.environment, RUSTC: "/opt/semantifold-cargo/bin/cargo"})},
      {...stage, environmentPaths: Object.freeze(stage.environmentPaths.map(binding => binding.name == "RUSTC"
        ? {...binding}
        : binding))},
      {
        ...stage,
        environment: Object.freeze({...stage.environment, GO: "/opt/semantifold-tools/go"}),
        environmentPaths: Object.freeze([...stage.environmentPaths, Object.freeze({
          name: "GO", ownership: /** @type {const} */ ("tool"), tool: tool("go")
        })])
      }
    ]

    try {
      for (const replacement of replacements) {
        const plan = Object.freeze({...staged.plan, stages: Object.freeze([
          Object.freeze(replacement), ...staged.plan.stages.slice(1)
        ])})

        await assert.rejects(runner.run(plan), error =>
          error instanceof SemantifoldDiagnostic && error.code == "INVALID_TARGET_CHECK_PLAN")
      }
      expect(executions).toEqual(0)
    } finally {
      await rm(staged.root, {force: true, recursive: true})
    }
  })
})
