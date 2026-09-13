// @ts-check

import {isDenseArray} from "./array.js"
import {isSafeArtifactPath} from "./artifact-path.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {
  compareStdlibVersions, parseStdlibVersion, parseStdlibVersionRange, resolveStdlibModule, stdlibVersionSatisfies
} from "./semantic/stdlib.js"

const facadeIdentityPattern = /^[a-z][a-z0-9.-]*$/u
const moduleIdPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z][a-z0-9_]*)*$/u
const declarationNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u
const supportedLanguages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const canonicalTypes = new Set(["boolean", "integer", "string", "void"])

/**
 * @typedef StdlibFacadePublicDeclaration
 * @property {"function"} kind - Closed public declaration kind.
 * @property {string} name - Exact source-visible symbol.
 * @property {{name: string, type: string}[]} parameters - Ordered source signature.
 * @property {string} returnType - Canonical result type.
 * @property {string[]} effects - Closed public effects.
 * @property {string[]} failures - Escaping canonical failure names.
 * @property {["direct-call"]} forms - Accepted source call form.
 * @property {"not-applicable"} ownership - Initial scalar qualification ownership.
 */
/**
 * @typedef StdlibFacadeRecord
 * @property {{identity: string, range: string}[]} dependencies - Facade-module dependencies.
 * @property {string} identity - Versioned facade identity.
 * @property {import("./semantic/types.js").SemanticLanguage} language - Source language.
 * @property {{identity: string, symbols: string[]}[]} nativeModules - Exact source native identities.
 * @property {StdlibFacadePublicDeclaration[]} publicDeclarations - Public source surface.
 * @property {{module: string, operations: string[], range: string}[]} requirements - Canonical-only requirements.
 * @property {string} runtimeProfile - Exact compatible source/runtime profile.
 * @property {{content: string, filename: string, id: string}} source - Executable compiler-owned source module.
 * @property {string} version - Exact facade version.
 * @property {"internal" | "public"} visibility - Native-selectable visibility.
 */
/**
 * @typedef FacadeSourceNames
 * @property {string} extension - Source filename extension.
 * @property {string} nativeModule - Public native stdlib module identity.
 * @property {string} publicName - Public native symbol.
 * @property {string} unusedName - Unused-elimination fixture symbol.
 * @property {string} unusedNativeModule - Unused-elimination fixture module.
 * @property {string} probeSource - Public executable facade source.
 * @property {string} runnerSource - Internal canonical runner source.
 * @property {string} unusedSource - Unused executable facade source.
 */
/**
 * @typedef StdlibFacadeRegistry
 * @property {readonly StdlibFacadeRecord[]} facades - Stable immutable facade records.
 * @property {(language: string, nativeModule: string, symbol: string, range?: string) => StdlibFacadeRecord} resolveFacade - Exact native identity resolver.
 * @property {(identity: string, language: string, range?: string) => StdlibFacadeRecord} resolveIdentity - Facade dependency resolver.
 * @property {(language: string, nativeModule: string, range?: string) => StdlibFacadeRecord} resolveModule - Exact native module resolver.
 */

/**
 * Creates a detached immutable source-language facade registry.
 * @param {unknown} records - Optional facade definitions; built-in qualification definitions by default.
 * @returns {Readonly<StdlibFacadeRegistry>} Validated facade registry.
 */
export function createStdlibFacadeRegistry(records = builtinFacadeRecords()) {
  if (!isDenseArray(records)) invalidFacade("Facade records must be an ordered dense array.")
  /** @type {StdlibFacadeRecord[]} */
  const facades = []
  /** @type {Map<string, Map<string, StdlibFacadeRecord>>} */
  const byIdentity = new Map()
  /** @type {Map<string, StdlibFacadeRecord[]>} */
  const byNativeModule = new Map()
  const sourceIds = new Map()
  const sourceFilenames = new Map()

  for (let index = 0; index < records.length; index += 1) {
    const record = validateFacadeRecord(records[index])
    const identityKey = `${record.language}\0${record.identity}`
    const versions = byIdentity.get(identityKey) ?? new Map()

    if (versions.has(record.version)) invalidFacade(`Duplicate facade '${record.identity}' version '${record.version}' for '${record.language}'.`)
    if (sourceIds.has(record.source.id) && sourceIds.get(record.source.id) != identityKey) {
      invalidFacade(`Duplicate facade source module identity '${record.source.id}'.`)
    }
    if (sourceFilenames.has(record.source.filename) && sourceFilenames.get(record.source.filename) != identityKey) {
      invalidFacade(`Duplicate facade source filename '${record.source.filename}'.`)
    }
    versions.set(record.version, record)
    byIdentity.set(identityKey, versions)
    sourceIds.set(record.source.id, identityKey)
    sourceFilenames.set(record.source.filename, identityKey)
    facades.push(record)

    for (const nativeModule of record.nativeModules) {
      const nativeKey = `${record.language}\0${nativeModule.identity}`
      const nativeRecords = byNativeModule.get(nativeKey) ?? []

      nativeRecords.push(record)
      byNativeModule.set(nativeKey, nativeRecords)
    }
  }

  for (const record of facades) {
    for (const dependency of record.dependencies) {
      resolveIdentityFromStore(byIdentity, dependency.identity, record.language, dependency.range, record.identity)
    }
  }
  validateFacadeDependencyCycles(facades, byIdentity)

  return Object.freeze(/** @type {StdlibFacadeRegistry} */ ({
    facades: Object.freeze(facades),
    resolveFacade(language, nativeModule, symbol, range) {
      return resolveNativeFacadeFromStore(byNativeModule, language, nativeModule, symbol, range)
    },
    resolveIdentity(identity, language, range) {
      return resolveIdentityFromStore(byIdentity, identity, language, range)
    },
    resolveModule(language, nativeModule, range) {
      const records = byNativeModule.get(`${language}\0${nativeModule}`)

      if (!records) unprovedIdentity(language, nativeModule)
      const identities = new Set(/** @type {StdlibFacadeRecord[]} */ (records).map(({identity}) => identity))

      if (identities.size != 1) invalidFacade(`Native facade module '${nativeModule}' is ambiguous for '${language}'.`)
      return selectFacadeVersion(new Map(/** @type {StdlibFacadeRecord[]} */ (records).map((record) => [record.version, record])),
        /** @type {StdlibFacadeRecord} */ (records[0]).identity, language, range)
    }
  }))
}

