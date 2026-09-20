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
   * Reports one successful target-check stage with exact process evidence.
   * @param {{id: string, language: string, stage: import("./semantic/types.js").TargetCheckStageResult}} checked - Target and stage result.
   * @returns {void}
   */
  targetChecked(checked) {
    this.#emitState({
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

      const action = result.checked ? "Built and checked" : "Built"

      this.#stdout.write(`${action} project '${result.projectId}' as generation '${result.generationId}' with ${result.targets.length} ${targetWord}.\n`)
      return
    }
    this.#writeNdjson({
      exitCode: 0,
      checked: result.checked,
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
      this.#stderr.write(formatHumanProjectFailure(diagnostic, "Build failed"))
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
export function normalizeDiagnostic(failure) {
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
export function diagnosticRecord(diagnostic) {
  return {
    code: diagnostic.code,
    detail: diagnostic.detail,
    language: diagnostic.language,
    ...(diagnostic.location === undefined ? {} : {location: diagnostic.location}),
    ...optionalDiagnosticFields(diagnostic),
    ...(diagnostic.cause instanceof SemantifoldDiagnostic ? {cause: diagnosticRecord(diagnostic.cause)} : {})
  }
}

/**
 * Retains stable structured process and target context.
 * @param {SemantifoldDiagnostic} diagnostic - Diagnostic to serialize.
 * @returns {Record<string, unknown>} Present optional fields.
 */
function optionalDiagnosticFields(diagnostic) {
  const fields = [
    "command", "durationMs", "executable", "exitCode", "projectId", "signal", "stage", "stderr", "stdout", "targetId",
    "toolId", "version"
  ]
  /** @type {Record<string, unknown>} */
  const result = {}

  for (const field of fields) {
    const value = Reflect.get(diagnostic, field)

    if (value !== undefined) result[field] = value
  }

  return result
}

/**
 * Finds the most specific Semantifold diagnostic in a preserved cause chain.
 * @param {SemantifoldDiagnostic} diagnostic - Root diagnostic.
 * @returns {SemantifoldDiagnostic} Deepest structured diagnostic.
 */
function deepestDiagnostic(diagnostic) {
  let current = diagnostic

  while (current.cause instanceof SemantifoldDiagnostic) current = current.cause

  return current
}

/**
 * Formats nested structured diagnostics without duplicating detailed checker-process evidence.
 * @param {SemantifoldDiagnostic} diagnostic - Root diagnostic.
 * @param {SemantifoldDiagnostic} deepest - Deepest structured diagnostic.
 * @returns {string} Ordered human-readable cause lines.
 */
function humanDiagnosticCauses(diagnostic, deepest) {
  let current = diagnostic.cause
  let result = ""

  while (current instanceof SemantifoldDiagnostic) {
    if (current !== deepest || !current.code.startsWith("TARGET_CHECK_")) {
      result += `Caused by: ${current.message}\n`
    }
    current = current.cause
  }

  return result
}

/**
 * Formats complete bounded check-process evidence without flattening its diagnostic.
 * @param {SemantifoldDiagnostic} diagnostic - Deepest structured diagnostic.
 * @returns {string} Human-readable check context and streams, when applicable.
 */
function humanProcessEvidence(diagnostic) {
  if (!diagnostic.code.startsWith("TARGET_CHECK_")) return ""
  /**
   * Reads one optional diagnostic field for compact human display.
   * @param {string} field - Field identity.
   * @returns {unknown} Present value or an explicit absence marker.
   */
  const value = field => Reflect.get(diagnostic, field) ?? "none"
  const heading = `Check failure: project='${value("projectId")}' target='${value("targetId")}' ` +
    `language='${diagnostic.language}' tool='${value("toolId")}' executable='${value("executable")}' ` +
    `version='${value("version")}' stage='${value("stage")}' exitCode=${value("exitCode")} ` +
    `signal=${value("signal")} durationMs=${value("durationMs")}\n`

  return `${heading}${humanStream("stdout", diagnostic.stdout)}${humanStream("stderr", diagnostic.stderr)}`
}

/**
 * Formats one normalized failure with preserved nested process evidence.
 * This helper is shared by the one-shot and watch reporters but is not a package-root API.
 * @param {unknown} failure - Opaque or normalized failure.
 * @param {string} heading - Human output heading without punctuation.
 * @returns {string} Complete newline-terminated failure text.
 */
export function formatHumanProjectFailure(failure, heading) {
  const diagnostic = normalizeDiagnostic(failure)
  const processFailure = deepestDiagnostic(diagnostic)
  const causes = humanDiagnosticCauses(diagnostic, processFailure)
  const evidence = humanProcessEvidence(processFailure)

  return `${heading}: ${diagnostic.message}\n${causes}${evidence}`
}

/**
 * Labels one bounded process stream and preserves its exact content.
 * @param {string} name - Stream identity.
 * @param {unknown} content - Captured stream value.
 * @returns {string} Labeled newline-terminated stream evidence.
 */
function humanStream(name, content) {
  if (typeof content != "string" || content.length == 0) return `${name}:\n<empty>\n`

  return `${name}:\n${content}${content.endsWith("\n") ? "" : "\n"}`
}

/** @typedef {{write: (chunk: string) => unknown}} WritableOutput */
