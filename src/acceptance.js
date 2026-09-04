// @ts-check

import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {isDenseArray} from "./array.js"
import {createGeneratedArtifactSet} from "./artifacts.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {exceededOwnedDeadline, executeFileWithDeadline} from "./subprocess.js"
import {isSupportedTimeoutMs, maximumTimeoutMs} from "./timeout.js"
import {deterministicEnvironment} from "./toolchains.js"

const acceptanceMaxBuffer = 16 * 1024 * 1024
const launchErrorCodes = new Set([
  "E2BIG", "EACCES", "EAGAIN", "ELOOP", "EMFILE", "ENAMETOOLONG", "ENFILE", "ENOENT", "ENOEXEC", "ENOMEM", "ENOTDIR", "ENOTSUP", "EPERM", "ETXTBSY"
])
const orderedStages = Object.freeze(["parse", "generate", "compile", "link", "validate", "instantiate", "execute"])
const stageIndexes = new Map(orderedStages.map((stage, index) => [stage, index]))

/**
 * Materializes one artifact set and runs ordered acceptance stages without a shell.
 * @param {object} input - Acceptance request.
 * @param {import("./semantic/types.js").GeneratedArtifactSet} input.artifacts - Complete input artifacts.
 * @param {Readonly<Record<string, string | undefined>>} [input.environment] - Explicit process environment.
 * @param {{arguments: string[], stage: import("./semantic/types.js").AcceptanceStage, tool: import("./semantic/types.js").DiscoveredToolchain}[]} input.stages - Ordered stages.
 * @param {string} input.target - Target identity.
 * @param {number} [input.timeoutMs] - Per-stage timeout.
 * @returns {Promise<import("./semantic/types.js").AcceptanceResult>} Captured results after cleanup.
 */
export async function runAcceptanceStages(input) {
  if (!isPlainObject(input)) invalidRunner("Acceptance requires a request object.", "acceptance")
  const artifacts = /** @type {import("./semantic/types.js").GeneratedArtifactSet} */ (input.artifacts)
  const environment = /** @type {Readonly<Record<string, string | undefined>>} */ (
    input.environment === undefined ? {PATH: process.env.PATH} : input.environment)
  const stages = /** @type {{arguments: string[], stage: import("./semantic/types.js").AcceptanceStage, tool: import("./semantic/types.js").DiscoveredToolchain}[]} */ (input.stages)
  const target = /** @type {string} */ (input.target)
  const timeoutMs = /** @type {number} */ (input.timeoutMs === undefined ? 10_000 : input.timeoutMs)
  const request = validateRequest({artifacts, environment, stages, target, timeoutMs})
  const directory = await createAcceptanceDirectory(request.target)
  /** @type {unknown} */
  let primaryFailure
  /** @type {import("./semantic/types.js").AcceptanceResult | undefined} */
  let result
  let primaryFailed = false

  try {
    await materializeArtifacts(request.artifacts, directory, request.target)

    /** @type {import("./semantic/types.js").AcceptanceStageResult[]} */
    const results = []

    for (const stage of request.stages) {
      try {
        const result = await executeFileWithDeadline({
          arguments: stage.arguments,
          cwd: directory,
          environment: request.environment,
          executable: stage.tool.executable,
          maxBuffer: acceptanceMaxBuffer,
          timeoutMs: request.timeoutMs
        })

        results.push(Object.freeze({
          arguments: Object.freeze([...stage.arguments]),
          executable: stage.tool.executable,
          stage: stage.stage,
          stderr: result.stderr,
          stdout: result.stdout,
          version: stage.tool.version
        }))
      } catch (error) {
        throw processDiagnostic(error, stage, request.target, request.timeoutMs)
      }
    }

    result = Object.freeze({directory, stages: Object.freeze(results), target: request.target})
  } catch (error) {
    primaryFailed = true
    primaryFailure = error
  }

  /** @type {unknown} */
  let cleanupFailure
  let cleanupFailed = false

  try {
    await removeAcceptanceDirectory(directory, request.target)
  } catch (error) {
    cleanupFailed = true
    cleanupFailure = error
  }

  if (primaryFailed && cleanupFailed && primaryFailure instanceof Error) {
    throw preservePrimaryFailure(primaryFailure, cleanupFailure, request.target)
  }
  if (primaryFailed) throw primaryFailure
  if (cleanupFailed) throw cleanupFailure

  return /** @type {import("./semantic/types.js").AcceptanceResult} */ (result)
}

