// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  generateArtifactSet,
  materializeGeneratedArtifactSet,
  parse,
  SemantifoldDiagnostic
} from "../index.js"
import {createArtifactMaterializer} from "../src/materialization.js"

const source = `func decorate(_ value: String, _ suffix: String) -> String {
  print(value)
  return value + suffix
}
print(decorate("hello", "!"))
`

const configuration = () => ({
  bundleIdentifier: "com.example.semantifold",
  deploymentTarget: "18.0",
  displayName: "Semantifold",
  moduleName: "SemantifoldApp",
  organizationPrefix: "com.example",
  productName: "SemantifoldApp"
})

const applicationSet = () => generateArtifactSet({
  assets: [{
    content: new Uint8Array([0, 1, 2, 255]),
    mediaType: "application/octet-stream",
    path: "Assets.xcassets/Data.dataset/payload.bin",
    sha256: createHash("sha256").update(new Uint8Array([0, 1, 2, 255])).digest("hex")
  }],
  configuration: configuration(),
  language: "ios",
  module: parse({filename: "program.swift", language: "swift", source}),
  role: "application"
})

describe("generated artifact-set materialization", () => {
  it("publishes an absent destination atomically with exact text and bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-materialization-"))
    const destination = path.join(root, "Application")

    try {
      const set = applicationSet()
      const result = await materializeGeneratedArtifactSet({artifactSet: set, destination})

      expect(result).toEqual({
        destination,
        paths: set.artifacts.map(({path: artifactPath}) => artifactPath),
        schema: "ArtifactMaterialization",
        version: 1
      })
      for (const artifact of set.artifacts) {
        const content = await readFile(path.join(destination, ...artifact.path.split("/")))

        if (artifact.contentKind == "text") expect(content.toString("utf8")).toEqual(artifact.content)
        else assert.deepEqual(new Uint8Array(content), artifact.content)
      }
      expect((await readdir(root)).some(name => name.includes(".semantifold-stage-"))).toBeFalse()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("refuses existing files, directories, symlinks, portable sibling collisions, and symlink parents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-materialization-refusal-"))
    const set = applicationSet()

    try {
      const file = path.join(root, "file")
      const directory = path.join(root, "directory")
      const link = path.join(root, "link")
      const existingCase = path.join(root, "Existing")
      const realParent = path.join(root, "real-parent")
      const parentLink = path.join(root, "parent-link")

      await writeFile(file, "caller file\n")
      await mkdir(directory)
      await symlink(file, link)
      await mkdir(existingCase)
      await mkdir(realParent)
      await symlink(realParent, parentLink)
      for (const destination of [file, directory, link, path.join(root, "existing"), path.join(parentLink, "Application")]) {
        await assert.rejects(
          materializeGeneratedArtifactSet({artifactSet: set, destination}),
          error => error instanceof SemantifoldDiagnostic && error.code == "MATERIALIZATION_REFUSED"
        )
      }
      expect(await readFile(file, "utf8")).toEqual("caller file\n")
      expect((await lstat(directory)).isDirectory()).toBeTrue()
      expect((await lstat(link)).isSymbolicLink()).toBeTrue()
      expect((await lstat(parentLink)).isSymbolicLink()).toBeTrue()
      expect((await readdir(root)).some(name => name.includes(".semantifold-stage-"))).toBeFalse()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("preflights traversal, case-fold, and prefix conflicts before creating a stage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-materialization-preflight-"))

    try {
      for (const paths of [
        ["../escape.swift"],
        ["Sources/Main.swift", "sources/main.swift"],
        ["Sources", "Sources/Main.swift"]
      ]) {
        const destination = path.join(root, `Application${paths.length}${paths[0].length}`)

        await assert.rejects(
          materializeGeneratedArtifactSet({artifactSet: candidateSet(paths), destination}),
          error => error instanceof SemantifoldDiagnostic &&
            ["INVALID_ARTIFACT_SET", "MATERIALIZATION_REFUSED"].includes(error.code)
        )
        await assert.rejects(lstat(destination), {code: "ENOENT"})
      }
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("cleans only its private stage after an injected exclusive-write failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-materialization-failure-"))
    const destination = path.join(root, "Application")
    const sentinel = path.join(root, "caller.txt")
    let writes = 0
    const materialize = createArtifactMaterializer({
      async writeFile(filename, content, options) {
        writes += 1
        if (writes == 2) throw new Error("injected write failure")

        return writeFile(filename, content, options)
      }
    })

    try {
      await writeFile(sentinel, "caller-owned\n")
      await assert.rejects(
        materialize({artifactSet: applicationSet(), destination}),
        error => error instanceof SemantifoldDiagnostic && error.code == "MATERIALIZATION_FAILED"
      )
      expect(await readFile(sentinel, "utf8")).toEqual("caller-owned\n")
      await assert.rejects(lstat(destination), {code: "ENOENT"})
      expect(await readdir(root)).toEqual(["caller.txt"])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

/** @param {string[]} paths - Deliberately untrusted artifact paths. @returns {import("../src/semantic/types.js").GeneratedArtifactSet} Candidate. */
function candidateSet(paths) {
  return /** @type {import("../src/semantic/types.js").GeneratedArtifactSet} */ ({
    artifacts: paths.map((artifactPath, index) => ({
      content: "content\n",
      contentKind: "text",
      mediaType: "text/plain",
      ownership: "generated",
      path: artifactPath,
      provenance: {kind: "synthetic", reason: "test candidate", relatedOrigins: []},
      role: index == 0 ? "entry" : "support"
    })),
    entry: paths[0],
    schema: "GeneratedArtifactSet",
    target: "ios",
    version: 1
  })
}
