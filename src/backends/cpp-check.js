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

const compilerFlags = Object.freeze([
  "--no-default-config", "--driver-mode=g++", "-std=c++20", "-stdlib=libstdc++", "-Wall", "-Wextra", "-Werror",
  "-pedantic-errors", "-Wconversion", "-Wsign-conversion", "-Wshadow", "-Wformat=2", "-fno-exceptions", "-fno-rtti",
  "-ftrapv", "-finput-charset=UTF-8", "-fexec-charset=UTF-8", "-fno-color-diagnostics", "-O0"
])

/**
 * Constructs C++'s strict Clang C++20/libstdc++ compile/link plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable C++ plan.
 */
export function createCppCheckPlan(context) {
  const tool = checkTool(context, "clangpp", "cpp")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".cpp"), "cpp", "only staged '.cpp' translation units")

  if (artifacts.length != 1 || artifacts[0] != path.join(context.sourcePath, "program.cpp")) {
    throw new SemantifoldDiagnostic({code: "INVALID_TARGET_CHECK_PLAN", language: "cpp",
      message: "C++ developer checks require the exact producer-owned 'program.cpp' translation unit."})
  }
  const objects = path.join(context.buildPath, "objects")
  const temporary = path.join(context.buildPath, "tmp")
  const environment = {TMPDIR: temporary}
  const environmentPaths = [environmentPath("TMPDIR", "build")]
  const objectPaths = artifacts.map((_, index) => path.join(objects, `${String(index).padStart(6, "0")}.o`))
  const stages = artifacts.map((source, index) => {
    const argv = [...compilerFlags, "-c", source, "-o", objectPaths[index]]

    return checkStage({
      argv,
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: [source],
      output: null,
      pathArguments: [pathArgument(argv.length - 3, "source"), pathArgument(argv.length - 1, "build")],
      stage: /** @type {const} */ ("compile"),
      tool,
      transientPaths: [objects]
    })
  })
  const binary = path.join(context.buildPath, "semantifold-cpp")
  const linkArgv = ["--no-default-config", "--driver-mode=g++", "-stdlib=libstdc++", "-O0", ...objectPaths, "-o", binary]

  stages.push(checkStage({
    argv: linkArgv,
    cwd: context.sourcePath,
    environment,
    environmentPaths,
    inputs: objectPaths,
    output: checkOutput(context.buildPath, "application/x-executable", "linker-output"),
    pathArguments: [...objectPaths.map((_, index) => pathArgument(index + 4, "build")),
      pathArgument(linkArgv.length - 1, "build")],
    stage: "link",
    tool,
    transientPaths: [objects]
  }))

  return checkPlan(context, "cpp", artifacts, stages)
}
