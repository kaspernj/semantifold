// @ts-check

import {isDenseArray} from "../array.js"
import {isSafeArtifactPath, isSafeSourcePath} from "../artifact-path.js"
import {createGeneratedArtifactSet} from "../artifacts.js"
import {SemantifoldDiagnostic, unsupportedCapability, unsupportedRole} from "../diagnostic.js"
import {parseProgramSource} from "../frontends/program.js"
import {languageRegistry} from "../language-registry.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {createCoordinateIndex, indexedPointAt, moduleLocation} from "../semantic/location.js"
import {semanticEntries} from "../semantic/provenance.js"
import {listStdlibModules, parseStdlibVersionRange} from "../semantic/stdlib.js"
import {moduleUncheckedErrorEffects} from "../semantic/validate.js"
import {negotiateStdlibProviders} from "../stdlib-negotiation.js"
import {stdlibFacadeProgramDescriptor, stdlibFacadeRegistry} from "../stdlib-facades.js"
import {stdlibProviderRegistry} from "../stdlib-providers.js"
import {preflightEffectCapabilities} from "./effects.js"
import {validateTargetBindingIdentifier, validateTargetIdentifier, validateTargetTypeIdentifier} from "./identifiers.js"
import {generateStdlibProviderContent} from "./stdlib-support.js"
import {validateBackendModule} from "./shared.js"
import {programImportName, SourceWriter} from "./writer.js"

/** @type {Readonly<Set<import("../semantic/types.js").SemanticLanguage>>} */
const programTargets = new Set(["php", "ruby", "javascript", "typescript", "java"])
/** @type {Readonly<Set<import("../semantic/types.js").BackendLanguage>>} */
const programApplicationTargets = new Set(["android", "ios"])

/**
 * Validates and prepares a complete semantic program for a non-text backend without allocating a writer.
 * @param {object} input - Backend preflight request.
 * @param {import("../semantic/types.js").SemanticLanguage} input.backendLanguage - Existing semantic backend profile to enforce.
 * @param {import("../semantic/types.js").BackendLanguage} input.diagnosticLanguage - Public target identity for capability failures.
 * @param {import("../semantic/types.js").SemanticProgram} input.program - Complete candidate program.
 * @param {Readonly<Set<import("../semantic/types.js").SemanticLanguage>>} [input.sourceLanguages] - Accepted source provenance languages.
 * @returns {{modules: import("../semantic/types.js").SemanticModule[], program: import("../semantic/types.js").SemanticProgram, sources: {content: string, filename: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} Prepared immutable-input views.
 */
export function preflightSemanticProgram({backendLanguage, diagnosticLanguage, program: candidate, sourceLanguages}) {
  try {
    const program = validateProgram(candidate, backendLanguage, sourceLanguages)
    const modules = prepareEmissionModules(program, backendLanguage)

    validateProgramSourceOwnership(program, backendLanguage)
    const sources = program.sources.map((source) => {
      if (source.content === null) invalidProgramGeneration(`Program source '${source.filename}' has no retained content.`)

      return {content: source.content, filename: source.filename, ...(source.language ? {language: source.language} : {})}
    })

    return {modules, program, sources}
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
      error.language != diagnosticLanguage) {
      throw new SemantifoldDiagnostic({
        cause: error,
        code: error.code,
        language: diagnosticLanguage,
        location: error.location,
        message: error.detail
      })
    }
    throw error
  }
}

/**
 * Generates a complete deterministic mapped artifact set for one semantic program.
 * @param {object} input - Program generation request.
 * @param {import("../semantic/types.js").BackendLanguage} input.language - Registered program target.
 * @param {import("../semantic/types.js").SemanticProgram} input.program - Complete semantic program.
 * @param {"text" | "application"} [input.role] - Explicit artifact role; omitted preserves text generation.
 * @param {import("../semantic/types.js").IosApplicationConfigurationInput | import("../semantic/types.js").AndroidApplicationConfigurationInput} [input.configuration] - Application configuration.
 * @param {import("../semantic/types.js").IosApplicationAssetInput[] | import("../semantic/types.js").AndroidApplicationInputFile[]} [input.assets] - Exact caller assets.
 * @param {import("../semantic/types.js").AndroidApplicationInputFile[]} [input.resources] - Exact Android caller resources.
 * @returns {import("../semantic/types.js").GeneratedArtifactSet} Transactionally validated artifact set.
 */
