// @ts-check

import {lstat, mkdir, readdir, rm, rmdir} from "node:fs/promises"
import path from "node:path"
import {isDenseArray} from "./array.js"
import {createGeneratedArtifactSet} from "./artifacts.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {languageRegistry} from "./language-registry.js"
import {cancelledOwnedProcess, exceededOwnedDeadline, executeFileWithDeadline} from "./subprocess.js"
import {isSupportedTimeoutMs, maximumTimeoutMs} from "./timeout.js"
import {deterministicEnvironment} from "./toolchains.js"

const defaultTimeoutMs = 20_000
const maximumOutputBytes = 1024 * 1024
const identityPattern = /^[a-z][a-z0-9-]*$/u
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\u0020-\u007e]+)?$/u
const rolePattern = /^[a-z][a-z0-9-]*$/u
const launchErrorCodes = new Set([
  "E2BIG", "EACCES", "EAGAIN", "ELOOP", "EMFILE", "ENAMETOOLONG", "ENFILE", "ENOENT", "ENOEXEC", "ENOMEM",
  "ENOTDIR", "ENOTSUP", "EPERM", "ETXTBSY"
])
/** @type {WeakMap<TargetCheckRunner, {execute: typeof executeFileWithDeadline, now: () => number}>} */
const targetCheckRunnerDependencies = new WeakMap()

/**
 * Creates and validates one target-owned developer check plan.
 * @param {object} input - Exact staged target context.
 * @param {import("./semantic/types.js").GeneratedArtifactSet} input.artifacts - Validated staged artifacts.
 * @param {string} input.buildPath - Exact generation-scoped target build subtree.
 * @param {string} input.projectId - Exact project identity.
 * @param {string} input.sourcePath - Exact generation-scoped target source subtree.
 * @param {string} input.targetId - Exact project target identity.
 * @param {readonly import("./semantic/types.js").DiscoveredToolchain[]} input.tools - Discovered immutable tool records.
 * @returns {import("./semantic/types.js").TargetCheckPlan} Validated immutable plan.
 */
export function createTargetCheckPlan(input) {
  if (!isPlainObject(input) || !hasExactKeys(input, ["artifacts", "buildPath", "projectId", "sourcePath", "targetId", "tools"])) {
    return invalidPlan("Target check planning requires only staged artifacts, candidate roots, identities, and tools.")
  }
  let artifacts

  try {
    artifacts = createGeneratedArtifactSet(input.artifacts)
  } catch (error) {
    return invalidPlan("Target check planning requires a valid generated artifact set.", "check", error)
  }
  const target = artifacts.target
  const record = languageRegistry.record(target)
  const capability = record.check

  if (!capability.supported || typeof capability.factory != "function") {
    throw new SemantifoldDiagnostic({
      code: "UNSUPPORTED_TARGET_CHECK",
      language: target,
      message: "Registered target does not provide a developer check plan."
    })
  }
  if (typeof input.projectId != "string" || !identityPattern.test(input.projectId) ||
    typeof input.targetId != "string" || !identityPattern.test(input.targetId) ||
    typeof input.sourcePath != "string" || !path.isAbsolute(input.sourcePath) ||
    typeof input.buildPath != "string" || !path.isAbsolute(input.buildPath) ||
    pathsOverlap(input.sourcePath, input.buildPath) || !isDenseArray(input.tools)) {
    return invalidPlan("Target check planning received invalid identities, candidate roots, or tools.", target)
  }
  /** @type {import("./semantic/types.js").DiscoveredToolchain[]} */
  const tools = []

  for (let index = 0; index < input.tools.length; index += 1) {
    const tool = input.tools[index]

    if (!isDiscoveredTool(tool) || !Object.isFrozen(tool) || !Object.isFrozen(tool.versionArguments)) {
      return invalidPlan("Target check planning requires immutable discovered tool records.", target)
    }
    tools.push(tool)
  }
  if (tools.map(({id}) => id).join("\0") != capability.toolchains.join("\0")) {
    return invalidPlan("Target check planning tools must exactly match the target-declared developer-check toolchains.", target)
  }
  const context = Object.freeze({
    artifacts,
    buildPath: input.buildPath,
    projectId: input.projectId,
    sourcePath: input.sourcePath,
    targetId: input.targetId,
    tools: Object.freeze(tools)
  })
  let plan

  try {
    plan = capability.factory(context)
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    return invalidPlan("Target check plan factory failed.", target, error)
  }
  const validated = validateTargetCheckPlan(plan)
  const expectedArtifacts = new Set(context.artifacts.artifacts.map(artifact => path.join(context.sourcePath, artifact.path)))

  if (validated.projectId != context.projectId || validated.targetId != context.targetId ||
    validated.target != target || validated.sourcePath != context.sourcePath || validated.buildPath != context.buildPath ||
    validated.artifactPaths.length != expectedArtifacts.size || validated.artifactPaths.some(artifact => !expectedArtifacts.has(artifact))) {
    return invalidPlan("Target check plan changed its validated candidate context.", target)
  }

  return validated
}

