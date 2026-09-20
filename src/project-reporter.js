// @ts-check

import {SemantifoldDiagnostic} from "./diagnostic.js"

/**
 * Emits concise human output or the deterministic Task-039 NDJSON state protocol.
 */
export class ProjectBuildReporter {
  /** @type {"human" | "ndjson"} */
  #format
  /** @type {WritableOutput} */
  #stdout
  /** @type {WritableOutput} */
  #stderr
  /** @type {string | null} */
  #projectId = null
  /** @type {string | null} */
  #snapshotHash = null
  #terminal = false

  /**
   * Creates a one-cycle reporter.
   * @param {{format?: "human" | "ndjson", stderr?: WritableOutput, stdout?: WritableOutput}} [options] - Output mode and sinks.
   */
  constructor(options = {}) {
    const format = options.format ?? "human"

    if (format != "human" && format != "ndjson") throw new TypeError("Invalid project build reporter format.")
    this.#format = format
    this.#stdout = options.stdout ?? process.stdout
    this.#stderr = options.stderr ?? process.stderr
    if (typeof this.#stdout?.write != "function" || typeof this.#stderr?.write != "function") {
      throw new TypeError("Project build reporter requires writable output sinks.")
    }
  }

  /**
   * Reports validated project configuration.
   * @param {string} projectId - Stable project identity.
   * @returns {void}
   */
  projectLoaded(projectId) {
    this.#projectId = projectId
    this.#emitState({state: "project-loaded"})
  }

  /**
   * Reports one stable complete source snapshot.
   * @param {string} snapshotHash - Complete ordered snapshot hash.
   * @returns {void}
   */
  snapshotLoaded(snapshotHash) {
    this.#snapshotHash = snapshotHash
    this.#emitState({snapshotHash, state: "snapshot-loaded"})
  }

  /**
   * Reports one ordered generated target.
   * @param {import("./project-build.js").ProjectBuildTargetResult} target - Completed target result.
   * @returns {void}
   */
  targetGenerated(target) {
    this.#emitState({
      artifactCount: target.artifactCount,
      language: target.language,
      role: target.role,
      state: "target-generated",
      target: target.id
    })
  }

  /**
   * Emits the sole successful terminal record.
   * @param {import("./project-build.js").ProjectBuildSuccess} result - Committed build result.
   * @returns {void}
   */
  succeeded(result) {
    this.#requireOpenTerminal()
    this.#terminal = true
    this.#projectId = result.projectId
    this.#snapshotHash = result.snapshotHash
    if (this.#format == "human") {
      const targetWord = result.targets.length == 1 ? "target" : "targets"

      this.#stdout.write(`Built project '${result.projectId}' as generation '${result.generationId}' with ${result.targets.length} ${targetWord}.\n`)
      return
    }
    this.#writeNdjson({
      exitCode: 0,
      generationId: result.generationId,
      snapshotHash: result.snapshotHash,
      state: "succeeded",
      targets: result.targets.map(target => ({
        artifactCount: target.artifactCount,
        id: target.id,
        language: target.language,
        role: target.role
      })),
      terminal: true
    })
  }

  /**
   * Emits the sole failed terminal record while preserving the first diagnostic.
   * @param {unknown} failure - Build or CLI failure.
   * @returns {void}
   */
  failed(failure) {
    this.#requireOpenTerminal()
    this.#terminal = true
    const diagnostic = normalizeDiagnostic(failure)

    if (this.#format == "human") {
      this.#stderr.write(`Build failed: ${diagnostic.message}\n`)
      return
    }
    this.#writeNdjson({
      diagnostic: diagnosticRecord(diagnostic),
      exitCode: 1,
      ...(this.#snapshotHash === null ? {} : {snapshotHash: this.#snapshotHash}),
      state: "failed",
      terminal: true
    })
  }

  /**
   * Emits a non-terminal machine state when selected.
   * @param {Record<string, unknown>} fields - State-specific fields.
   * @returns {void}
   */
  #emitState(fields) {
    if (this.#format == "ndjson") this.#writeNdjson(fields)
  }

  /**
   * Writes one complete NDJSON protocol record.
   * @param {Record<string, unknown>} fields - State-specific fields.
   * @returns {void}
   */
  #writeNdjson(fields) {
    this.#stdout.write(`${JSON.stringify({
      cycle: 1,
      project: this.#projectId,
      schema: "SemantifoldBuildEvent",
      version: 1,
      ...fields
    })}\n`)
  }

  /**
   * Rejects an attempt to emit more than one terminal record.
   * @returns {void}
   */
  #requireOpenTerminal() {
    if (this.#terminal) throw new TypeError("Project build reporter already emitted its terminal record.")
  }
}

/**
 * Normalizes an unexpected failure without replacing a Semantifold diagnostic.
 * @param {unknown} failure - Opaque failure.
 * @returns {SemantifoldDiagnostic} Stable diagnostic.
 */
function normalizeDiagnostic(failure) {
  if (failure instanceof SemantifoldDiagnostic) return failure
  const cause = failure instanceof Error ? failure : new Error(String(failure))

  return new SemantifoldDiagnostic({
    cause,
    code: "PROJECT_BUILD_FAILED",
    language: "project",
    message: "Project build failed unexpectedly."
  })
}

/**
 * Serializes stable public diagnostic fields without causes or host paths.
 * @param {SemantifoldDiagnostic} diagnostic - Normalized diagnostic.
 * @returns {Record<string, unknown>} Protocol diagnostic.
 */
function diagnosticRecord(diagnostic) {
  return {
    code: diagnostic.code,
    detail: diagnostic.detail,
    language: diagnostic.language,
    ...(diagnostic.location === undefined ? {} : {location: diagnostic.location})
  }
}

/** @typedef {{write: (chunk: string) => unknown}} WritableOutput */