export function generateProgramArtifacts(input) {
  if (!isPlainObject(input) || typeof input.language != "string") invalidProgramGeneration("Program generation requires a target language and program.")
  const role = input.role ?? "text"

  if (role != "text" && role != "application") invalidProgramGeneration("Program artifact role must be 'text' or 'application'.")
  languageRegistry.record(input.language)
  if (role == "application") {
    if (!programApplicationTargets.has(input.language)) unsupportedRole(input.language, "multi-file application backend")
    const backend = languageRegistry.resolve(input.language, "applicationBackend")

    return createGeneratedArtifactSet(backend(input))
  }
  if (!programTargets.has(/** @type {import("../semantic/types.js").SemanticLanguage} */ (input.language))) {
    unsupportedRole(input.language, "multi-file text backend")
  }
  const language = /** @type {import("../semantic/types.js").SemanticLanguage} */ (input.language)
  const program = validateProgram(input.program, language)
  const linking = planStdlibLinking(program, language)
  const emissionModules = prepareEmissionModules(program, language, linking)
  validateProgramSourceOwnership(program, language)
  const paths = planModulePaths(program, language, linking)
  const sources = program.sources.map((source) => {
    if (source.content === null) invalidProgramGeneration(`Program source '${source.filename}' has no retained content.`)

    return {content: source.content, filename: source.filename, ...(source.language ? {language: source.language} : {})}
  })
  const backend = /** @type {typeof import("./javascript.js").generateJavaScript} */ (
    languageRegistry.resolve(language, "textBackend"))
  const mediaType = languageRegistry.record(language).mediaType
  /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */
  const artifacts = language == "javascript" || language == "typescript" ? [{
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

  if (linking && language != "java") {
    for (const provider of linking.negotiation.providers) {
      const record = /** @type {import("../stdlib-providers.js").StdlibProviderRecord} */ (linking.records.get(provider.module))

      artifacts.push({
        content: generateStdlibProviderContent(/** @type {"php" | "ruby" | "javascript" | "typescript"} */ (language),
          [...provider.operations], provider.module),
        contentKind: /** @type {const} */ ("text"),
        mediaType: record.artifact.mediaType,
        ownership: /** @type {const} */ ("generated"),
        path: record.artifact.path,
        provenance: {
          kind: /** @type {const} */ ("synthetic"),
          reason: `semantifold-stdlib-provider:${record.identity}`,
          relatedOrigins: []
        },
        role: /** @type {const} */ ("support")
      })
    }
  }

  for (const emissionModule of emissionModules) {
    const moduleId = /** @type {string} */ (Reflect.get(emissionModule, "id"))
    const filename = /** @type {string} */ (paths.get(moduleId))
    const writer = new SourceWriter({
      filename,
      language,
      module: emissionModule,
      program,
      programPaths: paths,
      sources,
      ...(linking && emissionModule.capabilities !== undefined ? {
        stdlibProviderEntries: Object.fromEntries((linking.usedOperationsByModule.get(moduleId) ?? []).map(({module, operation}) => [
          qualifiedOperationKey(module, operation),
          /** @type {string} */ (linking.records.get(module)?.nativeEntries[operation])
        ])),
        stdlibProviderImports: language == "java" || language == "javascript" || language == "typescript" ?
          linking.providerImportsByModule.get(moduleId) : undefined,
        stdlibProviderPaths: linking.providerPathsByModule.get(moduleId),
        ...(language == "java" ? {
          stdlibProviderOwnerModule: /** @type {string} */ (linking.ownerModuleId),
          stdlibProviderShims: moduleId == linking.ownerModuleId ? linking.usedOperations.map(({operation}) => operation) : undefined
        } : {})
      } : {})
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
      role: /** @type {import("../semantic/types.js").GeneratedArtifactRole} */ (
        moduleId == program.entryModule ? "entry" : Reflect.get(emissionModule, "stdlibFacade") ? "support" : "source")
    })
  }

  return createGeneratedArtifactSet({
    artifacts,
    ...(linking || program.stdlibFacades ? {metadata: stdlibLinkMetadata(linking, paths, program.stdlibFacades)} : {}),
    target: language
  })
}

/**
 * @typedef StdlibProgramLinking
 * @property {import("../stdlib-negotiation.js").StdlibNegotiationResult} negotiation - Negotiated provider closure.
 * @property {Map<string, import("../stdlib-providers.js").StdlibProviderRecord>} records - Materialized provider records by canonical module.
 * @property {QualifiedStdlibOperation[]} usedOperations - Program-wide used canonical operations in stable order.
 * @property {Map<string, QualifiedStdlibOperation[]>} usedOperationsByModule - Used canonical operations by program module identity.
 * @property {Map<string, string[]>} providerImportsByModule - Ordered provider import names by module identity.
 * @property {Map<string, string[]>} providerPathsByModule - Provider artifact closure by program module identity.
 * @property {string | null} ownerModuleId - Java target: first operation-using module identity hosting the shared support; null for artifact-materializing targets.
 */

/**
 * @typedef QualifiedStdlibOperation
 * @property {string} module - Canonical module identity.
 * @property {string} operation - Canonical operation name.
 */

/**
 * Plans the linked stdlib provider for one program, or reports that no operation is used.
 * Java resolves the same negotiated provider record but hosts its support in the first
 * operation-using module instead of a separate provider artifact.
 * @param {import("../semantic/types.js").SemanticProgram} program - Validated semantic program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @returns {StdlibProgramLinking | null} Linking plan, or null when nothing is used.
 */
function planStdlibLinking(program, language) {
  const {programWide, usedOperationsByModule} = collectUsedEffectOperations(program)

  if (programWide.length == 0) return null
  const contracts = program.stdlibContracts ?? [/** @type {{identity: string, contractVersion?: string}} */ (program.stdlibContract)]
  const contractsByIdentity = new Map(contracts.map((contract) => [contract.identity, contract]))
  const requirementsByModule = new Map()

  for (const qualified of programWide) {
    const requirement = requirementsByModule.get(qualified.module) ?? []

    requirement.push(qualified.operation)
    requirementsByModule.set(qualified.module, requirement)
  }
  const negotiation = negotiateStdlibProviders({
    requirements: [...requirementsByModule].map(([module, operations]) => {
      const contract = contractsByIdentity.get(module)

      if (!contract) throw new SemantifoldDiagnostic({
        code: "STDLIB_LINK_FAILURE",
        language,
        message: `Reachable canonical operation '${module}.${operations[0]}' has no declared standard-library contract.`
      })
      return {module, operations, ...(contract.contractVersion !== undefined ? {range: contract.contractVersion} : {})}
    }),
    target: language
  })
  /** @type {Map<string, import("../stdlib-providers.js").StdlibProviderRecord>} */
  const records = new Map()

  for (const selected of negotiation.modules) {
    const candidates = stdlibProviderRegistry.providersFor(language, selected.identity, selected.version)

    if (candidates.length != 1) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_LINK_FAILURE",
        language,
        message: `Expected exactly one registered stdlib provider for '${selected.identity}' on '${language}'.`
      })
    }
    records.set(selected.identity, /** @type {import("../stdlib-providers.js").StdlibProviderRecord} */ (candidates[0]))
  }
  const ownerModuleId = language == "java"
    ? program.modules.map((module) => module.id).find((id) => (usedOperationsByModule.get(id) ?? []).length > 0)
    : null

  if (ownerModuleId === undefined) throw new SemantifoldDiagnostic({
    code: "STDLIB_LINK_FAILURE",
    language,
    message: "Java program linking requires one module using canonical operations."
  })

  return {
    negotiation,
    ownerModuleId,
    providerImportsByModule: collectProviderImports(program, negotiation, records, usedOperationsByModule, language, ownerModuleId),
    providerPathsByModule: collectProviderPaths(negotiation, records, usedOperationsByModule),
    records,
    usedOperations: [...programWide],
    usedOperationsByModule
  }
}

/**
 * Selects the exact provider/type dependency closure required by each emitting program module.
 * @param {import("../stdlib-negotiation.js").StdlibNegotiationResult} negotiation - Negotiated program closure.
 * @param {Map<string, import("../stdlib-providers.js").StdlibProviderRecord>} records - Selected provider records.
 * @param {Map<string, QualifiedStdlibOperation[]>} usedOperationsByModule - Reachable operations by program module.
 * @returns {Map<string, string[]>} Ordered provider paths by program module.
 */
