// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"

const identityPattern = /^[a-z][a-z0-9.-]*$/u
const declarationNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u
const scalarNames = new Set(["boolean", "integer", "string"])
const component = "(0|[1-9][0-9]*)"
const exactVersionPattern = new RegExp(`^${component}\\.${component}\\.${component}$`, "u")
const rangePattern = new RegExp(`^${component}(?:\\.${component}){0,2}$`, "u")
const semanticsValues = {
  blocking: new Set(["synchronous"]),
  close: new Set(["not-applicable", "use-after-close-fails", "repeated-close-fails"]),
  eof: new Set(["not-applicable", "absent-value"]),
  encoding: new Set(["not-applicable", "utf-8"]),
  newline: new Set(["not-applicable", "strip-line-terminator"]),
  ownership: new Set(["not-applicable", "acquired", "borrowed", "consumed"]),
  timeout: new Set(["none"])
}

/** @typedef {[number, number, number]} VersionTuple */
/** @typedef {{lower: VersionTuple, upper: VersionTuple | null}} VersionRange */
/**
 * @typedef StdlibContractOperation
 * @property {{module: string, operation: string, range: VersionRange}[]} dependencies - Canonical operation dependencies.
 * @property {["host"]} effects - Closed effect declaration.
 * @property {"left-to-right"} evaluationOrder - Canonical argument evaluation order.
 * @property {string[]} failures - Declared failure names.
 * @property {string} name - Operation name.
 * @property {{name: string, type: string}[]} parameters - Ordered parameters.
 * @property {object} resourceFlow - Closed resource transition.
 * @property {string} returnType - Closed return type spelling.
 * @property {Record<string, string>} semantics - Closed canonical semantics fields.
 */
/**
 * @typedef StdlibContractModule
 * @property {{name: string}[]} failures - Ordered failure declarations.
 * @property {string} identity - Canonical module identity.
 * @property {StdlibContractOperation[]} operations - Ordered operation declarations.
 * @property {{name: string}[]} resources - Ordered resource declarations.
 * @property {string} version - Exact registered version.
 */
/**
 * @typedef StdlibContract
 * @property {{name: string}[]} failures - Ordered failure declarations.
 * @property {string} identity - Canonical module identity.
 * @property {StdlibContractOperation[]} operations - Ordered operation declarations.
 * @property {{name: string}[]} resources - Ordered resource declarations.
 * @property {"SemantifoldStdlibContract"} schema - Contract schema discriminator.
 * @property {1} schemaVersion - Contract schema version.
 * @property {string} version - Resolved exact version.
 */
/**
 * @typedef StdlibContractRegistry
 * @property {{identity: string, versions: string[]}[]} modules - Registered modules in stable order.
 * @property {(identity: string, range?: string) => StdlibContract} resolveModule - Versioned module resolution.
 */

/**
 * Parses one exact X.Y.Z standard-library version.
 * @param {unknown} value - Candidate version.
 * @returns {VersionTuple | null} Parsed version or null when malformed.
 */
export function parseStdlibVersion(value) {
  if (typeof value != "string" || !exactVersionPattern.test(value)) return null
  const [major, minor, patch] = value.split(".").map((part) => Number(part))
  return [major, minor, patch]
}

/**
 * Parses one X, X.Y, or X.Y.Z standard-library version range.
 * @param {unknown} value - Candidate range.
 * @returns {VersionRange | null} Half-open range or null when malformed.
 */
export function parseStdlibVersionRange(value) {
  if (typeof value != "string" || !rangePattern.test(value)) return null
  const parts = value.split(".").map((part) => Number(part))
  const major = parts[0]
  const minor = parts.length > 1 ? parts[1] : 0
  const patch = parts.length > 2 ? parts[2] : 0

  if (parts.length == 1) return {lower: [major, 0, 0], upper: [major + 1, 0, 0]}
  if (parts.length == 2) return {lower: [major, minor, 0], upper: [major, minor + 1, 0]}
  return {lower: [major, minor, patch], upper: [major, minor, patch + 1]}
}

