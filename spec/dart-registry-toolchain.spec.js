// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
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
})