/**
 * Rejects cycles after every versioned dependency has resolved successfully.
 * @param {StdlibFacadeRecord[]} facades - Validated facade records.
 * @param {Map<string, Map<string, StdlibFacadeRecord>>} store - Records by language and identity.
 * @returns {void}
 */
function validateFacadeDependencyCycles(facades, store) {
  const active = new Set()
  const complete = new Set()

  /**
   * Visits one exact selected facade version.
   * @param {StdlibFacadeRecord} record - Facade record.
   * @returns {void}
   */
  function visit(record) {
    const key = `${record.language}\0${record.identity}\0${record.version}`

    if (complete.has(key)) return
    if (active.has(key)) invalidFacade(`Facade dependency cycle includes '${record.identity}'.`)
    active.add(key)
    for (const dependency of record.dependencies) {
      visit(resolveIdentityFromStore(store, dependency.identity, record.language, dependency.range, record.identity))
    }
    active.delete(key)
    complete.add(key)
  }

  for (const record of facades) visit(record)
}

/**
 * Lists all built-in public and internal facade modules in stable order.
 * @returns {readonly StdlibFacadeRecord[]} Immutable facade definitions.
 */
export function listStdlibFacades() {
  return stdlibFacadeRegistry.facades
}

/**
 * Resolves one built-in facade from parser-proved native module and symbol identities.
 * @param {string} language - Source language.
 * @param {string} nativeModule - Exact native module identity.
 * @param {string} symbol - Exact imported or qualified symbol.
 * @param {string} [range] - Compatible facade version range.
 * @returns {StdlibFacadeRecord} Immutable facade definition.
 */
export function resolveStdlibFacade(language, nativeModule, symbol, range) {
  return stdlibFacadeRegistry.resolveFacade(language, nativeModule, symbol, range)
}

/**
 * Resolves a dependency-first, cycle-free facade module closure.
 * @param {StdlibFacadeRecord[]} roots - Parser-selected facade roots.
 * @param {Readonly<StdlibFacadeRegistry>} [registry] - Facade registry.
 * @returns {StdlibFacadeRecord[]} Stable dependency-first closure.
 */
export function resolveStdlibFacadeClosure(roots, registry = stdlibFacadeRegistry) {
  const active = new Set()
  const complete = new Set()
  /** @type {StdlibFacadeRecord[]} */
  const result = []

  /**
   * Visits one selected facade and its declared dependencies.
   * @param {StdlibFacadeRecord} record - Facade to visit.
   * @returns {void}
   */
  function visit(record) {
    const key = `${record.language}\0${record.identity}\0${record.version}`

    if (complete.has(key)) return
    if (active.has(key)) invalidFacade(`Facade dependency cycle includes '${record.identity}'.`)
    active.add(key)
    for (const dependency of record.dependencies) {
      visit(registry.resolveIdentity(dependency.identity, record.language, dependency.range))
    }
    active.delete(key)
    complete.add(key)
    result.push(record)
  }

  for (const root of roots) visit(root)
  return result
}

/**
 * Creates the detached, deterministic program descriptor for one selected facade closure.
 * @param {import("./semantic/types.js").SemanticLanguage} language - Source language profile.
 * @param {StdlibFacadeRecord[]} facades - Dependency-first selected facade records.
 * @returns {import("./semantic/types.js").StdlibFacadeProgramDescriptor} Plain program descriptor.
 */