/**
 * Compares two exact version tuples.
 * @param {VersionTuple} left - Left version.
 * @param {VersionTuple} right - Right version.
 * @returns {number} Negative, zero, or positive ordering.
 */
export function compareStdlibVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] != right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

/**
 * Derives one protected native provider entry name.
 * @param {string} target - Adopted provider target language.
 * @param {string} operation - Canonical operation name.
 * @returns {string} Protected native entry name.
 */
export function protectedEntryName(target, operation) {
  return `__semantifold_provider_${target}_${operation}`
}

/**
 * Parses one protected native provider entry name.
 * @param {string} name - Candidate protected entry name.
 * @returns {{target: string, operation: string} | null} Parsed binding or null when unparseable.
 */
export function parseProtectedEntryName(name) {
  const match = /^__semantifold_provider_([a-z][a-z0-9-]*)_(.+)$/u.exec(name)
  if (!match) return null
  return {operation: match[2], target: match[1]}
}

/**
 * Intersects two half-open version ranges.
 * @param {VersionRange} left - Left range.
 * @param {VersionRange} right - Right range.
 * @returns {VersionRange | null} Intersection or null when empty.
 */
export function intersectStdlibVersionRanges(left, right) {
  const lower = compareStdlibVersions(left.lower, right.lower) >= 0 ? left.lower : right.lower
  const upper = left.upper === null ? right.upper : right.upper === null ? left.upper :
    compareStdlibVersions(left.upper, right.upper) <= 0 ? left.upper : right.upper

  if (upper !== null && compareStdlibVersions(lower, upper) >= 0) return null
  return {lower, upper}
}

/**
 * Checks whether one exact version satisfies one half-open range.
 * @param {VersionTuple} version - Candidate version.
 * @param {VersionRange} range - Declared range.
 * @returns {boolean} Whether the version satisfies the range.
 */
export function stdlibVersionSatisfies(version, range) {
  if (compareStdlibVersions(version, range.lower) < 0) return false
  return range.upper === null || compareStdlibVersions(version, range.upper) < 0
}

/**
 * Creates the built-in versioned canonical stdlib contract registry.
 * @param {unknown} records - Optional override record set; built-in probe contract by default.
 * @returns {Readonly<StdlibContractRegistry>} Frozen registry.
 */
export function createStdlibContractRegistry(records = [builtinProbeContract()]) {
  if (!isDenseArray(records)) invalidContract("Canonical contract records must be an ordered dense array.")

  /** @type {Map<string, Map<string, StdlibContractModule>>} */
  const modules = new Map()
  const identities = new Set()

  for (const candidate of records) {
    const record = validateContractRecord(candidate)
    const versions = modules.get(record.identity) ?? new Map()

    if (versions.has(record.version)) invalidContract(`Duplicate canonical contract '${record.identity}' version '${record.version}'.`)
    versions.set(record.version, record)
    modules.set(record.identity, versions)
    identities.add(record.identity)
  }
  for (const record of modules.values()) {
    for (const module of record.values()) validateContractDependencies(module, identities)
  }
  const frozenModules = [...modules.entries()]
    .map(([identity, versions]) => ({
      identity,
      versions: [...versions.keys()].map((version) => /** @type {VersionTuple} */ (parseStdlibVersion(version)))
        .sort(compareStdlibVersions)
        .map(([major, minor, patch]) => `${major}.${minor}.${patch}`)
    }))
    .map(deepFreeze)
  const store = deepFreeze(/** @type {{modules: [string, Readonly<Map<string, Readonly<StdlibContractModule>>>][]}} */ ({
    modules: [...modules.entries()].map(([identity, versions]) => [identity, deepFreeze(versions)])
  }))
  return Object.freeze(/** @type {StdlibContractRegistry} */ ({
    modules: Object.freeze(frozenModules),
    resolveModule(identity, range) {
      return resolveRegistryModule(store, identity, range)
    }
  }))
}

