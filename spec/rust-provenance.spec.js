// @ts-check

import assert from "node:assert/strict"
import {mkdir, writeFile} from "node:fs/promises"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {TraceMap, generatedPositionFor as v3GeneratedPositionFor, originalPositionFor as v3OriginalPositionFor} from "@jridgewell/trace-mapping"
import {generateArtifactSet, generatedPositionFor, originalPositionFor, parse, parseMapping, stringifyMapping} from "../index.js"
import {meaning} from "./support/rust-toolchain.js"

const source = '// 😀\r\nfunction join(left: string, right: string): string { const saved: string = left; return saved + right; }\r\n' +
  'console.log(join("é\\u0000😀", "中"));\r\n'

describe("Rust artifact and scalar occurrence provenance", () => {
  it("retains deterministic rich and V3 forward/reverse locations across Unicode and copy syntax", async () => {
    const module = parse({language: "typescript", filename: "unicode.ts", source})
    const first = generateArtifactSet({language: "rust", module})
    const second = generateArtifactSet({language: "rust", module})
    const entry = first.artifacts[2]
    const {mapping, sourceMap} = entry.provenance
    const trace = new TraceMap(sourceMap)

    expect(second).toEqual(first)
    expect(sourceMap.sourcesContent).toEqual([source])
    expect(stringifyMapping(parseMapping(stringifyMapping(mapping)))).toEqual(stringifyMapping(mapping))
    let originalSpans = 0
    let clones = 0
    let support = 0

    for (const span of mapping.spans) {
      const text = entry.content.slice(span.generated.start.offset, span.generated.end.offset)

      if (span.mappingKind == "exact") {
        originalSpans++
        expect(span.origin.kind).toEqual("source")
        const forward = originalPositionFor(mapping, {offset: span.generated.start.offset})
        const reverse = generatedPositionFor(mapping, {filename: "unicode.ts", offset: span.origin.location.start.offset})
        const nativeReverse = v3GeneratedPositionFor(trace, {source: "unicode.ts", line: span.origin.location.start.line,
          column: span.origin.location.start.column - 1})

        expect(forward.location.start).toEqual(span.origin.location.start)
        assert.ok(reverse.some(({generatedLocation}) => generatedLocation.start.offset == span.generated.start.offset))
        assert.ok(nativeReverse.line !== null && nativeReverse.column !== null)
        expect(v3OriginalPositionFor(trace, {line: span.generated.start.line, column: span.generated.start.column - 1})).toMatchObject({
          source: "unicode.ts", line: span.origin.location.start.line, column: span.origin.location.start.column - 1
        })
      }
      if (text.includes(".clone()") || text == "&(") {
        clones++
        expect(span.mappingKind).toEqual("synthetic")
        assert.ok(span.origin.relatedOrigins.length > 0)
      }
      if (text.includes("overflowing_add")) {
        support++
        expect(span.mappingKind).toEqual("synthetic")
        assert.ok(span.origin.relatedOrigins.length > 0)
        expect(v3OriginalPositionFor(trace, {line: span.generated.start.line, column: span.generated.start.column - 1}).source).toEqual(null)
      }
    }
    assert.ok(originalSpans > 8)
    assert.ok(clones > 0)
    expect(support).toEqual(1)
    for (const artifact of first.artifacts.slice(0, 2)) {
      expect(artifact.provenance.kind).toEqual("synthetic")
      assert.ok(artifact.provenance.relatedOrigins.length > 0)
    }
    if (process.env.SEMANTIFOLD_RUST_EVIDENCE) {
      await mkdir(process.env.SEMANTIFOLD_RUST_EVIDENCE, {recursive: true})
      await writeFile(path.join(process.env.SEMANTIFOLD_RUST_EVIDENCE, "deterministic-artifacts-and-maps.json"), JSON.stringify({first, second}, null, 2) + "\n")
    }
  })

  it("maps Rust helper calls, copied symbols and string bytes back to their originating Rust tokens", () => {
    const original = parse({language: "typescript", filename: "unicode.ts", source})
    const generated = generateArtifactSet({language: "rust", module: original}).artifacts[2].content
    const rustSource = "/* 😀 */\r\n" + generated.replaceAll("\n", "\r\n")
    const rust = parse({language: "rust", filename: "unicode.rs", source: rustSource})
    const entry = generateArtifactSet({language: "rust", module: rust}).artifacts[2]

    expect(meaning(rust)).toEqual(meaning(original))
    expect(entry.provenance.sourceMap.sourcesContent).toEqual([rustSource])
    for (const span of entry.provenance.mapping.spans.filter(({role}) => ["name", "callee", "operator", "type"].includes(role))) {
      expect(span.mappingKind).toEqual("exact")
      const originalText = rustSource.slice(span.origin.location.start.offset, span.origin.location.end.offset)
      const generatedText = entry.content.slice(span.generated.start.offset, span.generated.end.offset)

      expect(generatedText).toEqual(originalText)
    }
  })

  it("keeps shared expression occurrences distinct and rebuilds stale or absent parser provenance", () => {
    const module = parse({language: "typescript", filename: "shared.ts", source:
      "function add(left: number, right: number): number { return left + right; } console.log(add(1, 2) + add(3, 4));"})
    const expression = module.entryPoint.body.statements[0].expression

    expression.right = expression.left
    const set = generateArtifactSet({language: "rust", module})
    const entry = set.artifacts[2]

    expect(entry.provenance.mapping.nodes.filter(({kind}) => kind == "CallExpression").map(({path: nodePath}) => nodePath)).toEqual([
      "/entryPoint/body/statements/0/expression/left", "/entryPoint/body/statements/0/expression/right"
    ])
    expect(meaning(parse({language: "rust", filename: "shared.rs", source: entry.content}))).toEqual(meaning(module))
    module.provenance.nodes[0].path = "/forged"
    expect(generateArtifactSet({language: "rust", module}).artifacts.map(({content}) => content)).toEqual(set.artifacts.map(({content}) => content))
    const legacy = JSON.parse(JSON.stringify(module, (key, nested) => ["provenance", "sourceProvenance"].includes(key) ? undefined : nested))
    const mapping = generateArtifactSet({language: "rust", module: legacy}).artifacts[2].provenance.mapping

    expect(mapping.sources.map(({content}) => content)).toEqual([null])
    assert.ok(mapping.spans.every(({mappingKind}) => mappingKind != "exact"))
  })
})
