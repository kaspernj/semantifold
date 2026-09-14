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
  newline: new Set(["not-applicable", "strip-line-terminator", "retain-line-terminator", "append-lf-if-missing"]),
  ownership: new Set(["not-applicable", "acquired", "borrowed", "consumed"]),
  timeout: new Set(["none"])
}

/** @typedef {[number, number, number]} VersionTuple */
/** @typedef {{lower: VersionTuple, upper: VersionTuple | null}} VersionRange */
/** @typedef {{module: string, name: string}} CanonicalDeclarationReference */
/**
 * @typedef StdlibContractOperation
 * @property {{module: string, operation: string, range: VersionRange}[]} dependencies - Canonical operation dependencies.
 * @property {["host"]} effects - Closed effect declaration.
 * @property {"left-to-right"} evaluationOrder - Canonical argument evaluation order.
 * @property {(string | CanonicalDeclarationReference)[]} failures - Declared failure names.
 * @property {string} name - Operation name.
 * @property {{name: string, type: string | CanonicalDeclarationReference}[]} parameters - Ordered parameters.
 * @property {object} resourceFlow - Closed resource transition.
 * @property {string | CanonicalDeclarationReference} returnType - Closed return type spelling.
 * @property {Record<string, string>} semantics - Closed canonical semantics fields.
 */
/**
 * @typedef StdlibContractModule
 * @property {{module: string, range: VersionRange}[]} dependencies - Versioned declaration dependencies.
 * @property {{name: string}[]} failures - Ordered failure declarations.
 * @property {string} identity - Canonical module identity.
 * @property {StdlibContractOperation[]} operations - Ordered operation declarations.
 * @property {{name: string}[]} resources - Ordered resource declarations.
 * @property {string} version - Exact registered version.
 */
/**
 * @typedef StdlibContract
 * @property {{module: string, range: VersionRange}[]} dependencies - Versioned declaration dependencies.
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
 * @param {string} module - Legacy operation name or canonical module identity.
 * @param {string} [operation] - Qualified canonical operation name.
 * @returns {string} Protected native entry name.
 */
