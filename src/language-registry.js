// @ts-check

import {isDenseArray} from "./array.js"
import {SemantifoldDiagnostic, unsupportedRole} from "./diagnostic.js"
import {generateJava} from "./backends/java.js"
import {generateJavaScript} from "./backends/javascript.js"
import {generatePhp} from "./backends/php.js"
import {generateRuby} from "./backends/ruby.js"
import {generateTypeScript} from "./backends/typescript.js"
import {parseJava} from "./frontends/java.js"
import {parseJavaScriptTypeScript} from "./frontends/javascript-typescript.js"
import {parsePhp} from "./frontends/php.js"
import {parseRuby} from "./frontends/ruby.js"

const registryRoles = Object.freeze(["frontend", "textBackend", "binaryBackend", "applicationBackend", "interoperability"])
const acceptanceStageOrder = ["parse", "generate", "compile", "link", "validate", "instantiate", "execute"]
const acceptanceStages = new Map(acceptanceStageOrder.map((stage, index) => [stage, index]))
const registryKeys = new Set([
  "acceptance", "applicationBackend", "artifactMultiplicity", "binaryBackend", "defaultFilename", "frontend", "id",
  "interoperability", "mapping", "mediaType", "roundTrip", "textBackend"
])

/** @typedef {"frontend" | "textBackend" | "binaryBackend" | "applicationBackend" | "interoperability"} RegistryRole */
/** @typedef {(input: {filename: string, source: string}) => import("./semantic/types.js").SemanticModule} Frontend */
/** @typedef {(...values: unknown[]) => unknown} RegistryImplementation */

/**
 * @typedef LanguageRegistryRecord
 * @property {string} id - Stable identity.
 * @property {{stages: import("./semantic/types.js").AcceptanceStage[], toolchains: string[]}} acceptance - Acceptance declaration.
 * @property {"single" | "multiple"} artifactMultiplicity - Artifact multiplicity.
 * @property {import("./semantic/types.js").LanguageMappingCapabilities} mapping - Mapping capabilities.
 * @property {boolean} roundTrip - Round-trip declaration.
 * @property {string} [defaultFilename] - Default backend filename.
 * @property {string} [mediaType] - Default backend media type.
 * @property {RegistryImplementation} [frontend] - Frontend adapter.
 * @property {RegistryImplementation} [textBackend] - Text backend.
 * @property {RegistryImplementation} [binaryBackend] - Binary backend.
 * @property {RegistryImplementation} [applicationBackend] - Application-artifact backend.
 * @property {RegistryImplementation} [interoperability] - Interoperability bridge.
 */

/**
 * @typedef LanguageRegistry
 * @property {readonly import("./semantic/types.js").LanguageCapabilities[]} descriptors - Public descriptors.
 * @property {readonly string[]} ids - Registered IDs in stable order.
 * @property {(id: string) => Readonly<LanguageRegistryRecord>} record - Exact record lookup.
 * @property {(id: string, role: RegistryRole, location?: import("./semantic/types.js").SourceLocation) => RegistryImplementation} resolve - Role lookup.
 */

/**
 * Constructs an immutable role registry from ordered records.
 * @param {unknown} candidateRecords - Ordered language records.
 * @returns {Readonly<LanguageRegistry>} Registry.
 */
