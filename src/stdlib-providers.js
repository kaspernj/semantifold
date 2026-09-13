// @ts-check

import {isDenseArray} from "./array.js"
import {isSafeArtifactPath} from "./artifact-path.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {languageRegistry} from "./language-registry.js"
import {
  listStdlibModules,
  parseStdlibVersion,
  parseStdlibVersionRange,
  protectedEntryName,
  resolveStdlibModule
} from "./semantic/stdlib.js"

export {protectedEntryName} from "./semantic/stdlib.js"

/**
 * @typedef StdlibProviderRecord
 * @property {{mediaType: string, path: string}} artifact - Generated provider artifact declaration.
 * @property {readonly {module: string, range: string}[]} dependencies - Canonical module dependencies with declared ranges.
 * @property {string} identity - Stable provider identity rooted at the target.
 * @property {Readonly<Record<string, string>>} nativeEntries - Operation to protected native entry name.
 * @property {readonly {module: string, operations: string[], version: string}[]} provides - Exactly one provided canonical module.
 * @property {string} target - Adopted target language identity.
 */

/**
 * @typedef StdlibProviderRegistry
 * @property {readonly StdlibProviderRecord[]} records - Registered provider records in stable order.
 * @property {{(target: string, module: string, version: string): readonly StdlibProviderRecord[]}} providersFor - Exact provider lookup.
 */

const providerIdentityPrefix = "semantifold.provider."
/** @type {Readonly<Record<string, string>>} */
const targetExtensions = Object.freeze({
  javascript: "js",
  java: "java",
  php: "php",
  ruby: "rb",
  typescript: "ts"
})
const builtinProviderTargets = Object.freeze(["php", "ruby", "javascript", "typescript", "java"])
const probeIdentity = "semantifold.task034.resource-probe"
const probeOperations = Object.freeze(["probeEffect", "probeAcquire", "probeRead", "probeClose", "probeTrace"])
const recordKeys = Object.freeze(["artifact", "dependencies", "identity", "nativeEntries", "provides", "target"])

/**
 * Creates the versioned target host stdlib provider registry.
 * @param {unknown} records - Ordered provider records; built-in providers by default.
 * @returns {Readonly<StdlibProviderRegistry>} Frozen registry.
 */
export function createStdlibProviderRegistry(records = builtinProviderRecords()) {
  if (!isDenseArray(records)) invalidProvider("Provider records must be an ordered dense array.")

  /** @type {StdlibProviderRecord[]} */
  const validated = []
  /** @type {Set<string>} */
  const identities = new Set()

  for (const candidate of records) {
    const record = validateProviderRecord(candidate)

    if (identities.has(record.identity)) invalidProvider(`Duplicate stdlib provider identity '${record.identity}'.`)
    identities.add(record.identity)
    validated.push(record)
  }
  const frozenRecords = deepFreeze(validated)

  return Object.freeze(/** @type {Readonly<StdlibProviderRegistry>} */ ({
    records: frozenRecords,
    providersFor(target, module, version) {
      if (typeof target != "string" || typeof module != "string" || typeof version != "string") return Object.freeze([])
      return Object.freeze(frozenRecords.filter((record) =>
        record.target == target && record.provides[0].module == module && record.provides[0].version == version))
    }
  }))
}

/**
 * Lists the built-in target host providers for the probe contract in stable target order.
 * @returns {readonly StdlibProviderRecord[]} Frozen provider records.
 */
export function listStdlibProviders() {
  return builtinProviderRegistry().records
}

/**
 * Authoritative built-in provider lookup keyed by exact target, module, and version.
 * @type {{providersFor(target: string, module: string, version: string): readonly StdlibProviderRecord[]}}
 */
export const stdlibProviderRegistry = {
  providersFor(target, module, version) {
    return builtinProviderRegistry().providersFor(target, module, version)
  }
}

/**
 * Validates one provider record against the target roles and canonical contract registry.
 * @param {unknown} candidate - Candidate record.
 * @returns {StdlibProviderRecord} Detached frozen record.
 */