export function protectedEntryName(target, module, operation) {
  if (typeof target != "string" || !/^[a-z][a-z0-9-]*$/u.test(target) ||
    typeof module != "string" || (operation !== undefined && (typeof operation != "string" ||
      !declarationNamePattern.test(operation)))) invalidContract("Protected provider entry components are invalid.")
  if (operation === undefined) {
    if (!declarationNamePattern.test(module)) invalidContract("Protected provider operation name is invalid.")
    return `__semantifold_provider_${target}_${module}`
  }
  if (!identityPattern.test(module)) invalidContract("Protected provider module identity is invalid.")
  const encodedModule = [...module].map((character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("")

  return `__semantifold_provider_${target}_m${encodedModule.length}_${encodedModule}_${operation}`
}

/**
 * Parses one protected native provider entry name.
 * @param {string} name - Candidate protected entry name.
 * @returns {{target: string, module?: string, operation: string} | null} Parsed binding or null when unparseable.
 */
export function parseProtectedEntryName(name) {
  const qualified = /^__semantifold_provider_([a-z][a-z0-9-]*)_m([0-9]+)_([0-9a-f]+)_([A-Za-z_][A-Za-z0-9_]*)$/u.exec(name)

  if (qualified) {
    const encodedLength = Number(qualified[2])
    const encoded = qualified[3]

    if (!Number.isSafeInteger(encodedLength) || encodedLength != encoded.length || encoded.length % 2 != 0) return null
    let module = ""

    for (let index = 0; index < encoded.length; index += 2) module += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16))
    if (!identityPattern.test(module) || protectedEntryName(qualified[1], module, qualified[4]) != name) return null
    return {module, operation: qualified[4], target: qualified[1]}
  }
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
export function createStdlibContractRegistry(records = builtinContracts()) {
  if (!isDenseArray(records)) invalidContract("Canonical contract records must be an ordered dense array.")

  /** @type {Map<string, Map<string, StdlibContractModule>>} */
  const modules = new Map()

  for (const candidate of records) {
    const record = validateContractRecord(candidate)
    const versions = modules.get(record.identity) ?? new Map()

    if (versions.has(record.version)) invalidContract(`Duplicate canonical contract '${record.identity}' version '${record.version}'.`)
    versions.set(record.version, record)
    modules.set(record.identity, versions)
  }
  for (const record of modules.values()) {
    for (const module of record.values()) validateContractDependencies(module, modules)
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
    dependencies: record.dependencies,
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
    dependencies: [],
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
 * Declares the complete built-in canonical registry input.
 * @returns {unknown[]} Unvalidated built-in records.
 */
function builtinContracts() {
  return [builtinProbeContract(), builtinSocketClientContract(), builtinTextStreamContract(),
    builtinOutputContract(), builtinResourceContract()]
}

/**
 * Declares the built-in SocketClient v1 contract.
 * @returns {unknown} Unvalidated SocketClient v1 record.
 */
function builtinSocketClientContract() {
  const byteStream = {module: "semantifold.resource", name: "ByteStream"}

  return {
    dependencies: [{module: "semantifold.resource", range: "1"}],
    failures: [{name: "InvalidHost"}, {name: "InvalidPort"}, {name: "ConnectionFailure"}],
    identity: "semantifold.socket-client",
    operations: [{
      dependencies: [], effects: ["host"], evaluationOrder: "left-to-right",
      failures: ["InvalidHost", "InvalidPort", "ConnectionFailure"], name: "v1_connect",
      parameters: [{name: "host", type: "string"}, {name: "port", type: "integer"}],
      resourceFlow: {kind: "acquire", resource: byteStream}, returnType: byteStream,
      semantics: canonicalSemantics({ownership: "acquired"})
    }],
    resources: [],
    version: "1.0.0"
  }
}

/**
 * Declares the built-in TextStream v1 contract.
 * @returns {unknown} Unvalidated TextStream v1 record.
 */
function builtinTextStreamContract() {
  const byteStream = {module: "semantifold.resource", name: "ByteStream"}
  const resourceClosed = {module: "semantifold.resource", name: "ResourceClosed"}

  return {
    dependencies: [{module: "semantifold.resource", range: "1"}],
    failures: [{name: "ReadFailure"}, {name: "DecodeFailure"}],
    identity: "semantifold.text-stream",
    operations: [{
      dependencies: [], effects: ["host"], evaluationOrder: "left-to-right",
      failures: ["ReadFailure", "DecodeFailure", resourceClosed], name: "v1_read_line",
      parameters: [{name: "resource", type: byteStream}],
      resourceFlow: {kind: "borrow", parameterIndex: 0, terminalFailure: resourceClosed},
      returnType: "optional:string",
      semantics: canonicalSemantics({close: "use-after-close-fails", eof: "absent-value", encoding: "utf-8",
        newline: "retain-line-terminator", ownership: "borrowed"})
    }],
    resources: [],
    version: "1.0.0"
  }
}

/**
 * Declares the built-in Output v1 contract.
 * @returns {unknown} Unvalidated Output v1 record.
 */
function builtinOutputContract() {
  return {
    dependencies: [], failures: [{name: "WriteFailure"}], identity: "semantifold.output",
    operations: [{
      dependencies: [], effects: ["host"], evaluationOrder: "left-to-right", failures: ["WriteFailure"],
      name: "v1_write_line", parameters: [{name: "text", type: "string"}], resourceFlow: {kind: "none"},
      returnType: "void", semantics: canonicalSemantics({encoding: "utf-8", newline: "append-lf-if-missing"})
    }],
    resources: [], version: "1.0.0"
  }
}

/**
 * Declares the built-in Resource v1 contract.
 * @returns {unknown} Unvalidated Resource v1 record.
 */
function builtinResourceContract() {
  return {
    dependencies: [], failures: [{name: "CloseFailure"}, {name: "ResourceClosed"}], identity: "semantifold.resource",
    operations: [{
      dependencies: [], effects: ["host"], evaluationOrder: "left-to-right",
      failures: ["CloseFailure", "ResourceClosed"], name: "v1_close",
      parameters: [{name: "resource", type: "ByteStream"}],
      resourceFlow: {kind: "close", parameterIndex: 0, terminalFailure: "ResourceClosed"}, returnType: "void",
      semantics: canonicalSemantics({close: "repeated-close-fails", ownership: "consumed"})
    }],
    resources: [{name: "ByteStream"}], version: "1.0.0"
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
  requireKeys(candidate, ["dependencies", "failures", "identity", "operations", "resources", "version"], "contract record")
  const identity = /** @type {string} */ (candidate.identity)

  if (typeof identity != "string" || !identityPattern.test(identity)) invalidContract("Canonical contract identity is invalid.")
  const version = /** @type {string} */ (candidate.version)

  if (parseStdlibVersion(version) === null) invalidContract(`Canonical contract version '${String(version)}' is invalid.`)
  const resources = validateNamedList(candidate.resources, "resource")
  const failures = validateNamedList(candidate.failures, "failure")
  const resourceNames = new Set(resources.map(({name}) => name))
  const failureNames = new Set(failures.map(({name}) => name))
  const operationNames = new Set()
  const dependencies = validateModuleDependencies(candidate.dependencies, identity)

  if (!isDenseArray(candidate.operations)) invalidContract("Canonical contract operations must be a dense array.")
  const operations = /** @type {unknown[]} */ (candidate.operations).map((operation) =>
    validateContractOperation(operation, resourceNames, failureNames, operationNames))

  return deepFreeze({
    dependencies,
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
  if (!isDenseArray(candidate.failures)) {
    invalidContract(`Operation '${name}' declares unknown or duplicate failures.`)
  }
  const failures = candidate.failures.map((failure) => normalizeDeclarationReference(failure, failureNames, `Operation '${name}' failure`))
  if (new Set(failures.map(referenceKey)).size != failures.length) invalidContract(`Operation '${name}' repeats a declared failure.`)
  const parameterNames = new Set()
  /** @type {{name: string, type: string | CanonicalDeclarationReference}[]} */
  const parameters = []

  if (!isDenseArray(candidate.parameters)) invalidContract(`Operation '${name}' parameters must be a dense array.`)
  for (const parameter of /** @type {unknown[]} */ (candidate.parameters)) {
    if (!isPlainObject(parameter)) invalidContract(`Operation '${name}' parameters must be plain objects.`)
    requireKeys(parameter, ["name", "type"], `operation '${name}' parameter`)
    const parameterName = /** @type {string} */ (parameter.name)

    if (typeof parameterName != "string" || !declarationNamePattern.test(parameterName) || parameterNames.has(parameterName)) {
      invalidContract(`Operation '${name}' parameter name is invalid or duplicate.`)
    }
    parameterNames.add(parameterName)
    const parameterType = normalizeCanonicalValueType(parameter.type, resourceNames, `operation '${name}' parameter '${parameterName}'`)

    if (parameterType === null) {
      invalidContract(`Operation '${name}' parameter '${parameterName}' type is outside the closed canonical value set.`)
    }
    parameters.push({name: parameterName, type: parameterType})
  }
  const returnType = candidate.returnType == "void" ? "void" : normalizeCanonicalValueType(candidate.returnType, resourceNames, `operation '${name}' return type`)

  if (returnType === null) {
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
 * @param {string} _subject - Diagnostic subject reserved for caller context.
 * @returns {string | CanonicalDeclarationReference | null} Detached type or null.
 */
function normalizeCanonicalValueType(candidate, resourceNames, _subject) {
  if (typeof candidate == "string") {
    if (scalarNames.has(candidate) || resourceNames.has(candidate)) return candidate
    const optional = /^optional:([a-z]+)$/u.exec(candidate)

    return optional && scalarNames.has(optional[1]) ? candidate : null
  }
  if (isPlainObject(candidate) && Object.keys(candidate).sort().join(",") == "module,name" &&
    typeof candidate.module == "string" && identityPattern.test(candidate.module) && typeof candidate.name == "string" &&
    declarationNamePattern.test(candidate.name)) return {module: candidate.module, name: candidate.name}
  return null
}

/**
 * Validates one closed resource transition against its parameters and failures.
 * @param {unknown} candidate - Candidate transition.
 * @param {{name: string, type: string | CanonicalDeclarationReference}[]} parameters - Validated parameters.
 * @param {(string | CanonicalDeclarationReference)[]} failures - Validated failure names.
 * @param {string} operation - Operation name.
 * @returns {object} Detached transition.
 */
function validateContractResourceFlow(candidate, parameters, failures, operation) {
  if (!isPlainObject(candidate)) invalidContract(`Operation '${operation}' requires a resource flow declaration.`)
  const ownedParameters = parameters.flatMap((parameter, index) => isOwnedCanonicalType(parameter.type) ? [index] : [])

  if (Object.keys(candidate).sort().join(",") == "kind" && candidate.kind == "none") {
    if (ownedParameters.length > 0) invalidContract(`Operation '${operation}' owns a parameter without a transition.`)
    return deepFreeze({kind: /** @type {const} */ ("none")})
  }
  if (Object.keys(candidate).sort().join(",") == "kind,resource" && candidate.kind == "acquire") {
    const resource = typeof candidate.resource == "string" && declarationNamePattern.test(candidate.resource)
      ? candidate.resource
      : normalizeCanonicalValueType(candidate.resource, new Set(), `operation '${operation}' acquisition`)
    if (resource === null || ownedParameters.length > 0) {
      invalidContract(`Operation '${operation}' acquisition flow is incomplete.`)
    }
    return deepFreeze({kind: /** @type {const} */ ("acquire"), resource})
  }
  if (["borrow", "close"].includes(String(candidate.kind)) &&
    Object.keys(candidate).sort().join(",") == "kind,parameterIndex,terminalFailure") {
    const parameterIndex = /** @type {number} */ (candidate.parameterIndex)

    if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0 || parameterIndex >= parameters.length ||
      ownedParameters.length != 1 || ownedParameters[0] != parameterIndex ||
      !failures.some((failure) => referenceKey(failure) == referenceKey(candidate.terminalFailure))) {
      invalidContract(`Operation '${operation}' ${String(candidate.kind)} flow is incomplete.`)
    }
    return deepFreeze({kind: /** @type {"borrow" | "close"} */ (candidate.kind), parameterIndex,
      terminalFailure: normalizeFailureFlowReference(candidate.terminalFailure)})
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
 * @param {Map<string, Map<string, StdlibContractModule>>} modules - All registered module versions.
 * @returns {void}
 */
function validateContractDependencies(record, modules) {
  const allowedDependencies = new Map(record.dependencies.map((dependency) => [dependency.module, dependency.range]))

  for (const dependency of record.dependencies) {
    const versions = modules.get(dependency.module)

    if (!versions || ![...versions.keys()].some((version) => stdlibVersionSatisfies(/** @type {VersionTuple} */ (parseStdlibVersion(version)), dependency.range))) {
      invalidContract(`Canonical module '${record.identity}' depends on missing or incompatible module '${dependency.module}'.`)
    }
  }
  for (const operation of record.operations) {
    for (const reference of operation.parameters.map(({type}) => type).concat([operation.returnType]).filter(isDeclarationReference)) {
      validateForeignDeclarationReference(record, reference, "resource", allowedDependencies, modules)
    }
    for (const reference of operation.failures.filter(isDeclarationReference)) {
      validateForeignDeclarationReference(record, reference, "failure", allowedDependencies, modules)
    }
    for (const dependency of operation.dependencies) {
      if (!modules.has(dependency.module)) {
        invalidContract(`Operation '${operation.name}' depends on unknown canonical module '${dependency.module}'.`)
      }
      if (dependency.module == record.identity && dependency.operation == operation.name) {
        invalidContract(`Operation '${operation.name}' declares a self-cycle dependency.`)
      }
    }
  }
}

/**
 * Validates declaration-only module dependencies.
 * @param {unknown} candidate - Candidate dependency list.
 * @param {string} identity - Owning module identity.
 * @returns {{module: string, range: VersionRange}[]} Detached dependencies.
 */
function validateModuleDependencies(candidate, identity) {
  if (!isDenseArray(candidate)) invalidContract("Canonical module dependencies must be a dense array.")
  const names = new Set()

  return candidate.map((dependency) => {
    if (!isPlainObject(dependency)) invalidContract("Every canonical module dependency must be a plain object.")
    requireKeys(dependency, ["module", "range"], "module dependency")
    const module = /** @type {string} */ (dependency.module)
    const range = parseStdlibVersionRange(dependency.range)

    if (typeof module != "string" || !identityPattern.test(module) || module == identity || names.has(module) || range === null) {
      invalidContract("Canonical module dependency is invalid, duplicate, self-referential, or malformed.")
    }
    names.add(module)
    return {module, range}
  })
}

/**
 * Validates one dependency-qualified resource or failure reference.
 * @param {StdlibContractModule} record - Owning module.
 * @param {CanonicalDeclarationReference} reference - Qualified declaration.
 * @param {"resource" | "failure"} kind - Declaration kind.
 * @param {Map<string, VersionRange>} allowedDependencies - Direct dependency ranges.
 * @param {Map<string, Map<string, StdlibContractModule>>} modules - Registry modules.
 * @returns {void}
 */
function validateForeignDeclarationReference(record, reference, kind, allowedDependencies, modules) {
  const range = allowedDependencies.get(reference.module)

  if (!range) invalidContract(`Canonical module '${record.identity}' uses undeclared dependency '${reference.module}'.`)
  const versions = /** @type {Map<string, StdlibContractModule>} */ (modules.get(reference.module))
  const matches = [...versions.values()].filter((module) =>
    stdlibVersionSatisfies(/** @type {VersionTuple} */ (parseStdlibVersion(module.version)), range))
  const declarations = kind == "resource" ? matches.flatMap(({resources}) => resources) : matches.flatMap(({failures}) => failures)

  if (!declarations.some(({name}) => name == reference.name)) {
    invalidContract(`Canonical ${kind} '${reference.module}.${reference.name}' is not declared by a compatible dependency.`)
  }
}

/**
 * Normalizes one local or dependency-qualified declaration reference.
 * @param {unknown} candidate - Candidate reference.
 * @param {Set<string>} localNames - Declared local names.
 * @param {string} subject - Diagnostic subject.
 * @returns {string | CanonicalDeclarationReference} Detached reference.
 */
function normalizeDeclarationReference(candidate, localNames, subject) {
  if (typeof candidate == "string" && localNames.has(candidate)) return candidate
  if (isDeclarationReference(candidate)) return {module: candidate.module, name: candidate.name}
  return invalidContract(`${subject} is not a declared local or qualified canonical declaration.`)
}

/**
 * Normalizes a terminal failure reference after membership validation.
 * @param {unknown} candidate - Candidate failure reference.
 * @returns {string | CanonicalDeclarationReference} Detached reference.
 */
function normalizeFailureFlowReference(candidate) {
  if (typeof candidate == "string") return candidate
  if (isDeclarationReference(candidate)) return {module: candidate.module, name: candidate.name}
  return invalidContract("Resource flow terminal failure is invalid.")
}

/**
 * Checks one canonical qualified declaration reference.
 * @param {unknown} candidate - Candidate reference.
 * @returns {candidate is CanonicalDeclarationReference} Whether the reference is exact.
 */
function isDeclarationReference(candidate) {
  return isPlainObject(candidate) && Object.keys(candidate).sort().join(",") == "module,name" &&
    typeof candidate.module == "string" && identityPattern.test(candidate.module) &&
    typeof candidate.name == "string" && declarationNamePattern.test(candidate.name)
}

/**
 * Encodes one declaration reference for equality checks.
 * @param {unknown} candidate - Local or qualified reference.
 * @returns {string} Stable equality key.
 */
function referenceKey(candidate) {
  return typeof candidate == "string" ? `local:${candidate}` : isDeclarationReference(candidate)
    ? `${candidate.module}:${candidate.name}` : `invalid:${String(candidate)}`
}

/**
 * Reports whether a canonical type denotes an owned resource.
 * @param {string | CanonicalDeclarationReference} candidate - Canonical type.
 * @returns {boolean} Whether the type is owned.
 */
function isOwnedCanonicalType(candidate) {
  return isDeclarationReference(candidate) || (typeof candidate == "string" && !scalarNames.has(candidate) &&
    !candidate.startsWith("optional:") && candidate != "void")
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
