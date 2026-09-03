// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  composeMappings,
  generatedPositionFor,
  mappingFromSourceMap,
  originalPositionFor
} from "../index.js"

describe("PR 6 EOF composition automatic review finding", () => {
  it("retains an untraced intermediate source for an outer EOF point", () => {
    const inner = mappingFromSourceMap({
      file: "middle.js",
      mappings: "AAAA",
      names: [],
      sources: ["original.js"],
      sourcesContent: ["o"],
      version: 3
    }, {
      content: "x",
      filename: "middle.js",
      language: "javascript"
    })
    const outer = mappingFromSourceMap({
      file: "final.js",
      mappings: "AAAC",
      names: [],
      sources: ["middle.js"],
      sourcesContent: ["x"],
      version: 3
    }, {
      content: "y",
      filename: "final.js",
      language: "javascript"
    })

    assert.throws(() => originalPositionFor(inner, {offset: 1}), /no generated mapping/iu)
    const composed = composeMappings(outer, inner)
    const forward = originalPositionFor(composed, {offset: 0})

    assert.ok(forward.location)
    expect({
      end: forward.location.end.offset,
      filename: forward.location.filename,
      start: forward.location.start.offset
    }).toEqual({end: 1, filename: "middle.js", start: 1})
    expect(composed.sources.map(({content, filename}) => ({content, filename}))).toEqual([
      {content: "o", filename: "original.js"},
      {content: "x", filename: "middle.js"}
    ])
    expect(generatedPositionFor(composed, {filename: "middle.js", offset: 1})
      .map((result) => result.generatedLocation.start.offset)).toEqual([0])
  })
})
