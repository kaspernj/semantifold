// @ts-check

import {isDenseArray} from "../array.js"
import {isSafeArtifactPath} from "../artifact-path.js"
import {SemantifoldDiagnostic, semanticFailure, unsupportedCapability, unsupportedRole} from "../diagnostic.js"
import {languageRegistry} from "../language-registry.js"
import {normalizeCapabilityAuthority} from "../semantic/capabilities.js"
import {moduleLocation} from "../semantic/location.js"
import {annotateParsedModule} from "../semantic/provenance.js"
import {moduleUncheckedErrorEffects, validateParsedModule} from "../semantic/validate.js"
import {
  facadeCapabilityAuthority, resolveStdlibFacadeClosure, stdlibFacadeProgramDescriptor, stdlibFacadeRegistry
} from "../stdlib-facades.js"
import {inspectJavaScriptTypeScriptModule} from "./javascript-typescript.js"
import {inspectJavaModule} from "./java.js"
import {inspectPhpModule} from "./php.js"
import {inspectRubyModule} from "./ruby.js"

const programLanguages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const moduleIdPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z][a-z0-9_]*)*$/u

/** @typedef {{facade?: import("../stdlib-facades.js").StdlibFacadeRecord, filename: string, id: string, language: import("../semantic/types.js").SemanticLanguage, ownership: "application" | "facade", source: string}} ProgramSource */
/** @typedef {{declarationLocation?: import("../semantic/types.js").SourceLocation, facade?: import("../stdlib-facades.js").StdlibFacadeRecord, importedName: string, importedNameLocation?: import("../semantic/types.js").SourceLocation, localName: string, localNameLocation?: import("../semantic/types.js").SourceLocation, location: import("../semantic/types.js").SourceLocation, namespace?: boolean, pathLocation: import("../semantic/types.js").SourceLocation, specifier: string, stdlibCandidate?: true, typeOnly: boolean}} ProgramImportRequest */
/** @typedef {{importedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, nativeName: string, symbolKind: import("../semantic/types.js").SemanticDeclarationKind, typeOnly: boolean}} ProgramNativeBinding */
/** @typedef {{imports: ProgramImportRequest[], exports: {declarationLocation?: import("../semantic/types.js").SourceLocation, exportedName: string, exportedNameLocation?: import("../semantic/types.js").SourceLocation, localName: string, localNameLocation?: import("../semantic/types.js").SourceLocation, location: import("../semantic/types.js").SourceLocation, typeOnly: boolean}[], bindings?: ProgramNativeBinding[], nativeName?: string}} ProgramHeader */

/**
 * Parses an explicit caller-supplied multi-source program without filesystem discovery.
 * @param {object} input - Program parse request.
 * @param {string} input.entryModule - Sole entry module identity.
 * @param {{filename: string, id: string, language: import("../semantic/types.js").SemanticLanguage, source: string}[]} input.sources - Complete source set.
 * @param {Readonly<import("../semantic/types.js").CapabilityAuthority> | import("../semantic/types.js").CapabilityAuthorityInput} [input.capabilityAuthority] - Explicit compiler authority.
 * @returns {import("../semantic/types.js").SemanticProgram} Resolved semantic program.
 */
