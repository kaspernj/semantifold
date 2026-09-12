// @ts-check

import {parse as parseBabel} from "@babel/parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {isTask034ResourceProbe} from "../semantic/capabilities.js"
import {hasExactEffectSupport} from "../backends/effects.js"
import {requireSourceReturnType, requireSourceScalarType} from "./scalars.js"
import {documentedValueType, instantiatedRecordFieldType, iterationBindingType, iterationOperandType, knownCallReturnType, listType, mapType, optionalType, orderedMapTypeFromMap, ownedReferenceType, ownedResourceType, preservesGenericOptionalEvidence, recordType, referenceType, typeVariable} from "./types.js"

/** @typedef {NonNullable<import("@babel/parser").ParseResult<import("@babel/types").File>["tokens"]>[number]} BabelToken */
/** @typedef {{byStart: Map<number, BabelToken>, tokens: BabelToken[]}} BabelTokenIndex */
/** @typedef {{name: string, nameLocation: import("../semantic/types.js").SourceLocation, parameters: import("../semantic/types.js").Parameter[], returnType: import("../semantic/types.js").SemanticFunctionReturnType, typeParameters?: import("../semantic/types.js").TypeParameter[], location: import("../semantic/types.js").SourceLocation}} JavaScriptFunctionSignature */
/** @typedef {{bindings: Map<string, import("../semantic/types.js").SemanticBindingType>, classes: Map<string, import("../semantic/types.js").ClassDeclaration>, currentClass?: import("../semantic/types.js").ClassDeclaration, errors: Map<string, import("../semantic/types.js").ErrorDeclaration>, errorNames: Map<string, import("../semantic/types.js").ErrorDeclaration>, functions: Map<string, JavaScriptFunctionSignature>, lexicalValueNames?: Set<string>, orderedMapDeclarations?: Set<object>, recordNames: Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, returnType?: import("../semantic/types.js").SemanticFunctionReturnType, typeParameters?: Map<string, import("../semantic/types.js").TypeParameter>, valueRecordNames: Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration>}} JavaScriptConversionContext */

/** @type {WeakMap<object, BabelTokenIndex>} */
const nodeTokens = new WeakMap()
const referenceMethodHooks = new Set([
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "__proto__", "constructor",
  "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf"
])
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
 * Reports whether `Map` resolves to the native intrinsic in the current lexical scope.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {boolean} Whether native Map construction is unshadowed.
 */
function nativeMapAvailable(context) {
  return !context.bindings.has("Map") && !context.lexicalValueNames?.has("Map") &&
    !context.functions.has("Map") && !context.valueRecordNames.has("Map") && !context.errorNames.has("Map")
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
function convertExpression(node, language, filename, source, context = {bindings: new Map(), classes: new Map(), errors: new Map(), errorNames: new Map(), functions: new Map(), recordNames: new Map(), records: new Map(), valueRecordNames: new Map()}, expectedType, preserveOptional = false) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "Identifier" && node.name == "undefined") {
    return unsupportedSyntax(language, "undefined absence value", location)
  }

  if (expectedType?.kind == "OptionalType") {
    if (node.type == "NullLiteral") {
      return withParserRanges({kind: /** @type {const} */ ("OptionalNone"), location}, {absence: location})
    }
    if (knownExpressionType(node, context, language, filename, source)?.kind == "OptionalType") {
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

  if (node.type == "ThisExpression") {
    if (!context.currentClass) return unsupportedSyntax(language, "receiver outside a reference class", location)

    return withParserRanges({classId: /** @type {string} */ (context.currentClass.id), kind: /** @type {const} */ ("ReceiverExpression"), location},
      {receiver: location})
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
    if (!nativeMapAvailable(context)) {
      return unsupportedSyntax(language, "shadowed Map constructor", identifierLocation(node.callee, filename, source))
    }
    if (expectedType?.kind == "RecordType") return unsupportedSyntax(language, "Map used as a structural record substitute", location)
    if (node.typeArguments || node.typeParameters || node.arguments.length > 1) {
      return unsupportedSyntax(language, "generic or invalid Map construction", location)
    }
    const initializer = node.arguments[0]

    if (!initializer) return withParserRanges({
      entries: [],
      kind: expectedType?.kind == "OrderedMapType"
        ? /** @type {const} */ ("OrderedMapLiteral")
        : /** @type {const} */ ("MapLiteral"),
      location
    }, {literal: location})
    if (initializer.type == "SpreadElement" || initializer.type == "ArgumentPlaceholder") {
      return unsupportedSyntax(language, initializer.type, nodeLocation(initializer, filename, source))
    }
    if (initializer.type != "ArrayExpression") {
      return unsupportedSyntax(language, "Map initializer other than an entry array", nodeLocation(initializer, filename, source))
    }
    const valueType = expectedType?.kind == "MapType" || expectedType?.kind == "OrderedMapType"
      ? expectedType.valueType : undefined
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

    return withParserRanges({
      entries,
      kind: expectedType?.kind == "OrderedMapType"
        ? /** @type {const} */ ("OrderedMapLiteral")
        : /** @type {const} */ ("MapLiteral"),
      location
    }, {literal: location})
  }

  if (node.type == "NewExpression" && node.callee.type == "Identifier" && context.valueRecordNames.has(node.callee.name)) {
    const declaration = /** @type {import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration} */ (context.valueRecordNames.get(node.callee.name))
    if (declaration.kind == "ClassDeclaration") {
      if (node.typeArguments || node.typeParameters) return unsupportedSyntax(language, "generic reference construction", location)
      const arguments_ = node.arguments.map((argument, index) => {
        if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
          return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
        }

        return convertExpression(argument, language, filename, source, context, declaration.constructor.parameters[index]?.type)
      })
      const classLocation = identifierLocation(node.callee, filename, source)

      return withParserRanges({arguments: arguments_, kind: /** @type {const} */ ("ReferenceConstruction"), location,
        reference: declaration.ownership?.kind == "ownedResource"
          ? ownedReferenceType(/** @type {string} */ (declaration.id), classLocation)
          : referenceType(/** @type {string} */ (declaration.id), classLocation)}, {class: classLocation})
    }
    const sourceArguments = node.typeArguments?.params ?? node.typeParameters?.params
    const typeArguments = sourceArguments?.map((/** @type {import("@babel/types").TSType} */ argument) => convertTypeScriptValueTypeNode(
      argument,
      `Record '${declaration.name}' application`, location, filename, source, context.recordNames, context.typeParameters
    )) ?? (expectedType?.kind == "RecordType" && expectedType.declarationId == declaration.id ? expectedType.arguments : undefined)
    const arguments_ = node.arguments.map((argument, index) => {
      if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
        return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
      }

      return convertExpression(argument, language, filename, source, context,
        instantiatedRecordFieldType(declaration, typeArguments, index))
    })

    return withParserRanges({
      arguments: arguments_,
      kind: /** @type {const} */ ("RecordConstruction"),
      location,
      record: recordType(/** @type {string} */ (declaration.id), identifierLocation(node.callee, filename, source), typeArguments)
    }, {record: identifierLocation(node.callee, filename, source)})
  }

  if (node.type == "MemberExpression" && !node.optional && node.object.type != "Super") {
    if (!node.computed && node.object.type == "ThisExpression" && context.currentClass) {
      /** @type {import("@babel/types").Identifier | undefined} */
      let property

      if (language == "javascript" && node.property.type == "PrivateName") property = node.property.id
      if (language == "typescript" && node.property.type == "Identifier") property = node.property
      if (!property) return unsupportedSyntax(language, "noncanonical private instance field access", location)
      const field = context.currentClass.fields.find((candidate) => candidate.name == property.name)

      if (!field) return unsupportedSyntax(language, `unknown private field '${property.name}'`, identifierLocation(property, filename, source))
      return withParserRanges({field: /** @type {string} */ (field.id), kind: /** @type {const} */ ("PrivateFieldRead"), location,
        receiver: /** @type {import("../semantic/types.js").ReceiverExpression} */ (
          convertExpression(node.object, language, filename, source, context))}, {member: identifierLocation(property, filename, source)})
    }
    if (knownValueExpressionType(node.object, context, language, filename, source)?.kind == "ReferenceType") {
      return unsupportedSyntax(language, "private reference-class field access", location)
    }
    if (!node.computed && node.object.type == "Identifier" && node.property.type == "Identifier" &&
      node.property.name == "message" && context.bindings.get(node.object.name)?.kind == "ErrorType") {
      const receiverLocation = identifierLocation(node.object, filename, source)

      return withParserRanges({
        kind: /** @type {const} */ ("ErrorMessageRead"),
        location,
        receiver: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: receiverLocation, name: node.object.name}, {
          name: receiverLocation
        })
      }, {member: identifierLocation(node.property, filename, source)})
    }
    if (node.computed) {
      if (knownValueExpressionType(node.object, context, language, filename, source)?.kind == "RecordType") {
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
      const receiverType = knownValueExpressionType(node.object, context, language, filename, source)

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

      return convertExpression(argument, language, filename, source, context, signature?.parameters[index]?.type,
        preservesGenericOptionalEvidence(signature, index))
    })

    return withParserRanges({arguments: arguments_, callee: node.callee.name, kind: /** @type {const} */ ("CallExpression"), location}, {
      callee: identifierLocation(node.callee, filename, source)
    })
  }

  if (node.type == "CallExpression" && !node.optional && !node.typeArguments && !node.typeParameters &&
    node.callee.type == "MemberExpression" && !node.callee.computed && !node.callee.optional &&
    node.callee.object.type != "Super" && node.callee.property.type == "Identifier") {
    const receiverType = knownValueExpressionType(node.callee.object, context, language, filename, source)

    if (receiverType?.kind == "ReferenceType" || receiverType?.kind == "OwnedReferenceType") {
      const declaration = context.classes.get(receiverType.declarationId)
      const methodName = node.callee.property.name
      const method = declaration?.methods.find((candidate) => candidate.name == methodName)
      const arguments_ = node.arguments.map((argument, index) => {
        if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
          return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
        }

        return convertExpression(argument, language, filename, source, context, method?.parameters[index]?.type)
      })

      return withParserRanges({arguments: arguments_, kind: /** @type {const} */ ("MethodCallExpression"), location,
        method: method?.id ?? node.callee.property.name,
        receiver: convertExpression(node.callee.object, language, filename, source, context)},
      {member: identifierLocation(node.callee.property, filename, source)})
    }
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
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} Known result type.
 */
