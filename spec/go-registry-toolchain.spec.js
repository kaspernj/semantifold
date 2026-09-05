// @ts-check

import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, supportedLanguages} from "../index.js"

describe("Go registry and toolchain", () => {
  it("registers Go last as a round-trip multi-artifact text language", () => {
    expect(supportedLanguages.at(-1)).toEqual("go")
    expect(languageCapabilities.find(({id}) => id == "go")).toEqual({
      acceptance: {stages: ["parse", "generate", "compile", "validate", "execute"], toolchains: ["go"]},
      artifactMultiplicity: "multiple",
      id: "go",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
      roundTrip: true
    })
  })

  it("discovers the canonical Go 1.26 Linux amd64 executable", async () => {
    const go = await discoverCanonicalToolchain(/** @type {any} */ ("go"))

    expect(canonicalToolchains[/** @type {keyof typeof canonicalToolchains} */ ("go")]).toEqual({
      canonicalCommand: "go",
      overrideEnvironmentVariable: "SEMANTIFOLD_GO",
      supportedVersion: /^go version go1\.26\.\d+ linux\/amd64$/u,
      versionArguments: ["version"]
    })
    expect(path.isAbsolute(go.executable)).toBeTrue()
    expect(go.version).toMatch(/^go version go1\.26\.\d+ linux\/amd64$/u)
  })
})