export function parseProgramSource(input) {
  if (!isPlainObject(input) || !isDenseArray(input.sources) || input.sources.length == 0 ||
    typeof input.entryModule != "string") invalidProgram("Program parsing requires a non-empty ordered source set and entry module.")

  const applicationSources = input.sources.map((source, index) => validateSource(source, index))
  const requestedAuthority = normalizeCapabilityAuthority(input.capabilityAuthority)
  const sourceLanguages = new Set(applicationSources.map(({language}) => language))

  if (sourceLanguages.size != 1) {
    semanticFailure(applicationSources[0].language, "MIXED_SOURCE_LANGUAGES", "A semantic program must use one source-language compatibility profile.", undefined)
  }
  if (requestedAuthority && !languageRegistry.record(applicationSources[0].language).features.effectfulCapabilitiesAndResources) {
    unsupportedCapability(applicationSources[0].language, "Task 034 effectful capabilities and owned resources",
      moduleLocation(applicationSources[0].filename, applicationSources[0].source))
  }
  const byId = new Map()
  const byFilename = new Map()

  for (const source of applicationSources) {
    if (byId.has(source.id)) semanticFailure(source.language, "DUPLICATE_MODULE", `Duplicate module identity '${source.id}'.`, undefined)
    if (byFilename.has(source.filename)) semanticFailure(source.language, "DUPLICATE_MODULE", `Duplicate module filename '${source.filename}'.`, undefined)
    byId.set(source.id, source)
    byFilename.set(source.filename, source)
  }
  if (!byId.has(input.entryModule)) {
    semanticFailure(applicationSources[0].language, "INVALID_ENTRY_MODULE", `Unknown entry module '${input.entryModule}'.`, undefined)
  }

  const headers = new Map(applicationSources.map((source) => [source.id, inspectSource(source)]))
  const facadeRoots = resolveFacadeImports(applicationSources, headers)
  const facadeRecords = resolveStdlibFacadeClosure(facadeRoots)

  if (facadeRecords.length > 0 && requestedAuthority) {
    const located = applicationSources.flatMap((source) => requiredMapValue(headers, source.id).imports)
      .find(({facade}) => facade)?.location

    facadeFailure(applicationSources[0].language, "STDLIB_FACADE_AUTHORITY_FORGED",
      "Programs resolved through compiler-owned facades cannot supply their own canonical capability authority.", located)
  }
  const facadeAuthority = facadeCapabilityAuthority(facadeRecords)
  const authority = requestedAuthority ?? (facadeAuthority ? normalizeCapabilityAuthority(facadeAuthority.input) : undefined)
  const facadeSources = facadeRecords.map((facade) => /** @type {ProgramSource} */ ({
    facade,
    filename: facade.source.filename,
    id: facade.source.id,
    language: facade.language,
    ownership: "facade",
    source: facade.source.content
  }))

  validateFacadeCollisions(applicationSources, headers, facadeSources)
  const sources = [...applicationSources, ...facadeSources]

  for (const source of facadeSources) {
    byId.set(source.id, source)
    byFilename.set(source.filename, source)
    headers.set(source.id, inspectSource(source))
  }
  const registeredSources = sources.map((source, index) => ({
    content: source.source,
    filename: source.filename,
    id: `source:${index}`,
    language: source.language,
    ownership: source.ownership
  }))
  const sourceIds = new Map(sources.map((source, index) => [source.id, `source:${index}`]))

  validateNativeModuleIdentities(sources, headers)
  /** @type {Map<string, {source: typeof sources[number], requests: (ReturnType<typeof inspectSource>["imports"][number] & {moduleId: string})[]}>} */
  const graph = new Map()

  for (const source of sources) {
    const requests = requiredMapValue(headers, source.id).imports.map((request) => ({
      ...request,
      moduleId: request.facade?.source.id ?? resolveImportModule(source, request.specifier, request.pathLocation, byFilename, headers)
    }))

    graph.set(source.id, {requests, source})
  }
  const orderedIds = topologicalOrder(sources, graph)
  /** @type {Map<string, import("../semantic/types.js").SemanticProgramModule>} */
  const parsed = new Map()
  /** @type {Map<string, Set<string>>} */
  const callEffectsByDeclarationId = new Map()

  for (const moduleId of orderedIds) {
    const {requests, source} = requiredMapValue(graph, moduleId)
    const sourceId = /** @type {string} */ (sourceIds.get(source.id))
    const header = requiredMapValue(headers, moduleId)
    const localNames = new Set()
    const visibleFunctions = new Map()
    const visibleCallEffects = new Map()
    const visibleRecordsByName = new Map()
    const visibleValueRecordsByName = new Map()
    const visibleRecordsById = new Map()
    const visibleErrorsByName = new Map()
    const visibleErrorsById = new Map()
    const consumedBindings = new Set()
    /** @type {import("../semantic/types.js").SemanticImport[]} */
    const imports = []

    for (const request of requests) {
      const dependency = parsed.get(request.moduleId)

      if (!dependency) {
        throw new Error(`Dependency '${request.moduleId}' was not parsed before '${source.id}'.`)
      }
      const dependencyHeader = requiredMapValue(headers, request.moduleId)
      const nativeBindingPrefix = request.facade?.nativeModules.find(({identity}) => identity == request.specifier)?.identity ??
        dependencyHeader.nativeName
      const nativeBindings = source.language == "php" && request.namespace
        ? (header.bindings ?? []).filter(({nativeName}) => nativeName.startsWith(`${nativeBindingPrefix}\\`))
        : []
      const selectedExports = request.namespace && source.language == "php"
        ? dependency.exports.filter(({exportedName}) => nativeBindings.some(({importedName}) => importedName == exportedName))
        : request.namespace
          ? dependency.exports
        : dependency.exports.filter(({exportedName}) => exportedName == request.importedName)

      if (selectedExports.length == 0) {
        semanticFailure(source.language, "UNRESOLVED_IMPORT", request.namespace
          ? `Imported module '${request.moduleId}' has no explicitly bound exports.`
          : `Module '${request.moduleId}' does not export '${request.importedName}'.`, request.location)
      }
      for (const exported of selectedExports) {
        const nativeBinding = nativeBindings.find(({importedName}) => importedName == exported.exportedName)
        const localName = nativeBinding?.localName ?? (request.namespace
          ? qualifiedImportName(source.language, dependencyHeader.nativeName, exported)
          : request.localName
        )
        const importLocation = nativeBinding?.location ?? request.location

        if (localNames.has(localName)) {
          semanticFailure(source.language, "DUPLICATE_IMPORT_BINDING", `Duplicate import binding '${localName}'.`, importLocation)
        }
        localNames.add(localName)
        if (nativeBinding && nativeBinding.symbolKind != exported.symbolKind &&
          !(nativeBinding.symbolKind == "record" && exported.symbolKind == "error")) {
          semanticFailure(source.language, "IMPORT_KIND_MISMATCH", `Import '${nativeBinding.importedName}' has the wrong declaration kind.`, importLocation)
        }
        if (request.typeOnly && exported.symbolKind != "record") {
          semanticFailure(source.language, "IMPORT_KIND_MISMATCH", `Type import '${request.importedName}' does not name a record.`, importLocation)
        }
        if (nativeBinding) consumedBindings.add(nativeBinding)
        const declaration = declarationFor(dependency, exported)
        const typeOnly = nativeBinding?.typeOnly ?? request.typeOnly

        if (exported.symbolKind == "function") {
          visibleFunctions.set(localName, /** @type {import("../semantic/types.js").FunctionDeclaration} */ (declaration))
          visibleCallEffects.set(localName, new Set(callEffectsByDeclarationId.get(exported.declarationId) ?? []))
        }
        else if (exported.symbolKind == "record") {
          const record = /** @type {import("../semantic/types.js").RecordDeclaration} */ (declaration)

          visibleRecordsByName.set(localName, record)
          if (!typeOnly) visibleValueRecordsByName.set(localName, record)
          visibleRecordsById.set(/** @type {string} */ (record.id), record)
        } else {
          const error = /** @type {import("../semantic/types.js").ErrorDeclaration} */ (declaration)

          visibleErrorsByName.set(localName, error)
          visibleErrorsById.set(/** @type {string} */ (error.id), error)
        }
        /** @type {Record<string, import("../semantic/types.js").SourceLocation>} */
        const ranges = {
          declaration: request.declarationLocation ?? request.location,
          path: request.pathLocation
        }

        if (!request.namespace || nativeBinding || request.facade) {
          ranges.importedName = nativeBinding?.location ?? request.importedNameLocation ?? importLocation
          ranges.localName = nativeBinding?.location ?? request.localNameLocation ?? importLocation
        }

        imports.push({
          declarationId: exported.declarationId,
          importedName: exported.exportedName,
          kind: "Import",
          localName,
          location: importLocation,
          moduleId: request.moduleId,
          ...(request.facade ? {stdlibFacade: {
            facadeIdentity: request.facade.identity,
            facadeVersion: request.facade.version,
            nativeModule: request.specifier,
            nativeSymbol: exported.exportedName,
            schema: /** @type {const} */ ("SemantifoldStdlibFacadeResolution"),
            version: /** @type {const} */ (1)
          }} : {}),
          sourceProvenance: sourceAssociation(importLocation, ranges, sourceId),
          symbolKind: exported.symbolKind,
          typeOnly
        })
      }
    }
    const unconsumedBinding = (header.bindings ?? []).find((binding) => !consumedBindings.has(binding))

    if (unconsumedBinding) {
      semanticFailure(source.language, "UNRESOLVED_IMPORT", `Native import '${unconsumedBinding.nativeName}' has no matching required module.`, unconsumedBinding.location)
    }

    const frontend = /** @type {(input: object) => import("../semantic/types.js").SemanticModule} */ (
      languageRegistry.resolve(source.language, "frontend"))
    const moduleCapabilities = requestedAuthority?.capabilities ??
      (source.facade?.requirements.length ? authority?.capabilities : undefined)
    const raw = frontend({
      capabilities: moduleCapabilities,
      filename: source.filename,
      language: source.language,
      program: {
        functions: visibleFunctions,
        isEntry: source.id == input.entryModule,
        errors: visibleErrorsByName,
        records: visibleRecordsByName,
        valueRecords: visibleValueRecordsByName
      },
      source: source.source
    })

    if (moduleCapabilities) raw.capabilities = /** @type {import("../semantic/types.js").EffectCapabilityDeclaration[]} */ (moduleCapabilities)
    if ((raw.classes?.length ?? 0) > 0) {
      semanticFailure(source.language, "UNSUPPORTED_SYNTAX",
        "Task 033 reference classes are not supported by the Task 010 semantic program profile.",
        raw.classes?.[0]?.location ?? raw.location)
    }

    if (source.id == input.entryModule && raw.entryPoint.body.statements.length == 0) {
      semanticFailure(source.language, "INVALID_ENTRY_MODULE", `Selected entry module '${source.id}' has no executable statements.`, raw.entryPoint.location)
    }
    validateParsedModule(raw, source.language, {
      callEffects: visibleCallEffects,
      errors: visibleErrorsById,
      functions: visibleFunctions,
      records: visibleRecordsById
    })
    rekeyDeclarations(raw, source.id)
    const localCallEffects = moduleUncheckedErrorEffects(raw, {callEffects: visibleCallEffects, functions: visibleFunctions})

    for (const declaration of raw.functions) {
      callEffectsByDeclarationId.set(/** @type {string} */ (declaration.id), new Set(localCallEffects.get(declaration.name) ?? []))
    }
    annotateParsedModule(raw, source)
    rebaseParsedModuleProvenance(raw, registeredSources, sourceId)

    /** @type {Map<string, {declaration: import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ErrorDeclaration, symbolKind: import("../semantic/types.js").SemanticDeclarationKind}>} */
    const declarationsByName = new Map()

    for (const declaration of raw.records ?? []) declarationsByName.set(declaration.name, {declaration, symbolKind: "record"})
    for (const declaration of raw.errors ?? []) declarationsByName.set(declaration.name, {declaration, symbolKind: "error"})
    for (const declaration of raw.functions) declarationsByName.set(declaration.name, {declaration, symbolKind: "function"})
    /** @type {import("../semantic/types.js").SemanticExport[]} */
    const exports = header.exports.map((request) => {
      const resolved = declarationsByName.get(request.localName)

      if (!resolved) semanticFailure(source.language, "UNRESOLVED_EXPORT", `Unknown exported declaration '${request.localName}'.`, request.location)
      if (request.typeOnly && resolved.symbolKind != "record") {
        semanticFailure(source.language, "EXPORT_KIND_MISMATCH", `Type export '${request.exportedName}' does not name a record.`, request.location)
      }

      return {
        declarationId: /** @type {string} */ (resolved.declaration.id),
        exportedName: request.exportedName,
        kind: /** @type {const} */ ("Export"),
        location: request.location,
        sourceProvenance: sourceAssociation(request.location, {
          declaration: request.declarationLocation ?? request.location,
          exportedName: request.exportedNameLocation ?? request.location,
          localName: request.localNameLocation ?? request.location
        }, sourceId),
        symbolKind: resolved.symbolKind
      }
    })
    const exportedNames = new Set()

    for (const exported of exports) {
      if (exportedNames.has(exported.exportedName)) {
        semanticFailure(source.language, "DUPLICATE_EXPORT", `Duplicate export '${exported.exportedName}'.`, exported.location)
      }
      exportedNames.add(exported.exportedName)
    }

    const {entryPoint, ...moduleWithoutEntry} = raw
    const module = /** @type {import("../semantic/types.js").SemanticProgramModule} */ ({
      ...moduleWithoutEntry,
      ...(source.id == input.entryModule ? {entryPoint} : {}),
      exports,
      id: source.id,
      imports,
      ...(source.facade ? {stdlibFacade: {identity: source.facade.identity, version: source.facade.version}} : {}),
      sourceFilename: source.filename
    })

    if (source.facade) validateParsedFacade(source.facade, module)

    parsed.set(source.id, module)
  }

  return {
    entryModule: input.entryModule,
    kind: "Program",
    modules: orderedIds.map((id) => /** @type {import("../semantic/types.js").SemanticProgramModule} */ (parsed.get(id))),
    ...(requestedAuthority ? {
      stdlibContract: {
        identity: requestedAuthority.id,
        ...(requestedAuthority.contractVersion !== undefined ? {contractVersion: requestedAuthority.contractVersion} : {})
      }
    } : facadeAuthority ? {stdlibContract: facadeAuthority.contract} : {}),
    ...(facadeRecords.length > 0 ? {stdlibFacades: stdlibFacadeProgramDescriptor(applicationSources[0].language, facadeRecords)} : {}),
    sources: registeredSources
  }
}