function knownExpressionType(node, context, language, filename, source) {
  if (node.type == "TSNonNullExpression") return knownExpressionType(node.expression, context, language, filename, source)
  if (node.type == "Identifier") return context.bindings.get(node.name)
  if (node.type == "CallExpression" && node.callee.type == "Identifier") {
    const signature = context.functions.get(node.callee.name)

    if (signature) return knownCallReturnType(signature, node.arguments.map((argument) =>
      argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder"
        ? undefined
        : knownExpressionType(argument, context, language, filename, source)))
  }
  if (node.type == "NewExpression" && node.callee.type == "Identifier") {
    const declaration = context.valueRecordNames.get(node.callee.name)

    if (declaration?.id) {
      if (declaration.kind == "ClassDeclaration") return {declarationId: declaration.id,
        kind: declaration.ownership?.kind == "ownedResource" ? "OwnedReferenceType" : "ReferenceType"}
      const sourceArguments = node.typeArguments?.params ?? node.typeParameters?.params
      const typeArguments = sourceArguments?.map((/** @type {import("@babel/types").TSType} */ argument) =>
        convertTypeScriptValueTypeNode(
          argument,
          `Record '${declaration.name}' application`,
          nodeLocation(node, filename, source),
          filename,
          source,
          context.recordNames,
          context.typeParameters
        ))

      return {declarationId: declaration.id, kind: "RecordType", ...(typeArguments ? {arguments: typeArguments} : {})}
    }
  }
  if (node.type == "ThisExpression" && context.currentClass?.id) {
    return {declarationId: context.currentClass.id, kind: "ReferenceType"}
  }
  if (node.type == "CallExpression" && node.callee.type == "MemberExpression" && !node.callee.computed &&
    node.callee.object.type != "Super" && node.callee.property.type == "Identifier") {
    const receiver = knownValueExpressionType(node.callee.object, context, language, filename, source)

    if (receiver?.kind == "ReferenceType") {
      const methodName = node.callee.property.name

      return context.classes.get(receiver.declarationId)?.methods.find((method) => method.name == methodName)?.returnType
    }
  }
  if (node.type == "MemberExpression" && !node.computed && node.object.type == "ThisExpression" && context.currentClass) {
    if (language == "javascript" && node.property.type == "PrivateName") {
      const name = node.property.id.name

      return context.currentClass.fields.find((field) => field.name == name)?.type
    }
    if (language == "typescript" && node.property.type == "Identifier") {
      const name = node.property.name

      return context.currentClass.fields.find((field) => field.name == name)?.type
    }

    return undefined
  }
  if (node.type == "MemberExpression" && !node.computed && node.object.type != "Super" && node.property.type == "Identifier") {
    const receiver = knownValueExpressionType(node.object, context, language, filename, source)

    if (receiver?.kind != "RecordType") return undefined
    const declaration = context.records.get(receiver.declarationId)
    const memberName = node.property.name
    const index = declaration?.fields.findIndex((field) => field.name == memberName) ?? -1

    return declaration ? instantiatedRecordFieldType(declaration, receiver.arguments, index) : undefined
  }
  if (node.type == "MemberExpression" && node.computed && node.object.type != "Super") {
    const collectionType = knownValueExpressionType(node.object, context, language, filename, source)

    if (collectionType?.kind == "ListType") return collectionType.elementType
  }
  if (node.type == "CallExpression" && node.callee.type == "MemberExpression" &&
    !node.callee.computed && node.callee.object.type != "Super" &&
    node.callee.property.type == "Identifier" && node.callee.property.name == "get") {
    const collectionType = knownValueExpressionType(node.callee.object, context, language, filename, source)

    if (collectionType?.kind == "MapType" || collectionType?.kind == "OrderedMapType") return collectionType.valueType
  }

  return undefined
}

/**
 * Resolves the value type produced by the frontend's implicit optional-binding unwrap.
 * Semantic validation separately proves that the unwrap occurs only on a present path.
 * @param {import("@babel/types").Expression} node - Parser-owned expression.
 * @param {JavaScriptConversionContext} context - Typed lexical context.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} Converted value type.
 */
