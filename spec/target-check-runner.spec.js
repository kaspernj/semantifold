// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@velocious/testing"
import {createGeneratedArtifactSet, createTargetCheckPlan, SemantifoldDiagnostic, TargetCheckRunner} from "../index.js"
import {createExecuteFileWithDeadline} from "../src/subprocess.js"
import {createTargetCheckRunner} from "../src/target-check.js"

const lateOutputFixture = fileURLToPath(new URL("fixtures/late-output.js", import.meta.url))
const synthetic = Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: "runner fixture", relatedOrigins: Object.freeze([])})

/**
 * Creates an executable fixture.
 * @param {string} directory - Fixture root.
 * @param {string} name - Executable basename.
 * @param {string} source - Shell source.
 * @returns {Promise<string>} Absolute executable path.
 */
async function executable(directory, name, source) {
  const filename = path.join(directory, name)

  await writeFile(filename, source)
  await chmod(filename, 0o700)

  return filename
}

/**
 * Creates one staged Java plan using a caller-owned executable as javac.
 * @param {string} root - Fixture root.
 * @param {string} toolPath - Exact fake compiler executable.
 * @returns {Promise<import("../src/semantic/types.js").TargetCheckPlan>}
 */
async function planFor(root, toolPath) {
  const sourcePath = path.join(root, "source")
  const buildPath = path.join(root, "build")
  const artifacts = createGeneratedArtifactSet({
    artifacts: [{
      content: "public final class Main {}\n",
      contentKind: "text",
      mediaType: "text/x-java-source",
      ownership: "generated",
      path: "Main.java",
      provenance: synthetic,
      role: "entry"
    }],
    target: "java"
  })

  await mkdir(sourcePath, {recursive: true})
  await mkdir(buildPath, {recursive: true})
  await writeFile(path.join(sourcePath, "Main.java"), "public final class Main {}\n")

  return createTargetCheckPlan({
    artifacts,
    buildPath,
    projectId: "runner-project",
    sourcePath,
    targetId: "java-main",
    tools: [Object.freeze({
      command: "javac",
      executable: toolPath,
      id: "javac",
      source: /** @type {const} */ ("override"),
      version: "javac fixture",
      versionArguments: Object.freeze(["-version"]),
      versionOutput: "javac fixture"
    })]
  })
}

/** @param {unknown} error @param {string} code */
function checkFailure(error, code) {
  return error instanceof SemantifoldDiagnostic && error.code == code && error.stage == "compile" &&
    error.executable != undefined && error.version == "javac fixture"
}

