// @ts-check

import {parse as parseBabel} from "@babel/parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceReturnType, requireSourceScalarType} from "./scalars.js"
import {documentedValueType, listType, mapType} from "./types.js"

/** @typedef {NonNullable<import("@babel/parser").ParseResult<import("@babel/types").File>["tokens"]>[number]} BabelToken */
/** @typedef {{byStart: Map<number, BabelToken>, tokens: BabelToken[]}} BabelTokenIndex */

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
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "TSNonNullExpression") {
    const expression = convertExpression(node.expression, language, filename, source)

    if (language != "typescript" || expression.kind != "MapLookupExpression") {
      return unsupportedSyntax(language, "non-null assertion other than Map.get result", location)
    }
    expression.location = location
    return expression
  }

  if (node.type == "Identifier") {
    return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: node.name}, {
      name: identifierLocation(node, filename, source)
    })
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
    const elements = node.elements.map((element, index) => {
      if (!element) return unsupportedSyntax(language, "sparse array hole", arrayHoleLocation(node, index, filename, source))
      if (element.type == "SpreadElement") return unsupportedSyntax(language, "array spread", nodeLocation(element, filename, source))

      return convertExpression(element, language, filename, source)
    })

    return withParserRanges({elements, kind: /** @type {const} */ ("ListLiteral"), location}, {literal: location})
  }

  if (node.type == "NewExpression" && node.callee.type == "Identifier" && node.callee.name == "Map") {
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
        convertExpression(key, language, filename, source)
      )

      return withParserRanges({
        key: keyExpression,
        kind: /** @type {const} */ ("MapEntry"),
        location: nodeLocation(element, filename, source),
        value: convertExpression(value, language, filename, source)
      }, {
        key: keyExpression.location,
        operator: tokenLocation(element, ",", key.end ?? element.start ?? 0, value.start ?? element.end ?? source.length, filename, source)
      })
    })

    return withParserRanges({entries, kind: /** @type {const} */ ("MapLiteral"), location}, {literal: location})
  }

  if (node.type == "MemberExpression" && !node.optional && node.object.type != "Super") {
    if (node.computed) {
      if (node.property.type == "PrivateName") return unsupportedSyntax(language, node.property.type, location)

      return withParserRanges({
        collection: convertExpression(node.object, language, filename, source),
        index: convertExpression(node.property, language, filename, source),
        kind: /** @type {const} */ ("ListIndexExpression"),
        location,
        totality: /** @type {const} */ ("proven")
      }, {
        operator: tokenLocation(node, "[", node.object.end ?? node.start ?? 0, node.property.start ?? node.end ?? source.length, filename, source)
      })
    }
    if (node.property.type == "Identifier" && ["length", "size"].includes(node.property.name)) {
      return withParserRanges({
        collection: convertExpression(node.object, language, filename, source),
        collectionKind: /** @type {"list" | "map"} */ (node.property.name == "length" ? "list" : "map"),
        kind: /** @type {const} */ ("CollectionSizeExpression"),
        location
      }, {operator: identifierLocation(node.property, filename, source)})
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
    const operand = convertExpression(node.argument, language, filename, source)
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
      left: convertExpression(node.left, language, filename, source),
      location,
      right: convertExpression(node.right, language, filename, source)
    }, {
      operator: tokenLocation(node, node.operator, node.left.end ?? node.start ?? 0, node.right.start ?? node.end ?? source.length, filename, source)
    }), node.operator == "&&" ? "And" : "Or")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.type == "BinaryExpression" && babelBinaryOperations.has(node.operator)) {
    if (node.left.type == "PrivateName") unsupportedSyntax(language, node.left.type, location)

    const left = convertExpression(node.left, language, filename, source)
    const right = convertExpression(node.right, language, filename, source)

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
    const arguments_ = node.arguments.map((argument) => {
      if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
        return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
      }

      return convertExpression(argument, language, filename, source)
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
      collection: convertExpression(node.callee.object, language, filename, source),
      key: convertExpression(key, language, filename, source),
      kind: /** @type {const} */ ("MapLookupExpression"),
      location,
      totality: /** @type {const} */ ("proven")
    }, {operator: identifierLocation(node.callee.property, filename, source)})
  }

  return unsupportedSyntax(language, node.type, location)
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
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "ReturnStatement") return unsupportedSyntax(language, node.type, location)

  return {
    ...(node.argument ? {expression: convertExpression(node.argument, language, filename, source)} : {}),
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
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, language, filename, source) {
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
      ? convertTypeScriptType(declarator.id.typeAnnotation, `Local '${declarator.id.name}'`, declaratorLocation, filename, source)
      : localJavaScriptType(node, declarator.id.name, filename, source)

    return withParserRanges({
      initializer: convertExpression(declarator.init, language, filename, source),
      kind: "LocalDeclaration",
      location,
      mutable: node.kind == "let",
      name: declarator.id.name,
      type
    }, {
      name: identifierLocation(declarator.id, filename, source),
      operator: tokenLocation(declarator, "=", declarator.id.end ?? declarator.start ?? 0, declarator.init.start ?? declarator.end ?? source.length, filename, source)
    })
  }

  if (node.type == "ExpressionStatement" && node.expression.type == "AssignmentExpression") {
    const assignment = node.expression
    const targetLocation = nodeLocation(assignment.left, filename, source)

    if (assignment.operator != "=") return unsupportedSyntax(language, `assignment ${assignment.operator}`, location)
    if (assignment.left.type != "Identifier") return unsupportedSyntax(language, assignment.left.type, targetLocation)

    const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name: assignment.left.name}, {
      name: identifierLocation(assignment.left, filename, source)
    })

    return withParserRanges({
      expression: convertExpression(assignment.right, language, filename, source),
      kind: "AssignmentStatement",
      location,
      target
    }, {
      operator: tokenLocation(assignment, "=", assignment.left.end ?? assignment.start ?? 0, assignment.right.start ?? assignment.end ?? source.length, filename, source)
    })
  }

  return unsupportedSyntax(language, node.type, location)
}

