// @ts-check

import assert from "node:assert/strict"
import {watch as watchFileSystem} from "node:fs"
import {chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  ProjectBuilder,
  ProjectWatchCoordinator,
  ProjectWatchReporter
} from "../index.js"
import {createProjectWatchCoordinator, observeProjectWatch} from "../src/project-watch.js"
import {createTargetCheckRunner} from "../src/target-check.js"
import {executeFileWithDeadline} from "../src/subprocess.js"

const sourceA = "console.log(\"A\")\n"
const sourceB = "console.log(\"B\")\n"
const sourceC = "console.log(\"C\")\n"

/**
 * Creates one watchable JavaScript/JSDoc-to-Java project.
 * @returns {Promise<{manifestPath: string, root: string, sourcePath: string}>} Fixture paths.
 */
async function watchFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task043-watch-"))
  const manifestPath = path.join(root, "semantifold.json")
  const sourcePath = path.join(root, "src/main.js")

  await mkdir(path.dirname(sourcePath))
  await writeFile(sourcePath, sourceA)
  await writeFile(manifestPath, `${JSON.stringify({
    id: "watch-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}],
    targets: [{
      buildProjection: "targets/java/classes",
      id: "java-main",
      language: "java",
      role: "text",
      sourceProjection: "targets/java/source"
    }],
    version: 1
  }, null, 2)}\n`)

  return {manifestPath, root, sourcePath}
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

/**
 * Creates a marker queue without timer-based test synchronization.
 * @param {ProjectWatchCoordinator} coordinator - Coordinator under observation.
 * @returns {{next: (predicate: (event: import("../src/project-watch.js").ProjectWatchObservation) => boolean) => Promise<import("../src/project-watch.js").ProjectWatchObservation>}} Marker reader.
 */
function watchEvents(coordinator) {
  /** @type {import("../src/project-watch.js").ProjectWatchObservation[]} */
  const queued = []
  /** @type {{predicate: (event: import("../src/project-watch.js").ProjectWatchObservation) => boolean, resolve: (event: import("../src/project-watch.js").ProjectWatchObservation) => void}[]} */
  const pending = []

  observeProjectWatch(coordinator, event => {
    const index = pending.findIndex(({predicate}) => predicate(event))

    if (index == -1) queued.push(event)
    else pending.splice(index, 1)[0].resolve(event)
  })

  return {
    next(predicate) {
      const index = queued.findIndex(predicate)

      if (index != -1) return Promise.resolve(/** @type {import("../src/project-watch.js").ProjectWatchObservation} */ (queued.splice(index, 1)[0]))

      return new Promise(resolve => pending.push({predicate, resolve}))
    }
  }
}

/**
 * Reads generated Java through the sole active pointer.
 * @param {string} root - Project root.
 * @returns {Promise<{generationId: string, source: string}>} Active identity and Java source.
 */
async function activeJava(root) {
  const pointer = JSON.parse(await readFile(path.join(root, ".semantifold/active-generation.json"), "utf8"))
  const sourcePath = path.join(root, ".semantifold/generations", pointer.generationId,
    "targets/java/source/semantifold/generated/main/Main.java")

  return {generationId: pointer.generationId, source: await readFile(sourcePath, "utf8")}
}

/**
 * Creates a fake compile runner whose selected invocation waits for an explicit marker release.
 * @param {number} blockedInvocation - One-based invocation to gate.
 * @returns {{builder: ProjectBuilder, release: () => void, started: Promise<void>, counts: () => {active: number, maximum: number}}} Controlled builder.
 */
function controlledBuilder(blockedInvocation) {
  let active = 0
  let maximum = 0
  let invocation = 0
  let releaseGate = () => {}
  let markStarted = () => {}
  const started = new Promise(resolve => {
    markStarted = resolve
  })
  const gate = new Promise(resolve => {
    releaseGate = resolve
  })
  const runner = createTargetCheckRunner({
    async execute(request) {
      invocation += 1
      active += 1
      maximum = Math.max(maximum, active)
      try {
        if (invocation == blockedInvocation) {
          markStarted()
          await gate
        }
        const buildPath = request.arguments[1]

        await mkdir(buildPath, {recursive: true})
        await writeFile(path.join(buildPath, "Main.class"), `fixture-${invocation}\n`)

        return {stderr: "", stdout: ""}
      } finally {
        active -= 1
      }
    },
    now: () => invocation
  })

  return {
    builder: new ProjectBuilder({checkRunner: runner}),
    counts: () => ({active, maximum}),
    release: releaseGate,
    started
  }
}

