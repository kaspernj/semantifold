// @ts-check

import {watch as watchFileSystem} from "node:fs"
import {lstat} from "node:fs/promises"
import path from "node:path"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {buildWatchedProject, ProjectBuilder} from "./project-build.js"
import {ProjectManifestLoader, SemantifoldProject} from "./project-manifest.js"
import {ProjectSnapshot, ProjectSnapshotBuilder} from "./project-snapshot.js"
import {ProjectWatchReporter} from "./project-watch-reporter.js"

const defaultQuietPeriodMs = 50
const defaultPollIntervalMs = 1000
const maximumQuietPeriodMs = 10_000
const maximumPollIntervalMs = 60_000
/** @type {WeakMap<ProjectWatchCoordinator, (event: ProjectWatchObservation) => void>} */
const projectWatchObservers = new WeakMap()
/** @type {WeakMap<ProjectWatchCoordinator, typeof watchFileSystem>} */
const projectWatchNativeBackends = new WeakMap()
/** @type {WeakMap<ProjectWatchCoordinator, ProjectWatchStateReader>} */
const projectWatchStateReaders = new WeakMap()

/**
 * Installs a synchronous lifecycle observer for focused coordination specs.
 * This helper is intentionally not part of the package root API.
 * @param {ProjectWatchCoordinator} coordinator - Coordinator instance.
 * @param {(event: ProjectWatchObservation) => void} observer - Marker observer.
 * @returns {void}
 */
export function observeProjectWatch(coordinator, observer) {
  if (!(coordinator instanceof ProjectWatchCoordinator) || typeof observer != "function") {
    throw new TypeError("Invalid project watch observer.")
  }
  projectWatchObservers.set(coordinator, observer)
}

/**
 * Creates a coordinator with one instance-owned native event backend for focused fallback specs.
 * This helper is intentionally not part of the package root API.
 * @param {{builder?: ProjectBuilder, manifestLoader?: ProjectManifestLoader, nativeWatch: typeof watchFileSystem, pollIntervalMs?: number, quietPeriodMs?: number, snapshotBuilder?: ProjectSnapshotBuilder, watchStateReader?: ProjectWatchStateReader}} options - Coordinator options and backends.
 * @returns {ProjectWatchCoordinator} Configured coordinator.
 */
export function createProjectWatchCoordinator(options) {
  if (!isPlainObject(options) || typeof options.nativeWatch != "function" ||
    options.watchStateReader !== undefined && typeof options.watchStateReader != "function") {
    throw new TypeError("Invalid project watch coordinator dependencies.")
  }
  const coordinator = new ProjectWatchCoordinator({
    ...(options.builder === undefined ? {} : {builder: options.builder}),
    ...(options.manifestLoader === undefined ? {} : {manifestLoader: options.manifestLoader}),
    ...(options.pollIntervalMs === undefined ? {} : {pollIntervalMs: options.pollIntervalMs}),
    ...(options.quietPeriodMs === undefined ? {} : {quietPeriodMs: options.quietPeriodMs}),
    ...(options.snapshotBuilder === undefined ? {} : {snapshotBuilder: options.snapshotBuilder})
  })

  projectWatchNativeBackends.set(coordinator, options.nativeWatch)
  if (options.watchStateReader !== undefined) projectWatchStateReaders.set(coordinator, options.watchStateReader)

  return coordinator
}

/**
 * Turns filesystem hints into serialized complete project build transactions.
 */
