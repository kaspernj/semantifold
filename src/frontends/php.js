// @ts-check

import PhpParser from "php-parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceReturnType, requireSourceScalarType} from "./scalars.js"
import {documentedValueType, iterationBindingType, optionalType} from "./types.js"
const parser = new PhpParser.Engine({
  ast: {withPositions: true},
  parser: {extractDoc: true, suppressErrors: false}
})
/** @type {string | undefined} */
let cachedTokenSource
/** @type {{end: number, start: number, text: string}[]} */
let cachedTokenRanges = []
const phpBinaryOperations = new Map([
  ["+", "PhpAdd"],
  ["-", "Subtract"],
  ["*", "Multiply"],
  ["&&", "And"],
  ["||", "Or"],
  ["===", "Equal"],
  ["!==", "NotEqual"],
  ["<", "LessThan"],
  ["<=", "LessThanOrEqual"],
  [">", "GreaterThan"],
  [">=", "GreaterThanOrEqual"],
  [".", "StringConcat"]
])

/**
 * @typedef PhpConversionContext
 * @property {Map<string, import("../semantic/types.js").SemanticValueType>} bindings - Explicitly typed visible bindings.
 * @property {Map<string, PhpFunctionSignature>} functions - Explicit module function signatures.
 * @property {import("../semantic/types.js").SemanticFunctionReturnType | undefined} returnType - Enclosing return type.
 */

/**
 * @typedef PhpFunctionSignature
 * @property {import("../semantic/types.js").SourceLocation} location - Complete declaration location.
 * @property {import("../semantic/types.js").SourceLocation} nameLocation - Parser-owned name location.
 * @property {string} name - Function name.
 * @property {import("../semantic/types.js").Parameter[]} parameters - Semantic parameters.
 * @property {import("../semantic/types.js").SemanticFunctionReturnType} returnType - Semantic return type.
 */

/**
 * Returns a normalized PHP node location.
 * @param {import("php-parser").Node} node - PHP parser node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Source location.
 */
function nodeLocation(node, filename, source) {
  if (!node.loc) throw new Error(`PHP parser omitted source location for ${node.kind}.`)

  return locationFromOffsets(filename, source, node.loc.start.offset, node.loc.end.offset)
}

/**
 * Locates a comment-parser token inside a PHP parser-owned doc comment.
 * @param {import("php-parser").CommentBlock} comment - PHP doc comment.
 * @param {import("comment-parser").Spec} tag - Parsed doc tag.
 * @param {"name" | "type"} field - Token field.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Exact token location.
 */
function commentTagLocation(comment, tag, field, filename, source) {
  const line = tag.source[0]

  if (!comment.loc || !line) throw new Error(`Comment parser omitted the @${tag.tag} source token.`)

  let lineStart = comment.loc.start.offset

  for (let lineNumber = 0; lineNumber < line.number; lineNumber++) {
    while (lineStart < source.length && source[lineStart] != "\r" && source[lineStart] != "\n") lineStart++
    if (source[lineStart] == "\r" && source[lineStart + 1] == "\n") lineStart += 2
    else lineStart++
  }

  const orderedFields = ["start", "delimiter", "postDelimiter", "tag", "postTag", "name", "postName", "type"]
  const fieldIndex = orderedFields.indexOf(field)
  const start = lineStart + orderedFields.slice(0, fieldIndex).reduce((length, key) =>
    length + line.tokens[/** @type {keyof typeof line.tokens} */ (key)].length, 0)
  const value = line.tokens[field]

  return locationFromOffsets(filename, source, start, start + value.length)
}

/**
 * Finds one parser token between parser-owned node boundaries.
 * @param {string} tokenText - Exact token text.
 * @param {number} startOffset - Inclusive search boundary.
 * @param {number} endOffset - Exclusive search boundary.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Token location.
 */
function tokenLocation(tokenText, startOffset, endOffset, filename, source) {
  if (cachedTokenSource != source) {
    let offset = 0

    cachedTokenRanges = parser.tokenGetAll(source).map((token) => {
      const text = typeof token == "string" ? token : token[1]
      const range = {end: offset + text.length, start: offset, text}

      offset = range.end

      return range
    })
    cachedTokenSource = source
  }

  const token = cachedTokenRanges.find((candidate) => candidate.text == tokenText && candidate.start >= startOffset &&
    candidate.end <= endOffset)

  if (token) return locationFromOffsets(filename, source, token.start, token.end)

  throw new Error(`PHP parser omitted token '${tokenText}' between ${startOffset} and ${endOffset}.`)
}

