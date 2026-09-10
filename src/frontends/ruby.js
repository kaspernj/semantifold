// @ts-check

import {
  AndNode,
  ArrayNode,
  AssocNode,
  BlockNode,
  BlockParametersNode,
  BreakNode,
  CallNode,
  DefNode,
  ElseNode,
  FalseNode,
  HashNode,
  IfNode,
  IntegerNode,
  InterpolatedStringNode,
  LocalVariableReadNode,
  LocalVariableWriteNode,
  NextNode,
  NilNode,
  OrNode,
  ParenthesesNode,
  ProgramNode,
  RequiredParameterNode,
  RedoNode,
  ReturnNode,
  RetryNode,
  StatementsNode,
  StringNode,
  TrueNode,
  UnlessNode,
  loadPrism
} from "@ruby/prism"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceReturnType} from "./scalars.js"
import {documentedValueType, iterationBindingType, iterationOperandType} from "./types.js"
const parsePrism = await loadPrism()
/** @typedef {{name: string, nameLocation: import("../semantic/types.js").SourceLocation, parameters: import("../semantic/types.js").Parameter[], returnType: import("../semantic/types.js").SemanticFunctionReturnType, location: import("../semantic/types.js").SourceLocation}} RubyFunctionSignature */
/** @typedef {{bindings: Map<string, import("../semantic/types.js").SemanticValueType>, functions: Map<string, RubyFunctionSignature>, loopDepth?: number, returnType?: import("../semantic/types.js").SemanticFunctionReturnType}} RubyConversionContext */
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
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @param {import("../semantic/types.js").SemanticValueType} [expectedType] - Explicit contextual value type.
 * @param {boolean} [preserveOptional] - Whether an optional identifier remains wrapped.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source, context, expectedType, preserveOptional = false) {
  const location = nodeLocation(node, filename, source)

  if (expectedType?.kind == "OptionalType") {
    if (node instanceof NilNode) {
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

  if (node instanceof NilNode) return unsupportedSyntax("ruby", "nil outside an explicit optional context", location)

  if (node instanceof CallNode && node.block) {
    return unsupportedSyntax("ruby", "call block", nodeLocation(node.block, filename, source))
  }

  if (node instanceof ParenthesesNode && node.body instanceof StatementsNode && node.body.body.length == 1) {
    return convertExpression(node.body.body[0], filename, source, context, expectedType, preserveOptional)
  }

  if (node instanceof LocalVariableReadNode) {
    const identifier = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: node.name}, {name: location})

    if (!preserveOptional && context.bindings.get(node.name)?.kind == "OptionalType") {
      return withParserRanges({kind: /** @type {const} */ ("OptionalUnwrap"), location, operand: identifier}, {unwrap: location})
    }

    return identifier
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

  if (node instanceof OrNode && node.left instanceof LocalVariableReadNode &&
    context.bindings.get(node.left.name)?.kind == "OptionalType") {
    return unsupportedSyntax("ruby", "optional default with ||", prismLocation(node.operatorLoc, filename, source))
  }

  if (exactNilTest(node, source)) {
    const call = /** @type {CallNode} */ (node)
    const receiver = /** @type {LocalVariableReadNode} */ (call.receiver)
    const operand = /** @type {import("../semantic/types.js").IdentifierExpression} */ (
      convertExpression(receiver, filename, source, context, undefined, true)
    )
    const present = withParserRanges({kind: /** @type {const} */ ("OptionalIsPresent"), location, operand}, {
      operator: prismLocation(call.messageLoc ?? call.location, filename, source)
    })
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: present
    }, {operator: prismLocation(call.messageLoc ?? call.location, filename, source)}), "Not")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node instanceof ArrayNode) {
    if (!node.openingLoc || !node.closingLoc) return unsupportedSyntax("ruby", "special array literal", location)
    if (node.isContainsSplat()) {
      const splat = node.elements.find((element) => element.constructor.name == "SplatNode")

      return unsupportedSyntax("ruby", "array splat", splat ? nodeLocation(splat, filename, source) : location)
    }

    const elementType = expectedType?.kind == "ListType" ? expectedType.elementType : undefined

    return withParserRanges({
      elements: node.elements.map((element) => convertExpression(element, filename, source, context, elementType)),
      kind: /** @type {const} */ ("ListLiteral"),
      location
    }, {
      close: prismLocation(node.closingLoc, filename, source),
      open: prismLocation(node.openingLoc, filename, source)
    })
  }

  if (node instanceof HashNode) {
    const valueType = expectedType?.kind == "MapType" ? expectedType.valueType : undefined
    const entries = node.elements.map((element) => {
      if (!(element instanceof AssocNode) || !element.operatorLoc ||
        slicePrismSource(source, element.operatorLoc.startOffset, element.operatorLoc.startOffset + element.operatorLoc.length) != "=>") {
        return unsupportedSyntax("ruby", "hash entry", nodeLocation(element, filename, source))
      }
      if (!(element.key instanceof StringNode)) {
        return unsupportedSyntax("ruby", "map key other than a string literal", nodeLocation(element.key, filename, source))
      }
      const key = convertExpression(element.key, filename, source, context)

      return withParserRanges({
        key: /** @type {import("../semantic/types.js").StringLiteral} */ (key),
        kind: /** @type {const} */ ("MapEntry"),
        location: nodeLocation(element, filename, source),
        value: convertExpression(element.value, filename, source, context, valueType)
      }, {operator: prismLocation(element.operatorLoc, filename, source)})
    })

    return withParserRanges({entries, kind: /** @type {const} */ ("MapLiteral"), location}, {
      close: prismLocation(node.closingLoc, filename, source),
      open: prismLocation(node.openingLoc, filename, source)
    })
  }

  if (node instanceof CallNode && node.receiver && node.name == "!") {
    const operatorLocation = prismLocation(node.messageLoc ?? node.location, filename, source)

    if (node.callOperatorLoc) return unsupportedSyntax("ruby", "qualified boolean not", operatorLocation)
    if (node.messageLoc?.length != 1) {
      return unsupportedSyntax("ruby", "precedence-sensitive boolean not", operatorLocation)
    }
    if (node.arguments_) return unsupportedSyntax("ruby", "boolean not argument list", operatorLocation)

    const operand = convertExpression(node.receiver, filename, source, context)

    if (operand.kind == "UnaryExpression" && operand.operand.kind == "OptionalIsPresent") {
      return operand.operand
    }
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand
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
      operand: convertExpression(node.receiver, filename, source, context)
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
      left: convertExpression(node.left, filename, source, context),
      location,
      right: convertExpression(node.right, filename, source, context)
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
      left: convertExpression(node.receiver, filename, source, context),
      location,
      right: convertExpression(node.arguments_.arguments_[0], filename, source, context)
    }, {operator: prismLocation(node.messageLoc ?? node.location, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (rubyBinaryOperations.get(node.name)))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node instanceof CallNode && node.receiver && node.name == "[]" && node.arguments_?.arguments_.length == 1 &&
    !node.callOperatorLoc && !node.block) {
    return withParserRanges({
      collection: convertExpression(node.receiver, filename, source, context),
      index: convertExpression(node.arguments_.arguments_[0], filename, source, context),
      kind: /** @type {const} */ ("ListIndexExpression"),
      location,
      totality: /** @type {const} */ ("proven")
    }, {operator: prismLocation(node.openingLoc ?? node.messageLoc ?? node.location, filename, source)})
  }
  if (node instanceof CallNode && node.receiver && node.name == "fetch" && node.arguments_?.arguments_.length == 1 &&
    node.callOperatorLoc && !node.block) {
    return withParserRanges({
      collection: convertExpression(node.receiver, filename, source, context),
      key: convertExpression(node.arguments_.arguments_[0], filename, source, context),
      kind: /** @type {const} */ ("MapLookupExpression"),
      location,
      totality: /** @type {const} */ ("fail-on-absence")
    }, {operator: prismLocation(node.messageLoc ?? node.location, filename, source)})
  }
  if (node instanceof CallNode && node.receiver && node.name == "size" && !node.arguments_ && node.callOperatorLoc && !node.block) {
    return withParserRanges({
      collection: convertExpression(node.receiver, filename, source, context),
      kind: /** @type {const} */ ("CollectionSizeExpression"),
      location
    }, {operator: prismLocation(node.messageLoc ?? node.location, filename, source)})
  }

  if (node instanceof CallNode && !node.receiver) {
    if (["send", "public_send", "__send__"].includes(node.name)) {
      return unsupportedSyntax("ruby", "dynamic call", prismLocation(node.messageLoc ?? node.location, filename, source))
    }
    const signature = context.functions.get(node.name)

    return withParserRanges({
      arguments: (node.arguments_?.arguments_ ?? []).map((argument, index) =>
        convertExpression(argument, filename, source, context, signature?.parameters[index]?.type)),
      callee: node.name,
      kind: "CallExpression",
      location
    }, {callee: prismLocation(node.messageLoc ?? node.location, filename, source)})
  }
  if (node instanceof CallNode && node.receiver) {
    const unsupportedLocation = !node.callOperatorLoc && node.messageLoc && node.arguments_?.arguments_.length == 1
      ? prismLocation(node.messageLoc, filename, source)
      : nodeLocation(node.receiver, filename, source)

    return unsupportedSyntax("ruby", node.constructor.name, unsupportedLocation)
  }

  return unsupportedSyntax("ruby", node.constructor.name, location)
}