/**
 * Validates and detaches a staged acceptance request before filesystem mutation.
 * @param {{
 *   artifacts: import("./semantic/types.js").GeneratedArtifactSet,
 *   environment: Readonly<Record<string, string | undefined>>,
 *   stages: {arguments: string[], stage: import("./semantic/types.js").AcceptanceStage, tool: import("./semantic/types.js").DiscoveredToolchain}[],
 *   target: string,
 *   timeoutMs: number
 * }} input - Candidate request.
 * @returns {{
 *   artifacts: import("./semantic/types.js").GeneratedArtifactSet,
 *   environment: Readonly<Record<string, string>>,
 *   stages: {arguments: string[], stage: import("./semantic/types.js").AcceptanceStage, tool: Readonly<{executable: string, version: string}>}[],
 *   target: string,
 *   timeoutMs: number
 * }} Validated request.
 */
function validateRequest(input) {
  try {
    if (typeof input.target != "string" || input.target.length == 0 || !isSupportedTimeoutMs(input.timeoutMs) ||
      !isDenseArray(input.stages) || input.stages.length == 0) {
      invalidRunner(`Acceptance requires a target, timeout from 1 through ${maximumTimeoutMs}ms, and non-empty ordered stages.`, input.target)
    }
    const artifacts = createGeneratedArtifactSet(input.artifacts)

    if (artifacts.target != input.target) invalidRunner("Acceptance target must match the generated artifact-set target.", input.target)
    const environment = deterministicEnvironment(input.environment)
    let previousIndex = -1
    const seen = new Set()
    /** @type {{arguments: string[], stage: import("./semantic/types.js").AcceptanceStage, tool: Readonly<{executable: string, version: string}>}[]} */
    const stages = []

    for (let stagePosition = 0; stagePosition < input.stages.length; stagePosition += 1) {
      const stage = input.stages[stagePosition]

      if (!isPlainObject(stage)) invalidRunner("Acceptance stages must be distinct known stage records.", input.target)
      const stageName = stage.stage

      if (typeof stageName != "string" || !stageIndexes.has(stageName) || seen.has(stageName)) {
        invalidRunner("Acceptance stages must be distinct known stage records.", input.target)
      }
      const index = /** @type {number} */ (stageIndexes.get(stageName))

      if (index < previousIndex) invalidRunner("Acceptance stages must follow parse-to-execute order.", input.target)
      previousIndex = index
      seen.add(stageName)
      const argumentCandidate = stage.arguments
      const stageArguments = isDenseArray(argumentCandidate) ? [...argumentCandidate] : undefined
      const toolCandidate = stage.tool
      const tool = isPlainObject(toolCandidate) ? Object.freeze({
        executable: toolCandidate.executable,
        id: toolCandidate.id,
        source: toolCandidate.source,
        version: toolCandidate.version
      }) : undefined

      if (stageArguments == undefined || !stageArguments.every((argument) => typeof argument == "string" && !argument.includes("\0")) ||
        !isTool(tool)) invalidRunner(`Acceptance stage '${stageName}' has an invalid tool or argument array.`, input.target)

      stages.push(Object.freeze({arguments: stageArguments, stage: stageName, tool}))
    }

    return {artifacts, environment, stages, target: input.target, timeoutMs: input.timeoutMs}
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic && error.code == "INVALID_ACCEPTANCE_RUNNER") throw error
    if (error instanceof SemantifoldDiagnostic) {
      throw new SemantifoldDiagnostic({
        cause: error,
        code: "INVALID_ACCEPTANCE_RUNNER",
        language: typeof input.target == "string" ? input.target : "acceptance",
        message: `Acceptance runner input is invalid: ${error.detail}`
      })
    }

    return invalidRunner("Acceptance runner input is invalid.", typeof input.target == "string" ? input.target : "acceptance", error)
  }
}

