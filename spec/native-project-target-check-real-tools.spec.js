// @ts-check

import assert from "node:assert/strict"
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  createTargetCheckPlan,
  discoverCanonicalToolchain,
  generateArtifactSet,
  GeneratedArtifactPublisher,
  languageCapabilities,
  parse,
  SemantifoldDiagnostic,
  TargetCheckRunner
} from "../index.js"

const targets = ["go", "c", "cpp", "rust", "swift", "dart", "zig"]
const invalidPaths = new Map([
  ["go", "main.go"], ["c", "program.c"], ["cpp", "program.cpp"], ["rust", "src/main.rs"],
  ["swift", "program.swift"], ["dart", "bin/program.dart"], ["zig", "src/main.zig"]
])
const invalidSources = new Map([
  ["go", "package main\nfunc main( {\n"],
  ["c", "#include \"semantifold_runtime.h\"\nint main( {\n"],
  ["cpp", "int main( {\n"],
  ["rust", "fn main( {\n"],
  ["swift", "func broken( {\n"],
  ["dart", "void main() { final int value = 'wrong'; print(value); }\n"],
  ["zig", "pub fn main( {\n"]
])
const invalidProvenance = Object.freeze({
  kind: /** @type {const} */ ("synthetic"),
  reason: "Task 042 invalid check-boundary fixture",
  relatedOrigins: Object.freeze([])
})

/** @param {import("../src/semantic/types.js").GeneratedArtifactSet} good */
function invalidSet(good) {
  const invalidPath = invalidPaths.get(good.target)

  return createGeneratedArtifactSet({
    artifacts: good.artifacts.map(artifact => artifact.path == invalidPath
      ? {...artifact, content: /** @type {string} */ (invalidSources.get(good.target)), provenance: invalidProvenance}
      : artifact),
    target: good.target
  })
}

/**
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} artifacts
 * @param {string} projectId
 * @param {readonly import("../src/semantic/types.js").DiscoveredToolchain[]} tools
 * @param {import("../src/semantic/types.js").TargetCheckStageResult[]} completed
 * @returns {import("../src/semantic/types.js").PublicationValidator}
 */
function validator(artifacts, projectId, tools, completed) {
  return async ({buildPath, sourcePath, targetId}) => {
    const plan = createTargetCheckPlan({artifacts, buildPath, projectId, sourcePath, targetId, tools})
    const result = await new TargetCheckRunner().run(plan, {
      onStage: stage => completed.push(stage),
      timeoutMs: 120_000
    })

    return [...result.outputs]
  }
}

/** @param {unknown} error */
function diagnosticChain(error) {
  /** @type {SemantifoldDiagnostic[]} */
  const diagnostics = []
  let current = error

  while (current instanceof Error) {
    if (current instanceof SemantifoldDiagnostic) diagnostics.push(current)
    current = current.cause
  }

  return diagnostics
}

/** @param {import("../src/semantic/types.js").PublishedGeneration} generation */
async function publishedBytes(generation) {
  const target = generation.targets[0]
  const manifest = generation.manifest.targets[0]
  const bytes = new Map()

  for (const artifact of manifest.artifacts) {
    bytes.set(`source/${artifact.path}`, await readFile(path.join(target.sourcePath, artifact.path)))
  }
  for (const artifact of manifest.buildArtifacts) {
    bytes.set(`build/${artifact.path}`, await readFile(path.join(target.buildPath, artifact.path)))
  }

  return bytes
}

