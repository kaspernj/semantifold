// @ts-check

import assert from "node:assert/strict"
import {performance} from "node:perf_hooks"
import {describe, it} from "@velocious/testing"
import {generateArtifact, originalPositionFor, parse} from "../index.js"

const source = `function base(left: number, right: number): number {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(base(4, 9))
`

describe("mapping scaling", () => {
  it("keeps validation and indexed lookup bounded near linear growth", () => {
    const template = parse({filename: "scale.ts", language: "typescript", source})

    generateArtifact({language: "javascript", module: moduleWithFunctions(template, 10)})
    const small = minimumGenerationTime(template, 50)
    const large = minimumGenerationTime(template, 200)
    const artifact = generateArtifact({language: "javascript", module: moduleWithFunctions(template, 200)})
    const lookupStart = performance.now()

    originalPositionFor(artifact.mapping, {offset: Math.floor(artifact.code.length / 2)})
    const lookup = performance.now() - lookupStart

    assert.ok(large < small * 8, `Expected near-linear scaling; 50=${small.toFixed(1)}ms, 200=${large.toFixed(1)}ms`)
    assert.ok(lookup < 1000, `Expected indexed lookup below 1000ms, received ${lookup.toFixed(1)}ms`)
  })
})

/**
 * Measures the fastest of two deterministic generation runs to reduce scheduler noise.
 * @param {import("../src/semantic/types.js").SemanticModule} template - Parsed template.
 * @param {number} count - Function count.
 * @returns {number} Milliseconds.
 */
function minimumGenerationTime(template, count) {
  const measurements = []

  for (let run = 0; run < 2; run++) {
    const start = performance.now()

    generateArtifact({language: "javascript", module: moduleWithFunctions(template, count)})
    measurements.push(performance.now() - start)
  }

  return Math.min(...measurements)
}

/**
 * Builds a large valid semantic module without reparsing or source scanning.
 * @param {import("../src/semantic/types.js").SemanticModule} template - Parsed template.
 * @param {number} count - Function count.
 * @returns {import("../src/semantic/types.js").SemanticModule} Large module.
 */
function moduleWithFunctions(template, count) {
  const module = structuredClone(template)

  module.functions = []
  for (let index = 0; index < count; index++) {
    const declaration = structuredClone(template.functions[0])

    declaration.name = `function${index}`
    module.functions.push(declaration)
  }
  const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[0])
  const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)

  call.callee = "function0"

  return module
}
