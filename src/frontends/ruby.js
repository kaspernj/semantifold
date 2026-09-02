// @ts-check

import {
  CallNode,
  DefNode,
  ElseNode,
  FalseNode,
  IfNode,
  IntegerNode,
  InterpolatedStringNode,
  LocalVariableReadNode,
  ParenthesesNode,
  ProgramNode,
  RequiredParameterNode,
  ReturnNode,
  StatementsNode,
  StringNode,
  TrueNode,
  loadPrism
} from "@ruby/prism"
import {SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceScalarType} from "./scalars.js"
const parsePrism = await loadPrism()

/**
 * Returns a normalized Prism node location.
 * @param {{location: import("@ruby/prism").Location}} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Source location.
 */
function nodeLocation(node, filename, source) {
  return locationFromOffsets(
    filename,
    source,
    utf8ByteOffsetToUtf16Offset(source, node.location.startOffset),
    utf8ByteOffsetToUtf16Offset(source, node.location.startOffset + node.location.length)
  )
}

/**
 * Converts a supported Prism expression.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node instanceof ParenthesesNode && node.body instanceof StatementsNode && node.body.body.length == 1) {
    return convertExpression(node.body.body[0], filename, source)
  }

  if (node instanceof LocalVariableReadNode) {
    return {kind: "IdentifierExpression", location, name: node.name}
  }

  if (node instanceof IntegerNode) {
    if (!Number.isSafeInteger(node.value)) return unsupportedSyntax("ruby", "non-safe integer literal", location)

    return {kind: "IntegerLiteral", location, value: node.value}
  }

  if (node instanceof TrueNode || node instanceof FalseNode) {
    return {kind: "BooleanLiteral", location, value: node instanceof TrueNode}
  }

  if (node instanceof StringNode) {
    const decoded = node.unescaped

    if (!decoded.validEncoding || decoded.encoding != "utf-8" || node.isForcedBinaryEncoding() ||
      !hasOnlyUnicodeScalars(decoded.value)) {
      return unsupportedSyntax("ruby", "invalid Unicode string literal", location)
    }

    return {kind: "StringLiteral", location, value: decoded.value}
  }

  if (node instanceof InterpolatedStringNode) return unsupportedSyntax("ruby", "interpolated string", location)

  if (node instanceof CallNode && node.receiver && [">", "-", "+"].includes(node.name) && node.arguments_?.arguments_.length == 1) {
    return {
      kind: "BinaryExpression",
      left: convertExpression(node.receiver, filename, source),
      location,
      operator: /** @type {">" | "-" | "+"} */ (node.name),
      right: convertExpression(node.arguments_.arguments_[0], filename, source)
    }
  }

  if (node instanceof CallNode && !node.receiver) {
    return {
      arguments: (node.arguments_?.arguments_ ?? []).map((argument) => convertExpression(argument, filename, source)),
      callee: node.name,
      kind: "CallExpression",
      location
    }
  }

  return unsupportedSyntax("ruby", node.constructor.name, location)
}

/**
 * Converts Prism statements containing only returns.
 * @param {StatementsNode} statements - Prism statements.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement[]} Semantic returns.
 */
function convertReturnStatements(statements, filename, source) {
  return statements.body.map((node) => {
    const location = nodeLocation(node, filename, source)

    if (!(node instanceof ReturnNode) || node.arguments_?.arguments_.length != 1) {
      return unsupportedSyntax("ruby", node.constructor.name, location)
    }

    return {
      expression: convertExpression(node.arguments_.arguments_[0], filename, source),
      kind: /** @type {const} */ ("ReturnStatement"),
      location
    }
  })
}

/**
 * Reads Prism-owned RBS-style type comments directly preceding a definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {DefNode} node - Ruby definition.
 * @param {string} source - Complete source.
 * @returns {{parameters: Map<string, string>, returnType: string | undefined}} Declared types.
 */
function typeComments(comments, node, source) {
  const preceding = associatedComments(comments, node, source)
  const parameterTypes = new Map()
  /** @type {string | undefined} */
  let returnType

  for (const comment of preceding) {
    const text = source.slice(comment.location.startOffset, comment.location.startOffset + comment.location.length)
    const words = text.slice(1).trim().split(/\s+/u)

    if (words[0] == "@param" && words.length == 3) parameterTypes.set(words[1], words[2])
    if (words[0] == "@return" && words.length == 2) returnType = words[1]
  }

  return {parameters: parameterTypes, returnType}
}

/**
 * Selects only the contiguous comment block immediately before a definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {DefNode} node - Ruby definition.
 * @param {string} source - Complete source.
 * @returns {import("@ruby/prism/src/deserialize.js").Comment[]} Associated comments.
 */
