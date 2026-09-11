// @ts-check

import {parse as parseBabel} from "@babel/parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceReturnType, requireSourceScalarType} from "./scalars.js"
import {documentedValueType, iterationBindingType, iterationOperandType, listType, mapType, optionalType, recordType} from "./types.js"

/** @typedef {NonNullable<import("@babel/parser").ParseResult<import("@babel/types").File>["tokens"]>[number]} BabelToken */
/** @typedef {{byStart: Map<number, BabelToken>, tokens: BabelToken[]}} BabelTokenIndex */
/** @typedef {{name: string, nameLocation: import("../semantic/types.js").SourceLocation, parameters: import("../semantic/types.js").Parameter[], returnType: import("../semantic/types.js").SemanticFunctionReturnType, location: import("../semantic/types.js").SourceLocation}} JavaScriptFunctionSignature */
/** @typedef {{bindings: Map<string, import("../semantic/types.js").SemanticValueType>, functions: Map<string, JavaScriptFunctionSignature>, recordNames: Map<string, import("../semantic/types.js").RecordDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, returnType?: import("../semantic/types.js").SemanticFunctionReturnType}} JavaScriptConversionContext */

/** @type {WeakMap<object, BabelTokenIndex>} */
const nodeTokens = new WeakMap()
const babelBinaryOperations = new Map([
  ["+", "Add"],
  ["-", "Subtract"],
  ["*", "Multiply"],
  ["===", "Equal"],
  ["!==", "NotEqual"],
  ["<", "LessThan"],
  ["<=", "LessThanOrEqual"],
  [">", "GreaterThan"],
  [">=", "GreaterThanOrEqual"]
])

/**
 * Returns a source location for a Babel node.
 * @param {import("@babel/types").Node} node - Babel node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Normalized location.
 */
function nodeLocation(node, filename, source) {
  if (typeof node.start != "number" || typeof node.end != "number") {
    throw new Error(`Babel omitted source offsets for ${node.type}.`)
  }

  return locationFromOffsets(filename, source, node.start, node.end)
}

/**
 * Returns the identifier spelling rather than a trailing TypeScript annotation.
 * @param {import("@babel/types").Identifier} node - Parser identifier.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Identifier location.
 */
function identifierLocation(node, filename, source) {
  if (typeof node.start != "number") throw new Error("Babel omitted an identifier start offset.")
  const token = nodeTokens.get(node)?.byStart.get(node.start)

  if (!token || token.type.label != "name") throw new Error(`Babel omitted the identifier token for '${node.name}'.`)

  return locationFromOffsets(filename, source, token.start, token.end)
}

/**
 * Locates one Babel token within parser-node boundaries.
 * @param {import("@babel/types").Node} owner - Token-owning parser node.
 * @param {string} value - Exact token spelling.
 * @param {number} startOffset - Inclusive boundary.
 * @param {number} endOffset - Exclusive boundary.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Exact token location.
 */
function tokenLocation(owner, value, startOffset, endOffset, filename, source) {
  const tokens = nodeTokens.get(owner)?.tokens ?? []
  let low = 0
  let high = tokens.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (tokens[middle].start < startOffset) low = middle + 1
    else high = middle
  }
  let token

  for (let index = low; index < tokens.length && tokens[index].start < endOffset; index++) {
    const candidate = tokens[index]

    if (candidate.end <= endOffset && (candidate.value == value || candidate.type.label == value)) {
      token = candidate
      break
    }
  }

  if (!token) throw new Error(`Babel omitted token '${value}' between ${startOffset} and ${endOffset}.`)

  return locationFromOffsets(filename, source, token.start, token.end)
}

/**
 * Locates a comment-parser token inside a Babel-owned doc comment.
 * @param {import("@babel/types").CommentBlock} comment - Babel doc comment.
 * @param {import("comment-parser").Spec} tag - Parsed doc tag.
 * @param {"name" | "type"} field - Token field.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Exact token location.
 */
function commentTagLocation(comment, tag, field, filename, source) {
  const line = tag.source[0]

  if (typeof comment.start != "number" || !line) throw new Error(`Comment parser omitted the @${tag.tag} source token.`)

  let lineStart = comment.start

  for (let lineNumber = 0; lineNumber < line.number; lineNumber++) {
    while (lineStart < source.length && source[lineStart] != "\r" && source[lineStart] != "\n") lineStart++
    if (source[lineStart] == "\r" && source[lineStart + 1] == "\n") lineStart += 2
    else lineStart++
  }

  const orderedFields = ["start", "delimiter", "postDelimiter", "tag", "postTag", "type", "postType", "name"]
  const fieldIndex = orderedFields.indexOf(field)
  let start = lineStart + orderedFields.slice(0, fieldIndex).reduce((length, key) =>
    length + line.tokens[/** @type {keyof typeof line.tokens} */ (key)].length, 0)
  const token = line.tokens[field]
  let length = token.length

  if (field == "type" && tag.type) {
    const nestedOffset = token.indexOf(tag.type)

    if (nestedOffset < 0) throw new Error(`Comment parser omitted the @${tag.tag} type spelling.`)
    start += nestedOffset
    length = tag.type.length
  }

  return locationFromOffsets(filename, source, start, start + length)
}

