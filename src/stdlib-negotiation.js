// @ts-check

import {isDenseArray} from "./array.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {
  compareStdlibVersions,
  createStdlibContractRegistry,
  intersectStdlibVersionRanges,
  parseStdlibVersion,
  parseStdlibVersionRange,
  stdlibVersionSatisfies
} from "./semantic/stdlib.js"
import {stdlibProviderRegistry} from "./stdlib-providers.js"

/** @typedef {import("./semantic/stdlib.js").StdlibContractRegistry} StdlibContractRegistry */
/** @typedef {import("./stdlib-providers.js").StdlibProviderRecord} StdlibProviderRecord */
/** @typedef {import("./semantic/stdlib.js").VersionRange} VersionRange */

/** @type {Readonly<VersionRange>} */
const universalRange = Object.freeze({lower: /** @type {[number, number, number]} */ (Object.freeze([0, 0, 0])), upper: null})
const builtinContracts = createStdlibContractRegistry()

/**
 * @typedef StdlibNegotiationRequirement
 * @property {string} module - Canonical module identity.
 * @property {string[]} operations - Required canonical operations.
 * @property {string | undefined} [range] - Declared version range.
 */

/**
 * @typedef StdlibNegotiationResult
 * @property {string} target - Negotiated target language.
 * @property {readonly {identity: string, operations: string[], version: string}[]} modules - Linked modules in identity order.
 * @property {readonly {identity: string, target: string, module: string, version: string, operations: string[], nativeEntries: Readonly<Record<string, string>>, runtimeProfile: string}[]} providers - Selected providers in identity order.
 */

/**
 * Negotiates the complete transitive stdlib provider closure for one target.
 * @param {{contracts?: StdlibContractRegistry, providers?: {providersFor(target: string, module: string, version: string): readonly StdlibProviderRecord[]}, requirements: StdlibNegotiationRequirement[], target: string}} input - Negotiation request.
 * @returns {Readonly<StdlibNegotiationResult>} Frozen negotiation result.
 */