function associatedComments(comments, node, source) {
  const preceding = comments.filter((comment) => comment.location.startOffset < node.location.startOffset)
    .sort((left, right) => left.location.startOffset - right.location.startOffset)
  const associated = []
  let boundary = node.location.startOffset

  for (let index = preceding.length - 1; index >= 0; index--) {
    const comment = preceding[index]
    const endOffset = comment.location.startOffset + comment.location.length
    const gap = source.slice(endOffset, boundary)

    if (!isImmediateCommentGap(gap)) break

    associated.unshift(comment)
    boundary = comment.location.startOffset
  }

  return associated
}

/**
 * Checks that a comment and its owner are separated by at most one newline.
 * @param {string} gap - Source between the comment and following item.
 * @returns {boolean} Whether the gap is immediate whitespace.
 */
function isImmediateCommentGap(gap) {
  let newlines = 0

  for (const character of gap) {
    if (character == "\n") {
      newlines++
    } else if (character != " " && character != "\t" && character != "\r") {
      return false
    }
  }

  return newlines <= 1
}

/**
 * Requires an exact supported Ruby scalar spelling.
 * @param {string | undefined} sourceType - Ruby type comment value.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, subject, location) {
  return requireSourceScalarType("ruby", sourceType, subject, location)
}

/**
 * Converts a Ruby definition.
 * @param {DefNode} node - Prism definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, comments, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node.body instanceof StatementsNode) || node.body.body.length != 1 || !(node.body.body[0] instanceof IfNode)) {
    return unsupportedSyntax("ruby", "function body", location)
  }

  if (!node.parameters || node.parameters.optionals.length > 0 || node.parameters.rest || node.parameters.posts.length > 0 ||
    node.parameters.keywords.length > 0 || node.parameters.keywordRest || node.parameters.block ||
    node.parameters.requireds.some((parameter) => !(parameter instanceof RequiredParameterNode))) {
    return unsupportedSyntax("ruby", "parameters", location)
  }

  const declaredTypes = typeComments(comments, node, source)
  const parameters = node.parameters.requireds.map((parameter) => {
    if (!(parameter instanceof RequiredParameterNode)) return unsupportedSyntax("ruby", parameter.constructor.name, location)

    const parameterLocation = nodeLocation(parameter, filename, source)

    return {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameter.name,
      type: convertType(declaredTypes.parameters.get(parameter.name), `Parameter '${parameter.name}'`, parameterLocation)
    }
  })
  const ifNode = node.body.body[0]
  const ifLocation = nodeLocation(ifNode, filename, source)

  if (!ifNode.statements || !(ifNode.subsequent instanceof ElseNode) || !ifNode.subsequent.statements) {
    return unsupportedSyntax("ruby", "if without else", ifLocation)
  }

  return {
    body: [{
      alternate: convertReturnStatements(ifNode.subsequent.statements, filename, source),
      condition: convertExpression(ifNode.predicate, filename, source),
      consequent: convertReturnStatements(ifNode.statements, filename, source),
      kind: "IfStatement",
      location: ifLocation
    }],
    kind: "FunctionDeclaration",
    location,
    name: node.name,
    parameters,
    returnType: convertType(declaredTypes.returnType, `Function '${node.name}' return`, location)
  }
}

/**
 * Converts the supported Ruby puts entry point.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node instanceof CallNode) || node.receiver || node.name != "puts" || node.arguments_?.arguments_.length != 1) {
    return unsupportedSyntax("ruby", node.constructor.name, location)
  }

  return {expression: convertExpression(node.arguments_.arguments_[0], filename, source), kind: "PrintStatement", location}
}

/**
 * Parses Ruby into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseRuby({filename, source}) {
  const result = parsePrism(source, {filepath: filename})

  if (result.errors.length > 0) {
    const error = result.errors[0]
    const location = locationFromOffsets(filename, source, error.location.startOffset, error.location.startOffset + error.location.length)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "ruby", location, message: error.message})
  }

  if (!(result.value instanceof ProgramNode)) throw new Error("Prism returned a non-program root.")

  const body = result.value.statements.body
  const functions = body.filter((node) => node instanceof DefNode)
    .map((node) => convertFunction(node, result.comments, filename, source))
  const entryStatements = body.filter((node) => !(node instanceof DefNode))
    .map((node) => convertPrint(node, filename, source))
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax("ruby", "module without a function", location)
  if (entryStatements.length == 0) return unsupportedSyntax("ruby", "module without an entry point", location)

  return {
    entryPoint: {body: entryStatements, kind: "EntryPoint", location: entryStatements[0].location},
    functions,
    kind: "Module",
    location
  }
}