/**
 * Converts a supported Babel expression.
 * @param {import("@babel/types").Expression} node - Babel expression.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaScriptConversionContext} [context] - Typed lexical conversion context.
 * @param {import("../semantic/types.js").SemanticValueType} [expectedType] - Explicit contextual value type.
 * @param {boolean} [preserveOptional] - Whether an optional identifier remains wrapped.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, language, filename, source, context = {bindings: new Map(), functions: new Map(), recordNames: new Map(), records: new Map()}, expectedType, preserveOptional = false) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "Identifier" && node.name == "undefined") {
    return unsupportedSyntax(language, "undefined absence value", location)
  }

  if (expectedType?.kind == "OptionalType") {
    if (node.type == "NullLiteral") {
      return withParserRanges({kind: /** @type {const} */ ("OptionalNone"), location}, {absence: location})
    }
    if (knownExpressionType(node, context)?.kind == "OptionalType") {
      return convertExpression(node, language, filename, source, context, undefined, true)
    }
    return withParserRanges({
      kind: /** @type {const} */ ("OptionalSome"),
      location,
      value: convertExpression(node, language, filename, source, context, expectedType.valueType)
    }, {some: location})
  }

  if (node.type == "NullLiteral") return unsupportedSyntax(language, "null outside an explicit optional context", location)

  if (node.type == "TSNonNullExpression") {
    const expression = convertExpression(node.expression, language, filename, source, context)

    if (language != "typescript" || expression.kind != "MapLookupExpression") {
      return unsupportedSyntax(language, "non-null assertion other than Map.get result", location)
    }
    expression.location = location
    return expression
  }

  if (node.type == "Identifier") {
    const identifier = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: node.name}, {
      name: identifierLocation(node, filename, source)
    })

    if (!preserveOptional && context.bindings.get(node.name)?.kind == "OptionalType") {
      return withParserRanges({kind: /** @type {const} */ ("OptionalUnwrap"), location, operand: identifier}, {unwrap: location})
    }

    return identifier
  }

  if (node.type == "NumericLiteral") {
    if (!Number.isSafeInteger(node.value)) return unsupportedSyntax(language, "non-safe integer literal", location)

    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value: node.value}, {literal: location})
  }

  if (node.type == "BooleanLiteral") {
    if (typeof node.value != "boolean") return unsupportedSyntax(language, "invalid boolean literal value", location)

    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: node.value}, {literal: location})
  }

  if (node.type == "StringLiteral") {
    if (typeof node.value != "string" || !hasOnlyUnicodeScalars(node.value)) {
      return unsupportedSyntax(language, "invalid Unicode string literal", location)
    }

    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: node.value}, {literal: location})
  }

  if (node.type == "ArrayExpression") {
    const elementType = expectedType?.kind == "ListType" ? expectedType.elementType : undefined
    const elements = node.elements.map((element, index) => {
      if (!element) return unsupportedSyntax(language, "sparse array hole", arrayHoleLocation(node, index, filename, source))
      if (element.type == "SpreadElement") return unsupportedSyntax(language, "array spread", nodeLocation(element, filename, source))

      return convertExpression(element, language, filename, source, context, elementType)
    })

    return withParserRanges({elements, kind: /** @type {const} */ ("ListLiteral"), location}, {literal: location})
  }

  if (node.type == "NewExpression" && node.callee.type == "Identifier" && node.callee.name == "Map") {
    if (expectedType?.kind == "RecordType") return unsupportedSyntax(language, "Map used as a structural record substitute", location)
    if (node.typeArguments || node.typeParameters || node.arguments.length > 1) {
      return unsupportedSyntax(language, "generic or invalid Map construction", location)
    }
    const initializer = node.arguments[0]

    if (!initializer) return withParserRanges({entries: [], kind: /** @type {const} */ ("MapLiteral"), location}, {literal: location})
    if (initializer.type == "SpreadElement" || initializer.type == "ArgumentPlaceholder") {
      return unsupportedSyntax(language, initializer.type, nodeLocation(initializer, filename, source))
    }
    if (initializer.type != "ArrayExpression") {
      return unsupportedSyntax(language, "Map initializer other than an entry array", nodeLocation(initializer, filename, source))
    }
    const valueType = expectedType?.kind == "MapType" ? expectedType.valueType : undefined
    const entries = initializer.elements.map((element, index) => {
      if (!element) return unsupportedSyntax(language, "sparse map initializer", arrayHoleLocation(initializer, index, filename, source))
      if (element.type == "SpreadElement") return unsupportedSyntax(language, "map spread", nodeLocation(element, filename, source))
      if (element.type != "ArrayExpression" || element.elements.length != 2) {
        return unsupportedSyntax(language, "Map entry other than a key/value pair", nodeLocation(element, filename, source))
      }
      const [key, value] = element.elements

      if (!key) return unsupportedSyntax(language, "sparse map key", arrayHoleLocation(element, 0, filename, source))
      if (!value) return unsupportedSyntax(language, "sparse map value", arrayHoleLocation(element, 1, filename, source))
      if (key.type == "SpreadElement" || value.type == "SpreadElement") {
        const spread = key.type == "SpreadElement" ? key : value

        return unsupportedSyntax(language, "map entry spread", nodeLocation(spread, filename, source))
      }
      if (key.type != "StringLiteral") {
        return unsupportedSyntax(language, "map key other than a string literal", nodeLocation(key, filename, source))
      }
      const keyExpression = /** @type {import("../semantic/types.js").StringLiteral} */ (
        convertExpression(key, language, filename, source, context)
      )

      return withParserRanges({
        key: keyExpression,
        kind: /** @type {const} */ ("MapEntry"),
        location: nodeLocation(element, filename, source),
        value: convertExpression(value, language, filename, source, context, valueType)
      }, {
        key: keyExpression.location,
        operator: tokenLocation(element, ",", key.end ?? element.start ?? 0, value.start ?? element.end ?? source.length, filename, source)
      })
    })

    return withParserRanges({entries, kind: /** @type {const} */ ("MapLiteral"), location}, {literal: location})
  }

  if (node.type == "NewExpression" && node.callee.type == "Identifier" && context.recordNames.has(node.callee.name)) {
    if (node.typeArguments || node.typeParameters) return unsupportedSyntax(language, "generic record construction", location)
    const declaration = /** @type {import("../semantic/types.js").RecordDeclaration} */ (context.recordNames.get(node.callee.name))
    const arguments_ = node.arguments.map((argument, index) => {
      if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
        return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
      }

      return convertExpression(argument, language, filename, source, context, declaration.fields[index]?.type)
    })

    return withParserRanges({
      arguments: arguments_,
      kind: /** @type {const} */ ("RecordConstruction"),
      location,
      record: recordType(/** @type {string} */ (declaration.id), identifierLocation(node.callee, filename, source))
    }, {record: identifierLocation(node.callee, filename, source)})
  }

  if (node.type == "MemberExpression" && !node.optional && node.object.type != "Super") {
    if (node.computed) {
      if (knownValueExpressionType(node.object, context)?.kind == "RecordType") {
        return unsupportedSyntax(language, "computed record member access", nodeLocation(node.property, filename, source))
      }
      if (node.property.type == "PrivateName") return unsupportedSyntax(language, node.property.type, location)

      return withParserRanges({
        collection: convertExpression(node.object, language, filename, source, context),
        index: convertExpression(node.property, language, filename, source, context),
        kind: /** @type {const} */ ("ListIndexExpression"),
        location,
        totality: /** @type {const} */ ("proven")
      }, {
        operator: tokenLocation(node, "[", node.object.end ?? node.start ?? 0, node.property.start ?? node.end ?? source.length, filename, source)
      })
    }
    if (node.property.type == "Identifier" && ["length", "size"].includes(node.property.name)) {
      const receiverType = knownValueExpressionType(node.object, context)

      if (receiverType?.kind == "RecordType") {
        return withParserRanges({
          field: node.property.name,
          kind: /** @type {const} */ ("MemberRead"),
          location,
          receiver: convertExpression(node.object, language, filename, source, context)
        }, {member: identifierLocation(node.property, filename, source)})
      }
      return withParserRanges({
        collection: convertExpression(node.object, language, filename, source, context),
        collectionKind: /** @type {"list" | "map"} */ (node.property.name == "length" ? "list" : "map"),
        kind: /** @type {const} */ ("CollectionSizeExpression"),
        location
      }, {operator: identifierLocation(node.property, filename, source)})
    }
    if (node.property.type == "Identifier") {
      return withParserRanges({
        field: node.property.name,
        kind: /** @type {const} */ ("MemberRead"),
        location,
        receiver: convertExpression(node.object, language, filename, source, context)
      }, {member: identifierLocation(node.property, filename, source)})
    }
  }

  if (node.type == "TemplateLiteral") {
    if (node.expressions.length > 0) return unsupportedSyntax(language, "interpolated string", location)

    const quasi = node.quasis[0]

    if (typeof quasi.value.cooked != "string" || !hasOnlyUnicodeScalars(quasi.value.cooked)) {
      return unsupportedSyntax(language, "invalid Unicode string literal", location)
    }

    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: quasi.value.cooked}, {literal: location})
  }

  if (node.type == "UnaryExpression" && ["!", "-"].includes(node.operator)) {
    const operand = convertExpression(node.argument, language, filename, source, context)
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand
    }, {
      operator: tokenLocation(node, node.operator, node.start ?? 0, node.argument.start ?? node.end ?? source.length, filename, source)
    }), node.operator == "!" ? "Not" : "Negate")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.type == "LogicalExpression" && ["&&", "||"].includes(node.operator)) {
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(node.left, language, filename, source, context),
      location,
      right: convertExpression(node.right, language, filename, source, context)
    }, {
      operator: tokenLocation(node, node.operator, node.left.end ?? node.start ?? 0, node.right.start ?? node.end ?? source.length, filename, source)
    }), node.operator == "&&" ? "And" : "Or")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.type == "BinaryExpression" && node.operator == "!==" && node.left.type == "Identifier" &&
    node.right.type == "NullLiteral") {
    const operand = /** @type {import("../semantic/types.js").IdentifierExpression} */ (
      convertExpression(node.left, language, filename, source, context, undefined, true)
    )

    return withParserRanges({kind: /** @type {const} */ ("OptionalIsPresent"), location, operand}, {
      operator: tokenLocation(node, node.operator, node.left.end ?? node.start ?? 0, node.right.start ?? node.end ?? source.length, filename, source)
    })
  }

  if (node.type == "BinaryExpression" && babelBinaryOperations.has(node.operator)) {
    if (node.left.type == "PrivateName") unsupportedSyntax(language, node.left.type, location)

    const left = convertExpression(node.left, language, filename, source, context)
    const right = convertExpression(node.right, language, filename, source, context)

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left,
      location,
      right
    }, {
      operator: tokenLocation(node, node.operator, node.left.end ?? node.start ?? 0, node.right.start ?? node.end ?? source.length, filename, source)
    }), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (babelBinaryOperations.get(node.operator)))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.type == "BinaryExpression" && ["==", "!="].includes(node.operator)) {
    return unsupportedSyntax(language, `coercive equality ${node.operator}`, location)
  }

  if (node.type == "CallExpression" && node.callee.type == "Identifier") {
    if (node.optional || node.callee.optional || node.typeArguments || node.typeParameters) {
      return unsupportedSyntax(language, "optional or generic call", location)
    }
    const signature = context.functions.get(node.callee.name)
    const arguments_ = node.arguments.map((argument, index) => {
      if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
        return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
      }

      return convertExpression(argument, language, filename, source, context, signature?.parameters[index]?.type)
    })

    return withParserRanges({arguments: arguments_, callee: node.callee.name, kind: /** @type {const} */ ("CallExpression"), location}, {
      callee: identifierLocation(node.callee, filename, source)
    })
  }

  if (node.type == "CallExpression" && !node.optional && !node.typeArguments && !node.typeParameters &&
    node.callee.type == "MemberExpression" && !node.callee.computed && !node.callee.optional &&
    node.callee.object.type != "Super" && node.callee.property.type == "Identifier" &&
    node.callee.property.name == "get") {
    if (node.arguments.length != 1) return unsupportedSyntax(language, "Map.get argument count", location)
    const key = node.arguments[0]

    if (key.type == "SpreadElement" || key.type == "ArgumentPlaceholder") {
      return unsupportedSyntax(language, key.type, nodeLocation(key, filename, source))
    }

    return withParserRanges({
      collection: convertExpression(node.callee.object, language, filename, source, context),
      key: convertExpression(key, language, filename, source, context),
      kind: /** @type {const} */ ("MapLookupExpression"),
      location,
      totality: /** @type {const} */ ("proven")
    }, {operator: identifierLocation(node.callee.property, filename, source)})
  }

  return unsupportedSyntax(language, node.type, location)
}

