// @ts-check

import {checkArtifacts, checkPlan, checkStage, checkTool, pathArgument} from "./check-plan.js"

/**
 * Constructs PHP's non-executing syntax-check plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable PHP plan.
 */
export function createPhpCheckPlan(context) {
  const tool = checkTool(context, "php82", "php")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".php"), "php", "only staged '.php' artifacts")

  return checkPlan(context, "php", artifacts, artifacts.map(artifact => checkStage({
    argv: ["-n", "-l", artifact],
    cwd: context.sourcePath,
    inputs: [artifact],
    output: null,
    pathArguments: [pathArgument(2, "source")],
    stage: "validate",
    tool
  })))
}