/**
 * Reads an immediately associated JavaScript local `@type` tag.
 * @param {import("@babel/types").VariableDeclaration} node - Local declaration.
 * @param {string} name - Local name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function localJavaScriptType(node, name, filename, source) {
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
    tag ? commentTagLocation(comment, tag, "type", filename, source) : location
  )
}

/**
 * Converts one exhaustive Babel statement.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, language, filename, source, canonicalZeroRequired) {
  if (node.type == "ReturnStatement") return convertReturn(node, language, filename, source)
  if (node.type == "IfStatement") return convertIf(node, language, filename, source, canonicalZeroRequired)
  if (node.type == "VariableDeclaration" || node.type == "ExpressionStatement" && node.expression.type == "AssignmentExpression") {
    return convertLocalStatement(node, language, filename, source)
  }
  if (node.type == "ExpressionStatement") {
    if (node.expression.type == "CallExpression" && node.expression.callee.type == "Identifier") {
      return {
        expression: /** @type {import("../semantic/types.js").CallExpression} */ (
          convertExpression(node.expression, language, filename, source)
        ),
        kind: "ExpressionStatement",
        location: nodeLocation(node, filename, source)
      }
    }

    return convertPrint(node, language, filename, source, canonicalZeroRequired)
  }

  return unsupportedSyntax(language, node.type, nodeLocation(node, filename, source))
}

/**
 * Converts one Babel block or normalized single-statement body.
 * @param {import("@babel/types").BlockStatement | import("@babel/types").Statement[]} input - Parser block or statements.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @param {import("../semantic/types.js").SourceLocation} [location] - Location for a statement-array block.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(input, language, filename, source, canonicalZeroRequired, location) {
  const statements = Array.isArray(input) ? input : input.body
  const directives = Array.isArray(input) ? [] : input.directives
  const blockLocation = location ?? nodeLocation(/** @type {import("@babel/types").BlockStatement} */ (input), filename, source)

  if (directives.length > 0) {
    return unsupportedSyntax(language, "directive", nodeLocation(directives[0], filename, source))
  }

  return {
    kind: "Block",
    location: blockLocation,
    statements: statements.map((statement) => convertStatement(statement, language, filename, source, canonicalZeroRequired))
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
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, language, subject, location, source, typeLocation = location) {
  if (language != "javascript") return requireSourceScalarType(language, sourceType, subject, location, typeLocation)

  return documentedValueType({language, location: typeLocation, ownerLocation: location, source, sourceType, subject})
}

/**
 * Converts one exact JavaScript function return annotation.
 * @param {string | undefined} sourceType - JSDoc type spelling.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed function return.
 * @param {import("../semantic/types.js").SourceLocation} location - Function location.
 * @param {string} source - Complete parser input.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact annotation location.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertReturnType(sourceType, language, subject, location, source, typeLocation = location) {
  if (sourceType == "void") return requireSourceReturnType(language, sourceType, subject, location, typeLocation)

  return convertType(sourceType, language, subject, location, source, typeLocation)
}

/**
 * Converts one exact TypeScript scalar keyword annotation.
 * @param {import("@babel/types").TypeAnnotation | import("@babel/types").TSTypeAnnotation | import("@babel/types").Noop | null | undefined} annotation - Type annotation.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertTypeScriptType(annotation, subject, ownerLocation, filename, source) {
  if (!annotation) return missingType("typescript", subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported scalar type", nodeLocation(annotation, filename, source))
  }

  return convertTypeScriptValueTypeNode(annotation.typeAnnotation, subject, ownerLocation, filename, source)
}

/**
 * Converts one bounded recursive TypeScript value-type tree.
 * @param {import("@babel/types").TSType} typeNode - Parser-owned type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic value type.
 */
