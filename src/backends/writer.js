// @ts-check

import {createGenerationIndex} from "../semantic/provenance.js"

/**
 * Converts a logical module identity to its canonical target type segment.
 * @param {string} id - Logical module identity.
 * @returns {string} Portable target class/module name.
 */
function moduleClassName(id) {
  return id.split(/[._-]+/u).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("")
}

/**
 * Looks up one declaration name in its owning program module.
 * @param {Partial<import("../semantic/types.js").SemanticProgramModule>} module - Owning module.
 * @param {string} declarationId - Stable declaration identity.
 * @returns {string} Declaration name.
 */
function declarationName(module, declarationId) {
  const declaration = [...module.functions ?? [], ...module.records ?? [], ...module.errors ?? []].find(({id}) => id == declarationId)

  if (!declaration) throw new RangeError(`Unknown program declaration '${declarationId}'.`)

  return declaration.name
}

/**
 * Chooses an unqualified target binding without treating a source-profile qualifier as semantic identity.
 * @param {import("../semantic/types.js").SemanticProgram} program - Owning program.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Importing module.
 * @param {import("../semantic/types.js").SemanticImport} imported - Resolved import.
 * @returns {string} Target-local binding spelling.
 */
export function programImportName(program, module, imported) {
  const source = program.sources.find(({filename}) => filename == module.sourceFilename)

  if (!source) throw new RangeError(`Program module '${module.id}' has no registered source.`)

  return source.language == "ruby" || source.language == "java" ? imported.importedName : imported.localName
}

/** Source-aware deterministic generated-output builder. */
export class SourceWriter {
  /**
   * Creates a source-aware writer.
   * @param {object} options - Writer options.
   * @param {string} options.filename - Output filename.
   * @param {import("../semantic/types.js").GeneratedTextLanguage} options.language - Output text language.
   * @param {import("../semantic/types.js").SemanticModule} options.module - Semantic module.
   * @param {import("../semantic/types.js").SemanticProgram} [options.program] - Owning multi-file program.
   * @param {Map<string, string>} [options.programPaths] - Planned artifact path by module identity.
   * @param {{filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]} [options.sources] - Caller-provided sources.
   */
  constructor({filename, language, module, program, programPaths, sources}) {
    const index = createGenerationIndex(module, sources)

    this.filename = filename
    this.language = language
    this.module = module
    this.program = program
    this.programPaths = programPaths
    this.index = index
    const programRecords = program?.modules.flatMap((programModule) => programModule.records ?? []) ?? module.records ?? []
    const programClasses = program ? [] : module.classes ?? []
    const programErrors = program?.modules.flatMap((programModule) => programModule.errors ?? []) ?? module.errors ?? []
    const programFunctions = program?.modules.flatMap((programModule) => programModule.functions) ?? module.functions

    this.records = new Map(programRecords.map((record) => [record.id, record]))
    this.classes = new Map(programClasses.map((declaration) => [declaration.id, declaration]))
    this.errors = new Map(programErrors.map((error) => [error.id, error]))
    this.fields = new Map(programRecords.flatMap((record) => record.fields.map((field) => [field.id, field])))
    this.fieldRecords = new Map(programRecords.flatMap((record) => record.fields.map((field) => [field.id, record])))
    this.privateFields = new Map(programClasses.flatMap((declaration) => declaration.fields.map((field) => [field.id, field])))
    this.methods = new Map(programClasses.flatMap((declaration) => declaration.methods.map((method) => [method.id, method])))
    this.typeParameters = new Map([...programRecords, ...programFunctions].flatMap((declaration) =>
      (declaration.typeParameters ?? []).map((parameter) => [parameter.id, parameter])))
    this.referenceClassEmissionDepth = 0
    /** @type {Map<string, import("../semantic/types.js").SemanticProgramModule>} */
    this.declarationModules = new Map(program?.modules.flatMap((programModule) => [
      ...(programModule.records ?? []).map((declaration) => /** @type {const} */ ([/** @type {string} */ (declaration.id), programModule])),
      ...(programModule.errors ?? []).map((declaration) => /** @type {const} */ ([/** @type {string} */ (declaration.id), programModule])),
      ...programModule.functions.map((declaration) => /** @type {const} */ ([/** @type {string} */ (declaration.id), programModule]))
    ]) ?? [])
    /** @type {string[]} */
    this.parts = []
    /** @type {import("../semantic/types.js").SemantifoldMappingSpan[]} */
    this.spans = []
    this.offset = 0
    this.line = 1
    this.column = 1
  }