/**
 * Converts a supported PHP expression.
 * @param {import("php-parser").Expression} node - PHP expression.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @param {import("../semantic/types.js").SemanticValueType} [expectedType] - Contextual type for empty PHP arrays.
 * @param {boolean} [preserveOptional] - Whether an optional identifier remains wrapped.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source, context, expectedType, preserveOptional = false) {
  const location = nodeLocation(node, filename, source)

  if (expectedType?.kind == "OptionalType") {
    if (node.kind == "nullkeyword") {
      return withParserRanges({kind: /** @type {const} */ ("OptionalNone"), location}, {absence: location})
    }
    if (knownExpressionType(node, context)?.kind == "OptionalType") {
      return convertExpression(node, filename, source, context, undefined, true)
    }
    return withParserRanges({
      kind: /** @type {const} */ ("OptionalSome"),
      location,
      value: convertExpression(node, filename, source, context, expectedType.valueType)
    }, {some: location})
  }

  if (node.kind == "nullkeyword") return unsupportedSyntax("php", "null outside an explicit optional context", location)

  if (node.kind == "variable") {
    const variable = /** @type {import("php-parser").Variable} */ (node)

    if (typeof variable.name != "string") return unsupportedSyntax("php", "dynamic variable", location)

    const identifier = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: variable.name}, {name: location})

    if (!preserveOptional && context.bindings.get(variable.name)?.kind == "OptionalType") {
      return withParserRanges({kind: /** @type {const} */ ("OptionalUnwrap"), location, operand: identifier}, {unwrap: location})
    }

    return identifier
  }

  if (node.kind == "number") {
    const literal = /** @type {import("php-parser").Number} */ (node)
    const value = Number(literal.value)

    if (!Number.isSafeInteger(value)) return unsupportedSyntax("php", "non-safe integer literal", location)

    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
  }

  if (node.kind == "boolean") {
    const literal = /** @type {import("php-parser").Boolean} */ (node)

    if (typeof literal.value != "boolean") return unsupportedSyntax("php", "invalid boolean literal value", location)

    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: literal.value}, {literal: location})
  }

  if (node.kind == "string") {
    const literal = /** @type {import("php-parser").String} */ (node)

    if (typeof literal.raw == "string" && literal.raw.startsWith("<<<")) {
      const detail = literal.raw.startsWith("<<<'") ? "nowdoc string" : "heredoc string"

      return unsupportedSyntax("php", detail, location)
    }
    if (typeof literal.raw == "string" && ["b\"", "B\"", "b'", "B'"].some((prefix) => literal.raw.startsWith(prefix))) {
      return unsupportedSyntax("php", "binary string literal", location)
    }
    if (typeof literal.value != "string" || !hasOnlyUnicodeScalars(literal.value)) {
      return unsupportedSyntax("php", "invalid Unicode string literal", location)
    }

    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: literal.value}, {literal: location})
  }

  if (node.kind == "encapsed") {
    const literal = /** @type {import("php-parser").Encapsed} */ (node)
    const detail = literal.type == "string" ? "interpolated string" : `${literal.type} string`

    return unsupportedSyntax("php", detail, location)
  }

  if (node.kind == "nowdoc") return unsupportedSyntax("php", "nowdoc string", location)

  if (node.kind == "array") {
    const literal = /** @type {import("php-parser").Array} */ (node)
    const invalidEntry = literal.items.find((entry) => {
      if (entry.kind != "entry") return true
      const candidate = /** @type {import("php-parser").Entry} */ (entry)

      return candidate.byRef || candidate.unpack
    })

    if (invalidEntry) return unsupportedSyntax("php", "array reference or unpacking", nodeLocation(invalidEntry, filename, source))
    const entries = /** @type {import("php-parser").Entry[]} */ (literal.items)
    const hasKeys = entries.some((entry) => entry.key != null)
    const hasImplicit = entries.some((entry) => entry.key == null)
    const collectionKind = entries.length == 0 ? expectedType?.kind : hasKeys && !hasImplicit ? "MapType" : !hasKeys ? "ListType" : "mixed"

    if (collectionKind == "mixed") return unsupportedSyntax("php", "mixed list/map array literal", location)
    if (collectionKind == "ListType") {
      const elementType = expectedType?.kind == "ListType" ? expectedType.elementType : undefined

      return withParserRanges({
        elements: entries.map((entry) => convertExpression(entry.value, filename, source, context, elementType)),
        kind: /** @type {const} */ ("ListLiteral"),
        location
      }, {literal: location})
    }
    if (collectionKind == "MapType") {
      const valueType = expectedType?.kind == "MapType" ? expectedType.valueType : undefined
      const semanticEntries = entries.map((entry) => {
        if (!entry.key || entry.key.kind != "string") {
          return unsupportedSyntax("php", "map key other than a literal string", entry.key ? nodeLocation(entry.key, filename, source) : nodeLocation(entry, filename, source))
        }
        const key = convertExpression(entry.key, filename, source, context)

        return withParserRanges({
          key: /** @type {import("../semantic/types.js").StringLiteral} */ (key),
          kind: /** @type {const} */ ("MapEntry"),
          location: nodeLocation(entry, filename, source),
          value: convertExpression(entry.value, filename, source, context, valueType)
        }, {operator: tokenLocation("=>", entry.key.loc?.end.offset ?? 0, entry.value.loc?.start.offset ?? source.length, filename, source)})
      })

      return withParserRanges({entries: semanticEntries, kind: /** @type {const} */ ("MapLiteral"), location}, {literal: location})
    }

    return unsupportedSyntax("php", "empty array without a list or map type", location)
  }

  if (node.kind == "offsetlookup") {
    const lookup = /** @type {import("php-parser").OffsetLookup} */ (node)

    if (!lookup.offset) return unsupportedSyntax("php", "append or missing array index", location)
    const receiver = lookup.what.kind == "variable" ? /** @type {import("php-parser").Variable} */ (lookup.what) : undefined
    const receiverType = receiver && typeof receiver.name == "string" ? context.bindings.get(receiver.name) : undefined
    const accessKind = receiverType?.kind == "ListType" ? "list" : receiverType?.kind == "MapType" ? "map" :
      lookup.offset.kind == "number" ? "list" : lookup.offset.kind == "string" ? "map" : undefined

    if (accessKind == "list" && ["number", "string", "variable"].includes(lookup.offset.kind)) {
      return withParserRanges({
        collection: convertExpression(lookup.what, filename, source, context),
        index: convertExpression(lookup.offset, filename, source, context),
        kind: /** @type {const} */ ("ListIndexExpression"),
        location,
        totality: /** @type {const} */ ("proven")
      }, {operator: tokenLocation("[", lookup.what.loc?.end.offset ?? 0, lookup.offset.loc?.start.offset ?? source.length, filename, source)})
    }
    if (accessKind == "map" && ["number", "string", "variable"].includes(lookup.offset.kind)) {
      return withParserRanges({
        collection: convertExpression(lookup.what, filename, source, context),
        key: convertExpression(lookup.offset, filename, source, context),
        kind: /** @type {const} */ ("MapLookupExpression"),
        location,
        totality: /** @type {const} */ ("proven")
      }, {operator: tokenLocation("[", lookup.what.loc?.end.offset ?? 0, lookup.offset.loc?.start.offset ?? source.length, filename, source)})
    }

    return unsupportedSyntax("php", "nonliteral array access", nodeLocation(lookup.offset, filename, source))
  }

  if (node.kind == "unary") {
    const unary = /** @type {import("php-parser").Unary} */ (node)

    if (!["!", "-"].includes(unary.type)) return unsupportedSyntax("php", `unary ${unary.type}`, location)

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(unary.what, filename, source, context)
    }, {
      operator: tokenLocation(unary.type, unary.loc?.start.offset ?? 0, unary.what.loc?.start.offset ?? unary.loc?.end.offset ?? source.length, filename, source)
    }), unary.type == "!" ? "Not" : "Negate")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.kind == "bin") {
    const binary = /** @type {import("php-parser").Bin} */ (node)
    if (binary.type == "!==" && binary.left.kind == "variable" && binary.right.kind == "nullkeyword") {
      const operand = /** @type {import("../semantic/types.js").IdentifierExpression} */ (
        convertExpression(binary.left, filename, source, context, undefined, true)
      )

      return withParserRanges({kind: /** @type {const} */ ("OptionalIsPresent"), location, operand}, {
        operator: tokenLocation(binary.type, binary.left.loc?.end.offset ?? 0, binary.right.loc?.start.offset ?? source.length, filename, source)
      })
    }
    if (["==", "!="].includes(binary.type)) return unsupportedSyntax("php", `coercive equality ${binary.type}`, location)
    if (["and", "or"].includes(binary.type)) return unsupportedSyntax("php", `precedence-sensitive boolean ${binary.type}`, location)
    if (!phpBinaryOperations.has(binary.type)) return unsupportedSyntax("php", `binary ${binary.type}`, location)

    const semantic = withAdaptedOperation({
      kind: /** @type {const} */ ("BinaryExpression"),
      left: convertExpression(binary.left, filename, source, context),
      location,
      right: convertExpression(binary.right, filename, source, context)
    }, /** @type {import("../semantic/operators.js").AdaptedOperation} */ (phpBinaryOperations.get(binary.type)))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withParserRanges(semantic, {
      operator: tokenLocation(binary.type, binary.left.loc?.end.offset ?? 0, binary.right.loc?.start.offset ?? source.length, filename, source)
    })))
  }

  if (node.kind == "call") {
    const call = /** @type {import("php-parser").Call} */ (node)

    if (call.what.kind == "name" && call.what.name == "count" && call.arguments.length == 1) {
      return withParserRanges({
        collection: convertExpression(call.arguments[0], filename, source, context),
        kind: /** @type {const} */ ("CollectionSizeExpression"),
        location
      }, {operator: nodeLocation(call.what, filename, source)})
    }

    if (call.what.kind != "name") {
      return unsupportedSyntax("php", "dynamic call", location)
    }
    const calledName = /** @type {import("php-parser").Name} */ (call.what)

    if (calledName.resolution != "uqn" || calledName.name.includes("\\")) {
      return unsupportedSyntax("php", "qualified call", nodeLocation(call.what, filename, source))
    }
    const unsupportedArgument = call.arguments.find((argument) =>
      argument.kind == "namedargument" || argument.kind == "variadic" || Reflect.get(argument, "byref") === true)

    if (unsupportedArgument) {
      const detail = unsupportedArgument.kind == "namedargument" ? "named argument" :
        unsupportedArgument.kind == "variadic" ? "unpacked argument" : "by-reference argument"

      return unsupportedSyntax("php", detail, nodeLocation(unsupportedArgument, filename, source))
    }

    const callee = calledName.name

    const signature = context.functions.get(callee)

    return withParserRanges({
      arguments: call.arguments.map((argument, index) =>
        convertExpression(argument, filename, source, context, signature?.parameters[index]?.type)),
      callee,
      kind: "CallExpression",
      location
    }, {callee: nodeLocation(call.what, filename, source)})
  }

  return unsupportedSyntax("php", node.kind, location)
}

