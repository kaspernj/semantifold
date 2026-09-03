// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  composeMappings,
  generateArtifact,
  getNodeProvenance,
  parse,
  parseMapping
} from "../index.js"

const localSource = `function select(flag: boolean, fallback: string): string {
  const preferred: string = "yes"
  let result: string = fallback
  if (flag) {
    result = preferred
    return result
  } else {
    return result
  }
}

let output: string = "no"
output = select(true, output)
console.log(output)
`

describe("PR 6 follow-up automatic review findings", () => {
  it("maps aliased statements and branches by occurrence across every backend", () => {
    const module = parse({filename: "locals.ts", language: "typescript", source: localSource})
    const declaration = module.functions[0]
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.at(-1))
    const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent[0])
    const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const clone = structuredClone(declaration)

    branch.consequent.splice(1, 0, assignment)
    branch.alternate[0] = returned
    clone.name = "selectAgain"
    clone.body[clone.body.length - 1] = branch
    module.functions.push(clone)

    const expectedPaths = [
      "/functions/0/body/2",
      "/functions/0/body/2/consequent/0",
      "/functions/0/body/2/consequent/1",
      "/functions/0/body/2/consequent/2",
      "/functions/0/body/2/alternate/0",
      "/functions/1/body/2",
      "/functions/1/body/2/consequent/0",
      "/functions/1/body/2/consequent/1",
      "/functions/1/body/2/consequent/2",
      "/functions/1/body/2/alternate/0"
    ]

    for (const language of /** @type {const} */ (["php", "ruby", "javascript", "typescript", "java"])) {
      const artifact = generateArtifact({language, module})
      const records = artifact.mapping.nodes.filter((record) => expectedPaths.includes(record.path))

      expect(records.map((record) => record.path)).toEqual(expectedPaths)
      expect(new Set(records.map((record) => record.id)).size).toEqual(expectedPaths.length)
      expect(records.every((record) => artifact.mapping.spans.some((span) => span.nodeId == record.id))).toEqual(true)
    }
  })

  it("adopts unmapped synthetic provenance when derived composition has no original range", () => {
    const inner = parseMapping(JSON.stringify({
      coordinateSystem: "utf16",
      generated: {content: "x", filename: "middle.js", language: "javascript"},
      nodes: [],
      schema: "SemantifoldMapping",
      sources: [],
      spans: [{
        generated: location("middle.js"),
        mappingKind: "synthetic",
        origin: {kind: "synthetic", reason: "unmapped inner segment", relatedOrigins: []}
      }],
      symbols: [],
      version: 1
    }))
    const outer = parseMapping(JSON.stringify({
      coordinateSystem: "utf16",
      generated: {content: "y", filename: "final.js", language: "javascript"},
      nodes: [],
      schema: "SemantifoldMapping",
      sources: [{content: "x", filename: "middle.js", id: "source:0", language: "javascript"}],
      spans: [{
        generated: location("final.js"),
        mappingKind: "anchor",
        origin: {
          kind: "derived",
          origins: [{location: location("middle.js"), role: "intermediate", sourceId: "source:0"}]
        }
      }],
      symbols: [],
      version: 1
    }))
    const span = composeMappings(outer, inner).spans[0]

    expect({mappingKind: span.mappingKind, origin: span.origin}).toEqual({
      mappingKind: "synthetic",
      origin: {kind: "synthetic", reason: "unmapped inner segment", relatedOrigins: []}
    })
  })

  it("discards a caller provenance registry containing an empty filename", () => {
    const module = parse({filename: "locals.ts", language: "typescript", source: localSource})

    module.provenance.sources.push({content: "unused", filename: "", id: "source:invalid", language: "typescript"})
    const artifact = generateArtifact({language: "javascript", module})

    expect(artifact.mapping.sources.map(({content, filename}) => ({content, filename}))).toEqual([
      {content: null, filename: "locals.ts"}
    ])

    const malformedMapping = structuredClone(artifact.mapping)

    malformedMapping.sources[0].filename = ""
    assert.throws(() => parseMapping(JSON.stringify(malformedMapping)), /malformed.*mapping source/iu)
  })

  it("preserves escaped identifier token ranges with indexed lookup", () => {
    const escapedSource = localSource
      .replaceAll("select", "sel\\u0065ct")
      .replaceAll("flag", "fl\\u0061g")
    const module = parse({filename: "escaped.ts", language: "typescript", source: escapedSource})
    const declaration = module.functions[0]
    const flag = declaration.parameters[0]

    expect(escapedSource.slice(
      getNodeProvenance(module, declaration).ranges.name.start.offset,
      getNodeProvenance(module, declaration).ranges.name.end.offset
    )).toEqual("sel\\u0065ct")
    expect(escapedSource.slice(
      getNodeProvenance(module, flag).ranges.name.start.offset,
      getNodeProvenance(module, flag).ranges.name.end.offset
    )).toEqual("fl\\u0061g")
  })

  it("keeps Babel token lookup work near-linear without wall-clock thresholds", () => {
    const functionCount = 80
    const largeSource = `${Array.from({length: functionCount}, (_, index) => `function choose${index}(left${index}: number, right${index}: number): number {
  if (left${index} > right${index}) {
    return left${index} - right${index}
  } else {
    return right${index} - left${index}
  }
}`).join("\n\n")}\n\nconsole.log(choose0(4, 9))\n`
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "find")
    let tokenCandidates = 0

    assert.ok(descriptor)
    const originalFind = Array.prototype.find

    Object.defineProperty(Array.prototype, "find", {
      ...descriptor,
      value: /** @type {typeof Array.prototype.find} */ (function(predicate, thisArgument) {
        const first = this[0]
        const tokenArray = this.length > 100 && isBabelToken(first)

        return Reflect.apply(originalFind, this, [tokenArray
          ? (value, index, array) => {
              tokenCandidates++
              return Reflect.apply(predicate, thisArgument, [value, index, array])
            }
          : predicate, thisArgument])
      })
    })

    try {
      parse({filename: "large.ts", language: "typescript", source: largeSource})
    } finally {
      Object.defineProperty(Array.prototype, "find", descriptor)
    }

    assert.ok(tokenCandidates < functionCount * 20,
      `Expected indexed token lookup, observed ${tokenCandidates} token candidates for ${functionCount} functions.`)
  })
})

/**
 * Builds a one-character location.
 * @param {string} filename - Location filename.
 * @returns {import("../src/semantic/types.js").SourceLocation} Location.
 */
function location(filename) {
  return {
    end: {column: 2, line: 1, offset: 1},
    filename,
    start: {column: 1, line: 1, offset: 0}
  }
}

/**
 * Recognizes one Babel token without depending on its private runtime class.
 * @param {unknown} value - Candidate array element.
 * @returns {boolean} Whether the value has Babel token shape.
 */
function isBabelToken(value) {
  if (!value || typeof value != "object") return false

  const type = Reflect.get(value, "type")

  return typeof Reflect.get(value, "start") == "number" && typeof Reflect.get(value, "end") == "number" &&
    Boolean(type) && typeof type == "object" && typeof Reflect.get(type, "label") == "string"
}