/**
 * Owns ordered check subprocesses and settles only after each child closes.
 */
export class TargetCheckRunner {
  /**
   * Runs one already-staged immutable plan without executing generated application code.
   * @param {import("./semantic/types.js").TargetCheckPlan} plan - Target-owned plan.
   * @param {{onStage?: (result: import("./semantic/types.js").TargetCheckStageResult) => void, signal?: AbortSignal, timeoutMs?: number}} [options] - Lifecycle controls.
   * @returns {Promise<import("./semantic/types.js").TargetCheckResult>} Successful check evidence and output metadata.
   */
  async run(plan, options = {}) {
    const validated = validateTargetCheckPlan(plan)
    const dependencies = targetCheckRunnerDependencies.get(this) ?? {
      execute: executeFileWithDeadline,
      now: () => performance.now()
    }

    if (!isPlainObject(options) || options.onStage !== undefined && typeof options.onStage != "function" ||
      options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
      return invalidPlan("Target check runner options are invalid.", validated.target)
    }
    const timeoutMs = options.timeoutMs === undefined ? defaultTimeoutMs : options.timeoutMs

    if (!isSupportedTimeoutMs(timeoutMs)) {
      return invalidPlan(`Target check timeout must be from 1 through ${maximumTimeoutMs}ms.`, validated.target)
    }
    /** @type {import("./semantic/types.js").TargetCheckStageResult[]} */
    const results = []
    /** @type {unknown} */
    let stageFailure
    let stageFailed = false

    try {
      for (const stage of validated.stages) {
        const startedAt = dependencies.now()
        /** @type {import("./semantic/types.js").TargetCheckStageResult} */
        let stageResult

        if (options.signal?.aborted) throw cancelledDiagnostic(stage, validated, 0)
        try {
          await prepareStage(stage, validated)
        } catch (error) {
          throw preparationDiagnostic(error, stage, validated, elapsed(dependencies.now(), startedAt))
        }
        try {
          const output = await dependencies.execute({
            arguments: stage.argv,
            cwd: stage.cwd,
            environment: stage.environment,
            executable: stage.executable,
            maxBuffer: maximumOutputBytes,
            signal: options.signal,
            timeoutMs
          })
          stageResult = Object.freeze({
            argv: stage.argv,
            durationMs: elapsed(dependencies.now(), startedAt),
            exitCode: 0,
            signal: null,
            stage: stage.stage,
            stderr: output.stderr,
            stdout: output.stdout,
            tool: Object.freeze({
              command: stage.tool.command,
              executable: stage.tool.executable,
              id: stage.tool.id,
              source: stage.tool.source,
              version: stage.tool.version
            })
          })

        } catch (error) {
          throw processDiagnostic(error, stage, validated, timeoutMs, elapsed(dependencies.now(), startedAt))
        }
        results.push(stageResult)
        options.onStage?.(stageResult)
      }
    } catch (error) {
      stageFailed = true
      stageFailure = error
    }
    try {
      await cleanupStageEnvironment(validated)
    } catch (error) {
      const cleanup = cleanupDiagnostic(error, validated)

      if (stageFailed && stageFailure instanceof Error) throw preservePrimaryFailure(stageFailure, cleanup)
      if (stageFailed) throw new AggregateError([stageFailure, cleanup],
        "Target check failed and its owned transient environment could not be cleaned.", {cause: error})
      throw cleanup
    }
    if (stageFailed) throw stageFailure
    const output = validated.stages.findLast(stage => stage.output !== null)?.output
    const outputs = output == null ? [] : await collectBuildOutputs(validated.buildPath, output)

    return Object.freeze({
      outputs: Object.freeze(outputs),
      projectId: validated.projectId,
      stages: Object.freeze(results),
      target: validated.target,
      targetId: validated.targetId
    })
  }
}

/**
 * Creates a runner with focused instance-owned dependencies.
 * @param {{execute: typeof executeFileWithDeadline, now: () => number}} dependencies - Testable lifecycle collaborators.
 * @returns {TargetCheckRunner} Runner.
 */