export function negotiateStdlibProviders({contracts = builtinContracts, providers = stdlibProviderRegistry, requirements, target}) {
  if (!isDenseArray(requirements)) invalidRequirement("Stdlib negotiation requirements must be an ordered dense array.")
  /** @type {Map<string, VersionRange>} */
  const ranges = new Map()
  /** @type {Map<string, string>} */
  const rangeKeys = new Map()
  /** @type {Map<string, Set<string>>} */
  const usedOperations = new Map()

  /**
   * Intersects one declared range into the per-module closure.
   * @param {string} module - Canonical module identity.
   * @param {VersionRange} range - Declared version range.
   * @returns {boolean} Whether the combined range changed.
   */
  function addRange(module, range) {
    const current = ranges.get(module) ?? universalRange
    const next = intersectStdlibVersionRanges(current, range)

    if (next === null) throw new SemantifoldDiagnostic({
      code: "STDLIB_VERSION_INCOMPATIBLE",
      language: module,
      message: `Canonical module '${module}' has no version satisfying every declared range.`
    })
    const key = rangeKey(next)

    if (rangeKeys.get(module) == key) return false
    ranges.set(module, next)
    rangeKeys.set(module, key)
    return true
  }

  /**
   * Rejects a module identity absent from the contract registry.
   * @param {string} module - Canonical module identity.
   * @returns {void}
   */
  function requireModule(module) {
    if (!contracts.modules.some(({identity}) => identity == module)) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_MODULE_UNKNOWN",
        language: module,
        message: `Canonical module '${module}' is not registered.`
      })
    }
  }

  for (const requirement of requirements) {
    if (!isPlainObject(requirement)) invalidRequirement("Every stdlib negotiation requirement must be a plain object.")
    const module = /** @type {string} */ (requirement.module)
    const operations = /** @type {unknown} */ (requirement.operations)

    if (typeof module != "string") {
      throw new SemantifoldDiagnostic({code: "STDLIB_MODULE_UNKNOWN", language: String(module), message: "Canonical module identity is missing."})
    }
    if (!isDenseArray(operations) || !operations.every((operation) => typeof operation == "string")) {
      invalidRequirement(`Requirement for module '${module}' declares invalid operations.`)
    }
    if (operations.length == 0) continue
    requireModule(module)
    for (const operation of /** @type {string[]} */ (operations)) {
      const used = usedOperations.get(module) ?? new Set()

      used.add(operation)
      usedOperations.set(module, used)
    }
    if (requirement.range !== undefined) {
      const range = parseStdlibVersionRange(requirement.range)

      if (range === null) malformedRange(String(requirement.range))
      addRange(module, range)
    }
  }

  let changed = true

  while (changed) {
    changed = false

    for (const module of [...usedOperations.keys()].sort()) {
      const contract = resolveModuleVersion(contracts, module, ranges.get(module) ?? universalRange)
      const declared = new Map(contract.operations.map(({dependencies, name}) => [name, dependencies]))

      for (const dependency of contract.dependencies) {
        requireModule(dependency.module)
        if (addRange(dependency.module, asVersionRange(dependency.range))) changed = true
        if (!usedOperations.has(dependency.module)) {
          usedOperations.set(dependency.module, new Set())
          changed = true
        }
      }

      for (const operation of [.../** @type {Set<string>} */ (usedOperations.get(module))].sort()) {
        const dependencies = declared.get(operation)

        if (dependencies === undefined) undeclaredOperation(module, operation)
        for (const dependency of dependencies) {
          const {module: dependencyModule, operation: dependencyOperation, range} = dependency

          requireModule(dependencyModule)
          if (addRange(dependencyModule, asVersionRange(range))) changed = true
          const used = usedOperations.get(dependencyModule) ?? new Set()

          if (!used.has(dependencyOperation)) {
            used.add(dependencyOperation)
            usedOperations.set(dependencyModule, used)
            changed = true
          }
        }
      }
    }
  }

  /** @type {Map<string, StdlibProviderRecord>} */
  const selectedProviders = new Map()
  let stable = false

  while (!stable) {
    stable = true
    selectedProviders.clear()

    for (const module of [...usedOperations.keys()].sort()) {
      const contract = resolveModuleVersion(contracts, module, ranges.get(module) ?? universalRange)
      const candidates = providers.providersFor(target, module, contract.version)

      if (candidates.length == 0) {
        throw new SemantifoldDiagnostic({
          code: "STDLIB_PROVIDER_MISSING",
          language: target,
          message: `No registered provider serves module '${module}' version '${contract.version}'.`
        })
      }
      if (candidates.length > 1) {
        throw new SemantifoldDiagnostic({
          code: "STDLIB_PROVIDER_AMBIGUOUS",
          language: target,
          message: `Multiple registered providers serve module '${module}' version '${contract.version}'.`
        })
      }
      const provider = /** @type {StdlibProviderRecord} */ (candidates[0])

      selectedProviders.set(module, provider)
      for (const dependency of provider.dependencies) {
        if (!contracts.modules.some(({identity}) => identity == dependency.module)) {
          throw new SemantifoldDiagnostic({
            code: "STDLIB_PROVIDER_DEPENDENCY_MISSING",
            language: provider.identity,
            message: `Provider dependency module '${dependency.module}' is not registered.`
          })
        }
        if (addRange(dependency.module, asVersionRange(dependency.range))) stable = false
        if (!usedOperations.has(dependency.module)) {
          usedOperations.set(dependency.module, new Set())
          stable = false
        }
      }
    }
  }
  for (const module of [...usedOperations.keys()].sort()) {
    const provider = /** @type {StdlibProviderRecord} */ (selectedProviders.get(module))
    const provided = new Set(provider.provides[0].operations)
    const missing = [.../** @type {Set<string>} */ (usedOperations.get(module))].sort()
      .filter((operation) => !provided.has(operation))

    if (missing.length > 0) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_PROVIDER_MISSING",
        language: target,
        message: `Provider '${provider.identity}' does not provide operation${missing.length > 1 ? "s" : ""} '${missing.join("', '")}' of module '${module}'.`
      })
    }
  }
  assertAcyclic(contracts, ranges, usedOperations, selectedProviders)
  /** @type {{identity: string, operations: string[], version: string}[]} */
  const modules = [...usedOperations.keys()].sort().map((identity) => {
    const contract = resolveModuleVersion(contracts, identity, ranges.get(identity) ?? universalRange)
    const used = /** @type {Set<string>} */ (usedOperations.get(identity))

    return {
      identity,
      operations: contract.operations.map(({name}) => name).filter((name) => used.has(name)),
      version: contract.version
    }
  })
  /** @type {{identity: string, target: string, module: string, version: string, operations: string[], nativeEntries: Record<string, string>, runtimeProfile: string}[]} */
  const providerResults = [...selectedProviders.values()].sort((left, right) =>
    left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0).map((provider) => {
    const module = provider.provides[0].module
    const contract = resolveModuleVersion(contracts, module, ranges.get(module) ?? universalRange)
    const used = /** @type {Set<string>} */ (usedOperations.get(module))
    const operations = contract.operations.map(({name}) => name).filter((name) => used.has(name))

    return {
      identity: provider.identity,
      module,
      nativeEntries: Object.fromEntries(operations.map((operation) => [
        operation,
        /** @type {string} */ (provider.nativeEntries[operation])
      ])),
      operations,
      runtimeProfile: provider.runtimeProfile,
      target: provider.target,
      version: provider.provides[0].version
    }
  })
  return deepFreeze(/** @type {StdlibNegotiationResult} */ ({modules, providers: providerResults, target}))
}