describe("native and project real target checks", () => {
  it("checks all seven generated targets twice and transactionally rejects invalid staged source", {timeoutMs: 360_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task042-real-"))
    const module = parse({
      filename: "fixture.js",
      language: "javascript",
      source: `/**
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
function combine(left, right) { return left + right }
console.log(combine("TASK042_MUST_", "NOT_EXECUTE"))
`
    })

    try {
      for (const target of targets) {
        const targetRoot = path.join(root, target)
        const sourceFile = path.join(targetRoot, "declared-input.js")
        const publicationRoot = path.join(targetRoot, "published")
        const projectId = `${target}-check-project`
        const targetId = `${target}-main`
        const good = generateArtifactSet({language: /** @type {any} */ (target), module})
        const invalid = invalidSet(good)
        const capability = languageCapabilities.find(({id}) => id == target)?.check

        assert.ok(capability?.supported)
        await mkdir(targetRoot, {recursive: true})
        await writeFile(sourceFile, "declared source input\n")
        const tools = Object.freeze(await Promise.all(capability.toolchains.map(toolchain =>
          discoverCanonicalToolchain(/** @type {any} */ (toolchain)))))
        const publisher = new GeneratedArtifactPublisher({
          projectId,
          projectRoot: targetRoot,
          publicationRoot,
          sourceFiles: [sourceFile]
        })
        /** @type {import("../src/semantic/types.js").TargetCheckStageResult[]} */
        const completed = []
        const request = (generationId, artifacts) => ({
          generationId,
          targets: [{
            artifactSet: artifacts,
            buildProjection: `targets/${target}/build`,
            id: targetId,
            role: /** @type {const} */ ("text"),
            sourceProjection: `targets/${target}/source`,
            validators: [validator(artifacts, projectId, tools, completed)]
          }]
        })
        const first = await publisher.publish(request("checked-1", good))
        const firstStages = completed.splice(0)
        const firstBytes = await publishedBytes(first)
        const second = await publisher.publish(request("checked-2", good))
        const secondStages = completed.splice(0)
        const secondBytes = await publishedBytes(second)
        const expectedStages = new Map([
          ["go", ["compile", "validate"]], ["c", ["compile", "link"]], ["cpp", ["compile", "link"]],
          ["rust", ["compile", "validate"]], ["swift", ["compile", "compile", "compile"]],
          ["dart", ["restore", "compile", "validate", "validate"]], ["zig", ["compile", "validate"]]
        ]).get(target)

        expect(firstStages.map(({stage}) => stage)).toEqual(expectedStages)
        expect(secondStages.map(({stage}) => stage)).toEqual(expectedStages)
        expect([...firstStages, ...secondStages].every(result => result.exitCode == 0 && result.signal == null)).toBeTrue()
        expect([...firstStages, ...secondStages].some(result =>
          result.stdout.includes("TASK042_MUST_NOT_EXECUTE") || result.stderr.includes("TASK042_MUST_NOT_EXECUTE"))).toBeFalse()
        expect([...secondBytes.keys()]).toEqual([...firstBytes.keys()])
        for (const [filename, bytes] of firstBytes) {
          assert.ok(secondBytes.get(filename)?.equals(bytes), `${target}:${filename}: repeated check bytes`)
        }
        const expectedBuildPaths = new Map([
          ["go", ["semantifold-go"]], ["c", ["semantifold-c"]], ["cpp", ["semantifold-cpp"]], ["rust", []],
          ["swift", ["semantifold-swift"]], ["dart", []],
          ["zig", []]
        ])

        expect(second.manifest.targets[0].buildArtifacts.map(({path: artifactPath}) => artifactPath))
          .toEqual(expectedBuildPaths.get(target))
        expect((await readdir(second.targets[0].sourcePath, {recursive: true})).sort())
          .toEqual(good.artifacts.flatMap(artifact => {
            const segments = artifact.path.split("/")

            return segments.map((_, index) => segments.slice(0, index + 1).join("/"))
          }).filter((entry, index, entries) => entries.indexOf(entry) == index).sort())
        const buildEntries = await readdir(second.targets[0].buildPath, {recursive: true})

        expect(buildEntries.some(entry => /(?:cache|cargo-home|cargo-target|go-home|go-path|go-tmp|home|tmp)/u.test(entry))).toBeFalse()
        const pointerPath = path.join(publicationRoot, "active-generation.json")
        const oldPointer = await readFile(pointerPath)

        await assert.rejects(publisher.publish(request("invalid-3", invalid)), error => {
          const diagnostics = diagnosticChain(error)
          const native = diagnostics.find(diagnostic => diagnostic.code == "TARGET_CHECK_NONZERO_EXIT")

          return diagnostics[0]?.code == "PUBLICATION_VALIDATION_FAILED" && native != undefined &&
            native.language == target && native.targetId == targetId && native.exitCode != undefined &&
            `${native.stdout}${native.stderr}`.length > 0
        })
        assert.deepEqual(await readFile(pointerPath), oldPointer)
        const retained = await publishedBytes(second)

        expect([...retained.keys()]).toEqual([...secondBytes.keys()])
        for (const [filename, bytes] of secondBytes) {
          assert.ok(retained.get(filename)?.equals(bytes), `${target}:${filename}: retained check bytes`)
        }
        expect((await readdir(path.join(publicationRoot, "generations"))).sort()).toEqual(["checked-1", "checked-2"])
        expect((await readdir(publicationRoot, {recursive: true})).some(entry => entry.includes("invalid-3"))).toBeFalse()
      }
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
