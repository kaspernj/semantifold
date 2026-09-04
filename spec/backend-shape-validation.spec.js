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

const malformedStructures = ["missing", "null", "primitive", "array"]

/**
 * Replaces or removes one semantic field with a malformed external-IR value.
 * @param {object} owner - Semantic object owning the field.
 * @param {string} field - Field to corrupt.
 * @param {string} malformed - Malformation representative.
 * @returns {void}
 */
function corruptField(owner, field, malformed) {
  if (malformed == "missing") Reflect.deleteProperty(owner, field)
  else if (malformed == "null") Reflect.set(owner, field, null)
  else if (malformed == "primitive") Reflect.set(owner, field, 7)
  else if (malformed == "array") Reflect.set(owner, field, [])
  else Reflect.set(owner, field, {length: 2})
}

describe("backend shape validation", () => {
  it("rejects Java integer literals outside the signed 32-bit range", async () => {
    for (const value of [2147483648, -2147483649]) {
      const module = await validModule()
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body.statements[0].expression)
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
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements[0])

      if (branchShape == "empty") branch.consequent.statements = []
      else branch.alternate.statements.push(branch.alternate.statements[0])

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
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body.statements[0].expression)

      if (mismatch == "condition") branch.condition = branch.consequent.statements[0].expression
      else if (mismatch == "return") branch.consequent.statements[0].expression = call.arguments[0]
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
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body.statements[0].expression)

      if (malformed == "type") Reflect.set(module.functions[0].parameters[0].type, "name", "float")
      else if (malformed == "boolean") Reflect.set(call.arguments[0], "value", "true")
      else Reflect.set(branch.consequent.statements[0].expression, "value", "\uD800")

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
      const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[1])
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
      const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent.statements[0])

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

  it("rejects local statements after an exhaustive returning conditional", async () => {
    const module = await validLocalModule()

    module.functions[0].body.statements.push(module.functions[0].body.statements[0])

    assert.throws(
      () => generate({language: "php", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "php"
    )
  })

  it("rejects malformed function and branch statement elements at their nearest blocks", async () => {
    const malformedPrefixes = [
      ["null", null],
      ["primitive", 7],
      ["array", []],
      ["missing kind", {}],
      ["unsupported kind", {kind: "WhileStatement"}]
    ]

    for (const scope of ["function", "consequent", "alternate"]) {
      for (const [malformed, value] of [...malformedPrefixes, ["sparse", undefined]]) {
        const module = await validLocalModule()
        const declaration = module.functions[0]
        const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.statements.at(-1))
        const block = scope == "function" ? declaration.body :
          /** @type {import("../src/semantic/types.js").Block} */ (Reflect.get(branch, scope))
        const statements = block.statements
        const terminal = statements.at(-1)
        const prefix = malformed == "sparse" ? new Array(1) : [value]

        prefix.push(terminal)
        block.statements = /** @type {import("../src/semantic/types.js").Statement[]} */ (prefix)

        assert.throws(
          () => generate({language: "php", module}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
            error.language == "php" && error.location?.filename == "locals.ts" &&
            error.location.start.line == block.location.start.line &&
            error.message.includes(malformed == "unsupported kind" ? "WhileStatement" : "invalid statement"),
          `${scope} ${malformed}`
        )
      }
    }
  })

  it("rejects malformed function and branch block statement lists at their nearest owners", async () => {
    for (const scope of ["function", "consequent", "alternate"]) {
      for (const malformed of ["missing", "null", "primitive", "object"]) {
        const module = await validLocalModule()
        const declaration = module.functions[0]
        const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.statements.at(-1))
        const owner = scope == "function" ? declaration.body :
          /** @type {import("../src/semantic/types.js").Block} */ (Reflect.get(branch, scope))

        corruptField(owner, "statements", malformed)

        assert.throws(
          () => generate({language: "ruby", module}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
            error.language == "ruby" && error.location?.filename == "locals.ts" &&
            error.location.start.line == owner.location.start.line && error.message.includes("block statements"),
          `${scope} ${malformed}`
        )
      }
    }
  })

  it("rejects malformed local mutability and non-identifier assignment targets", async () => {
    for (const malformed of ["mutability", "target"]) {
      const module = await validLocalModule()
      const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[1])
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
      const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent.statements[0])

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

  for (const field of ["name", "mutable", "type", "initializer"]) {
    it(`rejects malformed local declaration ${field} values before emitter dispatch`, async () => {
      for (const malformed of malformedStructures) {
        const module = await validLocalModule()
        const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[1])

        corruptField(declaration, field, malformed)

        assert.throws(
          () => generate({language: "php", module}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
            error.language == "php" && error.location?.filename == "locals.ts" && error.location.start.line == 3,
          `${field} ${malformed}`
        )
      }
    })
  }

  for (const field of ["target", "target name", "expression"]) {
    it(`rejects malformed assignment ${field} values before emitter dispatch`, async () => {
      for (const malformed of malformedStructures) {
        const module = await validLocalModule()
        const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
        const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent.statements[0])

        if (field == "target name") corruptField(assignment.target, "name", malformed)
        else corruptField(assignment, field, malformed)

        assert.throws(
          () => generate({language: "php", module}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
            error.language == "php" && error.location?.filename == "locals.ts" && error.location.start.line == 5,
          `${field} ${malformed}`
        )
      }
    })
  }

  it("rejects malformed call fields in local initializers and assignment expressions", async () => {
    for (const placement of ["initializer", "assignment"]) {
      for (const field of ["callee", "arguments"]) {
        for (const malformed of [...malformedStructures, "object"]) {
          const module = await validLocalModule()
          const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[1])
          const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
          const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent.statements[0])
          const owner = placement == "initializer" ? declaration : assignment
          const ownerField = placement == "initializer" ? "initializer" : "expression"
          const line = placement == "initializer" ? 3 : 5
          const call = {
            arguments: [{kind: "IdentifierExpression", name: "flag"}, {kind: "IdentifierExpression", name: "fallback"}],
            callee: "select",
            kind: "CallExpression"
          }

          corruptField(call, field, malformed)
          Reflect.set(owner, ownerField, call)

          assert.throws(
            () => generate({language: "ruby", module}),
            (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
              error.language == "ruby" && error.location?.filename == "locals.ts" && error.location.start.line == line,
            `${placement} ${field} ${malformed}`
          )
        }
      }
    }
  })

  it("rejects malformed and recursively malformed call argument members at the nearest owner", async () => {
    for (const placement of ["initializer", "assignment"]) {
      for (const malformed of [...malformedStructures, "object", "nested call"]) {
        const module = await validLocalModule()
        const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[1])
        const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
        const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent.statements[0])
        const owner = placement == "initializer" ? declaration : assignment
        const ownerField = placement == "initializer" ? "initializer" : "expression"
        const line = placement == "initializer" ? 3 : 5
        const call = {
          arguments: [{kind: "IdentifierExpression", name: "flag"}, {kind: "IdentifierExpression", name: "fallback"}],
          callee: "select",
          kind: "CallExpression"
        }

        if (malformed == "nested call") {
          call.arguments[0] = /** @type {never} */ ({callee: "select", kind: "CallExpression"})
        } else {
          corruptField(call.arguments, "0", malformed)
        }
        Reflect.set(owner, ownerField, call)

        assert.throws(
          () => generate({language: "ruby", module}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
            error.language == "ruby" && error.location?.filename == "locals.ts" && error.location.start.line == line,
          `${placement} argument ${malformed}`
        )
      }
    }
  })

  it("rejects missing conditional, return, and print expressions at their owning statement locations", async () => {
    for (const malformed of ["condition", "return", "print"]) {
      const module = await validLocalModule()
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
      const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (branch.consequent.statements.at(-1))
      const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements.at(-1))
      const lines = {condition: 4, print: 14, return: 6}

      if (malformed == "condition") Reflect.deleteProperty(branch, "condition")
      else if (malformed == "return") Reflect.deleteProperty(returned, "expression")
      else Reflect.deleteProperty(print, "expression")

      assert.throws(
        () => generate({language: "php", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "php" && error.location?.filename == "locals.ts" &&
          error.location.start.line == Reflect.get(lines, malformed) && error.message.includes("invalid expression"),
        malformed
      )
    }
  })
})
