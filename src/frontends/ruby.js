// @ts-check

import {
  AndNode,
  CallNode,
  DefNode,
  ElseNode,
  FalseNode,
  IfNode,
  IntegerNode,
  InterpolatedStringNode,
  LocalVariableReadNode,
  LocalVariableWriteNode,
  OrNode,
  ParenthesesNode,
  ProgramNode,
  RequiredParameterNode,
  ReturnNode,
  StatementsNode,
  StringNode,
  TrueNode,
  loadPrism
} from "@ruby/prism"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceScalarType} from "./scalars.js"
const parsePrism = await loadPrism()
const rubyBinaryOperations = new Map([
  ["+", "Add"],
  ["-", "Subtract"],
  ["*", "Multiply"],
  ["==", "Equal"],
  ["!=", "NotEqual"],
  ["<", "LessThan"],
  ["<=", "LessThanOrEqual"],
  [">", "GreaterThan"],
  [">=", "GreaterThanOrEqual"]
])

/**
 * Returns a normalized Prism node location.
 * @param {{location: import("@ruby/prism").Location}} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Source location.
 */
function nodeLocation(node, filename, source) {
  return prismLocation(node.location, filename, source)
}

/**
 * Converts a Prism location into a normalized source location.
 * @param {import("@ruby/prism").Location} location - Prism location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Source location.
 */
function prismLocation(location, filename, source) {
  return locationFromOffsets(
    filename,
    source,
    utf8ByteOffsetToUtf16Offset(source, location.startOffset),
    utf8ByteOffsetToUtf16Offset(source, location.startOffset + location.length)
  )
}

/**
 * Slices JavaScript source using Prism's UTF-8 byte offsets.
 * @param {string} source - Complete source.
 * @param {number} startOffset - Inclusive Prism byte offset.
 * @param {number} endOffset - Exclusive Prism byte offset.
 * @returns {string} Source text in the byte range.
 */
function slicePrismSource(source, startOffset, endOffset) {
  return source.slice(
    utf8ByteOffsetToUtf16Offset(source, startOffset),
    utf8ByteOffsetToUtf16Offset(source, endOffset)
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
    return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: node.name}, {name: location})
  }

  if (node instanceof IntegerNode) {
    if (!Number.isSafeInteger(node.value)) return unsupportedSyntax("ruby", "non-safe integer literal", location)

    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value: node.value}, {literal: location})
  }

  if (node instanceof TrueNode || node instanceof FalseNode) {
    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: node instanceof TrueNode}, {literal: location})
  }

  if (node instanceof StringNode) {
    const decoded = node.unescaped

    if (!decoded.validEncoding || decoded.encoding != "utf-8" || node.isForcedBinaryEncoding() ||
      !hasOnlyUnicodeScalars(decoded.value)) {
      return unsupportedSyntax("ruby", "invalid Unicode string literal", location)
    }

    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: decoded.value}, {literal: location})
  }

  if (node instanceof InterpolatedStringNode) return unsupportedSyntax("ruby", "interpolated string", location)

  if (node instanceof CallNode && node.receiver && node.name == "!") {
    const operatorLocation = prismLocation(node.messageLoc ?? node.location, filename, source)

    if (node.callOperatorLoc) return unsupportedSyntax("ruby", "qualified boolean not", operatorLocation)
    if (node.messageLoc?.length != 1) {
      return unsupportedSyntax("ruby", "precedence-sensitive boolean not", operatorLocation)
    }
    if (node.arguments_) return unsupportedSyntax("ruby", "boolean not argument list", operatorLocation)

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(node.receiver, filename, source)
    }, {operator: operatorLocation}), "Not")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node instanceof CallNode && node.receiver && node.name == "-@") {
    const operatorLocation = prismLocation(node.messageLoc ?? node.location, filename, source)

    if (node.callOperatorLoc) return unsupportedSyntax("ruby", "qualified integer negation", operatorLocation)
    if (node.arguments_) return unsupportedSyntax("ruby", "integer negation argument list", operatorLocation)

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(node.receiver, filename, source)
    }, {operator: operatorLocation}), "Negate")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node instanceof AndNode || node instanceof OrNode) {
    const operatorLocation = prismLocation(node.operatorLoc, filename, source)
    const sourceOperator = source.slice(operatorLocation.start.offset, operatorLocation.end.offset)

    if (sourceOperator != "&&" && sourceOperator != "||") {
      return unsupportedSyntax("ruby", `precedence-sensitive boolean ${sourceOperator}`, location)
    }

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(node.left, filename, source),
      location,
      right: convertExpression(node.right, filename, source)
    }, {operator: operatorLocation}), node instanceof AndNode ? "And" : "Or")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node instanceof CallNode && node.receiver && rubyBinaryOperations.has(node.name) && node.callOperatorLoc &&
    node.arguments_?.arguments_.length == 1) {
    return unsupportedSyntax(
      "ruby",
      `qualified binary operator ${node.name}`,
      prismLocation(node.messageLoc ?? node.location, filename, source)
    )
  }

  if (node instanceof CallNode && node.receiver && rubyBinaryOperations.has(node.name) && node.arguments_?.arguments_.length == 1) {
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(node.receiver, filename, source),
      location,
      right: convertExpression(node.arguments_.arguments_[0], filename, source)
    }, {operator: prismLocation(node.messageLoc ?? node.location, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (rubyBinaryOperations.get(node.name)))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node instanceof CallNode && !node.receiver) {
    return withParserRanges({
      arguments: (node.arguments_?.arguments_ ?? []).map((argument) => convertExpression(argument, filename, source)),
      callee: node.name,
      kind: "CallExpression",
      location
    }, {callee: prismLocation(node.messageLoc ?? node.location, filename, source)})
  }

  return unsupportedSyntax("ruby", node.constructor.name, location)
}