export function createTargetCheckRunner(dependencies) {
  if (!isPlainObject(dependencies) || typeof dependencies.execute != "function" || typeof dependencies.now != "function") {
    throw new TypeError("Invalid target check runner dependencies.")
  }
  const runner = new TargetCheckRunner()

  targetCheckRunnerDependencies.set(runner, dependencies)

  return runner
}

/**
 * Validates a complete immutable plan before any process starts.
 * @param {unknown} candidate - Candidate plan.
 * @returns {import("./semantic/types.js").TargetCheckPlan} Exact validated plan.
 */
export function validateTargetCheckPlan(candidate) {
  if (!isPlainObject(candidate) || !Object.isFrozen(candidate) || !hasExactKeys(candidate, [
    "artifactPaths", "buildPath", "mode", "projectId", "schema", "sourcePath", "stages", "target", "targetId", "version"
  ])) return invalidPlan("Target check plan must be one immutable closed schema record.")
  const target = typeof candidate.target == "string" ? candidate.target : "check"
  const record = languageRegistry.record(target)
  const capability = record.check

  if (!capability.supported || candidate.schema != "SemantifoldTargetCheckPlan" || candidate.version != 1 ||
    candidate.mode != "developer-check" || typeof candidate.projectId != "string" || !identityPattern.test(candidate.projectId) ||
    typeof candidate.targetId != "string" || !identityPattern.test(candidate.targetId) ||
    typeof candidate.sourcePath != "string" || !path.isAbsolute(candidate.sourcePath) ||
    typeof candidate.buildPath != "string" || !path.isAbsolute(candidate.buildPath) ||
    pathsOverlap(candidate.sourcePath, candidate.buildPath)) {
    return invalidPlan("Target check plan has invalid schema, mode, identity, target, or candidate roots.", target)
  }
  if (!isDenseArray(candidate.artifactPaths) || !Object.isFrozen(candidate.artifactPaths) || candidate.artifactPaths.length == 0 ||
    !isDenseArray(candidate.stages) || !Object.isFrozen(candidate.stages) || candidate.stages.length == 0) {
    return invalidPlan("Target check plan requires dense immutable artifact and stage vectors.", target)
  }
  const artifactPaths = new Set()

  for (let index = 0; index < candidate.artifactPaths.length; index += 1) {
    const artifactPath = candidate.artifactPaths[index]

    if (typeof artifactPath != "string" || !ownedBy(candidate.sourcePath, artifactPath) || artifactPaths.has(artifactPath)) {
      return invalidPlan("Every planned artifact must be a distinct absolute path inside the candidate source subtree.", target)
    }
    artifactPaths.add(artifactPath)
  }
  const plannedStageKinds = candidate.stages.map(stage => isPlainObject(stage) && typeof stage.stage == "string" ? stage.stage : "")
    .filter((stage, index, stages) => index == 0 || stage != stages[index - 1])

  if (plannedStageKinds.join("\0") != capability.stages.join("\0")) {
    return invalidPlan("Target check stages must exactly match the target-declared developer-check stages.", target)
  }
  const usedTools = new Set()
  const referencedArtifactPaths = new Set()

  for (let index = 0; index < candidate.stages.length; index += 1) {
    const stage = candidate.stages[index]
    if (!isPlainObject(stage) || !Object.isFrozen(stage) || !hasExactKeys(stage, [
      "argv", "cwd", "environment", "environmentPaths", "executable", "inputHash", "inputs", "output", "pathArguments",
      "stage", "tool", "transientPaths"
    ]) || typeof stage.stage != "string" || stage.stage == "execute" ||
      !record.acceptance.stages.includes(/** @type {import("./semantic/types.js").AcceptanceStage} */ (stage.stage))) {
      return invalidPlan("Target check stages must be immutable, ordered, declared, and non-executing.", target)
    }
    const request = /** @type {import("./semantic/types.js").TargetCheckStageRequest} */ (stage)

    if (!isDiscoveredTool(request.tool) || !Object.isFrozen(request.tool) || !Object.isFrozen(request.tool.versionArguments) ||
      request.executable != request.tool.executable || !capability.toolchains.includes(request.tool.id)) {
      return invalidPlan(`Target check stage '${request.stage}' uses an invalid or undeclared tool.`, target)
    }
    usedTools.add(request.tool.id)
    if (!isDenseArray(request.argv) || !Object.isFrozen(request.argv) ||
      !request.argv.every(argument => typeof argument == "string" && !argument.includes("\0")) ||
      !isDenseArray(request.pathArguments) || !Object.isFrozen(request.pathArguments)) {
      return invalidPlan(`Target check stage '${request.stage}' requires a dense immutable shell-free argv.`, target)
    }
    if (!validEnvironment(request.environment)) {
      return invalidPlan(`Target check stage '${request.stage}' requires an immutable deterministic environment.`, target)
    }
    if (!validEnvironmentPaths(request.environmentPaths, request.environment, candidate.sourcePath, candidate.buildPath,
      capability.toolchains, usedTools)) {
      return invalidPlan(`Target check stage '${request.stage}' has invalid environment-path ownership.`, target)
    }
    if (typeof request.cwd != "string" || !ownedByEither(candidate.sourcePath, candidate.buildPath, request.cwd)) {
      return invalidPlan(`Target check stage '${request.stage}' working directory escapes the candidate target subtrees.`, target)
    }
    if (request.output !== null && !validOutput(request.output, candidate.buildPath)) {
      return invalidPlan(`Target check stage '${request.stage}' has invalid compiler-output ownership.`, target)
    }
    if (!validTransientPaths(request.transientPaths, candidate.sourcePath, candidate.buildPath, artifactPaths)) {
      return invalidPlan(`Target check stage '${request.stage}' has invalid transient-path ownership.`, target)
    }
    if (request.stage == "restore" ? typeof request.inputHash != "string" || !/^[a-f0-9]{64}$/u.test(request.inputHash) : request.inputHash !== null) {
      return invalidPlan(`Target check stage '${request.stage}' has invalid restore-input identity.`, target)
    }
    if (!isDenseArray(request.inputs) || !Object.isFrozen(request.inputs) || request.inputs.length == 0) {
      return invalidPlan(`Target check stage '${request.stage}' requires immutable declared inputs.`, target)
    }
    const stageInputs = new Set()

    for (let inputIndex = 0; inputIndex < request.inputs.length; inputIndex += 1) {
      const inputPath = request.inputs[inputIndex]

      if (typeof inputPath != "string" || stageInputs.has(inputPath) || !ownedByEither(candidate.sourcePath, candidate.buildPath, inputPath)) {
        return invalidPlan(`Target check stage '${request.stage}' has invalid or duplicate declared inputs.`, target)
      }
      if (ownedBy(candidate.sourcePath, inputPath)) {
        if (!artifactPaths.has(inputPath)) {
          return invalidPlan(`Target check stage '${request.stage}' reads an undeclared staged artifact.`, target)
        }
        referencedArtifactPaths.add(inputPath)
      }
      stageInputs.add(inputPath)
    }
    const pathIndexes = new Set()
    for (let pathIndex = 0; pathIndex < request.pathArguments.length; pathIndex += 1) {
      const declaration = request.pathArguments[pathIndex]

      if (!isPlainObject(declaration) || !Object.isFrozen(declaration) ||
        !hasExactKeys(declaration, declaration.prefix === undefined ? ["index", "ownership"] : ["index", "ownership", "prefix"]) ||
        typeof declaration.index != "number" || !Number.isInteger(declaration.index) || declaration.index < 0 ||
        declaration.index >= request.argv.length ||
        pathIndexes.has(declaration.index) || declaration.ownership != "source" && declaration.ownership != "build" ||
        declaration.prefix !== undefined && (typeof declaration.prefix != "string" || declaration.prefix.length == 0 ||
          declaration.prefix.includes("\0"))) {
        return invalidPlan(`Target check stage '${request.stage}' has invalid path-argument ownership.`, target)
      }
      const rawArgument = request.argv[declaration.index]
      const argument = declaration.prefix === undefined
        ? rawArgument
        : rawArgument.startsWith(declaration.prefix)
          ? rawArgument.slice(declaration.prefix.length)
          : ""
      const root = declaration.ownership == "source" ? candidate.sourcePath : candidate.buildPath

      if (argument != root && !ownedBy(root, argument)) {
        return invalidPlan(`Target check stage '${request.stage}' path argument escapes its candidate subtree.`, target)
      }
      pathIndexes.add(declaration.index)
    }
    for (let argumentIndex = 0; argumentIndex < request.argv.length; argumentIndex += 1) {
      if (path.isAbsolute(request.argv[argumentIndex]) && !pathIndexes.has(argumentIndex)) {
        return invalidPlan(`Target check stage '${request.stage}' contains an unowned absolute path argument.`, target)
      }
    }
  }
  if (referencedArtifactPaths.size != artifactPaths.size) {
    return invalidPlan("Target check plan must include every staged check artifact.", target)
  }
  if (capability.toolchains.some(toolchain => !usedTools.has(toolchain))) {
    return invalidPlan("Target check plan omits a target-declared toolchain.", target)
  }

  return /** @type {import("./semantic/types.js").TargetCheckPlan} */ (candidate)
}