function knownValueExpressionType(node, context, language, filename, source) {
  const type = knownExpressionType(node, context, language, filename, source)

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
 * @returns {import("../semantic/types.js").LocalStatement | import("../semantic/types.js").PrivateFieldWriteStatement} Semantic local or private-field statement.
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

    let type = language == "typescript"
      ? convertTypeScriptType(declarator.id.typeAnnotation, `Local '${declarator.id.name}'`, declaratorLocation, filename, source,
        context.recordNames, context.typeParameters)
      : localJavaScriptType(node, declarator.id.name, filename, source, context.recordNames, context.typeParameters)

    if (node.kind == "const" && type.kind == "MapType" && context.orderedMapDeclarations?.has(declarator) &&
      declarator.init.type == "NewExpression" && declarator.init.callee.type == "Identifier" &&
      declarator.init.callee.name == "Map" && nativeMapAvailable(context)) {
      type = orderedMapTypeFromMap(type, declaratorLocation)
    }

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
    if (assignment.left.type == "MemberExpression" && !assignment.left.computed &&
      assignment.left.object.type == "ThisExpression" && context.currentClass) {
      /** @type {import("@babel/types").Identifier | undefined} */
      let property

      if (language == "javascript" && assignment.left.property.type == "PrivateName") property = assignment.left.property.id
      if (language == "typescript" && assignment.left.property.type == "Identifier") property = assignment.left.property
      if (!property) return unsupportedSyntax(language, "noncanonical private instance field assignment", location)
      const field = context.currentClass.fields.find((candidate) => candidate.name == property.name)

      if (!field) return unsupportedSyntax(language, `unknown private field '${property.name}'`, identifierLocation(property, filename, source))
      return withParserRanges({
        expression: convertExpression(assignment.right, language, filename, source, context, field.type),
        field: /** @type {string} */ (field.id),
        kind: /** @type {const} */ ("PrivateFieldWriteStatement"),
        location,
        receiver: /** @type {import("../semantic/types.js").ReceiverExpression} */ (
          convertExpression(assignment.left.object, language, filename, source, context))
      }, {member: identifierLocation(property, filename, source), operator: tokenLocation(assignment, "=",
        assignment.left.end ?? assignment.start ?? 0, assignment.right.start ?? assignment.end ?? source.length, filename, source)})
    }
    if (assignment.left.type != "Identifier") return unsupportedSyntax(language, assignment.left.type, targetLocation)

    const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name: assignment.left.name}, {
      name: identifierLocation(assignment.left, filename, source)
    })

    const bindingType = context.bindings.get(assignment.left.name)
    const semantic = withParserRanges({
      expression: convertExpression(assignment.right, language, filename, source, context,
        bindingType?.kind == "ErrorType" ? undefined : bindingType),
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
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function localJavaScriptType(node, name, filename, source, recordNames, typeParameters = new Map()) {
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
    recordNames,
    typeParameters
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
  if (node.type == "ThrowStatement") return convertTypedThrow(node, language, filename, source, context)
  if (node.type == "TryStatement") return convertTypedTry(node, language, filename, source, canonicalZeroRequired, context)
  if (node.type == "WhileStatement") return convertWhile(node, language, filename, source, canonicalZeroRequired, context)
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
    if (node.expression.type == "CallExpression" && (node.expression.callee.type == "Identifier" ||
      node.expression.callee.type == "MemberExpression" && !node.expression.callee.computed &&
      node.expression.callee.object.type != "Super" &&
      ["ReferenceType", "OwnedReferenceType"].includes(String(
        knownValueExpressionType(node.expression.callee.object, context, language, filename, source)?.kind)))) {
      return {
        expression: /** @type {import("../semantic/types.js").CallExpression | import("../semantic/types.js").MethodCallExpression} */ (
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
 * Converts exact `throw new DeclaredError(message)`.
 * @param {import("@babel/types").ThrowStatement} node - Babel throw statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaScriptConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").RaiseStatement} Semantic raise.
 */
function convertTypedThrow(node, language, filename, source, context) {
  const location = nodeLocation(node, filename, source)
  const argument = node.argument

  if (!argument || argument.type != "NewExpression" || argument.callee.type != "Identifier" ||
    context.bindings.has(argument.callee.name) || !context.errorNames.has(argument.callee.name) || argument.arguments.length != 1 ||
    argument.arguments[0].type == "SpreadElement" || argument.arguments[0].type == "ArgumentPlaceholder" ||
    argument.typeArguments || argument.typeParameters) {
    return unsupportedSyntax(language, "throw other than exact declared error construction", location)
  }
  const declaration = /** @type {import("../semantic/types.js").ErrorDeclaration} */ (context.errorNames.get(argument.callee.name))
  const typeLocation = identifierLocation(argument.callee, filename, source)

  return withParserRanges({
    error: withParserRanges({
      error: withParserRanges({declarationId: /** @type {string} */ (declaration.id), kind: /** @type {const} */ ("ErrorType")}, {type: typeLocation}),
      kind: /** @type {const} */ ("ErrorConstruction"),
      location: nodeLocation(argument, filename, source),
      message: convertExpression(argument.arguments[0], language, filename, source, context)
    }, {type: typeLocation}),
    kind: /** @type {const} */ ("RaiseStatement"),
    location
  }, {keyword: tokenLocation(node, "throw", node.start ?? 0, argument.start ?? node.end ?? source.length, filename, source)})
}

/**
 * Converts one catch with the canonical `instanceof` guard and exact rethrow.
 * @param {import("@babel/types").TryStatement} node - Babel try statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether scalar output canonicalizes zero.
 * @param {JavaScriptConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").TryStatement} Semantic exact handler.
 */
function convertTypedTry(node, language, filename, source, canonicalZeroRequired, context) {
  const location = nodeLocation(node, filename, source)

  if (node.finalizer || !node.handler || node.handler.param?.type != "Identifier" || node.handler.body.directives.length > 0) {
    return unsupportedSyntax(language, "try without one explicit guarded catch", location)
  }
  const binding = node.handler.param
  const guard = node.handler.body.body[0]

  if (!guard || guard.type != "IfStatement" || guard.alternate || guard.test.type != "UnaryExpression" ||
    guard.test.operator != "!" || guard.test.argument.type != "BinaryExpression" || guard.test.argument.operator != "instanceof" ||
    guard.test.argument.left.type != "Identifier" || guard.test.argument.left.name != binding.name ||
    guard.test.argument.right.type != "Identifier" || guard.test.argument.right.name == binding.name ||
    context.bindings.has(guard.test.argument.right.name) || !context.errorNames.has(guard.test.argument.right.name) ||
    guard.consequent.type != "BlockStatement" || guard.consequent.body.length != 1 || guard.consequent.directives.length > 0 ||
    guard.consequent.body[0].type != "ThrowStatement" || guard.consequent.body[0].argument?.type != "Identifier" ||
    guard.consequent.body[0].argument.name != binding.name) {
    return unsupportedSyntax(language, "catch without exact instanceof guard and unmatched rethrow", nodeLocation(guard ?? node.handler, filename, source))
  }
  const declaration = /** @type {import("../semantic/types.js").ErrorDeclaration} */ (context.errorNames.get(guard.test.argument.right.name))
  const caughtTypeLocation = identifierLocation(guard.test.argument.right, filename, source)
  const catchType = withParserRanges({
    declarationId: /** @type {string} */ (declaration.id),
    kind: /** @type {const} */ ("ErrorType")
  }, {type: caughtTypeLocation})
  const bodyContext = {...context, bindings: new Map(context.bindings)}
  const catchContext = {...context, bindings: new Map(context.bindings)}

  catchContext.bindings.set(binding.name, catchType)
  const catchStatements = node.handler.body.body.slice(1)

  return withParserRanges({
    body: convertBlock(node.block, language, filename, source, canonicalZeroRequired, bodyContext),
    catchBinding: withParserRanges({
      kind: /** @type {const} */ ("CatchBinding"),
      location: identifierLocation(binding, filename, source),
      mutable: /** @type {const} */ (false),
      name: binding.name,
      type: catchType
    }, {name: identifierLocation(binding, filename, source)}),
    catchBody: convertBlock(catchStatements, language, filename, source, canonicalZeroRequired, catchContext,
      nodeLocation(node.handler.body, filename, source)),
    catchType,
    kind: /** @type {const} */ ("TryStatement"),
    location
  }, {
    catch: tokenLocation(node.handler, "catch", node.handler.start ?? 0, binding.start ?? node.handler.end ?? source.length, filename, source),
    guard: nodeLocation(guard, filename, source),
    try: tokenLocation(node, "try", node.start ?? 0, node.block.start ?? node.end ?? source.length, filename, source)
  })
}

/**
 * Converts the exact block-bodied `for (const value of list)` profile.
 * @param {import("@babel/types").ForOfStatement} node - Babel for-of statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether scalar output canonicalizes zero.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").ForEachStatement | import("../semantic/types.js").ForEachMapStatement} Semantic loop.
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

  if (declarator.id.type == "ArrayPattern") {
    const [key, value] = declarator.id.elements

    if (declarator.id.elements.length != 2 || !key || !value || key.type != "Identifier" || value.type != "Identifier" ||
      declarator.id.typeAnnotation || key.typeAnnotation || value.typeAnnotation || key.optional || value.optional) {
      return unsupportedSyntax(language, "map iteration binding shape", nodeLocation(declarator.id, filename, source))
    }
    if (declarator.init) return unsupportedSyntax(language, "initialized iteration binding", nodeLocation(declarator, filename, source))
    if (node.body.type != "BlockStatement") return unsupportedSyntax(language, "for-of without block body", nodeLocation(node.body, filename, source))
    const collectionType = iterationOperandType(knownExpressionType(node.right, context, language, filename, source))

    if (collectionType?.kind == "MapType") {
      return unsupportedSyntax(language, "unordered map iteration", nodeLocation(node.right, filename, source))
    }
    if (!collectionType || collectionType.kind != "OrderedMapType") {
      return missingType(language, "Ordered map iteration collection", nodeLocation(node.right, filename, source))
    }
    const keyLocation = identifierLocation(key, filename, source)
    const valueLocation = identifierLocation(value, filename, source)
    const keyType = iterationBindingType(collectionType.keyType, keyLocation)
    const valueType = iterationBindingType(collectionType.valueType, valueLocation)
    const keyBinding = withParserRanges({
      kind: /** @type {const} */ ("ValueBinding"), location: keyLocation, mutable: /** @type {const} */ (false),
      name: key.name, type: keyType
    }, {name: keyLocation})
    const valueBinding = withParserRanges({
      kind: /** @type {const} */ ("ValueBinding"), location: valueLocation, mutable: /** @type {const} */ (false),
      name: value.name, type: valueType
    }, {name: valueLocation})
    const bodyContext = {...context, bindings: new Map(context.bindings)}

    bodyContext.bindings.set(key.name, keyType)
    bodyContext.bindings.set(value.name, valueType)
    return withParserRanges({
      body: convertBlock(node.body, language, filename, source, canonicalZeroRequired, bodyContext),
      keyBinding,
      kind: /** @type {const} */ ("ForEachMapStatement"),
      location,
      map: convertExpression(node.right, language, filename, source, context),
      valueBinding
    }, {
      operator: tokenLocation(node, "of", node.left.end ?? node.start ?? 0, node.right.start ?? node.end ?? source.length,
        filename, source)
    })
  }
  if (declarator.id.type != "Identifier") return unsupportedSyntax(language, declarator.id.type, nodeLocation(declarator.id, filename, source))
  if (declarator.init) return unsupportedSyntax(language, "initialized iteration binding", nodeLocation(declarator, filename, source))
  if (node.body.type != "BlockStatement") return unsupportedSyntax(language, "for-of without block body", nodeLocation(node.body, filename, source))
  const collectionType = iterationOperandType(knownExpressionType(node.right, context, language, filename, source))

  if (collectionType?.kind == "MapType" || collectionType?.kind == "OrderedMapType") {
    return unsupportedSyntax(language, "map iteration without key/value pair binding", nodeLocation(node.right, filename, source))
  }
  if (!collectionType || collectionType.kind != "ListType") {
    return missingType(language, "Iteration collection", nodeLocation(node.right, filename, source))
  }
  const bindingLocation = identifierLocation(declarator.id, filename, source)
  const inferredType = collectionType.elementType
  const bindingType = language == "typescript" && declarator.id.typeAnnotation
    ? convertTypeScriptType(declarator.id.typeAnnotation, `Iteration binding '${declarator.id.name}'`, bindingLocation, filename, source,
      context.recordNames, context.typeParameters)
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
  const lexicalValueNames = new Set(context.lexicalValueNames)

  for (const statement of statements) {
    if (statement.type != "VariableDeclaration") continue
    for (const declarator of statement.declarations) {
      if (declarator.id.type == "Identifier") lexicalValueNames.add(declarator.id.name)
    }
  }
  const blockContext = {...context, lexicalValueNames}

  if (directives.length > 0) {
    return unsupportedSyntax(language, "directive", nodeLocation(directives[0], filename, source))
  }

  return {
    kind: "Block",
    location: blockLocation,
    statements: statements.map((statement) => convertStatement(statement, language, filename, source, canonicalZeroRequired, blockContext))
  }
}

/**
 * Reads JavaScript JSDoc types from a function.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {string} [ownerId] - Stable declaration identity for type-parameter IDs.
 * @returns {{parameters: Map<string, {location: import("../semantic/types.js").SourceLocation, sourceType: string}>, returnType: {location: import("../semantic/types.js").SourceLocation, sourceType: string} | undefined, typeParameters?: import("../semantic/types.js").TypeParameter[]}} Parsed types.
 */
function jsdocTypes(node, filename, source, ownerId) {
  const comment = node.leadingComments?.find((candidate) => candidate.type == "CommentBlock" && candidate.value.startsWith("*"))

  if (!comment) missingType("javascript", `Function '${node.id?.name ?? "anonymous"}'`, nodeLocation(node, filename, source))

  const commentBlock = /** @type {import("@babel/types").CommentBlock} */ (comment)
  const block = parseComment(`/*${commentBlock.value}*/`)[0]
  const parameterTags = block.tags.filter((tag) => tag.tag == "param")
  const returnTags = block.tags.filter((tag) => tag.tag == "returns" || tag.tag == "return")
  const typeParameters = jsdocTypeParameters(commentBlock, block.tags, ownerId, filename, source)

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
    returnType: returnTag ? {location: commentTagLocation(commentBlock, returnTag, "type", filename, source), sourceType: returnTag.type} : undefined,
    ...(typeParameters ? {typeParameters} : {})
  }
}

/**
 * Reads exact unbounded invariant `@template Name` declarations.
 * @param {import("@babel/types").CommentBlock} comment - Parser-owned JSDoc block.
 * @param {import("comment-parser").Spec[]} tags - Parsed tags.
 * @param {string | undefined} ownerId - Stable declaration identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeParameter[] | undefined} Ordered parameters when present.
 */
function jsdocTypeParameters(comment, tags, ownerId, filename, source) {
  const malformed = tags.find((tag) => tag.tag.startsWith("template") && tag.tag != "template")

  if (malformed) return unsupportedSyntax("javascript", "unsupported type parameter variance", commentTagLocation(comment, malformed, "name", filename, source))
  const templateTags = tags.filter((tag) => tag.tag == "template")

  if (templateTags.length == 0) return undefined
  if (!ownerId) return unsupportedSyntax("javascript", "type parameter outside a declaration",
    nodeLocation(/** @type {import("@babel/types").Node} */ (/** @type {unknown} */ (comment)), filename, source))

  return templateTags.map((tag, index) => {
    const location = commentTagLocation(comment, tag, "name", filename, source)

    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(tag.name) || tag.type || tag.description) {
      return unsupportedSyntax("javascript", "bounded, defaulted, or malformed type parameter", location)
    }

    return withParserRanges({id: `${ownerId}:type:${index}`, kind: /** @type {const} */ ("TypeParameter"), location, name: tag.name}, {name: location})
  })
}

