// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, parse} from "../index.js"

const source = `function first(firstLeft: number, firstRight: number): number {
  if (firstLeft > firstRight) {
    return firstLeft - firstRight
  } else {
    return firstRight - firstLeft
  }
}

function second(secondLeft: number, secondRight: number): number {
  if (secondLeft > secondRight) {
    return secondLeft - secondRight
  } else {
    return secondRight - secondLeft
  }
}

console.log(first(4, 9))
`

describe("provenance through semantic transformations", () => {
  it("keeps node-associated origins through reorder, insertion, deletion, and cloning", () => {
    const reordered = /** @type {import("../src/semantic/types.js").SemanticModule} */ (JSON.parse(JSON.stringify(
      parse({filename: "two.ts", language: "typescript", source})
    )))

    reordered.functions.reverse()
    assertFunctionMapping(reordered, reordered.functions[0], "second")
    assertFunctionMapping(reordered, reordered.functions[1], "first")

    const inserted = parse({filename: "two.ts", language: "typescript", source})
    const clone = structuredClone(inserted.functions[0])

    clone.name = "third"
    inserted.functions.push(clone)
    const insertedArtifact = generateArtifact({language: "javascript", module: inserted})
    const originalFirst = source.indexOf("first")
    const clonedSpan = insertedArtifact.mapping.spans.find((span) => span.name == "third" && span.role == "name")
    const originalSpan = insertedArtifact.mapping.spans.find((span) => span.name == "first" && span.role == "name")
    const cloneRecord = getNodeProvenance(inserted, clone)
    const firstRecord = getNodeProvenance(inserted, inserted.functions[0])

    assert.equal(clonedSpan.origin.kind, "source")
    assert.equal(clonedSpan.origin.location.start.offset, originalFirst)
    assert.notEqual(cloneRecord.id, firstRecord.id)
    assert.notEqual(clonedSpan.symbolId, originalSpan.symbolId)
    assert.equal(cloneRecord.path, "/functions/2")
    assert.equal(cloneRecord.ranges.name.start.offset, originalFirst)

    const deleted = parse({filename: "two.ts", language: "typescript", source})
    const second = deleted.functions[1]
    const entryCall = /** @type {import("../src/semantic/types.js").CallExpression} */ (deleted.entryPoint.body[0].expression)

    deleted.functions.splice(0, 1)
    entryCall.callee = "second"
    assertFunctionMapping(deleted, second, "second")
  })

  it("rejects a node-associated source identity that does not own its location", () => {
    const module = parse({filename: "two.ts", language: "typescript", source})
    const declaration = module.functions[0]

    module.provenance.sources.push({
      content: "function unrelated() {}\n",
      filename: "other.ts",
      id: "source:1",
      language: "typescript"
    })
    declaration.sourceProvenance.origin = {
      kind: "source",
      location: declaration.location,
      sourceId: "source:1"
    }
    const artifact = generateArtifact({language: "javascript", module})
    const span = artifact.mapping.spans.find((candidate) => candidate.name == "first" && candidate.role == "name")

    assert.equal(span.origin.kind, "source")
    assert.equal(span.origin.sourceId, "source:0")
    assert.equal(span.origin.location.filename, "two.ts")
  })
})

/**
 * Asserts transformed semantic and generated provenance for one function.
 * @param {import("../src/semantic/types.js").SemanticModule} module - Transformed module.
 * @param {import("../src/semantic/types.js").FunctionDeclaration} declaration - Function.
 * @param {string} originalName - Original spelling.
 * @returns {void}
 */
function assertFunctionMapping(module, declaration, originalName) {
  const expected = source.indexOf(originalName)
  const record = getNodeProvenance(module, declaration)
  const artifact = generateArtifact({language: "javascript", module})
  const span = artifact.mapping.spans.find((candidate) => candidate.name == declaration.name && candidate.role == "name")

  assert.equal(record.path, `/functions/${module.functions.indexOf(declaration)}`)
  assert.equal(record.ranges.name.start.offset, expected)
  assert.equal(span.origin.kind, "source")
  assert.equal(span.origin.location.start.offset, expected)
}