/**
 * Resolves one module identity plus optional range against one registry store.
 * @param {{modules: [string, Readonly<Map<string, Readonly<StdlibContractModule>>>][]}} store - Registry store.
 * @param {string} identity - Canonical module identity.
 * @param {string | undefined} [range] - Declared version range.
 * @returns {StdlibContract} Detached frozen contract.
 */
function resolveRegistryModule(store, identity, range) {
  const versions = store.modules.find(([candidate]) => candidate == identity)?.[1]

  if (!versions) unknownModule(identity)
  const parsed = range === undefined ? /** @type {VersionRange} */ ({lower: [0, 0, 0], upper: null}) : parseStdlibVersionRange(range)

  if (!parsed) malformedRange()
  /** @type {VersionTuple | undefined} */
  let resolved

  for (const version of versions.keys()) {
    const tuple = /** @type {VersionTuple} */ (parseStdlibVersion(version))

    if (stdlibVersionSatisfies(tuple, parsed) && (resolved === undefined || compareStdlibVersions(tuple, resolved) > 0)) {
      resolved = tuple
    }
  }
  if (resolved === undefined) incompatibleVersion(identity)
  const record = /** @type {Readonly<StdlibContractModule>} */ (versions.get(`${resolved[0]}.${resolved[1]}.${resolved[2]}`))

  return deepFreeze({
    failures: record.failures,
    identity: record.identity,
    operations: record.operations,
    resources: record.resources,
    schema: /** @type {const} */ ("SemantifoldStdlibContract"),
    schemaVersion: /** @type {const} */ (1),
    version: `${resolved[0]}.${resolved[1]}.${resolved[2]}`
  })
}

/**
 * Lists the built-in canonical stdlib modules with their registered versions.
 * @returns {Readonly<{identity: string, versions: string[]}[]>} Frozen module list.
 */
export function listStdlibModules() {
  return builtinRegistry.modules
}

/**
 * Resolves one built-in canonical stdlib module by identity and optional range.
 * @param {string} identity - Canonical module identity.
 * @param {string} [range] - Declared version range.
 * @returns {StdlibContract} Detached frozen contract.
 */
export function resolveStdlibModule(identity, range) {
  return builtinRegistry.resolveModule(identity, range)
}

/**
 * Declares the built-in Task 034 resource-probe canonical contract.
 * @returns {unknown} Unvalidated built-in record.
 */
function builtinProbeContract() {
  return {
    failures: [
      {name: "ProbeOperationFailure"},
      {name: "ProbeAcquireFailure"},
      {name: "ProbeReadFailure"},
      {name: "ProbeCloseFailure"},
      {name: "ProbeResourceClosed"}
    ],
    identity: "semantifold.task034.resource-probe",
    operations: [
      {
        dependencies: [],
        effects: ["host"],
        evaluationOrder: "left-to-right",
        failures: ["ProbeOperationFailure"],
        name: "probeEffect",
        parameters: [{name: "label", type: "string"}, {name: "value", type: "integer"}, {name: "fail", type: "boolean"}],
        resourceFlow: {kind: "none"},
        returnType: "integer",
        semantics: canonicalSemantics()
      },
      {
        dependencies: [],
        effects: ["host"],
        evaluationOrder: "left-to-right",
        failures: ["ProbeAcquireFailure"],
        name: "probeAcquire",
        parameters: [{name: "fail", type: "boolean"}],
        resourceFlow: {kind: "acquire", resource: "ProbeResource"},
        returnType: "ProbeResource",
        semantics: canonicalSemantics({ownership: "acquired"})
      },
      {
        dependencies: [],
        effects: ["host"],
        evaluationOrder: "left-to-right",
        failures: ["ProbeReadFailure", "ProbeResourceClosed"],
        name: "probeRead",
        parameters: [{name: "resource", type: "ProbeResource"}, {name: "fail", type: "boolean"}],
        resourceFlow: {kind: "borrow", parameterIndex: 0, terminalFailure: "ProbeResourceClosed"},
        returnType: "optional:string",
        semantics: canonicalSemantics({
          close: "use-after-close-fails",
          eof: "absent-value",
          encoding: "utf-8",
          newline: "strip-line-terminator",
          ownership: "borrowed"
        })
      },
      {
        dependencies: [],
        effects: ["host"],
        evaluationOrder: "left-to-right",
        failures: ["ProbeCloseFailure", "ProbeResourceClosed"],
        name: "probeClose",
        parameters: [{name: "resource", type: "ProbeResource"}, {name: "fail", type: "boolean"}],
        resourceFlow: {kind: "close", parameterIndex: 0, terminalFailure: "ProbeResourceClosed"},
        returnType: "void",
        semantics: canonicalSemantics({close: "repeated-close-fails", ownership: "consumed"})
      },
      {
        dependencies: [],
        effects: ["host"],
        evaluationOrder: "left-to-right",
        failures: [],
        name: "probeTrace",
        parameters: [],
        resourceFlow: {kind: "none"},
        returnType: "string",
        semantics: canonicalSemantics()
      }
    ],
    resources: [{name: "ProbeResource"}],
    version: "1.0.0"
  }
}

