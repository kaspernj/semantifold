// @ts-check

import {createHash} from "node:crypto"
import {isDenseArray} from "../array.js"
import {findPortableArtifactPathConflict, isSafeArtifactPath} from "../artifact-path.js"
import {createByteMapping} from "../binary-mapping.js"
import {SemantifoldDiagnostic, unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {preflightSemanticProgram} from "./program.js"
import {emitScalarType, emitStringLiteral} from "./scalars.js"
import {SourceWriter} from "./writer.js"

/** @type {ReadonlySet<import("../semantic/types.js").SemanticLanguage>} */
const iosSourceLanguages = new Set(["php", "ruby", "javascript", "typescript", "java", "swift"])
const configurationFields = new Set([
  "bundleIdentifier", "capabilities", "deploymentTarget", "displayName", "entitlements", "infoPlist", "lifecycle",
  "moduleName", "organizationPrefix", "permissions", "privacyDeclarations", "productName", "resourceRoot", "sourceRoot"
])
const assetFields = new Set(["content", "mediaType", "path", "sha256"])
const generatorVersion = "0.3.0"
const excludedPathPatterns = Object.freeze([
  "**/*.xcuserstate",
  "**/xcuserdata/**",
  ".swiftpm/**",
  "DerivedData/**",
  "build/**"
])
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\u0020-\u007e]+)?$/u
const binaryOperations = Object.freeze({
  BooleanAnd: "&&",
  BooleanEqual: "==",
  BooleanNotEqual: "!=",
  BooleanOr: "||",
  IntegerAdd: "+",
  IntegerEqual: "==",
  IntegerGreaterThan: ">",
  IntegerGreaterThanOrEqual: ">=",
  IntegerLessThan: "<",
  IntegerLessThanOrEqual: "<=",
  IntegerMultiply: "*",
  IntegerNotEqual: "!=",
  IntegerSubtract: "-",
  StringConcat: "+",
  StringEqual: "==",
  StringNotEqual: "!="
})
const unaryOperations = Object.freeze({BooleanNot: "!", IntegerNegate: "-"})
const iosSwiftRuntime = `final class SemantifoldOutputSink {
  private(set) var lines: [String] = []

  func write(_ value: Int64) {
    lines.append(String(value))
  }

  func write(_ value: Bool) {
    lines.append(value ? "true" : "false")
  }

  func write(_ value: String) {
    lines.append(value)
  }
}

func semantifold_string_equal(_ left: String, _ right: String) -> Bool {
  return left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_string_not_equal(_ left: String, _ right: String) -> Bool {
  return !left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_keep_mutable<T>(_ value: inout T) {
}
`

/**
 * Preflights one complete project against the delivered Swift Tasks 001-004 profile.
 * @param {object} input - iOS application generation input.
 * @param {import("../semantic/types.js").SemanticModule} [input.module] - Single module to normalize.
 * @param {import("../semantic/types.js").SemanticProgram} [input.program] - Caller-owned Task 010 project.
 * @param {import("../semantic/types.js").IosApplicationConfigurationInput} [input.configuration] - Closed application configuration.
 * @param {import("../semantic/types.js").IosApplicationAssetInput[]} [input.assets] - Exact caller-provided assets.
 * @returns {{assets: import("../semantic/types.js").IosApplicationAssetInput[], configuration: import("../semantic/types.js").IosApplicationConfiguration, modulePaths: Map<string, string>, modules: import("../semantic/types.js").SemanticModule[], program: import("../semantic/types.js").SemanticProgram, sources: {content: string, filename: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} Prepared application program.
 */
export function preflightIosApplication(input) {
  if (!isPlainObject(input) || Boolean(input.module) == Boolean(input.program)) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_APPLICATION_INPUT",
      language: "ios",
      message: "iOS application generation requires exactly one semantic module or program."
    })
  }
  const configuration = normalizeConfiguration(input.configuration)
  const program = input.program ?? normalizeSingleModule(input.module)
  const prepared = preflightSemanticProgram({
    backendLanguage: "swift",
    diagnosticLanguage: "ios",
    program,
    sourceLanguages: iosSourceLanguages
  })
  const modulePaths = new Map(prepared.modules.map(module => [
    /** @type {string} */ (Reflect.get(module, "id")),
    `${configuration.sourceRoot}/Generated/${moduleName(/** @type {string} */ (Reflect.get(module, "id")))}.swift`
  ]))
  const assets = normalizeAssets(input.assets, configuration.resourceRoot)
  const conflict = findPortableArtifactPathConflict([
    `${configuration.sourceRoot}/Generated/SemantifoldRuntime.swift`,
    ...modulePaths.values(),
    `${configuration.resourceRoot}/Contents.json`,
    ...assets.map(({path}) => path)
  ])

  if (conflict) invalidPath(`Application artifact path '${conflict.path}' has a ${conflict.kind} conflict${conflict.other ? ` with '${conflict.other}'` : ""}.`)

  return {...prepared, assets, configuration, modulePaths}
}

/**
 * Generates the deterministic semantic Swift portion of one iOS application artifact set.
 * @param {Parameters<typeof preflightIosApplication>[0]} input - iOS generation request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], metadata: {applicationManifest: string, platformQualification: string}, target: "ios"}} Candidate artifact set.
 */
export function generateIosApplication(input) {
  const prepared = preflightIosApplication(input)
  const semanticArtifacts = renderSemanticArtifacts(prepared)
  const applicationPaths = applicationArtifactPaths(prepared)
  const project = renderPbxProject(prepared, applicationPaths)
  const configuration = prepared.configuration
  const entryNamespace = `SemantifoldModule${moduleName(prepared.program.entryModule)}`
  const app = `import SwiftUI

@main
struct SemantifoldApplication: App {
  var body: some Scene {
    WindowGroup {
      SemantifoldOutputView(lines: SemantifoldBridge.run())
    }
  }
}
`
  const bridge = `enum SemantifoldBridge {
  static func run() -> [String] {
    return ${entryNamespace}.semantifoldEntry()
  }
}
`
  const view = `import SwiftUI

struct SemantifoldOutputView: View {
  let lines: [String]

  var body: some View {
    Text(lines.joined(separator: "\\n"))
      .accessibilityIdentifier("semantifold-output")
  }
}
`
  const product = configuration.productName
  const artifacts = [
    syntheticText(`${product}.xcodeproj/project.pbxproj`, "manifest", project,
      "Canonical deterministic Xcode project structure."),
    syntheticText(`${product}.xcodeproj/xcshareddata/xcschemes/${product}.xcscheme`, "support",
      renderSharedScheme(prepared), "Canonical shared Xcode application/test scheme."),
    syntheticText("Configuration/Base.xcconfig", "support", renderBaseConfiguration(configuration),
      "Closed unsigned iOS build configuration."),
    syntheticText("Configuration/Info.plist", "support", renderInfoPlist(configuration),
      "Allowlisted iOS application property list."),
    ...semanticArtifacts,
    syntheticText("Sources/Application/App.swift", "entry", app, "Synthetic SwiftUI application lifecycle."),
    syntheticText("Sources/Application/SemantifoldBridge.swift", "support", bridge,
      "Synthetic bridge from SwiftUI to the semantic entry."),
    syntheticText("Sources/Application/SemantifoldOutputView.swift", "support", view,
      "Synthetic stable text output view and accessibility identifier."),
    syntheticText("Assets.xcassets/Contents.json", "resource", stringifyCanonicalJson({
      info: {author: "semantifold", version: 1}
    }), "Base asset-catalog metadata; no application icon is synthesized."),
    ...prepared.assets.map(assetArtifact),
    syntheticText(`Tests/${product}Tests.swift`, "support", renderUnitTests(configuration),
      "Synthetic pure-logic determinism XCTest source."),
    syntheticText(`UITests/${product}UITests.swift`, "support", renderUiTests(configuration),
      "Synthetic XCUI accessibility-route test source.")
  ]
  const manifestPath = "semantifold-project.json"

  artifacts.push(syntheticText(manifestPath, "manifest", renderProjectManifest(prepared, artifacts, manifestPath),
    "Versioned iOS project ownership and provenance manifest."))

  return {
    artifacts,
    metadata: {applicationManifest: manifestPath, platformQualification: "deferred"},
    target: "ios"
  }
}

