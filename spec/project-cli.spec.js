// @ts-check

import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {parseSemantifoldCliArguments, SemantifoldCli} from "../index.js"

/** @returns {(error: unknown) => boolean} */
function invalidArguments() {
  return error => error instanceof Error && "code" in error && error.code == "INVALID_CLI_ARGUMENTS"
}

/**
 * Creates one CLI build project.
 * @param {string} source - JavaScript/JSDoc source.
 * @returns {Promise<{manifestPath: string, root: string}>} Fixture paths.
 */
async function cliFixture(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-cli-"))
  const manifestPath = path.join(root, "semantifold.json")

  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src/main.js"), source)
  await writeFile(manifestPath, `${JSON.stringify({
    id: "cli-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}],
    targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}],
    version: 1
  }, null, 2)}\n`)

  return {manifestPath, root}
}

/** @returns {{read: () => string, writer: {write: (chunk: string | Uint8Array) => boolean}}} */
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

describe("Semantifold project CLI", () => {
  it("parses only the strict one-shot build command and its two explicit options", () => {
    expect(parseSemantifoldCliArguments(["build"])).toEqual({format: "human", projectPath: "./semantifold.json"})
    expect(parseSemantifoldCliArguments(["build", "--project", "config/project.json"])).toEqual({
      format: "human",
      projectPath: "config/project.json"
    })
    expect(parseSemantifoldCliArguments(["build", "--ndjson", "--project", "semantifold.json"])).toEqual({
      format: "ndjson",
      projectPath: "semantifold.json"
    })

    for (const arguments_ of [
      [],
      ["watch"],
      ["build", "extra"],
      ["build", "--unknown"],
      ["build", "--project"],
      ["build", "--project", "--ndjson"],
      ["build", "--project", "one.json", "--project", "two.json"],
      ["build", "--ndjson", "--ndjson"]
    ]) assert.throws(() => parseSemantifoldCliArguments(arguments_), invalidArguments())
  })

  it("reports one truthful human terminal result and returns zero only after publication", async () => {
    const {manifestPath, root} = await cliFixture("console.log(\"ready\")\n")
    const stdout = outputBuffer()
    const stderr = outputBuffer()

    try {
      const status = await new SemantifoldCli({stderr: stderr.writer, stdout: stdout.writer})
        .run(["build", "--project", manifestPath])

      expect(status).toEqual(0)
      expect(stdout.read()).toMatch(/^Built project 'cli-project' as generation 'g-[a-f0-9]{64}' with 1 target\.\n$/u)
      expect(stderr.read()).toEqual("")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("emits deterministic NDJSON states with exactly one terminal success record", async () => {
    const {manifestPath, root} = await cliFixture("console.log(\"ready\")\n")
    const stdout = outputBuffer()
    const stderr = outputBuffer()

    try {
      const status = await new SemantifoldCli({stderr: stderr.writer, stdout: stdout.writer})
        .run(["build", "--ndjson", "--project", manifestPath])
      const records = stdout.read().trim().split("\n").map(line => JSON.parse(line))

      expect(status).toEqual(0)
      expect(stderr.read()).toEqual("")
      expect(records.map(({state}) => state)).toEqual([
        "project-loaded", "snapshot-loaded", "target-generated", "succeeded"
      ])
      expect(records.every(({cycle, project, schema, version}) => cycle == 1 && project == "cli-project" &&
        schema == "SemantifoldBuildEvent" && version == 1)).toBeTrue()
      expect(records.filter(({terminal}) => terminal === true).length).toEqual(1)
      expect(records[1].snapshotHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(records[2]).toMatchObject({artifactCount: 1, role: "text", target: "java-main"})
      expect(records[3]).toMatchObject({exitCode: 0, terminal: true})
      expect(records[3].generationId).toEqual(`g-${records[1].snapshotHash}`)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("returns non-zero with exactly one terminal record preserving the first diagnostic", async () => {
    const invalidArgumentsOutput = outputBuffer()
    const invalidArgumentsError = outputBuffer()
    const invalidStatus = await new SemantifoldCli({
      stderr: invalidArgumentsError.writer,
      stdout: invalidArgumentsOutput.writer
    }).run(["build", "--ndjson", "--unknown"])
    const invalidRecords = invalidArgumentsOutput.read().trim().split("\n").map(line => JSON.parse(line))

    expect(invalidStatus).toEqual(1)
    expect(invalidArgumentsError.read()).toEqual("")
    expect(invalidRecords).toHaveLength(1)
    expect(invalidRecords[0]).toMatchObject({
      diagnostic: {code: "INVALID_CLI_ARGUMENTS"},
      exitCode: 1,
      state: "failed",
      terminal: true
    })

    const {manifestPath, root} = await cliFixture("console.log(missing)\n")
    const stdout = outputBuffer()
    const stderr = outputBuffer()

    try {
      const status = await new SemantifoldCli({stderr: stderr.writer, stdout: stdout.writer})
        .run(["build", "--ndjson", "--project", manifestPath])
      const records = stdout.read().trim().split("\n").map(line => JSON.parse(line))
      const terminal = records.filter(record => record.terminal === true)

      expect(status).toEqual(1)
      expect(stderr.read()).toEqual("")
      expect(terminal).toHaveLength(1)
      expect(terminal[0]).toMatchObject({diagnostic: {code: "UNRESOLVED_BINDING"}, exitCode: 1, state: "failed"})
      expect(records.some(record => record.state == "target-generated")).toBeFalse()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
