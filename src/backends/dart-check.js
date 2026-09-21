// @ts-check

import {createHash} from "node:crypto"
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
import {dartLockfile, dartPubspec} from "./dart.js"

/**
 * Constructs Dart's offline package verification, native compile, format and analysis plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Dart plan.
 */
export function createDartCheckPlan(context) {
  const tool = checkTool(context, "dart", "dart")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".dart") ||
    artifact.path == "pubspec.yaml" || artifact.path == "pubspec.lock",
  "dart", "only staged Dart source and canonical pub package/lock artifacts")
  const pubspecs = context.artifacts.artifacts.filter(artifact => artifact.path == "pubspec.yaml")
  const lockfiles = context.artifacts.artifacts.filter(artifact => artifact.path == "pubspec.lock")
  const sources = artifacts.filter(artifact => artifact.endsWith(".dart"))

  if (pubspecs.length != 1 || pubspecs[0].contentKind != "text" || pubspecs[0].role != "manifest" ||
    pubspecs[0].content != dartPubspec || lockfiles.length != 1 || lockfiles[0].contentKind != "text" ||
    lockfiles[0].role != "manifest" || lockfiles[0].content != dartLockfile || artifacts.length != 3 || sources.length != 1 ||
    sources[0] != path.join(context.sourcePath, "bin/program.dart")) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "dart",
      message: "Dart developer checks require the exact dependency-free pub package/lock and staged '.dart' source."
    })
  }
  const restoreArtifacts = context.artifacts.artifacts.filter(artifact =>
    artifact.path == "pubspec.yaml" || artifact.path == "pubspec.lock").sort((left, right) => left.path.localeCompare(right.path, "en"))
  const restoreInputs = Object.freeze(restoreArtifacts.map(artifact => path.join(context.sourcePath, artifact.path)))
  const restoreHash = createHash("sha256")

  for (const artifact of restoreArtifacts) {
    const contentLength = typeof artifact.content == "string" ? Buffer.byteLength(artifact.content) : artifact.content.byteLength

    restoreHash.update(`${Buffer.byteLength(artifact.path)}:`).update(artifact.path)
      .update(`${contentLength}:`).update(artifact.content)
  }
  const home = path.join(context.buildPath, "home")
  const pubCache = path.join(context.buildPath, "pub-cache")
  const temporary = path.join(context.buildPath, "tmp")
  const environment = {
    CI: "true",
    DART_SUPPRESS_ANALYTICS: "true",
    HOME: home,
    PUB_CACHE: pubCache,
    PUB_HOSTED_URL: "http://127.0.0.1:9",
    TMPDIR: temporary
  }
  const environmentPaths = [environmentPath("HOME", "build"), environmentPath("PUB_CACHE", "build"),
    environmentPath("TMPDIR", "build")]
  const nativeOutput = path.join(context.buildPath, "native-output")
  const binary = path.join(nativeOutput, "semantifold-dart")
  const compileArgv = ["compile", "exe", sources[0], "-o", binary]

  return checkPlan(context, "dart", artifacts, [
    checkStage({
      argv: ["pub", "get", "--offline", "--dry-run", "--enforce-lockfile", "--no-precompile"],
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputHash: restoreHash.digest("hex"),
      inputs: restoreInputs,
      output: null,
      pathArguments: [],
      stage: "restore",
      tool,
      transientPaths: [path.join(context.sourcePath, ".dart_tool")]
    }),
    checkStage({
      argv: compileArgv,
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: [pathArgument(2, "source"), pathArgument(4, "build")],
      stage: "compile",
      tool,
      transientPaths: [nativeOutput]
    }),
    checkStage({
      argv: ["format", "--output=none", "--set-exit-if-changed", sources[0]],
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: sources,
      output: null,
      pathArguments: [pathArgument(3, "source")],
      stage: "validate",
      tool
    }),
    checkStage({
      argv: ["analyze", "--fatal-infos", "--fatal-warnings", context.sourcePath],
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: [pathArgument(3, "source")],
      stage: "validate",
      tool
    })
  ])
}
