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
import {goModuleManifest} from "./go.js"

/**
 * Constructs Go's cgo-disabled, offline build/vet plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Go plan.
 */
export function createGoCheckPlan(context) {
  const tool = checkTool(context, "go", "go")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".go") || artifact.path == "go.mod",
    "go", "only staged '.go' sources and the canonical module manifest")
  const manifests = context.artifacts.artifacts.filter(artifact => artifact.path == "go.mod")
  const sources = artifacts.filter(artifact => artifact.endsWith(".go"))

  if (manifests.length != 1 || manifests[0].contentKind != "text" || manifests[0].role != "manifest" ||
    manifests[0].content != goModuleManifest || artifacts.length != 2 || sources.length != 1 ||
    sources[0] != path.join(context.sourcePath, "main.go")) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "go",
      message: "Go developer checks require the exact dependency-free 'go.mod' and at least one staged '.go' source."
    })
  }
  const cache = path.join(context.buildPath, "go-cache")
  const moduleCache = path.join(context.buildPath, "go-mod-cache")
  const goPath = path.join(context.buildPath, "go-path")
  const temporary = path.join(context.buildPath, "go-tmp")
  const home = path.join(context.buildPath, "go-home")
  const binary = path.join(context.buildPath, "semantifold-go")
  const environment = {
    CGO_ENABLED: "0",
    GOARCH: "amd64",
    GOCACHE: cache,
    GOENV: "off",
    GOMODCACHE: moduleCache,
    GOOS: "linux",
    GOPATH: goPath,
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    GOTMPDIR: temporary,
    GOVCS: "off",
    GOWORK: "off",
    GO_TELEMETRY_CHILD: "2",
    HOME: home
  }
  const environmentPaths = [
    environmentPath("GOCACHE", "build"), environmentPath("GOMODCACHE", "build"), environmentPath("GOPATH", "build"),
    environmentPath("GOTMPDIR", "build"), environmentPath("HOME", "build")
  ]

  return checkPlan(context, "go", artifacts, [
    checkStage({
      argv: ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", binary, "."],
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: checkOutput(context.buildPath, "application/x-executable", "compiler-output"),
      pathArguments: [pathArgument(6, "build")],
      stage: "compile",
      tool
    }),
    checkStage({
      argv: ["vet", "-mod=readonly", "."],
      cwd: context.sourcePath,
      environment,
      environmentPaths,
      inputs: artifacts,
      output: null,
      pathArguments: [],
      stage: "validate",
      tool
    })
  ])
}
