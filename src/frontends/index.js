// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"
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
  if (language == "php") return validateParsedModule(parsePhp({filename, source}), language)
  if (language == "ruby") return validateParsedModule(parseRuby({filename, source}), language)
  if (language == "javascript" || language == "typescript") {
    return validateParsedModule(parseJavaScriptTypeScript({filename, language, source}), language)
  }
  if (language == "java") return validateParsedModule(parseJava({filename, source}), language)

  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_LANGUAGE",
    language,
    message: "No frontend adapter is registered for this language."
  })
}