/**
 * Resolves only result types established by explicit signatures and bindings.
 * @param {import("@ruby/prism").Node} node - Parser-owned expression.
 * @param {RubyConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | undefined} Known result type.
 */
function knownExpressionType(node, context) {
  if (node instanceof ParenthesesNode && node.body instanceof StatementsNode && node.body.body.length == 1) {
    return knownExpressionType(node.body.body[0], context)
  }
  if (node instanceof LocalVariableReadNode) return context.bindings.get(node.name)
  if (node instanceof CallNode && !node.receiver) return context.functions.get(node.name)?.returnType
  if (node instanceof CallNode && node.receiver && node.name == "[]") {
    const collectionType = knownExpressionType(node.receiver, context)

    if (collectionType?.kind == "ListType") return collectionType.elementType
  }
  if (node instanceof CallNode && node.receiver && node.name == "fetch") {
    const collectionType = knownExpressionType(node.receiver, context)

    if (collectionType?.kind == "MapType") return collectionType.valueType
  }

  return undefined
}

/**
 * Recognizes only the parser-backed `identifier.nil?` spelling used by Task 007.
 * @param {import("@ruby/prism").Node} node - Candidate Prism expression.
 * @param {string} source - Complete source.
 * @returns {boolean} Whether this is one exact nil test.
 */