/**
 * Builds one closed semantics declaration with canonical defaults.
 * @param {Partial<Record<keyof typeof semanticsValues, string>>} [overrides] - Non-default closed values.
 * @returns {Record<string, string>} Closed semantics fields.
 */
function canonicalSemantics(overrides = {}) {
  return {
    blocking: "synchronous",
    close: "not-applicable",
    eof: "not-applicable",
    encoding: "not-applicable",
    newline: "not-applicable",
    ownership: "not-applicable",
    timeout: "none",
    ...overrides
  }
}

/**
 * Validates one canonical contract record and returns a detached clone.
 * @param {unknown} candidate - Candidate record.
 * @returns {StdlibContractModule} Detached record.
 */
function validateContractRecord(candidate) {
  if (!isPlainObject(candidate)) invalidContract("Every canonical contract record must be a plain object.")
  requireKeys(candidate, ["failures", "identity", "operations", "resources", "version"], "contract record")
  const identity = /** @type {string} */ (candidate.identity)

  if (typeof identity != "string" || !identityPattern.test(identity)) invalidContract("Canonical contract identity is invalid.")
  const version = /** @type {string} */ (candidate.version)

  if (parseStdlibVersion(version) === null) invalidContract(`Canonical contract version '${String(version)}' is invalid.`)
  const resources = validateNamedList(candidate.resources, "resource")
  const failures = validateNamedList(candidate.failures, "failure")
  const resourceNames = new Set(resources.map(({name}) => name))
  const failureNames = new Set(failures.map(({name}) => name))
  const operationNames = new Set()
  const operations = /** @type {unknown[]} */ (candidate.operations).map((operation) =>
    validateContractOperation(operation, resourceNames, failureNames, operationNames))

  return deepFreeze({
    failures,
    identity,
    operations,
    resources,
    version: /** @type {string} */ (version)
  })
}

/**
 * Validates one canonical contract operation.
 * @param {unknown} candidate - Candidate operation.
 * @param {Set<string>} resourceNames - Declared resource names.
 * @param {Set<string>} failureNames - Declared failure names.
 * @param {Set<string>} operationNames - Already-declared operation names.
 * @returns {StdlibContractOperation} Detached operation.
 */
