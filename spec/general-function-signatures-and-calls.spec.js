// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

function withoutSource(node) {
  return JSON.parse(JSON.stringify(node, (key, value) =>
    ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : value))
}

function expectDiagnostic(source, code) {
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      error.language == "typescript" && error.location?.filename == "invalid.ts" && error.location.start.line > 0
  )
}

describe("general required function signatures and calls", () => {
  it("normalizes equivalent zero-, one-, and three-parameter functions, recursion, nested calls, and void calls", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/functions/${filename}`, import.meta.url), "utf8")

      modules.push(parse({filename, language, source}))
    }
    const expected = withoutSource(modules[0])

    for (const module of modules.slice(1)) expect(withoutSource(module)).toEqual(expected)
    expect(modules[0].functions.map(({id, name, parameters, returnType}) => ({
      id,
      name,
      parameterCount: parameters.length,
      returnType: returnType.name
    }))).toEqual([
      {id: "function:0", name: "zero", parameterCount: 0, returnType: "integer"},
      {id: "function:1", name: "passText", parameterCount: 1, returnType: "string"},
      {id: "function:2", name: "sum3", parameterCount: 3, returnType: "integer"},
      {id: "function:3", name: "countdown", parameterCount: 1, returnType: "integer"},
      {id: "function:4", name: "announce", parameterCount: 1, returnType: "void"},
      {id: "function:5", name: "noop", parameterCount: 0, returnType: "void"},
      {id: "function:6", name: "nested", parameterCount: 3, returnType: "integer"}
    ])

    const recursion = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      /** @type {import("../src/semantic/types.js").IfStatement} */ (modules[0].functions[3].body.statements[0]).consequent.statements[0]
    ).expression
    const voidCall = /** @type {import("../src/semantic/types.js").ExpressionStatement} */ (
      modules[0].entryPoint.body.statements[0]
    ).expression

    assert.ok(recursion?.kind == "CallExpression")
    expect(recursion.resolution).toEqual({
      declarationId: "function:3",
      kind: "ResolvedFunctionSignature",
      parameterTypes: ["integer"],
      returnType: "integer"
    })
    expect(voidCall.resolution.returnType).toEqual("void")
    expect(modules[0].functions[4].body.statements.every(({kind}) => kind != "ReturnStatement")).toBeTrue()
    expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      modules[0].functions[5].body.statements[0]
    ).expression).toEqual(undefined)

    const mutuallyRecursive = parse({
      filename: "mutual.ts",
      language: "typescript",
      source: `function even(value: number): boolean {
  if (value > 0) return odd(value - 1)
  return true
}
function odd(value: number): boolean {
  if (value > 0) return even(value - 1)
  return false
}
console.log(even(4))
`
    })
    const forwardCall = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      /** @type {import("../src/semantic/types.js").IfStatement} */ (
        mutuallyRecursive.functions[0].body.statements[0]
      ).consequent.statements[0]
    ).expression

    assert.ok(forwardCall?.kind == "CallExpression")
    expect(forwardCall.resolution.declarationId).toEqual("function:1")
  })

  it("reports stable semantic diagnostics for declaration, call, return, and void-value violations", () => {
    const cases = [
      ["DUPLICATE_BINDING", `function same(): number { return 1 }\nfunction same(): number { return 2 }\nconsole.log(same())\n`],
      ["UNRESOLVED_BINDING", `function value(): number { return missing() }\nconsole.log(value())\n`],
      ["TYPE_MISMATCH", `function one(value: number): number { return value }\nconsole.log(one())\n`],
      ["TYPE_MISMATCH", `function one(value: number): number { return value }\nconsole.log(one("wrong"))\n`],
      ["VOID_RETURN_VALUE", `function stop(): void { return 1 }\nstop()\n`],
      ["MISSING_RETURN_VALUE", `function value(): number { return }\nconsole.log(value())\n`],
      ["MISSING_RETURN", `function value(flag: boolean): number { if (flag) return 1 }\nconsole.log(value(true))\n`],
      ["VOID_AS_VALUE", `function stop(): void {}\nconsole.log(stop())\n`],
      ["VOID_AS_VALUE", `function stop(): void {}\nfunction use(value: number): number { return value }\nconsole.log(use(stop()))\n`],
      ["VOID_AS_VALUE", `function stop(): void {}\nfunction value(): number { return 1 + stop() }\nconsole.log(value())\n`],
      ["VOID_AS_VALUE", `function stop(): void {}\nfunction value(): number { return stop() }\nconsole.log(value())\n`],
      ["TYPE_MISMATCH", `function value(): number { return 1 }\nvalue()\n`]
    ]

    for (const [code, source] of cases) expectDiagnostic(source, code)
  })
})
