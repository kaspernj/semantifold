// @ts-check

import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const source = readFileSync(new URL("fixtures/ordered-map-iteration/program.ts", import.meta.url), "utf8")

function moduleWithMapLoop() {
  return parse({filename: "program.ts", language: "typescript", source})
}

function backendRejects(module, fragment) {
  assert.throws(
    () => generate({language: "typescript", module}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
      (!fragment || error.detail.includes(fragment))
  )
}

describe("ordered map iteration semantic validation", () => {
  it("keeps ordered maps distinct and validates both immutable exact pair bindings", () => {
    const module = moduleWithMapLoop()
    const declaration = module.entryPoint.body.statements[0]
    const loop = module.entryPoint.body.statements[3]

    expect(declaration.type.kind).toEqual("OrderedMapType")
    expect(loop.kind).toEqual("ForEachMapStatement")

    loop.keyBinding.type = {kind: "TypeReference", name: "integer"}
    backendRejects(module, "Map iteration key binding type integer; expected string")

    const wrongValue = moduleWithMapLoop()
    wrongValue.entryPoint.body.statements[3].valueBinding.type = {kind: "TypeReference", name: "string"}
    backendRejects(wrongValue, "Map iteration value binding type string; expected integer")

    for (const bindingName of ["keyBinding", "valueBinding"]) {
      const mutable = moduleWithMapLoop()
      mutable.entryPoint.body.statements[3][bindingName].mutable = true
      backendRejects(mutable, "Map iteration bindings must be immutable")
    }
  })

  it("rejects ordinary maps, malformed order, duplicate entries, shadowing, and escaped bindings", () => {
    const ordinary = moduleWithMapLoop()
    ordinary.entryPoint.body.statements[0].type.kind = "MapType"
    delete ordinary.entryPoint.body.statements[0].type.order
    ordinary.entryPoint.body.statements[0].initializer.kind = "MapLiteral"
    backendRejects(ordinary, "expected ordered map")

    const order = moduleWithMapLoop()
    order.entryPoint.body.statements[0].type.order = "sorted"
    backendRejects(order, "insertion order")

    const duplicate = moduleWithMapLoop()
    duplicate.entryPoint.body.statements[0].initializer.entries[1].key.value = "b"
    backendRejects(duplicate, "Duplicate ordered-map key")

    assert.throws(
      () => parse({filename: "shadow.ts", language: "typescript", source: `function identity(value: number): number { return value }
const key: string = "outer"
const values: ReadonlyMap<string, number> = new Map([["a", 1]])
for (const [key, value] of values) {}
`}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_BINDING"
    )
    assert.throws(
      () => parse({filename: "escape.ts", language: "typescript", source: `function identity(value: number): number { return value }
const values: ReadonlyMap<string, number> = new Map([["a", 1]])
for (const [key, value] of values) {}
console.log(key)
`}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNRESOLVED_BINDING"
    )
  })

  it("rejects ordered-map aliases and mutable literal declarations through every generation API", () => {
    const mutations = [
      {
        apply(module) {
          const declaration = module.entryPoint.body.statements[0]
          const alias = structuredClone(declaration)

          alias.initializer = {kind: "IdentifierExpression", location: declaration.initializer.location, name: declaration.name}
          alias.name = "aliasValues"
          module.entryPoint.body.statements.splice(1, 0, alias)
        },
        detail: "ordered-map local requires a direct literal initializer"
      },
      {
        apply(module) {
          module.entryPoint.body.statements[0].mutable = true
        },
        detail: "ordered-map local must be immutable"
      }
    ]

    for (const {apply, detail} of mutations) {
      for (const language of ["ruby", "javascript", "typescript", "php", "java"]) {
        for (const api of [generate, generateArtifact, generateArtifactSet]) {
          const module = moduleWithMapLoop()

          apply(module)
          assert.throws(
            () => api({language, module}),
            (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
              error.language == language && error.detail.includes(detail)
          )
        }
      }
    }
  })
})