/**
 * Converts one explicit Ruby return.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node instanceof ReturnNode) || node.arguments_?.arguments_.length != 1) {
    return unsupportedSyntax("ruby", node.constructor.name, location)
  }

  return {
    expression: convertExpression(node.arguments_.arguments_[0], filename, source),
    kind: "ReturnStatement",
    location
  }
}

/**
 * Reads Prism-owned RBS-style type comments directly preceding a definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {{location: import("@ruby/prism").Location}} node - Comment owner.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{parameters: Map<string, {location: import("../semantic/types.js").SourceLocation, sourceType: string}>, returnType: {location: import("../semantic/types.js").SourceLocation, sourceType: string} | undefined}} Declared types.
 */
function typeComments(comments, node, filename, source) {
  const preceding = associatedComments(comments, node, source)
  const parameterTypes = new Map()
  /** @type {{location: import("../semantic/types.js").SourceLocation, sourceType: string} | undefined} */
  let returnType

  for (const comment of preceding) {
    const words = commentTokens(comment, filename, source)

    if (words[0]?.text == "@param" && words.length == 3) {
      parameterTypes.set(words[1].text, {location: words[2].location, sourceType: words[2].text})
    }
    if (words[0]?.text == "@return" && words.length == 2) {
      returnType = {location: words[1].location, sourceType: words[1].text}
    }
  }

  return {parameters: parameterTypes, returnType}
}

/**
 * Lexes whitespace-separated metadata tokens inside a Prism-owned Ruby comment.
 * @param {import("@ruby/prism/src/deserialize.js").Comment} comment - Prism comment token.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{location: import("../semantic/types.js").SourceLocation, text: string}[]} Metadata tokens.
 */
function commentTokens(comment, filename, source) {
  const start = utf8ByteOffsetToUtf16Offset(source, comment.location.startOffset)
  const end = utf8ByteOffsetToUtf16Offset(source, comment.location.startOffset + comment.location.length)
  const tokens = []
  let offset = start + 1

  while (offset < end) {
    while (offset < end && isRubyMetadataWhitespace(source[offset])) offset++
    const tokenStart = offset

    while (offset < end && !isRubyMetadataWhitespace(source[offset])) offset++
    if (tokenStart < offset) {
      tokens.push({location: locationFromOffsets(filename, source, tokenStart, offset), text: source.slice(tokenStart, offset)})
    }
  }

  return tokens
}

