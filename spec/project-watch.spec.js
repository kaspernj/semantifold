// @ts-check

import assert from "node:assert/strict"
import {watch as watchFileSystem, writeFileSync} from "node:fs"
import {chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  ProjectBuilder,
  ProjectSnapshotBuilder,
  ProjectWatchCoordinator,
  ProjectWatchReporter
} from "../index.js"
import {observeProjectBuild} from "../src/project-build.js"
import {createProjectWatchCoordinator, observeProjectWatch} from "../src/project-watch.js"
import {createTargetCheckRunner} from "../src/target-check.js"
import {executeFileWithDeadline} from "../src/subprocess.js"

const sourceA = "console.log(\"A\")\n"
const sourceB = "console.log(\"B\")\n"
const sourceC = "console.log(\"C\")\n"
const sourceAfterPublication = "console.log(\"changed after publication\")\n"

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
 * @returns {{history: () => readonly import("../src/project-watch.js").ProjectWatchObservation[], next: (predicate: (event: import("../src/project-watch.js").ProjectWatchObservation) => boolean) => Promise<import("../src/project-watch.js").ProjectWatchObservation>}} Marker reader.
 */
function watchEvents(coordinator) {
  /** @type {import("../src/project-watch.js").ProjectWatchObservation[]} */
  const queued = []
  /** @type {import("../src/project-watch.js").ProjectWatchObservation[]} */
  const history = []
  /** @type {{predicate: (event: import("../src/project-watch.js").ProjectWatchObservation) => boolean, resolve: (event: import("../src/project-watch.js").ProjectWatchObservation) => void}[]} */
  const pending = []

  observeProjectWatch(coordinator, event => {
    history.push(event)
    const index = pending.findIndex(({predicate}) => predicate(event))

    if (index == -1) queued.push(event)
    else pending.splice(index, 1)[0].resolve(event)
  })

  return {
    history: () => [...history],
    next(predicate) {
      const index = queued.findIndex(predicate)

      if (index != -1) return Promise.resolve(/** @type {import("../src/project-watch.js").ProjectWatchObservation} */ (queued.splice(index, 1)[0]))

      return new Promise(resolve => pending.push({predicate, resolve}))
    }
  }
}

/**
 * Creates an exact controllable native-watch backend without emitting host filesystem events.
 * @param {() => void} [onOpen] - Called before each subscription attempt.
 * @returns {{activeCount: () => number, emit: (filename: string) => void, fail: () => void, nativeWatch: typeof watchFileSystem, openCount: () => number}} Backend controls.
 */
function controlledNativeBackend(onOpen = () => {}) {
  /** @type {{closed: boolean, filename: string, listener: (eventType: string, filename: string | Buffer | null) => void}[]} */
  const subscriptions = []
  let failing = false
  let opens = 0
  const nativeWatch = /** @type {typeof watchFileSystem} */ (/** @type {unknown} */ ((filename, listener) => {
    opens += 1
    onOpen()
    if (failing) throw Object.assign(new Error("fixture native resubscription failure"), {code: "ENOSPC"})
    const record = {
      closed: false,
      filename: String(filename),
      listener
    }
    const subscription = {
      close() {
        record.closed = true
      },
      once() {
        return subscription
      }
    }

    subscriptions.push(record)

    return subscription
  }))

  return {
    activeCount: () => subscriptions.filter(({closed}) => !closed).length,
    emit(filename) {
      const subscription = subscriptions.find(record => !record.closed && record.filename == filename)

      assert.notEqual(subscription, undefined, `Missing active fixture subscription for '${filename}'.`)
      subscription.listener("change", path.basename(filename))
    },
    fail() {
      failing = true
    },
    nativeWatch,
    openCount: () => opens
  }
}

/**
 * Creates an explicit marker queue for an injected asynchronous collaborator.
 * @returns {{mark: () => void, next: () => Promise<void>}} Marker controls.
 */
function markers() {
  let available = 0
  /** @type {(() => void)[]} */
  const waiting = []

  return {
    mark() {
      const resolve = waiting.shift()

      if (resolve === undefined) available += 1
      else resolve()
    },
    next() {
      if (available > 0) {
        available -= 1
        return Promise.resolve()
      }

      return new Promise(resolve => waiting.push(resolve))
    }
  }
}

/**
 * Replaces only the coordinator's global timer primitives with manually fired callbacks.
 * @returns {{fireIntervals: () => void, fireTimeout: (id: number) => boolean, hasTimeout: (id: number) => boolean, install: () => void, restore: () => void, takeScheduledTimeout: () => number}} Timer controls.
 */
