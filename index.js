// @ts-check

import {parseSource} from "./src/frontends/index.js"
import {parseProgramSource} from "./src/frontends/program.js"
import {generateArtifactSource, generateSource} from "./src/backends/index.js"
import {generateProgramArtifacts} from "./src/backends/program.js"
import {createGeneratedArtifactSet as constructArtifactSet} from "./src/artifacts.js"
import {SemantifoldDiagnostic, unsupportedCapability} from "./src/diagnostic.js"
import {languageRegistry} from "./src/language-registry.js"
import {kotlinArtifactMetadata} from "./src/backends/kotlin.js"

const artifactBackendRoles = new Set(["text", "binary", "application"])

export {SemantifoldDiagnostic}
export {languageCapabilities, supportedLanguages} from "./src/language-registry.js"
export {createGeneratedArtifactSet} from "./src/artifacts.js"
export {createByteMapping, parseByteMapping, stringifyByteMapping} from "./src/binary-mapping.js"
export {canonicalToolchains, discoverCanonicalToolchain, discoverToolchain} from "./src/toolchains.js"
export {runAcceptanceStages} from "./src/acceptance.js"
export {getNodeProvenance, getSymbolProvenance} from "./src/semantic/provenance.js"
export {primaryLocation} from "./src/semantic/provenance.js"
export {
  composeMappings,
  composeSourceMaps,
  generatedPositionFor,
  mappingFromSourceMap,
  originalPositionFor,
  parseMapping,
  remapDiagnostic,
  remapLocation,
  spansForNode,
  spansForSymbol,
  stringifyMapping,
  toSourceMapV3
} from "./src/mapping.js"

/**
 * Parses source into Semantifold's shared semantic representation.
 * @param {object} input - Parse request.
 * @param {string} input.filename - Source filename used in diagnostics.
 * @param {import("./src/semantic/types.js").SemanticLanguage} input.language - Source language.
 * @param {string} input.source - Source text.
 * @returns {import("./src/semantic/types.js").SemanticModule} Semantic module.
 */
export function parse(input) {
  return parseSource(input)
}

/**
 * Parses a complete explicit multi-source project into one resolved semantic program.
 * @param {object} input - Program parse request.
 * @param {string} input.entryModule - Stable identity of the sole entry module.
 * @param {{filename: string, id: string, language: import("./src/semantic/types.js").SemanticLanguage, source: string}[]} input.sources - Complete caller-supplied source set.
 * @returns {import("./src/semantic/types.js").SemanticProgram} Semantic program.
 */
export function parseProgram(input) {
  return parseProgramSource(input)
}

/**
 * Generates target-language source from a shared semantic module.
 * @param {object} input - Generation request.
 * @param {import("./src/semantic/types.js").SemanticLanguage} input.language - Target language.
 * @param {import("./src/semantic/types.js").SemanticModule} input.module - Semantic module.
 * @returns {string} Generated source.
 */
export function generate(input) {
  return generateSource(input)
}

/**
 * Generates a reusable output artifact with rich and Source Map v3 mappings.
 * @param {object} input - Generation request.
 * @param {import("./src/semantic/types.js").SemanticLanguage} input.language - Target language.
 * @param {import("./src/semantic/types.js").SemanticModule} input.module - Semantic module.
 * @param {string} [input.filename] - Output filename.
 * @param {"none" | "external" | "inline"} [input.mapDirective] - JavaScript-family map directive.
 * @param {string} [input.sourceMapFilename] - External map filename.
 * @param {{filename: string, content: string, language?: import("./src/semantic/types.js").SemanticLanguage}[]} [input.sources] - Sources for caller-authored modules.
 * @returns {import("./src/semantic/types.js").GeneratedArtifact} Generated artifact.
 */
export function generateArtifact(input) {
  return generateArtifactSource(input)
}

/**
 * Generates a deterministic mapped artifact set for a complete semantic program.
 * @param {object} input - Program generation request.
 * @param {import("./src/semantic/types.js").SemanticLanguage} input.language - Original-five target language.
 * @param {import("./src/semantic/types.js").SemanticProgram} input.program - Complete resolved program.
 * @returns {import("./src/semantic/types.js").GeneratedArtifactSet} Complete generated set.
 */
export function generateProgramArtifactSet(input) {
  return generateProgramArtifacts(input)
}

