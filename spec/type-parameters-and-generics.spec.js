// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {validateParsedModule} from "../src/semantic/validate.js"

const fixture = async () => readFile(new URL("fixtures/generics/program.ts", import.meta.url), "utf8")

function rejects(source, code) {
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      error.language == "typescript" && error.location?.filename == "invalid.ts"
  )
}

describe("type parameters and generic semantic validation", () => {
  it("assigns declaration-scoped identities and resolves argument-only inference plus recursive substitutions", async () => {
    const module = parse({filename: "program.ts", language: "typescript", source: await fixture()})
    const batch = module.records[0]
    const identity = module.functions[0]
    const passthrough = module.functions[1]
    const expressions = module.entryPoint.body.statements.slice(2).map((statement) =>
      /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression)
    const calls = [
      /** @type {import("../src/semantic/types.js").MemberRead} */ (expressions[0]).receiver,
      /** @type {import("../src/semantic/types.js").MemberRead} */ (
        /** @type {import("../src/semantic/types.js").CollectionSizeExpression} */ (expressions[1]).collection).receiver,
      expressions[2],
      expressions[3]
    ]

    expect(batch.typeParameters).toMatchObject([{id: "record:0:type:0", kind: "TypeParameter", name: "T"}])
    expect(identity.typeParameters).toMatchObject([{id: "function:0:type:0", kind: "TypeParameter", name: "T"}])
    expect(passthrough.parameters[0].type).toMatchObject({
      arguments: [{kind: "TypeVariableReference", parameterId: "function:1:type:0"}],
      declarationId: "record:0",
      kind: "RecordType"
    })
    expect(calls.map((call) => call.kind == "CallExpression" ? call.resolution.typeArguments : undefined)).toEqual([
      [{arguments: ["string"], declarationId: "record:1", kind: "RecordType"}],
      ["string"],
      ["string", "integer"],
      ["integer"]
    ])
    expect(calls.map((call) => call.kind == "CallExpression" ? call.resolution.returnType : undefined)).toEqual([
      {arguments: ["string"], declarationId: "record:1", kind: "RecordType"},
      {arguments: ["string"], declarationId: "record:0", kind: "RecordType"},
      "string",
      "integer"
    ])
  })

  it("reports stable located diagnostics for declaration, application, inference, and recursion failures", () => {
    const cases = [
      ["DUPLICATE_TYPE_PARAMETER", "function value<T, T>(item: T): T { return item }\nconsole.log(value(1))\n"],
      ["UNSUPPORTED_SYNTAX", "function value<T extends string>(item: T): T { return item }\nconsole.log(value(\"x\"))\n"],
      ["UNSUPPORTED_SYNTAX", "function value<T = string>(item: T): T { return item }\nconsole.log(value(\"x\"))\n"],
      ["GENERIC_ARITY_MISMATCH", "class Box<T> { constructor(readonly value: T) {} }\nfunction keep(value: string): string { return value }\nconst box: Box<string, number> = new Box<string, number>(\"x\", 1)\nconsole.log(box.value)\n"],
      ["RAW_GENERIC_APPLICATION", "class Box<T> { constructor(readonly value: T) {} }\nfunction keep(value: string): string { return value }\nconst box: Box = new Box(\"x\")\nconsole.log(box.value)\n"],
      ["GENERIC_INFERENCE_CONFLICT", "function same<T>(left: T, right: T): T { return left }\nconsole.log(same(1, \"x\"))\n"],
      ["GENERIC_INFERENCE_FAILURE", "function create<T>(value: number): T { return create(value) }\nconst text: string = create(1)\nconsole.log(text)\n"],
      ["GENERIC_INFERENCE_FAILURE", "function copy<T>(items: ReadonlyArray<T>): ReadonlyArray<T> { return items }\nconsole.log(copy([]).length)\n"],
      ["GENERIC_INFERENCE_RECURSION", "function nest<T>(value: T): T { return nest([value]) }\nconsole.log(nest(1))\n"],
      ["UNSUPPORTED_SYNTAX", "function value<T>(item: T): T { return item }\nconsole.log(value<string>(\"x\"))\n"],
      ["UNSUPPORTED_SYNTAX", "type Value<T> = T extends string ? T : string\nfunction value(input: string): string { return input }\nconsole.log(value(\"x\"))\n"]
    ]

    for (const [code, source] of cases) rejects(source, code)
  })

  it("rejects free or unknown semantic type-variable identities", async () => {
    const module = parse({filename: "program.ts", language: "typescript", source: await fixture()})

    module.functions[0].parameters[0].type.parameterId = "function:99:type:0"
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "FREE_TYPE_VARIABLE" &&
        error.location?.filename == "program.ts"
    )
    const recursive = parse({filename: "program.ts", language: "typescript", source: await fixture()})
    /** @type {import("../src/semantic/types.js").RecordType} */
    const cyclic = {arguments: [], declarationId: "record:0", kind: "RecordType"}

    cyclic.arguments = [cyclic]
    recursive.functions[0].parameters[0].type = cyclic
    assert.throws(
      () => validateParsedModule(recursive, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TYPE_MISMATCH" &&
        error.location?.filename == "program.ts"
    )
  })

  it("infers variables recursively from non-empty collection arguments without return-type context", () => {
    const source = `function passList<T>(values: ReadonlyArray<T>): ReadonlyArray<T> { return values }
function passMap<T>(values: ReadonlyMap<string, T>): ReadonlyMap<string, T> { return values }
console.log(passList(["x"]).length)
console.log(passMap(new Map([["x", 1]])).size)
`
    const module = parse({filename: "collections.ts", language: "typescript", source})
    const calls = module.entryPoint.body.statements.map((statement) => {
      const size = /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression

      return /** @type {import("../src/semantic/types.js").CallExpression} */ (
        /** @type {import("../src/semantic/types.js").CollectionSizeExpression} */ (size).collection)
    })

    expect(calls.map(({resolution}) => resolution.typeArguments)).toEqual([["string"], ["integer"]])
    rejects("function keep(value: string): string { return value }\nconsole.log([\"x\"].length)\n", "MISSING_TYPE")
  })

  it("infers through present optionals and contextually validates evidence-free arguments after order-independent inference", () => {
    const source = `function optionalIdentity<T>(value: T | null): T | null { return value }
function leadingEvidence<T>(value: T, values: ReadonlyArray<T>): T { return value }
function trailingEvidence<T>(values: ReadonlyArray<T>, value: T): T { return value }
const present: string | null = optionalIdentity("present")
if (present !== null) { console.log(present) }
console.log(leadingEvidence("leading", []))
console.log(trailingEvidence([], "trailing"))
`
    const module = parse({filename: "inference.ts", language: "typescript", source})
    const statements = module.entryPoint.body.statements
    const optionalCall = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (statements[0]).initializer
    const leadingCall = /** @type {import("../src/semantic/types.js").PrintStatement} */ (statements[2]).expression
    const trailingCall = /** @type {import("../src/semantic/types.js").PrintStatement} */ (statements[3]).expression

    expect([optionalCall, leadingCall, trailingCall].map((expression) =>
      /** @type {import("../src/semantic/types.js").CallExpression} */ (expression).resolution.typeArguments)).toEqual([
      ["string"],
      ["string"],
      ["string"]
    ])
    rejects("function empty<T>(values: ReadonlyArray<T>): ReadonlyArray<T> { return values }\nconsole.log(empty([]).length)\n",
      "GENERIC_INFERENCE_FAILURE")
  })

  it("rejects explicit argument arrays on non-generic record references in external semantic IR", () => {
    const source = `class Plain { constructor(readonly value: string) {} }
function keep(value: string): string { return value }
const plain: Plain = new Plain("value")
console.log(keep(plain.value))
`
    const module = parse({filename: "plain.ts", language: "typescript", source})
    const local = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])
    const recordType = /** @type {import("../src/semantic/types.js").RecordType} */ (local.type)

    recordType.arguments = []
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "GENERIC_ARITY_MISMATCH" &&
        error.location?.filename == "plain.ts"
    )
  })
})
