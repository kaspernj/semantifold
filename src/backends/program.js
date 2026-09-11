// @ts-check

import {isDenseArray} from "../array.js"
import {isSafeArtifactPath} from "../artifact-path.js"
import {createGeneratedArtifactSet} from "../artifacts.js"
import {SemantifoldDiagnostic, unsupportedCapability, unsupportedRole} from "../diagnostic.js"
import {languageRegistry} from "../language-registry.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {createCoordinateIndex, indexedPointAt, moduleLocation} from "../semantic/location.js"
import {semanticEntries} from "../semantic/provenance.js"
import {validateTargetBindingIdentifier, validateTargetIdentifier, validateTargetTypeIdentifier} from "./identifiers.js"
import {validateBackendModule} from "./shared.js"
import {programImportName, SourceWriter} from "./writer.js"

const programTargets = new Set(["php", "ruby", "javascript", "typescript", "java"])

/**
 * Generates a complete deterministic mapped artifact set for one semantic program.
 * @param {object} input - Program generation request.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Original-five target language.
 * @param {import("../semantic/types.js").SemanticProgram} input.program - Complete semantic program.
 * @returns {import("../semantic/types.js").GeneratedArtifactSet} Transactionally validated artifact set.
 */
export function generateProgramArtifacts(input) {
  if (!isPlainObject(input) || typeof input.language != "string") invalidProgramGeneration("Program generation requires a target language and program.")
  languageRegistry.record(input.language)
  if (!programTargets.has(input.language)) unsupportedRole(input.language, "multi-file text backend")
  const program = validateProgram(input.program, input.language)
  const emissionModules = prepareEmissionModules(program, input.language)
  validateProgramSourceOwnership(program, input.language)
  const paths = planModulePaths(program, input.language)
  const sources = program.sources.map((source) => {
    if (source.content === null) invalidProgramGeneration(`Program source '${source.filename}' has no retained content.`)

    return {content: source.content, filename: source.filename, ...(source.language ? {language: source.language} : {})}
  })
  const backend = /** @type {typeof import("./javascript.js").generateJavaScript} */ (
    languageRegistry.resolve(input.language, "textBackend"))
  const mediaType = languageRegistry.record(input.language).mediaType
  /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */
  const artifacts = input.language == "javascript" || input.language == "typescript" ? [{
    content: "{\n  \"type\": \"module\"\n}\n",
    contentKind: /** @type {const} */ ("text"),
    mediaType: "application/json",
    ownership: /** @type {const} */ ("generated"),
    path: "package.json",
    provenance: {
      kind: /** @type {const} */ ("synthetic"),
      reason: "Declares the generated JavaScript-family artifact set as canonical ESM.",
      relatedOrigins: []
    },
    role: "manifest"
  }] : []

  for (const emissionModule of emissionModules) {
    const moduleId = /** @type {string} */ (Reflect.get(emissionModule, "id"))
    const filename = /** @type {string} */ (paths.get(moduleId))
    const writer = new SourceWriter({
      filename,
      language: input.language,
      module: emissionModule,
      program,
      programPaths: paths,
      sources
    })

    backend(emissionModule, writer)
    const mapping = finalizeMapping(writer.finish())

    artifacts.push({
      content: mapping.generated.content,
      contentKind: /** @type {const} */ ("text"),
      mediaType: /** @type {string} */ (mediaType),
      ownership: /** @type {const} */ ("generated"),
      path: filename,
      provenance: {
        kind: /** @type {const} */ ("text"),
        mapping,
        sourceMap: toSourceMapV3(mapping),
        sourceMapFilename: `${filename}.map`
      },
      role: /** @type {import("../semantic/types.js").GeneratedArtifactRole} */ (moduleId == program.entryModule ? "entry" : "source")
    })
  }

  return createGeneratedArtifactSet({artifacts, target: input.language})
}

/**
 * Validates every mandatory semantic location against its owning module source before writer allocation.
 * @param {import("../semantic/types.js").SemanticProgram} program - Structurally and semantically validated program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @returns {void}
 */