describe("target check process lifecycle", () => {
  it("reports OS launch failure and nonzero close with bounded exact compiler evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task040-runner-failure-"))

    try {
      const missingPlan = await planFor(path.join(root, "missing-plan"), path.join(root, "missing-javac"))

      await assert.rejects(new TargetCheckRunner().run(missingPlan), error =>
        checkFailure(error, "TARGET_CHECK_LAUNCH_FAILURE") && error.cause instanceof Error &&
        "code" in error.cause && error.cause.code == "ENOENT")
      const failing = await executable(root, "failing-javac", "#!/bin/sh\nprintf 'compiler stdout\\n'\nprintf 'compiler stderr\\n' >&2\nexit 7\n")
      const failingPlan = await planFor(path.join(root, "failing-plan"), failing)

      await assert.rejects(new TargetCheckRunner().run(failingPlan), error =>
        checkFailure(error, "TARGET_CHECK_NONZERO_EXIT") && error.exitCode == 7 && error.signal == undefined &&
        error.stdout == "compiler stdout\n" && error.stderr == "compiler stderr\n")
      const noisy = await executable(root, "noisy-javac", "#!/bin/sh\nhead -c 1048577 /dev/zero\n")
      const noisyPlan = await planFor(path.join(root, "noisy-plan"), noisy)

      await assert.rejects(new TargetCheckRunner().run(noisyPlan), error =>
        checkFailure(error, "TARGET_CHECK_OUTPUT_LIMIT") && error.stdout.length == 1024 * 1024)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("distinguishes timeout, cancellation, and child signal while settling after close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task040-runner-stop-"))

    try {
      const resistant = await executable(root, "resistant-javac", `#!/bin/sh
trap 'printf "late termination\\n" >&2; exit 0' TERM
printf 'ready %s\\n' "$$"
while :; do :; done
`)
      const timeoutPlan = await planFor(path.join(root, "timeout-plan"), resistant)
      const timeoutExecute = createExecuteFileWithDeadline({
        registerSpawnListener(child, listener) {
          assert.ok(child.stdout)
          child.stdout.once("data", listener)
        }
      })
      const timeoutRunner = createTargetCheckRunner({execute: timeoutExecute, now: () => 0})

      await assert.rejects(timeoutRunner.run(timeoutPlan, {timeoutMs: 50}), error =>
        checkFailure(error, "TARGET_CHECK_TIMEOUT") && error.stdout.startsWith("ready ") &&
        error.stderr == "late termination\n" && error.exitCode == 0 && error.signal == undefined)

      const controller = new AbortController()
      const cancelExecute = createExecuteFileWithDeadline({
        registerSpawnListener(child, listener) {
          assert.ok(child.stdout)
          child.stdout.once("data", () => {
            listener()
            controller.abort("focused cancellation")
          })
        }
      })
      const cancellationRunner = createTargetCheckRunner({execute: cancelExecute, now: () => 0})
      const cancelPlan = await planFor(path.join(root, "cancel-plan"), resistant)

      await assert.rejects(cancellationRunner.run(cancelPlan, {signal: controller.signal, timeoutMs: 10_000}), error =>
        checkFailure(error, "TARGET_CHECK_CANCELLED") && error.stdout.startsWith("ready ") &&
        error.stderr == "late termination\n" && error.exitCode == 0 && error.signal == undefined)

      const noisyController = new AbortController()
      const noisyShutdown = await executable(root, "noisy-shutdown-javac", `#!/bin/sh
trap 'head -c 1048577 /dev/zero; exit 0' TERM
printf 'ready %s\n' "$$"
while :; do :; done
`)
      const noisyCancelExecute = createExecuteFileWithDeadline({
        registerSpawnListener(child, listener) {
          assert.ok(child.stdout)
          child.stdout.once("data", () => {
            listener()
            noisyController.abort("first failure must remain cancellation")
          })
        }
      })
      const noisyCancellationRunner = createTargetCheckRunner({execute: noisyCancelExecute, now: () => 0})
      const noisyCancelPlan = await planFor(path.join(root, "noisy-cancel-plan"), noisyShutdown)

      await assert.rejects(noisyCancellationRunner.run(noisyCancelPlan, {
        signal: noisyController.signal,
        timeoutMs: 10_000
      }), error => checkFailure(error, "TARGET_CHECK_CANCELLED"))

      const signaled = await executable(root, "signaled-javac", "#!/bin/sh\nprintf 'before signal\\n'\nkill -TERM $$\n")
      const signalPlan = await planFor(path.join(root, "signal-plan"), signaled)

      await assert.rejects(new TargetCheckRunner().run(signalPlan), error =>
        checkFailure(error, "TARGET_CHECK_SIGNAL") && error.stdout == "before signal\n" && error.signal == "SIGTERM")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("retains inherited-pipe output and reports success only after child close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task040-runner-close-"))

    try {
      const plan = await planFor(root, process.execPath)
      const stage = plan.stages[0]
      const fixturePlan = Object.freeze({...plan, stages: Object.freeze([Object.freeze({
        ...stage,
        argv: Object.freeze([lateOutputFixture]),
        pathArguments: Object.freeze([Object.freeze({index: 0, ownership: /** @type {const} */ ("source")})])
      })])})
      const sourceFixture = path.join(plan.sourcePath, path.basename(lateOutputFixture))

      await writeFile(sourceFixture, await import("node:fs/promises").then(({readFile}) => readFile(lateOutputFixture)))
      const validFixturePlan = Object.freeze({
        ...fixturePlan,
        artifactPaths: Object.freeze([sourceFixture]),
        stages: Object.freeze([Object.freeze({
          ...fixturePlan.stages[0],
          argv: Object.freeze([sourceFixture])
        })])
      })
      const result = await new TargetCheckRunner().run(/** @type {import("../src/semantic/types.js").TargetCheckPlan} */ (validFixturePlan))

      expect(result.stages[0].exitCode).toEqual(0)
      expect(result.stages[0].signal).toEqual(null)
      expect(result.stages[0].stdout).toEqual("parent stdout\nlate stdout\n")
      expect(result.stages[0].stderr).toEqual("parent stderr\nlate stderr\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
