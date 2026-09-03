// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"
import {generateJava} from "./java.js"
import {generateJavaScript} from "./javascript.js"
import {generatePhp} from "./php.js"
import {generateRuby} from "./ruby.js"
import {validateBackendModule} from "./shared.js"
import {generateTypeScript} from "./typescript.js"
import {SourceWriter} from "./writer.js"
import {toSourceMapV3} from "../mapping.js"

/** @type {Readonly<Record<import("../semantic/types.js").SemanticLanguage, string>>} */
const defaultFilenames = Object.freeze({
  java: "Main.java",
  javascript: "program.js",
  php: "program.php",
  ruby: "program.rb",
  typescript: "program.ts"
})

/**
 * Generates target source from a semantic module.
 * @param {object} input - Generation request.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Target language.
 * @param {import("../semantic/types.js").SemanticModule} input.module - Semantic module.
 * @returns {string} Generated source.
 */
export function generateSource({language, module}) {
  return generateArtifactSource({language, module}).code
}

/**
 * Generates source together with authoritative rich and Source Map v3 mappings.
 * @param {object} input - Generation request.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Target language.
 * @param {import("../semantic/types.js").SemanticModule} input.module - Semantic module.
 * @param {string} [input.filename] - Output filename.
 * @param {"none" | "external" | "inline"} [input.mapDirective] - JavaScript-family source map directive.
 * @param {string} [input.sourceMapFilename] - External source map filename.
 * @param {{filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]} [input.sources] - Source content for legacy or assembled modules.
 * @returns {import("../semantic/types.js").GeneratedArtifact} Generated artifact.
 */
export function generateArtifactSource({language, filename = defaultFilenames[language], mapDirective = "none", module, sourceMapFilename = `${filename}.map`, sources}) {
  validateBackendModule(module, language)

  if (typeof filename != "string" || filename.length == 0 || filename.includes("\r") || filename.includes("\n")) {
    throw new TypeError("Generated filename must be a non-empty single-line string.")
  }
  if (typeof sourceMapFilename != "string" || sourceMapFilename.length == 0 || sourceMapFilename.includes("\r") ||
    sourceMapFilename.includes("\n")) throw new TypeError("Source map filename must be a non-empty single-line string.")
  if (!["none", "external", "inline"].includes(mapDirective)) throw new TypeError(`Unsupported map directive: ${mapDirective}`)
  if (mapDirective != "none" && language != "javascript" && language != "typescript") {
    throw new TypeError("Source map directives are supported only for JavaScript and TypeScript outputs.")
  }

  const writer = new SourceWriter({filename, language, module, sources})

  if (language == "php") generatePhp(module, writer)
  else if (language == "ruby") generateRuby(module, writer)
  else if (language == "javascript") generateJavaScript(module, writer)
  else if (language == "typescript") generateTypeScript(module, writer)
  else if (language == "java") generateJava(module, writer)
  else {
    throw new SemantifoldDiagnostic({
      code: "UNSUPPORTED_LANGUAGE",
      language,
      location: module.location,
      message: "No source backend is registered for this language."
    })
  }

  const sourceMap = toSourceMapV3(writer.finish())

  if (mapDirective == "external") {
    writer.synthetic(`//# sourceMappingURL=${sourceMapFilename}\n`, "external source map directive", [module])
  } else if (mapDirective == "inline") {
    const encoded = base64Utf8(JSON.stringify(sourceMap))

    writer.synthetic(`//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}\n`, "inline source map directive", [module])
  }

  const mapping = writer.finish()

  return {
    code: mapping.generated.content,
    filename,
    language,
    mapping,
    sourceMap,
    sourceMapFilename
  }
}

/**
 * Encodes Unicode JSON without relying on a Node-only artifact contract.
 * @param {string} value - Unicode string.
 * @returns {string} Base64 UTF-8.
 */
function base64Utf8(value) {
  let binary = ""

  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)

  return btoa(binary)
}
