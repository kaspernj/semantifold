// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  discoverCanonicalToolchain,
  generateArtifactSet,
  generateProgramArtifactSet,
  parse,
  parseProgram,
  runAcceptanceStages,
  SemantifoldDiagnostic
} from "../index.js"
import {allocateXcodeObjectIds, preflightIosApplication} from "../src/backends/ios.js"
import {executeSwiftArtifacts} from "./support/swift-toolchain.js"

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

    expect(ruby.artifacts.filter(({path}) => path.startsWith("Sources/Generated/"))
      .map(({path, role}) => ({path, role}))).toEqual([
      {path: "Sources/Generated/SemantifoldRuntime.swift", role: "support"},
      {path: "Sources/Generated/MathTools.swift", role: "source"},
      {path: "Sources/Generated/Main.swift", role: "source"}
    ])
    expect(swift.artifacts.filter(({path}) => path.startsWith("Sources/Generated/")).map(({path}) => path)).toEqual([
      "Sources/Generated/SemantifoldRuntime.swift",
      "Sources/Generated/Main.swift"
    ])
    const runtime = String(ruby.artifacts.find(({path}) => path.endsWith("SemantifoldRuntime.swift"))?.content)
    const libraryArtifact = ruby.artifacts.find(({path}) => path.endsWith("MathTools.swift"))
    const library = String(libraryArtifact?.content)
    const entry = String(ruby.artifacts.find(({path}) => path.endsWith("Generated/Main.swift"))?.content)

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
    assert.ok(libraryArtifact)
    expect(libraryArtifact.provenance.kind).toEqual("text")
    if (libraryArtifact.provenance.kind == "text") {
      expect(libraryArtifact.provenance.mapping.sources.map(({filename}) => filename)).toContain("math_tools.rb")
      expect(libraryArtifact.provenance.mapping.spans.some(({mappingKind}) => mappingKind == "exact")).toBeTrue()
    }
    expect(ruby.artifacts.find(({path}) => path.endsWith("SemantifoldRuntime.swift"))?.provenance.kind).toEqual("synthetic")
  })

  it("matches real Ruby behavior in generated semantic Swift debug and optimized execution", async () => {
    const sources = rubySources()
    const program = parseProgram({entryModule: "main", sources})
    const rubyTool = await discoverCanonicalToolchain("ruby")
    const rubyArtifacts = createGeneratedArtifactSet({
      artifacts: sources.map((source, index) => ({
        content: source.source,
        contentKind: "text",
        mediaType: "text/x-ruby",
        ownership: "generated",
        path: source.filename,
        provenance: {kind: "synthetic", reason: "Exact iOS acceptance source fixture.", relatedOrigins: []},
        role: index == 0 ? "entry" : "source"
      })),
      target: "ruby"
    })
    const ruby = await runAcceptanceStages({
      artifacts: rubyArtifacts,
      environment: {LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: process.env.PATH},
      stages: [{arguments: ["main.rb"], stage: "execute", tool: rubyTool}],
      target: "ruby"
    })
    const generated = generateProgramArtifactSet({
      configuration: configuration(),
      language: "ios",
      program,
      role: "application"
    })
    const semanticSwift = generated.artifacts.filter(({path: artifactPath}) => artifactPath.startsWith("Sources/Generated/"))
      .map(({content}) => content).join("\n") + `
for line in SemantifoldModuleMain.semantifoldEntry() {
  print(line)
}
`
    const swift = await executeSwiftArtifacts({artifacts: [{content: semanticSwift, path: "program.swift"}]}, {label: "ios-semantic"})
    const expected = "hé😀\nhé😀!\nhé😀!?\n"

    expect(ruby.stages[0].stdout).toEqual(expected)
    expect(ruby.stages[0].stderr).toEqual("")
    expect(swift.modes.map(({mode, stdout, stderr}) => ({mode, stdout, stderr}))).toEqual([
      {mode: "debug", stderr: "", stdout: expected},
      {mode: "optimized", stderr: "", stdout: expected}
    ])
  })

  it("fails acceptance when the required Ruby or Swift command is unavailable", async () => {
    for (const tool of ["ruby", "swiftc"]) {
      await assert.rejects(
        discoverCanonicalToolchain(/** @type {"ruby" | "swiftc"} */ (tool), {environment: {PATH: ""}}),
        error => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND"
      )
    }
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
    const generatedAssets = set.artifacts.filter(({role, path}) => role == "resource" && path != "Assets.xcassets/Contents.json")

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

  it("generates the complete canonical SwiftUI/Xcode application set byte-identically", () => {
    const program = parseProgram({entryModule: "main", sources: rubySources()})
    const input = {configuration: configuration(), language: /** @type {const} */ ("ios"), program,
      role: /** @type {const} */ ("application")}
    const first = generateProgramArtifactSet(input)
    const second = generateProgramArtifactSet(input)
    const product = configuration().productName

    expect(first).toEqual(second)
    expect(first.entry).toEqual("Sources/Application/App.swift")
    expect(first.artifacts.map(({path, role}) => ({path, role}))).toEqual([
      {path: `${product}.xcodeproj/project.pbxproj`, role: "manifest"},
      {path: `${product}.xcodeproj/xcshareddata/xcschemes/${product}.xcscheme`, role: "support"},
      {path: "Configuration/Base.xcconfig", role: "support"},
      {path: "Configuration/Info.plist", role: "support"},
      {path: "Sources/Generated/SemantifoldRuntime.swift", role: "support"},
      {path: "Sources/Generated/MathTools.swift", role: "source"},
      {path: "Sources/Generated/Main.swift", role: "source"},
      {path: "Sources/Application/App.swift", role: "entry"},
      {path: "Sources/Application/SemantifoldBridge.swift", role: "support"},
      {path: "Sources/Application/SemantifoldOutputView.swift", role: "support"},
      {path: "Assets.xcassets/Contents.json", role: "resource"},
      {path: `Tests/${product}Tests.swift`, role: "support"},
      {path: `UITests/${product}UITests.swift`, role: "support"},
      {path: "semantifold-project.json", role: "manifest"}
    ])
    expect(first.artifacts.filter(({role}) => role == "entry").map(({path}) => path))
      .toEqual(["Sources/Application/App.swift"])
    const content = Object.fromEntries(first.artifacts.map(artifact => [artifact.path, String(artifact.content)]))

    expect(content["Sources/Application/App.swift"]).toContain("@main")
    expect(content["Sources/Application/App.swift"]).toContain("SemantifoldOutputView(lines: SemantifoldBridge.run())")
    expect(content["Sources/Application/SemantifoldBridge.swift"]).toContain("SemantifoldModuleMain.semantifoldEntry()")
    expect(content["Sources/Application/SemantifoldOutputView.swift"]).toContain("lines.joined(separator: \"\\n\")")
    expect(content["Sources/Application/SemantifoldOutputView.swift"]).toContain(".accessibilityIdentifier(\"semantifold-output\")")
    expect(content[`Tests/${product}Tests.swift`]).toContain("XCTAssertEqual(SemantifoldBridge.run(), SemantifoldBridge.run())")
    expect(content[`UITests/${product}UITests.swift`]).toContain("staticTexts[\"semantifold-output\"]")
    expect(content["Assets.xcassets/Contents.json"]).toEqual("{\n  \"info\": {\n    \"author\": \"semantifold\",\n    \"version\": 1\n  }\n}\n")
    expect(first.artifacts.some(({path}) => /entitlements/iu.test(path))).toBeFalse()
    for (const artifact of first.artifacts) {
      if (artifact.contentKind == "text") {
        expect(artifact.content).not.toContain("\r")
        expect(artifact.content).not.toContain("/home/")
      }
    }
    const project = content[`${product}.xcodeproj/project.pbxproj`]
    const objectDefinitions = [...project.matchAll(/^\s*([0-9A-F]{24}) = \{/gmu)].map(match => match[1])

    expect(objectDefinitions.length).toBeGreaterThan(20)
    expect(new Set(objectDefinitions).size).toEqual(objectDefinitions.length)
  })

  it("records exact ownership and caller provenance in the versioned project manifest", () => {
    const sources = rubySources()
    const program = parseProgram({entryModule: "main", sources})
    const assetContent = new Uint8Array([0, 1, 2, 255])
    const asset = {
      content: assetContent,
      mediaType: "application/octet-stream",
      path: "Assets.xcassets/Data.dataset/payload.bin",
      sha256: sha256(assetContent)
    }
    const set = generateProgramArtifactSet({
      assets: [asset],
      configuration: configuration(),
      language: "ios",
      program,
      role: "application"
    })
    const artifactByPath = new Map(set.artifacts.map(artifact => [artifact.path, artifact]))
    const manifestArtifact = artifactByPath.get("semantifold-project.json")

    assert.ok(manifestArtifact)
    assert.equal(typeof manifestArtifact.content, "string")
    const manifest = JSON.parse(manifestArtifact.content)

    expect(manifest.schema).toEqual("SemantifoldIosProject")
    expect(manifest.version).toEqual(1)
    expect(manifest.target).toEqual("ios")
    expect(manifest.generator).toEqual({name: "semantifold", version: "0.3.0"})
    expect(manifest.configuration).toEqual({
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
    expect(manifest.ownership.ownedPaths).toEqual(set.artifacts.map(({path}) => path))
    expect(manifest.ownership.excludedPathPatterns).toEqual([
      "**/*.xcuserstate",
      "**/xcuserdata/**",
      ".swiftpm/**",
      "DerivedData/**",
      "build/**"
    ])
    expect(manifest.platformRequirements).toEqual({
      appleSdk: {status: "deferred"},
      iosSimulator: {status: "deferred"},
      macosHost: {status: "deferred"},
      swiftc: {status: "deferred"},
      xcode: {status: "deferred"},
      xctest: {status: "deferred"},
      xcuiautomation: {status: "deferred"}
    })
    expect(manifest.provenance.assets).toEqual([{
      contentKind: "binary",
      mediaType: asset.mediaType,
      path: asset.path,
      sha256: asset.sha256
    }])
    expect(manifest.provenance.semanticSources).toEqual(sources.map(source => ({
      artifacts: [`Sources/Generated/${source.id == "main" ? "Main" : "MathTools"}.swift`],
      filename: source.filename,
      language: source.language,
      sha256: sha256(source.source)
    })))
    expect(manifest.provenance.syntheticScaffolding).toContain("Sources/Application/App.swift")
    expect(manifest.provenance.syntheticScaffolding).toContain("semantifold-project.json")
    expect(manifest.provenance.syntheticScaffolding).not.toContain(asset.path)
    expect(manifest.provenance.configuration.map(({field}) => field)).toEqual([
      "bundleIdentifier", "capabilities", "deploymentTarget", "displayName", "entitlements", "infoPlist", "lifecycle",
      "moduleName", "organizationPrefix", "permissions", "privacyDeclarations", "productName", "resourceRoot", "sourceRoot"
    ])
    const bundleCitation = manifest.provenance.configuration.find(({field}) => field == "bundleIdentifier")

    expect(bundleCitation.manifestPointer).toEqual("/configuration/bundleIdentifier")
    expect(bundleCitation.outputs.map(({path}) => path)).toContain("Configuration/Base.xcconfig")
    for (const output of bundleCitation.outputs) {
      const artifact = artifactByPath.get(output.path)

      assert.ok(artifact)
      assert.equal(typeof artifact.content, "string")
      for (const range of output.ranges) {
        expect(artifact.content.slice(range.start, range.end)).toEqual(configuration().bundleIdentifier)
      }
    }
    expect(set.metadata).toEqual({
      applicationManifest: "semantifold-project.json",
      platformQualification: "deferred"
    })
  })

  it("derives Xcode IDs from SHA-256 identities and rejects shortened collisions", () => {
    const ids = allocateXcodeObjectIds(["target:app", "target:tests"])

    expect([...ids.values()].every(id => /^[0-9A-F]{24}$/u.test(id))).toBeTrue()
    expect([...ids]).toEqual([...allocateXcodeObjectIds(["target:app", "target:tests"])])
    assert.throws(
      () => allocateXcodeObjectIds(["first", "second"], () => "0".repeat(64)),
      error => error instanceof SemantifoldDiagnostic && error.code == "XCODE_ID_COLLISION" && error.language == "ios"
    )
  })
})