export function stdlibFacadeProgramDescriptor(language, facades) {
  return {
    language,
    modules: facades.map((facade) => ({
      dependencies: facade.dependencies.map((dependency) => ({...dependency})),
      identity: facade.identity,
      nativeModules: facade.nativeModules.map((module) => ({identity: module.identity, symbols: [...module.symbols]})),
      publicDeclarations: facade.publicDeclarations.map((declaration) => ({
        ...declaration,
        effects: [...declaration.effects],
        failures: [...declaration.failures],
        forms: [...declaration.forms],
        parameters: declaration.parameters.map((parameter) => ({...parameter}))
      })),
      requirements: facade.requirements.map((requirement) => ({...requirement, operations: [...requirement.operations]})),
      runtimeProfile: facade.runtimeProfile,
      sourceModule: facade.source.id,
      version: facade.version,
      visibility: facade.visibility
    })),
    schema: "SemantifoldStdlibFacades",
    version: 1
  }
}

/**
 * Derives compiler-owned semantic capability authority from selected facade requirements.
 * The initial executable qualification corpus intentionally targets one canonical module.
 * @param {StdlibFacadeRecord[]} records - Selected facade closure.
 * @returns {{contract: {contractVersion: string, identity: string}, input: import("./semantic/types.js").CapabilityAuthorityInput} | null} Authority input.
 */
export function facadeCapabilityAuthority(records) {
  const requirements = records.flatMap((record) => record.requirements)

  if (requirements.length == 0) return null
  const identities = new Set(requirements.map(({module}) => module))
  const ranges = new Set(requirements.map(({range}) => range))

  if (identities.size != 1 || ranges.size != 1) {
    invalidFacade("The Task 036 qualification facade closure must resolve one canonical module and version range.")
  }
  const identity = requirements[0].module
  const contractVersion = requirements[0].range
  const contract = resolveStdlibModule(identity, contractVersion)

  return {
    contract: {contractVersion, identity},
    input: {
      capabilities: [{
        failures: contract.failures.map(({name}) => ({name})),
        name: "ResourceProbe",
        operations: contract.operations.map((operation) => ({
          effects: [...operation.effects],
          failures: [...operation.failures],
          name: operation.name,
          parameters: operation.parameters.map((parameter) => ({
            name: parameter.name,
            type: canonicalCapabilityParameterType(parameter.type)
          })),
          resourceFlow: /** @type {import("./semantic/types.js").CapabilityResourceFlowInput} */ ({...operation.resourceFlow}),
          returnType: canonicalCapabilityType(operation.returnType)
        })),
        resources: contract.resources.map(({name}) => ({name}))
      }],
      contractVersion,
      id: identity,
      schema: "SemantifoldCapabilityAuthority",
      schemaVersion: 1
    }
  }
}

/**
 * Converts one registry contract type to a capability-authority input type.
 * @param {string} type - Canonical contract type.
 * @returns {import("./semantic/types.js").FunctionReturnTypeName | {kind: "OwnedResourceType", resource: string} | {kind: "OptionalType", valueType: import("./semantic/types.js").SemanticTypeName}} Semantic authority type.
 */
function canonicalCapabilityType(type) {
  if (type == "void" || type == "boolean" || type == "integer" || type == "string") return type
  if (type.startsWith("optional:")) return {kind: "OptionalType",
    valueType: /** @type {import("./semantic/types.js").SemanticTypeName} */ (type.slice("optional:".length))}
  return {kind: "OwnedResourceType", resource: type}
}

/**
 * Converts a non-void registry parameter type to capability-authority input.
 * @param {string} type - Canonical parameter type.
 * @returns {import("./semantic/types.js").SemanticTypeName | {kind: "OwnedResourceType", resource: string} | {kind: "OptionalType", valueType: import("./semantic/types.js").SemanticTypeName}} Semantic parameter type.
 */
function canonicalCapabilityParameterType(type) {
  const converted = canonicalCapabilityType(type)

  if (converted == "void") invalidFacade("Canonical facade requirement parameters cannot have void type.")
  return /** @type {import("./semantic/types.js").SemanticTypeName | {kind: "OwnedResourceType", resource: string} | {kind: "OptionalType", valueType: import("./semantic/types.js").SemanticTypeName}} */ (converted)
}

/**
 * Resolves one dependency identity from a validated registry store.
 * @param {Map<string, Map<string, StdlibFacadeRecord>>} store - Records by language and identity.
 * @param {string} identity - Facade identity.
 * @param {string} language - Source language.
 * @param {string | undefined} range - Compatible range.
 * @param {string} [owner] - Depending facade for diagnostics.
 * @returns {StdlibFacadeRecord} Highest compatible record.
 */
function resolveIdentityFromStore(store, identity, language, range, owner) {
  const versions = store.get(`${language}\0${identity}`)

  if (!versions) {
    invalidFacade(owner ? `Facade '${owner}' depends on unknown facade '${identity}' for '${language}'.` :
      `Unknown facade identity '${identity}' for '${language}'.`)
  }
  return selectFacadeVersion(/** @type {Map<string, StdlibFacadeRecord>} */ (versions), identity, language, range)
}