function collectProviderPaths(negotiation, records, usedOperationsByModule) {
  const paths = new Map()

  for (const [moduleId, operations] of usedOperationsByModule) {
    const selected = new Set(operations.map(({module}) => module))
    let changed = true

    while (changed) {
      changed = false
      for (const module of [...selected]) {
        for (const dependency of records.get(module)?.dependencies ?? []) {
          if (!selected.has(dependency.module)) {
            selected.add(dependency.module)
            changed = true
          }
        }
      }
    }
    paths.set(moduleId, negotiation.providers.filter(({module}) => selected.has(module)).map(({module}) =>
      /** @type {import("../stdlib-providers.js").StdlibProviderRecord} */ (records.get(module)).artifact.path))
  }
  return paths
}

/**
 * Collects the canonical operations invoked by each program module in stable order.
 * @param {import("../semantic/types.js").SemanticProgram} program - Validated semantic program.
 * @returns {{programWide: QualifiedStdlibOperation[], usedOperationsByModule: Map<string, QualifiedStdlibOperation[]>}} Used operations.
 */
function collectUsedEffectOperations(program) {
  /** @type {Map<string, QualifiedStdlibOperation[]>} */
  const usedOperationsByModule = new Map()
  /** @type {Map<string, QualifiedStdlibOperation>} */
  const programWide = new Map()
  /** @type {Map<string, {body: unknown, module: import("../semantic/types.js").SemanticProgramModule}>} */
  const bodies = new Map()

  for (const module of program.modules) {
    for (const declaration of module.functions) bodies.set(/** @type {string} */ (declaration.id), {body: declaration.body, module})
    for (const declaration of module.classes ?? []) {
      bodies.set(/** @type {string} */ (declaration.constructor.id), {body: declaration.constructor.body, module})
      for (const method of declaration.methods) bodies.set(/** @type {string} */ (method.id), {body: method.body, module})
    }
    usedOperationsByModule.set(module.id, [])
  }
  const entryModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (
    program.modules.find(({id}) => id == program.entryModule))
  /** @type {{body: unknown, module: import("../semantic/types.js").SemanticProgramModule}[]} */
  const pending = [{body: entryModule.entryPoint?.body, module: entryModule}]
  const reachedDeclarations = new Set()

  while (pending.length > 0) {
    const current = /** @type {{body: unknown, module: import("../semantic/types.js").SemanticProgramModule}} */ (pending.shift())
    const operationNames = new Map(current.module.capabilities?.flatMap((capability) =>
      capability.operations.map((operation) => [operation.id, {module: capability.authorityId, operation: operation.name}])) ?? [])
    const seen = new Set()

    /**
     * Visits one reachable semantic subtree.
     * @param {unknown} value - Candidate semantic subtree.
     */
    const visit = (value) => {
      if (!value || typeof value != "object" || seen.has(value)) return
      seen.add(value)

      if (!Array.isArray(value)) {
        const kind = Reflect.get(value, "kind")

        if (kind == "EffectCallExpression") {
          const operation = Reflect.get(value, "operation")

          if (typeof operation == "string") {
            const qualified = operationNames.get(operation)

            if (qualified !== undefined) {
              const key = qualifiedOperationKey(qualified.module, qualified.operation)
              const moduleOperations = /** @type {QualifiedStdlibOperation[]} */ (usedOperationsByModule.get(current.module.id))

              if (!moduleOperations.some((item) => qualifiedOperationKey(item.module, item.operation) == key)) moduleOperations.push(qualified)
              programWide.set(key, qualified)
            }
          }
        }
        const declarationId = isPlainObject(Reflect.get(value, "resolution"))
          ? Reflect.get(Reflect.get(value, "resolution"), "declarationId") : undefined

        if (typeof declarationId == "string" && !reachedDeclarations.has(declarationId)) {
          const declaration = bodies.get(declarationId)

          if (declaration) {
            reachedDeclarations.add(declarationId)
            pending.push(declaration)
          }
        }
        for (const [key, child] of Object.entries(value)) {
          if (["capabilities", "location", "provenance", "resolution", "sourceProvenance"].includes(key)) continue
          visit(child)
        }
      } else for (const child of value) visit(child)
    }

    visit(current.body)
  }
  for (const operations of usedOperationsByModule.values()) {
    operations.sort((left, right) => qualifiedOperationKey(left.module, left.operation)
      .localeCompare(qualifiedOperationKey(right.module, right.operation), "en"))
  }
  return {programWide: [...programWide.values()].sort((left, right) => qualifiedOperationKey(left.module, left.operation)
    .localeCompare(qualifiedOperationKey(right.module, right.operation), "en")), usedOperationsByModule}
}

/**
 * Builds an unambiguous internal key for one canonical operation authority.
 * @param {string} module - Canonical module identity.
 * @param {string} operation - Canonical operation name.
 * @returns {string} Qualified internal key.
 */
function qualifiedOperationKey(module, operation) {
  return `${module}\u0000${operation}`
}

/**
 * Collects the ordered provider import names each module must pull from the linked provider.
 * Java modules list referenced capability type names only; the owner lists none.
 * @param {import("../semantic/types.js").SemanticProgram} program - Validated semantic program.
 * @param {import("../stdlib-negotiation.js").StdlibNegotiationResult} negotiation - Negotiated closure.
 * @param {Map<string, import("../stdlib-providers.js").StdlibProviderRecord>} records - Provider records by canonical module.
 * @param {Map<string, QualifiedStdlibOperation[]>} usedOperationsByModule - Used canonical operations by module identity.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {string | null} [ownerModuleId] - Java owner module identity.
 * @returns {Map<string, string[]>} Ordered provider import names by module identity.
 */