/**
 * Normalizes a subprocess failure with exact stage and toolchain context.
 * @param {unknown} error - Subprocess rejection.
 * @param {{arguments: string[], stage: string, tool: Readonly<{executable: string, version: string}>}} stage - Failed stage.
 * @param {string} target - Acceptance target.
 * @param {number} timeoutMs - Configured stage timeout.
 * @returns {SemantifoldDiagnostic} Normalized failure.
 */
function processDiagnostic(error, stage, target, timeoutMs) {
  const fields = processErrorFields(error)
  const outputLimited = fields.nativeCode == "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  const timedOut = !outputLimited && exceededOwnedDeadline(error)
  const launchFailure = fields.nativeCode != undefined && launchErrorCodes.has(fields.nativeCode)
  const signaled = !outputLimited && !timedOut && fields.signal != undefined
  const code = outputLimited ? "ACCEPTANCE_OUTPUT_LIMIT" : timedOut ? "ACCEPTANCE_TIMEOUT" : launchFailure ? "ACCEPTANCE_LAUNCH_FAILURE" : signaled
    ? "ACCEPTANCE_SIGNAL"
    : "ACCEPTANCE_NONZERO_EXIT"
  const reason = outputLimited ? `exceeded the ${acceptanceMaxBuffer}-byte output capture limit (${fields.nativeCode})` : timedOut
    ? `timed out after ${timeoutMs}ms` : launchFailure
    ? `could not launch (${fields.nativeCode})`
    : signaled ? `terminated by signal ${fields.signal}`
    : fields.exitCode != undefined ? `exited nonzero (${fields.exitCode})`
    : `failed after launch (${fields.nativeCode ?? "unknown"})`

  return new SemantifoldDiagnostic({
    cause: outputLimited ? undefined : error instanceof Error ? error : undefined,
    code,
    executable: stage.tool.executable,
    exitCode: fields.exitCode,
    language: target,
    message: `Acceptance stage '${stage.stage}' ${reason} using '${stage.tool.executable}' (${stage.tool.version}).`,
    signal: fields.signal,
    stage: stage.stage,
    stderr: fields.stderr,
    stdout: fields.stdout,
    version: stage.tool.version
  })
}

/**
 * Narrows the stable fields of an opaque child-process failure.
 * @param {unknown} error - Process rejection.
 * @returns {{exitCode: number | undefined, nativeCode: string | undefined, signal: string | undefined, stderr: string, stdout: string}} Stable fields.
 */
function processErrorFields(error) {
  if (!error || typeof error != "object") return {exitCode: undefined, nativeCode: undefined, signal: undefined, stderr: "", stdout: ""}
  const value = /** @type {Record<string, unknown>} */ (error)
  const nativeCode = typeof value.code == "string" ? value.code : undefined
  const outputLimited = nativeCode == "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"

  return {
    exitCode: typeof value.code == "number" ? value.code : undefined,
    nativeCode,
    signal: typeof value.signal == "string" ? value.signal : undefined,
    stderr: !outputLimited && typeof value.stderr == "string" ? value.stderr : "",
    stdout: !outputLimited && typeof value.stdout == "string" ? value.stdout : ""
  }
}

/**
 * Checks the discovered-tool fields consumed by the runner.
 * @param {unknown} value - Candidate tool.
 * @returns {value is import("./semantic/types.js").DiscoveredToolchain} Whether the tool contract is present.
 */