/**
 * Resolves only result types established by explicit signatures and bindings.
 * @param {import("php-parser").Expression} node - Parser-owned expression.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | undefined} Known result type.
 */
function knownExpressionType(node, context) {
  if (node.kind == "variable") {
    const variable = /** @type {import("php-parser").Variable} */ (node)

    if (typeof variable.name == "string") return context.bindings.get(variable.name)
  }
  if (node.kind == "call") {
    const call = /** @type {import("php-parser").Call} */ (node)
    const name = call.what.kind == "name" && typeof call.what.name == "string" ? call.what.name : undefined

    if (name) return context.functions.get(name)?.returnType
  }
  if (node.kind == "offsetlookup") {
    const lookup = /** @type {import("php-parser").OffsetLookup} */ (node)
    const collectionType = knownExpressionType(lookup.what, context)

    if (collectionType?.kind == "ListType") return collectionType.elementType
    if (collectionType?.kind == "MapType") return collectionType.valueType
  }

  return undefined
}

/**
 * Converts one explicit PHP return.
 * @param {import("php-parser").Node} node - PHP node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.kind != "return") return unsupportedSyntax("php", node.kind, location)

  const returnNode = /** @type {import("php-parser").Return} */ (node)
  const expectedType = context.returnType?.kind == "TypeReference" && context.returnType.name == "void"
    ? undefined
    : /** @type {import("../semantic/types.js").SemanticValueType | undefined} */ (context.returnType)

  return {
    ...(returnNode.expr ? {expression: convertExpression(returnNode.expr, filename, source, context, expectedType)} : {}),
    kind: "ReturnStatement",
    location
  }
}

