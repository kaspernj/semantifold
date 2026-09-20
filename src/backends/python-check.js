// @ts-check

import path from "node:path"
import {checkArtifacts, checkOutput, checkPlan, checkStage, checkTool, pathArgument} from "./check-plan.js"

/**
 * Constructs Python's isolated bytecode compiler plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Python plan.
 */
export function createPythonCheckPlan(context) {
  const tool = checkTool(context, "python", "python")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".py"), "python", "only staged '.py' artifacts")
  const compiler = "import py_compile,sys;[py_compile.compile(sys.argv[index],cfile=sys.argv[index+1],dfile=sys.argv[index+2],doraise=True,invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH) for index in range(1,len(sys.argv),3)]"
  const arguments_ = artifacts.flatMap(artifactPath => [
    artifactPath,
    path.join(context.buildPath, `${path.basename(artifactPath, ".py")}.pyc`),
    path.basename(artifactPath)
  ])

  return checkPlan(context, "python", artifacts, [checkStage({
    argv: ["-I", "-B", "-c", compiler, ...arguments_],
    cwd: context.sourcePath,
    inputs: artifacts,
    output: checkOutput(context.buildPath, "application/x-python-bytecode", "compiler-output"),
    pathArguments: artifacts.flatMap((_, index) => [pathArgument(4 + index * 3, "source"), pathArgument(5 + index * 3, "build")]),
    stage: "compile",
    tool
  })])
}
