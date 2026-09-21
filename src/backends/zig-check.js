// @ts-check

import path from "node:path"
import {SemantifoldDiagnostic} from "../diagnostic.js"
import {
  checkArtifacts,
  checkPlan,
  checkStage,
  checkTool,
  environmentPath,
  pathArgument
} from "./check-plan.js"
import {zigBuild} from "./zig-runtime.js"

/**
 * Constructs Zig's isolated Debug project build and canonical format-check plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Zig plan.
 */
export function createZigCheckPlan(context) {
  const tool = checkTool(context, "zig", "zig")
  const artifacts = checkArtifacts(context, artifact => artifact.path == "build.zig" || artifact.path.endsWith(".zig"),
    "zig", "only staged Zig source and the canonical build manifest")
  const manifests = context.artifacts.artifacts.filter(artifact => artifact.path == "build.zig")
  const sources = artifacts.filter(artifact => artifact != path.join(context.sourcePath, "build.zig"))

  if (manifests.length != 1 || manifests[0].contentKind != "text" || manifests[0].role != "manifest" ||
    manifests[0].content != zigBuild || artifacts.length != 2 || sources.length != 1 ||
    sources[0] != path.join(context.sourcePath, "src/main.zig")) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "zig",
      message: "Zig developer checks require the exact standard-library-only 'build.zig' and staged Zig source."
    })
  }
  const home = path.join(context.buildPath, "home")
  const temporary = path.join(context.buildPath, "tmp")
  const globalCache = path.join(context.buildPath, "zig-global-cache")
  const localCache = path.join(context.buildPath, "zig-local-cache")
  const output = path.join(context.buildPath, "output")
  const environment = {
    HOME: home,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
    TMPDIR: temporary,
    ZIG_GLOBAL_CACHE_DIR: globalCache,
    ZIG_LOCAL_CACHE_DIR: localCache
  }
  const environmentPaths = [
    environmentPath("HOME", "build"), environmentPath("TMPDIR", "build"),
    environmentPath("ZIG_GLOBAL_CACHE_DIR", "build"), environmentPath("ZIG_LOCAL_CACHE_DIR", "build")
  ]
  const formatArgv = ["fmt", "--check", ...artifacts]

  return checkPlan(context, "zig", artifacts, [
    checkStage({
      argv: ["build", "-Doptimize=Debug", "--prefix", output],
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: [pathArgument(3, "build")],
      stage: "compile",
      tool,
      transientPaths: [output]
    }),
    checkStage({
      argv: formatArgv,
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: artifacts.map((_, index) => pathArgument(index + 2, "source")),
      stage: "validate",
      tool
    })
  ])
}
