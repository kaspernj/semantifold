// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {
  composeMappings,
  composeSourceMaps,
  generate,
  generateArtifact,
  generatedPositionFor,
  getNodeProvenance,
  getSymbolProvenance,
  mappingFromSourceMap,
  originalPositionFor,
  parse,
  parseMapping,
  primaryLocation,
  remapDiagnostic,
  remapLocation,
  SemantifoldDiagnostic,
  spansForNode,
  spansForSymbol,
  stringifyMapping,
  supportedLanguages,
  toSourceMapV3
} from "../index.js"

describe("public API", () => {
  it("exports immutable language discovery and the parser, generator, and diagnostic API", () => {
    expect(supportedLanguages).toEqual(["php", "ruby", "javascript", "typescript", "java"])
    expect(Object.isFrozen(supportedLanguages)).toBeTrue()
    expect(typeof parse).toEqual("function")
    expect(typeof generate).toEqual("function")
    expect(typeof generateArtifact).toEqual("function")
    expect(typeof SemantifoldDiagnostic).toEqual("function")
    for (const api of [
      composeMappings,
      composeSourceMaps,
      generatedPositionFor,
      getNodeProvenance,
      getSymbolProvenance,
      mappingFromSourceMap,
      originalPositionFor,
      parseMapping,
      primaryLocation,
      remapDiagnostic,
      remapLocation,
      spansForNode,
      spansForSymbol,
      stringifyMapping,
      toSourceMapV3
    ]) expect(typeof api).toEqual("function")
  })
})
