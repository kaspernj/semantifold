// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {originalPositionFor as traceOriginalPositionFor, TraceMap} from "@jridgewell/trace-mapping"
import {composeSourceMaps, generateArtifact, parse} from "../index.js"

const semanticSource = `function stable(left: number, right: number): number {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(stable(4, 9))
`

describe("post-merge source map review fixes", () => {
  it("registers inner sourceRoot sources by resolved name without phantom content", () => {
    const composed = composeSourceMaps({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["middle.js"],
      sourcesContent: ["middle"],
      version: 3
    }, {
      file: "middle.js",
      mappings: "AAAA",
      names: [],
      sourceRoot: "../src",
      sources: ["input.ts"],
      sourcesContent: ["original"],
      version: 3
    })
    const traced = traceOriginalPositionFor(new TraceMap(composed), {column: 0, line: 1})

    expect({sources: composed.sources, sourcesContent: composed.sourcesContent}).toEqual({
      sources: ["../src/input.ts"],
      sourcesContent: ["original"]
    })
    expect({column: traced.column, line: traced.line, source: traced.source}).toEqual({
      column: 0,
      line: 1,
      source: "../src/input.ts"
    })
  })

  it("registers outer sourceRoot sources by resolved name in deterministic order", () => {
    const composed = composeSourceMaps({
      file: "final.js",
      mappings: "AAAA,CCAA",
      names: [],
      sourceRoot: "../build",
      sources: ["middle.js", "vendor.ts"],
      sourcesContent: ["middle", "vendor"],
      version: 3
    }, {
      file: "../build/middle.js",
      mappings: "AAAA",
      names: [],
      sources: ["original.ts"],
      sourcesContent: ["original"],
      version: 3
    })
    const trace = new TraceMap(composed)
    const original = traceOriginalPositionFor(trace, {column: 0, line: 1})
    const vendor = traceOriginalPositionFor(trace, {column: 1, line: 1})

    expect({sources: composed.sources, sourcesContent: composed.sourcesContent}).toEqual({
      sources: ["original.ts", "../build/vendor.ts"],
      sourcesContent: ["original", "vendor"]
    })
    expect([original.source, vendor.source]).toEqual(["original.ts", "../build/vendor.ts"])
  })

  it("falls back to the current node location for a stale origin after rejecting its source registry", () => {
    const module = parse({filename: "review.ts", language: "typescript", source: semanticSource})
    const declaration = module.functions[0]

    module.provenance.sources.push({
      content: "invalid",
      filename: "",
      id: "source:invalid",
      language: "typescript"
    })
    declaration.sourceProvenance.origin = {
      kind: "source",
      location: {
        end: {column: 2, line: 1, offset: 1},
        filename: "review.ts",
        start: {column: 1, line: 1, offset: 0}
      },
      sourceId: "source:0"
    }
    const artifact = generateArtifact({language: "javascript", module})
    const record = artifact.mapping.nodes.find((candidate) => candidate.path == "/functions/0")

    assert.ok(record)
    assert.equal(record.origin.kind, "source")
    expect(record.origin.location).toEqual(declaration.location)
  })

  it("falls back to the current node location for an out-of-bounds origin after rejecting its source registry", () => {
    const module = parse({filename: "review.ts", language: "typescript", source: semanticSource})
    const declaration = module.functions[0]
    const outside = semanticSource.length + 100

    module.provenance.sources.push({
      content: "invalid",
      filename: "",
      id: "source:invalid",
      language: "typescript"
    })
    declaration.sourceProvenance.origin = {
      kind: "source",
      location: {
        end: {column: outside + 2, line: 1, offset: outside + 1},
        filename: "review.ts",
        start: {column: outside + 1, line: 1, offset: outside}
      },
      sourceId: "source:0"
    }
    const artifact = generateArtifact({language: "javascript", module})
    const record = artifact.mapping.nodes.find((candidate) => candidate.path == "/functions/0")

    assert.ok(record)
    assert.equal(record.origin.kind, "source")
    expect(record.origin.location).toEqual(declaration.location)
  })
})
