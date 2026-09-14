// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
  composeMappings,
  composeSourceMaps,
  createCapabilityAuthority,
  createByteMapping,
  createGeneratedArtifactSet,
  createStdlibFacadeRegistry,
  discoverCanonicalToolchain,
  discoverToolchain,
  generate,
  generateArtifact,
  generateArtifactSet,
  generateProgramArtifactSet,
  generatedPositionFor,
  getNodeProvenance,
  getSymbolProvenance,
  languageCapabilities,
  listStdlibFacades,
  mappingFromSourceMap,
  originalPositionFor,
  parse,
  parseProgram,
  parseByteMapping,
  parseMapping,
  primaryLocation,
  remapDiagnostic,
  remapLocation,
  resolveStdlibFacade,
  runAcceptanceStages,
  SemantifoldDiagnostic,
  spansForNode,
  spansForSymbol,
  stringifyByteMapping,
  stringifyMapping,
  supportedLanguages,
  toSourceMapV3
} from "../index.js"

describe("public API", () => {
  it("exports immutable language discovery and the parser, generator, and diagnostic API", () => {
    expect(supportedLanguages).toEqual(["php", "ruby", "javascript", "typescript", "java", "kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift"])
    expect(Object.isFrozen(supportedLanguages)).toBeTrue()
    expect(typeof parse).toEqual("function")
    expect(typeof createCapabilityAuthority).toEqual("function")
    expect(typeof generate).toEqual("function")
    expect(typeof generateArtifact).toEqual("function")
    expect(typeof generateArtifactSet).toEqual("function")
    expect(typeof parseProgram).toEqual("function")
    expect(typeof generateProgramArtifactSet).toEqual("function")
    expect(typeof createStdlibFacadeRegistry).toEqual("function")
    expect(typeof listStdlibFacades).toEqual("function")
    expect(typeof resolveStdlibFacade).toEqual("function")
    expect(Array.isArray(languageCapabilities)).toBeTrue()
    expect(languageCapabilities.filter(({features}) => features.optionalValues).map(({id}) => id))
      .toEqual(["php", "ruby", "javascript", "typescript", "java"])
    expect(languageCapabilities.filter(({features}) => features.orderedMapIteration).map(({id}) => id))
      .toEqual(["php", "ruby", "javascript", "typescript", "java"])
    expect(languageCapabilities.filter(({features}) => features.conditionControlledLoops).map(({id}) => id))
      .toEqual(["php", "ruby", "javascript", "typescript", "java"])
    expect(languageCapabilities.filter(({features}) => features.effectfulCapabilitiesAndResources).map(({id}) => id))
      .toEqual(["php", "ruby", "javascript", "typescript", "java"])
    expect(typeof canonicalToolchains).toEqual("object")
    expect(typeof SemantifoldDiagnostic).toEqual("function")
    for (const api of [
      composeMappings,
      composeSourceMaps,
      createByteMapping,
      createGeneratedArtifactSet,
      discoverCanonicalToolchain,
      discoverToolchain,
      generatedPositionFor,
      getNodeProvenance,
      getSymbolProvenance,
      mappingFromSourceMap,
      originalPositionFor,
      parseByteMapping,
      parseMapping,
      primaryLocation,
      remapDiagnostic,
      remapLocation,
      runAcceptanceStages,
      spansForNode,
      spansForSymbol,
      stringifyByteMapping,
      stringifyMapping,
      toSourceMapV3
    ]) expect(typeof api).toEqual("function")
  })

  it("routes iOS application requests without changing default text program generation", () => {
    const source = "function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));"
    const module = parse({filename: "source.ts", language: "typescript", source})
    const program = parseProgram({
      entryModule: "main",
      sources: [{filename: "source.ts", id: "main", language: "typescript", source}]
    })

    expect(generateProgramArtifactSet({language: "typescript", program}).target).toEqual("typescript")
    for (const generateIos of [
      () => generateArtifactSet({language: "ios", module, role: "application"}),
      () => generateProgramArtifactSet({language: "ios", program, role: "application"})
    ]) {
      assert.throws(generateIos, error => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == "ios" &&
        error.detail == "Backend cannot emit semantic capability 'application target semantic project validation'.")
    }
  })
})
