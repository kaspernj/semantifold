// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("C registry and canonical Clang toolchain", () => {
  it("registers C independently with complete multi-artifact native acceptance roles", () => {
    expect(supportedLanguages.indexOf("c")).toEqual(8)
    expect(languageCapabilities.find(({id}) => id == "c")).toMatchObject({
      acceptance: {stages: ["parse", "generate", "compile", "link", "execute"], toolchains: ["clang"]},
      artifactMultiplicity: "multiple", id: "c", mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true}, roundTrip: true
    })
    expect(canonicalToolchains.clang.canonicalCommand).toEqual("clang")
    expect(canonicalToolchains.clang.overrideEnvironmentVariable).toEqual("SEMANTIFOLD_CLANG")
  })
  it("discovers real Clang 21 with its Linux x86-64 version and executable", async () => {
    const clang = await discoverCanonicalToolchain("clang")

    expect(clang.command).toEqual("clang")
    expect(clang.version).toMatch(/^Ubuntu clang version 21\.1\.8 /u)
    expect(clang.versionOutput).toContain("Target: x86_64-pc-linux-gnu")
    expect(clang.executable).toEqual("/usr/lib/llvm-21/bin/clang")
    expect(Object.isFrozen(clang)).toBeTrue()
  })

  it("fails loudly when the required C compiler is unavailable", async () => {
    await assert.rejects(() => discoverCanonicalToolchain("clang", {environment: {PATH: ""}}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND" && error.language == "clang")
  })
})