/**
 * Renders the complete deterministic application ownership and provenance record.
 * @param {ReturnType<typeof preflightIosApplication>} prepared - Fully preflighted application.
 * @param {import("../semantic/types.js").GeneratedSetArtifact[]} artifacts - All non-manifest output artifacts.
 * @param {string} manifestPath - Owned manifest path.
 * @returns {string} Canonical manifest JSON.
 */
function renderProjectManifest(prepared, artifacts, manifestPath) {
  const assetPaths = new Set(prepared.assets.map(({path}) => path))
  const semanticArtifacts = artifacts.filter(artifact => artifact.provenance.kind == "text")
  const configuration = prepared.configuration

  return stringifyCanonicalJson({
    configuration,
    generator: {name: "semantifold", version: generatorVersion},
    ownership: {
      excludedPathPatterns,
      ownedPaths: [...artifacts.map(({path}) => path), manifestPath]
    },
    platformRequirements: {
      appleSdk: {status: "deferred"},
      iosSimulator: {status: "deferred"},
      macosHost: {status: "deferred"},
      swiftc: {status: "deferred"},
      xcode: {status: "deferred"},
      xctest: {status: "deferred"},
      xcuiautomation: {status: "deferred"}
    },
    provenance: {
      assets: prepared.assets.map(asset => ({
        contentKind: typeof asset.content == "string" ? "text" : "binary",
        mediaType: asset.mediaType,
        path: asset.path,
        sha256: asset.sha256
      })),
      configuration: Object.keys(configuration).sort().map(field => ({
        field,
        manifestPointer: `/configuration/${field}`,
        outputs: configurationOutputCitations(artifacts, Reflect.get(configuration, field))
      })),
      semanticSources: prepared.sources.map(source => ({
        artifacts: semanticArtifacts.filter(artifact => artifact.provenance.kind == "text" &&
          artifact.provenance.mapping.spans.some(({origin}) => originReferencesFilename(origin, source.filename)))
          .map(({path}) => path),
        filename: source.filename,
        ...(source.language === undefined ? {} : {language: source.language}),
        sha256: createHash("sha256").update(source.content).digest("hex")
      })),
      syntheticScaffolding: [
        ...artifacts.filter(artifact => artifact.provenance.kind == "synthetic" && !assetPaths.has(artifact.path))
          .map(({path}) => path),
        manifestPath
      ]
    },
    schema: "SemantifoldIosProject",
    target: "ios",
    version: 1
  })
}

/**
 * Determines whether one closed semantic origin cites a source filename.
 * @param {import("../semantic/types.js").SemanticOrigin} origin - Mapped origin.
 * @param {string} filename - Original caller filename.
 * @returns {boolean} Whether the source participates in the origin.
 */
function originReferencesFilename(origin, filename) {
  if (origin.kind == "source") return origin.location.filename == filename
  if (origin.kind == "derived") return origin.origins.some(({location}) => location.filename == filename)

  return origin.relatedOrigins.some(({location}) => location.filename == filename)
}

/**
 * Locates exact configuration scalar occurrences in generated text artifacts.
 * Non-scalar and transformed uses remain explicitly cited by their manifest pointer.
 * @param {import("../semantic/types.js").GeneratedSetArtifact[]} artifacts - Generated non-manifest artifacts.
 * @param {unknown} value - Normalized configuration value.
 * @returns {{path: string, ranges: {end: number, start: number}[]}[]} Stable output citations.
 */
function configurationOutputCitations(artifacts, value) {
  if (typeof value != "string" || value.length == 0) return []
  /** @type {{path: string, ranges: {end: number, start: number}[]}[]} */
  const outputs = []

  for (const artifact of artifacts) {
    if (artifact.contentKind != "text") continue
    /** @type {{end: number, start: number}[]} */
    const ranges = []
    let start = artifact.content.indexOf(value)

    while (start >= 0) {
      ranges.push({end: start + value.length, start})
      start = artifact.content.indexOf(value, start + value.length)
    }
    if (ranges.length > 0) outputs.push({path: artifact.path, ranges})
  }

  return outputs
}

/**
 * Renders the shared capture runtime and mapped per-module semantic Swift.
 * @param {ReturnType<typeof preflightIosApplication>} prepared - Fully preflighted application.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact[]} Ordered semantic artifacts.
 */
function renderSemanticArtifacts(prepared) {
  const paths = prepared.modulePaths
  const declarations = new Map()

  for (const module of prepared.modules) {
    for (const declaration of module.functions) declarations.set(declaration.id, {
      declaration,
      moduleId: /** @type {string} */ (Reflect.get(module, "id"))
    })
  }
  /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */
  const artifacts = [{
    content: iosSwiftRuntime,
    contentKind: "text",
    mediaType: "text/x-swift",
    ownership: "generated",
    path: "Sources/Generated/SemantifoldRuntime.swift",
    provenance: {
      kind: "synthetic",
      reason: "Shared iOS application output capture and exact Swift scalar support.",
      relatedOrigins: []
    },
    role: "support"
  }]

  for (const module of prepared.modules) {
    const moduleId = /** @type {string} */ (Reflect.get(module, "id"))
    const filename = /** @type {string} */ (paths.get(moduleId))
    const writer = new SourceWriter({
      filename,
      language: "swift",
      module,
      program: prepared.program,
      programPaths: paths,
      sources: prepared.sources
    })

    emitSemanticModule(writer, module, moduleId, moduleId == prepared.program.entryModule, declarations)
    const mapping = finalizeMapping(writer.finish())

    artifacts.push({
      content: mapping.generated.content,
      contentKind: "text",
      mediaType: "text/x-swift",
      ownership: "generated",
      path: filename,
      provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping), sourceMapFilename: `${filename}.map`},
      role: "source"
    })
  }

  return artifacts
}

/**
 * Produces all project paths referenced by the Xcode model.
 * @param {ReturnType<typeof preflightIosApplication>} prepared - Prepared application.
 * @returns {{appSources: string[], assets: string[], infoPlist: string, unitTest: string, uiTest: string, xcconfig: string}} Paths.
 */
function applicationArtifactPaths(prepared) {
  const product = prepared.configuration.productName

  return {
    appSources: [
      "Sources/Generated/SemantifoldRuntime.swift",
      ...prepared.modulePaths.values(),
      "Sources/Application/App.swift",
      "Sources/Application/SemantifoldBridge.swift",
      "Sources/Application/SemantifoldOutputView.swift"
    ],
    assets: ["Assets.xcassets", ...prepared.assets.map(({path}) => path)],
    infoPlist: "Configuration/Info.plist",
    unitTest: `Tests/${product}Tests.swift`,
    uiTest: `UITests/${product}UITests.swift`,
    xcconfig: "Configuration/Base.xcconfig"
  }
}

