// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

function rejects(source, code, token) {
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      source.slice(error.location.start.offset, error.location.end.offset) == token
  )
}

describe("condition-controlled loop semantic validation", () => {
  it("requires strict Boolean conditions without truthiness or optional-as-condition behavior", () => {
    rejects("function run(): number { while (1) { break } return 0 }\n", "NON_BOOLEAN_CONDITION", "1")
    rejects("function run(value: number | null): number { while (value) { break } return 0 }\n",
      "NON_BOOLEAN_CONDITION", "value")
  })

  it("marks statements after unconditional loop control or return unreachable", () => {
    for (const control of ["break", "continue"]) {
      rejects(`function run(flag: boolean): number { while (flag) { ${control}; console.log(1) } return 0 }\n`,
        "UNREACHABLE_STATEMENT", "console.log(1)")
    }
    rejects("function run(flag: boolean): number { while (flag) { return 1; console.log(1) } return 0 }\n",
      "UNREACHABLE_STATEMENT", "console.log(1)")
  })

  it("keeps loop fallthrough possible and permits a function return from a loop", () => {
    const incomplete = "function run(flag: boolean): number { while (flag) { return 1 } }\n"

    rejects(incomplete, "MISSING_RETURN", "function run(flag: boolean): number { while (flag) { return 1 } }")
    const complete = parse({
      filename: "valid.ts",
      language: "typescript",
      source: "function run(flag: boolean): number { while (flag) { return 1 } return 0 }\n"
    })

    expect(complete.functions[0].body.statements.map(({kind}) => kind))
      .toEqual(["WhileStatement", "ReturnStatement"])
  })

  it("invalidates outer mutable facts changed on any loop path before repeated condition evaluation", () => {
    rejects(`function run(flag: boolean): number {
  const values: readonly number[] = [7]
  let index: number = 0
  while (index === 0) {
    if (flag) { index = 1; break }
    break
  }
  return values[index]
}
`, "UNCHECKED_COLLECTION_ACCESS", "values[index]")

    assert.doesNotThrow(() => parse({
      filename: "valid.ts",
      language: "typescript",
      source: `function run(flag: boolean): number {
  const values: readonly number[] = [7]
  let stableIndex: number = 0
  let changed: number = 0
  while (flag) { changed = 1; break }
  return values[stableIndex]
}
`
    }))
  })
})
