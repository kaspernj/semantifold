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
  SemantifoldCli,
  SemantifoldDiagnostic,
  TargetCheckRunner
} from "../index.js"

const targets = ["php", "ruby", "javascript", "typescript", "kotlin", "python", "csharp"]
const invalidSources = new Map([
  ["php", "<?php\nfunction broken( {\n"],
  ["ruby", "def broken(\n"],
  ["javascript", "function broken( {\n"],
  ["typescript", "const broken: = 1\n"],
  ["kotlin", "fun broken( {\n"],
  ["python", "def broken(:\n"],
  ["csharp", "namespace Semantifold.Generated; internal static class Program { private static void Main( { }\n"]
])
const invalidPaths = new Map([
  ["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"], ["typescript", "program.ts"],
  ["kotlin", "Program.kt"], ["python", "program.py"], ["csharp", "Program.cs"]
])
const invalidProvenance = Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: "Task 041 invalid check-boundary fixture", relatedOrigins: Object.freeze([])})

/**
 * Builds one invalid set without changing the target's generated project inputs.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} good - Generated supported fixture.
 * @returns {import("../src/semantic/types.js").GeneratedArtifactSet} Invalid check-boundary fixture.
 */
function invalidSet(good) {
  const invalidPath = invalidPaths.get(good.target)

  return createGeneratedArtifactSet({
    artifacts: good.artifacts.map(artifact => artifact.path == invalidPath
      ? {...artifact, content: /** @type {string} */ (invalidSources.get(good.target)), provenance: invalidProvenance}
      : artifact),
    target: good.target
  })
}

/** @param {import("../src/semantic/types.js").GeneratedArtifactSet} good */
function invalidRestoreSet(good) {
  return createGeneratedArtifactSet({
    artifacts: good.artifacts.map(artifact => artifact.path == "Semantifold.csproj"
      ? {...artifact, content: "<Project><broken></Project>\n", provenance: invalidProvenance}
      : artifact),
    target: good.target
  })
}

/**
 * Creates a real target-owned publication validator and records completed stages.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} artifacts - Candidate artifacts.
 * @param {string} projectId - Project identity.
 * @param {readonly import("../src/semantic/types.js").DiscoveredToolchain[]} tools - Real canonical tools.
 * @param {import("../src/semantic/types.js").TargetCheckStageResult[]} completed - Stage sink.
 * @returns {import("../src/semantic/types.js").PublicationValidator} Real validator.
 */