/**
 * Derives collision-checked uppercase 24-hex Xcode object IDs from normalized identities.
 * @param {readonly string[]} identities - Complete ordered object identities.
 * @param {(identity: string) => string} [digest] - Test-only digest seam; production uses built-in SHA-256.
 * @returns {Map<string, string>} Object ID by full input identity.
 */
export function allocateXcodeObjectIds(identities, digest = identity => createHash("sha256").update(identity).digest("hex")) {
  const result = new Map()
  const fullIdentities = new Map()

  for (const identity of identities) {
    if (typeof identity != "string" || identity.length == 0 || result.has(identity)) {
      throw new SemantifoldDiagnostic({code: "XCODE_ID_COLLISION", language: "ios",
        message: "Xcode object identities must be unique non-empty strings."})
    }
    const normalized = identity.normalize("NFC")
    const fullDigest = digest(normalized)

    if (!/^[0-9a-fA-F]{64}$/u.test(fullDigest)) {
      throw new SemantifoldDiagnostic({code: "XCODE_ID_COLLISION", language: "ios",
        message: `Xcode object identity '${identity}' did not produce a full SHA-256 digest.`})
    }
    const objectId = fullDigest.slice(0, 24).toUpperCase()
    const previous = fullIdentities.get(objectId)

    if (previous !== undefined && previous != normalized) {
      throw new SemantifoldDiagnostic({code: "XCODE_ID_COLLISION", language: "ios",
        message: `Xcode object identities '${previous}' and '${normalized}' collide at '${objectId}'.`})
    }
    fullIdentities.set(objectId, normalized)
    result.set(identity, objectId)
  }

  return result
}

/**
 * Renders the smallest deterministic Xcode application/unit/UI-test project model.
 * Platform execution remains deferred until the repository has a qualified Apple lane.
 * @param {ReturnType<typeof preflightIosApplication>} prepared - Prepared application.
 * @param {ReturnType<typeof applicationArtifactPaths>} paths - Complete owned paths.
 * @returns {string} Canonical LF project file.
 */
