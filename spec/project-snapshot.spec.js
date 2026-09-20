// @ts-check

import assert from "node:assert/strict"
import {link, mkdir, mkdtemp, readFile, rm, utimes, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {ProjectManifestLoader, ProjectSnapshot, ProjectSnapshotBuilder} from "../index.js"
import {observeProjectSnapshotReads} from "../src/project-snapshot.js"

/**
 * Creates an equal two-source project under a fresh absolute root.
 * @returns {Promise<{manifestPath: string, root: string}>} Fixture paths.
 */
async function snapshotFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-snapshot-"))
  const manifestPath = path.join(root, "semantifold.json")
  const manifest = {
    id: "snapshot-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [
      {entry: true, id: "main", language: "javascript", path: "src/main.js"},
      {entry: false, id: "message", language: "javascript", path: "src/message.js"}
    ],
    targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}],
    version: 1
  }

  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src/main.js"), "import {message} from \"./message.js\"\nconsole.log(message())\n")
  await writeFile(path.join(root, "src/message.js"), "/** @returns {string} */\nexport function message() { return \"ready\" }\n")
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return {manifestPath, root}
}

describe("Semantifold project snapshot", () => {
  it("freezes sources in manifest order with a host-path-independent content hash", async () => {
    const first = await snapshotFixture()
    const second = await snapshotFixture()

    try {
      const loader = new ProjectManifestLoader()
      const builder = new ProjectSnapshotBuilder()
      const firstSnapshot = await builder.build(await loader.load(first.manifestPath))
      const secondSnapshot = await builder.build(await loader.load(second.manifestPath))

      expect(firstSnapshot instanceof ProjectSnapshot).toBeTrue()
      expect(firstSnapshot.hash).toMatch(/^[a-f0-9]{64}$/u)
      expect(firstSnapshot.hash).toEqual(secondSnapshot.hash)
      expect(firstSnapshot.sources.map(({id, path: sourcePath}) => ({id, path: sourcePath}))).toEqual([
        {id: "main", path: "src/main.js"},
        {id: "message", path: "src/message.js"}
      ])
      expect(firstSnapshot.sources.map(({source}) => source)).toEqual([
        "import {message} from \"./message.js\"\nconsole.log(message())\n",
        "/** @returns {string} */\nexport function message() { return \"ready\" }\n"
      ])
      for (const value of [firstSnapshot, firstSnapshot.sources, ...firstSnapshot.sources]) {
        expect(Object.isFrozen(value)).toBeTrue()
      }
    } finally {
      await rm(first.root, {force: true, recursive: true})
      await rm(second.root, {force: true, recursive: true})
    }
  })

  it("retries a one-time graph mutation and never returns a mixed source revision", async () => {
    const {manifestPath, root} = await snapshotFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)
      const builder = new ProjectSnapshotBuilder()
      let changed = false

      observeProjectSnapshotReads(builder, async ({path: sourcePath}) => {
        if (sourcePath != "src/main.js" || changed) return
        changed = true
        await writeFile(path.join(root, "src/main.js"), "import {message} from \"./message.js\"\nconsole.log(message() + \"!\")\n")
        await writeFile(path.join(root, "src/message.js"), "/** @returns {string} */\nexport function message() { return \"updated\" }\n")
      })
      const snapshot = await builder.build(project)

      expect(snapshot.sources.map(({source}) => source)).toEqual([
        "import {message} from \"./message.js\"\nconsole.log(message() + \"!\")\n",
        "/** @returns {string} */\nexport function message() { return \"updated\" }\n"
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("fails with a stable located diagnostic when a source changes through every bounded attempt", async () => {
    const {manifestPath, root} = await snapshotFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)
      const builder = new ProjectSnapshotBuilder()
      let revision = 0

      observeProjectSnapshotReads(builder, async ({path: sourcePath}) => {
        if (sourcePath != "src/main.js") return
        revision += 1
        await writeFile(path.join(root, "src/main.js"), `console.log(${revision})\n`)
      })
      await assert.rejects(builder.build(project), error => error instanceof Error && "code" in error &&
        error.code == "UNSTABLE_PROJECT_SNAPSHOT" && "location" in error && error.location?.filename == "src/main.js")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects a manifest mutation instead of combining it with the previously validated request", async () => {
    const {manifestPath, root} = await snapshotFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)
      const builder = new ProjectSnapshotBuilder()
      let changed = false

      observeProjectSnapshotReads(builder, async ({path: sourcePath}) => {
        if (sourcePath != "semantifold.json" || changed) return
        changed = true
        await writeFile(manifestPath, `${await readFile(manifestPath, "utf8")}\n`)
      })
      await assert.rejects(builder.build(project), error => error instanceof Error && "code" in error &&
        error.code == "UNSTABLE_PROJECT_SNAPSHOT" && "location" in error && error.location?.filename == "semantifold.json")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects source files changed into hard-link aliases after manifest validation", async () => {
    const {manifestPath, root} = await snapshotFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)
      const builder = new ProjectSnapshotBuilder()
      let changed = false

      observeProjectSnapshotReads(builder, async ({path: sourcePath}) => {
        if (sourcePath != "src/main.js" || changed) return
        changed = true
        await rm(path.join(root, "src/message.js"))
        await link(path.join(root, "src/main.js"), path.join(root, "src/message.js"))
      })
      await assert.rejects(builder.build(project), error => error instanceof Error && "code" in error &&
        error.code == "PROJECT_SOURCE_ALIAS" && "location" in error && error.location?.filename == "src/message.js")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("retries an in-place source mutation even when the exact bytes are unchanged", async () => {
    const {manifestPath, root} = await snapshotFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)
      const builder = new ProjectSnapshotBuilder()
      /** @type {number[]} */
      const attempts = []
      let changed = false

      observeProjectSnapshotReads(builder, async ({attempt, path: sourcePath}) => {
        if (sourcePath != "src/main.js") return
        attempts.push(attempt)
        if (changed) return
        changed = true
        await utimes(path.join(root, "src/main.js"), 1, 2)
      })
      const snapshot = await builder.build(project)

      expect(snapshot.sources[0].source).toEqual("import {message} from \"./message.js\"\nconsole.log(message())\n")
      expect([...new Set(attempts)]).toEqual([1, 2])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("revalidates graph state after the final declared source read", async () => {
    const {manifestPath, root} = await snapshotFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)
      const builder = new ProjectSnapshotBuilder()
      let changed = false

      observeProjectSnapshotReads(builder, async ({attempt, pass, path: sourcePath}) => {
        if (changed || attempt != 1 || pass != 2 || sourcePath != "src/message.js") return
        changed = true
        await writeFile(path.join(root, "src/main.js"), "console.log(\"after-final-read\")\n")
        await writeFile(path.join(root, "src/message.js"), "export const unused = 1\n")
      })
      const snapshot = await builder.build(project)

      expect(snapshot.sources.map(({source}) => source)).toEqual([
        "console.log(\"after-final-read\")\n",
        "export const unused = 1\n"
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
