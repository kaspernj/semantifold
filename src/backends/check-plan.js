// @ts-check

import path from "node:path"
import {SemantifoldDiagnostic} from "../diagnostic.js"
import {deterministicEnvironment} from "../toolchains.js"

/**
 * Resolves one target-declared discovered tool from immutable plan context.
 * @param {Readonly<{tools: readonly import("../semantic/types.js").DiscoveredToolchain[]}>} context - Plan context.
 * @param {string} id - Declared toolchain identity.
 * @param {string} target - Target diagnostic identity.
 * @returns {import("../semantic/types.js").DiscoveredToolchain} Exact tool.
 */
export function checkTool(context, id, target) {
  const tool = context.tools.find(candidate => candidate.id == id)

  if (!tool) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: target,
      message: `Target '${target}' developer checks require the declared '${id}' toolchain.`
    })
  }

  return tool
}

/**
 * Resolves all staged artifacts matching one target-owned predicate.
 * @param {Readonly<{artifacts: import("../semantic/types.js").GeneratedArtifactSet, sourcePath: string}>} context - Plan context.
 * @param {(artifact: import("../semantic/types.js").GeneratedSetArtifact) => boolean} accepts - Target-owned artifact predicate.
 * @param {string} target - Target diagnostic identity.
 * @param {string} description - Required artifact description.
 * @returns {readonly string[]} Ordered absolute artifact paths.
 */
export function checkArtifacts(context, accepts, target, description) {
  const accepted = context.artifacts.artifacts.filter(accepts)

  if (accepted.length == 0 || accepted.length != context.artifacts.artifacts.length) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: target,
      message: `Target '${target}' developer checks require ${description}.`
    })
  }

  return Object.freeze(accepted.map(artifact => path.join(context.sourcePath, artifact.path))
    .sort((left, right) => left.localeCompare(right, "en")))
}

/**
 * Freezes one closed target-check stage request.
 * @param {object} input - Complete stage data.
 * @param {readonly string[]} input.argv - Exact argv.
 * @param {string} input.cwd - Candidate-owned working directory.
 * @param {Readonly<Record<string, string | undefined>>} [input.environment] - Target-owned environment additions.
 * @param {readonly import("../semantic/types.js").TargetCheckEnvironmentPath[]} [input.environmentPaths] - Owned environment paths.
 * @param {string | null} [input.inputHash] - Restore-input hash when applicable.
 * @param {readonly string[]} input.inputs - Exact staged inputs read by the tool.
 * @param {import("../semantic/types.js").TargetCheckOutputOwnership | null} input.output - Produced build ownership.
 * @param {readonly import("../semantic/types.js").TargetCheckPathArgument[]} input.pathArguments - Owned argv paths.
 * @param {import("../semantic/types.js").AcceptanceStage} input.stage - Stage identity.
 * @param {import("../semantic/types.js").DiscoveredToolchain} input.tool - Exact tool.
 * @param {readonly string[]} [input.transientPaths] - Owned cache/intermediate directories.
 * @returns {import("../semantic/types.js").TargetCheckStageRequest} Immutable stage.
 */
export function checkStage(input) {
  return Object.freeze({
    argv: Object.freeze([...input.argv]),
    cwd: input.cwd,
    environment: deterministicEnvironment(input.environment ?? {}),
    environmentPaths: Object.freeze([...(input.environmentPaths ?? [])]),
    executable: input.tool.executable,
    inputHash: input.inputHash ?? null,
    inputs: Object.freeze([...input.inputs]),
    output: input.output,
    pathArguments: Object.freeze([...input.pathArguments]),
    stage: input.stage,
    tool: input.tool,
    transientPaths: Object.freeze([...(input.transientPaths ?? [])])
  })
}

/**
 * Freezes one closed target-owned plan.
 * @param {Readonly<{buildPath: string, projectId: string, sourcePath: string, targetId: string}>} context - Plan context.
 * @param {string} target - Target identity.
 * @param {readonly string[]} artifactPaths - Complete staged artifact vector.
 * @param {readonly import("../semantic/types.js").TargetCheckStageRequest[]} stages - Ordered stages.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable plan.
 */
export function checkPlan(context, target, artifactPaths, stages) {
  return Object.freeze({
    artifactPaths,
    buildPath: context.buildPath,
    mode: /** @type {const} */ ("developer-check"),
    projectId: context.projectId,
    schema: /** @type {const} */ ("SemantifoldTargetCheckPlan"),
    sourcePath: context.sourcePath,
    stages: Object.freeze([...stages]),
    target,
    targetId: context.targetId,
    version: /** @type {const} */ (1)
  })
}

/**
 * Freezes one owned argv-path declaration.
 * @param {number} index - Exact argv index.
 * @param {"source" | "build"} ownership - Owning candidate subtree.
 * @param {string} [prefix] - Optional non-path argument prefix.
 * @returns {import("../semantic/types.js").TargetCheckPathArgument} Immutable declaration.
 */
export function pathArgument(index, ownership, prefix) {
  return Object.freeze({index, ownership, ...(prefix === undefined ? {} : {prefix})})
}

/**
 * Freezes one owned environment-directory declaration.
 * @param {string} name - Exact environment variable.
 * @param {"source" | "build"} ownership - Owning candidate subtree.
 * @returns {import("../semantic/types.js").TargetCheckEnvironmentPath} Immutable declaration.
 */
export function environmentPath(name, ownership) {
  return Object.freeze({name, ownership})
}

/**
 * Freezes build-output ownership metadata.
 * @param {string} buildPath - Exact candidate build root.
 * @param {string} mediaType - Output media type.
 * @param {string} role - Language-neutral output role.
 * @returns {import("../semantic/types.js").TargetCheckOutputOwnership} Immutable ownership.
 */
export function checkOutput(buildPath, mediaType, role) {
  return Object.freeze({mediaType, ownership: /** @type {const} */ ("build"), path: buildPath, role})
}
