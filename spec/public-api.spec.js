// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("public API", () => {
  it("exports immutable language discovery and the parser, generator, and diagnostic API", () => {
    expect(supportedLanguages).toEqual(["php", "ruby", "javascript", "typescript", "java"])
    expect(Object.isFrozen(supportedLanguages)).toBeTrue()
    expect(typeof parse).toEqual("function")
    expect(typeof generate).toEqual("function")
    expect(typeof SemantifoldDiagnostic).toEqual("function")
  })
})
