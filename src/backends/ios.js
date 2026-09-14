// @ts-check

import {SemantifoldDiagnostic, unsupportedCapability} from "../diagnostic.js"
import {preflightSemanticProgram} from "./program.js"

/** @type {ReadonlySet<import("../semantic/types.js").SemanticLanguage>} */
const iosSourceLanguages = new Set(["php", "ruby", "javascript", "typescript", "java", "swift"])

/**
 * Preflights one complete project against the delivered Swift Tasks 001-004 profile.
 * @param {object} input - iOS application generation input.
 * @param {import("../semantic/types.js").SemanticModule} [input.module] - Single module to normalize.
 * @param {import("../semantic/types.js").SemanticProgram} [input.program] - Caller-owned Task 010 project.
 * @returns {{modules: import("../semantic/types.js").SemanticModule[], program: import("../semantic/types.js").SemanticProgram, sources: {content: string, filename: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} Prepared application program.
 */
export function preflightIosApplication(input) {
  if (!isPlainObject(input) || Boolean(input.module) == Boolean(input.program)) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_APPLICATION_INPUT",
      language: "ios",
      message: "iOS application generation requires exactly one semantic module or program."
    })
  }
  const program = input.program ?? normalizeSingleModule(input.module)

  return preflightSemanticProgram({
    backendLanguage: "swift",
    diagnosticLanguage: "ios",
    program,
    sourceLanguages: iosSourceLanguages
  })
}

/**
 * Owns the registered application route while rendering remains outside this validation slice.
 * @param {Parameters<typeof preflightIosApplication>[0]} input - iOS generation request.
 * @returns {never} Always stops before candidate artifact allocation in this slice.
 */
export function generateIosApplication(input) {
  preflightIosApplication(input)

  return unsupportedCapability("ios", "application target semantic project validation")
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