function validateContractOperation(candidate, resourceNames, failureNames, operationNames) {
  if (!isPlainObject(candidate)) invalidContract("Every canonical contract operation must be a plain object.")
  requireKeys(candidate, ["dependencies", "effects", "evaluationOrder", "failures", "name", "parameters", "resourceFlow", "returnType", "semantics"], "contract operation")
  const name = /** @type {string} */ (candidate.name)

  if (typeof name != "string" || !declarationNamePattern.test(name) || operationNames.has(name)) {
    invalidContract("Canonical contract operation name is invalid or duplicate.")
  }
  operationNames.add(name)
  if (!isDenseArray(candidate.effects) || candidate.effects.length != 1 || candidate.effects[0] != "host") {
    invalidContract(`Operation '${name}' requires the single host effect declaration.`)
  }
  if (candidate.evaluationOrder != "left-to-right") invalidContract(`Operation '${name}' requires left-to-right evaluation.`)
  if (!isDenseArray(candidate.failures) || !candidate.failures.every((failure) =>
    typeof failure == "string" && failureNames.has(failure)) || new Set(candidate.failures).size != candidate.failures.length) {
    invalidContract(`Operation '${name}' declares unknown or duplicate failures.`)
  }
  const failures = /** @type {string[]} */ (candidate.failures)
  const parameterNames = new Set()
  /** @type {{name: string, type: string}[]} */
  const parameters = []

  for (const parameter of /** @type {unknown[]} */ (candidate.parameters)) {
    if (!isPlainObject(parameter)) invalidContract(`Operation '${name}' parameters must be plain objects.`)
    requireKeys(parameter, ["name", "type"], `operation '${name}' parameter`)
    const parameterName = /** @type {string} */ (parameter.name)

    if (typeof parameterName != "string" || !declarationNamePattern.test(parameterName) || parameterNames.has(parameterName)) {
      invalidContract(`Operation '${name}' parameter name is invalid or duplicate.`)
    }
    parameterNames.add(parameterName)
    const parameterType = /** @type {string} */ (parameter.type)

    if (!isCanonicalValueType(parameterType, resourceNames, `operation '${name}' parameter '${parameterName}'`)) {
      invalidContract(`Operation '${name}' parameter '${parameterName}' type is outside the closed canonical value set.`)
    }
    parameters.push({name: parameterName, type: parameterType})
  }
  const returnType = /** @type {string} */ (candidate.returnType)

  if (!isCanonicalValueType(returnType, resourceNames, `operation '${name}' return type`, true)) {
    invalidContract(`Operation '${name}' return type is outside the closed canonical value set.`)
  }
  const resourceFlow = validateContractResourceFlow(candidate.resourceFlow, parameters, failures, name)
  const dependencies = validateOperationDependencies(candidate.dependencies)
  const semantics = validateContractSemantics(candidate.semantics, name)

  return deepFreeze({
    dependencies,
    effects: /** @type {const} */ (["host"]),
    evaluationOrder: /** @type {const} */ ("left-to-right"),
    failures,
    name,
    parameters,
    resourceFlow,
    returnType,
    semantics
  })
}

/**
 * Validates one closed canonical value type spelling.
 * @param {unknown} candidate - Candidate type.
 * @param {Set<string>} resourceNames - Declared resource names.
 * @param {string} subject - Diagnostic subject.
 * @param {boolean} [allowVoid] - Whether void is admitted.
 * @returns {boolean} Whether the type is closed and declared.
 */
function isCanonicalValueType(candidate, resourceNames, subject, allowVoid = false) {
  if (typeof candidate != "string") return false
  if (allowVoid && candidate == "void") return true
  if (scalarNames.has(candidate)) return true
  if (resourceNames.has(candidate)) return true
  const optional = /^optional:([a-z]+)$/u.exec(candidate)

  if (optional) return scalarNames.has(optional[1])
  return false
}

/**
 * Validates one closed resource transition against its parameters and failures.
 * @param {unknown} candidate - Candidate transition.
 * @param {{name: string, type: string}[]} parameters - Validated parameters.
 * @param {string[]} failures - Validated failure names.
 * @param {string} operation - Operation name.
 * @returns {object} Detached transition.
 */
