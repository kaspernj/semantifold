// @ts-check

import path from "node:path"
import {SemantifoldDiagnostic} from "../diagnostic.js"
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
 * Constructs Swift's warnings-as-errors type-check/compile plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Swift plan.
 */
export function createSwiftCheckPlan(context) {
  const tool = checkTool(context, "swiftc", "swift")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".swift"), "swift", "only staged '.swift' sources")

  if (artifacts.length != 1 || artifacts[0] != path.join(context.sourcePath, "program.swift")) {
    throw new SemantifoldDiagnostic({code: "INVALID_TARGET_CHECK_PLAN", language: "swift",
      message: "Swift developer checks require the exact producer-owned 'program.swift' source."})
  }
  const home = path.join(context.buildPath, "home")
  const cache = path.join(context.buildPath, "cache")
  const temporary = path.join(context.buildPath, "tmp")
  const environment = {
    HOME: home,
    PATH: [path.dirname(tool.executable), "/usr/bin", "/usr/local/bin", "/bin"].filter((value, index, values) =>
      values.indexOf(value) == index).join(path.delimiter),
    TMPDIR: temporary,
    XDG_CACHE_HOME: cache
  }
  const environmentPaths = [environmentPath("HOME", "build"), environmentPath("TMPDIR", "build"),
    environmentPath("XDG_CACHE_HOME", "build")]
  const objects = path.join(context.buildPath, "objects")
  const object = path.join(objects, "program.o")
  const binary = path.join(context.buildPath, "semantifold-swift")
  const typecheckArgv = [
    "--driver-mode=swiftc", "-warnings-as-errors", "-typecheck", "-module-name", "SemantifoldGenerated", ...artifacts
  ]
  const compileArgv = [
    "--driver-mode=swiftc", "-warnings-as-errors", "-c", ...artifacts,
    "-module-name", "SemantifoldGenerated", "-o", "program.o"
  ]
  const linkArgv = ["--driver-mode=swiftc", object, "-Xlinker", "--build-id=none", "-o", binary]

  return checkPlan(context, "swift", artifacts, [
    checkStage({
      argv: typecheckArgv,
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: artifacts.map((_, index) => pathArgument(index + 5, "source")),
      stage: "compile",
      tool
    }),
    checkStage({
      argv: compileArgv,
      cwd: objects,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: artifacts.map((_, index) => pathArgument(index + 3, "source")),
      stage: "compile",
      tool,
      transientPaths: [objects]
    }),
    checkStage({
      argv: linkArgv,
      cwd: context.buildPath,
      environment,
      environmentPaths,
      inputs: [object],
      output: checkOutput(context.buildPath, "application/x-executable", "compiler-output"),
      pathArguments: [pathArgument(1, "build"), pathArgument(linkArgv.length - 1, "build")],
      stage: "compile",
      tool,
      transientPaths: [objects]
    })
  ])
}