function renderPbxProject(prepared, paths) {
  const configuration = prepared.configuration
  const product = configuration.productName
  const identities = [
    "project", "group:main", "group:sources", "group:generated", "group:application", "group:configuration",
    "group:tests", "group:uitests", "group:products", "target:app", "target:tests", "target:uitests",
    "phase:app:sources", "phase:app:resources", "phase:app:frameworks", "phase:tests:sources", "phase:tests:resources",
    "phase:tests:frameworks", "phase:uitests:sources", "phase:uitests:resources", "phase:uitests:frameworks",
    "product:app", "product:tests", "product:uitests", "proxy:tests:app", "proxy:uitests:app",
    "dependency:tests:app", "dependency:uitests:app",
    "config-list:project", "config-list:app", "config-list:tests", "config-list:uitests",
    "config:project:debug", "config:project:release", "config:app:debug", "config:app:release",
    "config:tests:debug", "config:tests:release", "config:uitests:debug", "config:uitests:release",
    `file:${paths.xcconfig}`, `file:${paths.infoPlist}`, "file:Assets.xcassets",
    `file:${paths.unitTest}`, `file:${paths.uiTest}`,
    ...paths.appSources.flatMap(path => [`file:${path}`, `build:app:${path}`]),
    "build:app:Assets.xcassets", `build:tests:${paths.unitTest}`, `build:uitests:${paths.uiTest}`
  ]
  const ids = allocateXcodeObjectIds(identities)
  const id = identity => {
    const value = ids.get(identity)

    if (!value) throw new TypeError(`Missing planned Xcode identity '${identity}'.`)

    return value
  }
  /** @type {Map<string, {identity: string, body: string[]}[]>} */
  const sections = new Map()
  const add = (section, identity, body) => {
    const entries = sections.get(section) ?? []

    entries.push({body, identity})
    sections.set(section, entries)
  }
  const list = values => values.map(value => `\t\t\t\t${value},`).join("\n")
  const sorted = values => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

  for (const path of paths.appSources) {
    add("PBXBuildFile", `build:app:${path}`, ["isa = PBXBuildFile;", `fileRef = ${id(`file:${path}`)};`])
    add("PBXFileReference", `file:${path}`, ["isa = PBXFileReference;", "lastKnownFileType = sourcecode.swift;",
      `path = ${pbxString(path)};`, "sourceTree = SOURCE_ROOT;"])
  }
  add("PBXBuildFile", "build:app:Assets.xcassets", ["isa = PBXBuildFile;", `fileRef = ${id("file:Assets.xcassets")};`])
  add("PBXBuildFile", `build:tests:${paths.unitTest}`, ["isa = PBXBuildFile;", `fileRef = ${id(`file:${paths.unitTest}`)};`])
  add("PBXBuildFile", `build:uitests:${paths.uiTest}`, ["isa = PBXBuildFile;", `fileRef = ${id(`file:${paths.uiTest}`)};`])
  add("PBXContainerItemProxy", "proxy:tests:app", ["isa = PBXContainerItemProxy;", `containerPortal = ${id("project")};`,
    "proxyType = 1;", `remoteGlobalIDString = ${id("target:app")};`, `remoteInfo = ${pbxString(product)};`])
  add("PBXContainerItemProxy", "proxy:uitests:app", ["isa = PBXContainerItemProxy;", `containerPortal = ${id("project")};`,
    "proxyType = 1;", `remoteGlobalIDString = ${id("target:app")};`, `remoteInfo = ${pbxString(product)};`])
  add("PBXFileReference", `file:${paths.xcconfig}`, ["isa = PBXFileReference;", "lastKnownFileType = text.xcconfig;",
    `path = ${pbxString(paths.xcconfig)};`, "sourceTree = SOURCE_ROOT;"])
  add("PBXFileReference", `file:${paths.infoPlist}`, ["isa = PBXFileReference;", "lastKnownFileType = text.plist.xml;",
    `path = ${pbxString(paths.infoPlist)};`, "sourceTree = SOURCE_ROOT;"])
  add("PBXFileReference", "file:Assets.xcassets", ["isa = PBXFileReference;", "lastKnownFileType = folder.assetcatalog;",
    "path = Assets.xcassets;", "sourceTree = SOURCE_ROOT;"])
  add("PBXFileReference", `file:${paths.unitTest}`, ["isa = PBXFileReference;", "lastKnownFileType = sourcecode.swift;",
    `path = ${pbxString(paths.unitTest)};`, "sourceTree = SOURCE_ROOT;"])
  add("PBXFileReference", `file:${paths.uiTest}`, ["isa = PBXFileReference;", "lastKnownFileType = sourcecode.swift;",
    `path = ${pbxString(paths.uiTest)};`, "sourceTree = SOURCE_ROOT;"])
  add("PBXFileReference", "product:app", ["isa = PBXFileReference;", "explicitFileType = wrapper.application;", "includeInIndex = 0;",
    `path = ${pbxString(`${product}.app`)};`, "sourceTree = BUILT_PRODUCTS_DIR;"])
  add("PBXFileReference", "product:tests", ["isa = PBXFileReference;", "explicitFileType = wrapper.cfbundle;", "includeInIndex = 0;",
    `path = ${pbxString(`${product}Tests.xctest`)};`, "sourceTree = BUILT_PRODUCTS_DIR;"])
  add("PBXFileReference", "product:uitests", ["isa = PBXFileReference;", "explicitFileType = wrapper.cfbundle;", "includeInIndex = 0;",
    `path = ${pbxString(`${product}UITests.xctest`)};`, "sourceTree = BUILT_PRODUCTS_DIR;"])

  const generatedRefs = sorted(paths.appSources.filter(path => path.startsWith("Sources/Generated/"))).map(path => id(`file:${path}`))
  const applicationRefs = sorted(paths.appSources.filter(path => path.startsWith("Sources/Application/"))).map(path => id(`file:${path}`))

  add("PBXGroup", "group:main", ["isa = PBXGroup;", `children = (\n${list([
    id("group:configuration"), id("group:sources"), id("file:Assets.xcassets"), id("group:tests"), id("group:uitests"),
    id("group:products")
  ])}\n\t\t\t);`, "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:sources", ["isa = PBXGroup;", `children = (\n${list([id("group:application"), id("group:generated")])}\n\t\t\t);`,
    "name = Sources;", "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:generated", ["isa = PBXGroup;", `children = (\n${list(generatedRefs)}\n\t\t\t);`,
    "name = Generated;", "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:application", ["isa = PBXGroup;", `children = (\n${list(applicationRefs)}\n\t\t\t);`,
    "name = Application;", "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:configuration", ["isa = PBXGroup;", `children = (\n${list([id(`file:${paths.xcconfig}`), id(`file:${paths.infoPlist}`)])}\n\t\t\t);`,
    "name = Configuration;", "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:tests", ["isa = PBXGroup;", `children = (\n${list([id(`file:${paths.unitTest}`)])}\n\t\t\t);`,
    "name = Tests;", "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:uitests", ["isa = PBXGroup;", `children = (\n${list([id(`file:${paths.uiTest}`)])}\n\t\t\t);`,
    "name = UITests;", "sourceTree = \"<group>\";"])
  add("PBXGroup", "group:products", ["isa = PBXGroup;", `children = (\n${list([id("product:app"), id("product:tests"), id("product:uitests")])}\n\t\t\t);`,
    "name = Products;", "sourceTree = \"<group>\";"])

  addNativeTarget(add, id, "target:app", product, "com.apple.product-type.application", "product:app",
    "config-list:app", ["phase:app:sources", "phase:app:frameworks", "phase:app:resources"], [])
  addNativeTarget(add, id, "target:tests", `${product}Tests`, "com.apple.product-type.bundle.unit-test", "product:tests",
    "config-list:tests", ["phase:tests:sources", "phase:tests:frameworks", "phase:tests:resources"], ["dependency:tests:app"])
  addNativeTarget(add, id, "target:uitests", `${product}UITests`, "com.apple.product-type.bundle.ui-testing", "product:uitests",
    "config-list:uitests", ["phase:uitests:sources", "phase:uitests:frameworks", "phase:uitests:resources"], ["dependency:uitests:app"])
  add("PBXProject", "project", ["isa = PBXProject;", "attributes = { BuildIndependentTargetsInParallel = YES; };",
    `buildConfigurationList = ${id("config-list:project")};`, "developmentRegion = en;", "hasScannedForEncodings = 0;",
    "knownRegions = ( en, Base, );", `mainGroup = ${id("group:main")};`, `productRefGroup = ${id("group:products")};`,
    "projectDirPath = \"\";", "projectRoot = \"\";",
    `targets = (\n${list([id("target:app"), id("target:tests"), id("target:uitests")])}\n\t\t\t);`])

  addBuildPhase(add, id, "PBXFrameworksBuildPhase", "phase:app:frameworks", [])
  addBuildPhase(add, id, "PBXResourcesBuildPhase", "phase:app:resources", ["build:app:Assets.xcassets"])
  addBuildPhase(add, id, "PBXSourcesBuildPhase", "phase:app:sources", sorted(paths.appSources).map(path => `build:app:${path}`))
  for (const target of ["tests", "uitests"]) {
    addBuildPhase(add, id, "PBXFrameworksBuildPhase", `phase:${target}:frameworks`, [])
    addBuildPhase(add, id, "PBXResourcesBuildPhase", `phase:${target}:resources`, [])
  }
  addBuildPhase(add, id, "PBXSourcesBuildPhase", "phase:tests:sources", [`build:tests:${paths.unitTest}`])
  addBuildPhase(add, id, "PBXSourcesBuildPhase", "phase:uitests:sources", [`build:uitests:${paths.uiTest}`])
  add("PBXTargetDependency", "dependency:tests:app", ["isa = PBXTargetDependency;", `target = ${id("target:app")};`,
    `targetProxy = ${id("proxy:tests:app")};`])
  add("PBXTargetDependency", "dependency:uitests:app", ["isa = PBXTargetDependency;", `target = ${id("target:app")};`,
    `targetProxy = ${id("proxy:uitests:app")};`])

  for (const owner of ["project", "app", "tests", "uitests"]) {
    for (const variant of ["debug", "release"]) {
      const settings = buildSettings(owner, variant, configuration, paths)

      add("XCBuildConfiguration", `config:${owner}:${variant}`, ["isa = XCBuildConfiguration;",
        `baseConfigurationReference = ${id(`file:${paths.xcconfig}`)};`, `buildSettings = {\n${settings}\n\t\t\t};`,
        `name = ${variant == "debug" ? "Debug" : "Release"};`])
    }
    add("XCConfigurationList", `config-list:${owner}`, ["isa = XCConfigurationList;",
      `buildConfigurations = (\n${list([id(`config:${owner}:debug`), id(`config:${owner}:release`)])}\n\t\t\t);`,
      "defaultConfigurationIsVisible = 0;", "defaultConfigurationName = Release;"])
  }

  const order = ["PBXBuildFile", "PBXContainerItemProxy", "PBXFileReference", "PBXFrameworksBuildPhase", "PBXGroup",
    "PBXNativeTarget", "PBXProject", "PBXResourcesBuildPhase", "PBXSourcesBuildPhase", "PBXTargetDependency",
    "XCBuildConfiguration", "XCConfigurationList"]
  let output = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n"

  for (const section of order) {
    const entries = (sections.get(section) ?? []).sort((left, right) => left.identity < right.identity ? -1 : 1)

    output += `\n/* Begin ${section} section */\n`
    for (const entry of entries) {
      output += `\t\t${id(entry.identity)} = {\n`
      for (const line of entry.body) output += `\t\t\t${line}\n`
      output += "\t\t};\n"
    }
    output += `/* End ${section} section */\n`
  }
  output += `\t};\n\trootObject = ${id("project")};\n}\n`

  return output
}

/** @param {(section: string, identity: string, body: string[]) => void} add - Object sink. @param {(identity: string) => string} id - ID lookup. @param {string} identity - Target identity. @param {string} name - Product name. @param {string} productType - Product type. @param {string} productReference - Product reference identity. @param {string} configurationList - Configuration list identity. @param {string[]} phases - Phase identities. @param {string[]} dependencies - Dependency identities. */
function addNativeTarget(add, id, identity, name, productType, productReference, configurationList, phases, dependencies) {
  const lines = values => values.map(value => `\t\t\t\t${id(value)},`).join("\n")

  add("PBXNativeTarget", identity, ["isa = PBXNativeTarget;", `buildConfigurationList = ${id(configurationList)};`,
    `buildPhases = (\n${lines(phases)}\n\t\t\t);`, "buildRules = ();", `dependencies = (\n${lines(dependencies)}\n\t\t\t);`,
    `name = ${pbxString(name)};`, `productName = ${pbxString(name)};`, `productReference = ${id(productReference)};`,
    `productType = ${pbxString(productType)};`])
}

/** @param {(section: string, identity: string, body: string[]) => void} add - Object sink. @param {(identity: string) => string} id - ID lookup. @param {string} section - Phase ISA. @param {string} identity - Phase identity. @param {string[]} files - Build-file identities. */
function addBuildPhase(add, id, section, identity, files) {
  const lines = files.map(file => `\t\t\t\t${id(file)},`).join("\n")

  add(section, identity, [`isa = ${section};`, "buildActionMask = 2147483647;", `files = (\n${lines}\n\t\t\t);`,
    "runOnlyForDeploymentPostprocessing = 0;"])
}

/** @param {string} owner - Configuration owner. @param {string} variant - debug/release. @param {import("../semantic/types.js").IosApplicationConfiguration} configuration - App config. @param {ReturnType<typeof applicationArtifactPaths>} paths - Paths. @returns {string} Sorted PBX build settings. */
function buildSettings(owner, variant, configuration, paths) {
  /** @type {Record<string, string>} */
  const values = owner == "project" ? {
    CODE_SIGNING_ALLOWED: "NO",
    CODE_SIGNING_REQUIRED: "NO"
  } : owner == "app" ? {
    GENERATE_INFOPLIST_FILE: "NO",
    INFOPLIST_FILE: pbxString(paths.infoPlist),
    IPHONEOS_DEPLOYMENT_TARGET: configuration.deploymentTarget,
    PRODUCT_BUNDLE_IDENTIFIER: configuration.bundleIdentifier,
    PRODUCT_MODULE_NAME: configuration.moduleName,
    PRODUCT_NAME: configuration.productName,
    SDKROOT: "iphoneos",
    SUPPORTED_PLATFORMS: pbxString("iphoneos iphonesimulator"),
    TARGETED_DEVICE_FAMILY: "1"
  } : owner == "tests" ? {
    BUNDLE_LOADER: pbxString("$(TEST_HOST)"),
    PRODUCT_BUNDLE_IDENTIFIER: `${configuration.bundleIdentifier}.tests`,
    PRODUCT_MODULE_NAME: `${configuration.moduleName}Tests`,
    PRODUCT_NAME: "$(TARGET_NAME)",
    TEST_HOST: pbxString(`$(BUILT_PRODUCTS_DIR)/${configuration.productName}.app/${configuration.productName}`)
  } : {
    PRODUCT_BUNDLE_IDENTIFIER: `${configuration.bundleIdentifier}.uitests`,
    PRODUCT_MODULE_NAME: `${configuration.moduleName}UITests`,
    PRODUCT_NAME: "$(TARGET_NAME)",
    TEST_TARGET_NAME: configuration.productName
  }

  if (variant == "release") values.SWIFT_OPTIMIZATION_LEVEL = pbxString("-O")

  return Object.keys(values).sort().map(key => `\t\t\t\t${key} = ${values[key]};`).join("\n")
}

/** @param {string} value - PBX scalar. @returns {string} Safely quoted PBX scalar. */
function pbxString(value) {
  return JSON.stringify(value)
}

/** @param {ReturnType<typeof preflightIosApplication>} prepared - Prepared application. @returns {string} Shared scheme XML. */
function renderSharedScheme(prepared) {
  const product = prepared.configuration.productName
  const appId = allocateXcodeObjectIds(["target:app"]).get("target:app")
  const testId = allocateXcodeObjectIds(["target:tests"]).get("target:tests")
  const uiTestId = allocateXcodeObjectIds(["target:uitests"]).get("target:uitests")
  const reference = (name, buildable, id) => `<BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${id}"
               BuildableName = "${xmlEscape(buildable)}"
               BlueprintName = "${xmlEscape(name)}"
               ReferencedContainer = "container:${xmlEscape(product)}.xcodeproj">
            </BuildableReference>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme version="1.7">
   <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
            ${reference(product, `${product}.app`, appId)}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
      <Testables>
         <TestableReference skipped="NO">
            ${reference(`${product}Tests`, `${product}Tests.xctest`, testId)}
         </TestableReference>
         <TestableReference skipped="NO">
            ${reference(`${product}UITests`, `${product}UITests.xctest`, uiTestId)}
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">
         ${reference(product, `${product}.app`, appId)}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">
         ${reference(product, `${product}.app`, appId)}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration="Debug"/>
   <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`
}

/** @param {import("../semantic/types.js").IosApplicationConfiguration} configuration - Config. @returns {string} xcconfig. */
function renderBaseConfiguration(configuration) {
  return `CODE_SIGNING_ALLOWED = NO
CODE_SIGNING_REQUIRED = NO
GENERATE_INFOPLIST_FILE = NO
IPHONEOS_DEPLOYMENT_TARGET = ${configuration.deploymentTarget}
PRODUCT_BUNDLE_IDENTIFIER = ${configuration.bundleIdentifier}
PRODUCT_MODULE_NAME = ${configuration.moduleName}
PRODUCT_NAME = ${configuration.productName}
SDKROOT = iphoneos
SUPPORTED_PLATFORMS = iphoneos iphonesimulator
TARGETED_DEVICE_FAMILY = 1
`
}

/** @param {import("../semantic/types.js").IosApplicationConfiguration} configuration - Config. @returns {string} plist XML. */
function renderInfoPlist(configuration) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${xmlEscape(configuration.displayName)}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSRequiresIPhoneOS</key>
  <true/>
  <key>UILaunchScreen</key>
  <dict/>
</dict>
</plist>
`
}

/** @param {import("../semantic/types.js").IosApplicationConfiguration} configuration - Config. @returns {string} XCTest source. */
function renderUnitTests(configuration) {
  return `import XCTest
@testable import ${configuration.moduleName}

final class ${configuration.productName}Tests: XCTestCase {
  func testSemanticOutputIsDeterministic() {
    XCTAssertEqual(SemantifoldBridge.run(), SemantifoldBridge.run())
  }

  func testOutputSinkPreservesScalarLines() {
    let output = SemantifoldOutputSink()
    output.write(Int64(7))
    output.write(true)
    output.write("é😀")
    XCTAssertEqual(output.lines, ["7", "true", "é😀"])
  }
}
`
}

/** @param {import("../semantic/types.js").IosApplicationConfiguration} configuration - Config. @returns {string} XCUI source. */
function renderUiTests(configuration) {
  return `import XCTest

final class ${configuration.productName}UITests: XCTestCase {
  func testOutputViewIsAccessible() {
    let application = XCUIApplication()
    application.launch()
    XCTAssertTrue(application.staticTexts["semantifold-output"].waitForExistence(timeout: 5))
  }
}
`
}

/** @param {string} value - XML text/attribute value. @returns {string} Escaped value. */
function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;").replaceAll("'", "&apos;")
}

/**
 * Creates one synthetic text artifact candidate.
 * @param {string} path - Artifact path.
 * @param {import("../semantic/types.js").GeneratedArtifactRole} role - Artifact role.
 * @param {string} content - Exact LF content.
 * @param {string} reason - Provenance reason.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Artifact candidate.
 */
function syntheticText(path, role, content, reason) {
  return {
    content,
    contentKind: "text",
    mediaType: path.endsWith(".swift") ? "text/x-swift" : path.endsWith(".json") ? "application/json" :
      path.endsWith(".plist") || path.endsWith(".xcscheme") ? "application/xml" : "text/plain",
    ownership: "generated",
    path,
    provenance: {kind: "synthetic", reason, relatedOrigins: []},
    role
  }
}

/** @param {unknown} value - JSON value. @returns {string} Canonical JSON with LF. */
function stringifyCanonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

/** @param {unknown} value - JSON value. @returns {unknown} Recursively key-sorted JSON. */
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainObject(value)) return value

  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]))
}

/**
 * Validates and snapshots the strict baseline application configuration.
 * Identity and deployment fields intentionally have no defaults without Apple-lane evidence.
 * @param {unknown} candidate - Candidate configuration.
 * @returns {import("../semantic/types.js").IosApplicationConfiguration} Normalized configuration.
 */
function normalizeConfiguration(candidate) {
  if (!isPlainObject(candidate) || Object.keys(candidate).some(key => !configurationFields.has(key))) {
    invalidConfiguration("iOS application configuration must be a closed plain object.")
  }
  const productName = candidate.productName
  const moduleName = candidate.moduleName
  const organizationPrefix = candidate.organizationPrefix
  const bundleIdentifier = candidate.bundleIdentifier
  const deploymentTarget = candidate.deploymentTarget
  const displayName = candidate.displayName

  if (typeof productName != "string" || !/^[A-Z][A-Za-z0-9]*$/u.test(productName)) {
    invalidConfiguration("Product name must be an ASCII upper-camel identifier.")
  }
  if (typeof moduleName != "string" || !/^[A-Z][A-Za-z0-9]*$/u.test(moduleName)) {
    invalidConfiguration("Module name must be an ASCII upper-camel identifier.")
  }
  if (typeof organizationPrefix != "string" || !isReverseDns(organizationPrefix, 2)) {
    invalidConfiguration("Organization prefix must be a lowercase reverse-DNS identity with at least two segments.")
  }
  if (typeof bundleIdentifier != "string" || !isReverseDns(bundleIdentifier, 3) ||
    !bundleIdentifier.startsWith(`${organizationPrefix}.`)) {
    invalidConfiguration("Bundle identifier must extend the exact organization prefix as lowercase reverse DNS.")
  }
  if (typeof deploymentTarget != "string" || !/^[1-9][0-9]*\.(?:0|[1-9][0-9]*)$/u.test(deploymentTarget)) {
    invalidConfiguration("Deployment target must be a caller-supplied canonical major.minor version.")
  }
  if (typeof displayName != "string" || displayName.length == 0 || displayName.trim() != displayName ||
    [...displayName].length > 64 || !hasOnlyUnicodeScalars(displayName) || /[\u0000-\u001f\u007f-\u009f]/u.test(displayName)) {
    invalidConfiguration("Display name must be a non-empty single-line Unicode scalar string of at most 64 characters.")
  }
  const sourceRoot = candidate.sourceRoot ?? "Sources"
  const resourceRoot = candidate.resourceRoot ?? "Assets.xcassets"
  const lifecycle = candidate.lifecycle ?? "swiftui"

  if (sourceRoot != "Sources" || !isSafeArtifactPath(sourceRoot)) invalidConfiguration("The supported source root is exactly 'Sources'.")
  if (resourceRoot != "Assets.xcassets" || !isSafeArtifactPath(resourceRoot)) {
    invalidConfiguration("The supported resource root is exactly 'Assets.xcassets'.")
  }
  if (lifecycle != "swiftui") invalidConfiguration("The supported application lifecycle is exactly 'swiftui'.")
  const infoPlist = candidate.infoPlist ?? {}

  if (!isPlainObject(infoPlist) || Object.keys(infoPlist).length > 0) {
    invalidConfiguration("The baseline caller Info.plist extension allowlist is empty.")
  }
  const permissions = emptyConfigurationSet(candidate.permissions, "permissions")
  const entitlements = emptyConfigurationSet(candidate.entitlements, "entitlements")
  const privacyDeclarations = emptyConfigurationSet(candidate.privacyDeclarations, "privacy declarations")
  const capabilities = emptyConfigurationSet(candidate.capabilities, "capabilities")

  return {
    bundleIdentifier,
    capabilities,
    deploymentTarget,
    displayName,
    entitlements,
    infoPlist: {},
    lifecycle,
    moduleName,
    organizationPrefix,
    permissions,
    privacyDeclarations,
    productName,
    resourceRoot,
    sourceRoot
  }
}

/** @param {unknown} candidate - Optional closed set. @param {string} label - Diagnostic label. @returns {never[]} Empty snapshot. */
function emptyConfigurationSet(candidate, label) {
  if (candidate === undefined) return []
  if (!isDenseArray(candidate) || candidate.length != 0) invalidConfiguration(`The baseline ${label} set must be empty.`)

  return []
}

/** @param {string} value - Candidate identity. @param {number} segments - Minimum segments. @returns {boolean} Validity. */
function isReverseDns(value, segments) {
  const parts = value.split(".")

  return parts.length >= segments && parts.every(part => /^[a-z][a-z0-9-]*$/u.test(part) && !part.endsWith("-"))
}

/**
 * Validates, hashes, snapshots, and canonically sorts caller assets.
 * @param {unknown} candidate - Candidate asset array.
 * @param {string} resourceRoot - Exact resource root.
 * @returns {import("../semantic/types.js").IosApplicationAssetInput[]} Normalized assets.
 */
function normalizeAssets(candidate, resourceRoot) {
  if (candidate === undefined) return []
  if (!isDenseArray(candidate)) invalidAsset("Application assets must be a dense array.")
  /** @type {import("../semantic/types.js").IosApplicationAssetInput[]} */
  const assets = []

  for (let index = 0; index < candidate.length; index += 1) {
    const asset = candidate[index]

    if (!isPlainObject(asset) || Object.keys(asset).some(key => !assetFields.has(key)) ||
      Object.keys(asset).length != assetFields.size) invalidAsset(`Asset ${index} must use the closed asset schema.`)
    const path = asset.path
    const content = asset.content
    const mediaType = asset.mediaType
    const sha256 = asset.sha256

    if (!isSafeArtifactPath(path) || !path.startsWith(`${resourceRoot}/`) || path == `${resourceRoot}/Contents.json`) {
      invalidAsset(`Asset ${index} requires a safe path below '${resourceRoot}'.`)
    }
    if (typeof content != "string" && !(content instanceof Uint8Array) ||
      typeof content == "string" && (content.length == 0 || !hasOnlyUnicodeScalars(content)) ||
      content instanceof Uint8Array && content.byteLength == 0) invalidAsset(`Asset '${path}' requires non-empty exact content.`)
    if (typeof mediaType != "string" || !mediaTypePattern.test(mediaType) || /[\r\n]/u.test(mediaType)) {
      invalidAsset(`Asset '${path}' requires an explicit valid media type.`)
    }
    const snapshot = typeof content == "string" ? content : new Uint8Array(content)
    const actualHash = createHash("sha256").update(snapshot).digest("hex")

    if (typeof sha256 != "string" || !/^[0-9a-f]{64}$/u.test(sha256) || sha256 != actualHash) {
      invalidAsset(`Asset '${path}' SHA-256 does not match its exact content.`)
    }
    assets.push({content: snapshot, mediaType, path, sha256})
  }
  assets.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)

  return assets
}

/** @param {import("../semantic/types.js").IosApplicationAssetInput} asset - Validated asset. @returns {import("../semantic/types.js").GeneratedSetArtifact} Artifact candidate. */
function assetArtifact(asset) {
  if (typeof asset.content == "string") return {
    content: asset.content,
    contentKind: "text",
    mediaType: asset.mediaType,
    ownership: "generated",
    path: asset.path,
    provenance: {kind: "synthetic", reason: `Exact caller-provided iOS asset (sha256:${asset.sha256}).`, relatedOrigins: []},
    role: "resource"
  }
  const content = new Uint8Array(asset.content)

  return {
    content,
    contentKind: "binary",
    mediaType: asset.mediaType,
    ownership: "generated",
    path: asset.path,
    provenance: {kind: "bytes", mapping: createByteMapping({
      byteLength: content.byteLength,
      path: asset.path,
      ranges: [{
        generated: {end: content.byteLength, start: 0},
        origin: {kind: "synthetic", reason: `Exact caller-provided iOS asset (sha256:${asset.sha256}).`, relatedOrigins: []},
        role: "asset"
      }]
    })},
    role: "resource"
  }
}

/** @param {string} message - Failure detail. @returns {never} Always throws. */
function invalidConfiguration(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_CONFIGURATION", language: "ios", message})
}

/** @param {string} message - Failure detail. @returns {never} Always throws. */
function invalidAsset(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_ASSET", language: "ios", message})
}

/** @param {string} message - Failure detail. @returns {never} Always throws. */
function invalidPath(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_PATH", language: "ios", message})
}

/**
 * Emits one backend-namespaced semantic module.
 * @param {SourceWriter} writer - Source-aware generated Swift writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Prepared semantic module.
 * @param {string} moduleId - Stable project module identity.
 * @param {boolean} entry - Whether this module owns the semantic entry.
 * @param {Map<string | undefined, {declaration: import("../semantic/types.js").FunctionDeclaration, moduleId: string}>} declarations - Resolved functions.
 */
function emitSemanticModule(writer, module, moduleId, entry, declarations) {
  const namespace = `SemantifoldModule${moduleName(moduleId)}`

  writer.synthetic(`enum ${namespace} {\n`, "iOS semantic module namespace", [module], [""])
  module.functions.forEach((declaration, functionIndex) => {
    const path = `/functions/${functionIndex}`

    writer.synthetic("  static ", "iOS namespaced function scaffold", [declaration], [path])
    writer.mapped("func", {mappingKind: "anchor", node: declaration, path})
    writer.synthetic(" ", "declaration spacing", [declaration], [path])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
    writer.synthetic("(", "function parameter scaffold", [declaration], [path])
    declaration.parameters.forEach((parameter, parameterIndex) => {
      const parameterPath = `${path}/parameters/${parameterIndex}`

      if (parameterIndex) writer.synthetic(", ", "parameter separator", [parameter], [parameterPath])
      writer.synthetic("_ ", "unlabeled Swift parameter scaffold", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(": ", "parameter annotation scaffold", [parameter], [parameterPath])
      writer.mapped(emitScalarType("swift", parameter.type), {mappingKind: "exact", node: parameter.type,
        path: `${parameterPath}/type`, role: "type"})
    })
    writer.synthetic(", _ semantifold_output: SemantifoldOutputSink) -> ", "shared iOS output sink parameter", [declaration], [path])
    writer.mapped(emitScalarType("swift", declaration.returnType), {mappingKind: "exact", node: declaration.returnType,
      path: `${path}/returnType`, role: "type"})
    writer.synthetic(" {\n", "Swift function body scaffold", [declaration], [path])
    emitBlock(writer, declaration.body, "    ", `${path}/body`, declarations)
    writer.synthetic("  }\n", "Swift function body scaffold", [declaration], [path])
  })
  if (entry) {
    writer.synthetic("  static func semantifoldEntry() -> [String] {\n", "iOS semantic entry scaffold", [module.entryPoint], ["/entryPoint"])
    writer.synthetic("    let semantifold_output = SemantifoldOutputSink()\n", "shared iOS output sink allocation",
      [module.entryPoint], ["/entryPoint"])
    emitBlock(writer, module.entryPoint.body, "    ", "/entryPoint/body", declarations)
    writer.synthetic("    return semantifold_output.lines\n", "iOS semantic output return", [module.entryPoint], ["/entryPoint"])
    writer.synthetic("  }\n", "iOS semantic entry scaffold", [module.entryPoint], ["/entryPoint"])
  }
  writer.synthetic("}\n", "iOS semantic module namespace", [module], [""])
}

/**
 * Emits a validated ordered semantic block.
 * @param {SourceWriter} writer - Source writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Current indentation.
 * @param {string} path - Block occurrence path.
 * @param {Map<string | undefined, {declaration: import("../semantic/types.js").FunctionDeclaration, moduleId: string}>} declarations - Resolved functions.
 */
function emitBlock(writer, block, indent, path, declarations) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`, declarations))
}

/**
 * Emits one Swift statement through the shared capture sink.
 * @param {SourceWriter} writer - Source writer.
 * @param {import("../semantic/types.js").Statement} statement - Validated statement.
 * @param {string} indent - Current indentation.
 * @param {string} path - Statement occurrence path.
 * @param {Map<string | undefined, {declaration: import("../semantic/types.js").FunctionDeclaration, moduleId: string}>} declarations - Resolved functions.
 */
function emitStatement(writer, statement, indent, path, declarations) {
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "LocalDeclaration") {
    writer.mapped(statement.mutable ? "var" : "let", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "declaration spacing", [statement], [path])
    writer.mapped(statement.name, {mappingKind: "exact", node: statement, path, role: "name"})
    writer.synthetic(": ", "local annotation scaffold", [statement], [path])
    writer.mapped(emitScalarType("swift", statement.type), {mappingKind: "exact", node: statement.type,
      path: `${path}/type`, role: "type"})
    writer.synthetic(" = ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.initializer, `${path}/initializer`, declarations)
    writer.synthetic("\n", "line break", [statement], [path])
    if (statement.mutable) writer.synthetic(`${indent}semantifold_keep_mutable(&${statement.name})\n`,
      "Swift mutable-local warning marker", [statement], [path])
    return
  }
  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${path}/target`, role: "name"})
    writer.synthetic(" = ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, declarations)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    if (!statement.expression) throw new TypeError("iOS Swift bare return reached emission.")
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, declarations)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.synthetic("semantifold_output.write(", "iOS output capture", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, declarations)
    writer.synthetic(")\n", "iOS output capture", [statement], [path])
    return
  }
  if (statement.kind != "IfStatement") throw new TypeError("Unsupported iOS Swift statement reached emission.")
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  emitExpression(writer, statement.condition, `${path}/condition`, declarations)
  writer.synthetic(" {\n", "Swift conditional scaffold", [statement.consequent], [`${path}/consequent`])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`, declarations)
  writer.synthetic(`${indent}}`, "Swift conditional scaffold", [statement.consequent], [`${path}/consequent`])
  if (statement.alternate) {
    writer.synthetic(" else {\n", "Swift alternate scaffold", [statement.alternate], [`${path}/alternate`])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`, declarations)
    writer.synthetic(`${indent}}`, "Swift alternate scaffold", [statement.alternate], [`${path}/alternate`])
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one validated Tasks 001-004 expression and threads the shared sink through calls.
 * @param {SourceWriter} writer - Source writer.
 * @param {import("../semantic/types.js").Expression} expression - Semantic expression.
 * @param {string} path - Expression occurrence path.
 * @param {Map<string | undefined, {declaration: import("../semantic/types.js").FunctionDeclaration, moduleId: string}>} declarations - Resolved functions.
 */
function emitExpression(writer, expression, path, declarations) {
  if (expression.kind == "IdentifierExpression") {
    writer.mapped(expression.name, {mappingKind: "exact", node: expression, path, role: "name"})
    return
  }
  if (expression.kind == "IntegerLiteral") {
    writer.mapped(String(expression.value), {mappingKind: "exact", node: expression, path, role: "literal"})
    return
  }
  if (expression.kind == "BooleanLiteral") {
    writer.mapped(expression.value ? "true" : "false", {mappingKind: "exact", node: expression, path, role: "literal"})
    return
  }
  if (expression.kind == "StringLiteral") {
    writer.mapped(emitStringLiteral("swift", expression.value), {mappingKind: "exact", node: expression, path, role: "literal"})
    return
  }
  if (expression.kind == "CallExpression") {
    const resolved = declarations.get(expression.resolution?.declarationId)

    if (!resolved) throw new TypeError(`Unknown validated iOS function '${expression.resolution?.declarationId}'.`)
    writer.mapped(`SemantifoldModule${moduleName(resolved.moduleId)}.${resolved.declaration.name}`, {
      mappingKind: "exact", name: expression.callee, node: expression, path, role: "callee"
    })
    writer.synthetic("(", "iOS semantic function call", [expression], [path])
    expression.arguments.forEach((argument, index) => {
      if (index) writer.synthetic(", ", "argument separator", [expression], [path])
      emitExpression(writer, argument, `${path}/arguments/${index}`, declarations)
    })
    writer.synthetic(", semantifold_output)", "shared iOS output sink argument", [expression], [path])
    return
  }
  if (expression.kind == "UnaryExpression") {
    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    writer.mapped(unaryOperations[expression.operation], {mappingKind: "exact", node: expression, path, role: "operator"})
    emitExpression(writer, expression.operand, `${path}/operand`, declarations)
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind != "BinaryExpression") throw new TypeError("Unsupported iOS Swift expression reached emission.")
  if (expression.operation == "StringEqual" || expression.operation == "StringNotEqual") {
    writer.mapped(expression.operation == "StringEqual" ? "semantifold_string_equal" : "semantifold_string_not_equal",
      {mappingKind: "exact", node: expression, path, role: "operator"})
    writer.synthetic("(", "Swift scalar-equality helper call", [expression], [path])
    emitExpression(writer, expression.left, `${path}/left`, declarations)
    writer.synthetic(", ", "Swift scalar-equality argument separator", [expression], [path])
    emitExpression(writer, expression.right, `${path}/right`, declarations)
    writer.synthetic(")", "Swift scalar-equality helper call", [expression], [path])
    return
  }
  writer.mapped("(", {mappingKind: "anchor", node: expression, path})
  emitExpression(writer, expression.left, `${path}/left`, declarations)
  writer.synthetic(" ", "operator spacing", [expression], [path])
  writer.mapped(binaryOperations[expression.operation], {mappingKind: "exact", node: expression, path, role: "operator"})
  writer.synthetic(" ", "operator spacing", [expression], [path])
  emitExpression(writer, expression.right, `${path}/right`, declarations)
  writer.mapped(")", {mappingKind: "anchor", node: expression, path})
}

/** @param {string} id - Logical module identity. @returns {string} Deterministic Swift namespace suffix and filename. */
function moduleName(id) {
  return id.split(/[._-]+/u).map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join("")
}

/**
 * Clones and normalizes one provenance-bearing semantic module into a one-module project.
 * @param {import("../semantic/types.js").SemanticModule | undefined} candidate - Candidate module.
 * @returns {import("../semantic/types.js").SemanticProgram} Normalized program.
 */
function normalizeSingleModule(candidate) {
  if (!isPlainObject(candidate)) unsupportedCapability("ios", "missing or invalid module", undefined)
  const module = structuredClone(candidate)
  const provenanceSources = module.provenance?.sources

  if (!Array.isArray(provenanceSources) || provenanceSources.length != 1 || provenanceSources[0].content === null ||
    provenanceSources[0].filename != module.location?.filename || typeof provenanceSources[0].language != "string") {
    unsupportedCapability("ios", "single-module source ownership", module.location)
  }
  rekeyModuleDeclarations(module, "main")
  const exports = [
    ...(module.records ?? []).map(declaration => applicationExport(declaration, "record")),
    ...(module.classes ?? []).map(declaration => applicationExport(declaration, "class")),
    ...(module.errors ?? []).map(declaration => applicationExport(declaration, "error")),
    ...module.functions.map(declaration => applicationExport(declaration, "function"))
  ]
  const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ ({
    ...module,
    exports,
    id: "main",
    imports: [],
    sourceFilename: provenanceSources[0].filename
  })

  return {
    entryModule: "main",
    kind: "Program",
    modules: [programModule],
    sources: structuredClone(provenanceSources)
  }
}

/**
 * Creates a normalized export for a single-module declaration without inventing a source range.
 * @param {{id?: string, location: import("../semantic/types.js").SourceLocation, name: string}} declaration - Exported declaration.
 * @param {import("../semantic/types.js").SemanticDeclarationKind} symbolKind - Declaration namespace.
 * @returns {import("../semantic/types.js").SemanticExport} Synthetic project edge anchored to its declaration.
 */
function applicationExport(declaration, symbolKind) {
  return {
    declarationId: /** @type {string} */ (declaration.id),
    exportedName: declaration.name,
    kind: "Export",
    location: declaration.location,
    symbolKind
  }
}

/**
 * Prefixes declaration identities and typed references in a cloned single module.
 * @param {import("../semantic/types.js").SemanticModule} module - Cloned module.
 * @param {string} moduleId - Normalized module identity.
 * @returns {void}
 */
function rekeyModuleDeclarations(module, moduleId) {
  const declarations = [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions]
  const replacements = new Map(declarations
    .filter(declaration => typeof declaration.id == "string")
    .map(declaration => [declaration.id, `${moduleId}#${declaration.id}`]))

  for (const declaration of declarations) {
    if (typeof declaration.id == "string") declaration.id = replacements.get(declaration.id)
  }
  const seen = new Set()
  const identityFields = new Set(["classId", "declarationId", "field", "method", "parameterId"])
  /** @param {unknown} value - Candidate semantic subtree. */
  function visit(value) {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    if (!Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value)) {
        if (identityFields.has(key) && typeof nested == "string" && replacements.has(nested)) {
          Reflect.set(value, key, replacements.get(nested))
        } else visit(nested)
      }
    } else for (const nested of value) visit(nested)
  }
  visit(module)
}

/** @param {unknown} value - Candidate request. @returns {value is Record<string, unknown>} Whether it is a plain object. */
function isPlainObject(value) {
  return Boolean(value) && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}