/**
 * Collects every regular compiler output without following links.
 * @param {string} buildPath - Exact owned build root.
 * @param {import("./semantic/types.js").TargetCheckOutputOwnership} output - Output metadata.
 * @returns {Promise<import("./semantic/types.js").PublicationBuildArtifactInput[]>} Ordered metadata.
 */
async function collectBuildOutputs(buildPath, output) {
  /** @type {string[]} */
  const files = []
  /** @type {{absolute: string, relative: string}[]} */
  const pending = [{absolute: buildPath, relative: ""}]

  while (pending.length > 0) {
    const current = /** @type {{absolute: string, relative: string}} */ (pending.pop())
    let entries

    try {
      entries = await readdir(current.absolute, {withFileTypes: true})
    } catch (error) {
      return outputFailure("Compiler output subtree could not be inspected.", error)
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      const relative = current.relative.length == 0 ? entry.name : `${current.relative}/${entry.name}`
      const absolute = path.join(current.absolute, entry.name)

      if (entry.isDirectory()) pending.push({absolute, relative})
      else if (entry.isFile()) files.push(relative)
      else return outputFailure(`Compiler output '${relative}' is not a regular file or directory.`)
    }
  }
  files.sort((left, right) => left.localeCompare(right, "en"))
  for (const filename of files) {
    try {
      if (!(await lstat(path.join(buildPath, filename))).isFile()) {
        return outputFailure(`Compiler output '${filename}' is not a regular file.`)
      }
    } catch (error) {
      return outputFailure(`Compiler output '${filename}' could not be inspected.`, error)
    }
  }

  return files.map(filename => Object.freeze({mediaType: output.mediaType, path: filename, role: output.role}))
}