function collectProviderImports(program, negotiation, records, usedOperationsByModule, language, ownerModuleId = null) {
  /** @type {Map<string, string[]>} */
  const providerImportsByModule = new Map()

  for (const module of program.modules) {
    if (module.capabilities === undefined) continue
    const used = new Set((usedOperationsByModule.get(module.id) ?? []).map(({module: owner, operation}) =>
      qualifiedOperationKey(owner, operation)))
    /** @type {Set<string>} */
    const surface = new Set()
    /** @type {Map<string, string>} */
    const resourceNameById = new Map()

    /** @type {Map<string, string>} */
    const declarationNames = new Map((module.records ?? []).map((declaration) => [/** @type {string} */ (declaration.id), declaration.name]))

    for (const declaration of module.errors ?? []) {
      declarationNames.set(/** @type {string} */ (declaration.id), declaration.name)
    }

    for (const capability of module.capabilities) {
      for (const resource of capability.resources) {
        surface.add(resource.name)
        resourceNameById.set(resource.id, resource.name)
      }
      for (const failure of capability.failures) {
        surface.add(failure.name)
        declarationNames.set(failure.id, failure.name)
      }
    }
    const referenced = new Set()
    const seen = new Set()

    /**
     * Visits one semantic value.
     * @param {unknown} value - Candidate semantic subtree.
     * @returns {void}
     */
    const visit = (value) => {
      if (!value || typeof value != "object" || seen.has(value)) return
      seen.add(value)

      if (!Array.isArray(value)) {
        const kind = Reflect.get(value, "kind")

        if (kind == "OwnedResourceType") {
          const resourceId = Reflect.get(value, "resourceId")

          if (typeof resourceId == "string") {
            const name = resourceNameById.get(resourceId)

            if (name !== undefined) referenced.add(name)
          }
        } else if (kind == "ReferenceType" || kind == "OwnedReferenceType" || kind == "ErrorType") {
          const declarationId = Reflect.get(value, "declarationId")

          if (typeof declarationId == "string") {
            const name = declarationNames.get(declarationId)

            if (name !== undefined && surface.has(name)) referenced.add(name)
          }
        }
        for (const [key, child] of Object.entries(value)) {
          if (key == "capabilities" || key == "location" || key == "sourceProvenance") continue
          visit(child)
        }
      } else for (const child of value) visit(child)
    }

    visit(module)
    const names = []

    if (language != "java" || module.id != ownerModuleId) {
      for (const capability of module.capabilities) {
        for (const resource of capability.resources) if (referenced.has(resource.name)) names.push(resource.name)
        for (const failure of capability.failures) if (referenced.has(failure.name)) names.push(failure.name)
      }
    }
    if (language != "java") {
      for (const provider of negotiation.providers) {
        const record = records.get(provider.module)

        for (const operation of provider.operations) {
          if (used.has(qualifiedOperationKey(provider.module, operation))) {
            names.push(/** @type {string} */ (record?.nativeEntries[operation]))
          }
        }
      }
    }

    providerImportsByModule.set(module.id, names)
  }
  return providerImportsByModule
}

/**
 * Builds the truthful generated stdlib link metadata for one negotiated closure.
 * Java reports the owner module file as the provider carrier instead of a separate artifact.
 * @param {StdlibProgramLinking | null} linking - Linking plan.
 * @param {Map<string, string>} paths - Planned artifact path by module identity.
 * @param {import("../semantic/types.js").StdlibFacadeProgramDescriptor | undefined} facades - Selected source facade closure.
 * @returns {Record<string, unknown>} Plain JSON metadata.
 */
function stdlibLinkMetadata(linking, paths, facades) {
  return {
    ...(facades ? {facades} : {}),
    modules: (linking?.negotiation.modules ?? []).map((item) => ({
      identity: item.identity,
      operations: [...item.operations],
      version: item.version
    })),
    providers: (linking?.negotiation.providers ?? []).map((item) => {
      const record = linking?.records.get(item.module)
      const artifactPath = linking?.ownerModuleId !== null && linking?.ownerModuleId !== undefined
        ? /** @type {string} */ (paths.get(linking.ownerModuleId))
        : record?.artifact.path

      return {
        artifact: {mediaType: record?.artifact.mediaType, path: artifactPath},
        dependencies: (record?.dependencies ?? []).map((dependency) => ({module: dependency.module, range: dependency.range})),
        identity: item.identity,
        module: item.module,
        nativeEntries: {...item.nativeEntries},
        operations: [...item.operations],
        target: item.target,
        version: item.version
      }
    }),
    schema: "SemantifoldStdlibLink",
    version: 1
  }
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
 * Collects nominal failure identities referenced by executable/type nodes outside the module's authority declarations.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Program module.
 * @returns {Set<string>} Referenced failure declaration identities.
 */
function collectReferencedFailureIds(module) {
  /** @type {Set<string>} */
  const ids = new Set()
  const seen = new Set()
  /**
   * Visits one semantic subtree for referenced failures.
   * @param {unknown} value - Candidate semantic subtree.
   */
  const visit = (value) => {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    if (!Array.isArray(value)) {
      if (Reflect.get(value, "kind") == "ErrorType" && typeof Reflect.get(value, "declarationId") == "string") {
        ids.add(Reflect.get(value, "declarationId"))
      }
      const failureIds = Reflect.get(value, "failureIds")

      if (Array.isArray(failureIds)) for (const id of failureIds) if (typeof id == "string") ids.add(id)
      for (const [key, child] of Object.entries(value)) {
        if (["capabilities", "location", "provenance", "sourceProvenance"].includes(key)) continue
        visit(child)
      }
    } else for (const child of value) visit(child)
  }

  visit({classes: module.classes, entryPoint: module.entryPoint, functions: module.functions})
  return ids
}

/**
 * Creates and validates every backend-shaped module before any writer is allocated.
 * @param {import("../semantic/types.js").SemanticProgram} program - Validated semantic program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {StdlibProgramLinking | null} [linking] - Planned stdlib provider link.
 * @returns {import("../semantic/types.js").SemanticModule[]} Emission views in dependency order.
 */
function prepareEmissionModules(program, language, linking = null) {
  /** @type {Map<string, import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").ErrorDeclaration>} */
  const declarations = new Map()

  for (const module of program.modules) {
    for (const declaration of module.records ?? []) declarations.set(/** @type {string} */ (declaration.id), declaration)
    for (const declaration of module.classes ?? []) declarations.set(/** @type {string} */ (declaration.id), declaration)
    for (const declaration of module.errors ?? []) declarations.set(/** @type {string} */ (declaration.id), declaration)
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
  /** @type {Map<string, Set<string>>} */
  const callEffectsByDeclarationId = new Map()

  for (const module of modules) {
    const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module))
    const visibleFunctions = new Map()
    const visibleCallEffects = new Map()
    const visibleRecords = new Map()
    const visibleClasses = new Map()
    const visibleErrors = new Map()
    const externalDeclarationIds = new Set()

    const neededFailureIds = collectReferencedFailureIds(programModule)
    const localFailureIds = new Set(programModule.capabilities?.flatMap(({failures}) => failures.map(({id}) => id)) ?? [])

    for (const owner of program.modules) {
      if (owner.id == programModule.id) continue
      for (const capability of owner.capabilities ?? []) {
        for (const failure of capability.failures) {
          if (!localFailureIds.has(failure.id) && neededFailureIds.has(failure.id)) visibleErrors.set(failure.id, failure)
        }
      }
    }

    for (const imported of programModule.imports) {
      const declaration = declarations.get(imported.declarationId)

      if (!declaration) unsupportedCapability(language, "program import without a declaration", imported.location)
      externalDeclarationIds.add(imported.declarationId)
      if (imported.symbolKind == "function") {
        visibleFunctions.set(imported.localName, /** @type {import("../semantic/types.js").FunctionDeclaration} */ (declaration))
        visibleCallEffects.set(imported.localName, new Set(callEffectsByDeclarationId.get(imported.declarationId) ?? []))
      } else if (imported.symbolKind == "record") {
        visibleRecords.set(imported.declarationId, /** @type {import("../semantic/types.js").RecordDeclaration} */ (declaration))
      } else if (imported.symbolKind == "class") {
        visibleClasses.set(imported.declarationId, /** @type {import("../semantic/types.js").ClassDeclaration} */ (declaration))
      } else {
        visibleErrors.set(imported.declarationId, /** @type {import("../semantic/types.js").ErrorDeclaration} */ (declaration))
      }
    }
    if (module.capabilities !== undefined || !linking) {
      preflightEffectCapabilities(module, language, linking ? {usedOperations: (linking.usedOperationsByModule.get(programModule.id) ?? [])
        .map(({operation}) => operation)} : {})
    }
    validateBackendModule(module, language, {
      externalDeclarationIds,
      program: true,
      visibleCallEffects,
      visibleClasses,
      visibleErrors,
      visibleFunctions,
      visibleRecords
    })
    const localCallEffects = moduleUncheckedErrorEffects(module, {callEffects: visibleCallEffects, functions: visibleFunctions})

    for (const declaration of module.functions) {
      callEffectsByDeclarationId.set(/** @type {string} */ (declaration.id), new Set(localCallEffects.get(declaration.name) ?? []))
    }
  }

  return modules
}