function validateProviderRecord(candidate) {
  if (!isPlainObject(candidate)) invalidProvider("Every stdlib provider record must be a plain object.")
  if (Object.keys(candidate).sort().join(",") != recordKeys.join(",")) {
    invalidProvider("Every stdlib provider record declares the exact provider record fields.")
  }
  const target = /** @type {string} */ (candidate.target)

  if (typeof target != "string" || !providerTargetRegistered(target)) {
    invalidProvider(`Stdlib provider target '${String(target)}' is not an adopted target host provider.`)
  }
  const identity = /** @type {string} */ (candidate.identity)
  const identityPrefix = providerIdentityPrefix + target + "."

  if (typeof identity != "string" || !identity.startsWith(identityPrefix) || identity.length == identityPrefix.length) {
    invalidProvider(`Stdlib provider identity '${String(identity)}' must be rooted at '${identityPrefix}'.`)
  }
  const provides = /** @type {unknown} */ (candidate.provides)

  if (!isDenseArray(provides) || provides.length != 1) invalidProvider("Every stdlib provider provides exactly one canonical module.")
  const provision = /** @type {unknown} */ (provides[0])

  if (!isPlainObject(provision) || Object.keys(provision).sort().join(",") != "module,operations,version") {
    invalidProvider("Every stdlib provider provision declares the exact provision fields.")
  }
  const module = /** @type {string} */ (provision.module)

  if (typeof module != "string" || !/^[a-z][a-z0-9.-]*$/u.test(module)) {
    invalidProvider(`Stdlib provider module '${String(module)}' is not a canonical identity.`)
  }
  const version = /** @type {string} */ (provision.version)

  if (parseStdlibVersion(version) === null) {
    throw new SemantifoldDiagnostic({
      code: "STDLIB_VERSION_MALFORMED",
      language: target,
      message: `Stdlib provider version '${String(version)}' is not a strict semantic version.`
    })
  }
  const operations = /** @type {unknown} */ (provision.operations)

  if (!isDenseArray(operations) || operations.length == 0 || !operations.every((operation) =>
    typeof operation == "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(operation)) ||
    new Set(/** @type {string[]} */ (operations)).size != operations.length) {
    invalidProvider(`Stdlib provider '${identity}' declares invalid operations.`)
  }
  const operationList = /** @type {string[]} */ (operations)

  if (moduleKnown(module)) validateProvision(module, version, operationList)
  const nativeEntries = /** @type {unknown} */ (candidate.nativeEntries)

  if (!isPlainObject(nativeEntries) || Object.keys(nativeEntries).sort().join(",") !=
    [...operationList].sort().join(",")) {
    invalidProvider(`Stdlib provider '${identity}' native entries must match its operations exactly.`)
  }
  for (const operation of operationList) {
    if (/** @type {string} */ (nativeEntries[operation]) != protectedEntryName(target, operation)) {
      invalidProvider(`Stdlib provider '${identity}' declares an invalid protected native entry.`)
    }
  }
  const artifact = /** @type {unknown} */ (candidate.artifact)

  if (!isPlainObject(artifact) || Object.keys(artifact).sort().join(",") != "mediaType,path") {
    invalidProvider(`Stdlib provider '${identity}' declares an invalid artifact.`)
  }
  const mediaType = /** @type {string} */ (artifact.mediaType)
  const path = /** @type {string} */ (artifact.path)
  const derivedPath = `providers/${target}/${module.replaceAll(".", "/")}.${targetExtensions[target]}`

  if (typeof mediaType != "string" || mediaType.length == 0 || typeof path != "string" ||
    path != derivedPath || !isSafeArtifactPath(path)) {
    invalidProvider(`Stdlib provider '${identity}' artifact must be generated at '${derivedPath}'.`)
  }
  const dependencies = /** @type {unknown} */ (candidate.dependencies)

  if (!isDenseArray(dependencies)) invalidProvider(`Stdlib provider '${identity}' dependencies must be a dense array.`)
  /** @type {{module: string, range: string}[]} */
  const validatedDependencies = []

  for (const dependency of dependencies) {
    if (!isPlainObject(dependency) || Object.keys(dependency).sort().join(",") != "module,range") {
      invalidProvider(`Stdlib provider '${identity}' declares an invalid dependency.`)
    }
    const dependencyModule = /** @type {string} */ (dependency.module)
    const dependencyRange = /** @type {string} */ (dependency.range)

    if (typeof dependencyModule != "string" || !/^[a-z][a-z0-9.-]*$/u.test(dependencyModule) ||
      parseStdlibVersionRange(dependencyRange) === null) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_VERSION_MALFORMED",
        language: target,
        message: `Stdlib provider dependency range '${String(dependencyRange)}' is not a canonical version range.`
      })
    }
    validatedDependencies.push({module: dependencyModule, range: /** @type {string} */ (dependencyRange)})
  }
  return deepFreeze(/** @type {StdlibProviderRecord} */ ({
    artifact: {mediaType, path},
    dependencies: validatedDependencies,
    identity,
    nativeEntries: Object.freeze(Object.fromEntries(operationList.map((operation) => [
      operation,
      /** @type {string} */ (nativeEntries[operation])
    ]))),
    provides: [{module, operations: operationList, version: /** @type {string} */ (version)}],
    target
  }))
}

