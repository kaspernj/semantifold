// @ts-check

import {parseSource} from "./src/frontends/index.js"
import {generateArtifactSource, generateSource} from "./src/backends/index.js"

export {SemantifoldDiagnostic} from "./src/diagnostic.js"
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

/** @type {readonly import("./src/semantic/types.js").SemanticLanguage[]} */
export const supportedLanguages = Object.freeze(["php", "ruby", "javascript", "typescript", "java"])

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
