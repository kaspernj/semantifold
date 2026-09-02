// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"
import {generateJava} from "./java.js"
import {generateJavaScript} from "./javascript.js"
import {generatePhp} from "./php.js"
import {generateRuby} from "./ruby.js"
import {validateBackendModule} from "./shared.js"
import {generateTypeScript} from "./typescript.js"

/**
 * Generates target source from a semantic module.
 * @param {object} input - Generation request.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Target language.
 * @param {import("../semantic/types.js").SemanticModule} input.module - Semantic module.
 * @returns {string} Generated source.
 */
export function generateSource({language, module}) {
  validateBackendModule(module, language)

  if (language == "php") return generatePhp(module)
  if (language == "ruby") return generateRuby(module)
  if (language == "javascript") return generateJavaScript(module)
  if (language == "typescript") return generateTypeScript(module)
  if (language == "java") return generateJava(module)

  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_LANGUAGE",
    language,
    location: module.location,
    message: "No source backend is registered for this language."
  })
}