/**
 * Normalizes one child failure while retaining complete bounded output.
 * @param {unknown} error - Opaque process failure.
 * @param {import("./semantic/types.js").TargetCheckStageRequest} stage - Failed stage.
 * @param {import("./semantic/types.js").TargetCheckPlan} plan - Plan context.
 * @param {number} timeoutMs - Exact timeout.
 * @param {number} durationMs - Observed duration.
 * @returns {SemantifoldDiagnostic} Structured check failure.
 */
function processDiagnostic(error, stage, plan, timeoutMs, durationMs) {
  const fields = processErrorFields(error)
  const outputLimited = fields.nativeCode == "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  const cancelled = !outputLimited && cancelledOwnedProcess(error)
  const timedOut = !outputLimited && !cancelled && exceededOwnedDeadline(error)
  const launchFailure = fields.nativeCode != undefined && launchErrorCodes.has(fields.nativeCode)
  const signaled = !outputLimited && !cancelled && !timedOut && fields.signal != undefined
  const code = outputLimited ? "TARGET_CHECK_OUTPUT_LIMIT" : cancelled ? "TARGET_CHECK_CANCELLED" : timedOut
    ? "TARGET_CHECK_TIMEOUT" : launchFailure ? "TARGET_CHECK_LAUNCH_FAILURE" : signaled
      ? "TARGET_CHECK_SIGNAL" : "TARGET_CHECK_NONZERO_EXIT"
  const reason = outputLimited ? `exceeded the ${maximumOutputBytes}-byte output limit` : cancelled
    ? "was cancelled" : timedOut ? `timed out after ${timeoutMs}ms` : launchFailure
      ? `could not launch (${fields.nativeCode})` : signaled ? `closed after signal ${fields.signal}`
        : fields.exitCode == undefined ? "failed after launch" : `exited nonzero (${fields.exitCode})`

  return new SemantifoldDiagnostic({
    cause: outputLimited ? undefined : error instanceof Error ? error : undefined,
    code,
    durationMs,
    executable: stage.executable,
    exitCode: fields.exitCode,
    language: plan.target,
    message: `Target '${plan.targetId}' stage '${stage.stage}' ${reason} using '${stage.executable}' (${stage.tool.version}).`,
    projectId: plan.projectId,
    signal: fields.signal,
    stage: stage.stage,
    stderr: fields.stderr,
    stdout: fields.stdout,
    targetId: plan.targetId,
    toolId: stage.tool.id,
    version: stage.tool.version
  })
}

/**
 * Creates target-owned environment directories before launch without touching source staging.
 * @param {import("./semantic/types.js").TargetCheckStageRequest} stage - Validated stage.
 * @param {import("./semantic/types.js").TargetCheckPlan} plan - Validated plan context.
 * @returns {Promise<void>} Completion.
 */
async function prepareStage(stage, plan) {
  for (const declaration of stage.environmentPaths) {
    if (declaration.ownership == "build") {
      await mkdir(stage.environment[declaration.name], {mode: 0o700, recursive: true})
    }
  }
  for (const transientPath of stage.transientPaths) {
    if (ownedBy(plan.buildPath, transientPath)) await mkdir(transientPath, {mode: 0o700, recursive: true})
  }
}

