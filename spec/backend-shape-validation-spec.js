// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "node:test"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

/**
 * Loads a fresh valid semantic module.
 * @returns {Promise<import("../src/semantic/types.js").SemanticModule>} Semantic module.
 */
async function validModule() {
  const source = await readFile(new URL("fixtures/program.js", import.meta.url), "utf8")

  return parse({filename: "program.js", language: "javascript", source})
}

describe("backend shape validation", () => {
  it("rejects Java integer literals outside the signed 32-bit range", async () => {
    for (const value of [2147483648, -2147483649]) {
      const module = await validModule()
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body[0].expression)
      const literal = /** @type {import("../src/semantic/types.js").IntegerLiteral} */ (call.arguments[0])

      literal.value = value

      assert.throws(
        () => generate({language: "java", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "java" && error.location?.filename == "program.js",
        String(value)
      )
    }
  })

  it("rejects empty and multi-return branches before emitters run", async () => {
    for (const branchShape of ["empty", "multiple"]) {
      const module = await validModule()
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])

      if (branchShape == "empty") branch.consequent = []
      else branch.alternate.push(branch.alternate[0])

      assert.throws(
        () => generate({language: "php", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "php",
        branchShape
      )
    }
  })
})
