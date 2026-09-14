// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, generateProgramArtifactSet, parse, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {preflightIosApplication} from "../src/backends/ios.js"

const rubySources = () => [
  {
    filename: "main.rb",
    id: "main",
    language: /** @type {const} */ ("ruby"),
    source: `require_relative "math_tools"

module Main
  puts MathTools.decorate(MathTools.decorate("hé😀", "!"), "?")
end
`
  },
  {
    filename: "math_tools.rb",
    id: "math_tools",
    language: /** @type {const} */ ("ruby"),
    source: `module MathTools
  module_function

  # @param value [String]
  # @param suffix [String]
  # @return [String]
  def decorate(value, suffix)
    puts value
    return value + suffix
  end
end
`
  }
]

const swiftSource = `func decorate(_ value: String, _ suffix: String) -> String {
  print(value)
  return value + suffix
}
print(decorate(decorate("hé😀", "!"), "?"))
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

  it("lowers namespaced semantic Swift through one shared ordered output sink", () => {
    const rubyProgram = parseProgram({entryModule: "main", sources: rubySources()})
    const swiftModule = parse({filename: "program.swift", language: "swift", source: swiftSource})
    const ruby = generateProgramArtifactSet({language: "ios", program: rubyProgram, role: "application"})
    const swift = generateArtifactSet({language: "ios", module: swiftModule, role: "application"})

    expect(ruby.artifacts.map(({path, role}) => ({path, role}))).toEqual([
      {path: "Sources/Generated/SemantifoldRuntime.swift", role: "support"},
      {path: "Sources/Generated/MathTools.swift", role: "source"},
      {path: "Sources/Generated/Main.swift", role: "entry"}
    ])
    expect(swift.artifacts.map(({path}) => path)).toEqual([
      "Sources/Generated/SemantifoldRuntime.swift",
      "Sources/Generated/Main.swift"
    ])
    const runtime = String(ruby.artifacts[0].content)
    const library = String(ruby.artifacts[1].content)
    const entry = String(ruby.artifacts[2].content)

    expect(runtime).toContain("final class SemantifoldOutputSink")
    expect(runtime).toContain("private(set) var lines: [String] = []")
    expect(library).toContain("enum SemantifoldModuleMathTools")
    expect(library).toContain("_ semantifold_output: SemantifoldOutputSink")
    expect(library).toContain("semantifold_output.write(value)")
    expect(entry).toContain("static func semantifoldEntry() -> [String]")
    expect(entry).toContain("SemantifoldModuleMathTools.decorate(SemantifoldModuleMathTools.decorate(\"hé😀\", \"!\",")
    expect(entry).toContain("return semantifold_output.lines")
    expect(entry).not.toContain("print(")
    expect(swift.artifacts.map(({content}) => String(content)).join("\n")).toContain("\"hé😀\"")
    expect(ruby.artifacts[1].provenance.kind).toEqual("text")
    if (ruby.artifacts[1].provenance.kind == "text") {
      expect(ruby.artifacts[1].provenance.mapping.sources.map(({filename}) => filename)).toContain("math_tools.rb")
      expect(ruby.artifacts[1].provenance.mapping.spans.some(({mappingKind}) => mappingKind == "exact")).toBeTrue()
    }
    expect(ruby.artifacts[0].provenance.kind).toEqual("synthetic")
  })
})