/**
 * Reads an optional class-level JSDoc template block.
 * @param {import("@babel/types").ClassDeclaration} node - Class declaration.
 * @param {string} ownerId - Record identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeParameter[] | undefined} Ordered parameters.
 */
function classJsdocTypeParameters(node, ownerId, filename, source) {
  const comment = /** @type {import("@babel/types").CommentBlock | undefined} */ (
    node.leadingComments?.find((candidate) => candidate.type == "CommentBlock" && candidate.value.startsWith("*")))

  if (!comment) return undefined
  const block = parseComment(`/*${comment.value}*/`)[0]

  return jsdocTypeParameters(comment, block.tags, ownerId, filename, source)
}

/**
 * Requires a supported JavaScript JSDoc scalar type spelling.
 * @param {string | undefined} sourceType - Source-language type.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} source - Complete parser input.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact type token location.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, language, subject, location, source, typeLocation = location, recordNames = new Map(), typeParameters = new Map()) {
  if (language != "javascript") return requireSourceScalarType(language, sourceType, subject, location, typeLocation)

  return documentedValueType({language, location: typeLocation, ownerLocation: location, records: recordNames, source, sourceType, subject, typeParameters})
}

/**
 * Converts one exact JavaScript function return annotation.
 * @param {string | undefined} sourceType - JSDoc type spelling.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed function return.
 * @param {import("../semantic/types.js").SourceLocation} location - Function location.
 * @param {string} source - Complete parser input.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact annotation location.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertReturnType(sourceType, language, subject, location, source, typeLocation = location, recordNames = new Map(), typeParameters = new Map()) {
  if (sourceType == "void") return requireSourceReturnType(language, sourceType, subject, location, typeLocation)

  return convertType(sourceType, language, subject, location, source, typeLocation, recordNames, typeParameters)
}

/**
 * Converts one exact TypeScript scalar keyword annotation.
 * @param {import("@babel/types").TypeAnnotation | import("@babel/types").TSTypeAnnotation | import("@babel/types").Noop | null | undefined} annotation - Type annotation.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertTypeScriptType(annotation, subject, ownerLocation, filename, source, recordNames = new Map(), typeParameters = new Map()) {
  if (!annotation) return missingType("typescript", subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported scalar type", nodeLocation(annotation, filename, source))
  }

  return convertTypeScriptValueTypeNode(annotation.typeAnnotation, subject, ownerLocation, filename, source, recordNames, typeParameters)
}

/**
 * Converts one bounded recursive TypeScript value-type tree.
 * @param {import("@babel/types").TSType} typeNode - Parser-owned type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic value type.
 */
