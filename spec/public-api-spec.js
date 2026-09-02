// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {generate, parse, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("public API", () => {
  it("exports immutable language discovery and the parser, generator, and diagnostic API", () => {
    assert.deepEqual(supportedLanguages, ["php", "ruby", "javascript", "typescript", "java"])
    assert.ok(Object.isFrozen(supportedLanguages))
    assert.equal(typeof parse, "function")
    assert.equal(typeof generate, "function")
    assert.equal(typeof SemantifoldDiagnostic, "function")
  })
})