/**
 * Generates a deterministic artifact set for one semantic module.
 * @param {object} input - Artifact-set generation request.
 * @param {import("./src/semantic/types.js").BackendLanguage} input.language - Registered target language or platform ID.
 * @param {import("./src/semantic/types.js").SemanticModule} input.module - Semantic module.
 * @param {"text" | "binary" | "application"} [input.role] - Requested backend artifact role.
 * @param {string} [input.filename] - Safe output path for a text target.
 * @param {"none" | "external" | "inline"} [input.mapDirective] - JavaScript-family map directive.
 * @param {string} [input.sourceMapFilename] - External map filename.
 * @param {{filename: string, content: string, language?: import("./src/semantic/types.js").SemanticLanguage}[]} [input.sources] - Original sources.
 * @returns {import("./src/semantic/types.js").GeneratedArtifactSet} Complete generated set.
 */
export function generateArtifactSet(input) {
  if (!input || typeof input != "object" || Array.isArray(input) || Object.getPrototypeOf(input) != Object.prototype) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_ARTIFACT_SET",
      language: "artifact",
      message: "Artifact-set generation requires a request object."
    })
  }
  const {filename, language, mapDirective, module, role = "text", sourceMapFilename, sources} = input

  if (typeof language != "string" || language.length == 0) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_ARTIFACT_SET",
      language: "artifact",
      message: "Artifact-set generation requires a non-empty string language or target ID."
    })
  }
  if (typeof role != "string" || !artifactBackendRoles.has(role)) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_ARTIFACT_SET",
      language,
      message: "Artifact backend role must be 'text', 'binary', or 'application'."
    })
  }
  const target = languageRegistry.record(language)
  const genericDeclaration = [...module?.records ?? [], ...module?.functions ?? []]
    .find((declaration) => (declaration?.typeParameters?.length ?? 0) > 0)

  if (genericDeclaration && !target.features.typeParametersAndGenerics) {
    unsupportedCapability(/** @type {import("./src/semantic/types.js").BackendLanguage} */ (language),
      "Task 012 type parameters and generics", genericDeclaration.location ?? module.location)
  }

  if (Array.isArray(module?.records) && module.records.length > 0 && !target.features.closedRecords) {
    unsupportedCapability(/** @type {import("./src/semantic/types.js").BackendLanguage} */ (language),
      "Task 009 closed records", module.records[0].location ?? module.location)
  }

  if (role == "text") {
    if (target.artifactMultiplicity == "multiple") {
      const backend = languageRegistry.resolve(language, "textBackend", module?.location)

      return constructArtifactSet(backend({filename, language, mapDirective, module, sourceMapFilename, sources}))
    }
    const artifact = generateArtifactSource({
      filename,
      language: /** @type {import("./src/semantic/types.js").SemanticLanguage} */ (language),
      mapDirective,
      module,
      sourceMapFilename,
      sources
    })

    /** @type {import("./src/semantic/types.js").GeneratedSetArtifact[]} */
    const artifacts = [{
      content: artifact.code,
      contentKind: "text",
      mediaType: /** @type {string} */ (target.mediaType),
      ownership: "generated",
      path: artifact.filename,
      provenance: {
        kind: "text",
        mapping: artifact.mapping,
        sourceMap: artifact.sourceMap,
        sourceMapFilename: artifact.sourceMapFilename
      },
      role: "entry"
    }]

    if (mapDirective == "external") {
      artifacts.push({
        content: `${JSON.stringify(artifact.sourceMap)}\n`,
        contentKind: "text",
        mediaType: "application/json",
        ownership: "generated",
        path: artifact.sourceMapFilename,
        provenance: {
          kind: "synthetic",
          reason: "Serialized Source Map v3 projection for the generated entry artifact.",
          relatedOrigins: []
        },
        role: "mapping"
      })
    }

    return constructArtifactSet({
      artifacts,
      ...(language == "kotlin" ? {metadata: kotlinArtifactMetadata} : {}),
      target: language
    })
  }

  const registryRole = role == "binary" ? "binaryBackend" : "applicationBackend"
  const backend = languageRegistry.resolve(language, registryRole, module?.location)

  return constructArtifactSet(backend({filename, language, mapDirective, module, sourceMapFilename, sources}))
}
