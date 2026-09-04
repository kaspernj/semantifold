// @ts-check

import {unsupportedCapability, unsupportedRole} from "../diagnostic.js"
import {isValidFilenameMetadata} from "../artifact-path.js"
import {languageRegistry} from "../language-registry.js"
import {validateBackendModule} from "./shared.js"
import {SourceWriter} from "./writer.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
const syntheticArtifactBase = Object.freeze(["__semantifold_artifacts__"])

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
export function generateArtifactSource({language, filename, mapDirective = "none", module, sourceMapFilename, sources}) {
  const backend = languageRegistry.resolve(language, "textBackend", module?.location)
  const record = languageRegistry.record(language)

  if (record.artifactMultiplicity != "single") unsupportedRole(language, "single-text backend", module?.location)
  if (filename === undefined) filename = record.defaultFilename
  if (sourceMapFilename === undefined) sourceMapFilename = `${filename}.map`
  validateBackendModule(module, language)

  if (!isValidFilenameMetadata(filename)) {
    throw new TypeError("Generated filename must be a non-empty single-line string.")
  }
  if (!isValidFilenameMetadata(sourceMapFilename)) {
    throw new TypeError("Source map filename must be a non-empty single-line string.")
  }
  if (language == "java" && filename.split(/[\\/]/u).at(-1) != "Main.java") {
    unsupportedCapability(language, "artifact filename basename other than Main.java", module.location)
  }
  if (!["none", "external", "inline"].includes(mapDirective)) throw new TypeError(`Unsupported map directive: ${mapDirective}`)
  if (mapDirective != "none" && language != "javascript" && language != "typescript") {
    throw new TypeError("Source map directives are supported only for JavaScript and TypeScript outputs.")
  }

  const writer = new SourceWriter({filename, language, module, sources})

  backend(module, writer)

  const sourceMap = toSourceMapV3(writer.finish())

  if (mapDirective == "external") {
    const sourceMapUrl = encodeArtifactPath(relativeArtifactPath(filename, sourceMapFilename))

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
  const generatedDirectory = resolvedArtifactPathParts(generatedFilename)
  const related = resolvedArtifactPathParts(relatedFilename)

  generatedDirectory.pop()
  let common = 0

  while (common < generatedDirectory.length && common < related.length && generatedDirectory[common] == related[common]) common++

  return [...generatedDirectory.slice(common).map(() => ".."), ...related.slice(common)].join("/") || "."
}

/**
 * Resolves separators and dot segments against the shared synthetic artifact base.
 * @param {string} filename - Logical artifact filename.
 * @returns {string[]} Resolved path parts.
 */
function resolvedArtifactPathParts(filename) {
  const parts = [...syntheticArtifactBase]

  for (const part of filename.replaceAll("\\", "/").split("/")) {
    if (part == "" || part == ".") continue
    if (part == "..") {
      if (parts.length > syntheticArtifactBase.length) parts.pop()
    } else parts.push(part)
  }

  return parts
}

/**
 * Encodes literal filesystem path segments without encoding structural slashes.
 * @param {string} path - Relative artifact path.
 * @returns {string} URL-safe relative artifact path.
 */
function encodeArtifactPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/")
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