/**
 * Resolves the highest registered contract version satisfying one combined range.
 * @param {StdlibContractRegistry} contracts - Canonical contract registry.
 * @param {string} module - Canonical module identity.
 * @param {VersionRange} range - Combined half-open range.
 * @returns {import("./semantic/stdlib.js").StdlibContract} Exact-version contract.
 */
function resolveModuleVersion(contracts, module, range) {
  const listed = contracts.modules.find(({identity}) => identity == module)

  if (!listed) {
    throw new SemantifoldDiagnostic({code: "STDLIB_MODULE_UNKNOWN", language: module, message: `Canonical module '${module}' is not registered.`})
  }
  /** @type {[number, number, number] | null} */
  let resolved = null

  for (const version of listed.versions) {
    const tuple = /** @type {[number, number, number]} */ (parseStdlibVersion(version))

    if (stdlibVersionSatisfies(tuple, range) && (resolved === null || compareStdlibVersions(tuple, resolved) > 0)) {
      resolved = tuple
    }
  }
  if (resolved === null) {
    throw new SemantifoldDiagnostic({
      code: "STDLIB_VERSION_INCOMPATIBLE",
      language: module,
      message: `Canonical module '${module}' has no registered version satisfying the combined range.`
    })
  }
  return contracts.resolveModule(module, `${resolved[0]}.${resolved[1]}.${resolved[2]}`)
}

/**
 * Fails deterministically when canonical operation dependencies or selected provider
 * module dependencies cycle.
 * @param {StdlibContractRegistry} contracts - Canonical contract registry.
 * @param {Map<string, VersionRange>} ranges - Combined ranges per module.
 * @param {Map<string, Set<string>>} usedOperations - Used operations per module.
 * @param {Map<string, StdlibProviderRecord>} selectedProviders - Selected provider per module.
 * @returns {void}
 */
