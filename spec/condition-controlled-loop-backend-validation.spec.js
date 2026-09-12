// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const source = `function first(flag: boolean): number {
  let value: number = 0
  while (flag) {
    while (flag) { continue }
    break
  }
  return value
}
function second(flag: boolean): number {
  while (flag) { break }
  return 0
}
console.log(first(false))
`

function moduleWithLoops() {
  return parse({filename: "program.ts", language: "typescript", source})
}

function loops(module) {
  const outer = /** @type {import("../src/semantic/types.js").WhileStatement} */ (module.functions[0].body.statements[1])
  const inner = /** @type {import("../src/semantic/types.js").WhileStatement} */ (outer.body.statements[0])
  const second = /** @type {import("../src/semantic/types.js").WhileStatement} */ (module.functions[1].body.statements[0])

  return {
    inner,
    innerContinue: /** @type {import("../src/semantic/types.js").ContinueStatement} */ (inner.body.statements[0]),
    outer,
    outerBreak: /** @type {import("../src/semantic/types.js").BreakStatement} */ (outer.body.statements[1]),
    second
  }
}

function backendFailure(error) {
  return error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
    error.language == "typescript" && error.location?.filename == "program.ts"
}

describe("condition-controlled loop backend validation", () => {
  it("rejects malformed loop, condition, body, identity, target, and cyclic caller IR through every generation API", () => {
    const mutations = [
      (module) => { Reflect.deleteProperty(loops(module).outer, "condition") },
      (module) => { loops(module).outer.condition = null },
      (module) => { Reflect.deleteProperty(loops(module).outer, "body") },
      (module) => { loops(module).outer.body.kind = "NotABlock" },
      (module) => { Reflect.deleteProperty(loops(module).outer, "id") },
      (module) => { loops(module).inner.id = loops(module).outer.id },
      (module) => { Reflect.deleteProperty(loops(module).innerContinue, "targetLoopId") },
      (module) => { loops(module).innerContinue.targetLoopId = loops(module).outer.id },
      (module) => { loops(module).outerBreak.targetLoopId = loops(module).second.id },
      (module) => { loops(module).outer.unexpected = true },
      (module) => { loops(module).outer.body.statements = [loops(module).outer] }
    ]

    for (const mutate of mutations) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = moduleWithLoops()

        mutate(module)
        assert.throws(() => api({language: "typescript", module}), backendFailure)
      }
    }
  })

  it("rejects cross-function and non-nearest targets before emission", () => {
    for (const [mutate, detail] of [
      [(module) => { loops(module).innerContinue.targetLoopId = loops(module).outer.id }, "nearest"],
      [(module) => { loops(module).outerBreak.targetLoopId = loops(module).second.id }, "function"]
    ]) {
      const module = moduleWithLoops()

      mutate(module)
      assert.throws(
        () => generate({language: "typescript", module}),
        (error) => backendFailure(error) && error.detail.toLowerCase().includes(detail)
      )
    }
  })

  it("rejects non-Boolean conditions and treats a loop as potentially zero-iteration caller IR", () => {
    const wrongCondition = moduleWithLoops()

    loops(wrongCondition).outer.condition = {kind: "IntegerLiteral", location: loops(wrongCondition).outer.condition.location, value: 1}
    assert.throws(
      () => generate({language: "typescript", module: wrongCondition}),
      (error) => backendFailure(error) && error.detail.includes("expected boolean")
    )

    const incomplete = moduleWithLoops()

    incomplete.functions[0].body.statements = [loops(incomplete).outer]
    assert.throws(
      () => generate({language: "typescript", module: incomplete}),
      (error) => backendFailure(error) && error.detail.includes("does not return on every reachable path")
    )
    expect(generate({language: "typescript", module: moduleWithLoops()})).toContain("while")
  })
})
