// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"
import {generateJava} from "./java.js"
import {generateJavaScript} from "./javascript.js"
import {generatePhp} from "./php.js"
import {generateRuby} from "./ruby.js"
import {validateBackendModule} from "./shared.js"
import {generateTypeScript} from "./typescript.js"
import {SourceWriter} from "./writer.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"

/** @type {Readonly<Record<import("../semantic/types.js").SemanticLanguage, string>>} */
const defaultFilenames = Object.freeze({
  java: "Main.java",
  javascript: "program.js",
  php: "program.php",
  ruby: "program.rb",
  typescript: "program.ts"
})
const lineTerminatorPattern = /[\n\r\u2028\u2029]/u

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

  if (typeof filename != "string" || filename.length == 0 || lineTerminatorPattern.test(filename)) {
    throw new TypeError("Generated filename must be a non-empty single-line string.")
  }
  if (typeof sourceMapFilename != "string" || sourceMapFilename.length == 0 || lineTerminatorPattern.test(sourceMapFilename)) {
    throw new TypeError("Source map filename must be a non-empty single-line string.")
  }
  if (language == "java" && filename.split(/[\\/]/u).at(-1) != "Main.java") {
    throw new TypeError("Java artifact filename must have the basename Main.java.")
  }
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
    const sourceMapUrl = relativeArtifactPath(filename, sourceMapFilename)

    writer.synthetic(`//# sourceMappingURL=${sourceMapUrl}\n`, "external source map directive", [module])
  } else if (mapDirective == "inline") {
    const encoded = base64Utf8(JSON.stringify(sourceMap))

    writer.synthetic(`//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}\n`, "inline source map directive", [module])
  }

  const mapping = finalizeMapping(writer.finish())

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
 * Resolves one logical artifact filename relative to another artifact's directory.
 * @param {string} generatedFilename - Generated code artifact filename.
 * @param {string} relatedFilename - Related artifact filename.
 * @returns {string} Portable forward-slash relative path.
 */
function relativeArtifactPath(generatedFilename, relatedFilename) {
  const generatedDirectory = normalizedPathParts(generatedFilename)
  const related = normalizedPathParts(relatedFilename)

  generatedDirectory.pop()
  let common = 0

  while (common < generatedDirectory.length && common < related.length && generatedDirectory[common] == related[common]) common++

  return [...generatedDirectory.slice(common).map(() => ".."), ...related.slice(common)].join("/") || "."
}

/**
 * Normalizes separators and dot segments in one logical artifact filename.
 * @param {string} filename - Logical artifact filename.
 * @returns {string[]} Normalized path parts.
 */
function normalizedPathParts(filename) {
  const parts = []

  for (const part of filename.replaceAll("\\", "/").split("/")) {
    if (part == "" || part == ".") continue
    if (part == ".." && parts.length > 0 && parts.at(-1) != "..") parts.pop()
    else parts.push(part)
  }

  return parts
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
