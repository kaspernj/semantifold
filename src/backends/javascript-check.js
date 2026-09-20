// @ts-check

import path from "node:path"
import {checkArtifacts, checkPlan, checkStage, checkTool, pathArgument} from "./check-plan.js"
import {SemantifoldDiagnostic} from "../diagnostic.js"

/**
 * Constructs JavaScript's non-executing parse-check plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable JavaScript plan.
 */
export function createJavaScriptCheckPlan(context) {
  const tool = checkTool(context, "node", "javascript")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".js") || path.basename(artifact.path) == "package.json",
    "javascript", "only staged '.js' artifacts and package manifests")
  const sources = artifacts.filter(artifact => artifact.endsWith(".js"))
  const manifests = artifacts.filter(artifact => artifact.endsWith("package.json"))

  if (sources.length == 0) {
    throw new SemantifoldDiagnostic({code: "INVALID_TARGET_CHECK_PLAN", language: "javascript",
      message: "JavaScript developer checks require at least one staged '.js' artifact."})
  }

  return checkPlan(context, "javascript", artifacts, sources.map((source, index) => checkStage({
    argv: ["--check", source],
    cwd: context.sourcePath,
    inputs: [source, ...(index == 0 ? manifests : [])],
    output: null,
    pathArguments: [pathArgument(1, "source")],
    stage: "validate",
    tool
  })))
}