/**
 * Resolves only expression result types already established by explicit module
 * signatures and collection bindings.
 * @param {import("@babel/types").Expression} node - Parser-owned expression.
 * @param {JavaScriptConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | undefined} Known result type.
 */
function knownExpressionType(node, context) {
  if (node.type == "TSNonNullExpression") return knownExpressionType(node.expression, context)
  if (node.type == "Identifier") return context.bindings.get(node.name)
  if (node.type == "CallExpression" && node.callee.type == "Identifier") {
    return context.functions.get(node.callee.name)?.returnType
  }
  if (node.type == "NewExpression" && node.callee.type == "Identifier") {
    const declaration = context.recordNames.get(node.callee.name)

    if (declaration?.id) return {declarationId: declaration.id, kind: "RecordType"}
  }
  if (node.type == "MemberExpression" && !node.computed && node.object.type != "Super" && node.property.type == "Identifier") {
    const receiver = knownValueExpressionType(node.object, context)
    const declaration = receiver?.kind == "RecordType" ? context.records.get(receiver.declarationId) : undefined
    const memberName = node.property.name

    return declaration?.fields.find((field) => field.name == memberName)?.type
  }
  if (node.type == "MemberExpression" && node.computed && node.object.type != "Super") {
    const collectionType = knownValueExpressionType(node.object, context)

    if (collectionType?.kind == "ListType") return collectionType.elementType
  }
  if (node.type == "CallExpression" && node.callee.type == "MemberExpression" &&
    !node.callee.computed && node.callee.object.type != "Super" &&
    node.callee.property.type == "Identifier" && node.callee.property.name == "get") {
    const collectionType = knownValueExpressionType(node.callee.object, context)

    if (collectionType?.kind == "MapType") return collectionType.valueType
  }

  return undefined
}

/**
 * Resolves the value type produced by the frontend's implicit optional-binding unwrap.
 * Semantic validation separately proves that the unwrap occurs only on a present path.
 * @param {import("@babel/types").Expression} node - Parser-owned expression.
 * @param {JavaScriptConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | undefined} Converted value type.
 */
function knownValueExpressionType(node, context) {
  const type = knownExpressionType(node, context)

  return node.type == "Identifier" && type?.kind == "OptionalType" ? type.valueType : type
}

/**
 * Returns a stable parser-bounded location for one absent array element.
 * @param {import("@babel/types").ArrayExpression} node - Array expression.
 * @param {number} index - Missing element index.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Hole location.
 */
function arrayHoleLocation(node, index, filename, source) {
  const previous = node.elements.slice(0, index).findLast((element) => element != null)
  const next = node.elements.slice(index + 1).find((element) => element != null)
  const start = previous?.end ?? (node.start ?? 0) + 1
  const end = next?.start ?? Math.max(start + 1, (node.end ?? source.length) - 1)

  return locationFromOffsets(filename, source, start, Math.max(start + 1, Math.min(end, source.length)))
}

/**
 * Converts a supported return statement.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, language, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "ReturnStatement") return unsupportedSyntax(language, node.type, location)

  return {
    ...(node.argument ? {expression: convertExpression(
      node.argument,
      language,
      filename,
      source,
      context,
      context.returnType?.kind == "TypeReference" && context.returnType.name == "void" ? undefined : context.returnType
    )} : {}),
    kind: "ReturnStatement",
    location
  }
}

/**
 * Converts one supported local declaration or assignment.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, language, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "VariableDeclaration") {
    if (!["let", "const"].includes(node.kind) || node.declarations.length != 1) {
      return unsupportedSyntax(language, `${node.kind} declaration`, location)
    }

    const declarator = node.declarations[0]
    const declaratorLocation = nodeLocation(declarator, filename, source)

    if (declarator.id.type != "Identifier") return unsupportedSyntax(language, declarator.id.type, declaratorLocation)
    if (!declarator.init) return unsupportedSyntax(language, "uninitialized declaration", declaratorLocation)

    const type = language == "typescript"
      ? convertTypeScriptType(declarator.id.typeAnnotation, `Local '${declarator.id.name}'`, declaratorLocation, filename, source, context.recordNames)
      : localJavaScriptType(node, declarator.id.name, filename, source, context.recordNames)

    const semantic = withParserRanges({
      initializer: convertExpression(declarator.init, language, filename, source, context, type),
      kind: /** @type {const} */ ("LocalDeclaration"),
      location,
      mutable: node.kind == "let",
      name: declarator.id.name,
      type
    }, {
      name: identifierLocation(declarator.id, filename, source),
      operator: tokenLocation(declarator, "=", declarator.id.end ?? declarator.start ?? 0, declarator.init.start ?? declarator.end ?? source.length, filename, source)
    })

    context.bindings.set(declarator.id.name, type)
    return semantic
  }

  if (node.type == "ExpressionStatement" && node.expression.type == "AssignmentExpression") {
    const assignment = node.expression
    const targetLocation = nodeLocation(assignment.left, filename, source)

    if (assignment.operator != "=") return unsupportedSyntax(language, `assignment ${assignment.operator}`, location)
    if (assignment.left.type != "Identifier") return unsupportedSyntax(language, assignment.left.type, targetLocation)

    const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name: assignment.left.name}, {
      name: identifierLocation(assignment.left, filename, source)
    })

    const semantic = withParserRanges({
      expression: convertExpression(assignment.right, language, filename, source, context, context.bindings.get(assignment.left.name)),
      kind: /** @type {const} */ ("AssignmentStatement"),
      location,
      target
    }, {
      operator: tokenLocation(assignment, "=", assignment.left.end ?? assignment.start ?? 0, assignment.right.start ?? assignment.end ?? source.length, filename, source)
    })

    return semantic
  }

  return unsupportedSyntax(language, node.type, location)
}