function convertTypeScriptValueTypeNode(typeNode, subject, ownerLocation, filename, source, recordNames = new Map(), typeParameters = new Map()) {
  const sourceType = typeNode.type == "TSNumberKeyword" ? "number" :
    typeNode.type == "TSBooleanKeyword" ? "boolean" : typeNode.type == "TSStringKeyword" ? "string" : undefined

  if (sourceType) {
    return requireSourceScalarType("typescript", sourceType, subject, ownerLocation, nodeLocation(typeNode, filename, source))
  }
  if (typeNode.type == "TSTypeReference" && typeNode.typeName.type == "Identifier" && !typeNode.typeParameters &&
    typeParameters.has(typeNode.typeName.name)) {
    const parameter = /** @type {import("../semantic/types.js").TypeParameter} */ (typeParameters.get(typeNode.typeName.name))

    return typeVariable(/** @type {string} */ (parameter.id), nodeLocation(typeNode, filename, source))
  }
  if (typeNode.type == "TSTypeReference" && typeNode.typeName.type == "Identifier" &&
    recordNames.has(typeNode.typeName.name)) {
    const declaration = /** @type {import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration} */ (recordNames.get(typeNode.typeName.name))

    if (declaration.kind == "EffectResourceDeclaration") {
      if (typeNode.typeParameters) return unsupportedSyntax("typescript", "generic owned resource type", nodeLocation(typeNode, filename, source))
      return ownedResourceType(declaration.id, nodeLocation(typeNode.typeName, filename, source))
    }
    if (declaration.kind == "ClassDeclaration") {
      if (typeNode.typeParameters) return unsupportedSyntax("typescript", "generic reference class type", nodeLocation(typeNode, filename, source))
      const location = nodeLocation(typeNode.typeName, filename, source)
      return declaration.ownership?.kind == "ownedResource"
        ? ownedReferenceType(/** @type {string} */ (declaration.id), location)
        : referenceType(/** @type {string} */ (declaration.id), location)
    }
    const arguments_ = typeNode.typeParameters?.params.map((parameter) =>
      convertTypeScriptValueTypeNode(parameter, subject, ownerLocation, filename, source, recordNames, typeParameters))

    return recordType(/** @type {string} */ (declaration.id), nodeLocation(typeNode.typeName, filename, source), arguments_)
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
      convertTypeScriptValueTypeNode(valueNode, subject, ownerLocation, filename, source, recordNames, typeParameters),
      nodeLocation(typeNode, filename, source),
      nodeLocation(valueNode, filename, source)
    )
  }
  if (typeNode.type == "TSTypeOperator" && typeNode.operator == "readonly" && typeNode.typeAnnotation.type == "TSArrayType") {
    const elementNode = typeNode.typeAnnotation.elementType

    return listType(
      convertTypeScriptValueTypeNode(elementNode, subject, ownerLocation, filename, source, recordNames, typeParameters),
      nodeLocation(typeNode, filename, source),
      nodeLocation(elementNode, filename, source)
    )
  }
  if (typeNode.type == "TSTypeReference" && typeNode.typeName.type == "Identifier" &&
    ["ReadonlyArray", "ReadonlyMap"].includes(typeNode.typeName.name)) {
    const parameters = typeNode.typeParameters?.params ?? []

    if (typeNode.typeName.name == "ReadonlyArray" && parameters.length == 1) {
      return listType(
        convertTypeScriptValueTypeNode(parameters[0], subject, ownerLocation, filename, source, recordNames, typeParameters),
        nodeLocation(typeNode, filename, source),
        nodeLocation(parameters[0], filename, source)
      )
    }
    if (typeNode.typeName.name == "ReadonlyMap" && parameters.length == 2) {
      const keyType = convertTypeScriptValueTypeNode(parameters[0], subject, ownerLocation, filename, source, recordNames, typeParameters)

      if (keyType.kind != "TypeReference") {
        return unsupportedSyntax("typescript", "map key type other than string", nodeLocation(parameters[0], filename, source))
      }
      return mapType(
        keyType,
        convertTypeScriptValueTypeNode(parameters[1], subject, ownerLocation, filename, source, recordNames, typeParameters),
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
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertTypeScriptReturnType(annotation, subject, ownerLocation, filename, source, recordNames = new Map(), typeParameters = new Map()) {
  if (!annotation) return requireSourceReturnType("typescript", undefined, subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported return type", nodeLocation(annotation, filename, source))
  }
  const typeNode = annotation.typeAnnotation

  if (typeNode.type == "TSVoidKeyword") {
    return requireSourceReturnType("typescript", "void", subject, ownerLocation, nodeLocation(typeNode, filename, source))
  }

  return convertTypeScriptValueTypeNode(typeNode, subject, ownerLocation, filename, source, recordNames, typeParameters)
}

/**
 * Converts one native unbounded invariant TypeScript parameter list.
 * @param {import("@babel/types").TSTypeParameterDeclaration | null | undefined} declaration - Parser-owned list.
 * @param {string} ownerId - Stable owning declaration identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeParameter[] | undefined} Semantic parameters.
 */
function typeScriptTypeParameters(declaration, ownerId, filename, source) {
  if (!declaration) return undefined

  return declaration.params.map((parameter, index) => {
    const location = nodeLocation(parameter, filename, source)

    if (parameter.constraint || parameter.default || Reflect.get(parameter, "in") || Reflect.get(parameter, "out") ||
      Reflect.get(parameter, "const") || typeof parameter.name != "string") {
      return unsupportedSyntax("typescript", "bounded, defaulted, variant, or const type parameter", location)
    }

    return withParserRanges({id: `${ownerId}:type:${index}`, kind: /** @type {const} */ ("TypeParameter"), location, name: parameter.name}, {name: location})
  })
}

/**
 * Converts a supported function signature before any body expressions.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by source name.
 * @param {string} ownerId - Stable function identity.
 * @returns {JavaScriptFunctionSignature} Semantic function signature.
 */
function convertFunctionSignature(node, language, filename, source, recordNames, ownerId) {
  const location = nodeLocation(node, filename, source)

  if (!node.id) return unsupportedSyntax(language, "anonymous function", location)
  if (node.async) return unsupportedSyntax(language, "async function", location)
  if (node.generator) return unsupportedSyntax(language, "generator function", location)
  const nativeTypeParameters = language == "typescript"
    ? typeScriptTypeParameters(/** @type {import("@babel/types").TSTypeParameterDeclaration | null | undefined} */ (node.typeParameters), ownerId, filename, source)
    : node.typeParameters ? unsupportedSyntax(language, "native generic function", nodeLocation(node.typeParameters, filename, source)) : undefined
  const documentedTypes = language == "javascript" ? jsdocTypes(node, filename, source, ownerId) : undefined
  const typeParameters_ = nativeTypeParameters ?? documentedTypes?.typeParameters
  const typeParameterNames = new Map((typeParameters_ ?? []).map((parameter) => [parameter.name, parameter]))
  const parameters = node.params.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)

    if (parameter.type != "Identifier") return unsupportedSyntax(language, parameter.type, parameterLocation)
    if (parameter.optional) return unsupportedSyntax(language, "optional parameter", parameterLocation)

    const documentedType = documentedTypes?.parameters.get(parameter.name)
    const type = language == "javascript"
      ? convertType(documentedType?.sourceType, language, `Parameter '${parameter.name}'`, parameterLocation, source, documentedType?.location, recordNames, typeParameterNames)
      : convertTypeScriptType(parameter.typeAnnotation, `Parameter '${parameter.name}'`, parameterLocation, filename, source, recordNames, typeParameterNames)

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
    ? convertReturnType(documentedTypes?.returnType?.sourceType, language, `Function '${node.id.name}' return`, location, source, documentedTypes?.returnType?.location, recordNames, typeParameterNames)
    : convertTypeScriptReturnType(returnAnnotation, `Function '${node.id.name}' return`, location, filename, source, recordNames, typeParameterNames)
  return {
    location,
    name: node.id.name,
    nameLocation: identifierLocation(node.id, filename, source),
    parameters,
    returnType,
    ...(typeParameters_ ? {typeParameters: typeParameters_} : {})
  }
}

/**
 * Converts a supported function body using all already-proved signatures.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function.
 * @param {JavaScriptFunctionSignature} signature - Converted signature.
 * @param {Map<string, JavaScriptFunctionSignature>} functions - Module signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration>} valueRecordNames - Nominal declarations available in value positions.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @param {Map<string, import("../semantic/types.js").ClassDeclaration>} classes - Reference classes by identity.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Error declarations by source name.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Error declarations by identity.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, recordNames, valueRecordNames, records, classes, errorNames, errors, language, filename, source, canonicalZeroRequired) {
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    classes,
    errorNames,
    errors,
    functions,
    orderedMapDeclarations: orderedMapDeclarationsFor(node.body),
    recordNames,
    records,
    returnType: signature.returnType,
    typeParameters: new Map((signature.typeParameters ?? []).map((parameter) => [parameter.name, parameter])),
    valueRecordNames
  }
  const body = convertBlock(node.body, language, filename, source, canonicalZeroRequired, context)

  return withParserRanges({
    body,
    kind: "FunctionDeclaration",
    location: signature.location,
    name: signature.name,
    parameters: signature.parameters,
    returnType: signature.returnType,
    ...(signature.typeParameters ? {typeParameters: signature.typeParameters} : {})
  }, {name: signature.nameLocation})
}

/**
 * Resolves parser-owned pair loops to exact declarations inside one lexical owner.
 * Ambiguous same-name declarations produce no evidence and fail during loop conversion.
 * @param {unknown} value - Function body or entry-point subtree.
 * @returns {Set<object>} Exact pair-iterated parser declarations.
 */
function orderedMapDeclarationsFor(value) {
  /** @type {{declaration: object, name: string, offset: number}[]} */
  const declarations = []
  /** @type {{name: string, offset: number}[]} */
  const receivers = []
  const seen = new WeakSet()
  /**
   * Visits one parser candidate.
   * @param {unknown} candidate - Parser candidate.
   */
  const visit = (candidate) => {
    if (!candidate || typeof candidate != "object" || seen.has(candidate)) return
    seen.add(candidate)
    const type = Reflect.get(candidate, "type")

    if (type == "FunctionDeclaration" || type == "ClassDeclaration") return
    if (type == "VariableDeclarator") {
      const identifier = Reflect.get(candidate, "id")

      if (Reflect.get(identifier, "type") == "Identifier") declarations.push({
        declaration: candidate,
        name: Reflect.get(identifier, "name"),
        offset: Reflect.get(candidate, "start")
      })
    } else if (type == "ForOfStatement") {
      const left = Reflect.get(candidate, "left")
      const right = Reflect.get(candidate, "right")
      const loopDeclarations = left && typeof left == "object" ? Reflect.get(left, "declarations") : undefined
      const pattern = Array.isArray(loopDeclarations) && loopDeclarations.length == 1 ? Reflect.get(loopDeclarations[0], "id") : undefined
      const elements = pattern && typeof pattern == "object" ? Reflect.get(pattern, "elements") : undefined

      if (Reflect.get(left, "kind") == "const" && Reflect.get(pattern, "type") == "ArrayPattern" &&
        Array.isArray(elements) && elements.length == 2 && elements.every((element) => Reflect.get(element, "type") == "Identifier") &&
        Reflect.get(right, "type") == "Identifier") receivers.push({
        name: Reflect.get(right, "name"),
        offset: Reflect.get(candidate, "start")
      })
    }
    for (const [key, child] of Object.entries(candidate)) {
      if (["extra", "innerComments", "leadingComments", "loc", "trailingComments"].includes(key)) continue
      if (Array.isArray(child)) {
        for (const item of child) visit(item)
      } else visit(child)
    }
  }

  visit(value)
  const selected = new Set()
  for (const receiver of receivers) {
    const matches = declarations.filter(({name, offset}) => name == receiver.name && offset < receiver.offset)

    if (matches.length == 1) selected.add(matches[0].declaration)
  }

  return selected
}

/**
 * Converts one exact empty native Error subclass.
 * @param {import("@babel/types").ClassDeclaration} node - Babel class declaration.
 * @param {import("../semantic/types.js").ErrorDeclaration} declaration - Predeclared semantic error.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ErrorDeclaration} Semantic error declaration.
 */
function convertJavaScriptError(node, declaration, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!node.id || node.superClass?.type != "Identifier" || node.superClass.name != "Error" ||
    node.body.body.length != 0 || node.decorators?.length || node.typeParameters || node.superTypeParameters ||
    Reflect.get(node, "abstract") || Reflect.get(node, "declare") || Reflect.get(node, "implements")?.length) {
    return unsupportedSyntax(language, "noncanonical typed error declaration", location)
  }

  return withParserRanges(declaration, {
    name: identifierLocation(node.id, filename, source),
    type: identifierLocation(node.superClass, filename, source)
  })
}

/**
 * Predeclares the bounded native private-field reference-class profile and all callable signatures.
 * @param {import("@babel/types").ClassDeclaration} node - Parser class.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Predeclared class identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} nominalNames - Nominal types by name.
 * @param {"javascript" | "typescript"} language - Source language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ClassDeclaration} Semantic class.
 */
function predeclareReferenceClass(node, declaration, nominalNames, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!node.id || node.superClass || node.decorators?.length || node.typeParameters || node.superTypeParameters ||
    Reflect.get(node, "abstract") || Reflect.get(node, "declare") || Reflect.get(node, "implements")?.length) {
    return unsupportedSyntax(language, "reference class inheritance, generics, decoration, or modifier", location)
  }
  const constructorNodes = /** @type {import("@babel/types").ClassMethod[]} */ (
    node.body.body.filter((member) => member.type == "ClassMethod" && member.kind == "constructor"))
  const fieldNodes = node.body.body.filter((member) => member.type == "ClassProperty" || member.type == "ClassPrivateProperty")
  const methodNodes = /** @type {import("@babel/types").ClassMethod[]} */ (
    node.body.body.filter((member) => member.type == "ClassMethod" && member.kind == "method"))

  if (constructorNodes.length != 1 || fieldNodes.length == 0 ||
    fieldNodes.length + methodNodes.length + constructorNodes.length != node.body.body.length) {
    return unsupportedSyntax(language, "reference class requires private fields, one constructor, and ordinary methods", location)
  }
  declaration.fields = fieldNodes.map((member, index) => {
    const fieldLocation = nodeLocation(member, filename, source)
    let name
    let nameLocation
    let type

    if (language == "typescript") {
      if (member.type != "ClassProperty" || member.key.type != "Identifier" || member.computed || member.static ||
        member.accessibility != "private" || member.readonly || member.value || member.optional || member.decorators?.length ||
        Reflect.get(member, "abstract") || Reflect.get(member, "declare")) {
        return unsupportedSyntax(language, "noncanonical private instance field", fieldLocation)
      }
      name = member.key.name
      nameLocation = identifierLocation(member.key, filename, source)
      type = convertTypeScriptType(member.typeAnnotation, `Private field '${name}'`, fieldLocation, filename, source, nominalNames)
    } else {
      if (member.type != "ClassPrivateProperty" || member.key.type != "PrivateName" || member.static || member.value ||
        member.decorators?.length) {
        return unsupportedSyntax(language, "noncanonical private instance field", fieldLocation)
      }
      name = member.key.id.name
      nameLocation = identifierLocation(member.key.id, filename, source)
      const comment = member.leadingComments?.at(-1)
      const gap = comment ? source.slice(comment.end ?? 0, member.start ?? 0) : ""
      const block = comment?.type == "CommentBlock" && comment.value.startsWith("*") && /^\s*$/u.test(gap)
        ? parseComment(`/*${comment.value}*/`)[0] : undefined
      const tags = block?.tags.filter((tag) => tag.tag == "type") ?? []

      if (!comment || tags.length != 1 || tags[0].name || tags[0].description) {
        return missingType(language, `Private field '${name}'`, fieldLocation)
      }
      type = convertType(tags[0].type, language, `Private field '${name}'`, fieldLocation, source,
        commentTagLocation(/** @type {import("@babel/types").CommentBlock} */ (comment), tags[0], "type", filename, source), nominalNames)
    }

    return withParserRanges({id: `${declaration.id}:field:${index}`, kind: /** @type {const} */ ("PrivateField"),
      location: fieldLocation, name, type}, {name: nameLocation})
  })
  const ownedFields = declaration.fields.filter(({type}) => type.kind == "OwnedResourceType")
  const ownedField = /** @type {import("../semantic/types.js").PrivateField & {type: import("../semantic/types.js").OwnedResourceType}} */ (ownedFields[0])

  declaration.ownership = ownedFields.length == 1
    ? {fieldId: /** @type {string} */ (ownedField.id), kind: "ownedResource", resourceId: ownedField.type.resourceId}
    : {kind: "ordinary"}

  const constructorNode = /** @type {import("@babel/types").ClassMethod} */ (constructorNodes[0])
  const constructorSignature = convertClassCallableSignature(constructorNode, declaration, nominalNames, language,
    filename, source, true)
  declaration.constructor = withParserRanges({body: /** @type {import("../semantic/types.js").Block} */ ({}),
    id: `${declaration.id}:constructor`, kind: /** @type {const} */ ("ConstructorDeclaration"), location: constructorSignature.location,
    parameters: constructorSignature.parameters}, {constructor: constructorSignature.nameLocation})
  declaration.methods = methodNodes.map((methodNode, index) => {
    const signature = convertClassCallableSignature(methodNode, declaration, nominalNames, language, filename, source, false)

    return withParserRanges({body: /** @type {import("../semantic/types.js").Block} */ ({}), id: `${declaration.id}:method:${index}`,
      kind: /** @type {const} */ ("MethodDeclaration"), location: signature.location, name: signature.name,
      parameters: signature.parameters, returnType: /** @type {import("../semantic/types.js").SemanticFunctionReturnType} */ (signature.returnType)},
    {name: signature.nameLocation})
  })

  return withParserRanges(declaration, {name: identifierLocation(node.id, filename, source)})
}

