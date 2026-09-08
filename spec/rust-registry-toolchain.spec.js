// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("Rust registry and qualified native tool identities", () => {
  it("declares one mapped Cargo artifact set with both required compiler tools", () => {
    expect(supportedLanguages).toContain("rust")
    expect(languageCapabilities.find(({id}) => id == "rust")).toMatchObject({
      id: "rust", artifactMultiplicity: "multiple", roundTrip: true,
      acceptance: {stages: ["parse", "generate", "compile", "validate", "execute"], toolchains: ["rustc", "cargo"]},
      roles: {frontend: true, textBackend: true, binaryBackend: false, applicationBackend: false, interoperability: false},
      mapping: {richText: true, sourceMapV3: true, binaryRanges: false}
    })
    expect(canonicalToolchains.rustc).toMatchObject({canonicalCommand: "rustc", overrideEnvironmentVariable: "SEMANTIFOLD_RUSTC"})
    expect(canonicalToolchains.cargo).toMatchObject({canonicalCommand: "cargo", overrideEnvironmentVariable: "SEMANTIFOLD_CARGO"})
  })

  it("discovers the real exact rustc/Cargo pair and fails loudly for absent tools", async () => {
    const rustc = await discoverCanonicalToolchain("rustc")
    const cargo = await discoverCanonicalToolchain("cargo")

    expect(rustc.version).toEqual("rustc 1.98.1 (48a229cea 2026-09-01)")
    expect(cargo.version).toEqual("cargo 1.98.1 (797e8a9bc 2026-08-05)")
    expect(rustc.versionOutput).toContain("commit-hash: 48a229ceaefd4985c50990b14116b6d856af0985")
    expect(cargo.versionOutput).toContain("commit-hash: 797e8a9bca276c1c9f9f738d2a20f484fa4eea9d")
    for (const tool of [rustc, cargo]) expect(tool.versionOutput).toContain("host: x86_64-unknown-linux-gnu")
    for (const id of ["rustc", "cargo"]) {
      await assert.rejects(discoverCanonicalToolchain(id, {environment: {PATH: ""}}),
        error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
      await assert.rejects(discoverCanonicalToolchain(id, {override: "/missing/task020-tool"}),
        error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
    }
  })

  it("rejects swapped tools, unsupported releases, wrong commits and foreign hosts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-rust-discovery-"))

    try {
      const rustc = await discoverCanonicalToolchain("rustc")
      const cargo = await discoverCanonicalToolchain("cargo")

      await assert.rejects(discoverCanonicalToolchain("cargo", {override: rustc.executable}),
        error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION")
      for (const [id, original] of [["rustc", rustc], ["cargo", cargo]]) {
        for (const output of [original.versionOutput.replaceAll("1.98.1", "1.97.0"),
          original.versionOutput.replace("commit-hash: ", "commit-hash: wrong"),
          original.versionOutput.replaceAll("x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu")]) {
          const executable = path.join(directory, id)

          await writeFile(executable, "#!/bin/sh\ncat <<'VERSION'\n" + output + "\nVERSION\n")
          await chmod(executable, 0o755)
          await assert.rejects(discoverCanonicalToolchain(id, {override: executable}),
            error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION")
        }
      }
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })
})
