// @ts-check

import {missingType, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets} from "../semantic/location.js"
import {parserRangeFor, setParserRanges} from "../semantic/provenance.js"
import {sourceScalarType} from "./scalars.js"

/**
 * Resolves the value presented to list iteration after canonical optional unwrap.
 * Semantic validation remains responsible for requiring the matching presence proof.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} type - Parser-resolved operand type.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} Iterated value type.
 */
export function iterationOperandType(type) {
  return type?.kind == "OptionalType" ? type.valueType : type
}

/**
 * Copies a resolved list element type for one parser-owned iteration binding.
 * The binding location is its own deterministic derived type anchor.
 * @param {import("../semantic/types.js").SemanticValueType} type - Resolved element type.
 * @param {import("../semantic/types.js").SourceLocation} location - Binding token location.
 * @returns {import("../semantic/types.js").SemanticValueType} Detached semantic type.
 */
export function iterationBindingType(type, location) {
  if (type.kind == "TypeReference") {
    const copied = {kind: /** @type {const} */ ("TypeReference"), name: type.name}

    setParserRanges(copied, {type: location})
    return copied
  }
  if (type.kind == "TypeVariableReference") return typeVariable(type.parameterId, location)
  if (type.kind == "ListType") {
    return listType(iterationBindingType(type.elementType, location), location, location)
  }
  if (type.kind == "MapType") {
    const keyType = iterationBindingType(type.keyType, location)

    return mapType(
      /** @type {import("../semantic/types.js").TypeReference} */ (keyType),
      iterationBindingType(type.valueType, location),
      location,
      location,
      location
    )
  }

  if (type.kind == "RecordType") return recordType(type.declarationId, location,
    type.arguments?.map((argument) => iterationBindingType(argument, location)))

  return optionalType(iterationBindingType(type.valueType, location), location, location)
}

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
 * Builds one recursive semantic optional type with parser-owned constituent ranges.
 * @param {import("../semantic/types.js").SemanticValueType} valueType - Present-value type.
 * @param {import("../semantic/types.js").SourceLocation} location - Complete type-expression range.
 * @param {import("../semantic/types.js").SourceLocation} valueLocation - Present-value type range.
 * @returns {import("../semantic/types.js").OptionalType} Optional type.
 */
export function optionalType(valueType, location, valueLocation) {
  const type = {kind: /** @type {const} */ ("OptionalType"), valueType}

  setParserRanges(type, {type: location, valueType: valueLocation})
  return type
}

/**
 * Builds one nominal semantic record type with a parser-owned name range.
 * @param {string} declarationId - Stable declaration identity.
 * @param {import("../semantic/types.js").SourceLocation} location - Record type-name range.
 * @param {import("../semantic/types.js").SemanticValueType[]} [arguments_] - Exact generic arguments.
 * @returns {import("../semantic/types.js").RecordType} Record type.
 */
export function recordType(declarationId, location, arguments_) {
  const type = {declarationId, kind: /** @type {const} */ ("RecordType"), ...(arguments_ ? {arguments: arguments_} : {})}

  setParserRanges(type, {type: location})
  return type
}

/**
 * Builds one declaration-scoped type-variable reference.
 * @param {string} parameterId - Stable type-parameter identity.
 * @param {import("../semantic/types.js").SourceLocation} location - Exact reference range.
 * @returns {import("../semantic/types.js").TypeVariableReference} Type-variable reference.
 */
export function typeVariable(parameterId, location) {
  const type = {kind: /** @type {const} */ ("TypeVariableReference"), location, parameterId}

  setParserRanges(type, {type: location})
  return type
}

/**
 * Compares semantic type expressions while ignoring parser-owned locations.
 * @param {import("../semantic/types.js").SemanticValueType} left - Left type.
 * @param {import("../semantic/types.js").SemanticValueType} right - Right type.
 * @returns {boolean} Whether the semantic structures are identical.
 */
export function sameValueType(left, right) {
  if (left.kind != right.kind) return false
  if (left.kind == "TypeReference" && right.kind == "TypeReference") return left.name == right.name
  if (left.kind == "TypeVariableReference" && right.kind == "TypeVariableReference") return left.parameterId == right.parameterId
  if (left.kind == "ListType" && right.kind == "ListType") return sameValueType(left.elementType, right.elementType)
  if (left.kind == "OptionalType" && right.kind == "OptionalType") return sameValueType(left.valueType, right.valueType)
  if (left.kind == "MapType" && right.kind == "MapType") {
    return sameValueType(left.keyType, right.keyType) && sameValueType(left.valueType, right.valueType)
  }
  if (left.kind == "RecordType" && right.kind == "RecordType") {
    const leftArguments = left.arguments ?? []
    const rightArguments = right.arguments ?? []

    return left.declarationId == right.declarationId && leftArguments.length == rightArguments.length &&
      leftArguments.every((argument, index) => sameValueType(argument, rightArguments[index]))
  }

  return false
}