  /**
   * Returns generated content so far.
   * @returns {string} Generated content.
   */
  get code() {
    return this.parts.join("")
  }

  /**
   * Returns the current JSON Pointer for one unambiguous semantic occurrence.
   * @param {import("../semantic/types.js").SemanticNode} node - Semantic node occurrence.
   * @returns {string} Current occurrence path.
   */
  occurrencePath(node) {
    return this.index.recordFor(node).path
  }

  /**
   * Resolves a validated nominal declaration identity for target emission.
   * @param {string} declarationId - Semantic record identity.
   * @returns {import("../semantic/types.js").RecordDeclaration} Record declaration.
   */
  recordForId(declarationId) {
    const record = this.records.get(declarationId)

    if (!record) throw new RangeError(`Unknown validated record identity '${declarationId}'.`)

    return record
  }

  /**
   * Returns the target spelling for a nominal record identity.
   * @param {string} declarationId - Stable record declaration identity.
   * @param {boolean} [valuePosition] - Whether the binding must exist at runtime.
   * @returns {string} Target record spelling.
   */
  recordNameForId(declarationId, valuePosition = false) {
    const record = this.recordForId(declarationId)
    const owner = this.declarationModules.get(declarationId)
    const imported = this.#programModule()?.imports.find((item) =>
      item.declarationId == declarationId && (!valuePosition || !item.typeOnly))

    if (this.program && owner && owner.id != Reflect.get(this.module, "id") && this.language == "ruby") {
      return `${moduleClassName(owner.id)}::${record.name}`
    }
    if (imported && (this.language == "javascript" || this.language == "typescript" || this.language == "php")) {
      return this.importNameFor(imported)
    }

