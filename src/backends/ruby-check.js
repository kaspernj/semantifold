// @ts-check

import {checkArtifacts, checkPlan, checkStage, checkTool, pathArgument} from "./check-plan.js"

/**
 * Constructs Ruby's non-executing syntax-check plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Ruby plan.
 */
export function createRubyCheckPlan(context) {
  const tool = checkTool(context, "ruby", "ruby")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".rb"), "ruby", "only staged '.rb' artifacts")

  return checkPlan(context, "ruby", artifacts, artifacts.map(artifact => checkStage({
    argv: ["--disable=gems", "-c", artifact],
    cwd: context.sourcePath,
    inputs: [artifact],
    output: null,
    pathArguments: [pathArgument(2, "source")],
    stage: "validate",
    tool
  })))
}