/**
 * Reads one exact PHP local `@var` carrier and immutability marker.
 * @param {import("php-parser").Node} node - Assignment-owning statement.
 * @param {string} name - Local name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{immutable: boolean, type: import("../semantic/types.js").SemanticValueType} | undefined} Metadata when present.
 */
function localMetadata(node, name, filename, source) {
  const comments = node.leadingComments ?? []
  const comment = comments.at(-1)

  if (!comment || comment.kind != "commentblock" || !comment.loc || !node.loc) return undefined

  const gap = source.slice(comment.loc.end.offset, node.loc.start.offset)

  if (!/^\s*$/u.test(gap) || (gap.match(/\n/gu)?.length ?? 0) > 1) return undefined

  const block = parseComment(comment.value)[0]
  const tags = block?.tags ?? []
  const variables = tags.filter((tag) => tag.tag == "var")
  const immutable = tags.filter((tag) => tag.tag == "semantifold-immutable")
  const location = nodeLocation(node, filename, source)

  if (variables.length == 0 && immutable.length == 0) return undefined

  const exactVariable = variables.length == 1 && variables[0].type == "" && variables[0].description == `$${name}`
  const exactImmutable = immutable.length <= 1 && immutable.every((tag) => tag.name == "" && tag.type == "" && tag.description == "")
  const knownTags = tags.every((tag) => tag.tag == "var" || tag.tag == "semantifold-immutable")

  if (!exactVariable || !exactImmutable || !knownTags) {
    return unsupportedSyntax("php", "malformed local type metadata", location)
  }

  return {
    immutable: immutable.length == 1,
    type: documentedValueType({
      language: "php",
      location: commentTagLocation(comment, variables[0], "name", filename, source),
      ownerLocation: location,
      source,
      sourceType: variables[0].name,
      subject: `Local '${name}'`
    })
  }
}

/**
 * Converts one PHP local declaration or assignment.
 * @param {import("php-parser").Node} node - PHP statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.kind != "expressionstatement") return unsupportedSyntax("php", node.kind, location)

  const expression = /** @type {import("php-parser").ExpressionStatement} */ (node).expression

  if (expression.kind != "assign") return unsupportedSyntax("php", expression.kind, nodeLocation(expression, filename, source))

  const assignment = /** @type {import("php-parser").Assign} */ (expression)

  if (assignment.operator != "=") return unsupportedSyntax("php", `assignment ${assignment.operator}`, location)
  if (assignment.left.kind != "variable") return unsupportedSyntax("php", assignment.left.kind, nodeLocation(assignment.left, filename, source))

  const variable = /** @type {import("php-parser").Variable} */ (assignment.left)
  const targetLocation = nodeLocation(variable, filename, source)

  if (typeof variable.name != "string" || variable.curly) return unsupportedSyntax("php", "dynamic variable", targetLocation)

  const metadata = localMetadata(node, variable.name, filename, source)

  if (metadata) {
    const initializer = convertExpression(assignment.right, filename, source, context, metadata.type)

    context.bindings.set(variable.name, metadata.type)
    return withParserRanges({
      initializer,
      kind: "LocalDeclaration",
      location,
      mutable: !metadata.immutable,
      name: variable.name,
      type: metadata.type
    }, {
      name: targetLocation,
      operator: tokenLocation("=", assignment.left.loc?.end.offset ?? 0, assignment.right.loc?.start.offset ?? source.length, filename, source)
    })
  }

  const bindingType = context.bindings.get(variable.name)

  if (!bindingType) return missingType("php", `Local '${variable.name}'`, location)

  const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name: variable.name}, {
    name: targetLocation
  })
  const value = convertExpression(assignment.right, filename, source, context, bindingType)

  return withParserRanges({
    expression: value,
    kind: "AssignmentStatement",
    location,
    target
  }, {
    operator: tokenLocation("=", assignment.left.loc?.end.offset ?? 0, assignment.right.loc?.start.offset ?? source.length, filename, source)
  })
}

