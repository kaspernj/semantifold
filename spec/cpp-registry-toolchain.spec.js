// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("C++ registration and Clang toolchain", () => {
  it("registers an independent single-text CPP lane with native stages", () => {
    expect(supportedLanguages).toContain("cpp")
    expect(languageCapabilities.find(({id}) => id == "cpp")).toMatchObject({
      id: "cpp", artifactMultiplicity: "single", roundTrip: true,
      acceptance: {stages: ["parse", "generate", "compile", "link", "execute"], toolchains: ["clangpp"]},
      roles: {frontend: true, textBackend: true, binaryBackend: false, applicationBackend: false, interoperability: false},
      mapping: {richText: true, sourceMapV3: true, binaryRanges: false}
    })
    expect(canonicalToolchains.clangpp).toMatchObject({canonicalCommand: "clang++", overrideEnvironmentVariable: "SEMANTIFOLD_CLANGPP"})
  })

  it("discovers the real Clang21 C++ driver and fails for absent configured tools", async () => {
    const tool = await discoverCanonicalToolchain("clangpp", {override: "/usr/bin/clang++-21"})

    expect(tool.command).toEqual("clang++")
    expect(tool.version).toMatch(/^Ubuntu clang version 21\.1\.8 /u)
    expect(tool.versionOutput).toContain("Target: x86_64-pc-linux-gnu")
    await assert.rejects(discoverCanonicalToolchain("clangpp", {environment: {PATH: ""}}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
    await assert.rejects(discoverCanonicalToolchain("clangpp", {override: "/missing/clang++"}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
  })
})
