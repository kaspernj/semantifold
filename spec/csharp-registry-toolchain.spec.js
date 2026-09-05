// @ts-check

import assert from "node:assert/strict"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
  discoverCanonicalToolchain,
  languageCapabilities,
  SemantifoldDiagnostic,
  supportedLanguages
} from "../index.js"

describe("C# registry and toolchain", () => {
  it("registers C# last as a truthful round-trip multi-artifact text language", () => {
    expect(supportedLanguages.at(-1)).toEqual("csharp")
    expect(languageCapabilities.find(({id}) => id == "csharp")).toEqual({
      acceptance: {stages: ["parse", "generate", "restore", "compile", "execute"], toolchains: ["dotnet"]},
      artifactMultiplicity: "multiple",
      id: "csharp",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
      roundTrip: true
    })
  })

  it("discovers the configured real .NET 10 SDK and fails when it is missing", async () => {
    expect(canonicalToolchains.dotnet).toEqual({
      canonicalCommand: "dotnet",
      overrideEnvironmentVariable: "SEMANTIFOLD_DOTNET",
      supportedVersion: /^10\./u,
      versionArguments: ["--version"]
    })
    const dotnet = await discoverCanonicalToolchain("dotnet")

    expect(path.isAbsolute(dotnet.executable)).toBeTrue()
    expect(dotnet.version).toMatch(/^10\./u)
    await assert.rejects(
      () => discoverCanonicalToolchain("dotnet", {environment: {PATH: ""}}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND" && error.language == "dotnet"
    )
  })
})