/**
 * Resolves one exact native identity from a validated registry store.
 * @param {Map<string, StdlibFacadeRecord[]>} store - Records by language and native module.
 * @param {string} language - Source language.
 * @param {string} nativeModule - Exact parser-owned native module identity.
 * @param {string} symbol - Exact source-visible symbol.
 * @param {string | undefined} range - Compatible range.
 * @returns {StdlibFacadeRecord} Highest compatible record.
 */
function resolveNativeFacadeFromStore(store, language, nativeModule, symbol, range) {
  if (!supportedLanguages.has(language) || typeof nativeModule != "string" || nativeModule.length == 0) {
    unprovedIdentity(language, nativeModule)
  }
  const moduleRecords = store.get(`${language}\0${nativeModule}`)

  if (!moduleRecords) unprovedIdentity(language, nativeModule)
  const symbolRecords = /** @type {StdlibFacadeRecord[]} */ (moduleRecords).filter((record) => record.nativeModules.some((module) =>
    module.identity == nativeModule && module.symbols.includes(symbol)))

  if (symbolRecords.length == 0) unsupportedMember(language, nativeModule, symbol)
  const identities = new Set(symbolRecords.map(({identity}) => identity))

  if (identities.size != 1) invalidFacade(`Native facade identity '${nativeModule}#${symbol}' is ambiguous for '${language}'.`)
  const versions = new Map(symbolRecords.map((record) => [record.version, record]))

  return selectFacadeVersion(versions, symbolRecords[0].identity, language, range)
}

/**
 * Selects the highest facade version satisfying a canonical range.
 * @param {Map<string, StdlibFacadeRecord>} versions - Records by exact version.
 * @param {string} identity - Facade identity.
 * @param {string} language - Source language.
 * @param {string | undefined} range - Compatible range.
 * @returns {StdlibFacadeRecord} Selected record.
 */
function selectFacadeVersion(versions, identity, language, range) {
  const parsedRange = range === undefined ? {lower: /** @type {[number, number, number]} */ ([0, 0, 0]), upper: null} :
    parseStdlibVersionRange(range)

  if (!parsedRange) facadeVersionMalformed(language, String(range))
  /** @type {[number, number, number] | undefined} */
  let selected

  for (const version of versions.keys()) {
    const parsed = /** @type {[number, number, number]} */ (parseStdlibVersion(version))

    if (stdlibVersionSatisfies(parsed, parsedRange) && (!selected || compareStdlibVersions(parsed, selected) > 0)) selected = parsed
  }
  if (!selected) facadeVersionIncompatible(language, identity)

  return /** @type {StdlibFacadeRecord} */ (versions.get(selected.join(".")))
}

/**
 * Validates and detaches one executable facade record.
 * @param {unknown} candidate - Candidate record.
 * @returns {StdlibFacadeRecord} Detached frozen record.
 */
function validateFacadeRecord(candidate) {
  if (!isPlainObject(candidate)) invalidFacade("Every facade record must be a plain object.")
  requireKeys(candidate, ["dependencies", "identity", "language", "nativeModules", "publicDeclarations", "requirements",
    "runtimeProfile", "source", "version", "visibility"], "facade record")
  const identity = requireString(candidate.identity, "Facade identity")
  const language = requireString(candidate.language, "Facade language")
  const version = requireString(candidate.version, "Facade version")
  const runtimeProfile = requireString(candidate.runtimeProfile, "Facade runtime profile")
  const visibility = candidate.visibility

  if (!facadeIdentityPattern.test(identity)) invalidFacade(`Facade identity '${identity}' is invalid.`)
  if (!supportedLanguages.has(language)) invalidFacade(`Facade language '${language}' is outside the adopted cohort.`)
  if (!parseStdlibVersion(version)) invalidFacade(`Facade version '${version}' is invalid.`)
  if (!/^[a-z][a-z0-9.-]*$/u.test(runtimeProfile)) invalidFacade(`Facade runtime profile '${runtimeProfile}' is invalid.`)
  if (visibility != "public" && visibility != "internal") invalidFacade(`Facade '${identity}' has invalid visibility.`)
  const source = validateSource(candidate.source, identity, language)
  const publicDeclarations = validatePublicDeclarations(candidate.publicDeclarations, identity)
  const nativeModules = validateNativeModules(candidate.nativeModules, identity, publicDeclarations)
  const requirements = validateRequirements(candidate.requirements, identity)
  const dependencies = validateDependencies(candidate.dependencies, identity)

  if (visibility == "public" && (publicDeclarations.length == 0 || nativeModules.length == 0)) {
    invalidFacade(`Public facade '${identity}' requires declarations and native identities.`)
  }
  if (visibility == "internal" && nativeModules.length > 0) invalidFacade(`Internal facade '${identity}' cannot expose native identities.`)

  return deepFreeze({
    dependencies,
    identity,
    language: /** @type {import("./semantic/types.js").SemanticLanguage} */ (language),
    nativeModules,
    publicDeclarations,
    requirements,
    runtimeProfile,
    source,
    version,
    visibility: /** @type {"internal" | "public"} */ (visibility)
  })
}

