// @ts-check

import {diagnosticRecord, formatHumanProjectFailure, normalizeDiagnostic} from "./project-reporter.js"

/**
 * Emits long-lived watch state with one terminal record for every admitted cycle and one for the watcher.
 */
export class ProjectWatchReporter {
  /** @type {"human" | "ndjson"} */
  #format
  /** @type {import("./project-reporter.js").WritableOutput} */
  #stdout
  /** @type {import("./project-reporter.js").WritableOutput} */
  #stderr
  /** @type {() => number} */
  #now
  /** @type {string | null} */
  #projectId = null
  /** @type {string | null} */
  #snapshotHash = null
  /** @type {number | null} */
  #cycle = null
  /** @type {readonly string[]} */
  #changedPaths = Object.freeze([])
  #cycleStartedAt = 0
  #watchTerminal = false
  #cycleTerminal = true

  /**
   * Creates a watch reporter.
   * @param {{format?: "human" | "ndjson", now?: () => number, stderr?: import("./project-reporter.js").WritableOutput, stdout?: import("./project-reporter.js").WritableOutput}} [options] - Output mode, clock, and sinks.
   */
  constructor(options = {}) {
    const format = options.format ?? "human"

    if (format != "human" && format != "ndjson" || options.now !== undefined && typeof options.now != "function") {
      throw new TypeError("Invalid project watch reporter options.")
    }
    this.#format = format
    this.#stdout = options.stdout ?? process.stdout
    this.#stderr = options.stderr ?? process.stderr
    this.#now = options.now ?? (() => performance.now())
    if (typeof this.#stdout?.write != "function" || typeof this.#stderr?.write != "function") {
      throw new TypeError("Project watch reporter requires writable output sinks.")
    }
  }

  /**
   * Reports validated watch startup.
   * @param {string} projectId - Stable initial project identity.
   * @returns {void}
   */
  watchStarted(projectId) {
    this.#projectId = projectId
    this.#emit({state: "watch-started"})
  }

  /**
   * Reports the selected event backend.
   * @param {"native" | "polling"} backend - Active event backend.
   * @returns {void}
   */
  watchBackend(backend) {
    this.#emit({backend, state: "watch-backend"})
  }