/**
 * Checks one Ruby metadata separator.
 * @param {string} character - Source character.
 * @returns {boolean} Whether it separates metadata tokens.
 */
function isRubyMetadataWhitespace(character) {
  return character == " " || character == "\t" || character == "\r" || character == "\n"
}

/**
 * Selects only the contiguous comment block immediately before a definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {{location: import("@ruby/prism").Location}} node - Comment owner.
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
    const gap = slicePrismSource(source, endOffset, boundary)

    if (!isImmediateCommentGap(gap)) break

    associated.unshift(comment)
    boundary = comment.location.startOffset
  }

  return associated
}

/**
 * Reads one exact Ruby local type carrier and immutability marker.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {LocalVariableWriteNode} node - Local write.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{immutable: boolean, type: import("../semantic/types.js").TypeReference} | undefined} Metadata when present.
 */
function localMetadata(comments, node, filename, source) {
  const associated = associatedComments(comments, node, source)
  const metadata = associated.map((comment) => commentTokens(comment, filename, source))
  const typeMetadata = metadata.filter(([token]) => token?.text == "@type")
  const immutableMetadata = metadata.filter(([token]) => token?.text == "@semantifold-immutable")
  const profileMetadata = metadata.filter(([token]) => {
    return token?.text.startsWith("@type") || token?.text.startsWith("@semantifold-immutable")
  })

  if (profileMetadata.length == 0) return undefined

  const location = nodeLocation(node, filename, source)

  if (typeMetadata.length != 1 || typeMetadata[0].length != 2 ||
    immutableMetadata.length > 1 || immutableMetadata.some((tokens) => tokens.length != 1) ||
    profileMetadata.length != typeMetadata.length + immutableMetadata.length) {
    return unsupportedSyntax("ruby", "malformed local type metadata", location)
  }

  return {
    immutable: immutableMetadata.length == 1,
    type: convertType(typeMetadata[0][1].text, `Local '${node.name}'`, location, typeMetadata[0][1].location)
  }
}

/**
 * Converts one Ruby local declaration or assignment.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {Set<string>} visible - Names visible during adaptation.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, comments, visible, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node instanceof LocalVariableWriteNode)) return unsupportedSyntax("ruby", node.constructor.name, location)

  const metadata = localMetadata(comments, node, filename, source)

  if (metadata) {
    visible.add(node.name)
    return withParserRanges({
      initializer: convertExpression(node.value, filename, source),
      kind: "LocalDeclaration",
      location,
      mutable: !metadata.immutable,
      name: node.name,
      type: metadata.type
    }, {name: prismLocation(node.nameLoc, filename, source), operator: prismLocation(node.operatorLoc, filename, source)})
  }

  if (!visible.has(node.name)) return missingType("ruby", `Local '${node.name}'`, location)

  const targetLocation = prismLocation(node.nameLoc, filename, source)
  const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name: node.name}, {
    name: targetLocation
  })

  return withParserRanges({
    expression: convertExpression(node.value, filename, source),
    kind: "AssignmentStatement",
    location,
    target
  }, {operator: prismLocation(node.operatorLoc, filename, source)})
}

/**
 * Converts a declaration/assignment prefix followed by one Ruby terminal node.
 * @template {import("../semantic/types.js").IfStatement | import("../semantic/types.js").ReturnStatement | import("../semantic/types.js").PrintStatement} Terminal
 * @param {import("@ruby/prism").Node[]} statements - Prism statements.
 * @param {typeof IfNode | typeof ReturnNode | typeof CallNode} terminalClass - Required terminal class.
 * @param {(node: import("@ruby/prism").Node) => Terminal} convertTerminal - Terminal converter.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {Set<string>} visible - Visible names.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {(import("../semantic/types.js").LocalStatement | Terminal)[]} Semantic statements.
 */
