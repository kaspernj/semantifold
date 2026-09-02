// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

/**
 * Loads a fresh valid semantic module.
 * @returns {Promise<import("../src/semantic/types.js").SemanticModule>} Semantic module.
 */
async function validModule() {
  const source = await readFile(new URL("fixtures/program.js", import.meta.url), "utf8")

  return parse({filename: "program.js", language: "javascript", source})
}

/**
 * Loads a fresh valid boolean/string semantic module.
 * @returns {Promise<import("../src/semantic/types.js").SemanticModule>} Semantic module.
 */
async function validScalarModule() {
  const source = await readFile(new URL("fixtures/scalars/program.js", import.meta.url), "utf8")

  return parse({filename: "scalar-program.js", language: "javascript", source})
}

/**
 * Loads a fresh valid semantic module containing locals.
 * @returns {Promise<import("../src/semantic/types.js").SemanticModule>} Semantic module.
 */
async function validLocalModule() {
  const source = await readFile(new URL("fixtures/locals/program.ts", import.meta.url), "utf8")

  return parse({filename: "locals.ts", language: "typescript", source})
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

  it("rejects scalar condition, return, and call argument type mismatches", async () => {
    for (const mismatch of ["condition", "return", "argument"]) {
      const module = await validScalarModule()
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body[0].expression)

      if (mismatch == "condition") branch.condition = branch.consequent[0].expression
      else if (mismatch == "return") branch.consequent[0].expression = call.arguments[0]
      else call.arguments[0] = call.arguments[1]

      assert.throws(
        () => generate({language: "typescript", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "typescript" && error.location?.filename == "scalar-program.js",
        mismatch
      )
    }
  })

  it("rejects duplicate function names before selecting a signature", async () => {
    const module = await validScalarModule()

    module.functions.push(module.functions[0])

    assert.throws(
      () => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.message.includes("duplicate function")
    )
  })

  it("rejects malformed scalar types and literal payloads before emission", async () => {
    for (const malformed of ["type", "boolean", "string"]) {
      const module = await validScalarModule()
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body[0].expression)

      if (malformed == "type") Reflect.set(module.functions[0].parameters[0].type, "name", "float")
      else if (malformed == "boolean") Reflect.set(call.arguments[0], "value", "true")
      else Reflect.set(branch.consequent[0].expression, "value", "\uD800")

      assert.throws(
        () => generate({language: "java", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "java" && error.location?.filename == "scalar-program.js",
        malformed
      )
    }
  })

  it("rejects invalid local binding semantics before emission", async () => {
    for (const invalid of ["immutable", "initializer type", "assignment type", "unresolved target"]) {
      const module = await validLocalModule()
      const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body[1])
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.at(-1))
      const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent[0])

      if (invalid == "immutable") declaration.mutable = false
      else if (invalid == "initializer type") declaration.initializer = {kind: "BooleanLiteral", location: declaration.initializer.location, value: true}
      else if (invalid == "assignment type") assignment.expression = {kind: "BooleanLiteral", location: assignment.expression.location, value: true}
      else assignment.target.name = "missing"

      assert.throws(
        () => generate({language: "java", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "java" && error.location?.filename == "locals.ts",
        invalid
      )
    }
  })

  it("rejects local statements after the restricted terminal shape", async () => {
    const module = await validLocalModule()

    module.functions[0].body.push(module.functions[0].body[0])

    assert.throws(
      () => generate({language: "php", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "php"
    )
  })

  it("rejects malformed local mutability and non-identifier assignment targets", async () => {
    for (const malformed of ["mutability", "target"]) {
      const module = await validLocalModule()
      const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body[1])
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.at(-1))
      const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent[0])

      if (malformed == "mutability") Reflect.set(declaration, "mutable", "yes")
      else Reflect.set(assignment.target, "kind", "CallExpression")

      assert.throws(
        () => generate({language: "typescript", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "typescript" && error.location?.filename == "locals.ts",
        malformed
      )
    }
  })
})
