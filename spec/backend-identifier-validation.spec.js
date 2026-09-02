// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

describe("backend identifier validation", () => {
  it("rejects a PHP-reserved function and callee name", () => {
    const source = `
function echo(left: number, right: number): number {
  if (left > right) return left - right
  else return right - left
}
console.log(echo(4, 9))
`
    const module = parse({filename: "echo.ts", language: "typescript", source})

    assert.throws(
      () => generate({language: "php", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "php" && error.location?.filename == "echo.ts"
    )
  })

  it("rejects Ruby-reserved parameter and identifier names", () => {
    const source = `
function difference(left: number, end: number): number {
  if (left > end) return left - end
  else return end - left
}
console.log(difference(4, 9))
`
    const module = parse({filename: "end.ts", language: "typescript", source})

    assert.throws(
      () => generate({language: "ruby", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "ruby" && error.location?.filename == "end.ts"
    )
  })
})