function validateProgramSourceOwnership(program, language) {
  const sources = new Map(program.sources.map((source) => [source.filename, {
    ...source,
    coordinates: createCoordinateIndex(/** @type {string} */ (source.content))
  }]))

  for (const module of program.modules) {
    const source = sources.get(module.sourceFilename)

    if (!source) unsupportedCapability(language, "semantic program module source ownership", undefined)
    const fallback = moduleLocation(source.filename, /** @type {string} */ (source.content))

    for (const entry of semanticEntries(module)) {
      const subject = entry.node.kind == "Module" ? "module" : entry.node.kind == "Import" ? "import" :
        entry.node.kind == "Export" ? "export" : "semantic node"

      if (!("location" in entry.node)) {
        if (subject != "semantic node") unsupportedCapability(language, `semantic program ${subject} location`, fallback)
        continue
      }
      const location = entry.node.location

      if (sourceOwnsLocation(source, location)) continue

      unsupportedCapability(language, `semantic program ${subject} location source ownership`, fallback)
    }
  }
}

/**
 * Checks a normalized UTF-16 location against one exact registered source without throwing.
 * @param {{filename: string, content: string | null, coordinates: ReturnType<typeof createCoordinateIndex>}} source - Owning source.
 * @param {unknown} candidate - Candidate location.
 * @returns {boolean} Whether the source owns the location.
 */
function sourceOwnsLocation(source, candidate) {
  if (!isPlainObject(candidate) || candidate.filename != source.filename || !isPlainObject(candidate.start) ||
    !isPlainObject(candidate.end) || !Number.isInteger(candidate.start.offset) || !Number.isInteger(candidate.end.offset) ||
    !Number.isInteger(candidate.start.line) || !Number.isInteger(candidate.start.column) ||
    !Number.isInteger(candidate.end.line) || !Number.isInteger(candidate.end.column)) return false
  const startOffset = /** @type {number} */ (candidate.start.offset)
  const endOffset = /** @type {number} */ (candidate.end.offset)

  if (startOffset < 0 || endOffset < startOffset || endOffset > source.coordinates.source.length) return false
  const expectedStart = indexedPointAt(source.coordinates, startOffset)
  const expectedEnd = indexedPointAt(source.coordinates, endOffset)

  return samePoint(candidate.start, expectedStart) && samePoint(candidate.end, expectedEnd)
}

/**
 * Compares an untrusted point with one canonical indexed point.
 * @param {Record<string, unknown>} candidate - Candidate point.
 * @param {import("../semantic/types.js").SourcePoint} expected - Canonical point.
 * @returns {boolean} Whether every coordinate agrees.
 */
function samePoint(candidate, expected) {
  return candidate.offset == expected.offset && candidate.line == expected.line && candidate.column == expected.column
}

/**
 * Creates and validates every backend-shaped module before any writer is allocated.
 * @param {import("../semantic/types.js").SemanticProgram} program - Validated semantic program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @returns {import("../semantic/types.js").SemanticModule[]} Emission views in dependency order.
 */
function prepareEmissionModules(program, language) {
  /** @type {Map<string, import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").RecordDeclaration>} */
  const declarations = new Map()

  for (const module of program.modules) {
    for (const declaration of module.records ?? []) declarations.set(/** @type {string} */ (declaration.id), declaration)
    for (const declaration of module.functions) declarations.set(/** @type {string} */ (declaration.id), declaration)
  }
  const modules = program.modules.map((module) => /** @type {import("../semantic/types.js").SemanticModule} */ ({
    ...module,
    entryPoint: module.entryPoint ?? {
      body: {kind: /** @type {const} */ ("Block"), location: module.location, statements: []},
      kind: /** @type {const} */ ("EntryPoint"),
      location: module.location
    }
  }))

  for (const module of modules) {
    const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module))
    const visibleFunctions = new Map()
    const visibleRecords = new Map()
    const externalDeclarationIds = new Set()

    for (const imported of programModule.imports) {
      const declaration = declarations.get(imported.declarationId)

      if (!declaration) unsupportedCapability(language, "program import without a declaration", imported.location)
      externalDeclarationIds.add(imported.declarationId)
      if (imported.symbolKind == "function") {
        visibleFunctions.set(imported.localName, /** @type {import("../semantic/types.js").FunctionDeclaration} */ (declaration))
      } else {
        visibleRecords.set(imported.declarationId, /** @type {import("../semantic/types.js").RecordDeclaration} */ (declaration))
      }
    }
    validateBackendModule(module, language, {externalDeclarationIds, program: true, visibleFunctions, visibleRecords})
  }

  return modules
}

/**
 * Validates the closed parser-neutral program graph before any target emission.
 * @param {unknown} candidate - Candidate semantic program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @returns {import("../semantic/types.js").SemanticProgram} Validated program.
 */