/**
 * Resolves parser-owned native module and symbol evidence to facade roots.
 * Mutating the private header requests keeps the proof attached to the exact import node.
 * @param {ProgramSource[]} sources - Caller-owned sources.
 * @param {Map<string, ProgramHeader>} headers - Parser-owned source headers.
 * @returns {import("../stdlib-facades.js").StdlibFacadeRecord[]} Selected facade roots.
 */
function resolveFacadeImports(sources, headers) {
  /** @type {import("../stdlib-facades.js").StdlibFacadeRecord[]} */
  const roots = []

  for (const source of sources) {
    const header = requiredMapValue(headers, source.id)

    if (source.language == "php") {
      for (const binding of header.bindings ?? []) {
        const parts = binding.nativeName.split("\\")
        const symbol = /** @type {string} */ (parts.pop())
        const nativeModule = parts.join("\\")

        if (!nativeModule.startsWith("Semantifold\\Task036\\")) continue
        const facade = resolveFacadeAt(source, nativeModule, symbol, binding.location)

        header.imports.push({
          declarationLocation: binding.location,
          facade,
          importedName: "*",
          importedNameLocation: binding.location,
          localName: "",
          localNameLocation: binding.location,
          location: binding.location,
          namespace: true,
          pathLocation: binding.location,
          specifier: nativeModule,
          stdlibCandidate: true,
          typeOnly: false
        })
        roots.push(facade)
      }
    }

    for (const request of header.imports) {
      const javaCandidate = source.language == "java" && request.specifier.startsWith("semantifold.task036.")

      if (!request.stdlibCandidate && !javaCandidate) continue
      if (request.facade) continue
      if (/\.(?:bundle|dll|node|so)$/iu.test(request.specifier)) {
        facadeFailure(source.language, "STDLIB_FACADE_NATIVE_EXTENSION_UNSUPPORTED",
          "Native-extension loading cannot participate in a portable stdlib facade.", request.pathLocation)
      }
      const supplied = [...headers.entries()].find(([, candidate]) => candidate.nativeName == request.specifier)

      if (supplied) {
        facadeFailure(source.language, "STDLIB_FACADE_SHADOWED",
          `Caller-supplied module '${supplied[0]}' replaces the catalogued native facade identity '${request.specifier}'.`, request.pathLocation)
      }
      const facade = request.namespace
        ? resolveFacadeModuleAt(source, request.specifier, request.pathLocation)
        : resolveFacadeAt(source, request.specifier, request.importedName, request.importedNameLocation ?? request.location)

      request.facade = facade
      roots.push(facade)
    }
  }

  return roots
}