/**
 * Converts one parser/comment-parser-owned bounded type expression. This parser
 * recognizes only Task 006's concrete scalar/list/map grammar; it never scans
 * source outside the already-associated type token.
 * @param {object} input - Documented type input.
 * @param {"javascript" | "php" | "ruby"} input.language - Comment profile.
 * @param {import("../semantic/types.js").SourceLocation} input.location - Exact type token range.
 * @param {import("../semantic/types.js").SourceLocation} input.ownerLocation - Owning declaration range.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [input.records] - Available nominal records by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [input.typeParameters] - Declaration-scoped parameters by name.
 * @param {string} input.source - Complete parser input for exact subranges.
 * @param {string | undefined} input.sourceType - Exact comment-parser/Prism-owned type token.
 * @param {string} input.subject - Diagnostic subject.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic value type.
 */
export function documentedValueType({language, location, ownerLocation, records = new Map(), source, sourceType, subject, typeParameters = new Map()}) {
  if (!sourceType) return missingType(language, subject, ownerLocation)

  if (language == "php" && sourceType.startsWith("?")) {
    const valueText = sourceType.slice(1)
    const valueLocation = locationFromOffsets(
      location.filename,
      source,
      location.start.offset + 1,
      location.end.offset
    )

    return optionalType(
      documentedValueType({language, location: valueLocation, ownerLocation, records, source, sourceType: valueText, subject, typeParameters}),
      location,
      valueLocation
    )
  }
  if (language == "php" && sourceType.includes("|")) {
    return unsupportedSyntax(language, "arbitrary union type", location)
  }
  if (language == "javascript" && sourceType.endsWith("|null") && sourceType.indexOf("|") == sourceType.length - "|null".length) {
    const valueText = sourceType.slice(0, -"|null".length)
    const valueLocation = locationFromOffsets(
      location.filename,
      source,
      location.start.offset,
      location.start.offset + valueText.length
    )

    return optionalType(
      documentedValueType({language, location: valueLocation, ownerLocation, records, source, sourceType: valueText, subject, typeParameters}),
      location,
      valueLocation
    )
  }
  if (language == "javascript" && sourceType.includes("|") &&
    !sourceType.startsWith("ReadonlyArray") && !sourceType.startsWith("ReadonlyMap")) {
    return unsupportedSyntax(language, "arbitrary union type", location)
  }

  const scalar = sourceScalarType(language, sourceType, location)

  if (scalar) return scalar
  const unwrappedName = language == "ruby" && sourceType.startsWith("[") && sourceType.endsWith("]")
    ? sourceType.slice(1, -1)
    : sourceType
  const directRecord = records.get(unwrappedName)

  if (directRecord?.id) return recordType(directRecord.id, location)
  const directTypeParameter = typeParameters.get(unwrappedName)

  if (directTypeParameter?.id) return typeVariable(directTypeParameter.id, location)
  const collectionPrefixes = language == "ruby" ? ["[Array", "[Hash", "[Integer?", "[bool?", "[String?"] :
    language == "php" ? ["list", "array"] : ["ReadonlyArray", "ReadonlyMap"]
  const optionalRecord = language == "ruby" && sourceType.startsWith("[") && sourceType.endsWith("?]") &&
    records.has(sourceType.slice(1, -2))

  const possibleName = unwrappedName.slice(0, unwrappedName.search(/[<[?]/u) < 0 ? unwrappedName.length : unwrappedName.search(/[<[?]/u))

  if (!optionalRecord && !collectionPrefixes.some((prefix) => sourceType.startsWith(prefix)) &&
    !records.has(possibleName) && !typeParameters.has(possibleName)) {
    return missingType(language, subject, ownerLocation)
  }

  const parser = new DocumentedTypeParser(language, sourceType, location, source, records, typeParameters)
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
   * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Available nominal records.
   * @param {Map<string, import("../semantic/types.js").TypeParameter>} typeParameters - Declaration-scoped parameters.
   */
  constructor(language, text, location, source, records, typeParameters) {
    this.language = language
    this.text = text
    this.location = location
    this.source = source
    this.records = records
    this.typeParameters = typeParameters
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

    if (this.language == "php" && this.consume("?")) {
      const valueStart = this.offset
      const valueType = this.parseNamedType()

      return optionalType(
        valueType,
        this.range(start, this.offset),
        this.typeRange(valueType, valueStart, this.offset)
      )
    }

    while (isTypeIdentifierCharacter(this.text[this.offset]) || this.language == "ruby" &&
      this.text[this.offset] == ":" && this.text[this.offset + 1] == ":" &&
      isTypeIdentifierCharacter(this.text[this.offset + 2])) {
      this.offset += this.text[this.offset] == ":" ? 2 : 1
    }
    const nameEnd = this.offset
    const name = this.text.slice(start, nameEnd)

    if (!name) return this.failure()
    const scalarSpelling = this.language == "ruby" ? `[${name}]` : name
    const scalar = sourceScalarType(this.language, scalarSpelling, this.range(start, nameEnd))

    this.skipWhitespace()
    if (scalar && this.text[this.offset] != "<" && this.text[this.offset] != "[") {
      if (this.language == "ruby" && this.consume("?")) {
        return optionalType(scalar, this.range(start, this.offset), this.typeRange(scalar, start, nameEnd))
      }
      if (this.language == "javascript" && this.consume("|null")) {
        return optionalType(scalar, this.range(start, this.offset), this.typeRange(scalar, start, nameEnd))
      }

      return scalar
    }
    const record = this.records.get(name)
    const typeParameter = this.typeParameters.get(name)

    if (typeParameter?.id && this.text[this.offset] != "<" && this.text[this.offset] != "[") {
      return typeVariable(typeParameter.id, this.range(start, nameEnd))
    }

    if (record?.id && this.text[this.offset] != "<" && this.text[this.offset] != "[") {
      const type = recordType(record.id, this.range(start, nameEnd))

      if (this.language == "ruby" && this.consume("?")) {
        return optionalType(type, this.range(start, this.offset), this.typeRange(type, start, nameEnd))
      }
      if (this.language == "javascript" && this.consume("|null")) {
        return optionalType(type, this.range(start, this.offset), this.typeRange(type, start, nameEnd))
      }

      return type
    }

    const listName = this.language == "ruby" ? "Array" : this.language == "php" ? "list" : "ReadonlyArray"
    const mapName = this.language == "ruby" ? "Hash" : this.language == "php" ? "array" : "ReadonlyMap"
    const opening = this.language == "ruby" ? "[" : "<"
    const closing = this.language == "ruby" ? "]" : ">"

    if (name != listName && name != mapName && !record || !this.consume(opening)) return this.failure()
    const first = this.parseNamedType()
    const firstEnd = this.offset

    this.skipWhitespace()
    if (record?.id) {
      const arguments_ = [first]

      while (this.consume(",")) arguments_.push(this.parseNamedType())
      if (!this.consume(closing)) return this.failure()

      return recordType(record.id, this.range(start, nameEnd), arguments_)
    }
    if (name == listName) {
      if (!this.consume(closing)) return this.failure()
      const type = listType(first, this.range(start, this.offset), this.typeRange(first, start, firstEnd))

      if (this.language == "ruby" && this.consume("?")) {
        return optionalType(type, this.range(start, this.offset), this.typeRange(type, start, firstEnd))
      }
      if (this.language == "javascript" && this.consume("|null")) {
        return optionalType(type, this.range(start, this.offset), this.typeRange(type, start, firstEnd))
      }

      return type
    }
    if (!this.consume(",")) return this.failure()
    const second = this.parseNamedType()
    const secondEnd = this.offset

    this.skipWhitespace()
    if (!this.consume(closing)) return this.failure()
    if (first.kind != "TypeReference") {
      return unsupportedSyntax(this.language, "map key type other than string", this.typeRange(first, start, firstEnd))
    }

    const type = mapType(
      first,
      second,
      this.range(start, this.offset),
      this.typeRange(first, start, firstEnd),
      this.typeRange(second, firstEnd, secondEnd)
    )

    if (this.language == "ruby" && this.consume("?")) {
      return optionalType(type, this.range(start, this.offset), this.typeRange(type, start, secondEnd))
    }
    if (this.language == "javascript" && this.consume("|null")) {
      return optionalType(type, this.range(start, this.offset), this.typeRange(type, start, secondEnd))
    }

    return type
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
    return unsupportedSyntax(
      this.language,
      this.text.slice(this.offset).includes("|") ? "arbitrary union type" : "unsupported collection type",
      this.remainingLocation()
    )
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