/**
 * Converts one reference class body after every class signature is complete.
 * @param {import("@babel/types").ClassDeclaration} node - Parser class.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Complete predeclared class signature.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} nominalNames - Nominal types by name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration>} valueNames - Nominal constructors by name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Records by identity.
 * @param {Map<string, import("../semantic/types.js").ClassDeclaration>} classes - Classes by identity.
 * @param {Map<string, JavaScriptFunctionSignature>} functions - Top-level signatures.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Errors by name.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Errors by identity.
 * @param {"javascript" | "typescript"} language - Source language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether scalar output canonicalizes zero.
 * @returns {import("../semantic/types.js").ClassDeclaration} Completed semantic class.
 */
function convertReferenceClassBodies(node, declaration, nominalNames, valueNames, records, classes, functions, errorNames,
  errors, language, filename, source, canonicalZeroRequired) {
  const constructorNode = /** @type {import("@babel/types").ClassMethod} */ (
    node.body.body.find((member) => member.type == "ClassMethod" && member.kind == "constructor"))
  const methodNodes = /** @type {import("@babel/types").ClassMethod[]} */ (
    node.body.body.filter((member) => member.type == "ClassMethod" && member.kind == "method"))
  const baseContext = {bindings: new Map(), classes, currentClass: declaration, errorNames, errors, functions,
    recordNames: nominalNames, records, valueRecordNames: valueNames}
  const constructorContext = {...baseContext,
    bindings: new Map(declaration.constructor.parameters.map((parameter) => [parameter.name, parameter.type])),
    returnType: {kind: /** @type {const} */ ("TypeReference"), name: /** @type {const} */ ("void")}}

  declaration.constructor.body = convertBlock(constructorNode.body, language, filename, source, canonicalZeroRequired,
    constructorContext)
  for (let index = 0; index < methodNodes.length; index += 1) {
    const method = declaration.methods[index]
    const context = {...baseContext, bindings: new Map(method.parameters.map((parameter) => [parameter.name, parameter.type])),
      returnType: method.returnType}

    method.body = convertBlock(methodNodes[index].body, language, filename, source, canonicalZeroRequired, context)
  }

  return declaration
}

/**
 * Reads one constructor or method signature without admitting overloads or modifiers.
 * @param {import("@babel/types").ClassMethod} node - Parser method.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Declaring class.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} nominalNames - Nominal types.
 * @param {"javascript" | "typescript"} language - Source language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} constructor - Whether this is the constructor.
 * @returns {{location: import("../semantic/types.js").SourceLocation, name: string, nameLocation: import("../semantic/types.js").SourceLocation, parameters: import("../semantic/types.js").Parameter[], returnType?: import("../semantic/types.js").SemanticFunctionReturnType}} Signature.
 */
function convertClassCallableSignature(node, declaration, nominalNames, language, filename, source, constructor) {
  const location = nodeLocation(node, filename, source)

  if (node.computed || node.static || node.async || node.generator || node.decorators?.length || node.typeParameters ||
    node.key.type != "Identifier" || constructor != (node.kind == "constructor") ||
    language == "typescript" && node.accessibility != null) {
    return unsupportedSyntax(language, "noncanonical reference class callable", location)
  }
  const documented = language == "javascript"
    ? jsdocTypes(/** @type {import("@babel/types").FunctionDeclaration} */ (/** @type {unknown} */ (node)), filename, source)
    : undefined
  if (constructor && (node.returnType || documented?.returnType)) {
    return unsupportedSyntax(language, "constructor return annotation", location)
  }
  const parameters = node.params.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)

    if (parameter.type != "Identifier" || parameter.optional || parameter.decorators?.length) {
      return unsupportedSyntax(language, "noncanonical method parameter", parameterLocation)
    }
    const documentedType = documented?.parameters.get(parameter.name)
    const type = language == "typescript"
      ? convertTypeScriptType(parameter.typeAnnotation, `Parameter '${parameter.name}'`, parameterLocation, filename, source, nominalNames)
      : convertType(documentedType?.sourceType, language, `Parameter '${parameter.name}'`, parameterLocation, source,
        documentedType?.location, nominalNames)

    return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: parameterLocation, name: parameter.name, type},
      {name: identifierLocation(parameter, filename, source)})
  })
  if (documented && documented.parameters.size != parameters.length) {
    return unsupportedSyntax(language, "method JSDoc parameter mismatch", location)
  }
  const name = constructor ? "constructor" : node.key.name
  const nameLocation = identifierLocation(node.key, filename, source)

  if (!constructor && referenceMethodHooks.has(name)) {
    return unsupportedSyntax(language, `reserved reference method '${name}'`, nameLocation)
  }

  return {location, name, nameLocation, parameters, ...(constructor ? {} : {returnType: language == "typescript"
    ? convertTypeScriptReturnType(node.returnType, `Method '${name}' return`, location, filename, source, nominalNames)
    : convertReturnType(documented?.returnType?.sourceType, language, `Method '${name}' return`, location, source,
      documented?.returnType?.location, nominalNames)})}
}

/**
 * Converts one exact TypeScript readonly constructor-parameter record profile.
 * @param {import("@babel/types").ClassDeclaration} node - Class declaration.
 * @param {import("../semantic/types.js").RecordDeclaration} declaration - Predeclared nominal identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - All nominal declarations by name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").RecordDeclaration} Semantic record declaration.
 */
function convertTypeScriptRecord(node, declaration, recordNames, filename, source) {
  const location = nodeLocation(node, filename, source)
  const implements_ = Reflect.get(node, "implements")
  const mixins = Reflect.get(node, "mixins")

  if (!node.id) return unsupportedSyntax("typescript", "anonymous record class", location)
  if (node.superClass || (Array.isArray(implements_) && implements_.length) || node.decorators?.length || node.superTypeParameters ||
    Reflect.get(node, "abstract") || Reflect.get(node, "declare") || (Array.isArray(mixins) && mixins.length)) {
    return unsupportedSyntax("typescript", "record inheritance, decoration, or modifier", location)
  }
  if (node.body.body.length != 1 || node.body.body[0].type != "ClassMethod") {
    const extra = node.body.body[1] ?? node.body.body[0] ?? node.body

    return unsupportedSyntax("typescript", "record class body outside one constructor", nodeLocation(extra, filename, source))
  }
  const constructor = node.body.body[0]
  const typeParameterNames = new Map((declaration.typeParameters ?? []).map((parameter) => [parameter.name, parameter]))

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
      type: convertTypeScriptType(identifier.typeAnnotation, `Record field '${identifier.name}'`, fieldLocation, filename, source,
        recordNames, typeParameterNames)
    }

    return withParserRanges(field, {name: identifierLocation(identifier, filename, source)})
  })

  return withParserRanges(declaration, {name: identifierLocation(node.id, filename, source)})
}