function controlledTimers() {
  const originals = {
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout
  }
  /** @type {Map<number, () => void>} */
  const intervals = new Map()
  /** @type {Map<number, () => void>} */
  const timeouts = new Map()
  /** @type {number[]} */
  const scheduledTimeouts = []
  let identity = 0

  return {
    fireIntervals() {
      for (const callback of intervals.values()) callback()
    },
    fireTimeout(id) {
      const callback = timeouts.get(id)

      if (callback === undefined) return false
      timeouts.delete(id)
      callback()

      return true
    },
    hasTimeout: id => timeouts.has(id),
    install() {
      globalThis.clearInterval = /** @type {typeof clearInterval} */ (/** @type {unknown} */ (id => intervals.delete(Number(id))))
      globalThis.clearTimeout = /** @type {typeof clearTimeout} */ (/** @type {unknown} */ (id => timeouts.delete(Number(id))))
      globalThis.setInterval = /** @type {typeof setInterval} */ (/** @type {unknown} */ (callback => {
        identity += 1
        intervals.set(identity, callback)

        return identity
      }))
      globalThis.setTimeout = /** @type {typeof setTimeout} */ (/** @type {unknown} */ (callback => {
        identity += 1
        timeouts.set(identity, callback)
        scheduledTimeouts.push(identity)

        return identity
      }))
    },
    restore() {
      globalThis.clearInterval = originals.clearInterval
      globalThis.clearTimeout = originals.clearTimeout
      globalThis.setInterval = originals.setInterval
      globalThis.setTimeout = originals.setTimeout
    },
    takeScheduledTimeout() {
      const id = scheduledTimeouts.shift()

      assert.notEqual(id, undefined, "Expected one scheduled fixture timeout.")

      return id
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
  it("keeps the pre-cycle polling baseline when source metadata changes after pointer publication", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root, sourcePath} = await watchFixture()
    const backend = controlledNativeBackend()
    const builder = new ProjectBuilder()
    const coordinator = createProjectWatchCoordinator({
      builder,
      nativeWatch: backend.nativeWatch,
      pollIntervalMs: 60_000,
      quietPeriodMs: 10
    })
    const events = watchEvents(coordinator)
    let changed = false

    observeProjectBuild(builder, operation => {
      if (operation != "publish" || changed) return
      changed = true
      writeFileSync(sourcePath, sourceAfterPublication)
    })
    const running = coordinator.run(manifestPath,
      new ProjectWatchReporter({format: "ndjson", stdout: outputBuffer().writer}))

    try {
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      expect((await activeJava(root)).source).toContain("\"A\"")
      expect(events.history().some(event => event.type == "dirty" && event.cycle == 1)).toBeTrue()
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "succeeded")
      expect((await activeJava(root)).source).toContain("\"changed after publication\"")
    } finally {
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

  it("reports one dirty event when post-publication metadata re-admits a cleared active-cycle hint", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root, sourcePath} = await watchFixture()
    const backend = controlledNativeBackend()
    const controlled = controlledBuilder(1)
    const output = outputBuffer()
    let stateReads = 0
    const coordinator = createProjectWatchCoordinator({
      builder: controlled.builder,
      nativeWatch: backend.nativeWatch,
      pollIntervalMs: 60_000,
      quietPeriodMs: 10,
      async watchStateReader(filenames) {
        stateReads += 1

        return new Map([...filenames].map(filename => [filename,
          filename == sourcePath && stateReads > 1 ? "source-after-touch" : "stable"]))
      }
    })
    const events = watchEvents(coordinator)
    const running = coordinator.run(manifestPath,
      new ProjectWatchReporter({format: "ndjson", stdout: output.writer}), {check: true})

    try {
      await controlled.started
      backend.emit(sourcePath)
      await events.next(event => event.type == "dirty" && event.cycle == 1)
      controlled.release()
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      await events.next(event => event.type == "reconciled" && event.status == "unchanged")
      const records = output.read().trim().split("\n").map(line => JSON.parse(line))

      expect(records.filter(record => record.state == "cycle-dirty" && record.cycle == 1)).toHaveLength(1)
      expect(events.history().filter(event => event.type == "dirty" && event.cycle == 1)).toHaveLength(1)
    } finally {
      controlled.release()
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

  it("awaits a blocked startup state read and never subscribes after terminal shutdown", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await watchFixture()
    let releaseStateRead = () => {}
    const stateReadGate = new Promise(resolve => {
      releaseStateRead = resolve
    })
    let markFirstActivity = (_activity) => {}
    const firstActivity = new Promise(resolve => {
      markFirstActivity = resolve
    })
    const backend = controlledNativeBackend(() => markFirstActivity("native-subscription"))
    const coordinator = createProjectWatchCoordinator({
      nativeWatch: backend.nativeWatch,
      pollIntervalMs: 60_000,
      quietPeriodMs: 10,
      async watchStateReader(filenames) {
        markFirstActivity("state-read")
        await stateReadGate

        return new Map([...filenames].map(filename => [filename, "fixture-state"]))
      }
    })
    const output = outputBuffer()
    const running = coordinator.run(manifestPath, new ProjectWatchReporter({format: "ndjson", stdout: output.writer}))

    try {
      expect(await firstActivity).toEqual("state-read")
      let settled = false
      const stopping = coordinator.stop("startup fixture stop").then(result => {
        settled = true

        return result
      })

      await Promise.resolve()
      expect(settled).toBeFalse()
      releaseStateRead()
      expect(await stopping).toMatchObject({cycles: 0, status: "stopped"})
      expect(await running).toMatchObject({cycles: 0, status: "stopped"})
      expect(backend.openCount()).toEqual(0)
      expect(output.read().trim().split("\n").map(line => JSON.parse(line).state)).toEqual(["watch-stopped"])
    } finally {
      releaseStateRead()
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

  it("keeps one invalid-graph recovery quiet timer when polling is more frequent", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root, sourcePath} = await watchFixture()
    const timers = controlledTimers()
    const backend = controlledNativeBackend()
    const snapshotBuilds = markers()
    let observeSnapshotBuilds = false
    class ObservedSnapshotBuilder extends ProjectSnapshotBuilder {
      async build(project) {
        const snapshot = await super.build(project)

        if (observeSnapshotBuilds) snapshotBuilds.mark()

        return snapshot
      }
    }
    const coordinator = createProjectWatchCoordinator({
      nativeWatch: backend.nativeWatch,
      pollIntervalMs: 1,
      quietPeriodMs: 10,
      snapshotBuilder: new ObservedSnapshotBuilder()
    })
    const events = watchEvents(coordinator)

    timers.install()
    const running = coordinator.run(manifestPath,
      new ProjectWatchReporter({format: "ndjson", stdout: outputBuffer().writer}))
    try {
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      await rm(sourcePath)
      backend.emit(sourcePath)
      expect(timers.fireTimeout(timers.takeScheduledTimeout())).toBeTrue()
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "failed")

      await writeFile(sourcePath, sourceB)
      observeSnapshotBuilds = true
      timers.fireIntervals()
      await snapshotBuilds.next()
      await Promise.resolve()
      const recoveryTimer = timers.takeScheduledTimeout()

      timers.fireIntervals()
      await snapshotBuilds.next()
      await Promise.resolve()
      expect(timers.hasTimeout(recoveryTimer)).toBeTrue()
      expect(timers.fireTimeout(recoveryTimer)).toBeTrue()
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 3 && event.status == "recovered")
      expect((await activeJava(root)).source).toContain("\"B\"")
    } finally {
      try {
        await coordinator.stop("fixture cleanup")
        await running
      } finally {
        timers.restore()
        await rm(root, {force: true, recursive: true})
      }
    }
  })

  it("switches truthfully to polling when a manifest topology resubscription fails", {timeoutMs: 30_000}, async () => {
    const {manifestPath, root} = await watchFixture()
    const replacementPath = path.join(root, "src/replacement-main.js")
    const backend = controlledNativeBackend()
    const coordinator = createProjectWatchCoordinator({
      nativeWatch: backend.nativeWatch,
      pollIntervalMs: 60_000,
      quietPeriodMs: 10
    })
    const events = watchEvents(coordinator)
    const running = coordinator.run(manifestPath,
      new ProjectWatchReporter({format: "ndjson", stdout: outputBuffer().writer}))

    try {
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 1 && event.status == "succeeded")
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"))

      await writeFile(replacementPath, sourceB)
      manifest.sources[0].path = "src/replacement-main.js"
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      backend.fail()
      backend.emit(manifestPath)
      await events.next(event => event.type == "cycle-terminal" && event.cycle == 2 && event.status == "succeeded")
      expect(events.history().filter(event => event.type == "watch-backend").map(({status}) => status)).toEqual([
        "native", "polling"
      ])
      expect(backend.activeCount()).toEqual(0)
      expect((await activeJava(root)).source).toContain("\"B\"")
    } finally {
      await coordinator.stop("fixture cleanup")
      await running
      await rm(root, {force: true, recursive: true})
    }
  })

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