/**
 * Reads an immediately associated JavaScript local `@type` tag.
 * @param {import("@babel/types").VariableDeclaration} node - Local declaration.
 * @param {string} name - Local name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function localJavaScriptType(node, name, filename, source, recordNames) {
  const comment = node.leadingComments?.at(-1)
  const location = nodeLocation(node, filename, source)

  if (!comment || comment.type != "CommentBlock" || !comment.value.startsWith("*")) {
    return missingType("javascript", `Local '${name}'`, location)
  }

  const gap = source.slice(comment.end ?? 0, node.start ?? 0)

  if (!/^\s*$/u.test(gap) || (gap.match(/\n/gu)?.length ?? 0) > 1) {
    return missingType("javascript", `Local '${name}'`, location)
  }

  const block = parseComment(`/*${comment.value}*/`)[0]
  const tags = block?.tags.filter((tag) => tag.tag == "type") ?? []

  const tag = tags.length == 1 ? tags[0] : undefined

  return convertType(
    tag?.type,
    "javascript",
    `Local '${name}'`,
    location,
    source,
    tag ? commentTagLocation(comment, tag, "type", filename, source) : location,
    recordNames
  )
}

/**
 * Converts one exhaustive Babel statement.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, language, filename, source, canonicalZeroRequired, context) {
  if (node.type == "ReturnStatement") return convertReturn(node, language, filename, source, context)
  if (node.type == "IfStatement") return convertIf(node, language, filename, source, canonicalZeroRequired, context)
  if (node.type == "ForOfStatement") return convertForEach(node, language, filename, source, canonicalZeroRequired, context)
  if (node.type == "BreakStatement" || node.type == "ContinueStatement") {
    if (node.label) return unsupportedSyntax(language, `labeled ${node.type == "BreakStatement" ? "break" : "continue"}`,
      nodeLocation(node.label, filename, source))
    const keyword = node.type == "BreakStatement" ? "break" : "continue"
    const location = tokenLocation(node, keyword, node.start ?? 0, node.end ?? source.length, filename, source)

    return withParserRanges({kind: node.type, location}, {keyword: location})
  }
  if (node.type == "VariableDeclaration" || node.type == "ExpressionStatement" && node.expression.type == "AssignmentExpression") {
    return convertLocalStatement(node, language, filename, source, context)
  }
  if (node.type == "ExpressionStatement") {
    if (node.expression.type == "CallExpression" && node.expression.callee.type == "Identifier") {
      return {
        expression: /** @type {import("../semantic/types.js").CallExpression} */ (
          convertExpression(node.expression, language, filename, source, context)
        ),
        kind: "ExpressionStatement",
        location: nodeLocation(node, filename, source)
      }
    }

    return convertPrint(node, language, filename, source, canonicalZeroRequired, context)
  }

  return unsupportedSyntax(language, node.type, nodeLocation(node, filename, source))
}

/**
 * Converts the exact block-bodied `for (const value of list)` profile.
 * @param {import("@babel/types").ForOfStatement} node - Babel for-of statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether scalar output canonicalizes zero.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").ForEachStatement} Semantic loop.
 */
function convertForEach(node, language, filename, source, canonicalZeroRequired, context) {
  const location = nodeLocation(node, filename, source)

  if (node.await) return unsupportedSyntax(language, "async for-of", location)
  if (node.left.type != "VariableDeclaration") return unsupportedSyntax(language, "for-of assignment binding", nodeLocation(node.left, filename, source))
  if (node.left.kind != "const") {
    return unsupportedSyntax(language, `${node.left.kind} iteration binding`, tokenLocation(
      node.left,
      node.left.kind,
      node.left.start ?? node.start ?? 0,
      node.left.end ?? node.end ?? source.length,
      filename,
      source
    ))
  }
  if (node.left.declarations.length != 1) return unsupportedSyntax(language, "multiple iteration bindings", nodeLocation(node.left, filename, source))
  const declarator = node.left.declarations[0]

  if (declarator.id.type != "Identifier") return unsupportedSyntax(language, declarator.id.type, nodeLocation(declarator.id, filename, source))
  if (declarator.init) return unsupportedSyntax(language, "initialized iteration binding", nodeLocation(declarator, filename, source))
  if (node.body.type != "BlockStatement") return unsupportedSyntax(language, "for-of without block body", nodeLocation(node.body, filename, source))
  const collectionType = iterationOperandType(knownExpressionType(node.right, context))

  if (!collectionType || collectionType.kind != "ListType" && collectionType.kind != "MapType") {
    return missingType(language, "Iteration collection", nodeLocation(node.right, filename, source))
  }
  const bindingLocation = identifierLocation(declarator.id, filename, source)
  const inferredType = collectionType.kind == "ListType" ? collectionType.elementType : collectionType.valueType
  const bindingType = language == "typescript" && declarator.id.typeAnnotation
    ? convertTypeScriptType(declarator.id.typeAnnotation, `Iteration binding '${declarator.id.name}'`, bindingLocation, filename, source, context.recordNames)
    : iterationBindingType(inferredType, bindingLocation)
  const valueBinding = withParserRanges({
    kind: /** @type {const} */ ("ValueBinding"),
    location: bindingLocation,
    mutable: /** @type {const} */ (false),
    name: declarator.id.name,
    type: bindingType
  }, {name: bindingLocation})
  const bodyContext = {...context, bindings: new Map(context.bindings)}

  bodyContext.bindings.set(declarator.id.name, bindingType)
  return withParserRanges({
    body: convertBlock(node.body, language, filename, source, canonicalZeroRequired, bodyContext),
    kind: /** @type {const} */ ("ForEachStatement"),
    list: convertExpression(node.right, language, filename, source, context),
    location,
    valueBinding
  }, {
    operator: tokenLocation(node, "of", node.left.end ?? node.start ?? 0, node.right.start ?? node.end ?? source.length, filename, source)
  })
}

/**
 * Converts one Babel block or normalized single-statement body.
 * @param {import("@babel/types").BlockStatement | import("@babel/types").Statement[]} input - Parser block or statements.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @param {import("../semantic/types.js").SourceLocation} [location] - Location for a statement-array block.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(input, language, filename, source, canonicalZeroRequired, context, location) {
  const statements = Array.isArray(input) ? input : input.body
  const directives = Array.isArray(input) ? [] : input.directives
  const blockLocation = location ?? nodeLocation(/** @type {import("@babel/types").BlockStatement} */ (input), filename, source)

  if (directives.length > 0) {
    return unsupportedSyntax(language, "directive", nodeLocation(directives[0], filename, source))
  }

  return {
    kind: "Block",
    location: blockLocation,
    statements: statements.map((statement) => convertStatement(statement, language, filename, source, canonicalZeroRequired, context))
  }
}

/**
 * Reads JavaScript JSDoc types from a function.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{parameters: Map<string, {location: import("../semantic/types.js").SourceLocation, sourceType: string}>, returnType: {location: import("../semantic/types.js").SourceLocation, sourceType: string} | undefined}} Parsed types.
 */
function jsdocTypes(node, filename, source) {
  const comment = node.leadingComments?.find((candidate) => candidate.type == "CommentBlock" && candidate.value.startsWith("*"))

  if (!comment) missingType("javascript", `Function '${node.id?.name ?? "anonymous"}'`, nodeLocation(node, filename, source))

  const commentBlock = /** @type {import("@babel/types").CommentBlock} */ (comment)
  const block = parseComment(`/*${commentBlock.value}*/`)[0]
  const parameterTags = block.tags.filter((tag) => tag.tag == "param")
  const returnTags = block.tags.filter((tag) => tag.tag == "returns" || tag.tag == "return")

  if (new Set(parameterTags.map((tag) => tag.name)).size != parameterTags.length) {
    const duplicate = parameterTags.find((tag, index) => parameterTags.findIndex((candidate) => candidate.name == tag.name) != index)

    return unsupportedSyntax("javascript", "duplicate @param annotation", duplicate
      ? commentTagLocation(commentBlock, duplicate, "name", filename, source)
      : nodeLocation(node, filename, source))
  }
  if (returnTags.length > 1) {
    return unsupportedSyntax("javascript", "duplicate @return annotation",
      commentTagLocation(commentBlock, returnTags[1], "type", filename, source))
  }
  const parameters = new Map(parameterTags.map((tag) => [tag.name, {
    location: commentTagLocation(commentBlock, tag, "type", filename, source),
    sourceType: tag.type
  }]))
  const returnTag = returnTags[0]

  return {
    parameters,
    returnType: returnTag ? {location: commentTagLocation(commentBlock, returnTag, "type", filename, source), sourceType: returnTag.type} : undefined
  }
}

/**
 * Requires a supported JavaScript JSDoc scalar type spelling.
 * @param {string | undefined} sourceType - Source-language type.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} source - Complete parser input.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact type token location.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, language, subject, location, source, typeLocation = location, recordNames = new Map()) {
  if (language != "javascript") return requireSourceScalarType(language, sourceType, subject, location, typeLocation)

  return documentedValueType({language, location: typeLocation, ownerLocation: location, records: recordNames, source, sourceType, subject})
}

/**
 * Converts one exact JavaScript function return annotation.
 * @param {string | undefined} sourceType - JSDoc type spelling.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed function return.
 * @param {import("../semantic/types.js").SourceLocation} location - Function location.
 * @param {string} source - Complete parser input.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact annotation location.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertReturnType(sourceType, language, subject, location, source, typeLocation = location, recordNames = new Map()) {
  if (sourceType == "void") return requireSourceReturnType(language, sourceType, subject, location, typeLocation)

  return convertType(sourceType, language, subject, location, source, typeLocation, recordNames)
}

/**
 * Converts one exact TypeScript scalar keyword annotation.
 * @param {import("@babel/types").TypeAnnotation | import("@babel/types").TSTypeAnnotation | import("@babel/types").Noop | null | undefined} annotation - Type annotation.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertTypeScriptType(annotation, subject, ownerLocation, filename, source, recordNames = new Map()) {
  if (!annotation) return missingType("typescript", subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported scalar type", nodeLocation(annotation, filename, source))
  }

  return convertTypeScriptValueTypeNode(annotation.typeAnnotation, subject, ownerLocation, filename, source, recordNames)
}

/**
 * Converts one bounded recursive TypeScript value-type tree.
 * @param {import("@babel/types").TSType} typeNode - Parser-owned type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic value type.
 */
function convertTypeScriptValueTypeNode(typeNode, subject, ownerLocation, filename, source, recordNames = new Map()) {
  const sourceType = typeNode.type == "TSNumberKeyword" ? "number" :
    typeNode.type == "TSBooleanKeyword" ? "boolean" : typeNode.type == "TSStringKeyword" ? "string" : undefined

  if (sourceType) {
    return requireSourceScalarType("typescript", sourceType, subject, ownerLocation, nodeLocation(typeNode, filename, source))
  }
  if (typeNode.type == "TSTypeReference" && typeNode.typeName.type == "Identifier" && !typeNode.typeParameters &&
    recordNames.has(typeNode.typeName.name)) {
    const declaration = /** @type {import("../semantic/types.js").RecordDeclaration} */ (recordNames.get(typeNode.typeName.name))

    return recordType(/** @type {string} */ (declaration.id), nodeLocation(typeNode, filename, source))
  }
  if (typeNode.type == "TSUnionType") {
    if (typeNode.types.length != 2 || typeNode.types[1].type != "TSNullKeyword") {
      return unsupportedSyntax(
        "typescript",
        typeNode.types.some((member) => member.type == "TSNullKeyword")
          ? "arbitrary union type"
          : "unsupported collection or scalar type",
        nodeLocation(typeNode, filename, source)
      )
    }
    const valueNode = typeNode.types[0]

    return optionalType(
      convertTypeScriptValueTypeNode(valueNode, subject, ownerLocation, filename, source, recordNames),
      nodeLocation(typeNode, filename, source),
      nodeLocation(valueNode, filename, source)
    )
  }
  if (typeNode.type == "TSTypeOperator" && typeNode.operator == "readonly" && typeNode.typeAnnotation.type == "TSArrayType") {
    const elementNode = typeNode.typeAnnotation.elementType

    return listType(
      convertTypeScriptValueTypeNode(elementNode, subject, ownerLocation, filename, source, recordNames),
      nodeLocation(typeNode, filename, source),
      nodeLocation(elementNode, filename, source)
    )
  }
  if (typeNode.type == "TSTypeReference" && typeNode.typeName.type == "Identifier" &&
    ["ReadonlyArray", "ReadonlyMap"].includes(typeNode.typeName.name)) {
    const parameters = typeNode.typeParameters?.params ?? []

    if (typeNode.typeName.name == "ReadonlyArray" && parameters.length == 1) {
      return listType(
        convertTypeScriptValueTypeNode(parameters[0], subject, ownerLocation, filename, source, recordNames),
        nodeLocation(typeNode, filename, source),
        nodeLocation(parameters[0], filename, source)
      )
    }
    if (typeNode.typeName.name == "ReadonlyMap" && parameters.length == 2) {
      const keyType = convertTypeScriptValueTypeNode(parameters[0], subject, ownerLocation, filename, source, recordNames)

      if (keyType.kind != "TypeReference") {
        return unsupportedSyntax("typescript", "map key type other than string", nodeLocation(parameters[0], filename, source))
      }
      return mapType(
        keyType,
        convertTypeScriptValueTypeNode(parameters[1], subject, ownerLocation, filename, source, recordNames),
        nodeLocation(typeNode, filename, source),
        nodeLocation(parameters[0], filename, source),
        nodeLocation(parameters[1], filename, source)
      )
    }
  }

  return unsupportedSyntax("typescript", "unsupported collection or scalar type", nodeLocation(typeNode, filename, source))
}

/**
 * Converts one exact TypeScript function return annotation.
 * @param {import("@babel/types").TypeAnnotation | import("@babel/types").TSTypeAnnotation | import("@babel/types").Noop | null | undefined} annotation - Return annotation.
 * @param {string} subject - Typed function return.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Function location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertTypeScriptReturnType(annotation, subject, ownerLocation, filename, source, recordNames = new Map()) {
  if (!annotation) return requireSourceReturnType("typescript", undefined, subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported return type", nodeLocation(annotation, filename, source))
  }
  const typeNode = annotation.typeAnnotation

  if (typeNode.type == "TSVoidKeyword") {
    return requireSourceReturnType("typescript", "void", subject, ownerLocation, nodeLocation(typeNode, filename, source))
  }

  return convertTypeScriptValueTypeNode(typeNode, subject, ownerLocation, filename, source, recordNames)
}

/**
 * Converts a supported function signature before any body expressions.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @returns {JavaScriptFunctionSignature} Semantic function signature.
 */
function convertFunctionSignature(node, language, filename, source, recordNames) {
  const location = nodeLocation(node, filename, source)

  if (!node.id) return unsupportedSyntax(language, "anonymous function", location)
  if (node.async) return unsupportedSyntax(language, "async function", location)
  if (node.generator) return unsupportedSyntax(language, "generator function", location)
  if (node.typeParameters) return unsupportedSyntax(language, "generic function", nodeLocation(node.typeParameters, filename, source))

  const documentedTypes = language == "javascript" ? jsdocTypes(node, filename, source) : undefined
  const parameters = node.params.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)

    if (parameter.type != "Identifier") return unsupportedSyntax(language, parameter.type, parameterLocation)
    if (parameter.optional) return unsupportedSyntax(language, "optional parameter", parameterLocation)

    const documentedType = documentedTypes?.parameters.get(parameter.name)
    const type = language == "javascript"
      ? convertType(documentedType?.sourceType, language, `Parameter '${parameter.name}'`, parameterLocation, source, documentedType?.location, recordNames)
      : convertTypeScriptType(parameter.typeAnnotation, `Parameter '${parameter.name}'`, parameterLocation, filename, source, recordNames)

    return withParserRanges({
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameter.name,
      type
    }, {name: identifierLocation(parameter, filename, source)})
  })
  const extraDocumentedParameter = documentedTypes && [...documentedTypes.parameters.keys()]
    .find((name) => !node.params.some((parameter) => parameter.type == "Identifier" && parameter.name == name))

  if (extraDocumentedParameter) return unsupportedSyntax(language, `annotation for unknown parameter '${extraDocumentedParameter}'`, location)
  const returnAnnotation = node.returnType
  const returnType = language == "javascript"
    ? convertReturnType(documentedTypes?.returnType?.sourceType, language, `Function '${node.id.name}' return`, location, source, documentedTypes?.returnType?.location, recordNames)
    : convertTypeScriptReturnType(returnAnnotation, `Function '${node.id.name}' return`, location, filename, source, recordNames)
  return {
    location,
    name: node.id.name,
    nameLocation: identifierLocation(node.id, filename, source),
    parameters,
    returnType
  }
}

/**
 * Converts a supported function body using all already-proved signatures.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function.
 * @param {JavaScriptFunctionSignature} signature - Converted signature.
 * @param {Map<string, JavaScriptFunctionSignature>} functions - Module signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, recordNames, records, language, filename, source, canonicalZeroRequired) {
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    functions,
    recordNames,
    records,
    returnType: signature.returnType
  }
  const body = convertBlock(node.body, language, filename, source, canonicalZeroRequired, context)

  return withParserRanges({
    body,
    kind: "FunctionDeclaration",
    location: signature.location,
    name: signature.name,
    parameters: signature.parameters,
    returnType: signature.returnType
  }, {name: signature.nameLocation})
}

/**
 * Converts one exact TypeScript readonly constructor-parameter record profile.
 * @param {import("@babel/types").ClassDeclaration} node - Class declaration.
 * @param {import("../semantic/types.js").RecordDeclaration} declaration - Predeclared nominal identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - All record declarations by name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").RecordDeclaration} Semantic record declaration.
 */
function convertTypeScriptRecord(node, declaration, recordNames, filename, source) {
  const location = nodeLocation(node, filename, source)
  const implements_ = Reflect.get(node, "implements")
  const mixins = Reflect.get(node, "mixins")

  if (!node.id) return unsupportedSyntax("typescript", "anonymous record class", location)
  if (node.superClass || (Array.isArray(implements_) && implements_.length) || node.decorators?.length || node.typeParameters || node.superTypeParameters ||
    Reflect.get(node, "abstract") || Reflect.get(node, "declare") || (Array.isArray(mixins) && mixins.length)) {
    return unsupportedSyntax("typescript", "record inheritance, decoration, or modifier", location)
  }
  if (node.body.body.length != 1 || node.body.body[0].type != "ClassMethod") {
    const extra = node.body.body[1] ?? node.body.body[0] ?? node.body

    return unsupportedSyntax("typescript", "record class body outside one constructor", nodeLocation(extra, filename, source))
  }
  const constructor = node.body.body[0]

  if (constructor.kind != "constructor" || constructor.computed || constructor.static || constructor.async || constructor.generator ||
    constructor.key.type != "Identifier" || constructor.key.name != "constructor" || constructor.decorators?.length ||
    constructor.returnType || constructor.typeParameters || Reflect.get(constructor, "accessibility") ||
    constructor.body.body.length != 0 || constructor.body.directives.length != 0) {
    return unsupportedSyntax("typescript", "noncanonical record constructor", nodeLocation(constructor, filename, source))
  }
  declaration.fields = constructor.params.map((parameter) => {
    const fieldLocation = nodeLocation(parameter, filename, source)

    if (parameter.type != "TSParameterProperty" || parameter.readonly !== true || parameter.accessibility || parameter.override ||
      parameter.parameter.type != "Identifier" || parameter.parameter.optional || parameter.parameter.decorators?.length) {
      return unsupportedSyntax("typescript", "record field outside readonly parameter-property profile", fieldLocation)
    }
    const identifier = parameter.parameter
    const field = {
      kind: /** @type {const} */ ("RecordField"),
      location: fieldLocation,
      name: identifier.name,
      type: convertTypeScriptType(identifier.typeAnnotation, `Record field '${identifier.name}'`, fieldLocation, filename, source, recordNames)
    }

    return withParserRanges(field, {name: identifierLocation(identifier, filename, source)})
  })

  return withParserRanges(declaration, {name: identifierLocation(node.id, filename, source)})
}

/**
 * Converts one exact JSDoc constructor/readonly-assignment/freeze record profile.
 * @param {import("@babel/types").ClassDeclaration} node - Class declaration.
 * @param {import("../semantic/types.js").RecordDeclaration} declaration - Predeclared nominal identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").RecordDeclaration} Semantic record declaration.
 */
function convertJavaScriptRecord(node, declaration, recordNames, filename, source) {
  const location = nodeLocation(node, filename, source)
  const implements_ = Reflect.get(node, "implements")
  const mixins = Reflect.get(node, "mixins")

  if (!node.id) return unsupportedSyntax("javascript", "anonymous record class", location)
  if (node.superClass || node.decorators?.length || node.typeParameters || node.superTypeParameters ||
    (Array.isArray(implements_) && implements_.length) || (Array.isArray(mixins) && mixins.length)) {
    return unsupportedSyntax("javascript", "record inheritance or decoration", location)
  }
  if (node.body.body.length != 1 || node.body.body[0].type != "ClassMethod") {
    return unsupportedSyntax("javascript", "record class body outside one constructor", nodeLocation(node.body.body[1] ?? node.body.body[0] ?? node.body, filename, source))
  }
  const constructor = node.body.body[0]

  if (constructor.kind != "constructor" || constructor.computed || constructor.static || constructor.async || constructor.generator ||
    constructor.key.type != "Identifier" || constructor.key.name != "constructor" || constructor.decorators?.length ||
    constructor.returnType || constructor.typeParameters || constructor.body.directives.length) {
    return unsupportedSyntax("javascript", "noncanonical record constructor", nodeLocation(constructor, filename, source))
  }
  const parameters = constructor.params

  if (parameters.some((parameter) => parameter.type != "Identifier" || parameter.optional || parameter.decorators?.length)) {
    const invalid = parameters.find((parameter) => parameter.type != "Identifier" || parameter.optional || parameter.decorators?.length)

    return unsupportedSyntax("javascript", "noncanonical record constructor parameter", nodeLocation(invalid ?? constructor, filename, source))
  }
  const documented = jsdocTypes(/** @type {import("@babel/types").FunctionDeclaration} */ (/** @type {unknown} */ (constructor)), filename, source)

  if (documented.returnType || documented.parameters.size != parameters.length || constructor.body.body.length != parameters.length + 1) {
    return unsupportedSyntax("javascript", "incomplete record constructor profile", nodeLocation(constructor, filename, source))
  }
  declaration.fields = parameters.map((parameter, index) => {
    const identifier = /** @type {import("@babel/types").Identifier} */ (parameter)
    const statement = constructor.body.body[index]
    const documentedType = documented.parameters.get(identifier.name)

    if (!documentedType || statement.type != "ExpressionStatement" || statement.expression.type != "AssignmentExpression" ||
      statement.expression.operator != "=" || statement.expression.left.type != "MemberExpression" || statement.expression.left.computed ||
      statement.expression.left.object.type != "ThisExpression" || statement.expression.left.property.type != "Identifier" ||
      statement.expression.left.property.name != identifier.name || statement.expression.right.type != "Identifier" ||
      statement.expression.right.name != identifier.name) {
      return unsupportedSyntax("javascript", "record field not initialized exactly once", nodeLocation(statement, filename, source))
    }
    const readonlyComment = statement.leadingComments?.at(-1)
    const gap = readonlyComment ? source.slice(readonlyComment.end ?? 0, statement.start ?? 0) : ""
    const tags = readonlyComment?.type == "CommentBlock" && readonlyComment.value.startsWith("*")
      ? parseComment(`/*${readonlyComment.value}*/`)[0]?.tags ?? []
      : []

    if (!readonlyComment || !/^\s*$/u.test(gap) || tags.length != 1 || tags[0].tag != "readonly" ||
      tags[0].name || tags[0].type || tags[0].description) {
      return unsupportedSyntax("javascript", "record field without exact @readonly annotation", nodeLocation(statement, filename, source))
    }
    const field = {
      kind: /** @type {const} */ ("RecordField"),
      location: nodeLocation(statement, filename, source),
      name: identifier.name,
      type: convertType(documentedType.sourceType, "javascript", `Record field '${identifier.name}'`,
        nodeLocation(identifier, filename, source), source, documentedType.location, recordNames)
    }

    return withParserRanges(field, {name: identifierLocation(statement.expression.left.property, filename, source)})
  })
  const freeze = constructor.body.body.at(-1)

  if (!freeze || freeze.type != "ExpressionStatement" || freeze.expression.type != "CallExpression" || freeze.expression.optional ||
    freeze.expression.arguments.length != 1 || freeze.expression.arguments[0].type != "ThisExpression" ||
    freeze.expression.callee.type != "MemberExpression" || freeze.expression.callee.computed || freeze.expression.callee.optional ||
    freeze.expression.callee.object.type != "Identifier" || freeze.expression.callee.object.name != "Object" ||
    freeze.expression.callee.property.type != "Identifier" || freeze.expression.callee.property.name != "freeze") {
    return unsupportedSyntax("javascript", "record constructor without final Object.freeze(this)", nodeLocation(freeze ?? constructor, filename, source))
  }

  return withParserRanges(declaration, {name: identifierLocation(node.id, filename, source)})
}

/**
 * Converts the existing exact if/else terminal shape.
 * @param {import("@babel/types").IfStatement} node - Babel if statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, language, filename, source, canonicalZeroRequired, context) {
  const location = nodeLocation(node, filename, source)
  const condition = convertExpression(node.test, language, filename, source, context)
  const consequentContext = {...context, bindings: new Map(context.bindings)}
  const alternateContext = {...context, bindings: new Map(context.bindings)}
  const consequent = node.consequent.type == "BlockStatement"
    ? convertBlock(node.consequent, language, filename, source, canonicalZeroRequired, consequentContext)
    : convertBlock([node.consequent], language, filename, source, canonicalZeroRequired, consequentContext, nodeLocation(node.consequent, filename, source))
  const alternate = node.alternate
    ? node.alternate.type == "BlockStatement"
      ? convertBlock(node.alternate, language, filename, source, canonicalZeroRequired, alternateContext)
      : convertBlock([node.alternate], language, filename, source, canonicalZeroRequired, alternateContext, nodeLocation(node.alternate, filename, source))
    : undefined

  return {
    ...(alternate ? {alternate} : {}),
    condition,
    consequent,
    kind: "IfStatement",
    location
  }
}

/**
 * Reports whether Babel parsed an operation that makes generated JavaScript-family scalar output require zero canonicalization.
 * @param {unknown} value - Babel parser subtree.
 * @param {WeakSet<object>} [visited] - Cycle protection.
 * @returns {boolean} Whether the subtree contains integer negation or multiplication syntax.
 */
function parserTreeRequiresCanonicalZero(value, visited = new WeakSet()) {
  if (!value || typeof value != "object") return false
  if (visited.has(value)) return false

  visited.add(value)
  if (Reflect.get(value, "type") == "UnaryExpression" && Reflect.get(value, "operator") == "-") return true
  if (Reflect.get(value, "type") == "BinaryExpression" && Reflect.get(value, "operator") == "*") return true

  return Object.entries(value).some(([key, child]) =>
    !["extra", "innerComments", "leadingComments", "loc", "trailingComments"].includes(key) &&
    (Array.isArray(child)
      ? child.some((item) => parserTreeRequiresCanonicalZero(item, visited))
      : parserTreeRequiresCanonicalZero(child, visited)))
}

/**
 * Recognizes the parser-owned receiver parentheses emitted only for canonical integer output.
 * @param {import("@babel/types").Expression | import("@babel/types").Super} receiver - Qualified-call receiver.
 * @param {import("@babel/types").CallExpression} call - Outer `toString` call.
 * @returns {boolean} Whether the receiver has the generated wrapper shape.
 */
function hasCanonicalZeroReceiverWrapper(receiver, call) {
  const extra = Reflect.get(receiver, "extra")
  const expressionParentheses = ["BinaryExpression", "LogicalExpression", "UnaryExpression"].includes(receiver.type) ? 1 : 0
  const wrapperParentheses = expressionParentheses + 1
  const property = call.callee.type == "MemberExpression" ? call.callee.property : undefined

  return Boolean(extra) && typeof extra == "object" && Reflect.get(extra, "parenthesized") === true &&
    Reflect.get(extra, "parenStart") === call.start && typeof call.start == "number" && typeof call.end == "number" &&
    typeof receiver.start == "number" && typeof receiver.end == "number" && property?.type == "Identifier" &&
    typeof property.start == "number" && typeof property.end == "number" && call.callee.start === call.start &&
    receiver.start == call.start + wrapperParentheses && property.start == receiver.end + wrapperParentheses + 1 &&
    property.end == property.start + "toString".length && call.end == property.end + 2
}

/**
 * Converts a console.log entry-point call.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether this parsed module contains a sign-producing integer operation.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, language, filename, source, canonicalZeroRequired, context) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "ExpressionStatement" || node.expression.type != "CallExpression") {
    return unsupportedSyntax(language, node.type, location)
  }

  const call = node.expression
  const callee = call.callee

  if (callee.type != "MemberExpression" || callee.computed || callee.object.type != "Identifier" ||
    callee.object.name != "console" || callee.property.type != "Identifier" || callee.property.name != "log" ||
    call.arguments.length != 1) {
    return unsupportedSyntax(language, "entry-point expression", location)
  }

  let argument = call.arguments[0]

  if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
    return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
  }

  if (argument.type == "CallExpression" && argument.callee.type == "MemberExpression" && !argument.callee.computed &&
    !argument.callee.optional && argument.callee.object.type != "Super" && argument.callee.property.type == "Identifier" &&
    argument.callee.property.name == "toString" && !argument.optional && !argument.typeArguments &&
    !argument.typeParameters && argument.arguments.length == 0) {
    if (!canonicalZeroRequired || !hasCanonicalZeroReceiverWrapper(argument.callee.object, argument)) {
      return unsupportedSyntax(language, "entry-point qualified call", nodeLocation(argument.callee.property, filename, source))
    }
    argument = argument.callee.object
  }

  return {expression: convertExpression(argument, language, filename, source, context), kind: "PrintStatement", location}
}

/**
 * Parses JavaScript or TypeScript into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {"javascript" | "typescript"} input.language - Frontend language.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseJavaScriptTypeScript({filename, language, source}) {
  const file = parseBabelSource({filename, language, source})
  const tokens = file.tokens ?? []
  const tokenIndex = {byStart: new Map(tokens.map((token) => [token.start, token])), tokens}
  const canonicalZeroRequired = parserTreeRequiresCanonicalZero(file.program)

  rememberTokens(file, tokenIndex)
  const nullCheckOptOut = language == "typescript"
    ? file.comments?.find((comment) => comment.value.trim() == "@ts-nocheck")
    : undefined

  if (nullCheckOptOut) {
    return unsupportedSyntax(language, "disabled TypeScript checking directive", locationFromOffsets(
      filename,
      source,
      nullCheckOptOut.start ?? 0,
      nullCheckOptOut.end ?? source.length
    ))
  }
  if (file.program.directives.length > 0) {
    return unsupportedSyntax(language, "top-level directive", nodeLocation(file.program.directives[0], filename, source))
  }
  const recordNodes = file.program.body.filter((node) => node.type == "ClassDeclaration")
  const recordDeclarations = recordNodes.map((node, index) => ({
    fields: [],
    id: `record:${index}`,
    kind: /** @type {const} */ ("RecordDeclaration"),
    location: nodeLocation(node, filename, source),
    name: node.id?.name ?? ""
  }))
  const recordNames = new Map(recordDeclarations.map((declaration) => [declaration.name, declaration]))
  const recordsById = new Map(recordDeclarations.map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const records = recordNodes.map((node, index) => language == "typescript"
    ? convertTypeScriptRecord(node, recordDeclarations[index], recordNames, filename, source)
    : convertJavaScriptRecord(node, recordDeclarations[index], recordNames, filename, source))
  const functionNodes = file.program.body.filter((node) => node.type == "FunctionDeclaration")
  const signatures = functionNodes.map((node) => convertFunctionSignature(node, language, filename, source, recordNames))
  const functionSignatures = new Map(signatures.map((signature) => [signature.name, signature]))
  const functions = functionNodes.map((node, index) =>
    convertFunction(node, signatures[index], functionSignatures, recordNames, recordsById, language, filename, source, canonicalZeroRequired))
  const entryNodes = file.program.body.filter((node) => node.type != "FunctionDeclaration" && node.type != "ClassDeclaration")
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax(language, "module without a function", location)
  const entryLocation = entryNodes.length == 0 ? location : locationFromOffsets(
    filename,
    source,
    entryNodes[0].start ?? 0,
    entryNodes.at(-1)?.end ?? source.length
  )
  const entryBlock = convertBlock(
    entryNodes,
    language,
    filename,
    source,
    canonicalZeroRequired,
    {bindings: new Map(), functions: functionSignatures, recordNames, records: recordsById},
    entryLocation
  )

  return {
    entryPoint: {
      body: entryBlock,
      kind: "EntryPoint",
      location: entryLocation
    },
    functions,
    kind: "Module",
    location,
    ...(records.length > 0 ? {records} : {})
  }
}

/**
 * Invokes Babel and normalizes syntax failures.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {"javascript" | "typescript"} input.language - Frontend language.
 * @param {string} input.source - Source text.
 * @returns {import("@babel/parser").ParseResult<import("@babel/types").File>} Babel file.
 */
function parseBabelSource({filename, language, source}) {
  try {
    return parseBabel(source, {
      allowAwaitOutsideFunction: true,
      plugins: language == "typescript" ? ["decorators-legacy", "typescript"] : ["decorators-legacy"],
      sourceFilename: filename,
      sourceType: "script",
      tokens: true
    })
  } catch (error) {
    return parseFailure(language, error, babelParserFailureLocation(error, filename, source))
  }
}

/**
 * Normalizes Babel's zero-based UTF-16 failure offset when available.
 * @param {unknown} error - Native Babel parser error.
 * @param {string} filename - Requested source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Failure range.
 */
function babelParserFailureLocation(error, filename, source) {
  if (!error || typeof error != "object") return moduleLocation(filename, source)
  const direct = Reflect.get(error, "pos")
  const parserLocation = Reflect.get(error, "loc")
  const located = parserLocation && typeof parserLocation == "object" ? Reflect.get(parserLocation, "index") : undefined
  const offset = Number.isSafeInteger(direct) ? direct : located

  if (typeof offset != "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length) {
    return moduleLocation(filename, source)
  }

  return locationFromOffsets(filename, source, offset, Math.min(offset + 1, source.length))
}

/**
 * Associates Babel nodes with their parser token stream without leaking it into semantic values.
 * @param {object} value - Current parser value.
 * @param {BabelTokenIndex} tokens - Indexed parser tokens.
 * @param {WeakSet<object>} [visited] - Cycle protection.
 * @returns {void}
 */
function rememberTokens(value, tokens, visited = new WeakSet()) {
  if (visited.has(value)) return

  visited.add(value)
  nodeTokens.set(value, tokens)

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item == "object") rememberTokens(item, tokens, visited)
    } else if (child && typeof child == "object") rememberTokens(child, tokens, visited)
  }
}
