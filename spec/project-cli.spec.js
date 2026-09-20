// @ts-check

import assert from "node:assert/strict"
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {parseSemantifoldCliArguments, ProjectBuilder, ProjectBuildReporter, SemantifoldCli, SemantifoldDiagnostic} from "../index.js"
import {observeProjectBuild} from "../src/project-build.js"

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
  it("parses only the strict one-shot build command and its three explicit options", () => {
    expect(parseSemantifoldCliArguments(["build"])).toEqual({check: false, format: "human", projectPath: "./semantifold.json"})
    expect(parseSemantifoldCliArguments(["build", "--project", "config/project.json"])).toEqual({
      check: false,
      format: "human",
      projectPath: "config/project.json"
    })
    expect(parseSemantifoldCliArguments(["build", "--ndjson", "--project", "semantifold.json"])).toEqual({
      check: false,
      format: "ndjson",
      projectPath: "semantifold.json"
    })
    expect(parseSemantifoldCliArguments(["build", "--check"])).toEqual({
      check: true,
      format: "human",
      projectPath: "./semantifold.json"
    })

    for (const arguments_ of [
      [],
      ["watch"],
      ["build", "extra"],
      ["build", "--unknown"],
      ["build", "--project"],
      ["build", "--project", "--ndjson"],
      ["build", "--project", "one.json", "--project", "two.json"],
      ["build", "--ndjson", "--ndjson"],
      ["build", "--check", "--check"]
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

  it("reports exact javac stage evidence for --check without executing generated Java", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await cliFixture("console.log(\"checked only\")\n")
    const stdout = outputBuffer()
    const stderr = outputBuffer()

    try {
      const status = await new SemantifoldCli({stderr: stderr.writer, stdout: stdout.writer})
        .run(["build", "--check", "--ndjson", "--project", manifestPath])
      const records = stdout.read().trim().split("\n").map(line => JSON.parse(line))
      const checked = records.find(({state}) => state == "target-checked")

      expect(status).toEqual(0)
      expect(stderr.read()).toEqual("")
      expect(records.map(({state}) => state)).toEqual([
        "project-loaded", "snapshot-loaded", "target-generated", "target-checked", "succeeded"
      ])
      expect(checked).toMatchObject({
        argv: ["-d"],
        exitCode: 0,
        language: "java",
        signal: null,
        stage: "compile",
        stderr: "",
        target: "java-main",
        tool: {id: "javac"}
      })
      expect(checked.argv.length).toEqual(3)
      expect(typeof checked.durationMs).toEqual("number")
      expect(records.at(-1)).toMatchObject({checked: true, exitCode: 0, terminal: true})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("cancels after javac closes without publishing or reporting success", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await cliFixture("console.log(\"last good\")\n")
    const stdout = outputBuffer()
    const stderr = outputBuffer()

    try {
      const first = await new ProjectBuilder().build(manifestPath, undefined, {check: true})
      const pointerPath = path.join(root, ".semantifold/active-generation.json")
      const javaPath = path.join(first.generation.targets[0].sourcePath, "semantifold/generated/main/Main.java")
      const classPath = path.join(first.generation.targets[0].buildPath, "semantifold/generated/main/Main.class")
      const oldPointer = await readFile(pointerPath)
      const oldJava = await readFile(javaPath)
      const oldClass = await readFile(classPath)
      const builder = new ProjectBuilder()
      let checkClosed = 0
      let signalHandled = false

      observeProjectBuild(builder, operation => {
        if (operation != "check:java-main:compile") return
        checkClosed += 1
        signalHandled = process.emit("SIGTERM")
      })
      await writeFile(path.join(root, "src/main.js"), "console.log(\"must-not-execute\")\n")
      const status = await new SemantifoldCli({builder, stderr: stderr.writer, stdout: stdout.writer})
        .run(["build", "--check", "--ndjson", "--project", manifestPath])
      const records = stdout.read().trim().split("\n").map(line => JSON.parse(line))

      expect(checkClosed).toEqual(1)
      expect(signalHandled).toBeTrue()
      expect(status).toEqual(1)
      expect(stderr.read()).toEqual("")
      expect(records.map(({state}) => state)).toEqual([
        "project-loaded", "snapshot-loaded", "target-generated", "target-checked", "failed"
      ])
      expect(records.filter(({terminal}) => terminal === true)).toHaveLength(1)
      expect(records.at(-1)).toMatchObject({
        diagnostic: {code: "PUBLICATION_CANCELLED"},
        exitCode: 1,
        state: "failed",
        terminal: true
      })
      expect(stdout.read()).not.toContain("must-not-execute")
      assert.deepEqual(await readFile(pointerPath), oldPointer)
      assert.deepEqual(await readFile(javaPath), oldJava)
      assert.deepEqual(await readFile(classPath), oldClass)
      expect(await readdir(path.join(root, ".semantifold/generations"))).toEqual([first.generationId])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("retains nested compiler output and process context in human and NDJSON failures", () => {
    const compiler = new SemantifoldDiagnostic({
      code: "TARGET_CHECK_NONZERO_EXIT",
      durationMs: 12,
      executable: "/canonical/javac",
      exitCode: 1,
      language: "java",
      message: "Target check stage 'compile' exited nonzero.",
      projectId: "report-project",
      stage: "compile",
      stderr: "Main.java:1: error: fixture\n",
      stdout: "compiler context\n",
      targetId: "java-main",
      toolId: "javac",
      version: "javac 25.0.4"
    })
    const publication = new SemantifoldDiagnostic({
      cause: compiler,
      code: "PUBLICATION_VALIDATION_FAILED",
      language: "report-project",
      message: "Validator 0 failed for target 'java-main'."
    })
    const ndjson = outputBuffer()
    const human = outputBuffer()

    new ProjectBuildReporter({format: "ndjson", stdout: ndjson.writer}).failed(publication)
    new ProjectBuildReporter({format: "human", stderr: human.writer}).failed(publication)
    const record = JSON.parse(ndjson.read())

    expect(record.diagnostic).toMatchObject({
      cause: {
        code: "TARGET_CHECK_NONZERO_EXIT",
        durationMs: 12,
        executable: "/canonical/javac",
        exitCode: 1,
        projectId: "report-project",
        stage: "compile",
        stderr: "Main.java:1: error: fixture\n",
        stdout: "compiler context\n",
        targetId: "java-main",
        toolId: "javac",
        version: "javac 25.0.4"
      },
      code: "PUBLICATION_VALIDATION_FAILED"
    })
    expect(human.read()).toContain(
      "Check failure: project='report-project' target='java-main' language='java' tool='javac' " +
      "executable='/canonical/javac' version='javac 25.0.4' stage='compile' exitCode=1 signal=none durationMs=12\n"
    )
    expect(human.read()).toContain("stdout:\ncompiler context\n")
    expect(human.read()).toContain("stderr:\nMain.java:1: error: fixture\n")
    expect(human.read()).not.toContain("Caused by:")
  })

  it("renders actionable nested tool-discovery diagnostics in human failures", () => {
    const diagnostics = [
      new SemantifoldDiagnostic({
        code: "TOOL_NOT_FOUND",
        command: "javac",
        language: "javac",
        message: "Canonical command 'javac' was not found as an executable on PATH."
      }),
      new SemantifoldDiagnostic({
        code: "TOOL_AMBIGUOUS",
        command: "javac",
        language: "javac",
        message: "Canonical command 'javac' resolves to multiple executables: /tools/one/javac, /tools/two/javac."
      }),
      new SemantifoldDiagnostic({
        code: "TOOL_UNSUPPORTED_VERSION",
        command: "javac",
        executable: "/tools/old/javac",
        language: "javac",
        message: "Executable '/tools/old/javac' reported unsupported version 'javac 16.0.2'.",
        version: "javac 16.0.2"
      })
    ]

    for (const diagnostic of diagnostics) {
      const publication = new SemantifoldDiagnostic({
        cause: diagnostic,
        code: "PUBLICATION_VALIDATION_FAILED",
        language: "report-project",
        message: "Validator 0 failed for target 'java-main'."
      })
      const human = outputBuffer()

      new ProjectBuildReporter({format: "human", stderr: human.writer}).failed(publication)
      const output = human.read()

      expect(output.match(/Build failed:/gu)).toHaveLength(1)
      expect(output).toContain(
        "Build failed: [PUBLICATION_VALIDATION_FAILED] report-project: Validator 0 failed for target 'java-main'.\n"
      )
      expect(output).toContain(`Caused by: ${diagnostic.message}\n`)
      expect(output).not.toContain("Check failure:")
      expect(output).not.toContain("stdout:\n")
      expect(output).not.toContain("stderr:\n")
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