/**
 * Converts one exhaustive PHP statement.
 * @param {import("php-parser").Node} node - PHP statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, filename, source, context) {
  if (node.kind == "return") return convertReturn(node, filename, source, context)
  if (node.kind == "if") return convertIf(/** @type {import("php-parser").If} */ (node), filename, source, context)
  if (node.kind == "foreach") return convertForEach(/** @type {import("php-parser").Foreach} */ (node), filename, source, context)
  if (node.kind == "break" || node.kind == "continue") {
    const control = /** @type {import("php-parser").Break | import("php-parser").Continue} */ (node)

    if (control.level) return unsupportedSyntax("php", `${node.kind} level`, nodeLocation(node, filename, source))
    const location = tokenLocation(node.kind, node.loc?.start.offset ?? 0, node.loc?.end.offset ?? source.length, filename, source)

    return withParserRanges({
      kind: /** @type {"BreakStatement" | "ContinueStatement"} */ (node.kind == "break" ? "BreakStatement" : "ContinueStatement"),
      location
    }, {keyword: location})
  }
  if (node.kind == "echo") return convertPrint(/** @type {import("php-parser").Echo} */ (node), filename, source, context)
  if (node.kind == "expressionstatement") {
    const expression = /** @type {import("php-parser").ExpressionStatement} */ (node).expression

    if (expression.kind == "call") {
      return {
        expression: /** @type {import("../semantic/types.js").CallExpression} */ (
          convertExpression(expression, filename, source, context)
        ),
        kind: "ExpressionStatement",
        location: nodeLocation(node, filename, source)
      }
    }

    return convertLocalStatement(node, filename, source, context)
  }

  return unsupportedSyntax("php", node.kind, nodeLocation(node, filename, source))
}

/**
 * Converts exact block-form PHP `foreach ($list as $value)`.
 * @param {import("php-parser").Foreach} node - PHP foreach node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").ForEachStatement} Semantic loop.
 */
function convertForEach(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.shortForm) return unsupportedSyntax("php", "alternative foreach syntax", location)
  if (node.key) return unsupportedSyntax("php", "foreach key binding", nodeLocation(node.key, filename, source))
  if (node.value.kind != "variable") return unsupportedSyntax("php", "foreach destructuring", nodeLocation(node.value, filename, source))
  const variable = /** @type {import("php-parser").Variable} */ (node.value)

  if (Reflect.get(variable, "byref") === true) return unsupportedSyntax("php", "by-reference foreach", nodeLocation(variable, filename, source))
  if (typeof variable.name != "string" || variable.curly) return unsupportedSyntax("php", "dynamic foreach binding", nodeLocation(variable, filename, source))
  if (!node.body || node.body.kind != "block") {
    return unsupportedSyntax("php", "foreach without block body", node.body ? nodeLocation(node.body, filename, source) : location)
  }
  const body = /** @type {import("php-parser").Block} */ (node.body)
  const collectionType = knownExpressionType(node.source, context)

  if (!collectionType || collectionType.kind != "ListType" && collectionType.kind != "MapType") {
    return missingType("php", "Iteration collection", nodeLocation(node.source, filename, source))
  }
  const bindingLocation = nodeLocation(variable, filename, source)
  const inferredType = collectionType.kind == "ListType" ? collectionType.elementType : collectionType.valueType
  const bindingType = iterationBindingType(inferredType, bindingLocation)
  const valueBinding = withParserRanges({
    kind: /** @type {const} */ ("ValueBinding"),
    location: bindingLocation,
    mutable: /** @type {const} */ (false),
    name: variable.name,
    type: bindingType
  }, {name: bindingLocation})
  const bodyContext = {...context, bindings: new Map(context.bindings)}

  bodyContext.bindings.set(variable.name, bindingType)
  return withParserRanges({
    body: convertBlock(body, filename, source, bodyContext),
    kind: /** @type {const} */ ("ForEachStatement"),
    list: convertExpression(node.source, filename, source, context),
    location,
    valueBinding
  }, {operator: tokenLocation("foreach", node.loc?.start.offset ?? 0, node.source.loc?.start.offset ?? source.length, filename, source)})
}

