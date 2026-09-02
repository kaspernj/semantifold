// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "node:test"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

describe("semantic diagnostics", () => {
  it("reports unsupported frontend syntax with a stable code and source location", () => {
    assert.throws(
      () => parse({filename: "unsupported.js", language: "javascript", source: "const value = () => 1\nconsole.log(value())\n"}),
      (error) => {
        assert.ok(error instanceof SemantifoldDiagnostic)
        assert.equal(error.code, "UNSUPPORTED_SYNTAX")
        assert.equal(error.location?.filename, "unsupported.js")
        assert.equal(error.location?.start.line, 1)

        return true
      }
    )
  })

  it("rejects JavaScript functions without JSDoc parameter and return types", () => {
    const source = "function sum(left, right) {\n  if (left > right) return left - right\n  else return right - left\n}\nconsole.log(sum(4, 9))\n"

    assert.throws(
      () => parse({filename: "untyped.js", language: "javascript", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "MISSING_TYPE"
    )
  })

  it("normalizes parser syntax errors without hiding their cause", () => {
    assert.throws(
      () => parse({filename: "broken.ts", language: "typescript", source: "function ("}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "PARSE_ERROR" && error.cause instanceof Error
    )
  })

  it("reports backend capability failures instead of emitting partial code", async () => {
    const source = await readFile(new URL("fixtures/program.js", import.meta.url), "utf8")
    const module = parse({filename: "program.js", language: "javascript", source})

    module.functions[0].parameters.pop()

    assert.throws(
      () => generate({language: "java", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY"
    )
  })
})
