// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {
  generate,
  generateArtifact,
  generateArtifactSet,
  languageCapabilities,
  parse,
  SemantifoldDiagnostic
} from "../index.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

async function moduleFromFixture() {
  const source = await readFile(new URL("fixtures/functions/program.ts", import.meta.url), "utf8")

  return parse({filename: "program.ts", language: "typescript", source})
}

function backendFailure(language) {
  return (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
    error.language == language && error.location?.filename == "program.ts"
}

describe("general function backend validation", () => {
  it("emits arbitrary signatures, void returns, and direct calls that reparse in the required cohort", async () => {
    const module = await moduleFromFixture()

    for (const language of cohort) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : `program.${language}`
      const reparsed = parse({filename, language, source: generated})

      expect(reparsed.functions.map(({parameters, returnType}) => [parameters.length, returnType.name])).toEqual([
        [0, "integer"], [1, "string"], [3, "integer"], [1, "integer"], [1, "void"], [0, "void"], [3, "integer"]
      ])
      expect(reparsed.entryPoint.body.statements.map(({kind}) => kind)).toEqual([
        "ExpressionStatement", "ExpressionStatement", "PrintStatement"
      ])
    }
  })

  it("rejects malformed caller IR and stale declaration/signature bindings through every generation API", async () => {
    const mutations = [
      (module) => Reflect.deleteProperty(/** @type {import("../src/semantic/types.js").ExpressionStatement} */ (
        module.entryPoint.body.statements[0]
      ).expression, "resolution"),
      (module) => {
        /** @type {import("../src/semantic/types.js").ExpressionStatement} */ (
          module.entryPoint.body.statements[0]
        ).expression.resolution.declarationId = "function:99"
      },
      (module) => {
        /** @type {import("../src/semantic/types.js").ExpressionStatement} */ (
          module.entryPoint.body.statements[0]
        ).expression.resolution.parameterTypes = []
      },
      (module) => {
        /** @type {import("../src/semantic/types.js").ExpressionStatement} */ (
          module.entryPoint.body.statements[0]
        ).expression.resolution.returnType = "integer"
      },
      (module) => {
        module.functions[1].id = module.functions[0].id
      },
      (module) => {
        module.functions[1].parameters[0].type.name = "void"
      },
      (module) => {
        const functionDeclaration = module.functions[1]

        functionDeclaration.body.statements.unshift(/** @type {any} */ ({
          kind: "LocalDeclaration",
          name: "invalidVoidLocal",
          type: {kind: "TypeReference", name: "void"},
          mutable: false,
          initializer: {kind: "IntegerLiteral", value: 1, location: functionDeclaration.location},
          location: functionDeclaration.location
        }))
      },
      (module) => {
        module.functions[1].parameters[0].type.name = /** @type {any} */ ("integer|void")
      },
      (module) => {
        Reflect.deleteProperty(module.functions[0].body.statements[0], "expression")
      },
      (module) => {
        /** @type {import("../src/semantic/types.js").ReturnStatement} */ (module.functions[5].body.statements[0]).expression = {
          kind: "IntegerLiteral", location: module.functions[5].body.statements[0].location, value: 1
        }
      },
      (module) => {
        /** @type {import("../src/semantic/types.js").ExpressionStatement} */ (
          module.entryPoint.body.statements[0]
        ).expression = /** @type {import("../src/semantic/types.js").PrintStatement} */ (
          module.entryPoint.body.statements[2]
        ).expression
      }
    ]

    for (const mutate of mutations) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = await moduleFromFixture()

        mutate(module)
        assert.throws(() => api({language: "typescript", module}), backendFailure("typescript"))
      }
    }
  })

  it("advertises and enforces the bounded Task 005 target cohort before producing artifacts", async () => {
    const module = await moduleFromFixture()

    expect(languageCapabilities.filter(({features}) => features.generalFunctionsAndCalls).map(({id}) => id)).toEqual(cohort)
    for (const language of deferred) {
      const generateDeferred = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language, module})

      assert.throws(generateDeferred, backendFailure(language), language)
    }
  })

  it("rejects target-only function conflicts without renaming or overload emission", async () => {
    const php = await moduleFromFixture()
    const caseCollision = structuredClone(php.functions[0])

    caseCollision.id = "function:7"
    caseCollision.name = "Zero"
    php.functions.push(caseCollision)
    assert.throws(() => generate({language: "php", module: php}), backendFailure("php"))

    const java = await moduleFromFixture()

    java.functions[0].name = "main"
    assert.throws(() => generate({language: "java", module: java}), backendFailure("java"))
  })
})