/**
 * Removes only explicitly declared generation-owned transient cache/home directories after every child has closed.
 * @param {import("./semantic/types.js").TargetCheckPlan} plan - Validated plan.
 * @returns {Promise<void>} Completion.
 */
async function cleanupStageEnvironment(plan) {
  const owned = new Set()

  for (const stage of plan.stages) {
    for (const declaration of stage.environmentPaths) {
      if (declaration.ownership == "build") owned.add(stage.environment[declaration.name])
    }
    for (const transientPath of stage.transientPaths) owned.add(transientPath)
  }
  const paths = [...owned].sort((left, right) => right.length - left.length || right.localeCompare(left, "en"))

  for (const ownedPath of paths) {
    await rm(ownedPath, {force: true, recursive: true})
    await removeEmptyParents(path.dirname(ownedPath), ownedBy(plan.buildPath, ownedPath) ? plan.buildPath : plan.sourcePath)
  }
}

/**
 * Removes empty transient ancestors without ever removing the candidate build root.
 * @param {string} candidate - First possible empty ancestor.
 * @param {string} root - Exact retained candidate root.
 * @returns {Promise<void>} Completion.
 */
async function removeEmptyParents(candidate, root) {
  let current = candidate

  while (ownedBy(root, current)) {
    if ((await readdir(current)).length > 0) return
    await rmdir(current)
    current = path.dirname(current)
  }
}

/**
 * Preserves cache/home preparation failures separately from tool launch or compilation.
 * @param {unknown} error - Filesystem failure.
 * @param {import("./semantic/types.js").TargetCheckStageRequest} stage - Failed stage.
 * @param {import("./semantic/types.js").TargetCheckPlan} plan - Plan context.
 * @param {number} durationMs - Observed duration.
 * @returns {SemantifoldDiagnostic} Structured failure.
 */
function preparationDiagnostic(error, stage, plan, durationMs) {
  return new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code: "TARGET_CHECK_PREPARATION_FAILURE",
    durationMs,
    executable: stage.executable,
    language: plan.target,
    message: `Target '${plan.targetId}' stage '${stage.stage}' could not prepare its owned cache/home directories.`,
    projectId: plan.projectId,
    stage: stage.stage,
    stderr: "",
    stdout: "",
    targetId: plan.targetId,
    toolId: stage.tool.id,
    version: stage.tool.version
  })
}

/**
 * Reports transient cache/home cleanup separately from native compiler diagnostics.
 * @param {unknown} error - Filesystem failure.
 * @param {import("./semantic/types.js").TargetCheckPlan} plan - Plan context.
 * @returns {SemantifoldDiagnostic} Structured cleanup failure.
 */
function cleanupDiagnostic(error, plan) {
  return new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code: "TARGET_CHECK_CLEANUP_FAILURE",
    language: plan.target,
    message: `Target '${plan.targetId}' could not remove its owned transient cache/home directories.`,
    projectId: plan.projectId,
    targetId: plan.targetId
  })
}

/**
 * Retains the first plan/process diagnostic while attaching bounded cleanup evidence.
 * @param {Error} primaryFailure - First check failure.
 * @param {SemantifoldDiagnostic} cleanupFailure - Structured cleanup failure.
 * @returns {Error} Original failure with cleanup evidence in its cause chain.
 */
function preservePrimaryFailure(primaryFailure, cleanupFailure) {
  const causes = primaryFailure.cause instanceof Error ? [primaryFailure.cause, cleanupFailure] : [cleanupFailure]

  Object.defineProperty(primaryFailure, "cause", {
    configurable: true,
    value: new AggregateError(causes, "Target check failed and its owned transient environment cleanup also failed."),
    writable: true
  })

  return primaryFailure
}

/**
 * Creates a structured failure when cancellation precedes stage launch.
 * @param {import("./semantic/types.js").TargetCheckStageRequest} stage - Cancelled stage.
 * @param {import("./semantic/types.js").TargetCheckPlan} plan - Plan context.
 * @param {number} durationMs - Observed duration.
 * @returns {SemantifoldDiagnostic} Structured cancellation diagnostic.
 */
function cancelledDiagnostic(stage, plan, durationMs) {
  return new SemantifoldDiagnostic({
    code: "TARGET_CHECK_CANCELLED",
    durationMs,
    executable: stage.executable,
    language: plan.target,
    message: `Target '${plan.targetId}' stage '${stage.stage}' was cancelled before launch.`,
    projectId: plan.projectId,
    stage: stage.stage,
    stderr: "",
    stdout: "",
    targetId: plan.targetId,
    toolId: stage.tool.id,
    version: stage.tool.version
  })
}

