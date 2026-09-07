// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {TraceMap, originalPositionFor as v3OriginalPositionFor} from "@jridgewell/trace-mapping"
import {generateArtifactSet, generatedPositionFor, originalPositionFor, parse, parseMapping, stringifyMapping} from "../index.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("C rich and v3 occurrence provenance", () => {
  it("maps original operators, callees and consumers while generated temporaries/control remain synthetic", async () => {
    const source = "// 😀\r\n" + (await readFile(new URL("fixtures/ordered-program.ts", import.meta.url), "utf8")).replaceAll("\n", "\r\n")
    const module = parse({language: "typescript", filename: "ordered.ts", source})
    const set = generateArtifactSet({language: "c", module})
    const entry = set.artifacts[0]
    const {mapping, sourceMap} = entry.provenance

    expect(sourceMap.sourcesContent).toEqual([source])
    expect(sourceMap.version).toEqual(3)
    expect(stringifyMapping(parseMapping(stringifyMapping(mapping)))).toEqual(stringifyMapping(mapping))
    const trace = new TraceMap(sourceMap)

    for (const span of mapping.spans.filter(({role}) => role == "operator" || role == "callee")) {
      expect(span.mappingKind).toEqual("exact")
      expect(span.origin.kind).toEqual("source")
      const forward = originalPositionFor(mapping, {offset: span.generated.start.offset})
      const reverse = generatedPositionFor(mapping, {filename: "ordered.ts", offset: span.origin.location.start.offset})

      expect(forward.location.start).toEqual(span.origin.location.start)
      assert.ok(reverse.some(({generatedLocation}) => generatedLocation.start.offset == span.generated.start.offset))
      expect(v3OriginalPositionFor(trace, {line: span.generated.start.line, column: span.generated.start.column - 1})).toMatchObject({
        source: "ordered.ts", line: span.origin.location.start.line, column: span.origin.location.start.column - 1
      })
    }
    for (const span of mapping.spans) {
      const text = entry.content.slice(span.generated.start.offset, span.generated.end.offset)

      if (text.includes("semantifold_ordered_") || text.includes("semantifold:ordered-expression:")) {
        expect(span.mappingKind).toEqual("synthetic")
        assert.ok(span.origin.relatedOrigins.length > 0)
      }
    }
    expect(set.artifacts[1].provenance.kind).toEqual("synthetic")
    assert.ok(set.artifacts[1].provenance.relatedOrigins.length > 0)
  })

  it("retains the actual C operator and callee token ranges when collapsing nested ordered regions", async () => {
    const source = await readFile(new URL("fixtures/ordered-program.ts", import.meta.url), "utf8")
    const original = parse({language: "typescript", filename: "ordered.ts", source})
    const cSource = generateArtifactSet({language: "c", module: original}).artifacts[0].content
    const module = parse({language: "c", filename: "input.c", source: cSource})
    const entry = generateArtifactSet({language: "c", module}).artifacts[0]
    const operators = entry.provenance.mapping.spans.filter(({role}) => role == "operator")

    expect(meaning(module)).toEqual(meaning(original))
    for (const span of operators) {
      expect(span.mappingKind).toEqual("exact")
      const token = cSource.slice(span.origin.location.start.offset, span.origin.location.end.offset)

      expect(entry.content.slice(span.generated.start.offset, span.generated.end.offset)).toEqual(token)
    }
    expect(entry.provenance.sourceMap.sourcesContent).toEqual([cSource])
  })

  it("assigns separate temporary and mapping identities to shared semantic expression occurrences", () => {
    const module = parse({language: "typescript", filename: "shared.ts", source:
      "function add(left: number, right: number): number { return left + right; } console.log(add(1, 2) + add(3, 4));"})
    const expression = module.entryPoint.body.statements[0].expression

    expression.right = expression.left
    const entry = generateArtifactSet({language: "c", module}).artifacts[0]
    const paths = entry.provenance.mapping.nodes.filter(({kind}) => kind == "CallExpression").map(({path}) => path)

    expect(paths).toEqual(["/entryPoint/body/statements/0/expression/left", "/entryPoint/body/statements/0/expression/right"])
    expect(meaning(parse({language: "c", filename: "program.c", source: entry.content}))).toEqual(meaning(module))
    expect(entry.content.match(/int64_t semantifold_ordered_[0-9]{6} = add\(/gu).length).toEqual(2)
  })

  it("rebuilds stale provenance and supports legacy located modules without parser metadata", () => {
    const module = parse({language: "typescript", filename: "source.ts", source:
      "function add(left: number, right: number): number { return left + right; } console.log(add(1, 2));"})
    const before = generateArtifactSet({language: "c", module})

    module.provenance.nodes[0].path = "/forged"
    expect(generateArtifactSet({language: "c", module}).artifacts[0].content).toEqual(before.artifacts[0].content)
    const legacy = JSON.parse(JSON.stringify(module, (key, nested) => ["provenance", "sourceProvenance"].includes(key) ? undefined : nested))
    const set = generateArtifactSet({language: "c", module: legacy})

    expect(set.artifacts[0].provenance.mapping.sources.map(({content}) => content)).toEqual([null])
    assert.ok(set.artifacts[0].provenance.mapping.spans.every(({mappingKind}) => mappingKind != "exact"))
  })
})