/**
 * Validates one compiler-owned executable facade source.
 * @param {unknown} candidate - Candidate source descriptor.
 * @param {string} identity - Owning facade identity.
 * @param {string} language - Facade source language.
 * @returns {{content: string, filename: string, id: string}} Validated source descriptor.
 */
function validateSource(candidate, identity, language) {
  if (!isPlainObject(candidate)) invalidFacade(`Facade '${identity}' requires an executable source descriptor.`)
  requireKeys(candidate, ["content", "filename", "id"], `facade '${identity}' source`)
  const content = requireString(candidate.content, `Facade '${identity}' source content`)
  const filename = requireString(candidate.filename, `Facade '${identity}' source filename`)
  const id = requireString(candidate.id, `Facade '${identity}' source module identity`)

  if (content.length == 0 || !isSafeArtifactPath(filename) || !filename.startsWith(`__semantifold_facades__/${language}/`) ||
    !moduleIdPattern.test(id) || !id.startsWith(`semantifold.facade.${language}.`)) {
    invalidFacade(`Facade '${identity}' has an invalid compiler-owned source descriptor.`)
  }
  return {content, filename, id}
}

/**
 * Validates one facade's closed public declaration surface.
 * @param {unknown} candidate - Candidate declarations.
 * @param {string} identity - Owning facade identity.
 * @returns {StdlibFacadePublicDeclaration[]} Validated declarations.
 */
function validatePublicDeclarations(candidate, identity) {
  if (!isDenseArray(candidate)) invalidFacade(`Facade '${identity}' public declarations must be a dense array.`)
  const names = new Set()
  return candidate.map((value) => {
    if (!isPlainObject(value)) invalidFacade(`Facade '${identity}' public declarations must be plain objects.`)
    requireKeys(value, ["effects", "failures", "forms", "kind", "name", "ownership", "parameters", "returnType"],
      `facade '${identity}' public declaration`)
    const name = requireString(value.name, `Facade '${identity}' declaration name`)

    if (value.kind != "function" || !declarationNamePattern.test(name) || names.has(name)) {
      invalidFacade(`Facade '${identity}' has an invalid or duplicate public declaration.`)
    }
    names.add(name)
    if (!isDenseArray(value.effects) || !value.effects.every((effect) => effect == "host") || new Set(value.effects).size != value.effects.length ||
      !isDenseArray(value.failures) || !value.failures.every((failure) => typeof failure == "string" && declarationNamePattern.test(failure)) ||
      !isDenseArray(value.forms) || value.forms.length != 1 || value.forms[0] != "direct-call" || value.ownership != "not-applicable" ||
      !isDenseArray(value.parameters)) invalidFacade(`Facade '${identity}' declaration '${name}' has an invalid public contract.`)
    const parameterNames = new Set()
    const parameters = value.parameters.map((parameter) => {
      if (!isPlainObject(parameter)) invalidFacade(`Facade '${identity}' declaration '${name}' has an invalid parameter.`)
      requireKeys(parameter, ["name", "type"], `facade '${identity}' declaration parameter`)
      const parameterName = requireString(parameter.name, `Facade '${identity}' parameter name`)
      const type = requireString(parameter.type, `Facade '${identity}' parameter type`)

      if (!declarationNamePattern.test(parameterName) || parameterNames.has(parameterName) || !canonicalTypes.has(type) || type == "void") {
        invalidFacade(`Facade '${identity}' declaration '${name}' has an invalid parameter.`)
      }
      parameterNames.add(parameterName)
      return {name: parameterName, type}
    })
    const returnType = requireString(value.returnType, `Facade '${identity}' return type`)

    if (!canonicalTypes.has(returnType)) invalidFacade(`Facade '${identity}' declaration '${name}' has an invalid return type.`)
    return {
      effects: /** @type {string[]} */ ([...value.effects]),
      failures: /** @type {string[]} */ ([...value.failures]),
      forms: /** @type {["direct-call"]} */ (["direct-call"]),
      kind: /** @type {const} */ ("function"),
      name,
      ownership: /** @type {const} */ ("not-applicable"),
      parameters,
      returnType
    }
  })
}

/**
 * Validates the exact native module and symbol identities selecting a facade.
 * @param {unknown} candidate - Candidate native modules.
 * @param {string} identity - Owning facade identity.
 * @param {StdlibFacadePublicDeclaration[]} declarations - Validated public surface.
 * @returns {{identity: string, symbols: string[]}[]} Validated native identities.
 */