/**
 * Extracts stable bounded child-process failure fields.
 * @param {unknown} error - Opaque process rejection.
 * @returns {{exitCode: number | undefined, nativeCode: string | undefined, signal: string | undefined, stderr: string, stdout: string}} Stable fields.
 */
function processErrorFields(error) {
  if (!error || typeof error != "object") return {exitCode: undefined, nativeCode: undefined, signal: undefined, stderr: "", stdout: ""}
  const value = /** @type {Record<string, unknown>} */ (error)

  return {
    exitCode: typeof value.code == "number" ? value.code : undefined,
    nativeCode: typeof value.code == "string" ? value.code : undefined,
    signal: typeof value.signal == "string" ? value.signal : undefined,
    stderr: typeof value.stderr == "string" ? value.stderr : "",
    stdout: typeof value.stdout == "string" ? value.stdout : ""
  }
}

/**
 * Checks the complete immutable discovered-tool shape consumed by a plan.
 * @param {unknown} value - Candidate tool record.
 * @returns {value is import("./semantic/types.js").DiscoveredToolchain} Whether the tool shape is valid.
 */
function isDiscoveredTool(value) {
  return isPlainObject(value) && typeof value.id == "string" && typeof value.command == "string" &&
    typeof value.executable == "string" && path.isAbsolute(value.executable) && !value.executable.includes("\0") &&
    (value.source == "canonical" || value.source == "override") && typeof value.version == "string" && value.version.length > 0 &&
    typeof value.versionOutput == "string" && isDenseArray(value.versionArguments) &&
    value.versionArguments.every(argument => typeof argument == "string" && !argument.includes("\0"))
}

/**
 * Checks that an environment is immutable and already deterministic.
 * @param {unknown} value - Candidate environment record.
 * @returns {boolean} Whether the environment is normalized.
 */
function validEnvironment(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) return false
  let normalized

  try {
    normalized = deterministicEnvironment(/** @type {Readonly<Record<string, string>>} */ (value))
  } catch {
    return false
  }
  const actual = Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en"))
  const expected = Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right, "en"))

  return JSON.stringify(actual) == JSON.stringify(expected)
}

/**
 * Checks every absolute non-PATH environment value against an explicit candidate-owned directory or discovered-tool declaration.
 * @param {unknown} value - Candidate declarations.
 * @param {Readonly<Record<string, string>>} environment - Validated deterministic environment.
 * @param {string} sourcePath - Candidate source root.
 * @param {string} buildPath - Candidate build root.
 * @param {readonly string[]} toolchains - Target-declared toolchain IDs.
 * @param {Set<string>} usedTools - Validated tools used by this plan.
 * @returns {value is readonly import("./semantic/types.js").TargetCheckEnvironmentPath[]} Whether ownership is complete.
 */
function validEnvironmentPaths(value, environment, sourcePath, buildPath, toolchains, usedTools) {
  if (!isDenseArray(value) || !Object.isFrozen(value)) return false
  const names = new Set()

  for (let index = 0; index < value.length; index += 1) {
    const declaration = value[index]

    if (!isPlainObject(declaration) || !Object.isFrozen(declaration) ||
      !hasExactKeys(declaration, declaration.ownership == "tool" ? ["name", "ownership", "tool"] : ["name", "ownership"]) ||
      typeof declaration.name != "string" || names.has(declaration.name)) return false
    const environmentPath = environment[declaration.name]

    if (declaration.ownership == "tool") {
      if (!isDiscoveredTool(declaration.tool) || !Object.isFrozen(declaration.tool) ||
        !Object.isFrozen(declaration.tool.versionArguments) || !toolchains.includes(declaration.tool.id) ||
        environmentPath != declaration.tool.executable) return false
      usedTools.add(declaration.tool.id)
      names.add(declaration.name)
      continue
    }
    if (declaration.ownership != "source" && declaration.ownership != "build") return false
    const root = declaration.ownership == "source" ? sourcePath : buildPath

    if (typeof environmentPath != "string" || !ownedBy(root, environmentPath)) return false
    names.add(declaration.name)
  }
  for (const [name, environmentValue] of Object.entries(environment)) {
    if (name != "PATH" && path.isAbsolute(environmentValue) && !names.has(name)) return false
  }

  return true
}

/**
 * Checks generation-owned transient cache/intermediate directories.
 * @param {unknown} value - Candidate path vector.
 * @param {string} sourcePath - Candidate source root.
 * @param {string} buildPath - Candidate build root.
 * @param {Set<string>} artifactPaths - Exact staged artifact paths.
 * @returns {value is readonly string[]} Whether paths are immutable distinct candidate descendants.
 */
