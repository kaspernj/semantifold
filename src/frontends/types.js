// @ts-check

import {missingType, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets} from "../semantic/location.js"
import {parserRangeFor, setParserRanges} from "../semantic/provenance.js"
import {sourceScalarType} from "./scalars.js"

/**
 * Builds one recursive semantic list type with parser-owned constituent ranges.
 * @param {import("../semantic/types.js").SemanticValueType} elementType - Element type.
 * @param {import("../semantic/types.js").SourceLocation} location - Complete type-expression range.
 * @param {import("../semantic/types.js").SourceLocation} elementLocation - Element type-expression range.
 * @returns {import("../semantic/types.js").ListType} List type.
 */
export function listType(elementType, location, elementLocation) {
  const type = {elementType, kind: /** @type {const} */ ("ListType")}

  setParserRanges(type, {elementType: elementLocation, type: location})
  return type
}

/**
 * Builds one recursive semantic map type with parser-owned constituent ranges.
 * @param {import("../semantic/types.js").TypeReference} keyType - Key type.
 * @param {import("../semantic/types.js").SemanticValueType} valueType - Value type.
 * @param {import("../semantic/types.js").SourceLocation} location - Complete type-expression range.
 * @param {import("../semantic/types.js").SourceLocation} keyLocation - Key type-expression range.
 * @param {import("../semantic/types.js").SourceLocation} valueLocation - Value type-expression range.
 * @returns {import("../semantic/types.js").MapType} Map type.
 */
export function mapType(keyType, valueType, location, keyLocation, valueLocation) {
  const type = {keyType, kind: /** @type {const} */ ("MapType"), valueType}

  setParserRanges(type, {keyType: keyLocation, type: location, valueType: valueLocation})
  return type
}

/**
 * Converts one parser/comment-parser-owned bounded type expression. This parser
 * recognizes only Task 006's concrete scalar/list/map grammar; it never scans
 * source outside the already-associated type token.
 * @param {object} input - Documented type input.
 * @param {"javascript" | "php" | "ruby"} input.language - Comment profile.
 * @param {import("../semantic/types.js").SourceLocation} input.location - Exact type token range.
 * @param {import("../semantic/types.js").SourceLocation} input.ownerLocation - Owning declaration range.
 * @param {string} input.source - Complete parser input for exact subranges.
 * @param {string | undefined} input.sourceType - Exact comment-parser/Prism-owned type token.
 * @param {string} input.subject - Diagnostic subject.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic value type.
 */
export function documentedValueType({language, location, ownerLocation, source, sourceType, subject}) {
  if (!sourceType) return missingType(language, subject, ownerLocation)

  const scalar = sourceScalarType(language, sourceType, location)

  if (scalar) return scalar
  const collectionPrefixes = language == "ruby" ? ["[Array", "[Hash"] :
    language == "php" ? ["list", "array"] : ["ReadonlyArray", "ReadonlyMap"]

  if (!collectionPrefixes.some((prefix) => sourceType.startsWith(prefix))) {
    return missingType(language, subject, ownerLocation)
  }

  const parser = new DocumentedTypeParser(language, sourceType, location, source)
  const type = parser.parse()

  if (!parser.atEnd()) return unsupportedSyntax(language, "unsupported collection type", parser.remainingLocation())

  return type
}

class DocumentedTypeParser {
  /**
   * Creates a bounded parser over one parser/comment-parser-owned token.
   * @param {"javascript" | "php" | "ruby"} language - Exact comment profile.
   * @param {string} text - Parser-owned type text.
   * @param {import("../semantic/types.js").SourceLocation} location - Whole token location.
   * @param {string} source - Complete source.
   */
  constructor(language, text, location, source) {
    this.language = language
    this.text = text
    this.location = location
    this.source = source
    this.offset = 0
  }

  /**
   * Parses the complete documented type.
   * @returns {import("../semantic/types.js").SemanticValueType} Parsed type.
   */
  parse() {
    this.skipWhitespace()
    if (this.language == "ruby") {
      if (!this.consume("[")) return this.failure()
      const type = this.parseNamedType()

      this.skipWhitespace()
      if (!this.consume("]")) return this.failure()
      this.skipWhitespace()
      return type
    }

    const type = this.parseNamedType()

    this.skipWhitespace()
    return type
  }