function isTool(value) {
  return isPlainObject(value) && typeof value.id == "string" && typeof value.executable == "string" && path.isAbsolute(value.executable) &&
    !value.executable.includes("\0") && typeof value.version == "string" && value.version.length > 0 &&
    (value.source == "canonical" || value.source == "override")
}

/**
 * Keeps the primary acceptance error while recording bounded cleanup evidence in its cause chain.
 * @param {Error} primaryFailure - Original materialization or stage failure.
 * @param {unknown} cleanupFailure - Cleanup rejection.
 * @param {string} target - Acceptance target.
 * @returns {Error} The original primary error with structured cleanup evidence.
 */
function preservePrimaryFailure(primaryFailure, cleanupFailure, target) {
  const cleanupEvidence = new SemantifoldDiagnostic({
    code: "ACCEPTANCE_CLEANUP_FAILURE",
    language: cleanupFailure instanceof SemantifoldDiagnostic ? cleanupFailure.language : target,
    message: "Isolated acceptance-directory cleanup failed after the primary acceptance failure."
  })
  const causes = primaryFailure.cause instanceof Error ? [primaryFailure.cause, cleanupEvidence] : [cleanupEvidence]

  Object.defineProperty(primaryFailure, "cause", {
    configurable: true,
    value: new AggregateError(causes, "Acceptance failed and isolated-directory cleanup also failed."),
    writable: true
  })

  return primaryFailure
}

/**
 * Throws a normalized runner-configuration diagnostic.
 * @param {string} message - Failure detail.
 * @param {unknown} target - Candidate target identity.
 * @param {unknown} [error] - Preserved cause.
 * @returns {never} Always throws.
 */
function invalidRunner(message, target, error) {
  throw new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code: "INVALID_ACCEPTANCE_RUNNER",
    language: typeof target == "string" && target.length > 0 ? target : "acceptance",
    message
  })
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Removes the isolated acceptance directory with a normalized failure.
 * @param {string} directory - Exact temporary directory.
 * @param {string} target - Acceptance target.
 * @returns {Promise<void>} Cleanup completion.
 */
async function removeAcceptanceDirectory(directory, target) {
  try {
    await rm(directory, {force: true, recursive: true})
  } catch (error) {
    throw new SemantifoldDiagnostic({
      cause: error instanceof Error ? error : undefined,
      code: "ACCEPTANCE_CLEANUP_FAILURE",
      language: target,
      message: `Failed to remove isolated acceptance directory '${directory}'.`
    })
  }
}

/**
 * Creates one isolated acceptance directory with a normalized setup failure.
 * @param {string} target - Acceptance target.
 * @returns {Promise<string>} Exact temporary directory.
 */
async function createAcceptanceDirectory(target) {
  try {
    return await mkdtemp(path.join(os.tmpdir(), "semantifold-acceptance-"))
  } catch (error) {
    throw new SemantifoldDiagnostic({
      cause: error instanceof Error ? error : undefined,
      code: "ACCEPTANCE_SETUP_FAILURE",
      language: target,
      message: "Failed to create an isolated acceptance directory."
    })
  }
}

/**
 * Writes only the already-validated generated artifacts into the isolated directory.
 * @param {import("./semantic/types.js").GeneratedArtifactSet} artifacts - Complete validated set.
 * @param {string} directory - Exact temporary directory.
 * @param {string} target - Acceptance target.
 * @returns {Promise<void>} Materialization completion.
 */
async function materializeArtifacts(artifacts, directory, target) {
  for (const artifact of artifacts.artifacts) {
    const filename = path.join(directory, ...artifact.path.split("/"))

    try {
      await mkdir(path.dirname(filename), {recursive: true})
      await writeFile(filename, artifact.content)
    } catch (error) {
      throw new SemantifoldDiagnostic({
        cause: error instanceof Error ? error : undefined,
        code: "ACCEPTANCE_MATERIALIZATION_FAILURE",
        language: target,
        message: `Failed to materialize generated artifact '${artifact.path}'.`
      })
    }
  }
}
