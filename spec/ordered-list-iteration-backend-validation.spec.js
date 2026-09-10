// @ts-check

import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {describe, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const source = readFileSync(new URL("fixtures/iteration/program.ts", import.meta.url), "utf8")

function moduleWithLoop() {
  return parse({filename: "program.ts", language: "typescript", source})
}

function backendFailure(error) {
  return error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "typescript"
}

function failureFor(language) {
  return (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
    error.language == language && error.location?.filename == "program.ts"
}

describe("ordered list iteration backend validation", () => {
  it("rejects malformed loop, binding, list, and control shapes through every generation API", () => {
    const mutations = [
      (loop) => { loop.valueBinding.mutable = true },
      (loop) => { loop.valueBinding.type = {kind: "TypeReference", name: "string"} },
      (loop) => { loop.valueBinding.name = "class" },
      (loop) => { loop.list = {kind: "MapLiteral", entries: [], location: loop.location} },
      (loop) => { Reflect.deleteProperty(loop, "body") },
      (loop) => { loop.body.kind = "NotABlock" },
      (loop) => { loop.unexpected = true },
      (loop) => { loop.body.statements = [loop] }
    ]

    for (const mutate of mutations) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = moduleWithLoop()
        const loop = module.functions[1].body.statements[1]

        mutate(loop)
        assert.throws(() => api({language: "typescript", module}), backendFailure)
      }
    }
  })

  it("rejects controls without an enclosing loop and preserves valid shared acyclic nodes", () => {
    for (const kind of ["BreakStatement", "ContinueStatement"]) {
      const module = moduleWithLoop()
      const loop = module.functions[1].body.statements[1]

      module.entryPoint.body.statements.push({kind, location: loop.location})
      assert.throws(() => generate({language: "typescript", module}), backendFailure)
    }

    const module = moduleWithLoop()
    const values = module.entryPoint.body.statements[0]
    const shared = values.initializer.elements[0]

    values.initializer.elements = [shared, shared]
    assert.doesNotThrow(() => generate({language: "typescript", module}))
  })

  it("diagnoses a malformed declaration before a non-cohort target examines Task 008 IR", () => {
    const module = moduleWithLoop()

    Reflect.set(module.functions, 0, null)
    assert.throws(
      () => generateArtifactSet({language: "csharp", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp"
    )
  })

  it("rejects Ruby nonlocal returns in iteration bodies through every generation API", () => {
    const module = parse({
      filename: "program.ts",
      language: "typescript",
      source: `function first(values: readonly number[]): number {
  for (const value of values) { return value }
  return 0
}
console.log(first([1]))
`
    })

    for (const api of [generate, generateArtifact, generateArtifactSet]) {
      assert.throws(() => api({language: "ruby", module}), failureFor("ruby"))
    }
  })

  it("rejects every missing or malformed loop-owned location transactionally", () => {
    const mutations = [
      (loop) => { loop.location = null },
      (loop) => { Reflect.deleteProperty(loop, "location") },
      (loop) => { loop.location.start = null },
      (loop) => { loop.valueBinding.location = null },
      (loop) => { Reflect.deleteProperty(loop.valueBinding, "location") },
      (loop) => { loop.valueBinding.location.start.offset = -1 },
      (loop) => { loop.list.location.end.line = 0 },
      (loop) => { loop.body.location = null },
      (loop) => { loop.body.location.end = undefined },
      (loop) => { loop.body.statements[0].consequent.statements[0].consequent.statements[0].location = null },
      (loop) => { Reflect.deleteProperty(loop.body.statements[0].consequent.statements[0].consequent.statements[0], "location") },
      (loop) => { loop.body.statements[0].alternate.statements[0].consequent.statements[0].location.end.column = 0 }
    ]

    for (const mutate of mutations) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = moduleWithLoop()
        const loop = module.functions[1].body.statements[1]

        mutate(loop)
        assert.throws(() => api({language: "typescript", module}), failureFor("typescript"))
      }
    }
  })
})
