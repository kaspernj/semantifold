// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {TraceMap, generatedPositionFor as v3GeneratedPositionFor, originalPositionFor as v3OriginalPositionFor} from "@jridgewell/trace-mapping"
import {generateArtifactSet, generatedPositionFor, originalPositionFor, parse, parseMapping, stringifyMapping} from "../index.js"
import {meaning} from "./support/zig-toolchain.js"

const source = '// 😀\r\nfunction join(left: string, right: string): string { const saved: string = left; return saved + right; }\r\n' +
  'console.log(join("é\\u0000😀", "中"));\r\n'

describe("Zig artifact and scalar occurrence provenance", () => {
  it("retains deterministic rich and V3 mappings while build/arena/output scaffolding stays synthetic", () => {
    const module = parse({language: "typescript", filename: "unicode.ts", source})
    const first = generateArtifactSet({language: "zig", module})
    const second = generateArtifactSet({language: "zig", module})
    const entry = first.artifacts[1]
    const {mapping, sourceMap} = entry.provenance
    const trace = new TraceMap(sourceMap)

    expect(second).toEqual(first)
    expect(sourceMap.sourcesContent).toEqual([source])
    expect(stringifyMapping(parseMapping(stringifyMapping(mapping)))).toEqual(stringifyMapping(mapping))
    let exact = 0
    let support = 0

    for (const span of mapping.spans) {
      const text = entry.content.slice(span.generated.start.offset, span.generated.end.offset)

      if (span.mappingKind == "exact") {
        exact += 1
        expect(span.origin.kind).toEqual("source")
        expect(originalPositionFor(mapping, {offset: span.generated.start.offset}).location.start).toEqual(span.origin.location.start)
        assert.ok(generatedPositionFor(mapping, {filename: "unicode.ts", offset: span.origin.location.start.offset})
          .some(({generatedLocation}) => generatedLocation.start.offset == span.generated.start.offset))
        expect(v3OriginalPositionFor(trace, {line: span.generated.start.line, column: span.generated.start.column - 1})).toMatchObject({
          source: "unicode.ts", line: span.origin.location.start.line, column: span.origin.location.start.column - 1
        })
        const reverse = v3GeneratedPositionFor(trace, {source: "unicode.ts", line: span.origin.location.start.line,
          column: span.origin.location.start.column - 1})

        assert.ok(reverse.line !== null && reverse.column !== null)
      }
      if (text.includes("@addWithOverflow") || text.includes("ArenaAllocator") || text.includes("writeAll")) {
        support += 1
        expect(span.mappingKind).toEqual("synthetic")
        assert.ok(span.origin.relatedOrigins.length > 0)
      }
    }
    assert.ok(exact > 8)
    assert.ok(support > 0)
    expect(first.artifacts[0].provenance.kind).toEqual("synthetic")
    assert.ok(first.artifacts[0].provenance.relatedOrigins.length > 0)
  })

  it("maps helper calls, copied slices and literals back to original Zig tokens after reparse", () => {
    const original = parse({language: "typescript", filename: "unicode.ts", source})
    const generated = generateArtifactSet({language: "zig", module: original}).artifacts[1].content
    const zigSource = "// 😀\r\n" + generated.replaceAll("\n", "\r\n")
    const zig = parse({language: "zig", filename: "unicode.zig", source: zigSource})
    const entry = generateArtifactSet({language: "zig", module: zig}).artifacts[1]

    expect(meaning(zig)).toEqual(meaning(original))
    expect(entry.provenance.sourceMap.sourcesContent).toEqual([zigSource])
    for (const span of entry.provenance.mapping.spans.filter(({role}) => ["name", "callee", "operator", "type", "literal"].includes(role))) {
      expect(span.mappingKind).toEqual("exact")
      const originalText = zigSource.slice(span.origin.location.start.offset, span.origin.location.end.offset)
      const generatedText = entry.content.slice(span.generated.start.offset, span.generated.end.offset)

      if (span.role != "operator" || !generatedText.startsWith("semantifold_")) expect(generatedText).toEqual(originalText)
    }
  })
})