describe("Semantifold deterministic project watch coordinator", () => {
  it("coalesces real file hints, suppresses no-op touches, and recovers through replace/delete/recreate", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root, sourcePath} = await watchFixture()
    const stdout = outputBuffer()
    const coordinator = new ProjectWatchCoordinator({pollIntervalMs: 40, quietPeriodMs: 20})
    const events = watchEvents(coordinator)
    const reporter = new ProjectWatchReporter({format: "ndjson", stdout: stdout.writer})
    const running = coordinator.run(manifestPath, reporter)

    try {
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      const first = await activeJava(root)

      expect(first.source).toContain("\"A\"")
      await utimes(sourcePath, new Date(), new Date())
      await events.next(event => event.type == "reconciled" && event.status == "unchanged")

      await writeFile(sourcePath, sourceB)
      await writeFile(sourcePath, sourceC)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "succeeded")
      const burst = await activeJava(root)

      expect(burst.source).toContain("\"C\"")
      const replacement = path.join(root, "src/replacement.js")

      await writeFile(replacement, sourceB)
      await rename(replacement, sourcePath)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 3 && event.status == "succeeded")
      expect((await activeJava(root)).source).toContain("\"B\"")

      const beforeFailure = await readFile(path.join(root, ".semantifold/active-generation.json"))

      await rm(sourcePath)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 4 && event.status == "failed")
      assert.deepEqual(await readFile(path.join(root, ".semantifold/active-generation.json")), beforeFailure)
      await writeFile(sourcePath, sourceB)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 5 && event.status == "recovered")
      expect((await activeJava(root)).source).toContain("\"B\"")

      await coordinator.stop("test complete")
      expect((await running).status).toEqual("stopped")
      const records = stdout.read().trim().split("\n").map(line => JSON.parse(line))
      const cycleTerminals = records.filter(({terminal, terminalScope}) => terminal === true && terminalScope == "cycle")
      const watcherTerminals = records.filter(({terminal, terminalScope}) => terminal === true && terminalScope == "watch")

      expect(cycleTerminals.map(({cycle, state}) => [cycle, state])).toEqual([
        [1, "cycle-succeeded"],
        [2, "cycle-succeeded"],
        [3, "cycle-succeeded"],
        [4, "cycle-failed"],
        [5, "cycle-recovered"]
      ])
      expect(watcherTerminals).toHaveLength(1)
      expect(watcherTerminals[0]).toMatchObject({state: "watch-stopped"})
    } finally {
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

  it("lets an active checker close, refuses its stale candidate, and runs one latest-state follow-up", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root, sourcePath} = await watchFixture()
    const controlled = controlledBuilder(2)
    const coordinator = new ProjectWatchCoordinator({builder: controlled.builder, pollIntervalMs: 40, quietPeriodMs: 20})
    const events = watchEvents(coordinator)
    const running = coordinator.run(manifestPath, new ProjectWatchReporter({format: "ndjson", stdout: outputBuffer().writer}), {check: true})

    try {
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      const first = await activeJava(root)

      await writeFile(sourcePath, sourceB)
      await controlled.started
      await writeFile(sourcePath, sourceC)
      await events.next(event => event.type == "dirty" && event.cycle == 2)
      controlled.release()
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "superseded")
      assert.deepEqual((await activeJava(root)).generationId, first.generationId)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 3 && event.status == "succeeded")
      const latest = await activeJava(root)

      expect(latest.generationId == first.generationId).toBeFalse()
      expect(latest.source).toContain("\"C\"")
      expect(controlled.counts()).toEqual({active: 0, maximum: 1})
    } finally {
      controlled.release()
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

  it("retains the last-good pointer across a checked-cycle failure and reports later recovery", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root, sourcePath} = await watchFixture()
    let invocation = 0
    const runner = createTargetCheckRunner({
      async execute(request) {
        invocation += 1
        if (invocation == 2) {
          throw Object.assign(new Error("fixture compiler failure"), {
            code: 1,
            stderr: "Main.java:1: error: fixture\n",
            stdout: ""
          })
        }
        const buildPath = request.arguments[1]

        await mkdir(buildPath, {recursive: true})
        await writeFile(path.join(buildPath, "Main.class"), `fixture-${invocation}\n`)

        return {stderr: "", stdout: ""}
      },
      now: () => invocation
    })
    const coordinator = new ProjectWatchCoordinator({
      builder: new ProjectBuilder({checkRunner: runner}),
      pollIntervalMs: 40,
      quietPeriodMs: 20
    })
    const events = watchEvents(coordinator)
    const running = coordinator.run(manifestPath,
      new ProjectWatchReporter({format: "ndjson", stdout: outputBuffer().writer}), {check: true})

    try {
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      const firstPointer = await readFile(path.join(root, ".semantifold/active-generation.json"))

      await writeFile(sourcePath, sourceB)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "failed")
      assert.deepEqual(await readFile(path.join(root, ".semantifold/active-generation.json")), firstPointer)
      await writeFile(sourcePath, sourceC)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 3 && event.status == "recovered")
      expect((await activeJava(root)).source).toContain("\"C\"")
    } finally {
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

  it("fails startup before subscribing when source and publication ownership overlap", async () => {
    const {manifestPath, root} = await watchFixture()
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))

    manifest.publicationRoot = "src"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const output = outputBuffer()
    const coordinator = new ProjectWatchCoordinator()

    try {
      const result = await coordinator.run(manifestPath, new ProjectWatchReporter({format: "ndjson", stdout: output.writer}))
      const records = output.read().trim().split("\n").map(line => JSON.parse(line))

      expect(result).toMatchObject({cycles: 0, status: "failed"})
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        diagnostic: {code: "PROJECT_SOURCE_PUBLICATION_OVERLAP"},
        state: "watch-failed",
        terminal: true,
        terminalScope: "watch"
      })
    } finally {
      await coordinator.stop("fixture cleanup")
      await rm(root, {force: true, recursive: true})
    }
  })

  it("falls back from native events and cancels one real owned child through close on SIGINT", {timeoutMs: 30_000}, async () => {
    const fallbackFixture = await watchFixture()
    const fallback = createProjectWatchCoordinator({
      nativeWatch() {
        throw Object.assign(new Error("fixture native watch failure"), {code: "ENOSPC"})
      },
      pollIntervalMs: 20,
      quietPeriodMs: 10
    })
    const fallbackEvents = watchEvents(fallback)
    const fallbackRun = fallback.run(fallbackFixture.manifestPath, new ProjectWatchReporter({format: "ndjson", stdout: outputBuffer().writer}))

    try {
      await fallbackEvents.next(event => event.type == "watch-backend" && event.status == "polling")
      await fallbackEvents.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      await writeFile(fallbackFixture.sourcePath, sourceB)
      await fallbackEvents.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "succeeded")
      expect((await activeJava(fallbackFixture.root)).source).toContain("\"B\"")
    } finally {
      await fallback.stop("fallback complete")
      await fallbackRun
      await rm(fallbackFixture.root, {force: true, recursive: true})
    }

    const childFixture = await watchFixture()
    const childScript = path.join(childFixture.root, "blocking-check.mjs")
    const childMarker = path.join(childFixture.root, "child-started.json")

    await writeFile(childScript, `#!/usr/bin/env node
import {writeFileSync} from "node:fs"
process.on("SIGTERM", () => process.stdout.write("late shutdown output\\n"))
writeFileSync(${JSON.stringify(childMarker)}, JSON.stringify({pid: process.pid}) + "\\n")
setInterval(() => {}, 1000)
`)
    await chmod(childScript, 0o755)
    /** @type {import("node:fs").FSWatcher | undefined} */
    let markerWatcher
    const childStartedPromise = new Promise((resolve, reject) => {
      markerWatcher = watchFileSystem(childFixture.root, (_, filename) => {
        if (filename != path.basename(childMarker)) return
        markerWatcher?.close()
        resolve(undefined)
      })
      markerWatcher.once("error", reject)
    })
    const runner = createTargetCheckRunner({
      async execute(request) {
        return executeFileWithDeadline({
          ...request,
          arguments: [childScript],
          executable: process.execPath
        })
      },
      now: () => performance.now()
    })
    const childCoordinator = new ProjectWatchCoordinator({builder: new ProjectBuilder({checkRunner: runner})})
    const childEvents = watchEvents(childCoordinator)
    const childOutput = outputBuffer()
    const childRun = childCoordinator.run(childFixture.manifestPath,
      new ProjectWatchReporter({format: "ndjson", stdout: childOutput.writer}), {check: true})

    try {
      await childStartedPromise
      expect(process.emit("SIGINT")).toBeTrue()
      expect((await childRun).status).toEqual("stopped")
      await childEvents.next(event => event.type == "stopped")
      const {pid} = JSON.parse(await readFile(childMarker, "utf8"))

      assert.throws(() => process.kill(pid, 0), error => error instanceof Error && "code" in error && error.code == "ESRCH")
      expect(await readdir(path.join(childFixture.root, ".semantifold/generations"))).toEqual([])
      const records = childOutput.read().trim().split("\n").map(line => JSON.parse(line))

      expect(records.filter(({terminalScope}) => terminalScope == "cycle")).toHaveLength(1)
      expect(records.filter(({terminalScope}) => terminalScope == "watch")).toHaveLength(1)
      expect(records.at(-1)).toMatchObject({state: "watch-stopped", terminal: true, terminalScope: "watch"})
    } finally {
      markerWatcher?.close()
      await childCoordinator.stop("fixture cleanup")
      await childRun
      await rm(childFixture.root, {force: true, recursive: true})
    }
  })
})