function exactNilTest(node, source) {
  if (!(node instanceof CallNode) || !(node.receiver instanceof LocalVariableReadNode) ||
    node.name != "nil?" || !node.callOperatorLoc || node.arguments_ || node.block) return false

  return slicePrismSource(
    source,
    node.callOperatorLoc.startOffset,
    node.callOperatorLoc.startOffset + node.callOperatorLoc.length
  ) == "."
}

/**
 * Converts one explicit Ruby return.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (!(node instanceof ReturnNode) || (node.arguments_?.arguments_.length ?? 0) > 1) {
    return unsupportedSyntax("ruby", node.constructor.name, location)
  }

  return {
    ...(node.arguments_?.arguments_[0] ? {expression: convertExpression(
      node.arguments_.arguments_[0],
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

    if (words[0]?.text == "@param" && words.length >= 3) {
      if (parameterTypes.has(words[1].text)) {
        return unsupportedSyntax("ruby", "duplicate parameter annotation", words[1].location)
      }
      parameterTypes.set(words[1].text, joinedCommentToken(words, 2, source))
    } else if (words[0]?.text == "@return" && words.length >= 2) {
      if (returnType) return unsupportedSyntax("ruby", "duplicate return annotation", words[1].location)
      returnType = joinedCommentToken(words, 1, source)
    } else if (words[0]?.text?.startsWith("@param") || words[0]?.text?.startsWith("@return")) {
      return unsupportedSyntax("ruby", "malformed function type annotation", nodeLocation(node, filename, source))
    }
  }

  return {parameters: parameterTypes, returnType}
}

/**
 * Rejoins a bounded metadata suffix while retaining its parser-owned range.
 * @param {{location: import("../semantic/types.js").SourceLocation, text: string}[]} tokens - Comment tokens.
 * @param {number} start - First suffix token.
 * @param {string} source - Complete source.
 * @returns {{location: import("../semantic/types.js").SourceLocation, sourceType: string}} Joined token.
 */
