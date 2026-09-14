// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {preflightIosApplication} from "../src/backends/ios.js"

const rubySources = () => [
  {
    filename: "main.rb",
    id: "main",
    language: /** @type {const} */ ("ruby"),
    source: `require_relative "math_tools"

module Main
  puts MathTools.sum(4, 9)
end
`
  },
  {
    filename: "math_tools.rb",
    id: "math_tools",
    language: /** @type {const} */ ("ruby"),
    source: `module MathTools
  module_function

  # @param left [Integer]
  # @param right [Integer]
  # @return [Integer]
  def sum(left, right)
    return left + right
  end
end
`
  }
]

const swiftSource = `func sum(_ left: Int64, _ right: Int64) -> Int64 {
  return left + right
}
print(sum(4, 9))
`

describe("iOS application project validation", () => {
  it("preflights complete Ruby projects and normalizes one Swift module without mutation", () => {
    const rubyProgram = parseProgram({entryModule: "main", sources: rubySources()})
    const swiftModule = parse({filename: "program.swift", language: "swift", source: swiftSource})
    const before = structuredClone(swiftModule)
    const ruby = preflightIosApplication({program: rubyProgram})
    const swift = preflightIosApplication({module: swiftModule})

    expect(ruby.program.modules.map(({id}) => id)).toEqual(["math_tools", "main"])
    expect(ruby.modules.map(module => Reflect.get(module, "id"))).toEqual(["math_tools", "main"])
    expect(ruby.sources.map(({filename, language}) => ({filename, language}))).toEqual([
      {filename: "main.rb", language: "ruby"},
      {filename: "math_tools.rb", language: "ruby"}
    ])
    expect(swift.program.entryModule).toEqual("main")
    expect(swift.program.modules.map(({id, sourceFilename}) => ({id, sourceFilename})))
      .toEqual([{id: "main", sourceFilename: "program.swift"}])
    expect(swift.program.modules[0].functions[0].id).toEqual("main#function:0")
    expect(swiftModule).toEqual(before)
  })

  it("rejects unsupported semantics across the whole graph as located iOS capabilities", () => {
    const collectionSource = `# @param left [Array[Integer]]
# @param right [Array[Integer]]
# @return [Array[Integer]]
def choose(left, right)
  return left
end

# @type [Array[Integer]]
# @semantifold-immutable
values = [1, 2]
puts values[0]
`
    const collectionModule = parse({filename: "unsupported.rb", language: "ruby", source: collectionSource})
    const malformedProgram = parseProgram({entryModule: "main", sources: rubySources()})

    malformedProgram.modules[0].functions[0].parameters = []
    for (const generate of [
      () => preflightIosApplication({module: collectionModule}),
      () => preflightIosApplication({program: malformedProgram}),
      () => generateArtifactSet({language: "ios", module: collectionModule, role: "application"})
    ]) {
      assert.throws(generate, error => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == "ios" &&
        error.location?.filename != undefined)
    }
  })
})