/**
 * Converts one exact JSDoc constructor/readonly-assignment/freeze record profile.
 * @param {import("@babel/types").ClassDeclaration} node - Class declaration.
 * @param {import("../semantic/types.js").RecordDeclaration} declaration - Predeclared nominal identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by name.
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
  const typeParameterNames = new Map((declaration.typeParameters ?? []).map((parameter) => [parameter.name, parameter]))

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
        nodeLocation(identifier, filename, source), source, documentedType.location, recordNames, typeParameterNames)
    }

    return withParserRanges(field, {name: identifierLocation(statement.expression.left.property, filename, source)})
  })
  const freeze = constructor.body.body.at(-1)

  if (!freeze || freeze.type != "ExpressionStatement" || freeze.expression.type != "CallExpression" || freeze.expression.optional ||
    freeze.expression.arguments.length != 1 || freeze.expression.arguments[0].type != "ThisExpression" ||
    !isJavaScriptRecordFreeze(freeze.expression)) {
    return unsupportedSyntax("javascript", "record constructor without final Object.freeze(this)", nodeLocation(freeze ?? constructor, filename, source))
  }

  return withParserRanges(declaration, {name: identifierLocation(node.id, filename, source)})
}

/**
 * Recognizes the canonical source freeze or the generated identifier-free intrinsic owner.
 * @param {import("@babel/types").CallExpression} expression - Final constructor call.
 * @returns {boolean} Whether the call owns the native record-freeze operation.
 */