function assertAcyclic(contracts, ranges, usedOperations, selectedProviders) {
  /** @type {Map<string, string[]>} */
  const edges = new Map()

  for (const module of [...usedOperations.keys()].sort()) {
    const contract = resolveModuleVersion(contracts, module, ranges.get(module) ?? universalRange)
    const declared = new Map(contract.operations.map(({dependencies, name}) => [name, dependencies]))
    const used = /** @type {Set<string>} */ (usedOperations.get(module))

    for (const operation of [...used].sort()) {
      const nodeKey = `${module}\u0000${operation}`
      const targets = /** @type {string[]} */ (edges.get(nodeKey) ?? [])

      for (const dependency of /** @type {{module: string, operation: string}[]} */ (declared.get(operation))) {
        targets.push(`${dependency.module}\u0000${dependency.operation}`)
      }
      edges.set(nodeKey, targets.sort())
    }
    const moduleNodeKey = `${module}\u0000\u0000`
    const moduleTargets = /** @type {string[]} */ (edges.get(moduleNodeKey) ?? [])

    for (const dependency of contract.dependencies) moduleTargets.push(`${dependency.module}\u0000\u0000`)
    edges.set(moduleNodeKey, moduleTargets.sort())
  }
  for (const module of [...selectedProviders.keys()].sort()) {
    const provider = /** @type {StdlibProviderRecord} */ (selectedProviders.get(module))
    const nodeKey = `${module}\u0000\u0000`
    const targets = /** @type {string[]} */ (edges.get(nodeKey) ?? [])

    for (const dependency of provider.dependencies) {
      targets.push(`${dependency.module}\u0000\u0000`)
    }
    edges.set(nodeKey, targets.sort())
  }
  /** @type {Map<string, number>} */
  const colors = new Map()
  /**
   * Walks the dependency edges in deterministic order, rejecting cycles.
   * @param {string} nodeKey - Node key.
   * @returns {void}
   */
  function visit(nodeKey) {
    colors.set(nodeKey, 1)

    for (const target of /** @type {string[]} */ (edges.get(nodeKey) ?? [])) {
      const color = colors.get(target) ?? 0

      if (color == 1) throw new SemantifoldDiagnostic({
        code: "STDLIB_PROVIDER_CYCLE",
        language: target.split("\u0000")[0],
        message: "Canonical stdlib dependencies form a cycle."
      })
      if (color == 0) visit(target)
    }
    colors.set(nodeKey, 2)
  }

  for (const nodeKey of [...edges.keys()].sort()) {
    if ((colors.get(nodeKey) ?? 0) == 0) visit(nodeKey)
  }
}

/**
 * Normalizes a declared dependency range, accepting canonical strings or parsed ranges.
 * @param {unknown} value - Candidate range.
 * @returns {VersionRange} Half-open range.
 */
function asVersionRange(value) {
  if (typeof value == "string") {
    const parsed = parseStdlibVersionRange(value)

    if (parsed === null) malformedRange(value)
    return parsed
  }
  if (isPlainObject(value) && Array.isArray(value.lower) && value.lower.length == 3 &&
    value.lower.every((part) => Number.isInteger(part)) &&
    (value.upper === null || (Array.isArray(value.upper) && value.upper.length == 3 &&
      value.upper.every((part) => Number.isInteger(part))))) {
    return {lower: /** @type {[number, number, number]} */ (value.lower), upper: value.upper === null ? null : /** @type {[number, number, number]} */ (value.upper)}
  }
  return malformedRange(String(value))
}

/**
 * Encodes one half-open range deterministically.
 * @param {VersionRange} range - Half-open range.
 * @returns {string} Stable key.
 */
function rangeKey(range) {
  return `${range.lower.join(".")}..${range.upper === null ? "" : range.upper.join(".")}`
}

/**
 * Throws a malformed-version-range diagnostic.
 * @param {string} range - Candidate range.
 * @returns {never} Always throws.
 */
function malformedRange(range) {
  throw new SemantifoldDiagnostic({
    code: "STDLIB_VERSION_MALFORMED",
    language: "stdlib",
    message: `Stdlib version range '${range}' is not canonical.`
  })
}

/**
 * Throws an undeclared-operation diagnostic.
 * @param {string} module - Canonical module identity.
 * @param {string} operation - Missing operation.
 * @returns {never} Always throws.
 */
function undeclaredOperation(module, operation) {
  throw new SemantifoldDiagnostic({
    code: "STDLIB_OPERATION_UNDECLARED",
    language: module,
    message: `Operation '${operation}' is not declared by canonical module '${module}'.`
  })
}

/**
 * Throws a requirement-shape diagnostic.
 * @param {string} message - Failure detail.
 * @returns {never} Always throws.
 */
function invalidRequirement(message) {
  throw new SemantifoldDiagnostic({code: "STDLIB_CONTRACT_INVALID", language: "stdlib", message})
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