function joinedCommentToken(tokens, start, source) {
  const first = tokens[start]
  const last = tokens.at(-1)

  if (!first || !last) throw new Error("Ruby metadata suffix unexpectedly disappeared.")
  const location = locationFromOffsets(first.location.filename, source, first.location.start.offset, last.location.end.offset)

  return {location, sourceType: source.slice(location.start.offset, location.end.offset)}
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
 * @returns {{immutable: boolean, type: import("../semantic/types.js").SemanticValueType} | undefined} Metadata when present.
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

  if (typeMetadata.length != 1 || typeMetadata[0].length < 2 ||
    immutableMetadata.length > 1 || immutableMetadata.some((tokens) => tokens.length != 1) ||
    profileMetadata.length != typeMetadata.length + immutableMetadata.length) {
    return unsupportedSyntax("ruby", "malformed local type metadata", location)
  }

  const declaredType = joinedCommentToken(typeMetadata[0], 1, source)

  return {
    immutable: immutableMetadata.length == 1,
    type: convertType(declaredType.sourceType, `Local '${node.name}'`, location, source, declaredType.location)
  }
}

/**
 * Converts one Ruby local declaration or assignment.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, comments, context, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node instanceof LocalVariableWriteNode)) return unsupportedSyntax("ruby", node.constructor.name, location)

  const metadata = localMetadata(comments, node, filename, source)

  if (metadata) {
    const semantic = withParserRanges({
      initializer: convertExpression(node.value, filename, source, context, metadata.type),
      kind: /** @type {const} */ ("LocalDeclaration"),
      location,
      mutable: !metadata.immutable,
      name: node.name,
      type: metadata.type
    }, {name: prismLocation(node.nameLoc, filename, source), operator: prismLocation(node.operatorLoc, filename, source)})

    context.bindings.set(node.name, metadata.type)
    return semantic
  }

  if (!context.bindings.has(node.name)) return missingType("ruby", `Local '${node.name}'`, location)

  const targetLocation = prismLocation(node.nameLoc, filename, source)
  const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name: node.name}, {
    name: targetLocation
  })

  const semantic = withParserRanges({
    expression: convertExpression(node.value, filename, source, context, context.bindings.get(node.name)),
    kind: /** @type {const} */ ("AssignmentStatement"),
    location,
    target
  }, {operator: prismLocation(node.operatorLoc, filename, source)})

  return semantic
}

/**
 * Converts one exhaustive Prism statement.
 * @param {import("@ruby/prism").Node} node - Prism statement.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, comments, context, filename, source) {
  if (node instanceof ReturnNode) {
    if ((context.loopDepth ?? 0) > 0) return unsupportedSyntax("ruby", "nonlocal return from each block", nodeLocation(node, filename, source))
    return convertReturn(node, filename, source, context)
  }
  if (node instanceof IfNode || node instanceof UnlessNode) return convertIf(node, comments, context, filename, source)
  if (node instanceof LocalVariableWriteNode) return convertLocalStatement(node, comments, context, filename, source)
  if (node instanceof BreakNode || node instanceof NextNode) {
    if (node.arguments_) return unsupportedSyntax("ruby", `${node instanceof BreakNode ? "break" : "next"} value`, nodeLocation(node.arguments_, filename, source))
    const location = prismLocation(node.keywordLoc, filename, source)

    return withParserRanges({
      kind: /** @type {"BreakStatement" | "ContinueStatement"} */ (node instanceof BreakNode ? "BreakStatement" : "ContinueStatement"),
      location
    }, {keyword: location})
  }
  if (node instanceof CallNode) {
    if (node.block) return convertForEach(node, comments, context, filename, source)
    if (!node.receiver && node.name == "puts") return convertPrint(node, filename, source, context)

    return {
      expression: /** @type {import("../semantic/types.js").CallExpression} */ (convertExpression(node, filename, source, context)),
      kind: "ExpressionStatement",
      location: nodeLocation(node, filename, source)
    }
  }

  return unsupportedSyntax("ruby", node.constructor.name, nodeLocation(node, filename, source))
}