export class ProjectWatchCoordinator {
  /** @type {ProjectBuilder} */
  #builder
  /** @type {ProjectManifestLoader} */
  #manifestLoader
  /** @type {ProjectSnapshotBuilder} */
  #snapshotBuilder
  #quietPeriodMs
  #pollIntervalMs
  /** @type {ProjectWatchReporter | undefined} */
  #reporter
  /** @type {string | undefined} */
  #manifestPath
  /** @type {SemantifoldProject | undefined} */
  #project
  /** @type {string | undefined} */
  #publicationRoot
  /** @type {ProjectSnapshot | undefined} */
  #lastSnapshot
  /** @type {string | undefined} */
  #suppressedHash
  /** @type {string | undefined} */
  #suppressedInvalidState
  /** @type {Map<string, string>} */
  #watchStates = new Map()
  /** @type {Set<string>} */
  #watchedPaths = new Set()
  /** @type {Map<string, string>} */
  #displayPaths = new Map()
  /** @type {import("node:fs").FSWatcher[]} */
  #subscriptions = []
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #quietTimer
  /** @type {ReturnType<typeof setInterval> | undefined} */
  #pollTimer
  #polling = false
  #pollActive = false
  #pollFailed = false
  #cycle = 0
  #hintVersion = 0
  #dirty = false
  #commitWindow = false
  #hadFailure = false
  #running = false
  #stopping = false
  #finished = false
  #initialCycle = true
  #stopReason = "watch stopped"
  /** @type {Set<string>} */
  #hintPaths = new Set()
  /** @type {AbortController | undefined} */
  #activeController
  /** @type {AbortController | undefined} */
  #publicationController
  /** @type {Promise<void> | undefined} */
  #activeCycle
  /** @type {Promise<void> | undefined} */
  #startup
  /** @type {Promise<Readonly<ProjectWatchResult>> | undefined} */
  #completion
  /**
   * Resolves the sole run completion.
   * @type {(result: Readonly<ProjectWatchResult>) => void}
   */
  #resolveCompletion = () => {}
  /** @type {() => void} */
  #signalHandler