/**
 * Resolves one exact native module and symbol while preserving parser location.
 * @param {ProgramSource} source - Importing source.
 * @param {string} nativeModule - Parser-proved native module identity.
 * @param {string} symbol - Parser-proved native symbol.
 * @param {import("../semantic/types.js").SourceLocation} location - Identity evidence location.
 * @returns {import("../stdlib-facades.js").StdlibFacadeRecord} Located exact native facade resolution.
 */
function resolveFacadeAt(source, nativeModule, symbol, location) {
  try {
    return stdlibFacadeRegistry.resolveFacade(source.language, nativeModule, symbol)
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) facadeFailure(source.language, error.code, error.detail, location)
    throw error
  }
}

/**
 * Resolves one exact namespace-style native module while preserving parser location.
 * @param {ProgramSource} source - Importing source.
 * @param {string} nativeModule - Parser-proved native module identity.
 * @param {import("../semantic/types.js").SourceLocation} location - Identity evidence location.
 * @returns {import("../stdlib-facades.js").StdlibFacadeRecord} Located exact native facade-module resolution.
 */
function resolveFacadeModuleAt(source, nativeModule, location) {
  try {
    return stdlibFacadeRegistry.resolveModule(source.language, nativeModule)
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) facadeFailure(source.language, error.code, error.detail, location)
    throw error
  }
}

