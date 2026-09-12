// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForNode, spansForSymbol} from "../index.js"

describe("ordered map iteration provenance and mapping", () => {
  it("retains and maps the ordered literal, entries, operand, pair bindings, body, and controls", async () => {
    const source = await readFile(new URL("fixtures/ordered-map-iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])
    const literal = /** @type {import("../src/semantic/types.js").OrderedMapLiteral} */ (declaration.initializer)
    const loop = /** @type {import("../src/semantic/types.js").ForEachMapStatement} */ (module.entryPoint.body.statements[3])
    const continueNode = /** @type {import("../src/semantic/types.js").IfStatement} */ (loop.body.statements[0]).consequent.statements[0]
    const breakNode = /** @type {import("../src/semantic/types.js").IfStatement} */ (loop.body.statements.at(-1)).consequent.statements[0]
    const nodes = [declaration.type, literal, ...literal.entries.flatMap((entry) => [entry, entry.key, entry.value]),
      loop, loop.map, loop.keyBinding, loop.valueBinding, loop.body, continueNode, breakNode]

    for (const node of nodes) expect(getNodeProvenance(module, node).origin.location.filename).toEqual("program.ts")
    for (const binding of [loop.keyBinding, loop.valueBinding]) {
      const node = getNodeProvenance(module, binding)
      const symbol = getSymbolProvenance(module, node.symbolId)

      expect(symbol.kind).toEqual("iteration")
      assert.ok(symbol.references.length > 0)
    }

    for (const language of ["ruby", "javascript", "typescript", "php", "java"]) {
      const artifact = generateArtifact({language, module})

      for (const node of nodes) assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, node).id).length > 0, `${language}:${node.kind}`)
      for (const binding of [loop.keyBinding, loop.valueBinding]) {
        assert.ok(spansForSymbol(artifact.mapping, getNodeProvenance(module, binding).symbolId).length > 0, language)
      }
    }
  })
})