function convertRestrictedSequence(statements, terminalClass, convertTerminal, comments, visible, filename, source) {
  const terminal = statements.at(-1)

  if (!terminal || !(terminal instanceof terminalClass)) {
    return unsupportedSyntax("ruby", `statement sequence without ${terminalClass.name}`, terminal ? nodeLocation(terminal, filename, source) : moduleLocation(filename, source))
  }

  return [
    ...statements.slice(0, -1).map((statement) => convertLocalStatement(statement, comments, visible, filename, source)),
    convertTerminal(terminal)
  ]
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
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact type comment token location.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, subject, location, typeLocation = location) {
  return requireSourceScalarType("ruby", sourceType, subject, location, typeLocation)
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

  if (!(node.body instanceof StatementsNode)) {
    return unsupportedSyntax("ruby", "function body", location)
  }

  if (!node.parameters || node.parameters.optionals.length > 0 || node.parameters.rest || node.parameters.posts.length > 0 ||
    node.parameters.keywords.length > 0 || node.parameters.keywordRest || node.parameters.block ||
    node.parameters.requireds.some((parameter) => !(parameter instanceof RequiredParameterNode))) {
    return unsupportedSyntax("ruby", "parameters", location)
  }

  const declaredTypes = typeComments(comments, node, filename, source)
  const parameters = node.parameters.requireds.map((parameter) => {
    if (!(parameter instanceof RequiredParameterNode)) return unsupportedSyntax("ruby", parameter.constructor.name, location)

    const parameterLocation = nodeLocation(parameter, filename, source)

    const declaredType = declaredTypes.parameters.get(parameter.name)

    return withParserRanges({
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameter.name,
      type: convertType(declaredType?.sourceType, `Parameter '${parameter.name}'`, parameterLocation, declaredType?.location)
    }, {name: parameterLocation})
  })
  const visible = new Set(parameters.map((parameter) => parameter.name))
  const body = convertRestrictedSequence(
    node.body.body,
    IfNode,
    (statement) => convertIf(/** @type {IfNode} */ (statement), comments, visible, filename, source),
    comments,
    visible,
    filename,
    source
  )

  return withParserRanges({
    body: /** @type {import("../semantic/types.js").FunctionStatement[]} */ (body),
    kind: "FunctionDeclaration",
    location,
    name: node.name,
    parameters,
    returnType: convertType(declaredTypes.returnType?.sourceType, `Function '${node.name}' return`, location, declaredTypes.returnType?.location)
  }, {name: prismLocation(node.nameLoc, filename, source)})
}

/**
 * Converts the existing Ruby if/else terminal with restricted branch prefixes.
 * @param {IfNode} node - Prism if node.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {Set<string>} visible - Enclosing visible names.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, comments, visible, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!node.statements || !(node.subsequent instanceof ElseNode) || !node.subsequent.statements) {
    return unsupportedSyntax("ruby", "if without else", location)
  }

  const consequentVisible = new Set(visible)
  const alternateVisible = new Set(visible)

  return {
    alternate: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
      convertRestrictedSequence(node.subsequent.statements.body, ReturnNode, (statement) => convertReturn(statement, filename, source), comments, alternateVisible, filename, source)
    ),
    condition: convertExpression(node.predicate, filename, source),
    consequent: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
      convertRestrictedSequence(node.statements.body, ReturnNode, (statement) => convertReturn(statement, filename, source), comments, consequentVisible, filename, source)
    ),
    kind: "IfStatement",
    location
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
  const entryNodes = body.filter((node) => !(node instanceof DefNode))
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax("ruby", "module without a function", location)
  if (entryNodes.length == 0) return unsupportedSyntax("ruby", "module without an entry point", location)

  const entryStatements = convertRestrictedSequence(
    entryNodes,
    CallNode,
    (statement) => convertPrint(statement, filename, source),
    result.comments,
    new Set(),
    filename,
    source
  )

  return {
    entryPoint: {
      body: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").PrintStatement)[]} */ (entryStatements),
      kind: "EntryPoint",
      location: entryStatements[0].location
    },
    functions,
    kind: "Module",
    location
  }
}