function validator(artifacts, projectId, tools, completed) {
  return async ({buildPath, sourcePath, targetId}) => {
    const plan = createTargetCheckPlan({artifacts, buildPath, projectId, sourcePath, targetId, tools})
    const result = await new TargetCheckRunner().run(plan, {
      onStage: stage => completed.push(stage),
      timeoutMs: 60_000
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

/**
 * Reads every manifest-declared source/build byte from one published target.
 * @param {import("../src/semantic/types.js").PublishedGeneration} generation - Resolved publication.
 * @returns {Promise<Map<string, Buffer>>} Stable byte inventory.
 */
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

function outputBuffer() {
  let value = ""

  return {
    read: () => value,
    writer: {
      write(chunk) {
        value += String(chunk)

        return true
      }
    }
  }
}

describe("interpreted and managed real target checks", () => {
  it("runs every already-supported Task 041 project target through the unchanged generic CLI", {timeoutMs: 120_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task041-cli-"))
    const manifestPath = path.join(root, "semantifold.json")
    const stdout = outputBuffer()
    const stderr = outputBuffer()

    try {
      await mkdir(path.join(root, "src"))
      await writeFile(path.join(root, "src/main.js"), `/**
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
export function message(left, right) { return left + right }
console.log(message("TASK041_", "EXECUTED"))
`)
      const projectTargets = ["php", "ruby", "javascript", "typescript"]

      await writeFile(manifestPath, `${JSON.stringify({
        id: "managed-cli-project",
        publicationRoot: ".semantifold",
        schema: "SemantifoldProject",
        sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}],
        targets: projectTargets.map(language => ({
          buildProjection: `targets/${language}/build`,
          id: `${language}-main`,
          language,
          role: "text",
          sourceProjection: `targets/${language}/source`
        })),
        version: 1
      }, null, 2)}\n`)
      const status = await new SemantifoldCli({stderr: stderr.writer, stdout: stdout.writer})
        .run(["build", "--check", "--ndjson", "--project", manifestPath])
      const records = stdout.read().trim().split("\n").map(line => JSON.parse(line))
      const checked = records.filter(({state}) => state == "target-checked")

      assert.equal(status, 0, `${stderr.read()}\n${stdout.read()}`)
      expect(stderr.read()).toEqual("")
      expect(records.at(-1)).toMatchObject({checked: true, exitCode: 0, state: "succeeded", terminal: true})
      expect(checked.map(({stage, target, tool}) => [target, stage, tool.id])).toEqual([
        ["php-main", "validate", "php82"],
        ["ruby-main", "validate", "ruby"],
        ["javascript-main", "validate", "node"],
        ["typescript-main", "compile", "tsc"]
      ])
      expect(checked.some(({stage}) => stage == "execute")).toBeFalse()
      expect(checked.some(({stderr: nativeStderr, stdout: nativeStdout}) =>
        nativeStderr.includes("TASK041_EXECUTED") || nativeStdout.includes("TASK041_EXECUTED"))).toBeFalse()
      const pointer = JSON.parse(await readFile(path.join(root, ".semantifold/active-generation.json"), "utf8"))
      const manifest = JSON.parse(await readFile(path.join(root, ".semantifold/generations", pointer.generationId, "manifest.json"), "utf8"))

      expect(manifest.targets.map(({target}) => target)).toEqual(projectTargets)
      expect(manifest.targets.every(({buildArtifacts}) => buildArtifacts.length == 0)).toBeTrue()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("checks valid generated fixtures twice and transactionally rejects invalid native source for every target", {timeoutMs: 240_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task041-real-"))
    const module = parse({
      filename: "fixture.js",
      language: "javascript",
      source: `/**
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
function message(left, right) { return left + right }
console.log(message("TASK041_", "EXECUTED"))
`
    })

    try {
      for (const target of targets) {
        const targetRoot = path.join(root, target)
        const sourceFile = path.join(targetRoot, "declared-input.js")
        const publicationRoot = path.join(targetRoot, "published")
        const projectId = `${target}-check-project`
        const targetId = `${target}-main`
        const good = generateArtifactSet({language: target, module})
        const invalid = invalidSet(good)
        const capability = languageCapabilities.find(({id}) => id == target)?.check

        assert.ok(capability?.supported)
        await mkdir(targetRoot, {recursive: true})
        await writeFile(sourceFile, "declared source input\n")
        const tools = Object.freeze(await Promise.all(capability.toolchains.map(toolchain =>
          discoverCanonicalToolchain(/** @type {any} */ (toolchain)))))
        const publisher = new GeneratedArtifactPublisher({projectId, projectRoot: targetRoot, publicationRoot, sourceFiles: [sourceFile]})
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
        const firstBytes = await publishedBytes(first)
        const firstStages = completed.splice(0)
        const second = await publisher.publish(request("checked-2", good))
        const secondStages = completed.splice(0)
        const expectedStages = capability.stages

        expect(firstStages.map(({stage}) => stage)).toEqual(expectedStages)
        expect(secondStages.map(({stage}) => stage)).toEqual(expectedStages)
        expect([...firstStages, ...secondStages].every(result => result.exitCode == 0 && result.signal == null)).toBeTrue()
        expect([...firstStages, ...secondStages].some(result =>
          result.stdout.includes("TASK041_EXECUTED") || result.stderr.includes("TASK041_EXECUTED"))).toBeFalse()
        expect(first.manifest.targets[0].buildArtifacts.map(({path: artifactPath}) => artifactPath))
          .toEqual(second.manifest.targets[0].buildArtifacts.map(({path: artifactPath}) => artifactPath))
        if (["php", "ruby", "javascript", "typescript"].includes(target)) {
          expect(second.manifest.targets[0].buildArtifacts).toEqual([])
        } else {
          expect(second.manifest.targets[0].buildArtifacts.length > 0).toBeTrue()
        }
        if (target == "python") {
          expect(second.manifest.targets[0].buildArtifacts.map(({path: artifactPath}) => artifactPath)).toEqual(["program.pyc"])
          assert.deepEqual((await publishedBytes(second)).get("build/program.pyc"), firstBytes.get("build/program.pyc"))
          expect((await readdir(second.targets[0].sourcePath, {recursive: true})).some(entry => entry == "__pycache__")).toBeFalse()
        }
        if (target == "kotlin") {
          expect(second.manifest.targets[0].buildArtifacts.every(({path: artifactPath}) => artifactPath.startsWith("classes/"))).toBeTrue()
        }
        if (target == "csharp") {
          expect(second.manifest.targets[0].buildArtifacts.every(({path: artifactPath}) => artifactPath.startsWith("bin/"))).toBeTrue()
        }
        const pointerPath = path.join(publicationRoot, "active-generation.json")
        const oldPointer = await readFile(pointerPath)
        const oldBytes = await publishedBytes(second)

        await assert.rejects(publisher.publish(request("invalid-3", invalid)), error => {
          const diagnostics = diagnosticChain(error)
          const native = diagnostics.find(diagnostic => diagnostic.code == "TARGET_CHECK_NONZERO_EXIT")

          return diagnostics[0]?.code == "PUBLICATION_VALIDATION_FAILED" && native != undefined &&
            native.language == target && native.stage == (expectedStages.at(-1) ?? "") && native.exitCode != undefined &&
            `${native.stdout}${native.stderr}`.length > 0
        })
        assert.deepEqual(await readFile(pointerPath), oldPointer)
        const retainedBytes = await publishedBytes(second)

        expect([...retainedBytes.keys()]).toEqual([...oldBytes.keys()])
        for (const [filename, bytes] of oldBytes) assert.deepEqual(retainedBytes.get(filename), bytes, `${target}:${filename}`)
        expect((await readdir(path.join(publicationRoot, "generations"))).sort()).toEqual(["checked-1", "checked-2"])
        expect((await readdir(publicationRoot, {recursive: true})).some(entry => entry.includes("invalid-3"))).toBeFalse()
        if (target == "csharp") {
          await assert.rejects(publisher.publish(request("restore-invalid-4", invalidRestoreSet(good))), error => {
            const diagnostics = diagnosticChain(error)
            const native = diagnostics.find(diagnostic => diagnostic.code == "TARGET_CHECK_NONZERO_EXIT")

            return diagnostics[0]?.code == "PUBLICATION_VALIDATION_FAILED" && native?.stage == "restore" &&
              native.language == "csharp" && `${native.stdout}${native.stderr}`.length > 0
          })
          assert.deepEqual(await readFile(pointerPath), oldPointer)
          expect((await readdir(path.join(publicationRoot, "generations"))).sort()).toEqual(["checked-1", "checked-2"])
          expect((await readdir(publicationRoot, {recursive: true})).some(entry => entry.includes("restore-invalid-4"))).toBeFalse()
        }
      }
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
