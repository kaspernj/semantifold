// @ts-check

import {createHash} from "node:crypto"
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
 * Constructs C#'s offline restore and non-executing build plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable C# plan.
 */
export function createCSharpCheckPlan(context) {
  const tool = checkTool(context, "dotnet", "csharp")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".cs") || artifact.path.endsWith(".csproj") ||
    path.basename(artifact.path) == "packages.lock.json", "csharp", "only staged C# project, source, and lock artifacts")
  const projects = context.artifacts.artifacts.filter(artifact => artifact.path.endsWith(".csproj"))

  if (projects.length != 1) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "csharp",
      message: "C# developer checks require exactly one staged '.csproj' artifact."
    })
  }
  const restoreArtifacts = context.artifacts.artifacts
    .filter(artifact => artifact.path.endsWith(".csproj") || path.basename(artifact.path) == "packages.lock.json")
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
  const restoreInputs = Object.freeze(restoreArtifacts.map(artifact => path.join(context.sourcePath, artifact.path)))
  const restoreHash = createHash("sha256")

  for (const artifact of restoreArtifacts) {
    const contentLength = typeof artifact.content == "string" ? Buffer.byteLength(artifact.content) : artifact.content.byteLength

    restoreHash.update(`${Buffer.byteLength(artifact.path)}:`).update(artifact.path)
      .update(`${contentLength}:`).update(artifact.content)
  }
  const inputHash = restoreHash.digest("hex")
  const projectPath = path.join(context.sourcePath, projects[0].path)
  const packages = path.join(context.buildPath, "nuget-packages")
  const intermediatePath = path.join(context.buildPath, "obj")
  const intermediate = `${intermediatePath}/`
  const output = path.join(context.buildPath, "bin")
  const restoreArgv = [
    "restore", projectPath, "--source", context.sourcePath, "--packages", packages, "--no-cache", "--force",
    "--disable-parallel",
    ...(restoreArtifacts.some(artifact => path.basename(artifact.path) == "packages.lock.json") ? ["--locked-mode"] : []),
    "--nologo", `--property:BaseIntermediateOutputPath=${intermediate}`,
    `--property:MSBuildProjectExtensionsPath=${intermediate}`
  ]
  const compileArgv = [
    "build", projectPath, "--configuration", "Release", "--no-restore", "--nologo", "--warnaserror",
    "--disable-build-servers", "--output", output, "--property:UseSharedCompilation=false",
    `--property:BaseIntermediateOutputPath=${intermediate}`,
    `--property:MSBuildProjectExtensionsPath=${intermediate}`
  ]
  const environment = {
    DOTNET_CLI_HOME: path.join(context.buildPath, "dotnet-home"),
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_CLI_USE_MSBUILD_SERVER: "0",
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
    HOME: path.join(context.buildPath, "home"),
    NUGET_HTTP_CACHE_PATH: path.join(context.buildPath, "nuget-http-cache"),
    NUGET_PACKAGES: packages,
    NUGET_PLUGINS_CACHE_PATH: path.join(context.buildPath, "nuget-plugins-cache"),
    TMPDIR: path.join(context.buildPath, "tmp"),
    XDG_CACHE_HOME: path.join(context.buildPath, "cache")
  }
  const environmentPaths = [
    environmentPath("DOTNET_CLI_HOME", "build"), environmentPath("HOME", "build"),
    environmentPath("NUGET_HTTP_CACHE_PATH", "build"), environmentPath("NUGET_PACKAGES", "build"),
    environmentPath("NUGET_PLUGINS_CACHE_PATH", "build"), environmentPath("TMPDIR", "build"),
    environmentPath("XDG_CACHE_HOME", "build")
  ]
  const ownedOutput = checkOutput(context.buildPath, "application/octet-stream", "compiler-output")
  const restore = checkStage({
    argv: restoreArgv,
    cwd: context.sourcePath,
    environment,
    environmentPaths,
    inputHash,
    inputs: restoreInputs,
    output: null,
    pathArguments: [
      pathArgument(1, "source"), pathArgument(3, "source"), pathArgument(5, "build"),
      pathArgument(restoreArgv.length - 2, "build", "--property:BaseIntermediateOutputPath="),
      pathArgument(restoreArgv.length - 1, "build", "--property:MSBuildProjectExtensionsPath=")
    ],
    stage: "restore",
    tool,
    transientPaths: [intermediatePath]
  })
  const compile = checkStage({
    argv: compileArgv,
    cwd: context.sourcePath,
    environment,
    environmentPaths,
    inputs: artifacts,
    output: ownedOutput,
    pathArguments: [
      pathArgument(1, "source"), pathArgument(9, "build"),
      pathArgument(11, "build", "--property:BaseIntermediateOutputPath="),
      pathArgument(12, "build", "--property:MSBuildProjectExtensionsPath=")
    ],
    stage: "compile",
    tool,
    transientPaths: [intermediatePath]
  })

  return checkPlan(context, "csharp", artifacts, [restore, compile])
}
