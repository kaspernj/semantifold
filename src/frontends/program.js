// @ts-check

import {isDenseArray} from "../array.js"
import {isSafeArtifactPath} from "../artifact-path.js"
import {SemantifoldDiagnostic, semanticFailure, unsupportedCapability, unsupportedRole} from "../diagnostic.js"
import {languageRegistry} from "../language-registry.js"
import {moduleLocation} from "../semantic/location.js"
import {annotateParsedModule} from "../semantic/provenance.js"
import {moduleUncheckedErrorEffects, validateParsedModule} from "../semantic/validate.js"
import {inspectJavaScriptTypeScriptModule} from "./javascript-typescript.js"
import {inspectJavaModule} from "./java.js"
import {inspectPhpModule} from "./php.js"
import {inspectRubyModule} from "./ruby.js"

const programLanguages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const moduleIdPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z][a-z0-9_]*)*$/u

/** @typedef {{filename: string, id: string, language: import("../semantic/types.js").SemanticLanguage, source: string}} ProgramSource */
/** @typedef {{declarationLocation?: import("../semantic/types.js").SourceLocation, importedName: string, importedNameLocation?: import("../semantic/types.js").SourceLocation, localName: string, localNameLocation?: import("../semantic/types.js").SourceLocation, location: import("../semantic/types.js").SourceLocation, namespace?: boolean, pathLocation: import("../semantic/types.js").SourceLocation, specifier: string, typeOnly: boolean}} ProgramImportRequest */
/** @typedef {{importedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, nativeName: string, symbolKind: import("../semantic/types.js").SemanticDeclarationKind, typeOnly: boolean}} ProgramNativeBinding */
/** @typedef {{imports: ProgramImportRequest[], exports: {declarationLocation?: import("../semantic/types.js").SourceLocation, exportedName: string, exportedNameLocation?: import("../semantic/types.js").SourceLocation, localName: string, localNameLocation?: import("../semantic/types.js").SourceLocation, location: import("../semantic/types.js").SourceLocation, typeOnly: boolean}[], bindings?: ProgramNativeBinding[], nativeName?: string}} ProgramHeader */

/**
 * Parses an explicit caller-supplied multi-source program without filesystem discovery.
 * @param {object} input - Program parse request.
 * @param {string} input.entryModule - Sole entry module identity.
 * @param {{filename: string, id: string, language: import("../semantic/types.js").SemanticLanguage, source: string}[]} input.sources - Complete source set.
 * @returns {import("../semantic/types.js").SemanticProgram} Resolved semantic program.
 */
export function parseProgramSource(input) {
  if (!isPlainObject(input) || !isDenseArray(input.sources) || input.sources.length == 0 ||
    typeof input.entryModule != "string") invalidProgram("Program parsing requires a non-empty ordered source set and entry module.")

  const sources = input.sources.map((source, index) => validateSource(source, index))
  if (Object.hasOwn(input, "capabilityAuthority")) {
    unsupportedCapability(sources[0].language, "Task 034 capabilities are single-module only",
      moduleLocation(sources[0].filename, sources[0].source))
  }
  const registeredSources = sources.map((source, index) => ({
    content: source.source,
    filename: source.filename,
    id: `source:${index}`,
    language: source.language
  }))
  const sourceIds = new Map(sources.map((source, index) => [source.id, `source:${index}`]))
  const sourceLanguages = new Set(sources.map(({language}) => language))

  if (sourceLanguages.size != 1) {
    semanticFailure(sources[0].language, "MIXED_SOURCE_LANGUAGES", "A semantic program must use one source-language compatibility profile.", undefined)
  }
  const byId = new Map()
  const byFilename = new Map()

  for (const source of sources) {
    if (byId.has(source.id)) semanticFailure(source.language, "DUPLICATE_MODULE", `Duplicate module identity '${source.id}'.`, undefined)
    if (byFilename.has(source.filename)) semanticFailure(source.language, "DUPLICATE_MODULE", `Duplicate module filename '${source.filename}'.`, undefined)
    byId.set(source.id, source)
    byFilename.set(source.filename, source)
  }
  if (!byId.has(input.entryModule)) {
    semanticFailure(sources[0].language, "INVALID_ENTRY_MODULE", `Unknown entry module '${input.entryModule}'.`, undefined)
  }

  const headers = new Map(sources.map((source) => [source.id, inspectSource(source)]))

  validateNativeModuleIdentities(sources, headers)
  /** @type {Map<string, {source: typeof sources[number], requests: (ReturnType<typeof inspectSource>["imports"][number] & {moduleId: string})[]}>} */
  const graph = new Map()

  for (const source of sources) {
    const requests = requiredMapValue(headers, source.id).imports.map((request) => ({
      ...request,
      moduleId: resolveImportModule(source, request.specifier, request.pathLocation, byFilename, headers)
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
      const nativeBindings = source.language == "php" && request.namespace
        ? (header.bindings ?? []).filter(({nativeName}) => nativeName.startsWith(`${dependencyHeader.nativeName}\\`))
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

        if (!request.namespace || nativeBinding) {
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
    const raw = frontend({
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
      sourceFilename: source.filename
    })

    parsed.set(source.id, module)
  }

  return {
    entryModule: input.entryModule,
    kind: "Program",
    modules: orderedIds.map((id) => /** @type {import("../semantic/types.js").SemanticProgramModule} */ (parsed.get(id))),
    sources: registeredSources
  }
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