/**
 * Converts an ordered PHP block with its own adaptation scope.
 * @param {import("php-parser").Block} node - PHP parser block.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(node, filename, source, context) {
  return {
    kind: "Block",
    location: nodeLocation(node, filename, source),
    statements: node.children.map((statement) => convertStatement(statement, filename, source, context))
  }
}

/**
 * Requires an exact PHP scalar declaration type.
 * @param {import("php-parser").Node | null} sourceType - PHP type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, subject, location, filename, source) {
  if (!sourceType) return requireSourceScalarType("php", undefined, subject, location)
  if (sourceType.kind != "typereference" && sourceType.kind != "name" && sourceType.kind != "identifier") {
    return unsupportedSyntax("php", "unsupported scalar type", nodeLocation(sourceType, filename, source))
  }

  const typeName = /** @type {import("php-parser").TypeReference | import("php-parser").Name | import("php-parser").Identifier} */ (sourceType).name

  const typeLocation = nodeLocation(sourceType, filename, source)

  return requireSourceScalarType("php", typeName, subject, location, typeLocation)
}

/**
 * Reads the exact PHPDoc container signature attached to one function.
 * @param {import("php-parser").Function} node - Function declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{parameters: Map<string, {location: import("../semantic/types.js").SourceLocation, sourceType: string}>, returnType: {location: import("../semantic/types.js").SourceLocation, sourceType: string} | undefined}} Documented types.
 */
function functionDocumentedTypes(node, filename, source) {
  const comment = node.leadingComments?.at(-1)

  if (!comment || comment.kind != "commentblock" || !comment.loc || !node.loc ||
    !/^\s*$/u.test(source.slice(comment.loc.end.offset, node.loc.start.offset))) return {parameters: new Map(), returnType: undefined}
  const block = parseComment(comment.value)[0]
  const tags = block?.tags ?? []
  const parameterTags = tags.filter((tag) => tag.tag == "param")
  const returnTags = tags.filter((tag) => tag.tag == "return" || tag.tag == "returns")
  const malformed = tags.some((tag) => !["param", "return", "returns"].includes(tag.tag)) || returnTags.length > 1 ||
    parameterTags.some((tag) => tag.type != "" || !/^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(tag.description)) ||
    returnTags.some((tag) => tag.type != "" || tag.description != "")

  if (malformed) return unsupportedSyntax("php", "malformed function type annotation", nodeLocation(node, filename, source))
  const parameters = new Map(parameterTags.map((tag) => [tag.description.slice(1), {
    location: commentTagLocation(comment, tag, "name", filename, source),
    sourceType: tag.name
  }]))

  if (parameters.size != parameterTags.length) {
    return unsupportedSyntax("php", "duplicate parameter annotation", nodeLocation(node, filename, source))
  }
  const returnTag = returnTags[0]

  return {
    parameters,
    returnType: returnTag ? {
      location: commentTagLocation(comment, returnTag, "name", filename, source),
      sourceType: returnTag.name
    } : undefined
  }
}

/**
 * Returns a native PHP type name from one supported parser node.
 * @param {import("php-parser").Node | null} type - Native type node.
 * @returns {string | undefined} Type name.
 */
function phpTypeName(type) {
  if (!type || !["typereference", "name", "identifier"].includes(type.kind)) return undefined

  return /** @type {import("php-parser").TypeReference | import("php-parser").Name | import("php-parser").Identifier} */ (type).name
}

/**
 * Wraps one parser-declared canonical PHP nullable type.
 * @param {import("../semantic/types.js").SemanticValueType} valueType - Present-value semantic type.
 * @param {import("php-parser").Node} sourceType - Native parser type node.
 * @param {number} ownerStart - Earliest owning parser offset.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").OptionalType} Optional semantic type.
 */
function nullableType(valueType, sourceType, ownerStart, filename, source) {
  if (!sourceType.loc) throw new Error("PHP parser omitted nullable type location.")
  const valueLocation = nodeLocation(sourceType, filename, source)
  const marker = tokenLocation("?", ownerStart, sourceType.loc.start.offset, filename, source)

  if (marker.end.offset != valueLocation.start.offset) {
    return unsupportedSyntax("php", "noncanonical nullable type", marker)
  }

  return optionalType(
    valueType,
    locationFromOffsets(filename, source, marker.start.offset, valueLocation.end.offset),
    valueLocation
  )
}

/**
 * Converts one explicit PHP function return type.
 * @param {import("php-parser").Node | null} sourceType - PHP return type node.
 * @param {string} subject - Typed function return.
 * @param {import("../semantic/types.js").SourceLocation} location - Function location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertReturnType(sourceType, subject, location, filename, source) {
  if (!sourceType) return requireSourceReturnType("php", undefined, subject, location)
  if (sourceType.kind != "typereference" && sourceType.kind != "name" && sourceType.kind != "identifier") {
    return unsupportedSyntax("php", "unsupported return type", nodeLocation(sourceType, filename, source))
  }
  const typeName = /** @type {import("php-parser").TypeReference | import("php-parser").Name | import("php-parser").Identifier} */ (sourceType).name

  return requireSourceReturnType("php", typeName, subject, location, nodeLocation(sourceType, filename, source))
}