/**
 * Validates the closed parser-neutral program graph before any target emission.
 * @param {unknown} candidate - Candidate semantic program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {Readonly<Set<import("../semantic/types.js").SemanticLanguage>>} [sourceLanguages] - Accepted source languages.
 * @returns {import("../semantic/types.js").SemanticProgram} Validated program.
 */
function validateProgram(candidate, language, sourceLanguages = programTargets) {
  if (!isPlainObject(candidate) || candidate.kind != "Program" || typeof candidate.entryModule != "string" ||
    !isDenseArray(candidate.modules) || candidate.modules.length == 0 || !isDenseArray(candidate.sources) || candidate.sources.length == 0) {
    invalidProgramGeneration("Malformed semantic program.")
  }
  const program = /** @type {import("../semantic/types.js").SemanticProgram} */ (candidate)
  const modules = new Map()
  /** @type {Map<string, {declaration: import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").ErrorDeclaration, module: import("../semantic/types.js").SemanticProgramModule}>} */
  const declarations = new Map()
  /** @type {import("../semantic/types.js").SemanticProgramModule[]} */
  const capabilityModules = []
  let entryCount = 0
  const sourceIds = new Set()
  const sourceFilenames = new Set()

  for (const source of program.sources) {
    if (!isPlainObject(source) || typeof source.id != "string" || sourceIds.has(source.id) ||
      typeof source.filename != "string" || !isSafeSourcePath(source.filename) || sourceFilenames.has(source.filename) ||
      typeof source.content != "string" || typeof source.language != "string" || !sourceLanguages.has(source.language)) {
      invalidProgramGeneration("Malformed or duplicate semantic program source registry.")
    }
    sourceIds.add(source.id)
    sourceFilenames.add(source.filename)
  }

  for (const module of program.modules) {
    if (!isPlainObject(module) || module.kind != "Module" || typeof module.id != "string" ||
      !/^[a-z][a-z0-9_]*(?:[.-][a-z][a-z0-9_]*)*$/u.test(module.id) || modules.has(module.id) ||
      !isDenseArray(module.functions) || module.records !== undefined && !isDenseArray(module.records) ||
      module.errors !== undefined && !isDenseArray(module.errors) ||
      !isDenseArray(module.imports) || !isDenseArray(module.exports)) {
      unsupportedCapability(language, "malformed or duplicate semantic program module", module?.location)
    }
    if (Reflect.get(module, "classes") !== undefined && (!isDenseArray(module.classes) ||
      Reflect.get(module, "stdlibFacade") === undefined)) {
      unsupportedCapability(language, "Task 033 reference classes are not supported by semantic program generation",
        Reflect.get(module, "classes")?.[0]?.location ?? module.location)
    }
    if (Reflect.get(module, "capabilities") !== undefined) {
      if (!isDenseArray(module.capabilities) || module.capabilities.length == 0) {
        unsupportedCapability(language, "malformed or empty Task 034 capability graph", module.location)
      }
      capabilityModules.push(module)
    }
    if (typeof module.sourceFilename != "string" || !sourceFilenames.has(module.sourceFilename)) {
      unsupportedCapability(language, "semantic program module source identity", module.location)
    }
    if (module.entryPoint) {
      entryCount++
      if (module.id != program.entryModule) unsupportedCapability(language, "entry point on an unselected module", module.entryPoint.location)
    }
    for (const declaration of [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions]) {
      if (!isPlainObject(declaration) || typeof declaration.id != "string" ||
        !declaration.id.startsWith(`${module.id}#`) || declarations.has(declaration.id)) {
        unsupportedCapability(language, "duplicate or unstable program declaration identity", declaration?.location ?? module.location)
      }
      declarations.set(declaration.id, {declaration, module})
    }
    for (const imported of module.imports) {
      if (!isPlainObject(imported) || imported.kind != "Import" || typeof imported.moduleId != "string" ||
        typeof imported.importedName != "string" || typeof imported.localName != "string" ||
        typeof imported.declarationId != "string" || !["function", "record", "class", "error"].includes(imported.symbolKind) ||
        typeof imported.typeOnly != "boolean") {
        unsupportedCapability(language, "malformed semantic program import", imported?.location ?? module.location)
      }
    }
    for (const exported of module.exports) {
      if (!isPlainObject(exported) || exported.kind != "Export" || typeof exported.exportedName != "string" ||
        typeof exported.declarationId != "string" || !["function", "record", "class", "error"].includes(exported.symbolKind)) {
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
    const localTargetNames = new Set([...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions]
      .map(({name}) => targetName(language, name)))
    const importedTargetNames = new Set()
    const localJavaClass = module.records?.[0]?.name ?? module.classes?.[0]?.name ?? module.errors?.[0]?.name ??
      (module.id == program.entryModule ? "Main" : moduleClassName(module.id))
    const javaImportClasses = new Map(language == "java" ? [[localJavaClass, module.id]] : [])

    for (const imported of module.imports) {
      const resolved = declarations.get(imported.declarationId)
      const remoteExport = resolved?.module.exports.find((item) =>
        item.declarationId == imported.declarationId && item.exportedName == imported.importedName)

      if (!resolved || resolved.module.id != imported.moduleId || !earlier.has(imported.moduleId) ||
        !remoteExport) {
        unsupportedCapability(language, "unresolved, private, cyclic, or out-of-order program import", imported.location ?? module.location)
      }
      const declarationKind = resolved.declaration.kind == "FunctionDeclaration" ? "function" :
        resolved.declaration.kind == "RecordDeclaration" ? "record" :
          resolved.declaration.kind == "ClassDeclaration" ? "class" : "error"

      if (imported.symbolKind != remoteExport.symbolKind || imported.symbolKind != declarationKind ||
        imported.typeOnly && declarationKind != "record" && declarationKind != "class") {
        unsupportedCapability(language, "program import declaration kind mismatch", imported.location ?? module.location)
      }
      const importName = programImportName(program, module, imported)

      if (language != "ruby" && language != "java") {
        if (imported.symbolKind != "function") validateTargetTypeIdentifier(language, importName, imported.location)
        else validateTargetBindingIdentifier(language, importName, "import", imported.location)
      }
      const name = targetName(language, importName)

      if (language != "ruby" && language != "java" && (localTargetNames.has(name) || importedTargetNames.has(name))) {
        unsupportedCapability(language, `target import-name collision '${importName}'`, imported.location)
      }
      if (language == "java") {
        const importedClass = imported.symbolKind == "function" ? moduleClassName(resolved.module.id) : resolved.declaration.name
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
      const declarationKind = resolved.declaration.kind == "FunctionDeclaration" ? "function" :
        resolved.declaration.kind == "RecordDeclaration" ? "record" :
          resolved.declaration.kind == "ClassDeclaration" ? "class" : "error"

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
      const privateDeclaration = [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions].find(({id}) =>
        typeof id == "string" && !exportedDeclarationIds.has(id))

      if (privateDeclaration) {
        unsupportedCapability(language, `non-exported declaration '${privateDeclaration.name}' without target-private module visibility`,
          privateDeclaration.location)
      }
    }
    earlier.add(module.id)
  }

  validateProgramStdlibContract(program, language, capabilityModules)
  validateProgramStdlibFacades(program, language)

  return program
}

/**
 * Validates compiler-selected facade descriptors, executable sources, module markers, and native identity evidence.
 * @param {import("../semantic/types.js").SemanticProgram} program - Candidate program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language for diagnostics.
 * @returns {void}
 */
function validateProgramStdlibFacades(program, language) {
  const descriptor = Reflect.get(program, "stdlibFacades")
  const markedModules = program.modules.filter((module) => Reflect.get(module, "stdlibFacade") !== undefined)
  const facadeSources = program.sources.filter((source) => Reflect.get(source, "ownership") == "facade")
  const evidencedImports = program.modules.flatMap((module) => module.imports.filter((item) => Reflect.get(item, "stdlibFacade") !== undefined))

  if (descriptor === undefined) {
    if (markedModules.length > 0 || facadeSources.length > 0 || evidencedImports.length > 0) {
      invalidFacadeDescriptor(language, "Facade modules, sources, or import evidence require a complete program facade descriptor.")
    }
    return
  }
  if (!isPlainObject(descriptor) || descriptor.schema != "SemantifoldStdlibFacades" || descriptor.version != 1 ||
    typeof descriptor.language != "string" || !programTargets.has(descriptor.language) || !isDenseArray(descriptor.modules) ||
    descriptor.modules.length == 0) {
    invalidFacadeDescriptor(language, "The program facade descriptor is malformed.")
  }
  const facadeLanguage = /** @type {import("../semantic/types.js").SemanticLanguage} */ (descriptor.language)
  const records = descriptor.modules.map((item) => {
    if (!isPlainObject(item) || typeof item.identity != "string" || typeof item.version != "string") {
      invalidFacadeDescriptor(language, "The program facade module descriptor is malformed.")
    }
    return stdlibFacadeRegistry.resolveIdentity(item.identity, facadeLanguage, item.version)
  })
  const expected = stdlibFacadeProgramDescriptor(facadeLanguage, records)

  if (!equalPlainData(descriptor, expected)) {
    invalidFacadeDescriptor(language, "The program facade descriptor does not match the registered versioned facade closure.")
  }
  const selectedRecords = new Map()

  for (const record of records) {
    if (selectedRecords.has(record.identity)) {
      invalidFacadeDescriptor(language, `Facade '${record.identity}' is selected more than once.`)
    }
    for (const dependency of record.dependencies) {
      const resolved = stdlibFacadeRegistry.resolveIdentity(dependency.identity, facadeLanguage, dependency.range)
      const selected = selectedRecords.get(resolved.identity)

      if (!selected || selected.version != resolved.version) {
        invalidFacadeDescriptor(language, `Facade '${record.identity}' dependency '${resolved.identity}@${resolved.version}' is missing or out of order.`)
      }
    }
    selectedRecords.set(record.identity, record)
  }
  if (markedModules.length != records.length) {
    invalidFacadeDescriptor(language, "The program facade descriptor does not match its executable semantic modules.")
  }
  if (program.sources.some((source) => source.language != facadeLanguage ||
    !["application", "facade"].includes(String(Reflect.get(source, "ownership"))))) {
    invalidFacadeDescriptor(language, "Facade programs require one source language and explicit application/facade ownership.")
  }
  const selectedIdentities = new Set(records.map(({identity}) => identity))
  const registeredModules = reparseRegisteredFacadeModules(program, facadeLanguage, language)

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const module = markedModules[index]
    const marker = Reflect.get(module, "stdlibFacade")

    if (!isPlainObject(marker) || Object.keys(marker).sort().join(",") != "identity,version" ||
      marker.identity != record.identity || marker.version != record.version || module.id != record.source.id ||
      module.sourceFilename != record.source.filename) {
      invalidFacadeDescriptor(language, `Facade '${record.identity}' semantic module identity is not canonical.`)
    }
    const source = program.sources.find(({filename}) => filename == record.source.filename)

    if (!source || source.content != record.source.content || Reflect.get(source, "ownership") != "facade") {
      invalidFacadeDescriptor(language, `Facade '${record.identity}' executable source does not match its registered definition.`)
    }
    const registeredModule = registeredModules.get(record.identity)

    if (!registeredModule || !equalPlainData(module, registeredModule)) {
      invalidFacadeAuthority(language,
        `Facade '${record.identity}' semantic module does not match its registered executable source.`, module.location)
    }
    const allowedOperations = new Set(record.requirements.flatMap(({operations}) => operations))
    const usedOperations = collectDeclaredEffectOperations(module)

    if (allowedOperations.size != usedOperations.size || [...allowedOperations].some((operation) => !usedOperations.has(operation))) {
      invalidFacadeAuthority(language, `Facade '${record.identity}' semantic body does not match its declared canonical requirements.`, module.location)
    }
  }
  if (facadeSources.length != records.length) {
    invalidFacadeDescriptor(language, "The program contains an unselected compiler-owned facade source.")
  }
  if (evidencedImports.length == 0) {
    invalidFacadeDescriptor(language, "The selected facade closure has no parser-proved native import evidence.")
  }
  for (const imported of evidencedImports) {
    const evidence = Reflect.get(imported, "stdlibFacade")

    if (!isPlainObject(evidence) || Object.keys(evidence).sort().join(",") !=
      "facadeIdentity,facadeVersion,nativeModule,nativeSymbol,schema,version" ||
      evidence.schema != "SemantifoldStdlibFacadeResolution" || evidence.version != 1 ||
      typeof evidence.facadeIdentity != "string" || typeof evidence.facadeVersion != "string" ||
      typeof evidence.nativeModule != "string" || typeof evidence.nativeSymbol != "string") {
      invalidFacadeDescriptor(language, "A facade import has malformed native identity evidence.")
    }
    const record = stdlibFacadeRegistry.resolveFacade(facadeLanguage, evidence.nativeModule, evidence.nativeSymbol,
      evidence.facadeVersion)

    if (record.identity != evidence.facadeIdentity || !selectedIdentities.has(record.identity) || imported.moduleId != record.source.id ||
      imported.importedName != evidence.nativeSymbol) {
      invalidFacadeDescriptor(language, "A facade import does not match its registered native module and symbol identity.")
    }
  }
}

/**
 * Collects every canonical operation present in one validated facade implementation.
 * This checks the facade's complete declared authority independently from program reachability.
 * @param {import("../semantic/types.js").SemanticProgramModule} module - Facade module.
 * @returns {Set<string>} Used operation names.
 */
function collectDeclaredEffectOperations(module) {
  const operationNames = new Map(module.capabilities?.flatMap(({operations}) =>
    operations.map((operation) => [operation.id, operation.name])) ?? [])
  const used = new Set()
  const seen = new Set()
  /**
   * Visits one facade semantic subtree.
   * @param {unknown} value - Candidate semantic subtree.
   */
  const visit = (value) => {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    if (!Array.isArray(value)) {
      const operation = Reflect.get(value, "kind") == "EffectCallExpression" ? Reflect.get(value, "operation") : undefined

      if (typeof operation == "string" && operationNames.has(operation)) used.add(/** @type {string} */ (operationNames.get(operation)))
      for (const [key, child] of Object.entries(value)) {
        if (["capabilities", "location", "provenance", "resolution", "sourceProvenance"].includes(key)) continue
        visit(child)
      }
    } else for (const child of value) visit(child)
  }

  visit({classes: module.classes, entryPoint: module.entryPoint, functions: module.functions})
  return used
}

/**
 * Recompiles the registry-selected facade closure from retained caller inputs and registered facade source.
 * This parser-backed reference graph is created during validation, before provider planning or writer allocation.
 * @param {import("../semantic/types.js").SemanticProgram} program - Untrusted mutable semantic program.
 * @param {import("../semantic/types.js").SemanticLanguage} facadeLanguage - Selected source-language facade profile.
 * @param {import("../semantic/types.js").SemanticLanguage} diagnosticLanguage - Target language for boundary diagnostics.
 * @returns {Map<string, import("../semantic/types.js").SemanticProgramModule>} Canonical semantic modules by facade identity.
 */
function reparseRegisteredFacadeModules(program, facadeLanguage, diagnosticLanguage) {
  const applicationModules = program.modules.filter((module) => Reflect.get(module, "stdlibFacade") === undefined)
  const modulesByFilename = new Map(applicationModules.map((module) => [module.sourceFilename, module]))
  const applicationSources = program.sources.filter((source) => Reflect.get(source, "ownership") == "application").map((source) => {
    const module = modulesByFilename.get(source.filename)

    if (!module) invalidFacadeDescriptor(diagnosticLanguage,
      `Application source '${source.filename}' has no matching semantic module for facade verification.`)
    return {
      filename: source.filename,
      id: /** @type {import("../semantic/types.js").SemanticProgramModule} */ (module).id,
      language: facadeLanguage,
      source: /** @type {string} */ (source.content)
    }
  })

  if (applicationSources.length != applicationModules.length) {
    invalidFacadeDescriptor(diagnosticLanguage, "Facade verification requires one retained application source per semantic module.")
  }
  const reparsed = parseProgramSource({entryModule: program.entryModule, sources: applicationSources})
  const modules = new Map()

  for (const module of reparsed.modules) {
    if (!module.stdlibFacade) continue
    if (modules.has(module.stdlibFacade.identity)) {
      invalidFacadeDescriptor(diagnosticLanguage, `Registered facade '${module.stdlibFacade.identity}' reparsed more than once.`)
    }
    modules.set(module.stdlibFacade.identity, module)
  }
  return modules
}

/**
 * Compares closed plain JSON-shaped data without coercion or key-order assumptions.
 * @param {unknown} left - Candidate value.
 * @param {unknown} right - Expected value.
 * @returns {boolean} Exact recursive equivalence.
 */
function equalPlainData(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && isDenseArray(left) && isDenseArray(right) &&
      left.length == right.length && left.every((value, index) => equalPlainData(value, right[index]))
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  return leftKeys.length == rightKeys.length && leftKeys.every((key, index) =>
    key == rightKeys[index] && equalPlainData(left[key], right[key]))
}

/**
 * Throws one stable facade artifact-boundary diagnostic.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {string} message - Diagnostic detail.
 * @returns {never} Always throws.
 */
function invalidFacadeDescriptor(language, message) {
  throw new SemantifoldDiagnostic({code: "STDLIB_FACADE_DESCRIPTOR_INVALID", language, message})
}

/**
 * Throws when a facade semantic body exceeds or omits its registry-declared authority.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {string} message - Diagnostic detail.
 * @param {import("../semantic/types.js").SourceLocation} location - Facade source location.
 * @returns {never} Always throws.
 */
function invalidFacadeAuthority(language, message, location) {
  throw new SemantifoldDiagnostic({code: "STDLIB_FACADE_AUTHORITY_FORGED", language, location, message})
}

/**
 * Validates the program stdlib link descriptor against its capability modules.
 * @param {import("../semantic/types.js").SemanticProgram} program - Candidate program.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {import("../semantic/types.js").SemanticProgramModule[]} capabilityModules - Modules carrying capabilities.
 * @returns {void}
 */
function validateProgramStdlibContract(program, language, capabilityModules) {
  const contract = Reflect.get(program, "stdlibContract")
  const contracts = Reflect.get(program, "stdlibContracts")

  if (capabilityModules.length == 0) {
    if (contract !== undefined || contracts !== undefined) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_LINK_FAILURE",
        language,
        message: "A declared standard-library contract requires capability modules."
      })
    }
    return
  }
  if (contract !== undefined && contracts !== undefined) {
    throw new SemantifoldDiagnostic({
      code: "STDLIB_LINK_FAILURE",
      language,
      message: "A program cannot declare both singular and plural standard-library contract descriptors."
    })
  }
  if (contract === undefined && contracts === undefined) {
    unsupportedCapability(language, "program modules with capabilities require a declared standard-library contract",
      capabilityModules[0].location)
  }
  const declared = contracts === undefined ? [contract] : contracts

  if (!isDenseArray(declared) || declared.length == 0) {
    throw new SemantifoldDiagnostic({
      code: "STDLIB_LINK_FAILURE",
      language,
      message: "The declared standard-library contract descriptor list is malformed or empty."
    })
  }
  const identities = new Set()

  for (const descriptor of declared) {
    if (!isPlainObject(descriptor) || Object.keys(descriptor).some((key) => key != "identity" && key != "contractVersion")) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_LINK_FAILURE",
        language,
        message: "The declared standard-library contract descriptor is malformed."
      })
    }
    const identity = descriptor.identity

    if (typeof identity != "string" || identity.length == 0 || identities.has(identity) ||
      !listStdlibModules().some(({identity: registered}) => registered == identity)) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_LINK_FAILURE",
        language,
        message: `Declared standard-library contract '${String(identity)}' is duplicate or not a registered canonical module.`
      })
    }
    if (descriptor.contractVersion !== undefined && parseStdlibVersionRange(descriptor.contractVersion) === null) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_LINK_FAILURE",
        language,
        message: `Declared standard-library contract version '${String(descriptor.contractVersion)}' is not canonical.`
      })
    }
    identities.add(identity)
  }
  for (const module of capabilityModules) {
    for (const capability of module.capabilities ?? []) {
      if (!isPlainObject(capability) || typeof capability.authorityId != "string" || !identities.has(capability.authorityId)) {
        throw new SemantifoldDiagnostic({
          code: "STDLIB_LINK_FAILURE",
          language,
          message: `Capability authority '${String(Reflect.get(capability, "authorityId"))}' does not match a declared standard-library contract.`
        })
      }
    }
  }
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
 * @param {StdlibProgramLinking | null} [linking] - Planned stdlib provider link.
 * @returns {Map<string, string>} Path by module identity.
 */
