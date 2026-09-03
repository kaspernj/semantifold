// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  generateArtifact,
  generatedPositionFor,
  mappingFromSourceMap,
  originalPositionFor,
  parse
} from "../index.js"

const source = `function select(flag: boolean, fallback: string): string {
  if (flag) {
    return fallback
  } else {
    return "none"
  }
}

console.log(select(true, "yes"))
`

describe("PR 6 EOF and parameter automatic review findings", () => {
  it("round-trips an imported anchor at EOF of an empty source", () => {
    assertImportedEofAnchor("", "AAAA")
  })

  it("round-trips an imported anchor at EOF of a nonempty source without widening it", () => {
    const mapping = assertImportedEofAnchor("x", "AAAC")

    expect(generatedPositionFor(mapping, {filename: "original.js", offset: 0})).toEqual([])
  })

  for (const language of /** @type {const} */ (["php", "ruby", "javascript", "typescript", "java"])) {
    it(`maps a shared parameter by distinct occurrence paths for ${language}`, () => {
      const module = parse({filename: "parameters.ts", language: "typescript", source})
      const declaration = module.functions[0]
      const clone = structuredClone(declaration)

      clone.name = "selectAgain"
      clone.parameters[0] = declaration.parameters[0]
      module.functions.push(clone)

      const expectedPaths = [
        "/functions/0/parameters/0",
        "/functions/1/parameters/0"
      ]
      const artifact = generateArtifact({language, module})
      const records = artifact.mapping.nodes.filter((record) => expectedPaths.includes(record.path))

      expect(records.map((record) => record.path)).toEqual(expectedPaths)
      expect(new Set(records.map((record) => record.id)).size).toEqual(expectedPaths.length)
      expect(records.every((record) => artifact.mapping.spans.some((span) => span.nodeId == record.id))).toEqual(true)
      expect(generateArtifact({language, module}).mapping).toEqual(artifact.mapping)
    })
  }
})

/**
 * Imports and checks one Source Map anchor at the original EOF point.
 * @param {string} content - Original source content.
 * @param {string} mappings - Encoded mapping for its EOF coordinate.
 * @returns {import("../src/semantic/types.js").SemantifoldMapping} Imported mapping.
 */
function assertImportedEofAnchor(content, mappings) {
  const mapping = mappingFromSourceMap({
    file: "generated.js",
    mappings,
    names: [],
    sources: ["original.js"],
    sourcesContent: [content],
    version: 3
  }, {
    content: "y",
    filename: "generated.js",
    language: "javascript"
  })
  const forward = originalPositionFor(mapping, {offset: 0})

  assert.ok(forward.location)
  expect({
    end: forward.location.end.offset,
    start: forward.location.start.offset
  }).toEqual({end: content.length, start: content.length})
  expect(generatedPositionFor(mapping, {filename: "original.js", offset: content.length})
    .map((result) => result.generatedLocation.start.offset)).toEqual([0])
  expect(generatedPositionFor(mapping, {filename: "original.js", line: 1, column: content.length + 1})
    .map((result) => result.generatedLocation.start.offset)).toEqual([0])

  return mapping
}