export function createLanguageRegistry(candidateRecords) {
  if (!isDenseArray(candidateRecords)) invalidRegistry("Registry records must be an ordered dense array.")

  /** @type {Map<string, Readonly<LanguageRegistryRecord>>} */
  const recordsById = new Map()
  /** @type {import("./semantic/types.js").LanguageCapabilities[]} */
  const descriptors = []

  for (let recordIndex = 0; recordIndex < candidateRecords.length; recordIndex += 1) {
    const candidate = candidateRecords[recordIndex]

    if (!isPlainObject(candidate)) invalidRegistry("Every registry record must be a plain object.")
    const id = candidate.id

    if (typeof id != "string" || id.length == 0 || !/^[a-z][a-z0-9-]*$/u.test(id)) {
      invalidRegistry("Every registry record requires a stable lowercase ID.", typeof id == "string" ? id : undefined)
    }
    if (recordsById.has(id)) invalidRegistry(`Duplicate registry ID '${id}'.`, id)
    if (Object.keys(candidate).some((key) => !registryKeys.has(key))) invalidRegistry(`Registry record '${id}' has unknown fields.`, id)

    for (const role of registryRoles) {
      if (candidate[role] !== undefined && typeof candidate[role] != "function") {
        invalidRegistry(`Registry role '${role}' for '${id}' must be a function when present.`, id)
      }
    }
    const artifactMultiplicity = candidate.artifactMultiplicity

    if (artifactMultiplicity != "single" && artifactMultiplicity != "multiple") {
      invalidRegistry(`Registry record '${id}' has an invalid artifact multiplicity.`, id)
    }
    if (typeof candidate.roundTrip != "boolean") invalidRegistry(`Registry record '${id}' requires a Boolean round-trip declaration.`, id)
    if (!isPlainObject(candidate.mapping) ||
      typeof candidate.mapping.richText != "boolean" ||
      typeof candidate.mapping.sourceMapV3 != "boolean" ||
      typeof candidate.mapping.binaryRanges != "boolean") {
      invalidRegistry(`Registry record '${id}' has an invalid mapping declaration.`, id)
    }
    const acceptanceCandidate = candidate.acceptance

    if (!isPlainObject(acceptanceCandidate) || !isDenseArray(acceptanceCandidate.stages) ||
      !isDenseArray(acceptanceCandidate.toolchains)) {
      invalidRegistry(`Registry record '${id}' has an invalid acceptance declaration.`, id)
    }
    /** @type {unknown[]} */
    const stageSnapshot = []
    /** @type {unknown[]} */
    const toolchainSnapshot = []

    for (let index = 0; index < acceptanceCandidate.stages.length; index += 1) {
      stageSnapshot.push(acceptanceCandidate.stages[index])
    }
    for (let index = 0; index < acceptanceCandidate.toolchains.length; index += 1) {
      toolchainSnapshot.push(acceptanceCandidate.toolchains[index])
    }
    if (!stageSnapshot.every((stage) => typeof stage == "string" && acceptanceStages.has(stage)) ||
      !toolchainSnapshot.every((toolchain) => typeof toolchain == "string" && toolchain.length > 0)) {
      invalidRegistry(`Registry record '${id}' has an invalid acceptance declaration.`, id)
    }
    const stages = /** @type {import("./semantic/types.js").AcceptanceStage[]} */ (stageSnapshot)
    const toolchains = /** @type {string[]} */ (toolchainSnapshot)
    let previousStage = -1
    const declaredStages = new Set()

    for (const stage of stages) {
      const stageIndex = /** @type {number} */ (acceptanceStages.get(/** @type {string} */ (stage)))

      if (declaredStages.has(stage) || stageIndex < previousStage) invalidRegistry(`Registry record '${id}' has unordered or duplicate acceptance stages.`, id)
      declaredStages.add(stage)
      previousStage = stageIndex
    }
    if (new Set(toolchains).size != toolchains.length) {
      invalidRegistry(`Registry record '${id}' has duplicate acceptance toolchains.`, id)
    }

    const hasFrontend = typeof candidate.frontend == "function"
    const hasTextBackend = typeof candidate.textBackend == "function"
    const hasBinaryBackend = typeof candidate.binaryBackend == "function"
    const hasApplicationBackend = typeof candidate.applicationBackend == "function"
    const hasBackend = hasTextBackend || hasBinaryBackend || hasApplicationBackend

    if ((candidate.mapping.richText || candidate.mapping.sourceMapV3) && !hasTextBackend ||
      candidate.mapping.sourceMapV3 && !candidate.mapping.richText ||
      candidate.mapping.binaryRanges && !hasBinaryBackend && !hasApplicationBackend) {
      invalidRegistry(`Registry record '${id}' declares mapping support without its required backend role.`, id)
    }
    if (candidate.roundTrip && (!hasFrontend || !hasBackend)) {
      invalidRegistry(`Registry record '${id}' declares round-trip support without frontend and backend roles.`, id)
    }
    if (stages.includes("parse") && !hasFrontend || stages.includes("generate") && !hasBackend) {
      invalidRegistry(`Registry record '${id}' declares an acceptance stage without its required role.`, id)
    }

    if ((hasBackend || candidate.defaultFilename !== undefined) &&
      (typeof candidate.defaultFilename != "string" || candidate.defaultFilename.length == 0)) {
      invalidRegistry(`Registry backend '${id}' requires a default filename.`, id)
    }
    if ((hasBackend || candidate.mediaType !== undefined) &&
      (typeof candidate.mediaType != "string" || candidate.mediaType.length == 0)) {
      invalidRegistry(`Registry backend '${id}' requires a media type.`, id)
    }

    const acceptance = deepFreeze(/** @type {import("./semantic/types.js").LanguageAcceptanceCapabilities} */ ({
      stages,
      toolchains
    }))
    const mapping = deepFreeze(/** @type {import("./semantic/types.js").LanguageMappingCapabilities} */ ({...candidate.mapping}))
    const record = deepFreeze(/** @type {LanguageRegistryRecord} */ ({
      acceptance,
      artifactMultiplicity,
      id,
      mapping,
      roundTrip: candidate.roundTrip,
      ...(typeof candidate.defaultFilename == "string" ? {defaultFilename: candidate.defaultFilename} : {}),
      ...(typeof candidate.mediaType == "string" ? {mediaType: candidate.mediaType} : {}),
      ...(typeof candidate.frontend == "function" ? {frontend: candidate.frontend} : {}),
      ...(typeof candidate.textBackend == "function" ? {textBackend: candidate.textBackend} : {}),
      ...(typeof candidate.binaryBackend == "function" ? {binaryBackend: candidate.binaryBackend} : {}),
      ...(typeof candidate.applicationBackend == "function" ? {applicationBackend: candidate.applicationBackend} : {}),
      ...(typeof candidate.interoperability == "function" ? {interoperability: candidate.interoperability} : {})
    }))
    const descriptor = deepFreeze(/** @type {import("./semantic/types.js").LanguageCapabilities} */ ({
      acceptance,
      artifactMultiplicity,
      id,
      mapping,
      roles: {
        applicationBackend: typeof candidate.applicationBackend == "function",
        binaryBackend: typeof candidate.binaryBackend == "function",
        frontend: typeof candidate.frontend == "function",
        interoperability: typeof candidate.interoperability == "function",
        textBackend: typeof candidate.textBackend == "function"
      },
      roundTrip: candidate.roundTrip
    }))

    recordsById.set(id, record)
    descriptors.push(descriptor)
  }

  const frozenDescriptors = deepFreeze(descriptors)
  const ids = Object.freeze(frozenDescriptors.map(({id}) => id))

  return Object.freeze({
    descriptors: frozenDescriptors,
    ids,
    record(id) {
      const record = recordsById.get(id)

      if (!record) unsupportedLanguage(id)

      return record
    },
    resolve(id, role, location) {
      if (!registryRoles.includes(role)) invalidRegistry(`Unknown registry role '${role}'.`, id)
      const record = recordsById.get(id)

      if (!record) unsupportedLanguage(id, location, role)
      const implementation = record[role]

      if (typeof implementation != "function") unsupportedRole(id, publicRoleName(role), location)

      return implementation
    }
  })
}