function validateNativeModules(candidate, identity, declarations) {
  if (!isDenseArray(candidate)) invalidFacade(`Facade '${identity}' native modules must be a dense array.`)
  const modules = new Set()
  const publicNames = new Set(declarations.map(({name}) => name))
  return candidate.map((value) => {
    if (!isPlainObject(value)) invalidFacade(`Facade '${identity}' native modules must be plain objects.`)
    requireKeys(value, ["identity", "symbols"], `facade '${identity}' native module`)
    const moduleIdentity = requireString(value.identity, `Facade '${identity}' native module identity`)

    if (modules.has(moduleIdentity) || !isDenseArray(value.symbols) || value.symbols.length == 0 ||
      !value.symbols.every((symbol) => typeof symbol == "string" && publicNames.has(symbol)) ||
      new Set(value.symbols).size != value.symbols.length) {
      invalidFacade(`Facade '${identity}' has an invalid native module declaration.`)
    }
    modules.add(moduleIdentity)
    return {identity: moduleIdentity, symbols: /** @type {string[]} */ ([...value.symbols])}
  })
}

/**
 * Validates canonical-only facade capability requirements.
 * @param {unknown} candidate - Candidate requirements.
 * @param {string} identity - Owning facade identity.
 * @returns {{module: string, operations: string[], range: string}[]} Validated requirements.
 */
function validateRequirements(candidate, identity) {
  if (!isDenseArray(candidate)) invalidFacade(`Facade '${identity}' requirements must be a dense array.`)
  const modules = new Set()
  return candidate.map((value) => {
    if (!isPlainObject(value)) invalidFacade(`Facade '${identity}' requirements must be plain objects.`)
    requireKeys(value, ["module", "operations", "range"], `facade '${identity}' requirement`)
    const module = requireString(value.module, `Facade '${identity}' canonical module`)
    const range = requireString(value.range, `Facade '${identity}' canonical range`)

    if (modules.has(module) || !parseStdlibVersionRange(range) || !isDenseArray(value.operations) || value.operations.length == 0 ||
      !value.operations.every((operation) => typeof operation == "string" && declarationNamePattern.test(operation)) ||
      new Set(value.operations).size != value.operations.length) invalidFacade(`Facade '${identity}' has an invalid canonical requirement.`)
    const contract = resolveStdlibModule(module, range)
    const declared = new Set(contract.operations.map(({name}) => name))

    if (!/** @type {string[]} */ (value.operations).every((operation) => declared.has(operation))) {
      invalidFacade(`Facade '${identity}' requires an undeclared canonical operation.`)
    }
    modules.add(module)
    return {module, operations: /** @type {string[]} */ ([...value.operations]), range}
  })
}

/**
 * Validates versioned same-language facade dependencies.
 * @param {unknown} candidate - Candidate dependencies.
 * @param {string} identity - Owning facade identity.
 * @returns {{identity: string, range: string}[]} Validated dependencies.
 */
function validateDependencies(candidate, identity) {
  if (!isDenseArray(candidate)) invalidFacade(`Facade '${identity}' dependencies must be a dense array.`)
  const identities = new Set()
  return candidate.map((value) => {
    if (!isPlainObject(value)) invalidFacade(`Facade '${identity}' dependencies must be plain objects.`)
    requireKeys(value, ["identity", "range"], `facade '${identity}' dependency`)
    const dependencyIdentity = requireString(value.identity, `Facade '${identity}' dependency identity`)
    const range = requireString(value.range, `Facade '${identity}' dependency range`)

    if (!facadeIdentityPattern.test(dependencyIdentity) || dependencyIdentity == identity || identities.has(dependencyIdentity) ||
      !parseStdlibVersionRange(range)) invalidFacade(`Facade '${identity}' has an invalid dependency.`)
    identities.add(dependencyIdentity)
    return {identity: dependencyIdentity, range}
  })
}

/**
 * Builds the bounded original-five qualification facade definitions.
 * @returns {unknown[]} Unvalidated built-in qualification facade definitions.
 */
function builtinFacadeRecords() {
  return ["php", "ruby", "javascript", "typescript", "java"].flatMap((language) => builtinLanguageFacades(language))
}

/**
 * Builds one source language's public, internal, and unreachable qualification facades.
 * @param {string} language - Source language.
 * @returns {unknown[]} Language facade definitions.
 */
