// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  composeMappings,
  generateArtifact,
  generatedPositionFor,
  mappingFromSourceMap,
  parse,
  spansForNode,
  spansForSymbol
} from "../index.js"

const source = `function difference(left: number, right: number): number {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(difference(4, 9))
`

describe("PR 6 composition, identity-index, and URL automatic review findings", () => {
  for (const kind of /** @type {const} */ (["derived", "synthetic"])) {
    it(`skips an untraced EOF point before a traceable ${kind} origin`, () => {
      const {eof, inner, outer, traceable} = compositionFixture()

      if (kind == "derived") {
        outer.spans[0].origin = {kind: "derived", origins: [eof, traceable]}
      } else {
        outer.spans[0].mappingKind = "synthetic"
        outer.spans[0].origin = {
          kind: "synthetic",
          reason: "ordered intermediate context",
          relatedOrigins: [eof, traceable]
        }
      }
      const composed = composeMappings(outer, inner)
      const origin = composed.spans[0].origin
      const related = origin.kind == "derived" ? origin.origins : origin.kind == "synthetic" ? origin.relatedOrigins : []

      expect(related.map((candidate) => candidate.location.filename)).toEqual(["middle.js", "original.js"])
      expect(generatedPositionFor(composed, {filename: "middle.js", offset: 2}).length).toEqual(1)
      expect(generatedPositionFor(composed, {filename: "original.js", offset: 0}).length).toEqual(1)
      if (kind == "synthetic") {
        assert.equal(origin.kind, "synthetic")
        expect(origin.reason).toEqual("ordered intermediate context")
      }
    })
  }

  it("indexes direct span-level semantic identities", () => {
    const fixture = identityFixture()

    assertIndexedOnce(fixture, fixture.directIndex)
  })

  it("indexes and deduplicates semantic identities in derived origins", () => {
    const fixture = identityFixture()
    const targetIndex = fixture.mapping.spans.findIndex((span, index) => index != fixture.directIndex && span.origin.kind == "source")

    assert.ok(targetIndex >= 0)
    const span = fixture.mapping.spans[targetIndex]

    delete span.nodeId
    delete span.symbolId
    span.origin = {
      kind: "derived",
      origins: [fixture.related, {...fixture.related, role: "duplicate derived context"}]
    }
    assertIndexedOnce(fixture, targetIndex)
  })

  it("indexes and deduplicates semantic identities in synthetic related origins", () => {
    const fixture = identityFixture()
    const targetIndex = fixture.mapping.spans.findIndex((span) => span.origin.kind == "synthetic")

    assert.ok(targetIndex >= 0)
    const span = fixture.mapping.spans[targetIndex]

    delete span.nodeId
    delete span.symbolId
    span.mappingKind = "synthetic"
    span.origin = {
      kind: "synthetic",
      reason: "identity context",
      relatedOrigins: [fixture.related, {...fixture.related, role: "duplicate synthetic context"}]
    }
    assertIndexedOnce(fixture, targetIndex)
  })

  for (const paths of [
    {filename: "../../dist/out.js", sourceMapFilename: "../maps/out.js.map"},
    {filename: "../dist/out.js", sourceMapFilename: "../../maps/out.js.map"}
  ]) {
    it(`resolves mixed-depth external map paths from ${paths.filename}`, () => {
      const module = parse({filename: "program.ts", language: "typescript", source})
      const artifact = generateArtifact({
        ...paths,
        language: "javascript",
        mapDirective: "external",
        module
      })
      const directive = artifact.code.match(/\/\/# sourceMappingURL=(.+)\n$/u)

      assert.ok(directive)
      expect(directive[1]).toEqual("../maps/out.js.map")
      expect(artifact.filename).toEqual(paths.filename)
      expect(artifact.sourceMapFilename).toEqual(paths.sourceMapFilename)
      const base = new URL("https://artifacts.invalid/")
      const advertised = new URL(paths.sourceMapFilename, base)
      const generated = new URL(paths.filename, base)

      expect(new URL(directive[1], generated).href).toEqual(advertised.href)
    })
  }
})

/**
 * Creates valid inner and outer mappings with traceable and EOF intermediate origins.
 * @returns {{eof: import("../src/semantic/types.js").RelatedOrigin, inner: import("../src/semantic/types.js").SemantifoldMapping, outer: import("../src/semantic/types.js").SemantifoldMapping, traceable: import("../src/semantic/types.js").RelatedOrigin}} Fixture.
 */
function compositionFixture() {
  const inner = mappingFromSourceMap({
    file: "middle.js",
    mappings: "AAAA",
    names: [],
    sources: ["original.js"],
    sourcesContent: ["o"],
    version: 3
  }, {content: "ab", filename: "middle.js", language: "javascript"})
  const outer = structuredClone(mappingFromSourceMap({
    file: "final.js",
    mappings: "AAAA",
    names: [],
    sources: ["middle.js"],
    sourcesContent: ["ab"],
    version: 3
  }, {content: "z", filename: "final.js", language: "javascript"}))
  const origin = outer.spans[0].origin

  assert.equal(origin.kind, "source")
  const traceable = {location: origin.location, role: "traceable", sourceId: origin.sourceId}
  const eof = {
    location: {
      end: {column: 3, line: 1, offset: 2},
      filename: "middle.js",
      start: {column: 3, line: 1, offset: 2}
    },
    role: "EOF",
    sourceId: origin.sourceId
  }

  return {eof, inner, outer, traceable}
}

/**
 * Creates a mutable mapping and one semantic identity pair suitable for index checks.
 * @returns {{directIndex: number, mapping: import("../src/semantic/types.js").SemantifoldMapping, nodeId: string, related: import("../src/semantic/types.js").RelatedOrigin, symbolId: string}} Fixture.
 */
function identityFixture() {
  const module = parse({filename: "program.ts", language: "typescript", source})
  const mapping = structuredClone(generateArtifact({language: "javascript", module}).mapping)
  const node = mapping.nodes.find((candidate) => candidate.path == "/functions/0")

  assert.ok(node)
  const symbol = mapping.symbols.find((candidate) => candidate.declarationNodeId == node.id)

  assert.ok(symbol)
  const directIndex = mapping.spans.findIndex((span) => span.nodeId == node.id && span.symbolId == symbol.id)

  assert.ok(directIndex >= 0)
  const direct = mapping.spans[directIndex]

  assert.equal(direct.origin.kind, "source")

  return {
    directIndex,
    mapping,
    nodeId: node.id,
    related: {
      location: direct.origin.location,
      nodeId: node.id,
      role: "semantic context",
      sourceId: direct.origin.sourceId,
      symbolId: symbol.id
    },
    symbolId: symbol.id
  }
}

/**
 * Asserts one target span is present exactly once in both deterministic identity indexes.
 * @param {ReturnType<typeof identityFixture>} fixture - Mutable mapping fixture.
 * @param {number} targetIndex - Expected indexed span.
 * @returns {void}
 */
function assertIndexedOnce(fixture, targetIndex) {
  const targetOffset = fixture.mapping.spans[targetIndex].generated.start.offset
  const nodeOffsets = spansForNode(fixture.mapping, fixture.nodeId).map((span) => span.generated.start.offset)
  const symbolOffsets = spansForSymbol(fixture.mapping, fixture.symbolId).map((span) => span.generated.start.offset)

  expect(nodeOffsets.filter((offset) => offset == targetOffset).length).toEqual(1)
  expect(symbolOffsets.filter((offset) => offset == targetOffset).length).toEqual(1)
  expect(nodeOffsets).toEqual([...nodeOffsets].sort((left, right) => left - right))
  expect(symbolOffsets).toEqual([...symbolOffsets].sort((left, right) => left - right))
}