function validateProgram(candidate, language) {
  if (!isPlainObject(candidate) || candidate.kind != "Program" || typeof candidate.entryModule != "string" ||
    !isDenseArray(candidate.modules) || candidate.modules.length == 0 || !isDenseArray(candidate.sources) || candidate.sources.length == 0) {
    invalidProgramGeneration("Malformed semantic program.")
  }
  const program = /** @type {import("../semantic/types.js").SemanticProgram} */ (candidate)
  const modules = new Map()
  /** @type {Map<string, {declaration: import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").RecordDeclaration, module: import("../semantic/types.js").SemanticProgramModule}>} */
  const declarations = new Map()
  let entryCount = 0
  const sourceIds = new Set()
  const sourceFilenames = new Set()

  for (const source of program.sources) {
    if (!isPlainObject(source) || typeof source.id != "string" || sourceIds.has(source.id) ||
      typeof source.filename != "string" || !isSafeArtifactPath(source.filename) || sourceFilenames.has(source.filename) ||
      typeof source.content != "string" || typeof source.language != "string" || !programTargets.has(source.language)) {
      invalidProgramGeneration("Malformed or duplicate semantic program source registry.")
    }
    sourceIds.add(source.id)
    sourceFilenames.add(source.filename)
  }

  for (const module of program.modules) {
    if (!isPlainObject(module) || module.kind != "Module" || typeof module.id != "string" ||
      !/^[a-z][a-z0-9_]*(?:[.-][a-z][a-z0-9_]*)*$/u.test(module.id) || modules.has(module.id) ||
      !isDenseArray(module.functions) || module.records !== undefined && !isDenseArray(module.records) ||
      !isDenseArray(module.imports) || !isDenseArray(module.exports)) {
      unsupportedCapability(language, "malformed or duplicate semantic program module", module?.location)
    }
    if (typeof module.sourceFilename != "string" || !sourceFilenames.has(module.sourceFilename)) {
      unsupportedCapability(language, "semantic program module source identity", module.location)
    }
    if (module.entryPoint) {
      entryCount++
      if (module.id != program.entryModule) unsupportedCapability(language, "entry point on an unselected module", module.entryPoint.location)
    }
    for (const declaration of [...module.records ?? [], ...module.functions]) {
      if (!isPlainObject(declaration) || typeof declaration.id != "string" ||
        !declaration.id.startsWith(`${module.id}#`) || declarations.has(declaration.id)) {
        unsupportedCapability(language, "duplicate or unstable program declaration identity", declaration?.location ?? module.location)
      }
      declarations.set(declaration.id, {declaration, module})
    }
    for (const imported of module.imports) {
      if (!isPlainObject(imported) || imported.kind != "Import" || typeof imported.moduleId != "string" ||
        typeof imported.importedName != "string" || typeof imported.localName != "string" ||
        typeof imported.declarationId != "string" || !["function", "record"].includes(imported.symbolKind) ||
        typeof imported.typeOnly != "boolean") {
        unsupportedCapability(language, "malformed semantic program import", imported?.location ?? module.location)
      }
    }
    for (const exported of module.exports) {
      if (!isPlainObject(exported) || exported.kind != "Export" || typeof exported.exportedName != "string" ||
        typeof exported.declarationId != "string" || !["function", "record"].includes(exported.symbolKind)) {
        unsupportedCapability(language, "malformed semantic program export", exported?.location ?? module.location)
      }
    }
    modules.set(module.id, module)
  }
  if (entryCount != 1 || !modules.get(program.entryModule)?.entryPoint) {
    unsupportedCapability(language, "program without exactly one selected entry point", modules.get(program.entryModule)?.location)
  }
  const selectedModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (modules.get(program.entryModule))
  const selectedEntry = selectedModule.entryPoint

  if (!isPlainObject(selectedEntry?.body) || !isDenseArray(selectedEntry.body.statements) || selectedEntry.body.statements.length == 0) {
    unsupportedCapability(language, "program without a dense non-empty selected entry point block",
      selectedEntry?.location ?? selectedModule.location)
  }
  const earlier = new Set()

  for (const module of program.modules) {
    const localTargetNames = new Set([...module.records ?? [], ...module.functions].map(({name}) => targetName(language, name)))
    const importedTargetNames = new Set()
    const localJavaClass = module.records?.[0]?.name ?? (module.id == program.entryModule ? "Main" : moduleClassName(module.id))
    const javaImportClasses = new Map(language == "java" ? [[localJavaClass, module.id]] : [])

    for (const imported of module.imports) {
      const resolved = declarations.get(imported.declarationId)
      const remoteExport = resolved?.module.exports.find((item) =>
        item.declarationId == imported.declarationId && item.exportedName == imported.importedName)

      if (!resolved || resolved.module.id != imported.moduleId || !earlier.has(imported.moduleId) ||
        !remoteExport) {
        unsupportedCapability(language, "unresolved, private, cyclic, or out-of-order program import", imported.location ?? module.location)
      }
      const declarationKind = resolved.declaration.kind == "FunctionDeclaration" ? "function" : "record"

      if (imported.symbolKind != remoteExport.symbolKind || imported.symbolKind != declarationKind ||
        imported.typeOnly && declarationKind != "record") {
        unsupportedCapability(language, "program import declaration kind mismatch", imported.location ?? module.location)
      }
      const importName = programImportName(program, module, imported)

      if (language != "ruby" && language != "java") {
        if (imported.symbolKind == "record") validateTargetTypeIdentifier(language, importName, imported.location)
        else validateTargetBindingIdentifier(language, importName, "import", imported.location)
      }
      const name = targetName(language, importName)

      if (language != "ruby" && language != "java" && (localTargetNames.has(name) || importedTargetNames.has(name))) {
        unsupportedCapability(language, `target import-name collision '${importName}'`, imported.location)
      }
      if (language == "java") {
        const importedClass = imported.symbolKind == "record" ? resolved.declaration.name : moduleClassName(resolved.module.id)
        const existingOwner = javaImportClasses.get(importedClass)

        if (existingOwner && existingOwner != resolved.module.id) {
          unsupportedCapability(language, `target import-class collision '${importedClass}'`, imported.location)
        }
        javaImportClasses.set(importedClass, resolved.module.id)
      }
      if (language == "ruby") {
        const importedModule = moduleClassName(resolved.module.id)

        if (localTargetNames.has(importedModule)) {
          unsupportedCapability(language, `target import-module collision '${importedModule}'`, imported.location)
        }
      }
      importedTargetNames.add(name)
    }
    const valueDeclarationIds = new Set(module.imports.filter(({typeOnly}) => !typeOnly).map(({declarationId}) => declarationId))
    const typeOnlyDeclarationIds = new Set(module.imports
      .filter(({declarationId, typeOnly}) => typeOnly && !valueDeclarationIds.has(declarationId))
      .map(({declarationId}) => declarationId))
    const valueConstruction = findTypeOnlyValueConstruction(module, typeOnlyDeclarationIds)

    if (valueConstruction) {
      unsupportedCapability(language, "type-only program import used as a value", valueConstruction.location ?? module.location)
    }
    const exportNames = new Set()

    for (const exported of module.exports) {
      const resolved = declarations.get(exported.declarationId)
      const name = targetName(language, exported.exportedName)

      if (language == "javascript" || language == "typescript") {
        validateTargetIdentifier(language, exported.exportedName, "export", exported.location ?? module.location)
      }

      if (!resolved || resolved.module.id != module.id || exportNames.has(name)) {
        unsupportedCapability(language, `unresolved or colliding target export '${exported.exportedName}'`, exported.location ?? module.location)
      }
      const declarationKind = resolved.declaration.kind == "FunctionDeclaration" ? "function" : "record"

      if (exported.symbolKind != declarationKind) {
        unsupportedCapability(language, "program export declaration kind mismatch", exported.location ?? module.location)
      }
      if (language != "javascript" && language != "typescript" && exported.exportedName != resolved.declaration.name) {
        unsupportedCapability(language, `export alias '${exported.exportedName}' without an equivalent target binding`,
          exported.location ?? resolved.declaration.location)
      }
      exportNames.add(name)
    }
    if (language == "php") {
      const exportedDeclarationIds = new Set(module.exports.map(({declarationId}) => declarationId))
      const privateDeclaration = [...module.records ?? [], ...module.functions].find(({id}) =>
        typeof id == "string" && !exportedDeclarationIds.has(id))

      if (privateDeclaration) {
        unsupportedCapability(language, `non-exported declaration '${privateDeclaration.name}' without target-private module visibility`,
          privateDeclaration.location)
      }
    }
    earlier.add(module.id)
  }

  return program
}