/**
 * Rejects caller capture of compiler-owned module/source/native names and imported bindings.
 * @param {ProgramSource[]} applicationSources - Caller-owned sources.
 * @param {Map<string, ProgramHeader>} headers - Caller parser headers.
 * @param {ProgramSource[]} facadeSources - Selected compiler-owned facade sources.
 * @returns {void}
 */
function validateFacadeCollisions(applicationSources, headers, facadeSources) {
  const facadeIds = new Set(facadeSources.map(({id}) => id))
  const facadeFilenames = new Set(facadeSources.map(({filename}) => filename))
  const facadeNativeNames = new Set(facadeSources.map((source) => inspectSource(source).nativeName).filter(Boolean))

  for (const source of applicationSources) {
    const header = requiredMapValue(headers, source.id)

    if (facadeIds.has(source.id) || facadeFilenames.has(source.filename)) {
      facadeFailure(source.language, "STDLIB_FACADE_NAME_COLLISION",
        `Caller module '${source.id}' collides with a compiler-owned facade module or source path.`, moduleLocation(source.filename, source.source))
    }
    if (header.nativeName && facadeNativeNames.has(header.nativeName)) {
      facadeFailure(source.language, "STDLIB_FACADE_REOPENED",
        `Caller source reopens the compiler-owned facade native identity '${header.nativeName}'.`, moduleLocation(source.filename, source.source))
    }
    const importedBindings = new Set(header.imports.filter(({facade}) => facade && !facade.publicDeclarations.some(({name}) => name == ""))
      .flatMap((request) => request.namespace && source.language == "php"
        ? (header.bindings ?? []).filter(({nativeName}) => nativeName.startsWith(`${request.specifier}\\`)).map(({localName}) => localName)
        : request.namespace ? [] : [request.localName]))
    const shadowed = header.exports.find(({localName}) => importedBindings.has(localName))

    if (shadowed) facadeFailure(source.language, "STDLIB_FACADE_SHADOWED",
      `Local declaration '${shadowed.localName}' shadows a parser-proved stdlib facade binding.`, shadowed.location)
  }
}

/**
 * Validates a parsed compiler-owned facade against its registry declaration and canonical-only requirements.
 * @param {import("../stdlib-facades.js").StdlibFacadeRecord} facade - Selected facade record.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Parsed semantic module.
 * @returns {void}
 */
function validateParsedFacade(facade, module) {
  const exported = new Map(module.exports.map((item) => [item.exportedName, item]))

  for (const declaration of facade.publicDeclarations) {
    const exportedDeclaration = exported.get(declaration.name)
    const parsed = exportedDeclaration ? module.functions.find(({id}) => id == exportedDeclaration.declarationId) : undefined
    const signatureMatches = parsed && parsed.parameters.length == declaration.parameters.length &&
      parsed.parameters.every((parameter, index) => parameter.name == declaration.parameters[index].name &&
        semanticTypeName(parameter.type) == declaration.parameters[index].type) &&
      semanticTypeName(parsed.returnType) == declaration.returnType

    if (!signatureMatches) facadeFailure(facade.language, "STDLIB_FACADE_DECLARATION_MISMATCH",
      `Facade '${facade.identity}' executable source does not match public declaration '${declaration.name}'.`, parsed?.location ?? module.location)
  }
  const dependencyIds = new Set(facade.dependencies.map((dependency) =>
    stdlibFacadeRegistry.resolveIdentity(dependency.identity, facade.language, dependency.range).source.id))

  if (module.imports.some(({moduleId}) => !dependencyIds.has(moduleId)) ||
    [...dependencyIds].some((moduleId) => !module.imports.some((imported) => imported.moduleId == moduleId))) {
    facadeFailure(facade.language, "STDLIB_FACADE_DECLARATION_MISMATCH",
      `Facade '${facade.identity}' executable imports do not match its declared dependencies.`, module.location)
  }
  const allowedOperations = new Set(facade.requirements.flatMap(({operations}) => operations))
  const operationNames = new Map((module.capabilities ?? []).flatMap(({operations}) => operations.map(({id, name}) => [id, name])))
  const usedOperations = collectEffectOperations(module, operationNames)

  if ([...usedOperations].some((operation) => !allowedOperations.has(operation)) ||
    [...allowedOperations].some((operation) => !usedOperations.has(operation))) {
    facadeFailure(facade.language, "STDLIB_FACADE_AUTHORITY_FORGED",
      `Facade '${facade.identity}' canonical calls do not match its declared requirements.`, module.location)
  }
}

