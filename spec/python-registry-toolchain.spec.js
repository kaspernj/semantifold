// @ts-check

import assert from "node:assert/strict"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic} from "../index.js"

describe("Python registry and toolchain", () => {
  it("registers Python as a truthful round-trip single-text language", () => {
    const python = languageCapabilities.find(({id}) => id == "python")

    expect(python).toEqual({
      acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["python"]},
      artifactMultiplicity: "single",
      id: "python",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
      roundTrip: true
    })
  })

  it("discovers the configured real Python 3 executable and fails when it is missing", async () => {
    expect(canonicalToolchains.python).toEqual({
      canonicalCommand: "python3",
      overrideEnvironmentVariable: "SEMANTIFOLD_PYTHON",
      supportedVersion: /^Python 3\./u,
      versionArguments: ["--version"]
    })
    const python = await discoverCanonicalToolchain("python")

    expect(path.isAbsolute(python.executable)).toBeTrue()
    expect(python.version).toMatch(/^Python 3\./u)
    await assert.rejects(
      () => discoverCanonicalToolchain("python", {environment: {PATH: ""}}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND" && error.language == "python"
    )
  })
})
