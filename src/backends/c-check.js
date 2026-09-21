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
import {cRuntimeHeader} from "./c-runtime.js"

const compilerFlags = Object.freeze([
  "--no-default-config", "-std=c17", "-Wall", "-Wextra", "-Werror", "-pedantic-errors", "-Wconversion",
  "-Wsign-conversion", "-Wshadow", "-Wstrict-prototypes", "-Wmissing-prototypes", "-Wformat=2", "-ftrapv",
  "-finput-charset=UTF-8", "-fexec-charset=UTF-8", "-fno-color-diagnostics", "-O0"
])

/**
 * Constructs C's strict Clang C17 compile/link plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable C plan.
 */
export function createCCheckPlan(context) {
  const tool = checkTool(context, "clang", "c")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".c") || artifact.path.endsWith(".h"),
    "c", "only staged C translation units and headers")
  const sources = artifacts.filter(artifact => artifact.endsWith(".c"))
  const headers = artifacts.filter(artifact => artifact.endsWith(".h"))
  const support = context.artifacts.artifacts.filter(artifact => artifact.path == "semantifold_runtime.h")

  if (artifacts.length != 2 || sources.length != 1 || sources[0] != path.join(context.sourcePath, "program.c") ||
    headers.length != 1 || support.length != 1 || support[0].contentKind != "text" || support[0].role != "support" ||
    support[0].content != cRuntimeHeader) {
    throw new SemantifoldDiagnostic({code: "INVALID_TARGET_CHECK_PLAN", language: "c",
      message: "C developer checks require the exact producer-owned translation unit and support header."})
  }
  const objects = path.join(context.buildPath, "objects")
  const temporary = path.join(context.buildPath, "tmp")
  const environment = {TMPDIR: temporary}
  const environmentPaths = [environmentPath("TMPDIR", "build")]
  const objectPaths = sources.map((_, index) => path.join(objects, `${String(index).padStart(6, "0")}.o`))
  const stages = sources.map((source, index) => {
    const argv = [...compilerFlags, "-c", source, "-o", objectPaths[index]]

    return checkStage({
      argv,
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: [source, ...headers],
      output: null,
      pathArguments: [pathArgument(argv.length - 3, "source"), pathArgument(argv.length - 1, "build")],
      stage: /** @type {const} */ ("compile"),
      tool,
      transientPaths: [objects]
    })
  })
  const binary = path.join(context.buildPath, "semantifold-c")
  const linkArgv = ["--no-default-config", "-O0", ...objectPaths, "-o", binary]

  stages.push(checkStage({
    argv: linkArgv,
    cwd: context.sourcePath,
    environment,
    environmentPaths,
    inputs: objectPaths,
    output: checkOutput(context.buildPath, "application/x-executable", "linker-output"),
    pathArguments: [...objectPaths.map((_, index) => pathArgument(index + 2, "build")),
      pathArgument(linkArgv.length - 1, "build")],
    stage: "link",
    tool,
    transientPaths: [objects]
  }))

  return checkPlan(context, "c", artifacts, stages)
}