/**
 * Converts exact resolved-list `.each do |value| ... end` syntax.
 * @param {CallNode} node - Prism call with a block.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {RubyConversionContext} context - Typed lexical context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ForEachStatement} Semantic loop.
 */
function convertForEach(node, comments, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const block = node.block

  if (!(block instanceof BlockNode)) return unsupportedSyntax("ruby", "call block", block ? nodeLocation(block, filename, source) : location)
  if (!node.receiver || node.name != "each" || node.arguments_ || !node.callOperatorLoc || !node.messageLoc) {
    return unsupportedSyntax("ruby", "arbitrary call block", nodeLocation(block, filename, source))
  }
  if (slicePrismSource(source, block.openingLoc.startOffset, block.openingLoc.startOffset + block.openingLoc.length) != "do") {
    return unsupportedSyntax("ruby", "non-do each block", prismLocation(block.openingLoc, filename, source))
  }
  const excluded = findRubyDescendant(block.body, (candidate) =>
    candidate instanceof RedoNode || candidate instanceof RetryNode || candidate instanceof ReturnNode)

  if (excluded) {
    const detail = excluded instanceof ReturnNode ? "nonlocal return from each block" :
      excluded instanceof RedoNode ? "redo in each block" : "retry in each block"

    return unsupportedSyntax("ruby", detail, nodeLocation(excluded, filename, source))
  }
  if (!(block.parameters instanceof BlockParametersNode) || block.parameters.locals.length > 0 ||
    !block.parameters.parameters) {
    return unsupportedSyntax("ruby", "each block parameters", block.parameters
      ? nodeLocation(block.parameters, filename, source)
      : nodeLocation(block, filename, source))
  }
  const parameters = block.parameters.parameters
  const unsupportedParameter = parameters.requireds.length != 1
    ? parameters.requireds[1] ?? parameters.requireds[0] ?? block.parameters
    : parameters.requireds[0] instanceof RequiredParameterNode && parameters.optionals.length == 0 && !parameters.rest &&
        parameters.posts.length == 0 && parameters.keywords.length == 0 && !parameters.keywordRest && !parameters.block
      ? undefined
      : parameters.optionals[0] ?? parameters.rest ?? parameters.posts[0] ?? parameters.keywords[0] ??
        parameters.keywordRest ?? parameters.block ?? parameters.requireds[0]

  if (unsupportedParameter) return unsupportedSyntax("ruby", "each block parameter arity or shape", nodeLocation(unsupportedParameter, filename, source))
  const parameter = /** @type {RequiredParameterNode} */ (parameters.requireds[0])
  const collectionType = iterationOperandType(knownExpressionType(node.receiver, context))

  if (!collectionType || collectionType.kind != "ListType" && collectionType.kind != "MapType") {
    return missingType("ruby", "Iteration collection", nodeLocation(node.receiver, filename, source))
  }
  const bindingLocation = nodeLocation(parameter, filename, source)
  const inferredType = collectionType.kind == "ListType" ? collectionType.elementType : collectionType.valueType
  const bindingType = iterationBindingType(inferredType, bindingLocation)
  const valueBinding = withParserRanges({
    kind: /** @type {const} */ ("ValueBinding"),
    location: bindingLocation,
    mutable: /** @type {const} */ (false),
    name: parameter.name,
    type: bindingType
  }, {name: bindingLocation})
  const bodyContext = {...context, bindings: new Map(context.bindings), loopDepth: (context.loopDepth ?? 0) + 1}

  bodyContext.bindings.set(parameter.name, bindingType)
  return withParserRanges({
    body: convertBlock(
      block.body instanceof StatementsNode ? block.body : null,
      comments,
      bodyContext,
      filename,
      source,
      nodeLocation(block, filename, source)
    ),
    kind: /** @type {const} */ ("ForEachStatement"),
    list: convertExpression(node.receiver, filename, source, context),
    location,
    valueBinding
  }, {operator: prismLocation(node.messageLoc, filename, source)})
}

/**
 * Finds the first parser descendant matching one excluded block construct.
 * @param {import("@ruby/prism").Node | null} node - Parser subtree.
 * @param {(node: import("@ruby/prism").Node) => boolean} predicate - Exclusion predicate.
 * @returns {import("@ruby/prism").Node | undefined} First source-ordered match.
 */
