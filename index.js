// @ts-check

import {parseSource} from "./src/frontends/index.js"
import {generateArtifactSource, generateSource} from "./src/backends/index.js"
import {createGeneratedArtifactSet as constructArtifactSet} from "./src/artifacts.js"
import {SemantifoldDiagnostic} from "./src/diagnostic.js"
import {languageRegistry} from "./src/language-registry.js"

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
 * Generates a deterministic artifact set for one semantic module.
 * @param {object} input - Artifact-set generation request.
 * @param {string} input.language - Registered target language or platform ID.
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

  if (role == "text") {
    const record = languageRegistry.record(language)

    if (record.artifactMultiplicity == "multiple") {
      const backend = languageRegistry.resolve(language, "textBackend", module?.location)

      return constructArtifactSet(backend({filename, language, module, sources}))
    }
    const artifact = generateArtifactSource({
      filename,
      language: /** @type {import("./src/semantic/types.js").SemanticLanguage} */ (language),
      mapDirective,
      module,
      sourceMapFilename,
      sources
    })

    return constructArtifactSet({
      artifacts: [{
        content: artifact.code,
        contentKind: "text",
        mediaType: record.mediaType,
        ownership: "generated",
        path: artifact.filename,
        provenance: {
          kind: "text",
          mapping: artifact.mapping,
          sourceMap: artifact.sourceMap,
          sourceMapFilename: artifact.sourceMapFilename
        },
        role: "entry"
      }],
      target: language
    })
  }

  const registryRole = role == "binary" ? "binaryBackend" : role == "application" ? "applicationBackend" : undefined

  if (!registryRole) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_ARTIFACT_SET",
      language,
      message: `Unknown artifact backend role '${role}'.`
    })
  }
  const backend = languageRegistry.resolve(language, registryRole, module?.location)

  return constructArtifactSet(backend({filename, language, module, sources}))
}