function builtinLanguageFacades(language) {
  const names = facadeNames(language)
  const base = `semantifold.task036.${language}`
  const sourceBase = `semantifold.facade.${language}`
  const sourceDirectory = `__semantifold_facades__/${language}`
  const probeFilename = language == "java" ? `${sourceDirectory}/semantifold/facade/java/probe/Probe.java` :
    `${sourceDirectory}/probe.${names.extension}`
  const runnerFilename = language == "java" ? `${sourceDirectory}/semantifold/facade/java/proberunner/ProbeRunner.java` :
    `${sourceDirectory}/probe-runner.${names.extension}`
  const unusedFilename = language == "java" ? `${sourceDirectory}/semantifold/facade/java/unused/Unused.java` :
    `${sourceDirectory}/unused.${names.extension}`

  return [{
    dependencies: [{identity: `${base}.probe-runner`, range: "1"}],
    identity: `${base}.probe`,
    language,
    nativeModules: [{identity: names.nativeModule, symbols: [names.publicName]}],
    publicDeclarations: [publicDeclaration(names.publicName)],
    requirements: [],
    runtimeProfile: `${language}-task036-v1`,
    source: {content: names.probeSource, filename: probeFilename, id: `${sourceBase}.probe`},
    version: "1.0.0",
    visibility: "public"
  }, {
    dependencies: [],
    identity: `${base}.probe-runner`,
    language,
    nativeModules: [],
    publicDeclarations: [],
    requirements: [{module: "semantifold.task034.resource-probe", operations: ["probeEffect", "probeTrace"], range: "1"}],
    runtimeProfile: `${language}-task036-v1`,
    source: {content: names.runnerSource, filename: runnerFilename, id: `${sourceBase}.probe_runner`},
    version: "1.0.0",
    visibility: "internal"
  }, {
    dependencies: [],
    identity: `${base}.unused`,
    language,
    nativeModules: [{identity: names.unusedNativeModule, symbols: [names.unusedName]}],
    publicDeclarations: [publicDeclaration(names.unusedName)],
    requirements: [{module: "semantifold.task034.resource-probe", operations: ["probeTrace"], range: "1"}],
    runtimeProfile: `${language}-task036-v1`,
    source: {content: names.unusedSource, filename: unusedFilename, id: `${sourceBase}.unused`},
    version: "1.0.0",
    visibility: "public"
  }]
}

/**
 * Builds the common bounded qualification function declaration.
 * @param {string} name - Source-visible function name.
 * @returns {StdlibFacadePublicDeclaration} Public facade declaration.
 */
function publicDeclaration(name) {
  return {
    effects: ["host"], failures: [], forms: ["direct-call"], kind: "function", name,
    ownership: "not-applicable", parameters: [{name: "label", type: "string"}], returnType: "string"
  }
}

/**
 * Builds executable source and native identity spellings for one original-five language.
 * @param {string} language - Source language.
 * @returns {FacadeSourceNames} Facade source definitions.
 */
function facadeNames(language) {
  if (language == "php") return {
    extension: "php", nativeModule: "Semantifold\\Task036\\Probe", publicName: "compatibility_probe",
    unusedName: "unused_probe", unusedNativeModule: "Semantifold\\Task036\\Unused",
    probeSource: `<?php
declare(strict_types=1);
namespace Semantifold\\Facade\\Php\\Probe;
use function Semantifold\\Facade\\Php\\ProbeRunner\\run_compatibility_probe;
require_once __DIR__ . "/probe-runner.php";
function compatibility_probe(string $label): string { return run_compatibility_probe($label); }
`,
    runnerSource: `<?php
declare(strict_types=1);
namespace Semantifold\\Facade\\Php\\ProbeRunner;
function run_compatibility_probe(string $label): string {
    try {
        /**
         * @var int $effect
         * @semantifold-immutable
         */
        $effect = probeEffect($label, 1, false);
        return probeTrace();
    }
    catch (ProbeOperationFailure $error) { return $error->getMessage(); }
}
`,
    unusedSource: `<?php
declare(strict_types=1);
namespace Semantifold\\Facade\\Php\\Unused;
function unused_probe(string $label): string { return probeTrace(); }
`
  }
  if (language == "ruby") return {
    extension: "rb", nativeModule: "semantifold/task036/probe", publicName: "compatibility_probe",
    unusedName: "unused_probe", unusedNativeModule: "semantifold/task036/unused",
    probeSource: `require_relative "probe-runner"
module SemantifoldTask036Probe
  module_function
  # @param label [String]
  # @return [String]
  def compatibility_probe(label)
    return SemantifoldTask036ProbeRunner.run_compatibility_probe(label)
  end
end
`,
    runnerSource: `module SemantifoldTask036ProbeRunner
  module_function
  # @param label [String]
  # @return [String]
  def run_compatibility_probe(label)
    begin
      # @type [Integer]
      # @semantifold-immutable
      effect = probeEffect(label, 1, false)
      return probeTrace
    rescue ProbeOperationFailure => error
      return error.message
    end
  end
end
`,
    unusedSource: `module SemantifoldTask036Unused
  module_function
  # @param label [String]
  # @return [String]
  def unused_probe(label)
    return probeTrace
  end
end
`
  }
  if (language == "java") return {
    extension: "java", nativeModule: "semantifold.task036.Probe", publicName: "compatibilityProbe",
    unusedName: "unusedProbe", unusedNativeModule: "semantifold.task036.Unused",
    probeSource: `package semantifold.facade.java.probe;
import semantifold.facade.java.proberunner.ProbeRunner;
public final class Probe {
  public static String compatibilityProbe(String label) { return ProbeRunner.runCompatibilityProbe(label); }
}
`,
    runnerSource: `package semantifold.facade.java.proberunner;
public final class ProbeRunner {
  public static String runCompatibilityProbe(String label) {
    try { final int effect = probeEffect(label, 1, false); return probeTrace(); }
    catch (ProbeOperationFailure error) { return error.getMessage(); }
  }
}
`,
    unusedSource: `package semantifold.facade.java.unused;
public final class Unused {
  public static String unusedProbe(String label) { return probeTrace(); }
}
`
  }
  const typed = language == "typescript"
  const extension = typed ? "ts" : "js"
  const parameter = typed ? "label: string" : "label"
  const result = typed ? ": string" : ""
  const documentation = typed ? "" : `/**
 * @param {string} label
 * @returns {string}
 */
`

  return {
    extension, nativeModule: "semantifold:task036/probe", publicName: "compatibilityProbe",
    unusedName: "unusedProbe", unusedNativeModule: "semantifold:task036/unused",
    probeSource: `import {runCompatibilityProbe} from "./probe-runner.js"
${documentation}export function compatibilityProbe(${parameter})${result} { return runCompatibilityProbe(label) }
`,
    runnerSource: `${documentation}export function runCompatibilityProbe(${parameter})${result} {
  try { ${typed ? "const effect: number" : "/** @type {number} */ const effect"} = probeEffect(label, 1, false); return probeTrace() }
  catch (error) { if (!(error instanceof ProbeOperationFailure)) { throw error } return error.message }
}
`,
    unusedSource: `${documentation}export function unusedProbe(${parameter})${result} { return probeTrace() }
`
  }
}

