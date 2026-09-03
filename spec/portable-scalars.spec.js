// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {parse} from "../index.js"

const fixtures = [
  ["php", "program.php", {entry: 13, function: 4, parameter: 4, returnedLiteral: 7}],
  ["ruby", "program.rb", {entry: 12, function: 4, parameter: 4, returnedLiteral: 6}],
  ["javascript", "program.js", {entry: 15, function: 7, parameter: 7, returnedLiteral: 9}],
  ["typescript", "program.ts", {entry: 9, function: 1, parameter: 1, returnedLiteral: 3}],
  ["java", "Main.java", {entry: 11, function: 2, parameter: 2, returnedLiteral: 4}]
]

/**
 * Removes source locations to compare language-neutral meaning.
 * @template Value
 * @param {Value} value - Semantic value.
 * @returns {Value} Location-free semantic value.
 */
function withoutLocations(value) {
  if (Array.isArray(value)) {
    return /** @type {Value} */ (value.map((item) => withoutLocations(item)))
  }

  if (value && typeof value == "object") {
    const entries = Object.entries(value)
      .filter(([key]) => key != "location" && key != "provenance" && key != "sourceProvenance")
      .map(([key, item]) => [key, withoutLocations(item)])

    return /** @type {Value} */ (Object.fromEntries(entries))
  }

  return value
}

const expectedModule = {
  entryPoint: {
    body: [{
      expression: {
        arguments: [
          {kind: "BooleanLiteral", value: true},
          {kind: "StringLiteral", value: "no"}
        ],
        callee: "label",
        kind: "CallExpression"
      },
      kind: "PrintStatement"
    }],
    kind: "EntryPoint"
  },
  functions: [{
    body: [{
      alternate: [{
        expression: {kind: "IdentifierExpression", name: "fallback"},
        kind: "ReturnStatement"
      }],
      condition: {kind: "IdentifierExpression", name: "flag"},
      consequent: [{
        expression: {kind: "StringLiteral", value: "yes"},
        kind: "ReturnStatement"
      }],
      kind: "IfStatement"
    }],
    kind: "FunctionDeclaration",
    name: "label",
    parameters: [
      {kind: "Parameter", name: "flag", type: {kind: "TypeReference", name: "boolean"}},
      {kind: "Parameter", name: "fallback", type: {kind: "TypeReference", name: "string"}}
    ],
    returnType: {kind: "TypeReference", name: "string"}
  }],
  kind: "Module"
}

describe("portable scalar values and types", () => {
  it("normalizes equivalent boolean and string fixtures with precise source locations", async () => {
    const modules = []

    for (const [language, filename, lines] of fixtures) {
      const source = await readFile(new URL(`fixtures/scalars/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const functionDeclaration = module.functions[0]
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (functionDeclaration.body[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body[0].expression)

      assert.deepEqual(withoutLocations(module), expectedModule, language)
      assert.equal(functionDeclaration.location.filename, filename)
      assert.equal(functionDeclaration.location.start.line, lines.function)
      assert.equal(functionDeclaration.parameters[0].location.start.line, lines.parameter)
      assert.equal(branch.consequent[0].expression.location.start.line, lines.returnedLiteral)
      assert.equal(call.arguments[0].location.start.line, lines.entry)
      assert.equal(call.arguments[1].location.start.line, lines.entry)
      modules.push(withoutLocations(module))
    }

    for (const semanticModule of modules.slice(1)) assert.deepEqual(semanticModule, modules[0])
  })
})