function planModulePaths(program, language, linking = null) {
  const extension = language == "javascript" ? ".js" : language == "typescript" ? ".ts" : language == "ruby" ? ".rb" :
    language == "php" ? ".php" : ".java"
  const paths = new Map()
  const folded = new Set()
  const targetModuleNames = new Set()
  const providerPaths = linking ? linking.negotiation.providers.map(({module}) =>
    /** @type {import("../stdlib-providers.js").StdlibProviderRecord} */ (linking.records.get(module)).artifact.path) : []
  const foldedProviders = new Map()

  for (const providerPath of providerPaths) {
    const key = providerPath.toLocaleLowerCase("en-US")

    if (!isSafeArtifactPath(providerPath) || folded.has(key)) {
      throw new SemantifoldDiagnostic({code: "STDLIB_NAME_COLLISION", language,
        message: `Stdlib provider artifact path '${providerPath}' is unsafe or colliding.`})
    }
    folded.add(key)
    foldedProviders.set(providerPath.toLocaleLowerCase("en-US").replaceAll(".", "/"), providerPath)
  }

  for (const module of program.modules) {
    let path = `${module.id.replaceAll(".", "/")}${extension}`
    const providerPath = foldedProviders.get(path.toLocaleLowerCase("en-US").replaceAll(".", "/"))

    if (providerPath !== undefined) {
      throw new SemantifoldDiagnostic({
        code: "STDLIB_NAME_COLLISION",
        language,
        message: `Module path '${path}' collides with the stdlib provider artifact '${providerPath}'.`
      })
    }
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
      const nominalCount = (module.records?.length ?? 0) + (module.classes?.length ?? 0) + (module.errors?.length ?? 0)

      if (module.id.includes("-") || nominalCount > 1 ||
        nominalCount > 0 && (module.functions.length > 0 || module.entryPoint)) {
        unsupportedCapability(language, "Java module layout requiring multiple public declarations in one semantic module", module.location)
      }
      const className = module.records?.[0]?.name ?? module.classes?.[0]?.name ?? module.errors?.[0]?.name ??
        (module.id == program.entryModule ? "Main" : targetModuleName)

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