/**
 * Requires a closed exact key set.
 * @param {Record<string, unknown>} value - Plain candidate object.
 * @param {string[]} keys - Expected keys.
 * @param {string} subject - Diagnostic subject.
 * @returns {void}
 */
function requireKeys(value, keys, subject) {
  if (Object.keys(value).sort().join(",") != [...keys].sort().join(",")) invalidFacade(`Invalid ${subject} fields.`)
}

/**
 * Requires one non-empty string.
 * @param {unknown} value - Candidate value.
 * @param {string} subject - Diagnostic subject.
 * @returns {string} Validated string.
 */
function requireString(value, subject) {
  if (typeof value != "string" || value.length == 0) invalidFacade(`${subject} must be a non-empty string.`)
  return /** @type {string} */ (value)
}

/**
 * Checks for an ordinary object with no custom prototype.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the candidate is plain.
 */
function isPlainObject(value) {
  return value !== null && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Recursively freezes one detached facade registry value.
 * @template {object} T
 * @param {T} value - Detached object.
 * @returns {Readonly<T>} Frozen value.
 */
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child == "object" && !Object.isFrozen(child)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * Throws a stable invalid-registry diagnostic.
 * @param {string} message - Failure detail.
 * @returns {never} Always throws.
 */
function invalidFacade(message) {
  throw new SemantifoldDiagnostic({code: "STDLIB_FACADE_INVALID", language: "stdlib", message})
}

/**
 * Throws when parser evidence does not name a registered native module.
 * @param {string} language - Source language.
 * @param {unknown} nativeModule - Unproved module identity.
 * @returns {never} Always throws.
 */
function unprovedIdentity(language, nativeModule) {
  throw new SemantifoldDiagnostic({
    code: "STDLIB_FACADE_IDENTITY_UNPROVED",
    language: supportedLanguages.has(language) ? language : "stdlib",
    message: `Native standard-library module '${String(nativeModule)}' is not a registered '${language}' facade identity.`
  })
}

/**
 * Throws when a native module member is outside its public facade surface.
 * @param {string} language - Source language.
 * @param {string} nativeModule - Exact native module.
 * @param {string} symbol - Unsupported member.
 * @returns {never} Always throws.
 */
function unsupportedMember(language, nativeModule, symbol) {
  throw new SemantifoldDiagnostic({
    code: "STDLIB_FACADE_MEMBER_UNSUPPORTED",
    language,
    message: `Native standard-library symbol '${nativeModule}#${symbol}' is outside the registered facade surface.`
  })
}

/**
 * Throws for a malformed facade version range.
 * @param {string} language - Source language.
 * @param {string} range - Malformed range.
 * @returns {never} Always throws.
 */
function facadeVersionMalformed(language, range) {
  throw new SemantifoldDiagnostic({
    code: "STDLIB_FACADE_VERSION_MALFORMED", language,
    message: `Facade version range '${range}' is not canonical.`
  })
}

/**
 * Throws when no registered facade version satisfies a range.
 * @param {string} language - Source language.
 * @param {string} identity - Facade identity.
 * @returns {never} Always throws.
 */
function facadeVersionIncompatible(language, identity) {
  throw new SemantifoldDiagnostic({
    code: "STDLIB_FACADE_VERSION_INCOMPATIBLE", language,
    message: `No registered version of facade '${identity}' satisfies the required compatibility range.`
  })
}

export const stdlibFacadeRegistry = createStdlibFacadeRegistry()