/**
 * Finds a record construction that crosses a type-only import edge.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Importing semantic module.
 * @param {Set<string>} typeOnlyDeclarationIds - Imported identities unavailable in value positions.
 * @returns {import("../semantic/types.js").RecordConstruction | undefined} Invalid construction when present.
 */
function findTypeOnlyValueConstruction(module, typeOnlyDeclarationIds) {
  if (typeOnlyDeclarationIds.size == 0) return undefined
  const seen = new WeakSet()

  /**
   * Visits one semantic value.
   * @param {unknown} value - Candidate semantic subtree.
   * @returns {import("../semantic/types.js").RecordConstruction | undefined} Invalid construction when present.
   */
  function visit(value) {
    if (!value || typeof value != "object" || seen.has(value)) return undefined
    seen.add(value)
    const object = /** @type {Record<string, unknown>} */ (value)

    if (object.kind == "RecordConstruction" && isPlainObject(object.record) &&
      typeof object.record.declarationId == "string" && typeOnlyDeclarationIds.has(object.record.declarationId)) {
      return /** @type {import("../semantic/types.js").RecordConstruction} */ (value)
    }
    for (const child of Object.values(object)) {
      const found = visit(child)

      if (found) return found
    }

    return undefined
  }

  return visit({entryPoint: module.entryPoint, functions: module.functions})
}

