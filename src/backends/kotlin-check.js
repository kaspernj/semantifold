// @ts-check

import path from "node:path"
import {
  checkArtifacts,
  checkOutput,
  checkPlan,
  checkStage,
  checkTool,
  environmentPath,
  pathArgument
} from "./check-plan.js"

/**
 * Constructs Kotlin/JVM's non-executing compiler plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Kotlin plan.
 */
export function createKotlinCheckPlan(context) {
  const tool = checkTool(context, "kotlinc", "kotlin")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".kt"), "kotlin", "only staged '.kt' artifacts")
  const classes = path.join(context.buildPath, "classes")
  const home = path.join(context.buildPath, "home")
  const cache = path.join(context.buildPath, "cache")
  const temporary = path.join(context.buildPath, "tmp")

  return checkPlan(context, "kotlin", artifacts, [checkStage({
    argv: ["-language-version", "2.4", "-api-version", "2.4", "-jvm-target", "25", "-Werror", ...artifacts, "-d", classes],
    cwd: context.sourcePath,
    environment: {HOME: home, TMPDIR: temporary, XDG_CACHE_HOME: cache},
    environmentPaths: [environmentPath("HOME", "build"), environmentPath("TMPDIR", "build"), environmentPath("XDG_CACHE_HOME", "build")],
    inputs: artifacts,
    output: checkOutput(context.buildPath, "application/java-vm", "compiler-output"),
    pathArguments: [
      ...artifacts.map((_, index) => pathArgument(7 + index, "source")),
      pathArgument(8 + artifacts.length, "build")
    ],
    stage: "compile",
    tool
  })])
}
