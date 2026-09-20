// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  createTargetCheckPlan,
  discoverCanonicalToolchain,
  GeneratedArtifactPublisher,
  ProjectBuilder,
  SemantifoldDiagnostic,
  TargetCheckRunner
} from "../index.js"
import {observeProjectBuild} from "../src/project-build.js"
import {injectPublicationFailure} from "../src/publication.js"

const executeFile = promisify(execFile)
const synthetic = Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: "Java check fixture", relatedOrigins: Object.freeze([])})

/**
 * Creates a two-source JavaScript/JSDoc project that generates two Java compilation units.
 * @returns {Promise<{manifestPath: string, root: string}>}
 */
async function checkedProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task040-project-"))
  const manifestPath = path.join(root, "semantifold.json")

  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src/main.js"), `import {message} from "./message.js"
console.log(message("Ada"))
`)
  await writeFile(path.join(root, "src/message.js"), `/**
 * @param {string} name
 * @returns {string}
 */
export function message(name) { return "Hello " + name }
`)
  await writeFile(manifestPath, `${JSON.stringify({
    id: "checked-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [
      {entry: true, id: "main", language: "javascript", path: "src/main.js"},
      {entry: false, id: "message", language: "javascript", path: "src/message.js"}
    ],
    targets: [{
      buildProjection: "targets/java/classes",
      id: "java-main",
      language: "java",
      role: "text",
      sourceProjection: "targets/java/source"
    }],
    version: 1
  }, null, 2)}\n`)

  return {manifestPath, root}
}

/**
 * Creates one hand-authored Java artifact set for check-boundary transaction tests.
 * @param {string} source - Exact Java source.
 * @returns {import("../src/semantic/types.js").GeneratedArtifactSet}
 */
function javaSet(source) {
  return createGeneratedArtifactSet({
    artifacts: [{
      content: source,
      contentKind: "text",
      mediaType: "text/x-java-source",
      ownership: "generated",
      path: "demo/Main.java",
      provenance: synthetic,
      role: "entry"
    }],
    target: "java"
  })
}

/**
 * Creates a real Java validator from the target-owned plan.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} artifacts - Candidate Java sources.
 * @param {string} projectId - Project identity.
 * @param {import("../src/semantic/types.js").DiscoveredToolchain} javac - Canonical compiler.
 * @returns {import("../src/semantic/types.js").PublicationValidator}
 */
function javaValidator(artifacts, projectId, javac) {
  const runner = new TargetCheckRunner()

  return async ({buildPath, sourcePath, targetId}) => {
    const plan = createTargetCheckPlan({artifacts, buildPath, projectId, sourcePath, targetId, tools: [javac]})
    const checked = await runner.run(plan)

    return [...checked.outputs]
  }
}

describe("Java project checks and atomic publication", () => {
  it("builds JavaScript/JSDoc through Java, compiles every source into the build subtree, and executes only in acceptance code", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await checkedProject()

    try {
      const result = await new ProjectBuilder().build(manifestPath, undefined, {check: true})
      const target = result.generation.targets[0]
      const sourceFiles = (await readdir(path.join(target.sourcePath, "semantifold/generated"), {recursive: true}))
        .filter(filename => filename.endsWith(".java"))
      const buildFiles = (await readdir(target.buildPath, {recursive: true})).filter(filename => filename.endsWith(".class"))

      expect(result.generationId).toMatch(
        new RegExp(`^g-${result.snapshotHash}-checked-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`, "u")
      )
      expect(result.targets[0].check?.stages.map(({stage}) => stage)).toEqual(["compile"])
      expect(result.targets[0].check?.stages[0]).toMatchObject({exitCode: 0, signal: null, tool: {id: "javac"}})
      expect(sourceFiles.sort()).toEqual([
        "main/Main.java",
        "message/Message.java"
      ])
      expect(buildFiles.sort()).toEqual([
        "semantifold/generated/main/Main.class",
        "semantifold/generated/message/Message.class"
      ])
      expect(result.generation.manifest.targets[0].buildArtifacts.map(({mediaType, path: filename, role}) => ({
        mediaType,
        path: filename,
        role
      }))).toEqual([
        {mediaType: "application/java-vm", path: "semantifold/generated/main/Main.class", role: "compiler-output"},
        {mediaType: "application/java-vm", path: "semantifold/generated/message/Message.class", role: "compiler-output"}
      ])
      expect((await readdir(target.sourcePath, {recursive: true})).some(filename => filename.endsWith(".class"))).toBeFalse()
      const java = await discoverCanonicalToolchain("java")
      const executed = await executeFile(java.executable, ["-cp", target.buildPath, "semantifold.generated.main.Main"], {
        env: {LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC"}
      })

      expect(executed.stdout).toEqual("Hello Ada\n")
      expect(executed.stderr).toEqual("")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("reruns javac for repeated and reverted checked snapshots while retaining exact immutable outputs", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await checkedProject()
    const sourcePath = path.join(root, "src/main.js")
    const builder = new ProjectBuilder()
    /** @type {string[]} */
    const operations = []

    observeProjectBuild(builder, operation => operations.push(operation))
    try {
      const originalSource = await readFile(sourcePath)
      const first = await builder.build(manifestPath, undefined, {check: true})
      const firstJavaPath = path.join(first.generation.targets[0].sourcePath, "semantifold/generated/main/Main.java")
      const firstClassPath = path.join(first.generation.targets[0].buildPath, "semantifold/generated/main/Main.class")
      const firstJava = await readFile(firstJavaPath)
      const firstClass = await readFile(firstClassPath)
      const repeated = await builder.build(manifestPath, undefined, {check: true})

      await writeFile(sourcePath, originalSource.toString("utf8").replace("message(\"Ada\")", "message(\"Grace\")"))
      const changed = await builder.build(manifestPath, undefined, {check: true})

      await writeFile(sourcePath, originalSource)
      const reverted = await builder.build(manifestPath, undefined, {check: true})
      const pointer = JSON.parse(await readFile(path.join(root, ".semantifold/active-generation.json"), "utf8"))
      const revertedJavaPath = path.join(reverted.generation.targets[0].sourcePath, "semantifold/generated/main/Main.java")
      const revertedClassPath = path.join(reverted.generation.targets[0].buildPath, "semantifold/generated/main/Main.class")

      expect(new Set([first.generationId, repeated.generationId, changed.generationId, reverted.generationId]).size).toEqual(4)
      expect(first.snapshotHash).toEqual(repeated.snapshotHash)
      expect(first.snapshotHash).toEqual(reverted.snapshotHash)
      expect(changed.snapshotHash == first.snapshotHash).toBeFalse()
      expect(operations.filter(operation => operation == "check:java-main:compile")).toHaveLength(4)
      expect(pointer.generationId).toEqual(reverted.generationId)
      assert.deepEqual(await readFile(revertedJavaPath), firstJava)
      assert.deepEqual(await readFile(revertedClassPath), firstClass)
      assert.deepEqual(await readFile(firstJavaPath), firstJava)
      assert.deepEqual(await readFile(firstClassPath), firstClass)
      expect(await readdir(path.join(root, ".semantifold/generations"))).toHaveLength(4)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("fails loudly for missing and ambiguous target-declared javac without changing the active generation", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await checkedProject()

    try {
      const first = await new ProjectBuilder().build(manifestPath, undefined, {check: true})
      const pointerPath = path.join(root, ".semantifold/active-generation.json")
      const oldPointer = await readFile(pointerPath)
      const oldJavaPath = path.join(first.generation.targets[0].sourcePath, "semantifold/generated/main/Main.java")
      const oldClassPath = path.join(first.generation.targets[0].buildPath, "semantifold/generated/main/Main.class")
      const oldJava = await readFile(oldJavaPath)
      const oldClass = await readFile(oldClassPath)
      const sourcePath = path.join(root, "src/main.js")

      await writeFile(sourcePath, "console.log(\"changed\")\n")
      await assert.rejects(
        new ProjectBuilder({environment: {PATH: ""}}).build(manifestPath, undefined, {check: true}),
        error => diagnosticChain(error).some(diagnostic => diagnostic.code == "TOOL_NOT_FOUND" && diagnostic.language == "javac")
      )
      assert.deepEqual(await readFile(pointerPath), oldPointer)
      assert.deepEqual(await readFile(oldJavaPath), oldJava)
      assert.deepEqual(await readFile(oldClassPath), oldClass)
      expect(await readdir(path.join(root, ".semantifold/generations"))).toEqual([first.generationId])

      const firstBin = path.join(root, "first-bin")
      const secondBin = path.join(root, "second-bin")

      await Promise.all([mkdir(firstBin), mkdir(secondBin)])
      for (const directory of [firstBin, secondBin]) {
        const filename = path.join(directory, "javac")

        await writeFile(filename, "#!/bin/sh\nprintf 'javac 25.0.4\\n' >&2\n")
        await chmod(filename, 0o700)
      }
      await assert.rejects(
        new ProjectBuilder({environment: {PATH: `${firstBin}${path.delimiter}${secondBin}`}})
          .build(manifestPath, undefined, {check: true}),
        error => diagnosticChain(error).some(diagnostic => diagnostic.code == "TOOL_AMBIGUOUS" && diagnostic.language == "javac")
      )
      assert.deepEqual(await readFile(pointerPath), oldPointer)
      assert.deepEqual(await readFile(oldJavaPath), oldJava)
      assert.deepEqual(await readFile(oldClassPath), oldClass)
      expect(await readdir(path.join(root, ".semantifold/generations"))).toEqual([first.generationId])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("preserves exact last-good source/class bytes across compiler and pre-pointer failures, then recovers", {timeoutMs: 30_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task040-transaction-"))
    const sourceFile = path.join(root, "input.js")
    const publicationRoot = path.join(root, "published")
    const javac = await discoverCanonicalToolchain("javac")
    const publisher = new GeneratedArtifactPublisher({
      projectId: "transaction-project",
      projectRoot: root,
      publicationRoot,
      sourceFiles: [sourceFile]
    })
    const good = javaSet("package demo; public final class Main { public static void main(String[] args) { System.out.println(1); } }\n")
    const invalid = javaSet("package demo; public final class Main { this is not Java }\n")
    const recovered = javaSet("package demo; public final class Main { public static void main(String[] args) { System.out.println(2); } }\n")
    const request = (generationId, artifacts) => ({
      generationId,
      targets: [{
        artifactSet: artifacts,
        buildProjection: "targets/java/build",
        id: "java-main",
        role: /** @type {const} */ ("text"),
        sourceProjection: "targets/java/source",
        validators: [javaValidator(artifacts, "transaction-project", javac)]
      }]
    })

    try {
      await writeFile(sourceFile, "transaction source\n")
      const first = await publisher.publish(request("good-1", good))
      const pointerPath = path.join(publicationRoot, "active-generation.json")
      const javaPath = path.join(first.targets[0].sourcePath, "demo/Main.java")
      const classPath = path.join(first.targets[0].buildPath, "demo/Main.class")
      const oldPointer = await readFile(pointerPath)
      const oldJava = await readFile(javaPath)
      const oldClass = await readFile(classPath)

      await assert.rejects(
        publisher.publish(request("invalid-2", invalid)),
        error => error instanceof SemantifoldDiagnostic && error.code == "PUBLICATION_VALIDATION_FAILED" &&
          error.cause instanceof SemantifoldDiagnostic && error.cause.code == "TARGET_CHECK_NONZERO_EXIT" &&
          error.cause.stage == "compile" && error.cause.exitCode != 0 && error.cause.stderr.includes("error")
      )
      assert.deepEqual(await readFile(pointerPath), oldPointer)
      assert.deepEqual(await readFile(javaPath), oldJava)
      assert.deepEqual(await readFile(classPath), oldClass)
      expect(await readdir(path.join(publicationRoot, "generations"))).toEqual(["good-1"])

      injectPublicationFailure(publisher, "before-pointer-replace", new Error("pre-pointer fixture"))
      await assert.rejects(publisher.publish(request("pre-pointer-3", recovered)), error =>
        error instanceof SemantifoldDiagnostic && error.code == "PUBLICATION_POINTER_FAILED")
      assert.deepEqual(await readFile(pointerPath), oldPointer)
      assert.deepEqual(await readFile(javaPath), oldJava)
      assert.deepEqual(await readFile(classPath), oldClass)

      const final = await publisher.publish(request("recovered-4", recovered))

      expect(final.generationId).toEqual("recovered-4")
      expect(await readFile(path.join(final.targets[0].sourcePath, "demo/Main.java"), "utf8")).toContain("println(2)")
      expect(await readFile(path.join(final.targets[0].buildPath, "demo/Main.class"))).not.toEqual(oldClass)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

/**
 * Collects structured diagnostics without flattening their causes.
 * @param {unknown} error - Failure root.
 * @returns {SemantifoldDiagnostic[]} Ordered diagnostic chain.
 */
function diagnosticChain(error) {
  const diagnostics = []
  let current = error

  while (current instanceof Error) {
    if (current instanceof SemantifoldDiagnostic) diagnostics.push(current)
    current = current.cause
  }

  return diagnostics
}
