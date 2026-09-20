// @ts-check

import path from "node:path"
import {SemantifoldDiagnostic} from "../diagnostic.js"
import {checkArtifacts, checkPlan, checkStage, checkTool, pathArgument} from "./check-plan.js"

/**
 * Constructs TypeScript's non-emitting compiler plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable TypeScript plan.
 */
export function createTypeScriptCheckPlan(context) {
  const tool = checkTool(context, "tsc", "typescript")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".ts") || path.basename(artifact.path) == "package.json",
    "typescript", "only staged '.ts' artifacts and package manifests")
  const sources = artifacts.filter(artifact => artifact.endsWith(".ts"))

  if (sources.length == 0) {
    throw new SemantifoldDiagnostic({code: "INVALID_TARGET_CHECK_PLAN", language: "typescript",
      message: "TypeScript developer checks require at least one staged '.ts' artifact."})
  }
  const typeRoots = path.join(context.buildPath, "types")
  const argv = [
    "--pretty", "false", "--noEmit", "--incremental", "false", "--target", "ES2024", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--typeRoots", typeRoots, ...sources
  ]

  return checkPlan(context, "typescript", artifacts, [checkStage({
    argv,
    cwd: context.sourcePath,
    inputs: artifacts,
    output: null,
    pathArguments: [pathArgument(12, "build"), ...sources.map((_, index) => pathArgument(13 + index, "source"))],
    stage: "compile",
    tool
  })])
}