/**
 * Checks the provisioned module version and operations against the canonical contract registry.
 * @param {string} module - Canonical module identity.
 * @param {string} version - Strict provider version.
 * @param {string[]} operations - Provided operations.
 * @returns {void}
 */
function validateProvision(module, version, operations) {
  const listed = listStdlibModules().find(({identity}) => identity == module)

  if (!listed || !listed.versions.includes(version)) {
    invalidProvider(`Stdlib provider version '${version}' is not registered for module '${module}'.`)
  }
  const declared = new Set(resolveStdlibModule(module, version).operations.map(({name}) => name))

  for (const operation of operations) {
    if (!declared.has(operation)) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_OPERATION_UNDECLARED",
        language: module,
        message: `Operation '${operation}' is not declared by canonical module '${module}'.`
      })
    }
  }
}

/**
 * Reports whether a target is registered with the provider role.
 * @param {unknown} target - Candidate target identity.
 * @returns {boolean} Whether the target adopts the provider role.
 */
function providerTargetRegistered(target) {
  if (typeof target != "string") return false
  try {
    return languageRegistry.record(target).provider === true
  } catch {
    return false
  }
}

/**
 * Reports whether a module identity is known to the built-in canonical contract registry.
 * @param {string} module - Canonical module identity.
 * @returns {boolean} Whether the identity resolves.
 */
function moduleKnown(module) {
  try {
    resolveStdlibModule(module)
    return true
  } catch {
    return false
  }
}

/**
 * Builds the built-in provider records for the adopted targets.
 * @returns {unknown[]} Unvalidated built-in records.
 */
function builtinProviderRecords() {
  return builtinProviderTargets.map((target) => ({
    artifact: {
      mediaType: /** @type {string} */ (languageRegistry.record(target).mediaType),
      path: `providers/${target}/${probeIdentity.replaceAll(".", "/")}.${targetExtensions[target]}`
    },
    dependencies: [],
    identity: `semantifold.provider.${target}.${probeIdentity}`,
    nativeEntries: Object.fromEntries(probeOperations.map((operation) => [operation, protectedEntryName(target, operation)])),
    provides: [{module: probeIdentity, operations: [...probeOperations], version: "1.0.0"}],
    target
  }))
}

/** @type {Readonly<StdlibProviderRegistry> | null} */
let builtinProviderRegistryValue = null

/**
 * Lazily materializes the built-in provider registry after language-registry initialization.
 * @returns {Readonly<StdlibProviderRegistry>} Built-in registry.
 */
function builtinProviderRegistry() {
  if (builtinProviderRegistryValue === null) {
    builtinProviderRegistryValue = createStdlibProviderRegistry(builtinProviderRecords())
  }
  return builtinProviderRegistryValue
}

/**
 * Throws a normalized provider-registry diagnostic.
 * @param {string} message - Failure detail.
 * @returns {never} Always throws.
 */
function invalidProvider(message) {
  throw new SemantifoldDiagnostic({code: "STDLIB_PROVIDER_INVALID", language: "stdlib", message})
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  if (typeof value != "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Deep-freezes a detached value.
 * @template T
 * @param {T} value - Detached value.
 * @returns {Readonly<T>} Frozen value.
 */
function deepFreeze(value) {
  if (typeof value != "object" || value === null || Object.isFrozen(value)) return /** @type {Readonly<T>} */ (value)
  Object.freeze(value)

  for (const property of Object.getOwnPropertyNames(value)) {
    deepFreeze(/** @type {unknown} */ ((/** @type {Record<string, unknown>} */ (value))[property]))
  }
  return /** @type {Readonly<T>} */ (value)
}