/**
 * PHP registry frontend wrapper.
 * @type {Frontend}
 */
const phpFrontend = ({filename, source}) => parsePhp({filename, source})

/**
 * Ruby registry frontend wrapper.
 * @type {Frontend}
 */
const rubyFrontend = ({filename, source}) => parseRuby({filename, source})

/**
 * JavaScript registry frontend wrapper.
 * @type {Frontend}
 */
const javaScriptFrontend = ({filename, source}) => parseJavaScriptTypeScript({filename, language: "javascript", source})

/**
 * TypeScript registry frontend wrapper.
 * @type {Frontend}
 */
const typeScriptFrontend = ({filename, source}) => parseJavaScriptTypeScript({filename, language: "typescript", source})

/**
 * Java registry frontend wrapper.
 * @type {Frontend}
 */
const javaFrontend = ({filename, source}) => parseJava({filename, source})

const records = [
  language({
    acceptance: {stages: ["parse", "generate", "execute"], toolchains: ["php"]},
    defaultFilename: "program.php",
    frontend: phpFrontend,
    id: "php",
    mediaType: "application/x-httpd-php",
    textBackend: generatePhp
  }),
  language({
    acceptance: {stages: ["parse", "generate", "execute"], toolchains: ["ruby"]},
    defaultFilename: "program.rb",
    frontend: rubyFrontend,
    id: "ruby",
    mediaType: "text/x-ruby",
    textBackend: generateRuby
  }),
  language({
    acceptance: {stages: ["parse", "generate", "execute"], toolchains: ["node"]},
    defaultFilename: "program.js",
    frontend: javaScriptFrontend,
    id: "javascript",
    mediaType: "text/javascript",
    textBackend: generateJavaScript
  }),
  language({
    acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["tsc", "node"]},
    defaultFilename: "program.ts",
    frontend: typeScriptFrontend,
    id: "typescript",
    mediaType: "text/typescript",
    textBackend: generateTypeScript
  }),
  language({
    acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["javac", "java"]},
    defaultFilename: "Main.java",
    frontend: javaFrontend,
    id: "java",
    mediaType: "text/x-java-source",
    textBackend: generateJava
  })
]

