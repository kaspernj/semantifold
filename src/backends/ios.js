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
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], target: "ios"}} Candidate artifact set.
 */
export function generateIosApplication(input) {
  const prepared = preflightIosApplication(input)
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
      role: moduleId == prepared.program.entryModule ? "entry" : "source"
    })
  }

  for (const asset of prepared.assets) artifacts.push(assetArtifact(asset))

  return {artifacts, target: "ios"}
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
