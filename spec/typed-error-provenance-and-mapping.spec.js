// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForNode, spansForSymbol} from "../index.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]

describe("typed error provenance and mapping", () => {
  it("binds declarations, constructions, catch types, bindings, and message reads", async () => {
    const source = await readFile(new URL("fixtures/errors/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const error = module.errors?.[0]

    assert.ok(error)
    const errorNode = getNodeProvenance(module, error)
    const errorSymbol = getSymbolProvenance(module, /** @type {string} */ (errorNode.symbolId))
    const outer = /** @type {import("../src/semantic/types.js").TryStatement} */ (module.functions[0].body.statements[0])
    const inner = /** @type {import("../src/semantic/types.js").TryStatement} */ (outer.body.statements[0])
    const bindingNode = getNodeProvenance(module, inner.catchBinding)
    const bindingSymbol = getSymbolProvenance(module, /** @type {string} */ (bindingNode.symbolId))
    const catchTypeNode = module.provenance?.nodes.find(({path}) =>
      path == "/functions/0/body/statements/0/body/statements/0/catchType")

    assert.ok(catchTypeNode)

    expect({kind: errorSymbol.kind, roles: [...new Set(errorSymbol.references.map(({role}) => role))].sort()}).toEqual({
      kind: "error",
      roles: ["construct", "type"]
    })
    expect({kind: bindingSymbol.kind, roles: bindingSymbol.references.map(({role}) => role)}).toEqual({kind: "catch", roles: ["read"]})

    for (const language of cohort) {
      const artifact = generateArtifact({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module})
      const roles = new Set(spansForSymbol(artifact.mapping, /** @type {string} */ (errorNode.symbolId)).map(({role}) => role))

      assert.ok(roles.has("name"), language)
      assert.ok(roles.has("type"), language)
      for (const node of [inner, inner.catchBinding, inner.catchBody]) {
        assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, node).id).length > 0, `${language}:${node.kind}`)
      }
      assert.ok(spansForNode(artifact.mapping, catchTypeNode.id).length > 0, `${language}:ErrorType`)
      assert.equal(artifact.sourceMap.sourcesContent[0], source)
    }
  })
})
