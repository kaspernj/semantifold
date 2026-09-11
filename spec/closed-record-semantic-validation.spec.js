// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {validateParsedModule} from "../src/semantic/validate.js"

const program = (declarations, entry = "console.log(1)") => `${declarations}
function identity(value: string): string { return value }
${entry}
`

function rejects(source, code) {
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      error.language == "typescript" && error.location?.filename == "invalid.ts"
  )
}

describe("closed record semantic validation", () => {
  it("rejects duplicate nominal declarations and duplicate ordered fields", () => {
    const module = parse({
      filename: "invalid.ts",
      language: "typescript",
      source: program(`class User { constructor(readonly name: string) {} }
class Alias { constructor(readonly value: string) {} }`)
    })
    module.records[1].name = "User"
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_RECORD" &&
        error.location?.filename == "invalid.ts"
    )

    module.records[1].name = "Alias"
    const field = module.records[0].fields[0]

    module.records[0].fields.push({...field, id: undefined})
    assert.throws(
      () => validateParsedModule(module, "typescript"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_FIELD" &&
        error.location?.filename == "invalid.ts"
    )
  })

  it("enforces exact construction arity, argument types, and nominal assignment", () => {
    const declarations = `class Left { constructor(readonly value: string) {} }
class Right { constructor(readonly value: string) {} }`

    rejects(program(declarations, "const left: Left = new Left()\nconsole.log(left.value)"), "RECORD_ARITY_MISMATCH")
    rejects(program(declarations, "const left: Left = new Left(1)\nconsole.log(left.value)"), "TYPE_MISMATCH")
    rejects(program(declarations,
      'const left: Left = new Left("x")\nconst right: Right = left\nconsole.log(right.value)'), "TYPE_MISMATCH")
  })

  it("resolves fields only on nominal receivers", () => {
    const declarations = "class User { constructor(readonly name: string) {} }"

    rejects(program(declarations, 'const user: User = new User("Ada")\nconsole.log(user.missing)'), "UNKNOWN_FIELD")
    rejects(program(declarations, 'console.log("Ada".name)'), "INVALID_MEMBER_RECEIVER")
  })

  it("rejects direct record cycles but permits explicitly represented optional and container recursion", () => {
    rejects(program("class Node { constructor(readonly next: Node) {} }"), "ILLEGAL_RECORD_RECURSION")
    rejects(program(`class Left { constructor(readonly right: Right) {} }
class Right { constructor(readonly left: Left) {} }`), "ILLEGAL_RECORD_RECURSION")

    const module = parse({
      filename: "recursive.ts",
      language: "typescript",
      source: program(
        "class Node { constructor(readonly next: Node | null, readonly children: ReadonlyArray<Node>) {} }",
        "const node: Node = new Node(null, [])\nconsole.log(node.children.length)"
      )
    })

    expect(module.records[0].fields.map((field) => field.type.kind)).toEqual(["OptionalType", "ListType"])
  })
})
