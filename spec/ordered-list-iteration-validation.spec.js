// @ts-check

import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

const fixture = readFileSync(new URL("fixtures/iteration/program.ts", import.meta.url), "utf8")

function rejects(source, code, token) {
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      source.slice(error.location.start.offset, error.location.end.offset) == token
  )
}

describe("ordered list iteration semantic validation", () => {
  it("enforces body-only immutable bindings, no shadowing, and exact list element types", () => {
    const prefix = "function identity(value: number): number { return value }\n"

    rejects(`${prefix}const values: readonly number[] = [1]\nfor (const value of values) {}\nconsole.log(value)\n`,
      "UNRESOLVED_BINDING", "value")
    rejects(`${prefix}const values: readonly number[] = [1]\nfor (const value of values) { value = 2 }\n`,
      "IMMUTABLE_ASSIGNMENT", "value")
    rejects(`${prefix}const value: number = 1\nconst values: readonly number[] = [1]\nfor (const value of values) {}\n`,
      "DUPLICATE_BINDING", "value")
    rejects(`${prefix}const values: ReadonlyMap<string, number> = new Map([["a", 1]])\nfor (const value of values) {}\n`,
      "TYPE_MISMATCH", "values")

    const module = parse({filename: "program.ts", language: "typescript", source: fixture})
    const loop = module.functions[1].body.statements[1]

    loop.valueBinding.type = {kind: "TypeReference", name: "string"}
    assert.throws(
      () => generate({language: "typescript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("Iteration binding type string; expected integer")
    )
  })

  it("requires loop context and does not treat a loop-body return as function completeness", () => {
    const phpPrefix = "<?php\ndeclare(strict_types=1);\nfunction identity(int $value): int { return $value; }\n"

    for (const [control, code] of [["break", "ILLEGAL_BREAK_CONTEXT"], ["continue", "ILLEGAL_CONTINUE_CONTEXT"]]) {
      const source = `${phpPrefix}${control};\n`

      assert.throws(
        () => parse({filename: "invalid.php", language: "php", source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
          source.slice(error.location.start.offset, error.location.end.offset) == control
      )
    }
    rejects(`function first(values: readonly number[]): number {\n  for (const value of values) { return value }\n}\nconsole.log(first([1]))\n`,
      "MISSING_RETURN", "function first(values: readonly number[]): number {\n  for (const value of values) { return value }\n}")
    for (const control of ["break", "continue"]) {
      const source = `${phpPrefix}/** @var list<int> $values */\n$values = [1];\nforeach ($values as $value) { ${control}; echo $value, PHP_EOL; }\n`

      assert.throws(
        () => parse({filename: "invalid.php", language: "php", source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNREACHABLE_STATEMENT" &&
          source.slice(error.location.start.offset, error.location.end.offset) == "echo $value, PHP_EOL;"
      )
    }
    const nested = parse({
      filename: "nested.ts",
      language: "typescript",
      source: `function identity(value: number): number { return value }
const values: readonly number[] = [1]
for (const outerValue of values) {
  for (const innerValue of values) { break }
  console.log(outerValue)
  continue
}
`
    })

    expect(nested.entryPoint.body.statements.at(-1)?.kind).toEqual("ForEachStatement")
    expect(parse({filename: "program.ts", language: "typescript", source: fixture}).functions[1].body.statements.at(-1)?.kind)
      .toEqual("ReturnStatement")
  })

  it("invalidates only outer mutable value facts that any loop path may assign", () => {
    rejects(`function unsafe(flag: boolean): number {
  const values: readonly number[] = [7]
  const iterations: readonly number[] = [1]
  let index: number = 0
  for (const ignored of iterations) {
    if (flag) { index = 1; break }
  }
  return values[index]
}
console.log(unsafe(true))
`, "UNCHECKED_COLLECTION_ACCESS", "values[index]")
    rejects(`function unsafeAfterContinue(flag: boolean): number {
  const values: readonly number[] = [7]
  const iterations: readonly number[] = [1]
  let index: number = 0
  for (const ignored of iterations) {
    if (flag) { index = 1; continue }
  }
  return values[index]
}
console.log(unsafeAfterContinue(true))
`, "UNCHECKED_COLLECTION_ACCESS", "values[index]")

    assert.doesNotThrow(() => parse({
      filename: "stable.ts",
      language: "typescript",
      source: `function stable(flag: boolean): number {
  const values: readonly number[] = [7]
  const iterations: readonly number[] = [1]
  let stableIndex: number = 0
  let changed: number = 0
  for (const ignored of iterations) {
    if (flag) { changed = 1; break }
  }
  return values[stableIndex]
}
console.log(stable(true))
`
    }))
    assert.doesNotThrow(() => parse({
      filename: "pre-loop.ts",
      language: "typescript",
      source: `function preLoop(): number {
  const nested: ReadonlyArray<ReadonlyArray<number>> = [[7]]
  let index: number = 0
  for (const value of nested[index]) { index = 1; break }
  return 0
}
console.log(preLoop())
`
    }))
  })
})
