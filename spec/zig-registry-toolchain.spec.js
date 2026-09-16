// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("Zig registry and qualified native tool identity", () => {
  it("declares one mapped native project with Task-005 function support", () => {
    expect(supportedLanguages).toContain("zig")
    expect(languageCapabilities.find(({id}) => id == "zig")).toMatchObject({
      id: "zig", artifactMultiplicity: "multiple", roundTrip: true,
      acceptance: {stages: ["parse", "generate", "compile", "validate", "execute"], toolchains: ["zig"]},
      features: {generalFunctionsAndCalls: true},
      roles: {frontend: true, textBackend: true, binaryBackend: false, applicationBackend: false, interoperability: false, provider: false},
      mapping: {richText: true, sourceMapV3: true, binaryRanges: false}
    })
    expect(canonicalToolchains.zig).toMatchObject({canonicalCommand: "zig", overrideEnvironmentVariable: "SEMANTIFOLD_ZIG"})
  })

  it("discovers only the selected real Zig 0.15.2 compiler", async () => {
    const zig = await discoverCanonicalToolchain("zig")

    expect(zig.version).toEqual("0.15.2")
    expect(zig.versionOutput).toEqual("0.15.2")
    await assert.rejects(discoverCanonicalToolchain("zig", {environment: {PATH: ""}}),
      error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
    await assert.rejects(discoverCanonicalToolchain("zig", {override: "/missing/task031-zig"}),
      error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
  })

  it("rejects another Zig release", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-zig-discovery-"))

    try {
      const executable = path.join(directory, "zig")

      await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '0.16.0'\n")
      await chmod(executable, 0o755)
      await assert.rejects(discoverCanonicalToolchain("zig", {override: executable}),
        error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION")
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })
})
