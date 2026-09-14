// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
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

const configuration = () => ({
  bundleIdentifier: "com.example.semantifold",
  deploymentTarget: "18.0",
  displayName: "Semantifold",
  moduleName: "SemantifoldApp",
  organizationPrefix: "com.example",
  productName: "SemantifoldApp"
})

const sha256 = content => createHash("sha256").update(content).digest("hex")

describe("iOS application project validation", () => {
  it("preflights complete Ruby projects and normalizes one Swift module without mutation", () => {
    const rubyProgram = parseProgram({entryModule: "main", sources: rubySources()})
    const swiftModule = parse({filename: "program.swift", language: "swift", source: swiftSource})
    const before = structuredClone(swiftModule)
    const ruby = preflightIosApplication({configuration: configuration(), program: rubyProgram})
    const swift = preflightIosApplication({configuration: configuration(), module: swiftModule})

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
    expect(swift.configuration).toEqual({
      ...configuration(),
      capabilities: [],
      entitlements: [],
      infoPlist: {},
      lifecycle: "swiftui",
      permissions: [],
      privacyDeclarations: [],
      resourceRoot: "Assets.xcassets",
      sourceRoot: "Sources"
    })
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
      () => preflightIosApplication({configuration: configuration(), module: collectionModule}),
      () => preflightIosApplication({configuration: configuration(), program: malformedProgram}),
      () => generateArtifactSet({configuration: configuration(), language: "ios", module: collectionModule, role: "application"})
    ]) {
      assert.throws(generate, error => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == "ios" &&
        error.location?.filename != undefined)
    }
  })

  it("lowers namespaced semantic Swift through one shared ordered output sink", () => {
    const rubyProgram = parseProgram({entryModule: "main", sources: rubySources()})
    const swiftModule = parse({filename: "program.swift", language: "swift", source: swiftSource})
    const ruby = generateProgramArtifactSet({configuration: configuration(), language: "ios", program: rubyProgram, role: "application"})
    const swift = generateArtifactSet({configuration: configuration(), language: "ios", module: swiftModule, role: "application"})

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

  it("preserves exact caller assets with validated paths and SHA-256", () => {
    const module = parse({filename: "program.swift", language: "swift", source: swiftSource})
    const text = "{\n  \"info\": \"exact\"\n}\n"
    const bytes = new Uint8Array([0, 1, 2, 255])
    const assets = [
      {content: bytes, mediaType: "application/octet-stream", path: "Assets.xcassets/Data.dataset/payload.bin", sha256: sha256(bytes)},
      {content: text, mediaType: "application/json", path: "Assets.xcassets/Data.dataset/Contents.json", sha256: sha256(text)}
    ]
    const set = generateArtifactSet({assets, configuration: configuration(), language: "ios", module, role: "application"})
    const generatedAssets = set.artifacts.filter(({role}) => role == "resource")

    expect(generatedAssets.map(({path}) => path)).toEqual([
      "Assets.xcassets/Data.dataset/Contents.json",
      "Assets.xcassets/Data.dataset/payload.bin"
    ])
    expect(generatedAssets[0].content).toEqual(text)
    assert.deepEqual(generatedAssets[1].content, bytes)
    bytes[0] = 99
    assert.deepEqual(generatedAssets[1].content, new Uint8Array([0, 1, 2, 255]))
  })

  it("rejects unknown configuration, identity, lifecycle, capability, asset, and portable-path values", () => {
    const module = parse({filename: "program.swift", language: "swift", source: swiftSource})
    const validAsset = {content: "asset\n", mediaType: "text/plain", path: "Assets.xcassets/Data.dataset/value.txt",
      sha256: sha256("asset\n")}
    const invalid = [
      {configuration: {...configuration(), platform: "macos"}},
      {configuration: {...configuration(), productName: "Bad Name"}},
      {configuration: {...configuration(), moduleName: "bad-name"}},
      {configuration: {...configuration(), organizationPrefix: "example"}},
      {configuration: {...configuration(), bundleIdentifier: "org.other.app"}},
      {configuration: {...configuration(), deploymentTarget: "latest"}},
      {configuration: {...configuration(), displayName: "bad\nname"}},
      {configuration: {...configuration(), lifecycle: "uikit"}},
      {configuration: {...configuration(), infoPlist: {NSCameraUsageDescription: "camera"}}},
      {configuration: {...configuration(), permissions: ["camera"]}},
      {configuration: {...configuration(), entitlements: ["network"]}},
      {configuration: {...configuration(), privacyDeclarations: ["tracking"]}},
      {configuration: {...configuration(), capabilities: ["icloud"]}},
      {configuration: {...configuration(), sourceRoot: "../Sources"}},
      {configuration: {...configuration(), resourceRoot: "Resources"}},
      {assets: [{...validAsset, surprise: true}], configuration: configuration()},
      {assets: [{...validAsset, path: "../value.txt"}], configuration: configuration()},
      {assets: [{...validAsset, path: "Resources/value.txt"}], configuration: configuration()},
      {assets: [{...validAsset, sha256: "0".repeat(64)}], configuration: configuration()},
      {assets: [validAsset, {...validAsset}], configuration: configuration()},
      {assets: [validAsset, {...validAsset, path: "Assets.xcassets/data.dataset/VALUE.TXT"}], configuration: configuration()},
      {assets: [validAsset, {...validAsset, path: "Assets.xcassets/Data.dataset/valué.txt"},
        {...validAsset, path: "Assets.xcassets/Data.dataset/valué.txt"}], configuration: configuration()},
      {assets: [validAsset, {...validAsset, path: `${validAsset.path}/nested`}], configuration: configuration()}
    ]

    for (const candidate of invalid) {
      assert.throws(
        () => generateArtifactSet({...candidate, language: "ios", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.language == "ios" &&
          ["INVALID_APPLICATION_ASSET", "INVALID_APPLICATION_CONFIGURATION", "INVALID_APPLICATION_PATH"].includes(error.code)
      )
    }
  })
})