  /**
   * Parses one nested type expression.
   * @returns {import("../semantic/types.js").SemanticValueType} Parsed nested type.
   */
  parseNamedType() {
    this.skipWhitespace()
    const start = this.offset

    while (isTypeIdentifierCharacter(this.text[this.offset])) this.offset++
    const nameEnd = this.offset
    const name = this.text.slice(start, nameEnd)

    if (!name) return this.failure()
    const scalarSpelling = this.language == "ruby" ? `[${name}]` : name
    const scalar = sourceScalarType(this.language, scalarSpelling, this.range(start, nameEnd))

    this.skipWhitespace()
    if (scalar && this.text[this.offset] != "<" && this.text[this.offset] != "[") return scalar

    const listName = this.language == "ruby" ? "Array" : this.language == "php" ? "list" : "ReadonlyArray"
    const mapName = this.language == "ruby" ? "Hash" : this.language == "php" ? "array" : "ReadonlyMap"
    const opening = this.language == "ruby" ? "[" : "<"
    const closing = this.language == "ruby" ? "]" : ">"

    if (name != listName && name != mapName || !this.consume(opening)) return this.failure()
    const first = this.parseNamedType()
    const firstEnd = this.offset

    this.skipWhitespace()
    if (name == listName) {
      if (!this.consume(closing)) return this.failure()
      return listType(first, this.range(start, this.offset), this.typeRange(first, start, firstEnd))
    }
    if (!this.consume(",")) return this.failure()
    const second = this.parseNamedType()
    const secondEnd = this.offset

    this.skipWhitespace()
    if (!this.consume(closing)) return this.failure()
    if (first.kind != "TypeReference") {
      return unsupportedSyntax(this.language, "map key type other than string", this.typeRange(first, start, firstEnd))
    }

    return mapType(
      first,
      second,
      this.range(start, this.offset),
      this.typeRange(first, start, firstEnd),
      this.typeRange(second, firstEnd, secondEnd)
    )
  }

  /**
   * Reports whether the complete token was consumed.
   * @returns {boolean} Whether the whole token was consumed.
   */
  atEnd() {
    return this.offset == this.text.length
  }

  /**
   * Locates the remaining invalid suffix.
   * @returns {import("../semantic/types.js").SourceLocation} Remaining invalid range.
   */
  remainingLocation() {
    return this.range(this.offset, Math.max(this.offset + 1, this.text.length))
  }

  /**
   * Consumes one exact punctuation token.
   * @param {string} token - Exact punctuation.
   * @returns {boolean} Whether consumed.
   */
  consume(token) {
    this.skipWhitespace()
    if (!this.text.startsWith(token, this.offset)) return false
    this.offset += token.length
    return true
  }

  /**
   * Skips bounded type-expression whitespace.
   * @returns {void}
   */
  skipWhitespace() {
    while ([" ", "\t", "\r", "\n"].includes(this.text[this.offset])) this.offset++
  }

  /**
   * Converts relative offsets into parser-owned source coordinates.
   * @param {number} start - Relative start.
   * @param {number} end - Relative end.
   * @returns {import("../semantic/types.js").SourceLocation} Exact source range.
   */
  range(start, end) {
    return locationFromOffsets(
      this.location.filename,
      this.source,
      this.location.start.offset + start,
      this.location.start.offset + Math.min(end, this.text.length)
    )
  }

  /**
   * Returns a nested type's parser range.
   * @param {import("../semantic/types.js").SemanticValueType} type - Parsed type.
   * @param {number} start - Fallback start.
   * @param {number} end - Fallback end.
   * @returns {import("../semantic/types.js").SourceLocation} Exact type range.
   */
  typeRange(type, start, end) {
    return parserRangeFor(type, "type") ?? this.range(start, end)
  }

  /**
   * Reports a bounded type-parser failure.
   * @returns {import("../semantic/types.js").SemanticValueType} Unreachable semantic type.
   */
  failure() {
    return unsupportedSyntax(this.language, "unsupported collection type", this.remainingLocation())
  }
}

/**
 * Checks the bounded identifier alphabet.
 * @param {string | undefined} character - Candidate source character.
 * @returns {boolean} Whether it belongs to the bounded ASCII type grammar.
 */
function isTypeIdentifierCharacter(character) {
  return (character !== undefined && character >= "A" && character <= "Z") ||
    (character !== undefined && character >= "a" && character <= "z") ||
    (character !== undefined && character >= "0" && character <= "9") || character == "_"
}