/**
 * Plans all paths before emission and rejects exact/case/file-directory collisions.
 * @param {import("../semantic/types.js").SemanticProgram} program - Validated program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @returns {Map<string, string>} Path by module identity.
 */
function planModulePaths(program, language) {
  const extension = language == "javascript" ? ".js" : language == "typescript" ? ".ts" : language == "ruby" ? ".rb" :
    language == "php" ? ".php" : ".java"
  const paths = new Map()
  const folded = new Set()
  const targetModuleNames = new Set()

  for (const module of program.modules) {
    let path = `${module.id.replaceAll(".", "/")}${extension}`
    const targetModuleName = moduleClassName(module.id)

    if (language == "php" || language == "ruby") {
      const key = language == "php" ? targetModuleName.toLocaleLowerCase("en-US") : targetModuleName

      if (targetModuleNames.has(key)) {
        unsupportedCapability(language, `target module-name collision '${targetModuleName}'`, module.location)
      }
      targetModuleNames.add(key)
    }

    if (language == "php") {
      validateTargetIdentifier(language, targetModuleName, "module", module.location)
      validateTargetTypeIdentifier(language, targetModuleName, module.location)
    }
    if (language == "ruby") validateTargetTypeIdentifier(language, targetModuleName, module.location)

    if (language == "java") {
      for (const segment of module.id.split(".")) validateTargetIdentifier(language, segment, "module", module.location)
      if (module.id.includes("-") || (module.records?.length ?? 0) > 1 ||
        (module.records?.length ?? 0) > 0 && (module.functions.length > 0 || module.entryPoint)) {
        unsupportedCapability(language, "Java module layout requiring multiple public declarations in one semantic module", module.location)
      }
      const className = module.records?.[0]?.name ?? (module.id == program.entryModule ? "Main" : targetModuleName)

      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(className)) {
        unsupportedCapability(language, `invalid Java public class name '${className}'`, module.location)
      }
      if (module.id != program.entryModule) validateTargetTypeIdentifier(language, className, module.location)
      path = `semantifold/generated/${module.id.replaceAll(".", "/")}/${className}.java`
    }
    const key = path.toLocaleLowerCase("en-US")

    if (!isSafeArtifactPath(path) || folded.has(key)) unsupportedCapability(language, `unsafe or colliding target path '${path}'`, module.location)
    folded.add(key)
    paths.set(module.id, path)
  }

  return paths
}

/**
 * Converts a logical module identity to its canonical target type segment.
 * @param {string} id - Logical module identity.
 * @returns {string} Target class name.
 */
function moduleClassName(id) {
  return id.split(/[._-]+/u).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("")
}

/**
 * Normalizes a declaration or binding name for target collision checks.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target.
 * @param {string} name - Name.
 * @returns {string} Collision key.
 */
function targetName(language, name) {
  return language == "php" ? name.toLocaleLowerCase("en-US") : name
}

/**
 * Reports whether a candidate is a direct plain object.
 * @param {unknown} value - Candidate.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Raises a stable malformed program-generation request diagnostic.
 * @param {string} message - Stable failure.
 * @returns {never} Always throws.
 */
function invalidProgramGeneration(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_PROGRAM", language: "program", message})
}
