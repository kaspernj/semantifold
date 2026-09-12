// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForSymbol} from "../index.js"

describe("type parameter provenance and mapping", () => {
  it("tracks declaration-scoped parameters, every variable reference, and deterministic generated spans", async () => {
    const source = await readFile(new URL("fixtures/generics/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const repeated = parse({filename: "program.ts", language: "typescript", source})
    const parameter = module.functions[0].typeParameters[0]
    const reference = module.functions[0].parameters[0].type
    const parameterNode = getNodeProvenance(module, parameter)
    const referenceNode = getNodeProvenance(module, reference)
    const symbol = getSymbolProvenance(module, /** @type {string} */ (parameterNode.symbolId))

    expect(module.provenance).toEqual(repeated.provenance)
    expect(source.slice(parameterNode.ranges.name.start.offset, parameterNode.ranges.name.end.offset)).toEqual("T")
    expect(source.slice(referenceNode.ranges.type.start.offset, referenceNode.ranges.type.end.offset)).toEqual("T")
    expect(symbol).toMatchObject({kind: "typeParameter", name: "T", semanticDeclarationId: "function:0:type:0"})
    assert.ok(symbol.references.some(({nodeId, role}) => nodeId == referenceNode.id && role == "type"))

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const artifact = generateArtifact({language, module})
      const spans = spansForSymbol(artifact.mapping, /** @type {string} */ (parameterNode.symbolId))

      assert.ok(spans.some(({role}) => role == "name"), language)
      assert.ok(spans.some(({role}) => role == "type"), language)
    }
  })
})