function isJavaScriptRecordFreeze(expression) {
  const callee = expression.callee

  if (callee.type != "MemberExpression" || callee.computed || callee.optional ||
    callee.property.type != "Identifier" || callee.property.name != "freeze") return false
  if (callee.object.type == "Identifier") return callee.object.name == "Object"
  if (callee.object.type != "MemberExpression" || callee.object.computed || callee.object.optional ||
    callee.object.property.type != "Identifier" || callee.object.property.name != "constructor") return false

  return callee.object.object.type == "ObjectExpression" && callee.object.object.properties.length == 0 &&
    callee.object.object.extra?.parenthesized === true
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
 * Converts one exact block-bodied pre-condition loop.
 * @param {import("@babel/types").WhileStatement} node - Babel while statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @param {JavaScriptConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").WhileStatement} Semantic loop.
 */
function convertWhile(node, language, filename, source, canonicalZeroRequired, context) {
  const location = nodeLocation(node, filename, source)

  if (node.body.type != "BlockStatement") {
    return unsupportedSyntax(language, "while without block body", nodeLocation(node.body, filename, source))
  }
  const bodyContext = {...context, bindings: new Map(context.bindings)}

  return withParserRanges({
    body: convertBlock(node.body, language, filename, source, canonicalZeroRequired, bodyContext),
    condition: convertExpression(node.test, language, filename, source, context, undefined, true),
    kind: /** @type {const} */ ("WhileStatement"),
    location
  }, {keyword: tokenLocation(node, "while", node.start ?? 0, node.test.start ?? node.end ?? source.length, filename, source)})
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
 * @param {readonly import("../semantic/types.js").EffectCapabilityDeclaration[]} [input.capabilities] - Compiler-authorized declarations.
 * @param {{isEntry: boolean, functions: Map<string, import("../semantic/types.js").FunctionDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, errors?: Map<string, import("../semantic/types.js").ErrorDeclaration>, valueRecords?: Map<string, import("../semantic/types.js").RecordDeclaration>}} [input.program] - Resolved program imports and entry role.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseJavaScriptTypeScript({capabilities = [], filename, language, source, program}) {
  const file = parseBabelSource({filename, language, source, sourceType: program ? "module" : "script"})
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
  /** @type {import("@babel/types").Statement[]} */
  let semanticNodes = []

  for (const node of file.program.body) {
    if (node.type == "ImportDeclaration") {
      if (!program) return unsupportedSyntax(language, "import declaration", nodeLocation(node, filename, source))
      continue
    }
    if (node.type == "ExportNamedDeclaration") {
      if (!program) return unsupportedSyntax(language, "export declaration", nodeLocation(node, filename, source))
      if (node.source || node.declaration && !["ClassDeclaration", "FunctionDeclaration"].includes(node.declaration.type)) {
        return unsupportedSyntax(language, "re-export or unsupported exported declaration", nodeLocation(node, filename, source))
      }
      if (node.declaration) {
        if (!node.declaration.leadingComments && node.leadingComments) node.declaration.leadingComments = node.leadingComments
        semanticNodes.push(/** @type {import("@babel/types").ClassDeclaration | import("@babel/types").FunctionDeclaration} */ (node.declaration))
      }
      continue
    }
    if (node.type == "ExportDefaultDeclaration" || node.type == "ExportAllDeclaration") {
      return unsupportedSyntax(language, node.type, nodeLocation(node, filename, source))
    }
    semanticNodes.push(node)
  }
  semanticNodes = task034JavaScriptNodes(semanticNodes, capabilities, language, filename, source)
  const classNodes = semanticNodes.filter((node) => node.type == "ClassDeclaration")
  const errorNodes = classNodes.filter((node) => node.superClass?.type == "Identifier" && node.superClass.name == "Error")
  const referenceClassNodes = classNodes.filter((node) => !errorNodes.includes(node) &&
    node.body.body.some((member) => member.type == "ClassProperty" || member.type == "ClassPrivateProperty"))
  const recordNodes = classNodes.filter((node) => !errorNodes.includes(node) && !referenceClassNodes.includes(node))
  const errorDeclarations = errorNodes.map((node, index) => ({
    id: `error:${index}`,
    kind: /** @type {const} */ ("ErrorDeclaration"),
    location: nodeLocation(node, filename, source),
    name: node.id?.name ?? ""
  }))
  const recordDeclarations = recordNodes.map((node, index) => {
    const id = `record:${index}`
    const typeParameters = language == "typescript"
      ? typeScriptTypeParameters(/** @type {import("@babel/types").TSTypeParameterDeclaration | null | undefined} */ (node.typeParameters), id, filename, source)
      : classJsdocTypeParameters(node, id, filename, source)

    return {
      fields: [],
      id,
      kind: /** @type {const} */ ("RecordDeclaration"),
      location: nodeLocation(node, filename, source),
      name: node.id?.name ?? "",
      ...(typeParameters ? {typeParameters} : {})
    }
  })
  const classDeclarations = referenceClassNodes.map((node, index) => ({
    constructor: /** @type {import("../semantic/types.js").ConstructorDeclaration} */ ({}),
    fields: [], id: `class:${index}`, kind: /** @type {const} */ ("ClassDeclaration"),
    location: nodeLocation(node, filename, source), methods: [], name: node.id?.name ?? ""
  }))
  const recordNames = /** @type {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} */ (
    new Map(program?.records ?? []))
  for (const resource of capabilities.flatMap(({resources}) => resources)) recordNames.set(resource.name, resource)
  const valueRecordNames = /** @type {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration>} */ (
    new Map(program?.valueRecords ?? program?.records ?? []))
  const errorNames = new Map(program?.errors ?? [])
  for (const failure of capabilities.flatMap(({failures}) => failures)) {
    errorNames.set(failure.name, /** @type {import("../semantic/types.js").ErrorDeclaration} */ (/** @type {unknown} */ (failure)))
  }
  for (const declaration of errorDeclarations) errorNames.set(declaration.name, declaration)
  const errorsById = new Map([...errorNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const errors = errorNodes.map((node, index) => convertJavaScriptError(node, errorDeclarations[index], language, filename, source))
  for (const declaration of recordDeclarations) recordNames.set(declaration.name, declaration)
  for (const declaration of recordDeclarations) valueRecordNames.set(declaration.name, declaration)
  for (const declaration of classDeclarations) recordNames.set(declaration.name, declaration)
  for (const declaration of classDeclarations) valueRecordNames.set(declaration.name, declaration)
  const valueRecordsById = new Map(recordDeclarations.map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const classesById = new Map(classDeclarations.map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const classes = referenceClassNodes.map((node, index) => predeclareReferenceClass(
    node, classDeclarations[index], recordNames, language, filename, source
  ))
  const functionNodes = semanticNodes.filter((node) => node.type == "FunctionDeclaration")
  const signatures = functionNodes.map((node, index) =>
    convertFunctionSignature(node, language, filename, source, recordNames, `function:${index}`))
  const functionSignatures = new Map([...program?.functions ?? []].map(([localName, declaration]) => [localName, {
    location: declaration.location,
    name: localName,
    nameLocation: declaration.location,
    parameters: declaration.parameters,
    returnType: declaration.returnType,
    ...(declaration.typeParameters ? {typeParameters: declaration.typeParameters} : {})
  }]))
  for (const operation of capabilities.flatMap(({operations}) => operations)) {
    if (!functionSignatures.has(operation.name)) functionSignatures.set(operation.name, {
      location: moduleLocation(filename, source),
      name: operation.name,
      nameLocation: moduleLocation(filename, source),
      parameters: operation.parameters.map((parameter) => ({...parameter, kind: /** @type {const} */ ("Parameter"), location: moduleLocation(filename, source)})),
      returnType: operation.returnType
    })
  }
  for (const signature of signatures) functionSignatures.set(signature.name, signature)
  const records = recordNodes.map((node, index) => language == "typescript"
    ? convertTypeScriptRecord(node, recordDeclarations[index], recordNames, filename, source)
    : convertJavaScriptRecord(node, recordDeclarations[index], recordNames, filename, source))
  for (let index = 0; index < referenceClassNodes.length; index += 1) {
    convertReferenceClassBodies(referenceClassNodes[index], classes[index], recordNames, valueRecordNames,
      valueRecordsById, classesById, functionSignatures, errorNames, errorsById, language, filename, source,
      canonicalZeroRequired)
  }
  const functions = functionNodes.map((node, index) =>
    convertFunction(node, signatures[index], functionSignatures, recordNames, valueRecordNames, valueRecordsById, classesById,
      errorNames, errorsById, language, filename, source, canonicalZeroRequired))
  const entryNodes = semanticNodes.filter((node) => node.type != "FunctionDeclaration" && node.type != "ClassDeclaration")
  const location = moduleLocation(filename, source)

  if (!program && functions.length == 0) return unsupportedSyntax(language, "module without a function", location)
  if (program && !program.isEntry && entryNodes.length > 0) {
    return unsupportedSyntax(language, "top-level side effect outside the selected entry module", nodeLocation(entryNodes[0], filename, source))
  }
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
    {bindings: new Map(), classes: classesById, errorNames, errors: errorsById, functions: functionSignatures,
      orderedMapDeclarations: orderedMapDeclarationsFor(entryNodes), recordNames, records: valueRecordsById, valueRecordNames},
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
    ...(errors.length > 0 ? {errors} : {}),
    ...(classes.length > 0 ? {classes} : {}),
    ...(records.length > 0 ? {records} : {})
  }
}

/**
 * Removes exact protected Node probe support before portable conversion.
 * @param {import("@babel/types").Statement[]} nodes - Parsed top-level statements.
 * @param {readonly import("../semantic/types.js").EffectCapabilityDeclaration[]} capabilities - Authorized declarations.
 * @param {"javascript" | "typescript"} language - Source language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("@babel/types").Statement[]} Portable statements.
 */
function task034JavaScriptNodes(nodes, capabilities, language, filename, source) {
  if (!isTask034ResourceProbe(capabilities)) return nodes
  const first = nodes[0]
  const marker = first?.leadingComments?.some((comment) => comment.type == "CommentBlock" &&
    comment.value.trim() == "semantifold-task034-support")

  if (!marker) return nodes
  if (!hasExactEffectSupport(source, language)) {
    return unsupportedSyntax(language, "malformed protected Task 034 support", nodeLocation(first, filename, source))
  }
  const expected = [
    ["VariableDeclaration", "__semantifoldTask034Fs"], ["ClassDeclaration", "ProbeOperationFailure"],
    ["ClassDeclaration", "ProbeAcquireFailure"], ["ClassDeclaration", "ProbeReadFailure"],
    ["ClassDeclaration", "ProbeCloseFailure"], ["ClassDeclaration", "ProbeResourceClosed"],
    ["ClassDeclaration", "ProbeResource"], ["VariableDeclaration", "__semantifoldTask034Trace"],
    ["FunctionDeclaration", "probeEffect"], ["FunctionDeclaration", "probeAcquire"],
    ["FunctionDeclaration", "probeRead"], ["FunctionDeclaration", "probeClose"], ["FunctionDeclaration", "probeTrace"]
  ]
  /**
   * Reads the declaration name used to verify one protected support statement.
   * @param {import("@babel/types").Statement | undefined} node - Candidate statement.
   * @returns {string | undefined} Declared name.
   */
  const nodeName = (node) => {
    if (!node) return undefined
    if (node.type == "VariableDeclaration" && node.declarations.length == 1 && node.declarations[0].id.type == "Identifier") {
      return node.declarations[0].id.name
    }
    const id = Reflect.get(node, "id")
    return id && typeof id == "object" && typeof Reflect.get(id, "name") == "string" ? Reflect.get(id, "name") : undefined
  }
  const matches = expected.every(([type, name], index) => nodes[index]?.type == type && nodeName(nodes[index]) == name)
  const next = nodes[expected.length]
  const ended = next?.leadingComments?.some((comment) => comment.type == "CommentBlock" &&
    comment.value.trim() == "semantifold-task034-support-end")

  if (!matches || next && !ended) {
    return unsupportedSyntax(language, "malformed protected Task 034 support", nodeLocation(first, filename, source))
  }
  return nodes.slice(expected.length)
}

/**
 * Invokes Babel and normalizes syntax failures.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {"javascript" | "typescript"} input.language - Frontend language.
 * @param {string} input.source - Source text.
 * @param {"module" | "script"} input.sourceType - Explicit parser goal.
 * @returns {import("@babel/parser").ParseResult<import("@babel/types").File>} Babel file.
 */
function parseBabelSource({filename, language, source, sourceType}) {
  try {
    return parseBabel(source, {
      allowAwaitOutsideFunction: true,
      plugins: language == "typescript" ? ["decorators-legacy", "typescript"] : ["decorators-legacy"],
      sourceFilename: filename,
      sourceType,
      tokens: true
    })
  } catch (error) {
    return parseFailure(language, error, babelParserFailureLocation(error, filename, source))
  }
}

/**
 * Reads only parser-owned ESM import/export declarations for program assembly.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {"javascript" | "typescript"} input.language - Frontend language.
 * @param {string} input.source - Source text.
 * @returns {{imports: {importedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, pathLocation: import("../semantic/types.js").SourceLocation, specifier: string, typeOnly: boolean}[], exports: {exportedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, typeOnly: boolean}[]}} Parser-owned ESM module header.
 */
export function inspectJavaScriptTypeScriptModule({filename, language, source}) {
  const file = parseBabelSource({filename, language, source, sourceType: "module"})
  const tokens = file.tokens ?? []

  rememberTokens(file, {byStart: new Map(tokens.map((token) => [token.start, token])), tokens})
  const commonJs = findCommonJsNode(file.program)

  if (commonJs) unsupportedSyntax(language, "CommonJS require/module exports", nodeLocation(commonJs, filename, source))
  const imports = []
  const exports = []

  for (const node of file.program.body) {
    if (node.type == "ImportDeclaration") {
      if (!node.source.value.startsWith("./") && !node.source.value.startsWith("../")) {
        unsupportedSyntax(language, "bare package import", nodeLocation(node.source, filename, source))
      }
      if (node.specifiers.length == 0) unsupportedSyntax(language, "side-effect-only import", nodeLocation(node, filename, source))
      if ((node.attributes?.length ?? 0) > 0 || (node.assertions?.length ?? 0) > 0 || Reflect.get(node, "phase")) {
        unsupportedSyntax(language, "import attributes or phase", nodeLocation(node, filename, source))
      }
      for (const specifier of node.specifiers) {
        if (specifier.type != "ImportSpecifier" || specifier.imported.type != "Identifier") {
          unsupportedSyntax(language, specifier.type, nodeLocation(specifier, filename, source))
        }
        imports.push({
          declarationLocation: nodeLocation(node, filename, source),
          importedName: specifier.imported.name,
          importedNameLocation: identifierLocation(specifier.imported, filename, source),
          localName: specifier.local.name,
          localNameLocation: identifierLocation(specifier.local, filename, source),
          location: nodeLocation(specifier, filename, source),
          pathLocation: nodeLocation(node.source, filename, source),
          specifier: node.source.value,
          typeOnly: node.importKind == "type" || specifier.importKind == "type"
        })
      }
      continue
    }
    if (node.type == "ExportDefaultDeclaration" || node.type == "ExportAllDeclaration") {
      unsupportedSyntax(language, node.type, nodeLocation(node, filename, source))
    }
    if (node.type != "ExportNamedDeclaration") continue
    if (node.source) unsupportedSyntax(language, "re-export", nodeLocation(node, filename, source))
    if (node.exportKind == "type") unsupportedSyntax(language, "type-only export", nodeLocation(node, filename, source))
    if (node.declaration) {
      if (node.declaration.type != "FunctionDeclaration" && node.declaration.type != "ClassDeclaration") {
        unsupportedSyntax(language, "unsupported exported declaration", nodeLocation(node.declaration, filename, source))
      }
      const identifier = node.declaration.id

      if (!identifier) unsupportedSyntax(language, "anonymous exported declaration", nodeLocation(node.declaration, filename, source))
      exports.push({
        declarationLocation: nodeLocation(node, filename, source),
        exportedName: identifier.name,
        exportedNameLocation: identifierLocation(identifier, filename, source),
        localName: identifier.name,
        localNameLocation: identifierLocation(identifier, filename, source),
        location: identifierLocation(identifier, filename, source),
        typeOnly: /** @type {const} */ (false)
      })
      continue
    }
    for (const specifier of node.specifiers) {
      if (specifier.type != "ExportSpecifier" || specifier.local.type != "Identifier" || specifier.exported.type != "Identifier") {
        unsupportedSyntax(language, specifier.type, nodeLocation(specifier, filename, source))
      }
      if (specifier.exportKind == "type") unsupportedSyntax(language, "type-only export", nodeLocation(specifier, filename, source))
      exports.push({
        declarationLocation: nodeLocation(node, filename, source),
        exportedName: specifier.exported.name,
        exportedNameLocation: identifierLocation(specifier.exported, filename, source),
        localName: specifier.local.name,
        localNameLocation: identifierLocation(specifier.local, filename, source),
        location: nodeLocation(specifier, filename, source),
        typeOnly: /** @type {const} */ (false)
      })
    }
  }

  return {exports, imports}
}

/**
 * Finds CommonJS constructs through Babel nodes rather than source-text matching.
 * @param {unknown} value - Babel subtree.
 * @param {WeakSet<object>} [seen] - Cycle guard.
 * @returns {import("@babel/types").Node | undefined} Unsupported node.
 */
function findCommonJsNode(value, seen = new WeakSet()) {
  if (!value || typeof value != "object" || seen.has(value)) return undefined
  seen.add(value)
  const node = /** @type {Record<string, unknown>} */ (value)

  if (node.type == "CallExpression") {
    const callee = node.callee

    if (callee && typeof callee == "object" && Reflect.get(callee, "type") == "Identifier" && Reflect.get(callee, "name") == "require") {
      return /** @type {import("@babel/types").Node} */ (value)
    }
  }
  if (node.type == "MemberExpression") {
    const object = node.object

    if (object && typeof object == "object" && Reflect.get(object, "type") == "Identifier" &&
      ["exports", "module"].includes(String(Reflect.get(object, "name")))) {
      return /** @type {import("@babel/types").Node} */ (value)
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (["extra", "innerComments", "leadingComments", "loc", "trailingComments"].includes(key)) continue
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findCommonJsNode(item, seen)

        if (found) return found
      }
    } else {
      const found = findCommonJsNode(child, seen)

      if (found) return found
    }
  }

  return undefined
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
