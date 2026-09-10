// @ts-check

import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {describe, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const source = readFileSync(new URL("fixtures/optionals/program.ts", import.meta.url), "utf8")

function optionalModule() {
  return parse({filename: "program.ts", language: "typescript", source})
}

function backendFailure(language) {
  return (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == language
}

describe("optional value backend validation", () => {
  it("rejects optional IR transactionally for every registered non-cohort target", () => {
    const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

    for (const language of deferred) {
      const module = optionalModule()
      const emit = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language, module})

      assert.throws(emit, backendFailure(language))
    }
  })

  it("rejects malformed optional type and absence shapes through every generation API", () => {
    const mutations = [
      (module) => {
        module.functions[0].returnType.unexpected = true
      },
      (module) => {
        const branch = module.functions[0].body.statements[0]

        branch.alternate.statements[0].expression.value = {
          kind: "StringLiteral",
          location: branch.location,
          value: "not absent"
        }
      },
      (module) => {
        const branch = module.functions[0].body.statements[0]

        Reflect.deleteProperty(branch.consequent.statements[0].expression, "value")
      },
      (module) => {
        const branch = module.functions[0].body.statements[0]

        branch.consequent.statements[0].expression.value = {kind: "BooleanLiteral", location: branch.location, value: true}
      },
      (module) => {
        const branch = module.functions[1].body.statements[0]

        branch.condition.operand = {kind: "StringLiteral", location: branch.location, value: "value"}
      },
      (module) => {
        const branch = module.functions[1].body.statements[0]

        branch.consequent.statements[0].expression.operand = {kind: "StringLiteral", location: branch.location, value: "value"}
      },
      (module) => {
        const optional = module.functions[0].returnType

        optional.valueType = optional
      },
      (module) => {
        const optional = module.functions[0].returnType

        optional.valueType = {kind: "OptionalType", valueType: optional.valueType}
      }
    ]

    for (const mutate of mutations) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = optionalModule()

        mutate(module)
        assert.throws(() => api({language: "typescript", module}), backendFailure("typescript"))
      }
    }
  })

  it("rejects cyclic optional expressions through every generation API without rejecting shared acyclic values", () => {
    for (const api of [generate, generateArtifact, generateArtifactSet]) {
      const cyclic = optionalModule()
      const cyclicSome = cyclic.functions[0].body.statements[0].consequent.statements[0].expression

      cyclicSome.value = cyclicSome
      assert.throws(
        () => api({language: "typescript", module: cyclic}),
        (error) => backendFailure("typescript")(error) && error.location?.filename == "program.ts" &&
          error.detail == "Backend cannot emit semantic capability 'cyclic expression'."
      )

      const shared = optionalModule()
      const sharedSome = shared.functions[0].body.statements[0].consequent.statements[0].expression
      const sharedValue = sharedSome.value

      sharedSome.value = {
        kind: "BinaryExpression",
        left: sharedValue,
        location: sharedSome.location,
        operation: "StringConcat",
        right: sharedValue,
        type: "string"
      }
      assert.doesNotThrow(() => api({language: "typescript", module: shared}))
    }
  })

  it("rejects Java package-qualifier capture before emitting Optional factories", () => {
    const module = parse({
      filename: "java-capture.ts",
      language: "typescript",
      source: `function maybe(java: string, present: boolean): string | null {
  if (present) return java
  else return null
}
function label(value: string | null): string {
  if (value !== null) return value
  else return "absent"
}
console.log(label(maybe("ready", true)))
`
    })

    assert.throws(
      () => generate({language: "java", module}),
      (error) => backendFailure("java")(error) && error.detail.includes("captures java.util factory syntax")
    )
  })
})
