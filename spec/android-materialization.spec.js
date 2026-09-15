// @ts-check

import assert from "node:assert/strict"
import {mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"
import {materializeAndroidAcceptanceProject} from "../scripts/android-materialization.js"

const module = () => parse({
  filename: "program.kt",
  language: "kotlin",
  source: `fun choose(value: String, suffix: String): String {
  return value + suffix
}

fun main() {
  println(choose("ready", "!"))
}
`
})

describe("private Android acceptance materialization", () => {
  it("writes and verifies one fresh mode-0700 acceptance project without exposing a public writer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-materialize-"))

    try {
      await writeFile(path.join(root, "outside.txt"), "preserve")
      const acceptance = path.join(root, "acceptance")

      await mkdir(acceptance, {mode: 0o700})
      const set = generateArtifactSet({language: "android", module: module(), role: "application"})
      const result = await materializeAndroidAcceptanceProject(set, acceptance)

      expect(result.projectDirectory).toEqual(path.join(acceptance, "generated/android-app"))
      expect((await stat(acceptance)).mode & 0o777).toEqual(0o700)
      expect(await readFile(path.join(result.projectDirectory, "settings.gradle.kts"), "utf8"))
        .toEqual(set.artifacts.find(({path: artifactPath}) => artifactPath.endsWith("settings.gradle.kts"))?.content)
      expect(await readFile(path.join(root, "outside.txt"), "utf8")).toEqual("preserve")
      expect(result.verifiedPaths).toEqual(set.artifacts.map(({path: artifactPath}) => artifactPath))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("refuses non-empty or symlink-bearing acceptance roots before writing any artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-refuse-"))

    try {
      const set = generateArtifactSet({language: "android", module: module(), role: "application"})
      const occupied = path.join(root, "occupied")
      const linked = path.join(root, "linked")

      await mkdir(occupied, {mode: 0o700})
      await writeFile(path.join(occupied, "existing"), "owned elsewhere")
      await symlink(occupied, linked)
      for (const candidate of [occupied, linked]) {
        await assert.rejects(
          materializeAndroidAcceptanceProject(set, candidate),
          /fresh non-symlink mode-0700 directory/u
        )
      }
      await assert.rejects(stat(path.join(occupied, "generated")))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
