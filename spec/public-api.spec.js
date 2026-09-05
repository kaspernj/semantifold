// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
  composeMappings,
  composeSourceMaps,
  createByteMapping,
  createGeneratedArtifactSet,
  discoverCanonicalToolchain,
  discoverToolchain,
  generate,
  generateArtifact,
  generateArtifactSet,
  generatedPositionFor,
  getNodeProvenance,
  getSymbolProvenance,
  languageCapabilities,
  mappingFromSourceMap,
  originalPositionFor,
  parse,
  parseByteMapping,
  parseMapping,
  primaryLocation,
  remapDiagnostic,
  remapLocation,
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
    expect(supportedLanguages).toEqual(["php", "ruby", "javascript", "typescript", "java", "python", "csharp"])
    expect(Object.isFrozen(supportedLanguages)).toBeTrue()
    expect(typeof parse).toEqual("function")
    expect(typeof generate).toEqual("function")
    expect(typeof generateArtifact).toEqual("function")
    expect(typeof generateArtifactSet).toEqual("function")
    expect(Array.isArray(languageCapabilities)).toBeTrue()
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
})
