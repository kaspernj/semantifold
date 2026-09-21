// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
  discoverCanonicalToolchain,
  generate,
  generateArtifact,
  generateArtifactSet,
  languageCapabilities,
  parse,
  SemantifoldDiagnostic,
  supportedLanguages
} from "../index.js"

describe("Dart registry and toolchain", () => {
  it("registers Dart as a Task-005 round-trip multi-artifact text language", () => {
    expect(supportedLanguages).toContain("dart")
    expect(languageCapabilities.find(({id}) => id == "dart")).toEqual({
      acceptance: {stages: ["parse", "generate", "restore", "compile", "validate", "execute"], toolchains: ["dart"]},
      artifactMultiplicity: "multiple",
      check: {stages: ["restore", "compile", "validate"], supported: true, toolchains: ["dart"]},
      features: {
        closedRecords: false,
        conditionControlledLoops: false,
        effectfulCapabilitiesAndResources: false,
        generalFunctionsAndCalls: true,
        immutableCollections: false,
        optionalValues: false,
        orderedListIteration: false,
        orderedMapIteration: false,
        referenceClasses: false,
        typeParametersAndGenerics: false,
        typedErrors: false
      },
      id: "dart",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {
        applicationBackend: false,
        binaryBackend: false,
        frontend: true,
        interoperability: false,
        provider: false,
        textBackend: true
      },
      roundTrip: true
    })
    expect(canonicalToolchains.dart).toMatchObject({
      canonicalCommand: "dart",
      overrideEnvironmentVariable: "SEMANTIFOLD_DART",
      versionArguments: ["--version"]
    })
  })

  it("routes Dart parsing and artifact-set generation while rejecting legacy single-artifact APIs", async () => {
    const source = await readFile(new URL("fixtures/program.dart", import.meta.url), "utf8")
    const module = parse({filename: "program.dart", language: "dart", source})
    const set = generateArtifactSet({language: "dart", module})

    expect(module.kind).toEqual("Module")
    expect(set.target).toEqual("dart")
    expect(set.entry).toEqual("bin/program.dart")
    for (const api of [generate, generateArtifact]) {
      assert.throws(() => api({language: "dart", module}), (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "dart")
    }
  })

  it("discovers exact Dart 3.13.3 Linux x64 output from stderr through PATH or an override", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-dart-toolchain-"))
    const executable = path.join(directory, "dart")
    const version = 'Dart SDK version: 3.13.3 (stable) (Tue Sep 1 01:07:17 2026 -0700) on "linux_x64"'

    try {
      await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${version}' >&2\n`)
      await chmod(executable, 0o755)
      const canonical = await discoverCanonicalToolchain("dart", {environment: {PATH: directory}})
      const override = await discoverCanonicalToolchain("dart", {override: executable})

      expect(canonical).toMatchObject({executable, source: "canonical", version, versionOutput: version})
      expect(override).toMatchObject({executable, source: "override", version, versionOutput: version})
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("fails loudly for missing, wrong-version, and wrong-platform Dart executables", async () => {
    await assert.rejects(() => discoverCanonicalToolchain("dart", {environment: {PATH: ""}}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND" && error.language == "dart")
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-dart-toolchain-invalid-"))

    try {
      for (const [name, version] of [
        ["version", 'Dart SDK version: 3.13.2 (stable) (Tue Aug 25 00:00:00 2026 -0700) on "linux_x64"'],
        ["platform", 'Dart SDK version: 3.13.3 (stable) (Tue Sep 1 01:07:17 2026 -0700) on "linux_arm64"']
      ]) {
        const executable = path.join(directory, name)

        await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${version}' >&2\n`)
        await chmod(executable, 0o755)
        await assert.rejects(() => discoverCanonicalToolchain("dart", {override: executable}), (error) =>
          error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION" &&
            error.language == "dart" && error.version == version)
      }
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })
})
