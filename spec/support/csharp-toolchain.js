// @ts-check

import {mkdtemp, rm} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {discoverCanonicalToolchain, generateArtifactSet, runAcceptanceStages} from "../../index.js"

/**
 * Restores, builds, and executes one generated C# project with isolated packages.
 * @param {import("../../src/semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {Promise<import("../../src/semantic/types.js").AcceptanceResult>} Staged acceptance result.
 */
export async function executeCSharp(module) {
  const dotnet = await discoverCanonicalToolchain("dotnet")
  const packages = await mkdtemp(path.join(os.tmpdir(), "semantifold-nuget-"))

  try {
    return await runAcceptanceStages({
      artifacts: generateArtifactSet({language: "csharp", module}),
      environment: dotnetEnvironment(packages),
      stages: [
        {arguments: ["restore", "Semantifold.csproj", "--source", ".", "--no-cache", "--force", "--disable-parallel", "--nologo"], stage: "restore", tool: dotnet},
        {arguments: ["build", "Semantifold.csproj", "--configuration", "Release", "--no-restore", "--nologo", "--warnaserror"], stage: "compile", tool: dotnet},
        {arguments: ["exec", "bin/Release/net10.0/Semantifold.dll"], stage: "execute", tool: dotnet}
      ],
      target: "csharp",
      timeoutMs: 30_000
    })
  } finally {
    await rm(packages, {force: true, recursive: true})
  }
}

/**
 * Creates the exact isolated environment for C# project acceptance.
 * @param {string} packages - Absolute NuGet package cache path.
 * @returns {Record<string, string | undefined>} Child environment.
 */
export function dotnetEnvironment(packages) {
  return {
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
    LC_ALL: "C.UTF-8",
    NUGET_PACKAGES: packages,
    PATH: process.env.PATH,
    TZ: "UTC"
  }
}