/**
 * Collects canonical operation names reached in one facade module.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Parsed facade module.
 * @param {Map<string, string>} operationNames - Canonical names by operation identity.
 * @returns {Set<string>} Used operation names.
 */
function collectEffectOperations(module, operationNames) {
  const used = new Set()
  const seen = new WeakSet()

  /**
   * Visits one semantic subtree without following authority or provenance graphs.
   * @param {unknown} value - Semantic subtree.
   * @returns {void}
   */
  function visit(value) {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    if (!Array.isArray(value) && Reflect.get(value, "kind") == "EffectCallExpression") {
      const name = operationNames.get(Reflect.get(value, "operation"))

      if (name) used.add(name)
    }
    for (const [key, child] of Object.entries(value)) {
      if (key != "capabilities" && key != "location" && key != "provenance" && key != "sourceProvenance") visit(child)
    }
  }
  visit(module)
  return used
}

/**
 * Converts one parsed semantic type to the facade declaration vocabulary.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Parsed type.
 * @returns {string} Closed canonical public type name.
 */
function semanticTypeName(type) {
  if (type.kind == "TypeReference") return type.name
  return type.kind == "OptionalType" && type.valueType.kind == "TypeReference"
    ? `optional:${type.valueType.name}` : "unsupported"
}

/**
 * Throws one stable located facade diagnostic.
 * @param {string} language - Source language.
 * @param {string} code - Stable diagnostic code.
 * @param {string} message - Diagnostic detail.
 * @param {import("../semantic/types.js").SourceLocation | undefined} location - Parser-owned location.
 * @returns {never} Always throws.
 */
function facadeFailure(language, code, message, location) {
  throw new SemantifoldDiagnostic({code, language, location, message})
}

/**
 * Rejects source-profile identities whose lookup or reopening would depend on caller order.
 * @param {ProgramSource[]} sources - Complete validated source set.
 * @param {Map<string, ProgramHeader>} headers - Parser-owned module headers.
 * @returns {void}
 */
function validateNativeModuleIdentities(sources, headers) {
  if (!sources.every(({language}) => language == "java") && !sources.every(({language}) => language == "ruby")) return
  const ordered = [...sources].sort((left, right) => left.filename.localeCompare(right.filename, "en-US") ||
    left.id.localeCompare(right.id, "en-US"))
  const owners = new Map()

  for (const source of ordered) {
    const nativeName = requiredMapValue(headers, source.id).nativeName

    if (!nativeName) continue
    const earlier = owners.get(nativeName)

    if (earlier) {
      const label = source.language == "java" ? "Java" : "Ruby"

      semanticFailure(source.language, "DUPLICATE_MODULE",
        `Duplicate ${label} native module identity '${nativeName}' in '${earlier.filename}' and '${source.filename}'.`,
        moduleLocation(source.filename, source.source))
    }
    owners.set(nativeName, source)
  }
}

/**
 * Validates and snapshots one caller-supplied program source descriptor.
 * @param {unknown} candidate - Candidate source descriptor.
 * @param {number} index - Source index.
 * @returns {ProgramSource} Validated source descriptor.
 */
function validateSource(candidate, index) {
  if (!isPlainObject(candidate)) {
    return invalidProgram(`Program source ${index} requires a stable module ID, safe filename, language, and source text.`)
  }
  if (!isPlainObject(candidate) || typeof candidate.id != "string" || !moduleIdPattern.test(candidate.id) ||
    typeof candidate.filename != "string" || !isSafeArtifactPath(candidate.filename) ||
    typeof candidate.source != "string" || typeof candidate.language != "string") {
    invalidProgram(`Program source ${index} requires a stable module ID, safe filename, language, and source text.`)
  }
  languageRegistry.record(candidate.language)
  if (!programLanguages.has(candidate.language)) unsupportedRole(candidate.language, "multi-file frontend")

  return /** @type {ProgramSource} */ ({
    filename: candidate.filename,
    id: candidate.id,
    language: candidate.language,
    ownership: "application",
    source: candidate.source
  })
}

/**
 * Dispatches parser-owned module header inspection for one cohort source.
 * @param {{filename: string, language: import("../semantic/types.js").SemanticLanguage, source: string}} source - Validated source.
 * @returns {ProgramHeader} Parser-owned import/export header.
 */