  /**
   * Begins one admitted build cycle.
   * @param {ProjectWatchCycleContext} cycle - Cycle context.
   * @returns {void}
   */
  cycleStarted(cycle) {
    if (!this.#cycleTerminal || this.#watchTerminal) throw new TypeError("Project watch reporter cycle lifecycle is invalid.")
    this.#cycle = cycle.cycle
    this.#cycleTerminal = false
    this.#changedPaths = Object.freeze([...cycle.changedPaths])
    this.#projectId = cycle.projectId
    this.#snapshotHash = cycle.snapshotHash ?? null
    this.#cycleStartedAt = this.#now()
    this.#emit({changedPaths: this.#changedPaths, ...(cycle.snapshotHash === undefined ? {} : {snapshotHash: cycle.snapshotHash}), state: "cycle-started"})
  }

  /**
   * Reports the cycle's validated project identity.
   * @param {string} projectId - Validated project identity.
   * @returns {void}
   */
  projectLoaded(projectId) {
    this.#projectId = projectId
    this.#emit({state: "project-loaded"})
  }

  /**
   * Reports the cycle's complete source snapshot.
   * @param {string} snapshotHash - Complete source snapshot hash.
   * @returns {void}
   */
  snapshotLoaded(snapshotHash) {
    this.#snapshotHash = snapshotHash
    this.#emit({snapshotHash, state: "snapshot-loaded"})
  }

  /**
   * Reports one generated target.
   * @param {import("./project-build.js").ProjectBuildTargetResult} target - Generated target.
   * @returns {void}
   */
  targetGenerated(target) {
    this.#emit({
      artifactCount: target.artifactCount,
      language: target.language,
      role: target.role,
      state: "target-generated",
      target: target.id
    })
  }

  /**
   * Reports one completed target-check stage.
   * @param {{id: string, language: string, stage: import("./semantic/types.js").TargetCheckStageResult}} checked - Check stage.
   * @returns {void}
   */
  targetChecked(checked) {
    this.#emit({
      argv: checked.stage.argv,
      durationMs: checked.stage.durationMs,
      exitCode: checked.stage.exitCode,
      language: checked.language,
      signal: checked.stage.signal,
      stage: checked.stage.stage,
      state: "target-checked",
      stderr: checked.stage.stderr,
      stdout: checked.stage.stdout,
      target: checked.id,
      tool: checked.stage.tool
    })
  }

  /**
   * Emits one successful or recovered cycle terminal.
   * @param {import("./project-build.js").ProjectBuildSuccess} result - Published result.
   * @param {boolean} recovered - Whether the prior ordinary cycle failed.
   * @returns {void}
   */
  cycleSucceeded(result, recovered) {
    this.#requireCycle()
    this.#cycleTerminal = true
    this.#snapshotHash = result.snapshotHash
    const state = recovered ? "cycle-recovered" : "cycle-succeeded"

    if (this.#format == "human") {
      const verb = recovered ? "recovered" : "succeeded"

      this.#stdout.write(`Watch cycle ${this.#cycle} ${verb}: project '${result.projectId}' published generation '${result.generationId}'.\n`)
      return
    }
    this.#write({
      changedPaths: this.#changedPaths,
      checked: result.checked,
      durationMs: this.#duration(),
      generationId: result.generationId,
      snapshotHash: result.snapshotHash,
      state,
      targets: result.targets.map(target => ({id: target.id, language: target.language, role: target.role})),
      terminal: true,
      terminalScope: "cycle"
    })
  }

  /**
   * Emits one failed, cancelled, or superseded cycle terminal.
   * @param {unknown} failure - Preserved cycle failure.
   * @param {"cancelled" | "failed" | "superseded"} status - Terminal classification.
   * @returns {void}
   */
  cycleFailed(failure, status) {
    this.#requireCycle()
    this.#cycleTerminal = true
    const diagnostic = normalizeDiagnostic(failure)

    if (this.#format == "human") {
      this.#stderr.write(formatHumanProjectFailure(diagnostic, `Watch cycle ${this.#cycle} ${status}`))
      return
    }
    this.#write({
      changedPaths: this.#changedPaths,
      diagnostic: diagnosticRecord(diagnostic),
      durationMs: this.#duration(),
      ...(this.#snapshotHash === null ? {} : {snapshotHash: this.#snapshotHash}),
      state: `cycle-${status}`,
      terminal: true,
      terminalScope: "cycle"
    })
  }

  /**
   * Reports reconciliation whose complete content hash did not change.
   * @param {readonly string[]} changedPaths - Coalesced hint paths.
   * @returns {void}
   */
  unchanged(changedPaths) {
    this.#emit({changedPaths, state: "reconciled-unchanged"})
  }

  /**
   * Reports the first filesystem hint admitted while the current cycle remains active.
   * @returns {void}
   */
  cycleDirty() {
    this.#requireCycle()
    this.#emit({state: "cycle-dirty"})
  }

  /**
   * Emits the sole clean watcher terminal.
   * @param {string} reason - Shutdown reason.
   * @returns {void}
   */
  watchStopped(reason) {
    this.#requireWatchTerminal()
    this.#watchTerminal = true
    if (this.#format == "human") {
      this.#stdout.write(`Watch stopped: ${reason}\n`)
      return
    }
    this.#write({reason, state: "watch-stopped", terminal: true, terminalScope: "watch"})
  }

  /**
   * Emits the sole startup/configuration watcher terminal.
   * @param {unknown} failure - Startup/configuration failure.
   * @returns {void}
   */
  watchFailed(failure) {
    this.#requireWatchTerminal()
    this.#watchTerminal = true
    const diagnostic = normalizeDiagnostic(failure)

    if (this.#format == "human") {
      this.#stderr.write(formatHumanProjectFailure(diagnostic, "Watch failed"))
      return
    }
    this.#write({diagnostic: diagnosticRecord(diagnostic), state: "watch-failed", terminal: true, terminalScope: "watch"})
  }

  /**
   * Computes a stable non-negative cycle duration.
   * @returns {number} Cycle duration.
   */
  #duration() {
    const value = this.#now() - this.#cycleStartedAt

    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  /**
   * Emits a non-terminal machine state when selected.
   * @param {Record<string, unknown>} fields - State fields.
   * @returns {void}
   */
  #emit(fields) {
    if (this.#format == "ndjson") this.#write(fields)
  }

  /**
   * Writes one complete NDJSON record.
   * @param {Record<string, unknown>} fields - Protocol fields.
   * @returns {void}
   */
  #write(fields) {
    this.#stdout.write(`${JSON.stringify({
      cycle: this.#cycle,
      project: this.#projectId,
      schema: "SemantifoldWatchEvent",
      version: 1,
      ...fields
    })}\n`)
  }

  /**
   * Requires one open cycle terminal slot.
   * @returns {void}
   */
  #requireCycle() {
    if (this.#cycleTerminal || this.#watchTerminal) throw new TypeError("Project watch reporter has no open cycle.")
  }

  /**
   * Requires one open watcher terminal slot.
   * @returns {void}
   */
  #requireWatchTerminal() {
    if (this.#watchTerminal || !this.#cycleTerminal) throw new TypeError("Project watch reporter watcher lifecycle is invalid.")
  }
}

/**
 * @typedef ProjectWatchCycleContext
 * @property {readonly string[]} changedPaths - Stable changed paths.
 * @property {number} cycle - One-based cycle number.
 * @property {string} projectId - Stable project identity.
 * @property {string} [snapshotHash] - Complete snapshot hash when reconciliation succeeded.
 */