function convertTypeScriptValueTypeNode(typeNode, subject, ownerLocation, filename, source) {
  const sourceType = typeNode.type == "TSNumberKeyword" ? "number" :
    typeNode.type == "TSBooleanKeyword" ? "boolean" : typeNode.type == "TSStringKeyword" ? "string" : undefined

  if (sourceType) {
    return requireSourceScalarType("typescript", sourceType, subject, ownerLocation, nodeLocation(typeNode, filename, source))
  }
  if (typeNode.type == "TSTypeOperator" && typeNode.operator == "readonly" && typeNode.typeAnnotation.type == "TSArrayType") {
    const elementNode = typeNode.typeAnnotation.elementType

    return listType(
      convertTypeScriptValueTypeNode(elementNode, subject, ownerLocation, filename, source),
      nodeLocation(typeNode, filename, source),
      nodeLocation(elementNode, filename, source)
    )
  }
  if (typeNode.type == "TSTypeReference" && typeNode.typeName.type == "Identifier" &&
    ["ReadonlyArray", "ReadonlyMap"].includes(typeNode.typeName.name)) {
    const parameters = typeNode.typeParameters?.params ?? []

    if (typeNode.typeName.name == "ReadonlyArray" && parameters.length == 1) {
      return listType(
        convertTypeScriptValueTypeNode(parameters[0], subject, ownerLocation, filename, source),
        nodeLocation(typeNode, filename, source),
        nodeLocation(parameters[0], filename, source)
      )
    }
    if (typeNode.typeName.name == "ReadonlyMap" && parameters.length == 2) {
      const keyType = convertTypeScriptValueTypeNode(parameters[0], subject, ownerLocation, filename, source)

      if (keyType.kind != "TypeReference") {
        return unsupportedSyntax("typescript", "map key type other than string", nodeLocation(parameters[0], filename, source))
      }
      return mapType(
        keyType,
        convertTypeScriptValueTypeNode(parameters[1], subject, ownerLocation, filename, source),
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
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertTypeScriptReturnType(annotation, subject, ownerLocation, filename, source) {
  if (!annotation) return requireSourceReturnType("typescript", undefined, subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported return type", nodeLocation(annotation, filename, source))
  }
  const typeNode = annotation.typeAnnotation

  if (typeNode.type == "TSVoidKeyword") {
    return requireSourceReturnType("typescript", "void", subject, ownerLocation, nodeLocation(typeNode, filename, source))
  }

  return convertTypeScriptValueTypeNode(typeNode, subject, ownerLocation, filename, source)
}

/**
 * Converts a supported function declaration.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, language, filename, source, canonicalZeroRequired) {
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
      ? convertType(documentedType?.sourceType, language, `Parameter '${parameter.name}'`, parameterLocation, source, documentedType?.location)
      : convertTypeScriptType(parameter.typeAnnotation, `Parameter '${parameter.name}'`, parameterLocation, filename, source)

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
    ? convertReturnType(documentedTypes?.returnType?.sourceType, language, `Function '${node.id.name}' return`, location, source, documentedTypes?.returnType?.location)
    : convertTypeScriptReturnType(returnAnnotation, `Function '${node.id.name}' return`, location, filename, source)
  const body = convertBlock(node.body, language, filename, source, canonicalZeroRequired)

  return withParserRanges({
    body,
    kind: "FunctionDeclaration",
    location,
    name: node.id.name,
    parameters,
    returnType
  }, {name: identifierLocation(node.id, filename, source)})
}

/**
 * Converts the existing exact if/else terminal shape.
 * @param {import("@babel/types").IfStatement} node - Babel if statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} canonicalZeroRequired - Whether generated scalar output may contain signed zero.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, language, filename, source, canonicalZeroRequired) {
  const location = nodeLocation(node, filename, source)
  const consequent = node.consequent.type == "BlockStatement"
    ? convertBlock(node.consequent, language, filename, source, canonicalZeroRequired)
    : convertBlock([node.consequent], language, filename, source, canonicalZeroRequired, nodeLocation(node.consequent, filename, source))
  const alternate = node.alternate
    ? node.alternate.type == "BlockStatement"
      ? convertBlock(node.alternate, language, filename, source, canonicalZeroRequired)
      : convertBlock([node.alternate], language, filename, source, canonicalZeroRequired, nodeLocation(node.alternate, filename, source))
    : undefined

  return {
    ...(alternate ? {alternate} : {}),
    condition: convertExpression(node.test, language, filename, source),
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
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, language, filename, source, canonicalZeroRequired) {
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

  return {expression: convertExpression(argument, language, filename, source), kind: "PrintStatement", location}
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
  if (file.program.directives.length > 0) {
    return unsupportedSyntax(language, "top-level directive", nodeLocation(file.program.directives[0], filename, source))
  }
  const functions = file.program.body.filter((node) => node.type == "FunctionDeclaration")
    .map((node) => convertFunction(node, language, filename, source, canonicalZeroRequired))
  const entryNodes = file.program.body.filter((node) => node.type != "FunctionDeclaration")
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax(language, "module without a function", location)
  const entryLocation = entryNodes.length == 0 ? location : locationFromOffsets(
    filename,
    source,
    entryNodes[0].start ?? 0,
    entryNodes.at(-1)?.end ?? source.length
  )
  const entryBlock = convertBlock(entryNodes, language, filename, source, canonicalZeroRequired, entryLocation)

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
      plugins: language == "typescript" ? ["typescript"] : [],
      sourceFilename: filename,
      sourceType: "script",
      tokens: true
    })
  } catch (error) {
    return parseFailure(language, error)
  }
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