function inspectSource(source) {
  if (source.language == "javascript" || source.language == "typescript") {
    return inspectJavaScriptTypeScriptModule(/** @type {{filename: string, language: "javascript" | "typescript", source: string}} */ (source))
  }
  if (source.language == "ruby") {
    return inspectRubyModule(/** @type {{filename: string, language: "ruby", source: string}} */ (source))
  }
  if (source.language == "php") {
    return inspectPhpModule(/** @type {{filename: string, language: "php", source: string}} */ (source))
  }
  if (source.language == "java") {
    return inspectJavaModule(/** @type {{filename: string, language: "java", source: string}} */ (source))
  }

  return unsupportedRole(source.language, "multi-file frontend")
}

/**
 * Resolves only an explicit relative ESM specifier against caller-supplied filenames.
 * @param {{filename: string, language: import("../semantic/types.js").SemanticLanguage}} source - Importing source.
 * @param {string} specifier - Parser-owned relative specifier.
 * @param {import("../semantic/types.js").SourceLocation} location - Specifier location.
 * @param {Map<string, ProgramSource>} sources - Sources by exact filename.
 * @param {Map<string, ProgramHeader>} headers - Parser-owned module headers.
 * @returns {string} Resolved module identity.
 */
function resolveImportModule(source, specifier, location, sources, headers) {
  if (source.language == "java") {
    const matched = [...headers.entries()].find(([, header]) => header.nativeName == specifier)

    if (!matched) semanticFailure(source.language, "UNRESOLVED_MODULE", `Import '${specifier}' does not identify a supplied source.`, location)

    return matched[0]
  }
  const directory = source.filename.split("/").slice(0, -1)
  const parts = [...directory]

  for (const part of specifier.split("/")) {
    if (part == "" || part == ".") continue
    if (part == "..") {
      if (parts.length == 0) semanticFailure(source.language, "UNSAFE_MODULE_PATH", `Import '${specifier}' escapes the supplied source root.`, location)
      parts.pop()
    } else parts.push(part)
  }
  let exact = parts.join("/")

  if (source.language == "ruby" && !exact.endsWith(".rb")) exact += ".rb"
  const candidates = [exact]

  if (source.language == "typescript" && exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.ts`)
  const matched = candidates.flatMap((filename) => sources.has(filename) ? [sources.get(filename)] : [])[0]

  if (!matched) semanticFailure(source.language, "UNRESOLVED_MODULE", `Import '${specifier}' does not identify a supplied source.`, location)

  return matched.id
}

/**
 * Builds the source-profile spelling used to resolve one namespace-qualified import.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Importing source language.
 * @param {string | undefined} nativeName - Dependency namespace/module name.
 * @param {import("../semantic/types.js").SemanticExport} exported - Imported export.
 * @returns {string} Source-profile binding spelling.
 */
function qualifiedImportName(language, nativeName, exported) {
  if (!nativeName) throw new Error("Namespace import dependency has no parser-owned native name.")
  if (language == "ruby") return `${nativeName}${exported.symbolKind == "function" ? "." : "::"}${exported.exportedName}`
  if (language == "java") {
    const className = nativeName.split(".").at(-1)

    if (!className) throw new Error("Java import dependency has no class name.")

    return exported.symbolKind == "function" ? `${className}.${exported.exportedName}` : className
  }

  throw new Error(`Unsupported namespace import profile '${language}'.`)
}

/**
 * Sorts the explicit module graph in stable dependency-first order.
 * @param {ProgramSource[]} sources - Validated sources.
 * @param {Map<string, {source: ProgramSource, requests: {moduleId: string, location: import("../semantic/types.js").SourceLocation}[]}>} graph - Resolved graph.
 * @returns {string[]} Dependency-first module identities.
 */
function topologicalOrder(sources, graph) {
  const complete = new Set()
  const active = new Set()
  /** @type {string[]} */
  const result = []

  /**
   * Visits one module and its dependencies.
   * @param {string} id - Module identity.
   */
  function visit(id) {
    if (complete.has(id)) return
    if (active.has(id)) {
      const edge = requiredMapValue(graph, id).requests[0]

      semanticFailure(requiredMapValue(graph, id).source.language, "IMPORT_CYCLE", `Import cycle includes module '${id}'.`, edge?.location)
    }
    active.add(id)
    for (const request of requiredMapValue(graph, id).requests) visit(request.moduleId)
    active.delete(id)
    complete.add(id)
    result.push(id)
  }

  for (const source of sources) visit(source.id)

  return result
}

/**
 * Looks up one already-resolved exported declaration.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Exporting module.
 * @param {import("../semantic/types.js").SemanticExport} exported - Resolved export.
 * @returns {import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ErrorDeclaration} Declaration.
 */
function declarationFor(module, exported) {
  const declarations = exported.symbolKind == "function" ? module.functions :
    exported.symbolKind == "record" ? module.records ?? [] : module.errors ?? []
  const declaration = declarations.find(({id}) => id == exported.declarationId)

  if (!declaration) throw new Error(`Resolved export '${exported.declarationId}' has no declaration.`)

  return declaration
}

/**
 * Prefixes module-owned declaration identities and explicit resolved references to them.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated module.
 * @param {string} moduleId - Stable module identity.
 * @returns {void}
 */
function rekeyDeclarations(module, moduleId) {
  const replacements = new Map()

  for (const declaration of module.records ?? []) {
    replacements.set(declaration.id, `${moduleId}#${declaration.id}`)
    for (const parameter of declaration.typeParameters ?? []) {
      if (parameter.id) replacements.set(parameter.id, `${moduleId}#${parameter.id}`)
    }
    for (const field of declaration.fields) replacements.set(field.id, `${moduleId}#${field.id}`)
  }
  for (const declaration of module.errors ?? []) replacements.set(declaration.id, `${moduleId}#${declaration.id}`)
  for (const declaration of module.functions) {
    replacements.set(declaration.id, `${moduleId}#${declaration.id}`)
    for (const parameter of declaration.typeParameters ?? []) {
      if (parameter.id) replacements.set(parameter.id, `${moduleId}#${parameter.id}`)
    }
  }

  for (const declaration of module.records ?? []) {
    declaration.id = replacements.get(declaration.id)
    for (const parameter of declaration.typeParameters ?? []) {
      parameter.id = /** @type {string} */ (replacements.get(/** @type {string} */ (parameter.id)))
    }
    for (const field of declaration.fields) field.id = /** @type {string} */ (replacements.get(field.id))
  }
  for (const declaration of module.errors ?? []) declaration.id = replacements.get(declaration.id)
  for (const declaration of module.functions) {
    declaration.id = replacements.get(declaration.id)
    for (const parameter of declaration.typeParameters ?? []) {
      parameter.id = /** @type {string} */ (replacements.get(/** @type {string} */ (parameter.id)))
    }
  }

  const seen = new WeakSet()
  /**
   * Rewrites only typed identity-bearing fields throughout one semantic subtree.
   * @param {unknown} value - Semantic subtree.
   */
  function visit(value) {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    const object = /** @type {Record<string, unknown>} */ (value)

    if ((object.kind == "RecordType" || object.kind == "ErrorType" || object.kind == "ResolvedFunctionSignature") &&
      typeof object.declarationId == "string" && replacements.has(object.declarationId)) {
      object.declarationId = replacements.get(object.declarationId)
    }
    if (object.kind == "MemberRead" && typeof object.field == "string" && replacements.has(object.field)) {
      object.field = replacements.get(object.field)
    }
    if (object.kind == "TypeVariableReference" && typeof object.parameterId == "string" && replacements.has(object.parameterId)) {
      object.parameterId = replacements.get(object.parameterId)
    }
    for (const child of Object.values(object)) if (typeof child == "object") visit(child)
  }
  visit(module)
}

