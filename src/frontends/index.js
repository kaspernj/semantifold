// @ts-check

import {languageRegistry} from "../language-registry.js"
import {annotateParsedModule} from "../semantic/provenance.js"
import {validateParsedModule} from "../semantic/validate.js"

/**
 * Parses supported source into a shared semantic module.
 * @param {object} input - Parse request.
 * @param {string} input.filename - Source filename used in diagnostics.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Source language.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseSource({filename, language, source}) {
  const frontend = /** @type {(input: {filename: string, source: string}) => import("../semantic/types.js").SemanticModule} */ (
    languageRegistry.resolve(language, "frontend"))
  const module = validateParsedModule(frontend({filename, source}), language)

  return annotateParsedModule(module, {filename, language, source})
}
