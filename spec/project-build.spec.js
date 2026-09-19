// @ts-check

import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import assert from "node:assert/strict"
import {ProjectBuilder} from "../index.js"
import {observeProjectBuild} from "../src/project-build.js"

/**
 * Creates one JavaScript/JSDoc project with caller-selected targets.
 * @param {Record<string, unknown>[]} targets - Ordered target declarations.
 * @returns {Promise<{manifestPath: string, root: string}>} Fixture paths.
 */
async function buildFixture(targets) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-build-"))
  const manifestPath = path.join(root, "semantifold.json")

  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src/main.js"), `/**
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
function add(left, right) { return left + right }
console.log(add(2, 3))
`)
  await writeFile(manifestPath, `${JSON.stringify({
    id: "build-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}],
    targets,
    version: 1
  }, null, 2)}\n`)

  return {manifestPath, root}
}

/**
 * Creates a Task-010 two-module JavaScript project.
 * @returns {Promise<{manifestPath: string, root: string}>} Fixture paths.
 */
async function multifileFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-multifile-"))
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
    id: "multifile-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [
      {entry: true, id: "main", language: "javascript", path: "src/main.js"},
      {entry: false, id: "message", language: "javascript", path: "src/message.js"}
    ],
    targets: [
      {id: "javascript-main", language: "javascript", role: "text", sourceProjection: "targets/javascript/source"},
      {id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}
    ],
    version: 1
  }, null, 2)}\n`)

  return {manifestPath, root}
}

describe("Semantifold one-shot project build", () => {
  it("generates Java from one frozen JavaScript/JSDoc snapshot and atomically activates it", async () => {
    const {manifestPath, root} = await buildFixture([
      {id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}
    ])

    try {
      const result = await new ProjectBuilder().build(manifestPath)
      const target = result.generation.targets[0]
      const java = await readFile(path.join(target.sourcePath, "semantifold/generated/main/Main.java"), "utf8")
      const pointer = JSON.parse(await readFile(path.join(root, ".semantifold/active-generation.json"), "utf8"))

      expect(result.status).toEqual("succeeded")
      expect(result.projectId).toEqual("build-project")
      expect(result.snapshotHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(result.generationId).toEqual(`g-${result.snapshotHash}`)
      expect(result.generation.generationId).toEqual(result.generationId)
      expect(result.targets).toEqual([{
        artifactCount: 1,
        id: "java-main",
        language: "java",
        role: "text"
      }])
      expect(java).toContain("public final class Main")
      expect(java).toContain("System.out.println(add(2, 3));")
      expect(pointer.generationId).toEqual(result.generationId)
      expect(Object.isFrozen(result)).toBeTrue()
      expect(Object.isFrozen(result.targets)).toBeTrue()
      expect(Object.isFrozen(result.targets[0])).toBeTrue()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("protects an exact project-root source file without treating the whole project as source-owned", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-root-source-"))
    const manifestPath = path.join(root, "semantifold.json")

    await writeFile(path.join(root, "main.js"), "console.log(\"root source\")\n")
    await writeFile(manifestPath, `${JSON.stringify({
      id: "root-source-project",
      publicationRoot: ".semantifold",
      schema: "SemantifoldProject",
      sources: [{entry: true, id: "main", language: "javascript", path: "main.js"}],
      targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}],
      version: 1
    }, null, 2)}\n`)

    try {
      const result = await new ProjectBuilder().build(manifestPath)

      expect(result.status).toEqual("succeeded")
      expect(await readFile(path.join(result.generation.targets[0].sourcePath,
        "semantifold/generated/main/Main.java"), "utf8")).toContain("root source")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("parses a Task-010 multi-file snapshot once and publishes ordered targets through one commit", async () => {
    const {manifestPath, root} = await multifileFixture()

    try {
      const builder = new ProjectBuilder()
      /** @type {string[]} */
      const operations = []

      observeProjectBuild(builder, operation => operations.push(operation))
      const result = await builder.build(manifestPath)
      const generations = await readdir(path.join(root, ".semantifold/generations"))
      const generationManifest = JSON.parse(await readFile(result.generation.manifestPath, "utf8"))

      expect(operations).toEqual(["snapshot", "parse", "target:javascript-main", "target:java-main", "publish"])
      expect(result.targets).toEqual([
        {artifactCount: 3, id: "javascript-main", language: "javascript", role: "text"},
        {artifactCount: 2, id: "java-main", language: "java", role: "text"}
      ])
      expect(generations).toEqual([result.generationId])
      expect(generationManifest.targets.map(({id, target}) => ({id, target}))).toEqual([
        {id: "javascript-main", target: "javascript"},
        {id: "java-main", target: "java"}
      ])
      expect(await readFile(path.join(result.generation.targets[0].sourcePath, "main.js"), "utf8"))
        .toContain("console.log(message(\"Ada\"))")
      expect(await readFile(path.join(result.generation.targets[1].sourcePath,
        "semantifold/generated/main/Main.java"), "utf8")).toContain("Message.message(\"Ada\")")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("leaves the prior active generation and bytes unchanged when a later target fails", async () => {
    const {manifestPath, root} = await multifileFixture()
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))

    manifest.targets = [manifest.targets[0]]
    await writeFile(path.join(root, "src/message.js"), `/**
 * @param {string} name
 * @returns {string}
 */
function message(name) { return "Hello " + name }
export {message as display}
`)
    await writeFile(path.join(root, "src/main.js"), `import {display} from "./message.js"
console.log(display("Ada"))
`)
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    try {
      const initial = await new ProjectBuilder().build(manifestPath)
      const pointerPath = path.join(root, ".semantifold/active-generation.json")
      const oldPointer = await readFile(pointerPath)
      const oldMain = await readFile(path.join(initial.generation.targets[0].sourcePath, "main.js"))

      manifest.targets.push({id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"})
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      const failingBuilder = new ProjectBuilder()
      /** @type {string[]} */
      const operations = []

      observeProjectBuild(failingBuilder, operation => operations.push(operation))
      await assert.rejects(failingBuilder.build(manifestPath), error => error instanceof Error && "code" in error &&
        error.code == "UNSUPPORTED_CAPABILITY")
      expect(operations).toEqual(["snapshot", "parse", "target:javascript-main"])
      assert.deepEqual(await readFile(pointerPath), oldPointer)
      assert.deepEqual(await readFile(path.join(initial.generation.targets[0].sourcePath, "main.js")), oldMain)
      expect(await readdir(path.join(root, ".semantifold/generations"))).toEqual([initial.generationId])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
