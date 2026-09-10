// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForNode, spansForSymbol} from "../index.js"

const fixtures = [
  ["php", "program.php", ["zero()", "sum3($first, $second, $third)", "countdown(2)"]],
  ["ruby", "program.rb", ["zero()", "sum3(first, second, third)", "countdown(2)"]],
  ["javascript", "program.js", ["zero()", "sum3(first, second, third)", "countdown(2)"]],
  ["typescript", "program.ts", ["zero()", "sum3(first, second, third)", "countdown(2)"]],
  ["java", "Main.java", ["zero()", "sum3(first, second, third)", "countdown(2)"]]
]

function sourceText(source, location) {
  return source.slice(location.start.offset, location.end.offset)
}

describe("general function provenance and mapping", () => {
  it("keeps deterministic exact declaration, parameter, type, callee, argument, return, and resolution provenance", async () => {
    for (const [language, filename, expectedArguments] of fixtures) {
      const source = await readFile(new URL(`fixtures/functions/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const repeated = parse({filename, language, source})
      const declaration = module.functions[6]
      const parameter = declaration.parameters[2]
      const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (declaration.body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (returned.expression)
      const declarationRecord = getNodeProvenance(module, declaration)
      const parameterRecord = getNodeProvenance(module, parameter)
      const parameterTypeRecord = getNodeProvenance(module, parameter.type)
      const returnTypeRecord = getNodeProvenance(module, declaration.returnType)
      const voidReturnTypeRecord = getNodeProvenance(module, module.functions[4].returnType)
      const callRecord = getNodeProvenance(module, call)
      const symbol = getSymbolProvenance(module, /** @type {string} */ (callRecord.symbolId))

      expect(module.provenance).toEqual(repeated.provenance)
      expect(sourceText(source, declarationRecord.ranges.name)).toEqual("nested")
      expect(sourceText(source, parameterRecord.ranges.name).replace(/^\$/u, "")).toEqual("third")
      expect(sourceText(source, parameterTypeRecord.ranges.type)).toMatch(/number|int|Integer/u)
      expect(sourceText(source, returnTypeRecord.ranges.type)).toMatch(/number|int|Integer/u)
      expect(sourceText(source, voidReturnTypeRecord.ranges.type)).toMatch(/void/u)
      expect(sourceText(source, callRecord.ranges.callee)).toEqual("sum3")
      expect(call.arguments).toHaveLength(3)
      expect(call.arguments.map((argument) =>
        sourceText(source, getNodeProvenance(module, argument).origin.location))).toEqual(expectedArguments)
      expect(symbol.name).toEqual("sum3")
      expect(symbol.semanticDeclarationId).toEqual(call.resolution.declarationId)
      expect(symbol.semanticDeclarationId).toEqual(module.functions[2].id)
      assert.ok(symbol.references.some(({nodeId, role}) => nodeId == callRecord.id && role == "call"))
    }
  })

  it("maps function signatures and every resolved direct call deterministically in each required backend", async () => {
    const source = await readFile(new URL("fixtures/functions/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const declaration = module.functions[2]
    const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (module.functions[6].body.statements[0])
    const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (returned.expression)
    const declarationRecord = getNodeProvenance(module, declaration)
    const callRecord = getNodeProvenance(module, call)

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const first = generateArtifact({language, module})
      const second = generateArtifact({language, module})
      const callSpans = spansForNode(first.mapping, callRecord.id)
      const symbolSpans = spansForSymbol(first.mapping, /** @type {string} */ (declarationRecord.symbolId))

      expect(first).toEqual(second)
      assert.ok(callSpans.some((span) => span.role == "callee" && sourceText(first.code, span.generated) == "sum3"))
      assert.ok(symbolSpans.some((span) => span.role == "name" && sourceText(first.code, span.generated) == "sum3"))
      assert.ok(symbolSpans.some((span) => span.role == "callee" && sourceText(first.code, span.generated) == "sum3"))
      for (const argument of call.arguments) {
        assert.ok(spansForNode(first.mapping, getNodeProvenance(module, argument).id).length > 0)
      }
      for (const parameter of declaration.parameters) {
        const nodeId = getNodeProvenance(module, parameter).id

        assert.ok(spansForNode(first.mapping, nodeId).some((span) => span.role == "name"))
        assert.ok(spansForNode(first.mapping, getNodeProvenance(module, parameter.type).id).some((span) => span.role == "type"))
      }
      assert.ok(spansForNode(first.mapping, getNodeProvenance(module, declaration.returnType).id)
        .some((span) => span.role == "type"))
    }
  })
})
