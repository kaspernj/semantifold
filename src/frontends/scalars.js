// @ts-check

import {missingType} from "../diagnostic.js"
import {setParserRanges} from "../semantic/provenance.js"
import {scalarType} from "../semantic/scalars.js"

/**
 * Builds a source-spelling map with exact semantic scalar values.
 * @param {readonly (readonly [string, import("../semantic/types.js").SemanticTypeName])[]} entries - Source mappings.
 * @returns {Map<string, import("../semantic/types.js").SemanticTypeName>} Source type map.
 */
function sourceTypeMap(entries) {
  return new Map(entries)
}

/** @type {Readonly<Record<import("../semantic/types.js").SemanticLanguage, Map<string, import("../semantic/types.js").SemanticTypeName>>>} */
const sourceScalarTypes = Object.freeze({
  csharp: sourceTypeMap([
    ["long", "integer"],
    ["System.Int64", "integer"],
    ["bool", "boolean"],
    ["System.Boolean", "boolean"],
    ["string", "string"],
    ["System.String", "string"]
  ]),
  go: sourceTypeMap([
    ["int64", "integer"],
    ["bool", "boolean"],
    ["string", "string"]
  ]),
  java: sourceTypeMap([
    ["int", "integer"],
    ["boolean", "boolean"],
    ["String", "string"],
    ["java.lang.String", "string"]
  ]),
  javascript: sourceTypeMap([
    ["number", "integer"],
    ["boolean", "boolean"],
    ["string", "string"]
  ]),
  php: sourceTypeMap([
    ["int", "integer"],
    ["bool", "boolean"],
    ["string", "string"]
  ]),
  python: sourceTypeMap([
    ["int", "integer"],
    ["bool", "boolean"],
    ["str", "string"]
  ]),
  ruby: sourceTypeMap([
    ["[Integer]", "integer"],
    ["[bool]", "boolean"],
    ["[String]", "string"]
  ]),
  typescript: sourceTypeMap([
    ["number", "integer"],
    ["boolean", "boolean"],
    ["string", "string"]
  ])
})

/**
 * Looks up an exact source scalar spelling without inspecting parser nodes.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Source language.
 * @param {string} sourceType - Exact source type spelling.
 * @param {import("../semantic/types.js").SourceLocation} [location] - Exact parser-owned type spelling.
 * @returns {import("../semantic/types.js").TypeReference | undefined} Semantic type when supported.
 */
export function sourceScalarType(language, sourceType, location) {
  const name = sourceScalarTypes[language].get(sourceType)
  const type = name ? scalarType(name) : undefined

  if (type && location) setParserRanges(type, {type: location})

  return type
}

/**
 * Requires an exact supported source scalar spelling.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Source language.
 * @param {string | undefined} sourceType - Exact source type spelling.
 * @param {string} subject - Typed source subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Owning source location.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact parser-owned type spelling.
 * @returns {import("../semantic/types.js").TypeReference} Semantic scalar type.
 */
export function requireSourceScalarType(language, sourceType, subject, location, typeLocation = location) {
  const type = sourceType ? sourceScalarType(language, sourceType, typeLocation) : undefined

  if (!type) return missingType(language, subject, location)

  return type
}