function validTransientPaths(value, sourcePath, buildPath, artifactPaths) {
  if (!isDenseArray(value) || !Object.isFrozen(value)) return false
  const paths = new Set()

  for (let index = 0; index < value.length; index += 1) {
    const transientPath = value[index]

    if (typeof transientPath != "string" || !ownedBy(sourcePath, transientPath) && !ownedBy(buildPath, transientPath) ||
      paths.has(transientPath) || ownedBy(sourcePath, transientPath) && [...artifactPaths].some(artifactPath =>
        transientPath == artifactPath || pathsOverlap(transientPath, artifactPath))) return false
    paths.add(transientPath)
  }

  return true
}

/**
 * Checks compiler-output metadata against the owned build root.
 * @param {unknown} value - Candidate output record.
 * @param {string} buildPath - Exact candidate build root.
 * @returns {boolean} Whether output ownership is valid.
 */
function validOutput(value, buildPath) {
  return isPlainObject(value) && Object.isFrozen(value) && hasExactKeys(value, ["mediaType", "ownership", "path", "role"]) &&
    value.ownership == "build" && value.path == buildPath && typeof value.mediaType == "string" &&
    mediaTypePattern.test(value.mediaType) && typeof value.role == "string" && rolePattern.test(value.role)
}

/**
 * Checks strict descendant ownership without accepting the root itself.
 * @param {string} root - Absolute owned root.
 * @param {string} candidate - Absolute candidate path.
 * @returns {boolean} Whether the candidate is a strict descendant.
 */
function ownedBy(root, candidate) {
  if (!path.isAbsolute(candidate)) return false
  const relative = path.relative(root, candidate)

  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative != ".." && !path.isAbsolute(relative)
}

/**
 * Checks candidate ownership by either exact target subtree.
 * @param {string} sourcePath - Exact source root.
 * @param {string} buildPath - Exact build root.
 * @param {string} candidate - Candidate working directory.
 * @returns {boolean} Whether either target subtree owns the candidate.
 */
function ownedByEither(sourcePath, buildPath, candidate) {
  return candidate == sourcePath || candidate == buildPath || ownedBy(sourcePath, candidate) || ownedBy(buildPath, candidate)
}

/**
 * Checks whether two absolute roots overlap in either direction.
 * @param {string} left - First root.
 * @param {string} right - Second root.
 * @returns {boolean} Whether the roots overlap.
 */
function pathsOverlap(left, right) {
  return left == right || ownedBy(left, right) || ownedBy(right, left)
}

/**
 * Normalizes one monotonic duration observation.
 * @param {number} endedAt - End observation.
 * @param {number} startedAt - Start observation.
 * @returns {number} Finite non-negative duration.
 */
function elapsed(endedAt, startedAt) {
  const duration = endedAt - startedAt

  return Number.isFinite(duration) && duration >= 0 ? duration : 0
}

/**
 * Throws one compiler-output inspection diagnostic.
 * @param {string} message - Failure detail.
 * @param {unknown} [cause] - Optional underlying failure.
 * @returns {never} Always throws.
 */
function outputFailure(message, cause) {
  throw new SemantifoldDiagnostic({
    cause: cause instanceof Error ? cause : undefined,
    code: "TARGET_CHECK_OUTPUT_INVALID",
    language: "check",
    message
  })
}

/**
 * Throws one invalid-plan diagnostic.
 * @param {string} message - Failure detail.
 * @param {string} [target] - Target diagnostic identity.
 * @param {unknown} [cause] - Optional underlying failure.
 * @returns {never} Always throws.
 */
function invalidPlan(message, target = "check", cause) {
  throw new SemantifoldDiagnostic({
    cause: cause instanceof Error ? cause : undefined,
    code: "INVALID_TARGET_CHECK_PLAN",
    language: target,
    message
  })
}

/**
 * Checks for an ordinary object-prototype record.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Checks for an own-property string-data record with an ordinary or null prototype.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain data record.
 */
function isPlainRecord(value) {
  if (typeof value != "object" || value == null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every(key => {
    if (typeof key != "string") return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)

    return descriptor != undefined && descriptor.enumerable && "value" in descriptor && typeof descriptor.value == "string"
  })
}

/**
 * Checks one closed object-key set.
 * @param {Record<string, unknown>} value - Candidate record.
 * @param {string[]} keys - Exact allowed keys.
 * @returns {boolean} Whether the key sets match.
 */
function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("\0") == [...keys].sort().join("\0")
}