/**
 * Converts the explicit type signature of one PHP function before any body expressions.
 * @param {import("php-parser").Function} node - PHP function node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {PhpFunctionSignature} Typed function signature.
 */
function convertFunctionSignature(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const name = typeof node.name == "string" ? node.name : node.name.name

  if (!node.body) {
    return unsupportedSyntax("php", "function body", location)
  }

  const documented = functionDocumentedTypes(node, filename, source)
  const parameters = node.arguments.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)
    const parameterName = typeof parameter.name == "string" ? parameter.name : parameter.name.name

    if (parameter.byref) return unsupportedSyntax("php", "by-reference parameter", parameterLocation)
    if (parameter.variadic) return unsupportedSyntax("php", "variadic parameter", parameterLocation)
    if (parameter.value) return unsupportedSyntax("php", "default parameter", parameterLocation)
    const parameterNode = typeof parameter.name == "string" ? parameter : parameter.name
    const documentedType = documented.parameters.get(parameterName)
    const nativeType = phpTypeName(parameter.type)

    if (nativeType == "array" && !documentedType) return missingType("php", `Parameter '${parameterName}'`, parameterLocation)
    if (nativeType != "array" && documentedType) {
      return unsupportedSyntax("php", "container annotation on non-array parameter", documentedType.location)
    }
    let parameterType = documentedType
      ? documentedValueType({language: "php", location: documentedType.location, ownerLocation: parameterLocation, source,
        sourceType: documentedType.sourceType, subject: `Parameter '${parameterName}'`})
      : convertType(parameter.type, `Parameter '${parameterName}'`, parameterLocation, filename, source)

    if (parameter.nullable && parameterType.kind != "OptionalType") {
      if (!parameter.type) return missingType("php", `Parameter '${parameterName}'`, parameterLocation)
      parameterType = nullableType(parameterType, parameter.type, parameter.loc?.start.offset ?? 0, filename, source)
    } else if (!parameter.nullable && parameterType.kind == "OptionalType") {
      return unsupportedSyntax("php", "optional annotation without nullable native type", documentedType?.location ?? parameterLocation)
    }
    const semanticParameter = {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: parameterType
    }

    return withParserRanges(semanticParameter, {name: nodeLocation(parameterNode, filename, source)})
  })
  const extraDocumentedParameter = [...documented.parameters.keys()].find((name) =>
    !node.arguments.some((parameter) => (typeof parameter.name == "string" ? parameter.name : parameter.name.name) == name))

  if (extraDocumentedParameter) return unsupportedSyntax("php", `annotation for unknown parameter '${extraDocumentedParameter}'`, location)
  if (node.byref) return unsupportedSyntax("php", "by-reference return", location)
  const nameNode = typeof node.name == "string" ? node : node.name
  const nativeReturnType = phpTypeName(node.type)
  let returnType

  if (nativeReturnType == "array") {
    if (!documented.returnType) return missingType("php", `Function '${name}' return`, location)
    returnType = documentedValueType({language: "php", location: documented.returnType.location, ownerLocation: location, source,
      sourceType: documented.returnType.sourceType, subject: `Function '${name}' return`})
  } else {
    if (documented.returnType) return unsupportedSyntax("php", "container annotation on non-array return", documented.returnType.location)
    returnType = convertReturnType(node.type, `Function '${name}' return`, location, filename, source)
  }
  if (node.nullable && returnType.kind != "OptionalType") {
    if (!node.type) return missingType("php", `Function '${name}' return`, location)
    const typeStart = node.type.loc?.start.offset ?? 0

    returnType = nullableType(
      /** @type {import("../semantic/types.js").SemanticValueType} */ (returnType),
      node.type,
      Math.max(node.loc?.start.offset ?? 0, typeStart - 2),
      filename,
      source
    )
  } else if (!node.nullable && returnType.kind == "OptionalType") {
    return unsupportedSyntax("php", "optional annotation without nullable native return type", documented.returnType?.location ?? location)
  }

  return {
    location,
    name,
    nameLocation: nodeLocation(nameNode, filename, source),
    parameters,
    returnType
  }
}