  /**
   * Creates one idle coordinator without touching the filesystem.
   * @param {{builder?: ProjectBuilder, manifestLoader?: ProjectManifestLoader, pollIntervalMs?: number, quietPeriodMs?: number, snapshotBuilder?: ProjectSnapshotBuilder}} [options] - Collaborators and bounded timing policy.
   */
  constructor(options = {}) {
    if (!isPlainObject(options) || Object.keys(options).some(key =>
      !["builder", "manifestLoader", "pollIntervalMs", "quietPeriodMs", "snapshotBuilder"].includes(key)) ||
      options.builder !== undefined && !(options.builder instanceof ProjectBuilder) ||
      options.manifestLoader !== undefined && !(options.manifestLoader instanceof ProjectManifestLoader) ||
      options.snapshotBuilder !== undefined && !(options.snapshotBuilder instanceof ProjectSnapshotBuilder)) {
      throw new TypeError("Invalid project watch coordinator options.")
    }
    const quietPeriodMs = options.quietPeriodMs ?? defaultQuietPeriodMs
    const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs

    if (!validMilliseconds(quietPeriodMs, maximumQuietPeriodMs) || !validMilliseconds(pollIntervalMs, maximumPollIntervalMs)) {
      throw new TypeError("Project watch timing values must be bounded positive integer milliseconds.")
    }
    this.#builder = options.builder ?? new ProjectBuilder()
    this.#manifestLoader = options.manifestLoader ?? new ProjectManifestLoader()
    this.#snapshotBuilder = options.snapshotBuilder ?? new ProjectSnapshotBuilder()
    this.#quietPeriodMs = quietPeriodMs
    this.#pollIntervalMs = pollIntervalMs
    this.#signalHandler = () => {
      void this.stop("termination signal")
    }
  }

  /**
   * Starts the initial build and remains active until shutdown or startup failure.
   * @param {string} [projectPath] - Project manifest path.
   * @param {ProjectWatchReporter} [reporter] - Watch protocol reporter.
   * @param {{check?: boolean}} [options] - Whether every cycle runs target-owned checks.
   * @returns {Promise<Readonly<ProjectWatchResult>>} Terminal watcher result.
   */
  run(projectPath = "./semantifold.json", reporter = new ProjectWatchReporter(), options = {}) {
    if (this.#running || this.#completion !== undefined || typeof projectPath != "string" || projectPath.length == 0 ||
      !(reporter instanceof ProjectWatchReporter) || !isPlainObject(options) ||
      Object.keys(options).some(key => key != "check") || options.check !== undefined && typeof options.check != "boolean") {
      throw new TypeError("Invalid or repeated project watch run.")
    }
    this.#running = true
    this.#reporter = reporter
    this.#manifestPath = projectPath
    this.#check = options.check === true
    this.#completion = new Promise(resolve => {
      this.#resolveCompletion = resolve
    })
    process.once("SIGINT", this.#signalHandler)
    process.once("SIGTERM", this.#signalHandler)
    const startup = this.#start(this.#check)

    this.#startup = startup
    const startupSettled = () => {
      if (this.#startup === startup) this.#startup = undefined
      this.#finishStoppedIfIdle()
    }

    void startup.then(startupSettled, startupSettled)

    return this.#completion
  }

  /**
   * Stops admitting work, cancels the exact active operation, and waits through child close and staging cleanup.
   * @param {string} [reason] - Stable shutdown reason.
   * @returns {Promise<Readonly<ProjectWatchResult>>} Terminal watcher result.
   */
  async stop(reason = "shutdown requested") {
    if (typeof reason != "string" || reason.length == 0) throw new TypeError("Project watch stop reason must be non-empty.")
    if (this.#completion === undefined) throw new TypeError("Project watch coordinator has not started.")
    if (!this.#stopping && !this.#finished) {
      this.#stopping = true
      this.#stopReason = reason
      this.#closeEventBackends()
      this.#activeController?.abort(reason)
      this.#publicationController?.abort(reason)
      this.#finishStoppedIfIdle()
    }

    return this.#completion
  }

  /**
   * Establishes the validated graph, event backend, and initial cycle.
   * @param {boolean} check - Cycle check mode.
   * @returns {Promise<void>} Startup completion.
   */
  async #start(check) {
    try {
      const project = await this.#manifestLoader.load(this.#manifestPath)

      if (this.#stopping) return
      const snapshot = await this.#snapshotBuilder.build(project)

      if (this.#stopping) return
      this.#project = project
      this.#lastSnapshot = snapshot
      this.#setWatchTopology(project)
      this.#watchStates = await this.#readWatchStates()
      if (this.#stopping) return
      this.#reporter?.watchStarted(project.id)
      if (this.#stopping) return
      this.#startEventBackend()
      if (this.#stopping) return
      await this.#admitCycle({changedPaths: [], check, project, snapshot})
    } catch (error) {
      if (!this.#stopping) this.#finishFailed(error)
    }
  }

  /**
   * Runs exactly one owned cycle.
   * @param {WatchCycleInput} input - Admitted cycle.
   * @returns {Promise<void>}
   */
  async #admitCycle({changedPaths, check, failure, project, snapshot}) {
    if (this.#activeCycle !== undefined || this.#stopping) return
    this.#cycle += 1
    const cycle = this.#cycle
    const activeController = new AbortController()
    const publicationController = new AbortController()

    this.#activeController = activeController
    this.#publicationController = publicationController
    this.#dirty = false
    this.#commitWindow = false
    this.#hintPaths.clear()
    this.#reporter?.cycleStarted({
      changedPaths,
      cycle,
      projectId: project?.id ?? this.#project?.id ?? "project",
      ...(snapshot === undefined ? {} : {snapshotHash: snapshot.hash})
    })
    this.#observe({cycle, status: "started", type: "cycle-start"})
    let terminalStatus = /** @type {"cancelled" | "failed" | "recovered" | "succeeded" | "superseded"} */ ("failed")
    /** @type {unknown} */
    let terminalFailure
    /** @type {SemantifoldProject | undefined} */
    let currentProject
    /** @type {ProjectSnapshot | undefined} */
    let currentSnapshot
    const manifestPath = /** @type {string} */ (this.#manifestPath)
    const reporter = /** @type {ProjectWatchReporter} */ (this.#reporter)
    const execute = async () => {
      try {
        if (snapshot === undefined) {
          throw failure ?? new SemantifoldDiagnostic({
            code: "WATCH_SNAPSHOT_UNAVAILABLE",
            language: project?.id ?? this.#project?.id ?? "project",
            message: "The complete watched project graph is unavailable."
          })
        }
        const result = await buildWatchedProject(this.#builder, manifestPath, reporter, {
          check,
          expectedSnapshotHash: snapshot.hash,
          publicationSignal: publicationController.signal,
          signal: activeController.signal,
          validateCurrentSnapshot: async () => {
            const guardHintVersion = this.#hintVersion
            /** @type {SemantifoldProject} */
            let reconciledProject
            /** @type {ProjectSnapshot} */
            let reconciledSnapshot

            try {
              reconciledProject = await this.#manifestLoader.load(manifestPath)
              reconciledSnapshot = await this.#snapshotBuilder.build(reconciledProject)
            } catch (error) {
              throw new SemantifoldDiagnostic({
                cause: error instanceof Error ? error : new Error(String(error)),
                code: "WATCH_CANDIDATE_SUPERSEDED",
                language: this.#project?.id ?? "project",
                message: "The watched project graph became unavailable before candidate publication."
              })
            }

            if (snapshot === undefined || reconciledSnapshot.hash != snapshot.hash) {
              throw new SemantifoldDiagnostic({
                code: "WATCH_CANDIDATE_SUPERSEDED",
                language: reconciledProject.id,
                message: "A newer complete project snapshot superseded the completed watch candidate."
              })
            }
            currentProject = reconciledProject
            currentSnapshot = reconciledSnapshot
            this.#commitWindow = true
            if (this.#hintVersion == guardHintVersion) {
              this.#dirty = false
              this.#hintPaths.clear()
            } else {
              this.#dirty = true
              publicationController.abort("A filesystem hint arrived during final snapshot reconciliation.")
            }
          }
        })

        this.#commitWindow = false
        terminalStatus = this.#hadFailure ? "recovered" : "succeeded"
        this.#hadFailure = false
        this.#suppressedHash = result.snapshotHash
        if (currentProject !== undefined && currentSnapshot !== undefined) {
          this.#project = currentProject
          this.#lastSnapshot = currentSnapshot
          this.#setWatchTopology(currentProject)
          const watchStates = await this.#readWatchStates()
          const changedWatchPaths = changedWatchStatePaths(this.#watchStates, watchStates, this.#displayPaths)

          if (changedWatchPaths.length == 0) this.#watchStates = watchStates
          else for (const changedPath of changedWatchPaths) this.#hint(changedPath, check)
        }
        this.#reporter?.cycleSucceeded(result, terminalStatus == "recovered")
      } catch (error) {
        terminalFailure = error
        terminalStatus = this.#stopping ? "cancelled" : supersededFailure(error, this.#dirty) ? "superseded" : "failed"
        if (terminalStatus == "failed") {
          this.#hadFailure = true
          if (snapshot !== undefined) this.#suppressedHash = snapshot.hash
        }
        this.#reporter?.cycleFailed(error, terminalStatus)
      } finally {
        this.#commitWindow = false
      }
    }

    this.#activeCycle = execute()
    await this.#activeCycle
    this.#activeCycle = undefined
    this.#activeController = undefined
    this.#publicationController = undefined
    this.#observe({cycle, status: terminalStatus, type: "cycle-terminal"})
    if (this.#stopping) {
      this.#finishStoppedIfIdle()
      return
    }
    if (this.#initialCycle && terminalStatus == "failed") {
      this.#finishFailed(terminalFailure)
      return
    }
    if (terminalStatus == "succeeded" || terminalStatus == "recovered") this.#initialCycle = false
    if (this.#dirty || terminalStatus == "superseded") {
      queueMicrotask(() => void this.#reconcile(check))
    } else {
      this.#observe({cycle, status: "ready", type: "ready"})
    }
  }

  /**
   * Re-reads the complete graph after a quiet period or active-cycle dirty marker.
   * @param {boolean} check - Cycle check mode.
   * @returns {Promise<void>} Reconciliation completion.
   */
  async #reconcile(check) {
    if (this.#stopping || this.#activeCycle !== undefined) return
    if (this.#quietTimer !== undefined) {
      clearTimeout(this.#quietTimer)
      this.#quietTimer = undefined
    }
    const hinted = [...this.#hintPaths].sort(compareStrings)

    this.#hintPaths.clear()
    this.#dirty = false
    let project
    let snapshot
    let snapshotFailure

    try {
      project = await this.#manifestLoader.load(this.#manifestPath)
      snapshot = await this.#snapshotBuilder.build(project)
      this.#suppressedInvalidState = undefined
      this.#setWatchTopology(project)
      this.#watchStates = await this.#readWatchStates()
    } catch (error) {
      snapshotFailure = error
      try {
        this.#watchStates = await this.#readWatchStates()
      } catch {
        // The build cycle below owns and reports the original complete-graph failure.
      }
      const invalidState = watchStateKey(this.#watchStates)

      if (invalidState == this.#suppressedInvalidState) {
        this.#reporter?.unchanged(hinted)
        this.#observe({status: "unchanged", type: "reconciled"})
        return
      }
      this.#suppressedInvalidState = invalidState
    }
    if (snapshot !== undefined && snapshot.hash == this.#suppressedHash && !this.#hadFailure) {
      this.#reporter?.unchanged(hinted)
      this.#observe({status: "unchanged", type: "reconciled"})
      return
    }
    const changedPaths = snapshot === undefined
      ? hinted
      : changedSnapshotPaths(this.#lastSnapshot, snapshot,
          path.basename(project?.manifestPath ?? this.#manifestPath ?? "semantifold.json"))

    if (snapshot !== undefined) this.#lastSnapshot = snapshot
    await this.#admitCycle({changedPaths, check, failure: snapshotFailure, project, snapshot})
  }

  /**
   * Coalesces one event hint without treating its filename as the build input set.
   * @param {string | undefined} changedPath - Project-relative changed-path hint.
   * @param {boolean} check - Check mode.
   * @returns {void}
   */
  #hint(changedPath, check) {
    if (this.#stopping) return
    this.#hintVersion += 1
    if (changedPath !== undefined) this.#hintPaths.add(changedPath)
    if (this.#activeCycle !== undefined) {
      const wasDirty = this.#dirty

      this.#dirty = true
      if (this.#commitWindow) this.#publicationController?.abort("A filesystem hint reached the active-pointer commit window.")
      if (!wasDirty) this.#observe({cycle: this.#cycle, status: "dirty", type: "dirty"})
      return
    }
    if (this.#quietTimer !== undefined) clearTimeout(this.#quietTimer)
    this.#quietTimer = setTimeout(() => {
      this.#quietTimer = undefined
      void this.#reconcile(check)
    }, this.#quietPeriodMs)
  }

  /**
   * Updates the exact manifest/source watch topology.
   * @param {SemantifoldProject} project - Current valid project.
   * @returns {void}
   */
  #setWatchTopology(project) {
    const watchedPaths = new Set([project.manifestPath, ...project.sources.map(({absolutePath}) => absolutePath)])
    const displayPaths = new Map([[project.manifestPath, path.basename(project.manifestPath)]])

    for (const source of project.sources) displayPaths.set(source.absolutePath, source.path)
    const changed = [...watchedPaths].sort(compareStrings).join("\0") != [...this.#watchedPaths].sort(compareStrings).join("\0")

    this.#watchedPaths = watchedPaths
    this.#displayPaths = displayPaths
    this.#publicationRoot = project.publicationRoot
    if (changed && this.#subscriptions.length > 0 && !this.#polling && !this.#openNativeSubscriptions()) {
      this.#switchToPolling()
    }
  }

  /**
   * Starts native subscriptions or their polling fallback.
   * @returns {void}
   */
  #startEventBackend() {
    if (this.#openNativeSubscriptions()) {
      this.#ensurePollingReconciliation()
      this.#reporter?.watchBackend("native")
      this.#observe({status: "native", type: "watch-backend"})
    } else this.#switchToPolling()
  }

  /**
   * Opens exact file and parent-directory subscriptions.
   * @returns {boolean} Whether native subscriptions opened completely.
   */
  #openNativeSubscriptions() {
    this.#closeSubscriptions()
    const nativeWatch = projectWatchNativeBackends.get(this) ?? watchFileSystem

    try {
      for (const filename of this.#watchedPaths) {
        const subscription = nativeWatch(filename, () => {
          this.#hint(this.#displayPaths.get(filename), this.#currentCheckMode())
        })

        subscription.once("error", () => this.#switchToPolling())
        this.#subscriptions.push(subscription)
      }
      const parents = new Set([...this.#watchedPaths].map(filename => path.dirname(filename)))

      for (const directory of parents) {
        const subscription = nativeWatch(directory, (_, filename) => {
          if (filename == null) {
            this.#hint(undefined, this.#currentCheckMode())
            return
          }
          const absolute = path.join(directory, filename.toString())

          if (this.#publicationRoot !== undefined && pathsOverlap(this.#publicationRoot, absolute)) return
          this.#hint(this.#displayPaths.get(absolute), this.#currentCheckMode())
        })

        subscription.once("error", () => this.#switchToPolling())
        this.#subscriptions.push(subscription)
      }

      return true
    } catch {
      this.#closeSubscriptions()
      return false
    }
  }

  /**
   * Permanently selects bounded polling after native backend failure.
   * @returns {void}
   */
  #switchToPolling() {
    if (this.#stopping || this.#polling) return
    this.#polling = true
    this.#closeSubscriptions()
    this.#ensurePollingReconciliation()
    this.#reporter?.watchBackend("polling")
    this.#observe({status: "polling", type: "watch-backend"})
  }

  /**
   * Compares one bounded polling state observation.
   * @returns {Promise<void>} Poll completion.
   */
  async #poll() {
    if (this.#pollActive || this.#stopping) return
    this.#pollActive = true
    try {
      if (this.#suppressedInvalidState !== undefined) {
        try {
          const project = await this.#manifestLoader.load(this.#manifestPath)

          await this.#snapshotBuilder.build(project)
          if (this.#quietTimer === undefined) this.#hint(undefined, this.#currentCheckMode())
          return
        } catch {
          // An unchanged invalid graph remains one failed cycle until it becomes readable and valid.
        }
      }
      const current = await this.#readWatchStates()
      const changed = changedWatchStatePaths(this.#watchStates, current, this.#displayPaths)

      this.#pollFailed = false
      if (changed.length == 0) return
      this.#watchStates = current
      for (const changedPath of changed) this.#hint(changedPath, this.#currentCheckMode())
    } catch {
      if (!this.#pollFailed) {
        this.#pollFailed = true
        this.#hint(undefined, this.#currentCheckMode())
      }
    } finally {
      this.#pollActive = false
    }
  }

  /**
   * Reads the immutable check mode captured by run.
   * @returns {boolean} Active check mode.
   */
  #currentCheckMode() {
    return this.#check
  }

  /**
   * Reads one detached mutation-sensitive state observation through the selected backend.
   * @returns {Promise<Map<string, string>>} Stable ordered path states.
   */
  #readWatchStates() {
    const reader = projectWatchStateReaders.get(this) ?? readWatchStates

    return reader(new Set(this.#watchedPaths))
  }

  #check = false

  /**
   * Starts one bounded reconciliation interval shared by native and fallback modes.
   * @returns {void}
   */
  #ensurePollingReconciliation() {
    this.#pollTimer ??= setInterval(() => void this.#poll(), this.#pollIntervalMs)
  }

  /**
   * Closes every native subscription.
   * @returns {void}
   */
  #closeSubscriptions() {
    for (const subscription of this.#subscriptions) subscription.close()
    this.#subscriptions = []
  }

  /**
   * Closes subscriptions and pending reconciliation timers.
   * @returns {void}
   */
  #closeEventBackends() {
    if (this.#quietTimer !== undefined) clearTimeout(this.#quietTimer)
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer)
    this.#quietTimer = undefined
    this.#pollTimer = undefined
    this.#closeSubscriptions()
  }

  /**
   * Resolves shutdown only after startup and the active cycle have both relinquished ownership.
   * @returns {void}
   */
  #finishStoppedIfIdle() {
    if (this.#stopping && this.#startup === undefined && this.#activeCycle === undefined) this.#finishStopped()
  }

  /**
   * Emits and resolves one clean watcher terminal.
   * @returns {void}
   */
  #finishStopped() {
    if (this.#finished) return
    this.#finished = true
    this.#running = false
    this.#closeEventBackends()
    this.#removeSignalHandlers()
    this.#reporter?.watchStopped(this.#stopReason)
    const result = Object.freeze({cycles: this.#cycle, reason: this.#stopReason, status: /** @type {const} */ ("stopped")})

    this.#observe({status: "stopped", type: "stopped"})
    this.#resolveCompletion(result)
  }

  /**
   * Emits and resolves one startup-failure watcher terminal.
   * @param {unknown} failure - Startup failure.
   * @returns {void}
   */
  #finishFailed(failure) {
    if (this.#finished) return
    this.#finished = true
    this.#running = false
    this.#closeEventBackends()
    this.#removeSignalHandlers()
    this.#reporter?.watchFailed(failure)
    const result = Object.freeze({cycles: this.#cycle, reason: "startup failure", status: /** @type {const} */ ("failed")})

    this.#observe({status: "failed", type: "stopped"})
    this.#resolveCompletion(result)
  }

  /**
   * Removes process signal handlers owned by this coordinator.
   * @returns {void}
   */
  #removeSignalHandlers() {
    process.removeListener("SIGINT", this.#signalHandler)
    process.removeListener("SIGTERM", this.#signalHandler)
  }

  /**
   * Emits one internal deterministic lifecycle marker.
   * @param {ProjectWatchObservation} event - Marker.
   * @returns {void}
   */
  #observe(event) {
    projectWatchObservers.get(this)?.(Object.freeze(event))
  }
}

/**
 * Reads mutation-sensitive states only as polling/event deduplication hints.
 * Content hashes remain authoritative for cycle admission.
 * @param {Readonly<Set<string>>} filenames - Exact watched graph paths.
 * @returns {Promise<Map<string, string>>} Stable ordered path states.
 */
async function readWatchStates(filenames) {
  const result = new Map()

  for (const filename of [...filenames].sort(compareStrings)) {
    try {
      const status = await lstat(filename, {bigint: true})

      result.set(filename, [status.dev, status.ino, status.mode, status.size, status.mtimeNs, status.ctimeNs].map(String).join(":"))
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) throw error
      result.set(filename, "missing")
    }
  }

  return result
}

/**
 * @typedef {(filenames: Readonly<Set<string>>) => Promise<Map<string, string>>} ProjectWatchStateReader
 */

/**
 * Locates polling changes without treating metadata as build identity.
 * @param {Map<string, string>} previous - Previous states.
 * @param {Map<string, string>} current - Current states.
 * @param {Map<string, string>} displayPaths - Stable project-relative names.
 * @returns {string[]} Changed project paths.
 */
function changedWatchStatePaths(previous, current, displayPaths) {
  const filenames = new Set([...previous.keys(), ...current.keys()])

  return [...filenames].filter(filename => previous.get(filename) != current.get(filename))
    .map(filename => displayPaths.get(filename) ?? path.basename(filename)).sort(compareStrings)
}

/**
 * Serializes one ordered polling state only for repeated-invalid reconciliation suppression.
 * @param {Map<string, string>} states - Current watched path states.
 * @returns {string} Stable state key.
 */
function watchStateKey(states) {
  return JSON.stringify([...states].sort(([left], [right]) => compareStrings(left, right)))
}

/**
 * Checks whether either absolute path contains the other.
 * @param {string} left - First absolute path.
 * @param {string} right - Second absolute path.
 * @returns {boolean} Whether the paths overlap.
 */
function pathsOverlap(left, right) {
  return pathWithin(left, right) || pathWithin(right, left)
}

/**
 * Checks whether one absolute path is a root or descendant of another.
 * @param {string} root - Absolute root.
 * @param {string} candidate - Absolute candidate.
 * @returns {boolean} Whether the candidate belongs to the root.
 */
function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate)

  return relative.length == 0 || relative != ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Computes exact content/config changes between complete immutable snapshots.
 * @param {ProjectSnapshot | undefined} previous - Previous admitted snapshot.
 * @param {ProjectSnapshot} current - Current complete snapshot.
 * @param {string} manifestPath - Project-root-relative manifest display path.
 * @returns {string[]} Stable changed paths.
 */
function changedSnapshotPaths(previous, current, manifestPath) {
  if (previous === undefined) return [manifestPath, ...current.sources.map(({path: sourcePath}) => sourcePath)]
  const changed = new Set()

  if (previous.manifestText != current.manifestText) changed.add(manifestPath)
  const previousSources = new Map(previous.sources.map(source => [source.path, source.source]))
  const currentSources = new Map(current.sources.map(source => [source.path, source.source]))

  for (const sourcePath of new Set([...previousSources.keys(), ...currentSources.keys()])) {
    if (previousSources.get(sourcePath) != currentSources.get(sourcePath)) changed.add(sourcePath)
  }

  return [...changed].sort(compareStrings)
}

/**
 * Recognizes failures caused only by deterministic supersession.
 * @param {unknown} failure - Candidate failure.
 * @param {boolean} dirty - Whether a newer hint exists.
 * @returns {boolean} Whether the cycle was superseded.
 */
function supersededFailure(failure, dirty) {
  let current = failure

  while (current instanceof Error) {
    if ("code" in current && (current.code == "WATCH_CANDIDATE_SUPERSEDED" || current.code == "WATCH_SNAPSHOT_CHANGED" ||
      dirty && current.code == "PUBLICATION_CANCELLED")) return true
    current = current.cause
  }

  return false
}

/**
 * Checks one ordinary object.
 * @param {unknown} value - Candidate.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Checks one bounded positive integer timing value.
 * @param {number} value - Candidate milliseconds.
 * @param {number} maximum - Inclusive maximum.
 * @returns {boolean} Whether the value is valid.
 */
function validMilliseconds(value, maximum) {
  return typeof value == "number" && Number.isInteger(value) && value > 0 && value <= maximum
}

/**
 * Checks a narrowed filesystem error code.
 * @param {unknown} error - Opaque error.
 * @param {string} code - Expected code.
 * @returns {boolean} Whether the code matches.
 */
function isErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code == code
}

/**
 * Compares stable protocol strings.
 * @param {string} left - Left string.
 * @param {string} right - Right string.
 * @returns {number} Sort order.
 */
function compareStrings(left, right) {
  return left.localeCompare(right, "en")
}

/**
 * @typedef ProjectWatchObservation
 * @property {"cycle-start" | "cycle-terminal" | "dirty" | "ready" | "reconciled" | "stopped" | "watch-backend"} type - Marker type.
 * @property {number} [cycle] - Related cycle number.
 * @property {"cancelled" | "dirty" | "failed" | "native" | "polling" | "ready" | "recovered" | "started" | "stopped" | "succeeded" | "superseded" | "unchanged"} status - Marker status.
 */

/**
 * @typedef ProjectWatchResult
 * @property {"failed" | "stopped"} status - Watcher terminal state.
 * @property {number} cycles - Admitted cycle count.
 * @property {string} reason - Stable terminal reason.
 */

/**
 * @typedef WatchCycleInput
 * @property {readonly string[]} changedPaths - Stable changed paths.
 * @property {boolean} check - Whether target checks are enabled.
 * @property {unknown} [failure] - Preserved reconciliation failure.
 * @property {SemantifoldProject | undefined} project - Reconciled project, when valid.
 * @property {ProjectSnapshot | undefined} snapshot - Reconciled snapshot, when valid.
 */