/**
 * Creates a source association for a parser-owned module header node.
 * @param {import("../semantic/types.js").SourceLocation} location - Node origin.
 * @param {Readonly<Record<string, import("../semantic/types.js").SourceLocation>>} ranges - Exact available header roles.
 * @param {string} sourceId - Program-wide source identity.
 * @returns {import("../semantic/types.js").SemanticNodeSourceProvenance} Source association.
 */
function sourceAssociation(location, ranges, sourceId) {
  return {
    origin: {kind: "source", location, sourceId},
    ranges,
    schema: "SemantifoldNodeProvenance",
    version: 1
  }
}

/**
 * Rebinds one parser-local provenance registry to the complete program source registry.
 * @param {import("../semantic/types.js").SemanticModule} module - Newly parsed module.
 * @param {import("../semantic/types.js").RegisteredSource[]} sources - Program-wide registry.
 * @param {string} sourceId - Owning source identity.
 * @returns {void}
 */
function rebaseParsedModuleProvenance(module, sources, sourceId) {
  if (!module.provenance) throw new Error("Parsed program module has no source provenance.")
  const seen = new WeakSet()

  /**
   * Rebinds source-origin identities throughout one semantic subtree.
   * @param {unknown} value - Semantic subtree.
   */
  function visit(value) {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    const candidate = /** @type {Record<string, unknown>} */ (value)
    const provenance = candidate.sourceProvenance
    const origin = isPlainObject(provenance) ? provenance.origin : undefined

    if (isPlainObject(origin) && origin.kind == "source") origin.sourceId = sourceId
    for (const child of Object.values(candidate)) visit(child)
  }
  visit(module)
  for (const node of module.provenance.nodes) {
    if (node.origin.kind == "source") node.origin.sourceId = sourceId
  }
  module.provenance.sources = sources
}

/**
 * Reports whether a candidate is a direct plain object.
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Reads a value whose map key was validated earlier in program assembly.
 * @template T
 * @param {Map<string, T>} map - Map with a previously validated key.
 * @param {string} key - Required key.
 * @returns {T} Stored value.
 */
function requiredMapValue(map, key) {
  const value = map.get(key)

  if (value === undefined) throw new Error(`Missing validated map value '${key}'.`)

  return value
}

/**
 * Raises a stable malformed program request diagnostic.
 * @param {string} message - Stable request failure detail.
 * @returns {never} Always throws.
 */
function invalidProgram(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_PROGRAM", language: "program", message})
}