/**
 * Converts a PHP function body using the already-proved module signatures.
 * @param {import("php-parser").Function} node - PHP function node.
 * @param {PhpFunctionSignature} signature - Preconverted explicit signature.
 * @param {Map<string, PhpFunctionSignature>} functions - Module function signatures.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, filename, source) {
  if (!node.body) return unsupportedSyntax("php", "function body", signature.location)
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    functions,
    returnType: signature.returnType
  }

  return withParserRanges({
    body: convertBlock(node.body, filename, source, context),
    kind: "FunctionDeclaration",
    location: signature.location,
    name: signature.name,
    parameters: signature.parameters,
    returnType: signature.returnType
  }, {name: signature.nameLocation})
}

/**
 * Converts the existing PHP if/else terminal with restricted branch prefixes.
 * @param {import("php-parser").If} node - PHP if node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.shortForm) return unsupportedSyntax("php", "alternative if syntax", location)
  if (node.body.kind != "block") return unsupportedSyntax("php", "if without block consequent", location)
  if (node.test.kind == "variable") {
    const tested = /** @type {import("php-parser").Variable} */ (node.test)

    if (typeof tested.name == "string" && context.bindings.get(tested.name)?.kind == "OptionalType") {
      return unsupportedSyntax("php", "optional truthiness condition", nodeLocation(tested, filename, source))
    }
  }

  const condition = convertExpression(node.test, filename, source, context)
  const consequentContext = {...context, bindings: new Map(context.bindings)}
  const alternateContext = {...context, bindings: new Map(context.bindings)}
  let alternate

  if (node.alternate) {
    if (node.alternate.kind == "block") {
      alternate = convertBlock(/** @type {import("php-parser").Block} */ (node.alternate), filename, source, alternateContext)
    } else if (node.alternate.kind == "if") {
      const nested = /** @type {import("php-parser").If} */ (node.alternate)

      alternate = {
        kind: /** @type {const} */ ("Block"),
        location: nodeLocation(nested, filename, source),
        statements: [convertIf(nested, filename, source, alternateContext)]
      }
    } else return unsupportedSyntax("php", `if alternate ${node.alternate.kind}`, nodeLocation(node.alternate, filename, source))
  }

  return {
    ...(alternate ? {alternate} : {}),
    condition,
    consequent: convertBlock(node.body, filename, source, consequentContext),
    kind: "IfStatement",
    location
  }
}

/**
 * Converts a PHP echo entry point.
 * @param {import("php-parser").Echo} node - PHP echo node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {PhpConversionContext} context - Typed conversion context.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (node.expressions.length != 2 || node.expressions[1].kind != "name" ||
    /** @type {import("php-parser").Name} */ (node.expressions[1]).name != "PHP_EOL") {
    return unsupportedSyntax("php", "echo without one expression and PHP_EOL", location)
  }

  return {expression: convertExpression(node.expressions[0], filename, source, context), kind: "PrintStatement", location}
}

/**
 * Parses PHP into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parsePhp({filename, source}) {
  const program = parsePhpProgram(filename, source)
  validateDeclareNodes(program.children, filename, source)
  const functionNodes = /** @type {import("php-parser").Function[]} */ (program.children.filter((node) => node.kind == "function"))
  const signatures = functionNodes.map((node) => convertFunctionSignature(node, filename, source))
  const functionSignatures = new Map(signatures.map((signature) => [signature.name, signature]))
  const functions = functionNodes.map((node, index) =>
    convertFunction(node, signatures[index], functionSignatures, filename, source))
  const executableNodes = program.children.filter((node) => node.kind != "function" && node.kind != "declare" && node.kind != "noop")
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax("php", "module without a function", location)
  const first = executableNodes[0]
  const last = executableNodes.at(-1) ?? first
  const entryLocation = first
    ? locationFromOffsets(filename, source, first.loc?.start.offset ?? 0, last?.loc?.end.offset ?? source.length)
    : location
  const entryContext = {
    bindings: new Map(),
    functions: functionSignatures,
    returnType: undefined
  }
  const entryBlock = {
    kind: /** @type {const} */ ("Block"),
    location: entryLocation,
    statements: executableNodes.map((node) => convertStatement(node, filename, source, entryContext))
  }

  return {
    entryPoint: {
      body: entryBlock,
      kind: "EntryPoint",
      location: entryLocation
    },
    functions,
    kind: "Module",
    location
  }
}

/**
 * Accepts only an optional single `declare(strict_types=1)` directive.
 * @param {import("php-parser").Node[]} nodes - Top-level PHP nodes.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {void}
 */
function validateDeclareNodes(nodes, filename, source) {
  const declarations = nodes.filter((node) => node.kind == "declare")

  if (declarations.length > 1) {
    unsupportedSyntax("php", "multiple declare directives", nodeLocation(declarations[1], filename, source))
  }

  for (const declarationNode of declarations) {
    const declaration = /** @type {import("php-parser").Declare} */ (declarationNode)
    const directive = declaration.directives[0]
    const key = directive?.key
    const value = directive?.value
    const numericValue = value && typeof value == "object" && value.kind == "number"
      ? /** @type {import("php-parser").Number} */ (value)
      : undefined
    const valueIsOne = numericValue?.loc && source.slice(numericValue.loc.start.offset, numericValue.loc.end.offset) == "1"
    const valid = declaration.mode == "none" && declaration.children.length == 0 && declaration.directives.length == 1 &&
      key.kind == "identifier" && key.name == "strict_types" && valueIsOne

    if (!valid) unsupportedSyntax("php", "declare other than strict_types=1", nodeLocation(declaration, filename, source))
  }
}

/**
 * Invokes php-parser and normalizes syntax failures.
 * @param {string} filename - Source filename.
 * @param {string} source - Source text.
 * @returns {import("php-parser").Program} PHP program.
 */
function parsePhpProgram(filename, source) {
  try {
    return parser.parseCode(source, filename)
  } catch (error) {
    return parseFailure("php", error)
  }
}