    return record.name
  }

  /**
   * Resolves one validated reference class.
   * @param {string} declarationId - Stable class identity.
   * @returns {import("../semantic/types.js").ClassDeclaration} Class declaration.
   */
  classForId(declarationId) {
    const declaration = this.classes.get(declarationId)

    if (!declaration) throw new RangeError(`Unknown validated reference class identity '${declarationId}'.`)

    return declaration
  }

  /**
   * Returns the target spelling of one reference class.
   * @param {string} declarationId - Stable class identity.
   * @returns {string} Target spelling.
   */
  classNameForId(declarationId) {
    return this.classForId(declarationId).name
  }

  /**
   * Resolves one validated private field.
   * @param {string} fieldId - Stable private-field identity.
   * @returns {import("../semantic/types.js").PrivateField} Field declaration.
   */
  privateFieldForId(fieldId) {
    const field = this.privateFields.get(fieldId)

    if (!field) throw new RangeError(`Unknown validated private field identity '${fieldId}'.`)

    return field
  }

  /**
   * Resolves one validated receiver method.
   * @param {string} methodId - Stable method identity.
   * @returns {import("../semantic/types.js").MethodDeclaration} Method declaration.
   */
  methodForId(methodId) {
    const method = this.methods.get(methodId)

    if (!method) throw new RangeError(`Unknown validated method identity '${methodId}'.`)

    return method
  }

  /**
   * Resolves one validated declaration-scoped type parameter.
   * @param {string} parameterId - Stable type-parameter identity.
   * @returns {import("../semantic/types.js").TypeParameter} Type parameter.
   */
  typeParameterForId(parameterId) {
    const parameter = this.typeParameters.get(parameterId)

    if (!parameter) throw new RangeError(`Unknown validated type parameter identity '${parameterId}'.`)

    return parameter
  }

  /**
   * Returns the validated nominal error declaration for an identity.
   * @param {string} declarationId - Stable error identity.
   * @returns {import("../semantic/types.js").ErrorDeclaration} Error declaration.
   */
  errorForId(declarationId) {
    const error = this.errors.get(declarationId)

    if (!error) throw new RangeError(`Unknown validated error identity '${declarationId}'.`)

    return error
  }

  /**
   * Returns the target-visible spelling for one nominal error identity.
   * @param {string} declarationId - Stable error identity.
   * @returns {string} Target-visible name.
   */
  errorNameForId(declarationId) {
    const error = this.errorForId(declarationId)
    const owner = this.declarationModules.get(declarationId)
    const imported = this.#programModule()?.imports.find((item) => item.declarationId == declarationId)

    if (this.program && owner && owner.id != Reflect.get(this.module, "id") && this.language == "ruby") {
      return `${moduleClassName(owner.id)}::${error.name}`
    }
    if (imported && (this.language == "javascript" || this.language == "typescript" || this.language == "php")) {
      return this.importNameFor(imported)
    }

    return error.name
  }

  /**
   * Returns the target spelling for a resolved function call.
   * @param {import("../semantic/types.js").CallExpression} expression - Resolved call.
   * @returns {string} Target call name.
   */
  callNameFor(expression) {
    const declarationId = expression.resolution?.declarationId
    const owner = declarationId ? this.declarationModules.get(declarationId) : undefined
    const imported = declarationId ? this.#programModule()?.imports.find((item) => item.declarationId == declarationId) : undefined

    if (this.language == "java" && !this.program && this.referenceClassEmissionDepth > 0) return `Main.${expression.callee}`
    if (!declarationId || !this.program || !owner || owner.id == Reflect.get(this.module, "id")) return expression.callee
    if (this.language == "ruby" || this.language == "java") return `${moduleClassName(owner.id)}.${declarationName(owner, declarationId)}`
    if (imported) return this.importNameFor(imported)

    return declarationName(owner, declarationId)
  }

  /** Marks emission as occurring inside one top-level reference class. */
  beginReferenceClassEmission() {
    this.referenceClassEmissionDepth += 1
  }

  /** Ends one balanced top-level reference-class emission scope. */
  endReferenceClassEmission() {
    if (this.referenceClassEmissionDepth == 0) throw new RangeError("Reference-class emission scope is not active.")
    this.referenceClassEmissionDepth -= 1
  }

  /**
   * Returns the target-local binding for one resolved import.
   * @param {import("../semantic/types.js").SemanticImport} imported - Resolved import.
   * @returns {string} Emitted import name.
   */
  importNameFor(imported) {
    const module = this.#programModule()

    if (!this.program || !module) throw new RangeError("Import names require a validated semantic program.")

    return programImportName(this.program, module, imported)
  }

  /**
   * Reports whether one local declaration is exported by the current program module.
   * @param {string | undefined} declarationId - Declaration identity.
   * @returns {boolean} Whether it has a same-name program export.
   */
  isDirectlyExported(declarationId) {
    const module = /** @type {Partial<import("../semantic/types.js").SemanticProgramModule>} */ (this.module)

    return typeof declarationId == "string" && Boolean(module.exports?.some((item) =>
      item.declarationId == declarationId && item.exportedName == declarationName(module, declarationId)))
  }

  /**
   * Reports whether one export edge uses its declaration's emitted name.
   * @param {import("../semantic/types.js").SemanticExport} exported - Current export edge.
   * @returns {boolean} Whether this edge is represented by the declaration prefix.
   */
  isDirectExport(exported) {
    return exported.exportedName == declarationName(this.module, exported.declarationId)
  }

  /**
   * Reports whether one local declaration has any public program export.
   * @param {string | undefined} declarationId - Declaration identity.
   * @returns {boolean} Whether the declaration is exported.
   */
  isExported(declarationId) {
    const module = /** @type {Partial<import("../semantic/types.js").SemanticProgramModule>} */ (this.module)

    return typeof declarationId == "string" && Boolean(module.exports?.some((item) => item.declarationId == declarationId))
  }

  /**
   * Returns whether this is the selected program entry module.
   * @returns {boolean} Whether this writer owns the selected entry.
   */
  isProgramEntry() {
    return this.program?.entryModule == Reflect.get(this.module, "id")
  }

  /**
   * Returns the canonical class/module segment for a logical module identity.
   * @param {string} moduleId - Logical module identity.
   * @returns {string} Target class/module name.
   */
  programModuleName(moduleId) {
    if (!this.program?.modules.some(({id}) => id == moduleId)) throw new RangeError(`Unknown program module '${moduleId}'.`)

    return moduleClassName(moduleId)
  }

  /**
   * Finds the current module in the complete program.
   * @returns {import("../semantic/types.js").SemanticProgramModule | undefined} Current program module.
   */
  #programModule() {
    if (!this.program) return undefined

    return this.program.modules.find(({id}) => id == Reflect.get(this.module, "id"))
  }

  /**
   * Returns a relative ESM/require specifier for a planned dependency artifact.
   * @param {string} moduleId - Dependency module identity.
   * @param {string} [extension] - Optional replacement extension.
   * @returns {string} Relative POSIX specifier.
   */
  relativeModuleSpecifier(moduleId, extension) {
    const targetPath = this.programPaths?.get(moduleId)

    if (!targetPath) throw new RangeError(`Unknown planned module path '${moduleId}'.`)
    const adjustedTarget = extension ? targetPath.replace(/\.[^./]+$/u, extension) : targetPath
    const from = this.filename.split("/").slice(0, -1)
    const to = adjustedTarget.split("/")
    let common = 0

    while (common < from.length && common < to.length && from[common] == to[common]) common++
    const relative = [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/")

    return relative.startsWith(".") ? relative : `./${relative}`
  }

  /**
   * Resolves a validated field identity for target emission.
   * @param {string} fieldId - Semantic field identity.
   * @returns {import("../semantic/types.js").RecordField} Record field.
   */
  fieldForId(fieldId) {
    const field = this.fields.get(fieldId)

    if (!field) throw new RangeError(`Unknown validated field identity '${fieldId}'.`)

    return field
  }

  /**
   * Resolves the record declaration that owns a validated field identity.
   * @param {string} fieldId - Semantic field identity.
   * @returns {import("../semantic/types.js").RecordDeclaration} Owning record.
   */
  recordForFieldId(fieldId) {
    const record = this.fieldRecords.get(fieldId)

    if (!record) throw new RangeError(`Unknown validated field identity '${fieldId}'.`)

    return record
  }

  /**
   * Reports whether an exact parser-owned role range is available.
   * @param {import("../semantic/types.js").SemanticNode} node - Semantic node occurrence.
   * @param {string} path - JSON Pointer for a shared node occurrence.
   * @param {string} role - Semantic token role.
   * @returns {boolean} Whether the role has an exact source range.
   */
  hasRange(node, path, role) {
    return this.index.recordFor(node, path).ranges[role] !== undefined
  }

  /**
   * Writes text mapped to a semantic node.
   * @param {string} text - Generated text.
   * @param {object} annotation - Mapping annotation.
   * @param {import("../semantic/types.js").SemanticNode} annotation.node - Semantic node.
   * @param {"exact" | "anchor"} annotation.mappingKind - Mapping precision.
   * @param {string} [annotation.role] - Semantic token role.
   * @param {string} [annotation.name] - Source Map name.
   * @param {string} [annotation.path] - JSON Pointer for a shared node occurrence.
   * @returns {void}
   */
  mapped(text, {mappingKind, name, node, path, role}) {
    if (text.length == 0) return

    const record = this.index.recordFor(node, path)
    const roleLocation = role ? record.ranges[role] : undefined
    const origin = roleLocation ? this.#sourceOrigin(roleLocation, record.origin) : record.origin
    const precision = mappingKind == "exact" && role && !roleLocation ? "anchor" : mappingKind
    const symbol = record.symbolId
      ? this.index.provenance.symbols.find((candidate) => candidate.id == record.symbolId)
      : undefined

    this.#append(text, {
      mappingKind: precision,
      name: name ?? symbol?.name,
      nodeId: record.id,
      origin,
      role,
      symbolId: record.symbolId
    })
  }

  /**
   * Writes source-free scaffolding with optional semantic context.
   * @param {string} text - Generated text.
   * @param {string} reason - Stable reason.
   * @param {import("../semantic/types.js").SemanticNode[]} [relatedNodes] - Related nodes.
   * @param {(string | undefined)[]} [relatedPaths] - Occurrence paths for shared related nodes.
   * @returns {void}
   */
  synthetic(text, reason, relatedNodes = [], relatedPaths = []) {
    if (text.length == 0) return

    /** @type {Set<string>} */
    const seen = new Set()
    const relatedOrigins = relatedNodes.flatMap((node, index) => {
      const record = this.index.recordFor(node, relatedPaths[index])

      return relatedOriginsFor(record.origin).flatMap((related) => {
        const contextual = {
          ...related,
          nodeId: related.nodeId ?? record.id,
          role: related.role ?? "context"
        }
        const key = relatedOriginKey(contextual)

        if (seen.has(key)) return []
        seen.add(key)

        return [contextual]
      })
    })

    this.#append(text, {mappingKind: "synthetic", origin: {kind: "synthetic", reason, relatedOrigins}})
  }

  /**
   * Returns the authoritative rich map for the current content.
   * @returns {import("../semantic/types.js").SemantifoldMapping} Mapping.
   */
  finish() {
    return {
      coordinateSystem: "utf16",
      generated: {content: this.code, filename: this.filename, language: this.language},
      nodes: [...this.index.provenance.nodes],
      schema: "SemantifoldMapping",
      sources: [...this.index.provenance.sources],
      spans: [...this.spans],
      symbols: [...this.index.provenance.symbols],
      version: 1
    }
  }

  /**
   * Appends one mapped span.
   * @param {string} text - Generated text.
   * @param {Omit<import("../semantic/types.js").SemantifoldMappingSpan, "generated">} annotation - Span annotation.
   * @returns {void}
   */
  #append(text, annotation) {
    if (text.includes("\r")) throw new TypeError("Generated output must use deterministic LF line endings.")

    const start = {column: this.column, line: this.line, offset: this.offset}

    this.parts.push(text)
    for (let index = 0; index < text.length; index++) {
      this.offset++
      if (text[index] == "\n") {
        this.line++
        this.column = 1
      } else this.column++
    }
    const compact = /** @type {Omit<import("../semantic/types.js").SemantifoldMappingSpan, "generated">} */ (
      Object.fromEntries(Object.entries(annotation).filter(([, value]) => value !== undefined))
    )

    this.spans.push({
      ...compact,
      generated: {
        end: {column: this.column, line: this.line, offset: this.offset},
        filename: this.filename,
        start
      }
    })
  }

  /**
   * Creates a direct role origin using canonical source identities.
   * @param {import("../semantic/types.js").SourceLocation} location - Exact role range.
   * @param {import("../semantic/types.js").SemanticOrigin} fallback - Owning origin.
   * @returns {import("../semantic/types.js").SemanticOrigin} Role origin.
   */
  #sourceOrigin(location, fallback) {
    /** @type {string | undefined} */
    let fallbackSourceId

    if (fallback.kind == "source" && fallback.location.filename == location.filename) fallbackSourceId = fallback.sourceId
    else if (fallback.kind == "derived") {
      fallbackSourceId = fallback.origins.find((origin) => origin.location.filename == location.filename)?.sourceId
    } else if (fallback.kind == "synthetic") {
      fallbackSourceId = fallback.relatedOrigins.find((origin) => origin.location.filename == location.filename)?.sourceId
    }
    const source = this.index.provenance.sources.find((candidate) => candidate.id == fallbackSourceId) ??
      this.index.provenance.sources.find((candidate) => candidate.filename == location.filename)

    return source ? {kind: "source", location, sourceId: source.id} : fallback
  }
}

/**
 * Expands every closed provenance range in semantic order.
 * @param {import("../semantic/types.js").SemanticOrigin} origin - Closed provenance.
 * @returns {import("../semantic/types.js").RelatedOrigin[]} Related ranges.
 */
function relatedOriginsFor(origin) {
  if (origin.kind == "source") return [{location: origin.location, sourceId: origin.sourceId}]
  if (origin.kind == "derived") return origin.origins

  return origin.relatedOrigins
}

/**
 * Builds a deterministic identity for one contextual related origin.
 * @param {import("../semantic/types.js").RelatedOrigin} origin - Related origin.
 * @returns {string} Stable identity.
 */
function relatedOriginKey(origin) {
  return JSON.stringify([
    origin.sourceId,
    origin.location.filename,
    origin.location.start.offset,
    origin.location.end.offset,
    origin.nodeId ?? null,
    origin.symbolId ?? null,
    origin.role ?? null
  ])
}
