// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"
import {annotateParsedModule} from "../semantic/provenance.js"
import {validateParsedModule} from "../semantic/validate.js"
import {parseJava} from "./java.js"
import {parseJavaScriptTypeScript} from "./javascript-typescript.js"
import {parsePhp} from "./php.js"
import {parseRuby} from "./ruby.js"

/**
 * Parses supported source into a shared semantic module.
 * @param {object} input - Parse request.
 * @param {string} input.filename - Source filename used in diagnostics.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Source language.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseSource({filename, language, source}) {
  let module

  if (language == "php") module = validateParsedModule(parsePhp({filename, source}), language)
  else if (language == "ruby") module = validateParsedModule(parseRuby({filename, source}), language)
  if (language == "javascript" || language == "typescript") {
    module = validateParsedModule(parseJavaScriptTypeScript({filename, language, source}), language)
  }
  else if (language == "java") module = validateParsedModule(parseJava({filename, source}), language)

  if (module) return annotateParsedModule(module, {filename, language, source})

  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_LANGUAGE",
    language,
    message: "No frontend adapter is registered for this language."
  })
}