function validateContractResourceFlow(candidate, parameters, failures, operation) {
  if (!isPlainObject(candidate)) invalidContract(`Operation '${operation}' requires a resource flow declaration.`)
  const ownedParameters = parameters.map((parameter, index) => scalarNames.has(parameter.type) ? -1 :
    parameter.type.startsWith("optional:") ? -1 : [index]).flat().filter((index) => index >= 0)

  if (Object.keys(candidate).sort().join(",") == "kind" && candidate.kind == "none") {
    if (ownedParameters.length > 0) invalidContract(`Operation '${operation}' owns a parameter without a transition.`)
    return deepFreeze({kind: /** @type {const} */ ("none")})
  }
  if (Object.keys(candidate).sort().join(",") == "kind,resource" && candidate.kind == "acquire") {
    if (typeof candidate.resource != "string" || ownedParameters.length > 0) {
      invalidContract(`Operation '${operation}' acquisition flow is incomplete.`)
    }
    return deepFreeze({kind: /** @type {const} */ ("acquire"), resource: /** @type {string} */ (candidate.resource)})
  }
  if (["borrow", "close"].includes(String(candidate.kind)) &&
    Object.keys(candidate).sort().join(",") == "kind,parameterIndex,terminalFailure") {
    const parameterIndex = /** @type {number} */ (candidate.parameterIndex)

    if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0 || parameterIndex >= parameters.length ||
      ownedParameters.length != 1 || ownedParameters[0] != parameterIndex ||
      typeof candidate.terminalFailure != "string" || !failures.includes(candidate.terminalFailure)) {
      invalidContract(`Operation '${operation}' ${String(candidate.kind)} flow is incomplete.`)
    }
    return deepFreeze({kind: /** @type {"borrow" | "close"} */ (candidate.kind), parameterIndex,
      terminalFailure: /** @type {string} */ (candidate.terminalFailure)})
  }
  return invalidContract(`Operation '${operation}' declares an unknown resource flow.`)
}

/**
 * Validates one canonical operation dependency list.
 * @param {unknown} candidate - Candidate dependencies.
 * @returns {{module: string, operation: string, range: VersionRange}[]} Detached dependencies.
 */
function validateOperationDependencies(candidate) {
  if (!isDenseArray(candidate)) invalidContract("Canonical contract dependencies must be a dense array.")
  /** @type {{module: string, operation: string, range: VersionRange}[]} */
  const dependencies = []

  for (const dependency of candidate) {
    if (!isPlainObject(dependency)) invalidContract("Every canonical contract dependency must be a plain object.")
    requireKeys(dependency, ["module", "operation", "range"], "contract dependency")
    const module = /** @type {string} */ (dependency.module)
    const operation = /** @type {string} */ (dependency.operation)
    const range = parseStdlibVersionRange(dependency.range)

    if (typeof module != "string" || !identityPattern.test(module) ||
      typeof operation != "string" || !declarationNamePattern.test(operation) || range === null) {
      invalidContract("Canonical contract dependency module, operation, or range is invalid.")
    }
    dependencies.push({module, operation, range})
  }
  return dependencies
}

/**
 * Validates canonical operation dependencies against the complete registry identity set.
 * @param {StdlibContractModule} record - Validated record.
 * @param {Set<string>} identities - All registered module identities.
 * @returns {void}
 */
function validateContractDependencies(record, identities) {
  for (const operation of record.operations) {
    for (const dependency of operation.dependencies) {
      if (!identities.has(dependency.module)) {
        invalidContract(`Operation '${operation.name}' depends on unknown canonical module '${dependency.module}'.`)
      }
      if (dependency.module == record.identity && dependency.operation == operation.name) {
        invalidContract(`Operation '${operation.name}' declares a self-cycle dependency.`)
      }
    }
  }
}

/**
 * Validates one closed semantics declaration.
 * @param {unknown} candidate - Candidate semantics.
 * @param {string} operation - Operation name.
 * @returns {Record<string, string>} Closed semantics fields.
 */