function findRubyDescendant(node, predicate) {
  if (!node) return undefined
  if (predicate(node)) return node
  for (const child of node.compactChildNodes()) {
    const match = findRubyDescendant(child, predicate)

    if (match) return match
  }
  return undefined
}

/**
 * Converts one ordered Prism statement list.
 * @param {StatementsNode | null} node - Prism statements, or an empty source block.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {import("../semantic/types.js").SourceLocation} fallbackLocation - Empty block location.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(node, comments, context, filename, source, fallbackLocation) {
  return {
    kind: "Block",
    location: node ? nodeLocation(node, filename, source) : fallbackLocation,
    statements: node ? node.body.map((statement) => convertStatement(statement, comments, context, filename, source)) : []
  }
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
 * Requires an exact supported Ruby value-type spelling.
 * @param {string | undefined} sourceType - Ruby type comment value.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} source - Complete parser input.
 * @param {import("../semantic/types.js").SourceLocation} [typeLocation] - Exact type comment token location.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, subject, location, source, typeLocation = location) {
  return documentedValueType({language: "ruby", location: typeLocation, ownerLocation: location, source, sourceType, subject})
}

/**
 * Converts a Ruby definition signature before body expressions.
 * @param {DefNode} node - Prism definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {RubyFunctionSignature} Semantic signature.
 */
function convertFunctionSignature(node, comments, filename, source) {
  const location = nodeLocation(node, filename, source)
  const parameterList = node.parameters

  if (node.receiver) return unsupportedSyntax("ruby", "singleton method", nodeLocation(node.receiver, filename, source))
  const nameLocation = prismLocation(node.nameLoc, filename, source)

  if (node.name == "puts") return unsupportedSyntax("ruby", "function 'puts' captures built-in printing", nameLocation)
  const unsupportedParameter = parameterList && [
    parameterList.optionals[0], parameterList.rest, parameterList.posts[0], parameterList.keywords[0],
    parameterList.keywordRest, parameterList.block,
    parameterList.requireds.find((parameter) => !(parameter instanceof RequiredParameterNode))
  ].find(Boolean)

  if (unsupportedParameter) {
    return unsupportedSyntax("ruby", "parameters", nodeLocation(unsupportedParameter, filename, source))
  }

  const declaredTypes = typeComments(comments, node, filename, source)
  const requiredParameters = parameterList?.requireds ?? []
  const extraAnnotation = [...declaredTypes.parameters.keys()].find((name) =>
    !requiredParameters.some((parameter) => parameter instanceof RequiredParameterNode && parameter.name == name))

  if (extraAnnotation) return unsupportedSyntax("ruby", `annotation for unknown parameter '${extraAnnotation}'`, location)
  const parameters = requiredParameters.map((parameter) => {
    if (!(parameter instanceof RequiredParameterNode)) return unsupportedSyntax("ruby", parameter.constructor.name, location)

    const parameterLocation = nodeLocation(parameter, filename, source)

    const declaredType = declaredTypes.parameters.get(parameter.name)

    return withParserRanges({
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameter.name,
      type: convertType(declaredType?.sourceType, `Parameter '${parameter.name}'`, parameterLocation, source, declaredType?.location)
    }, {name: parameterLocation})
  })
  return {
    location,
    name: node.name,
    nameLocation,
    parameters,
    returnType: declaredTypes.returnType?.sourceType == "[void]"
      ? requireSourceReturnType("ruby", "[void]", `Function '${node.name}' return`, location, declaredTypes.returnType.location)
      : convertType(declaredTypes.returnType?.sourceType, `Function '${node.name}' return`, location, source, declaredTypes.returnType?.location)
  }
}

