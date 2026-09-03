// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {composeMappings, generatedPositionFor, mappingFromSourceMap, originalPositionFor} from "../index.js"

describe("PR 6 unequal-width composition review finding", () => {
  it("retains every inner origin when an exact outer range cannot be split", () => {
    const inner = mappingFromSourceMap({
      file: "middle.js",
      mappings: "AAAA,CAAC",
      names: [],
      sources: ["original.js"],
      sourcesContent: ["xy"],
      version: 3
    }, {content: "ab", filename: "middle.js", language: "javascript"})
    const outer = structuredClone(mappingFromSourceMap({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["middle.js"],
      sourcesContent: ["ab"],
      version: 3
    }, {content: "Z", filename: "final.js", language: "javascript"}))
    const outerOrigin = outer.spans[0].origin

    assert.equal(outerOrigin.kind, "source")
    outerOrigin.location.end = {column: 3, line: 1, offset: 2}
    outer.spans[0].mappingKind = "exact"
    const composed = composeMappings(outer, inner)
    const result = originalPositionFor(composed, {offset: 0})
    const origin = composed.spans[0].origin

    assert.equal(origin.kind, "derived")
    expect({mappingKind: result.mappingKind, offsets: origin.origins.map((related) => related.location.start.offset)})
      .toEqual({mappingKind: "anchor", offsets: [0, 1]})
    expect(generatedPositionFor(composed, {filename: "original.js", offset: 0})
      .map((match) => match.generatedLocation.start.offset)).toEqual([0])
    expect(generatedPositionFor(composed, {filename: "original.js", offset: 1})
      .map((match) => match.generatedLocation.start.offset)).toEqual([0])
  })
})