export const languageRegistry = createLanguageRegistry(records)
export const languageCapabilities = languageRegistry.descriptors
/** @type {readonly import("./semantic/types.js").SemanticLanguage[]} */
export const supportedLanguages = Object.freeze(languageCapabilities
  .filter(({roles}) => roles.frontend && roles.textBackend)
  .map(({id}) => /** @type {import("./semantic/types.js").SemanticLanguage} */ (id)))

/**
 * Supplies common original-five capability declarations.
 * @param {Record<string, unknown>} values - Language-specific record fields.
 * @returns {Record<string, unknown>} Complete record.
 */
function language(values) {
  return {
    artifactMultiplicity: "single",
    mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
    roundTrip: true,
    ...values
  }
}

/**
 * Formats an internal registry key for a public role diagnostic.
 * @param {string} role - Internal role key.
 * @returns {string} Public role name.
 */
function publicRoleName(role) {
  if (role == "textBackend") return "text backend"
  if (role == "binaryBackend") return "binary backend"
  if (role == "applicationBackend") return "application-artifact backend"

  return role
}

/**
 * Throws an unknown-language diagnostic.
 * @param {string} id - Unknown identity.
 * @param {import("./semantic/types.js").SourceLocation | undefined} [location] - Related location.
 * @param {RegistryRole | undefined} [role] - Requested role.
 * @returns {never} Always throws.
 */
function unsupportedLanguage(id, location, role) {
  const message = role == "frontend" ? "No frontend adapter is registered for this language." :
    role == "textBackend" ? "No source backend is registered for this language." :
      "No language or target is registered for this ID."

  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_LANGUAGE",
    language: id,
    location,
    message
  })
}

/**
 * Throws a normalized registry-shape diagnostic.
 * @param {string} message - Failure detail.
 * @param {string | undefined} [id] - Candidate registry ID.
 * @returns {never} Always throws.
 */
function invalidRegistry(message, id = "registry") {
  throw new SemantifoldDiagnostic({code: "INVALID_REGISTRY", language: id, message})
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Deeply freezes registry records and public descriptors.
 * @template T
 * @param {T} value - Registry-owned value.
 * @returns {T} Frozen value.
 */
function deepFreeze(value) {
  if (!value || typeof value != "object" || Object.isFrozen(value)) return value

  for (const nested of Object.values(value)) deepFreeze(nested)

  return Object.freeze(value)
}
