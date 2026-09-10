// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

function rejects(source, code, token) {
  source = `function identity(value: number): number { return value }\n${source}`
  assert.throws(
    () => parse({filename: "invalid.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
      source.slice(error.location.start.offset, error.location.end.offset) == token
  )
}

describe("immutable collection validation", () => {
  it("diagnoses literal bounds, missing keys, duplicate keys, invalid keys, and heterogeneous members exactly", () => {
    rejects("const xs: readonly number[] = [1]\nconsole.log(xs[1])\n", "INDEX_OUT_OF_BOUNDS", "xs[1]")
    rejects("const m: ReadonlyMap<string, number> = new Map([[\"a\", 1]])\nconsole.log(m.get(\"missing\"))\n",
      "MISSING_MAP_KEY", "m.get(\"missing\")")
    rejects("const m: ReadonlyMap<string, number> = new Map([[\"a\", 1], [\"a\", 2]])\n", "DUPLICATE_MAP_KEY", "\"a\"")
    rejects("const m: ReadonlyMap<string, number> = new Map([[\"12\", 1]])\n", "INVALID_MAP_KEY", "\"12\"")
    rejects("const xs: readonly number[] = [1, \"wrong\"]\n", "TYPE_MISMATCH", "\"wrong\"")
  })

  it("rejects unchecked reads and excluded collection source shapes", () => {
    const cases = [
      "const xs: readonly number[] = [1, , 2]\n",
      "const base: readonly number[] = [1]\nconst xs: readonly number[] = [...base]\n",
      "const m: ReadonlyMap<string, number> = {a: 1}\n",
      "const xs: number[] = [1]\n",
      "const xs: readonly [number, number] = [1, 2]\n",
      "function read(m: ReadonlyMap<string, number>, key: string): number { return m.get(key) }\n"
    ]

    for (const source of cases) {
      assert.throws(
        () => parse({filename: "invalid.ts", language: "typescript", source}),
        (error) => error instanceof SemantifoldDiagnostic && ["MISSING_TYPE", "UNSUPPORTED_SYNTAX", "UNCHECKED_COLLECTION_ACCESS"].includes(error.code)
      )
    }
    assert.throws(
      () => parse({
        filename: "branch-proof.ts",
        language: "typescript",
        source: `function read(flag: boolean): number {
  let xs: readonly number[] = [1]
  if (flag) xs = []
  else xs = [1]
  return xs[0]
}
console.log(read(true))
`
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNCHECKED_COLLECTION_ACCESS"
    )
    expect(cases).toHaveLength(6)
  })
})
