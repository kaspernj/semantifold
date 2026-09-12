// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {validateParsedModule} from "../src/semantic/validate.js"

const classSource = `class Box {
  private value: number
  constructor(value: number) { this.value = value }
  set(value: number): void { this.value = value }
  get(): number { return this.value }
}
function pass(box: Box): Box { return box }
`

function rejects(source, code) {
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      error.language == "typescript" && error.location?.filename == "invalid.ts"
  )
}

describe("reference class semantic validation", () => {
  it("enforces exact construction and nominal method signatures", () => {
    rejects(`${classSource}const box: Box = new Box()\nconsole.log(box.get())\n`, "CONSTRUCTOR_ARITY_MISMATCH")
    rejects(`${classSource}const box: Box = new Box("x")\nconsole.log(box.get())\n`, "TYPE_MISMATCH")
    rejects(`${classSource}const box: Box = new Box(1)\nbox.set()\n`, "METHOD_ARITY_MISMATCH")
    rejects(`${classSource}const box: Box = new Box(1)\nbox.missing()\n`, "UNKNOWN_METHOD")
    rejects(`${classSource}const box: Box = new Box(1)\nbox.set("x")\n`, "TYPE_MISMATCH")
  })

  it("rejects incomplete, repeated, or reordered private initialization at the frontend boundary", () => {
    rejects(`class Box { private value: number; constructor(value: number) {} }
function run(): number { return 0 }
`, "INCOMPLETE_INITIALIZATION")
    rejects(`class Box { private value: number; constructor(value: number) { this.value = value; this.value = value } }
function run(): number { return 0 }
`, "INCOMPLETE_INITIALIZATION")
    rejects(`class Pair { private left: number; private right: number; constructor(left: number, right: number) {
  this.right = right; this.left = left
} }
function run(): number { return 0 }
`, "INCOMPLETE_INITIALIZATION")
  })

  it("rejects private access outside the declaring receiver and malformed caller-owned identities", () => {
    rejects(`${classSource}const box: Box = new Box(1)\nconsole.log(box.value)\n`, "UNSUPPORTED_SYNTAX")
    const module = parse({
      filename: "valid.ts",
      language: "typescript",
      source: `${classSource}const box: Box = new Box(1)\nconsole.log(box.get())\n`
    })
    const printed = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[1])
    const receiver = /** @type {import("../src/semantic/types.js").MethodCallExpression} */ (printed.expression).receiver

    printed.expression = /** @type {import("../src/semantic/types.js").Expression} */ ({
      field: "class:0:field:0",
      kind: "PrivateFieldRead",
      location: printed.location,
      receiver
    })
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "ILLEGAL_PRIVATE_ACCESS"
    )
  })

  it("rejects duplicate class, private-field, and method identities", () => {
    const module = parse({filename: "valid.ts", language: "typescript", source: `${classSource}console.log(1)\n`})
    const copy = structuredClone(module.classes[0])

    module.classes.push(copy)
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_CLASS"
    )

    module.classes.pop()
    module.classes[0].fields.push({...module.classes[0].fields[0], id: undefined})
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_PRIVATE_FIELD"
    )

    module.classes[0].fields.pop()
    module.classes[0].methods.push({...module.classes[0].methods[0], id: undefined})
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_METHOD"
    )
  })

  it("retains reference aliases without introducing identity comparison", () => {
    const module = parse({
      filename: "valid.ts",
      language: "typescript",
      source: `${classSource}const box: Box = new Box(1)\nconst alias: Box = pass(box)\nalias.set(2)\nconsole.log(box.get())\n`
    })

    expect(module.entryPoint.body.statements.map(({kind}) => kind)).toEqual([
      "LocalDeclaration", "LocalDeclaration", "ExpressionStatement", "PrintStatement"
    ])
    rejects(`${classSource}function same(left: Box, right: Box): boolean { return left === right }
console.log(same(new Box(1), new Box(1)))
`, "INVALID_OPERAND_TYPE")
  })

  it("rejects a caller-owned method call whose receiver is not a reference", () => {
    const module = parse({
      filename: "valid.ts",
      language: "typescript",
      source: `${classSource}const box: Box = new Box(1)\nconsole.log(box.get())\n`
    })
    const printed = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[1])
    const call = /** @type {import("../src/semantic/types.js").MethodCallExpression} */ (printed.expression)

    call.receiver = {kind: "IntegerLiteral", location: call.receiver.location, value: 1}
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_METHOD_RECEIVER"
    )
  })

  it("permits reference types inside already-supported value containers without structural substitution", () => {
    const module = parse({
      filename: "valid.ts",
      language: "typescript",
      source: `${classSource}class Holder { constructor(readonly box: Box) {} }
function unwrap(holder: Holder): Box { return holder.box }
`
    })

    expect(module.records[0].fields[0].type).toMatchObject({
      declarationId: "class:0",
      kind: "ReferenceType"
    })
  })

  it("fails closed when a method would expose an unchecked-error effect outside Task 033", () => {
    rejects(`class Broken extends Error {}
class Box {
  private value: number
  constructor(value: number) { this.value = value }
  fail(): void { throw new Broken("broken") }
}
function keep(): number { return 0 }
const box: Box = new Box(1)
box.fail()
`, "UNSUPPORTED_STATEMENT")
  })
})