function validateContractSemantics(candidate, operation) {
  if (!isPlainObject(candidate) || Object.keys(candidate).sort().join(",") !=
    "blocking,close,encoding,eof,newline,ownership,timeout") {
    invalidContract(`Operation '${operation}' requires the closed canonical semantics fields.`)
  }
  /** @type {Record<string, string>} */
  const semantics = {}

  for (const [field, allowed] of Object.entries(semanticsValues)) {
    const value = /** @type {string} */ (candidate[field])

    if (typeof value != "string" || !allowed.has(value)) {
      invalidContract(`Operation '${operation}' declares a non-canonical '${field}' semantics value.`)
    }
    semantics[field] = value
  }
  return deepFreeze(semantics)
}

/**
 * Validates one dense ordered single-field named declaration list.
 * @param {unknown} candidate - Candidate list.
 * @param {string} subject - Diagnostic subject.
 * @returns {{name: string}[]} Detached declarations.
 */
function validateNamedList(candidate, subject) {
  if (!isDenseArray(candidate)) invalidContract(`Canonical contract ${subject}s must be a dense array.`)
  const names = new Set()
  /** @type {{name: string}[]} */
  const declarations = []

  for (const declaration of candidate) {
    if (!isPlainObject(declaration) || Object.keys(declaration).join(",") != "name" ||
      typeof declaration.name != "string" || !declarationNamePattern.test(declaration.name) || names.has(declaration.name)) {
      invalidContract(`Canonical contract ${subject} declarations must be uniquely named.`)
    }
    names.add(/** @type {string} */ (declaration.name))
    declarations.push({name: /** @type {string} */ (declaration.name)})
  }
  return declarations
}

/**
 * Reports an unknown canonical module identity.
 * @param {string} identity - Unknown identity.
 * @returns {never} Always throws.
 */
function unknownModule(identity) {
  throw new SemantifoldDiagnostic({code: "STDLIB_MODULE_UNKNOWN", language: "stdlib",
    message: `Standard-library module '${identity}' is not a registered canonical contract.`})
}

/**
 * Reports one malformed version range.
 * @returns {never} Always throws.
 */
function malformedRange() {
  throw new SemantifoldDiagnostic({code: "STDLIB_VERSION_MALFORMED", language: "stdlib",
    message: "Standard-library version ranges use X, X.Y, or X.Y.Z without leading zeros or prerelease labels."})
}

/**
 * Reports one unsatisfiable version range.
 * @param {string} identity - Constrained module identity.
 * @returns {never} Always throws.
 */
function incompatibleVersion(identity) {
  throw new SemantifoldDiagnostic({code: "STDLIB_VERSION_INCOMPATIBLE", language: "stdlib",
    message: `No registered version of '${identity}' satisfies the declared standard-library version range.`})
}

/**
 * Raises one stable canonical contract diagnostic.
 * @param {string} message - Diagnostic message.
 * @returns {never} Always throws.
 */
function invalidContract(message) {
  throw new SemantifoldDiagnostic({code: "STDLIB_CONTRACT_INVALID", language: "stdlib", message})
}

/**
 * Requires one exact field set.
 * @param {Record<string, unknown>} value - Candidate object.
 * @param {string[]} keys - Required keys.
 * @param {string} subject - Diagnostic subject.
 * @returns {void}
 */
function requireKeys(value, keys, subject) {
  if (Object.keys(value).sort().join(",") != [...keys].sort().join(",")) invalidContract(`Invalid ${subject} fields.`)
}

/**
 * Checks an ordered dense array.
 * @param {unknown} value - Candidate array.
 * @returns {value is unknown[]} Whether the value is dense.
 */
function isDenseArray(value) {
  return Array.isArray(value) && value.every((_item, index) => Object.hasOwn(value, index))
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return value !== null && typeof value == "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Recursively freezes a detached value.
 * @template {object} Value
 * @param {Value} value - Object to freeze.
 * @returns {Readonly<Value>} Frozen object.
 */
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child == "object" && !Object.isFrozen(child)) deepFreeze(child)
  }
  return Object.freeze(value)
}

/** @type {Readonly<StdlibContractRegistry>} */
const builtinRegistry = createStdlibContractRegistry()