/**
 * Converts a Ruby definition body using all already-proved signatures.
 * @param {DefNode} node - Prism definition.
 * @param {RubyFunctionSignature} signature - Converted signature.
 * @param {Map<string, RubyFunctionSignature>} functions - Module signatures.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, comments, filename, source) {
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    functions,
    returnType: signature.returnType
  }
  const body = convertBlock(
    node.body instanceof StatementsNode ? node.body : null,
    comments,
    context,
    filename,
    source,
    signature.location
  )

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
 * Converts the existing Ruby if/else terminal with restricted branch prefixes.
 * @param {IfNode | UnlessNode} node - Prism conditional node.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, comments, context, filename, source) {
  const location = nodeLocation(node, filename, source)

  const keywordLocation = node instanceof UnlessNode ? node.keywordLoc : node.ifKeywordLoc

  if (!keywordLocation || keywordLocation.startOffset != node.location.startOffset) {
    return unsupportedSyntax("ruby", "modifier conditional", keywordLocation
      ? prismLocation(keywordLocation, filename, source)
      : location)
  }

  if (node.predicate instanceof LocalVariableReadNode &&
    context.bindings.get(node.predicate.name)?.kind == "OptionalType") {
    return unsupportedSyntax("ruby", "optional truthiness condition", nodeLocation(node.predicate, filename, source))
  }

  if (node instanceof UnlessNode && !exactNilTest(node.predicate, source)) {
    return unsupportedSyntax("ruby", "unless condition other than an exact nil? presence guard", nodeLocation(node.predicate, filename, source))
  }

  const predicate = convertExpression(node.predicate, filename, source, context)
  const condition = node instanceof UnlessNode && predicate.kind == "UnaryExpression" &&
    predicate.operand.kind == "OptionalIsPresent"
    ? predicate.operand
    : predicate
  if (node instanceof UnlessNode && condition.kind != "OptionalIsPresent") {
    return unsupportedSyntax("ruby", "unless condition other than an exact nil? presence guard", nodeLocation(node.predicate, filename, source))
  }
  const consequentContext = {...context, bindings: new Map(context.bindings)}
  const alternateContext = {...context, bindings: new Map(context.bindings)}
  let alternate
  const subsequent = node instanceof UnlessNode ? node.elseClause : node.subsequent

  if (subsequent) {
    if (subsequent instanceof ElseNode) {
      alternate = convertBlock(subsequent.statements, comments, alternateContext, filename, source,
        nodeLocation(subsequent, filename, source))
    } else if (subsequent instanceof IfNode) {
      alternate = {
        kind: /** @type {const} */ ("Block"),
        location: nodeLocation(subsequent, filename, source),
        statements: [convertIf(subsequent, comments, alternateContext, filename, source)]
      }
    } else return unsupportedSyntax("ruby", subsequent.constructor.name, nodeLocation(subsequent, filename, source))
  }

  return {
    ...(alternate ? {alternate} : {}),
    condition,
    consequent: convertBlock(node.statements, comments, consequentContext, filename, source, location),
    kind: "IfStatement",
    location
  }
}

/**
 * Converts the supported Ruby puts entry point.
 * @param {import("@ruby/prism").Node} node - Prism node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {RubyConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)

  if (!(node instanceof CallNode) || node.receiver || node.name != "puts" || node.arguments_?.arguments_.length != 1) {
    return unsupportedSyntax("ruby", node.constructor.name, location)
  }

  return {expression: convertExpression(node.arguments_.arguments_[0], filename, source, context), kind: "PrintStatement", location}
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
  const functionNodes = body.filter((node) => node instanceof DefNode)
  const signatures = functionNodes.map((node) => convertFunctionSignature(node, result.comments, filename, source))
  const functionSignatures = new Map(signatures.map((signature) => [signature.name, signature]))
  const functions = functionNodes.map((node, index) =>
    convertFunction(node, signatures[index], functionSignatures, result.comments, filename, source))
  const entryNodes = body.filter((node) => !(node instanceof DefNode))
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax("ruby", "module without a function", location)
  const firstEntry = entryNodes[0]
  const entryLocation = firstEntry ? locationFromOffsets(
    filename,
    source,
    utf8ByteOffsetToUtf16Offset(source, firstEntry.location.startOffset),
    utf8ByteOffsetToUtf16Offset(
      source,
      (entryNodes.at(-1)?.location.startOffset ?? 0) + (entryNodes.at(-1)?.location.length ?? 0)
    )
  ) : location
  const entryContext = {bindings: new Map(), functions: functionSignatures}
  const entryBlock = {
    kind: /** @type {const} */ ("Block"),
    location: entryLocation,
    statements: entryNodes.map((statement) => convertStatement(statement, result.comments, entryContext, filename, source))
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
