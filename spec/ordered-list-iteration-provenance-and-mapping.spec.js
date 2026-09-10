// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForNode, spansForSymbol} from "../index.js"

const fixtures = [
  ["ruby", "program.rb"], ["javascript", "program.js"], ["typescript", "program.ts"],
  ["php", "program.php"], ["java", "Main.java"]
]

describe("ordered list iteration provenance and mapping", () => {
  it("preserves deterministic collection, binding, body, break, and continue provenance", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/iteration/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const repeated = parse({filename, language, source})
      const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (module.functions[1].body.statements[1])
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (loop.body.statements[0])
      const continueNode = /** @type {import("../src/semantic/types.js").IfStatement} */ (branch.consequent.statements[0]).consequent.statements[0]
      assert.ok(branch.alternate)
      const breakNode = /** @type {import("../src/semantic/types.js").IfStatement} */ (branch.alternate.statements[0]).consequent.statements[0]
      const bindingRecord = getNodeProvenance(module, loop.valueBinding)

      expect(module.provenance).toEqual(repeated.provenance)
      for (const node of [loop, loop.list, loop.valueBinding, loop.body, breakNode, continueNode]) {
        expect(getNodeProvenance(module, node).origin.location.filename).toEqual(filename)
      }
      assert.ok(bindingRecord.ranges.name)
      expect(source.slice(bindingRecord.ranges.name.start.offset, bindingRecord.ranges.name.end.offset))
        .toEqual(language == "php" ? "$value" : "value")
      const symbol = getSymbolProvenance(module, bindingRecord.symbolId)

      expect(symbol.kind).toEqual("iteration")
      expect(symbol.references.length).toEqual(4)
    }
  })

  it("maps loop/control nodes and the iteration symbol in every cohort backend", async () => {
    const source = await readFile(new URL("fixtures/iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (module.functions[1].body.statements[1])
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (loop.body.statements[0])
    const continueNode = /** @type {import("../src/semantic/types.js").IfStatement} */ (branch.consequent.statements[0]).consequent.statements[0]
    assert.ok(branch.alternate)
    const breakNode = /** @type {import("../src/semantic/types.js").IfStatement} */ (branch.alternate.statements[0]).consequent.statements[0]
    const binding = getNodeProvenance(module, loop.valueBinding)

    for (const language of ["ruby", "javascript", "typescript", "php", "java"]) {
      const artifact = generateArtifact({language, module})

      for (const node of [loop, loop.list, loop.valueBinding, loop.body, breakNode, continueNode]) {
        assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, node).id).length > 0, `${language}:${node.kind}`)
      }
      assert.ok(spansForSymbol(artifact.mapping, binding.symbolId).length > 0, language)
    }
  })
})
