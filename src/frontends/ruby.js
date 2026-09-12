// @ts-check

import {
  AndNode,
  ArrayNode,
  AssocNode,
  BlockNode,
  BlockParametersNode,
  BeginNode,
  BreakNode,
  CallNode,
  ClassNode,
  ConstantPathNode,
  ConstantReadNode,
  DefNode,
  ElseNode,
  FalseNode,
  HashNode,
  IfNode,
  IntegerNode,
  InstanceVariableWriteNode,
  InterpolatedStringNode,
  LocalVariableReadNode,
  LocalVariableTargetNode,
  LocalVariableWriteNode,
  ModuleNode,
  NextNode,
  NilNode,
  OrNode,
  ParenthesesNode,
  ProgramNode,
  RequiredParameterNode,
  RedoNode,
  RescueNode,
  ReturnNode,
  RetryNode,
  SelfNode,
  StatementsNode,
  StringNode,
  SymbolNode,
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
import {documentedValueType, iterationBindingType, iterationOperandType, recordType} from "./types.js"
const parsePrism = await loadPrism()
/** @typedef {{name: string, nameLocation: import("../semantic/types.js").SourceLocation, parameters: import("../semantic/types.js").Parameter[], returnType: import("../semantic/types.js").SemanticFunctionReturnType, location: import("../semantic/types.js").SourceLocation}} RubyFunctionSignature */
/** @typedef {{bindings: Map<string, import("../semantic/types.js").SemanticBindingType>, errorNames: Map<string, import("../semantic/types.js").ErrorDeclaration>, errors: Map<string, import("../semantic/types.js").ErrorDeclaration>, functions: Map<string, RubyFunctionSignature>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, recordNames: Map<string, import("../semantic/types.js").RecordDeclaration>, loopDepth?: number, returnType?: import("../semantic/types.js").SemanticFunctionReturnType}} RubyConversionContext */
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

  if (node instanceof CallNode && node.callOperatorLoc && slicePrismSource(
    source,
    node.callOperatorLoc.startOffset,
    node.callOperatorLoc.startOffset + node.callOperatorLoc.length
  ) == "&.") {
    return unsupportedSyntax("ruby", node.constructor.name, location)
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

  if (node instanceof CallNode && (node.receiver instanceof ConstantReadNode || node.receiver instanceof ConstantPathNode) && node.name == "new" &&
    node.callOperatorLoc && !node.block) {
    const recordName = constantPathName(node.receiver)
    const declaration = context.recordNames.get(recordName)

    if (!declaration) return unsupportedSyntax("ruby", "construction of a non-record class", nodeLocation(node.receiver, filename, source))
    return withParserRanges({
      arguments: (node.arguments_?.arguments_ ?? []).map((argument, index) =>
        convertExpression(argument, filename, source, context, declaration.fields[index]?.type)),
      kind: /** @type {const} */ ("RecordConstruction"),
      location,
      record: recordType(/** @type {string} */ (declaration.id), nodeLocation(node.receiver, filename, source))
    }, {record: nodeLocation(node.receiver, filename, source)})
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
  if (node instanceof CallNode && node.receiver instanceof ConstantReadNode && node.callOperatorLoc && !node.block) {
    const callee = `${node.receiver.name}.${node.name}`
    const signature = context.functions.get(callee)

    if (signature) {
      return withParserRanges({
        arguments: (node.arguments_?.arguments_ ?? []).map((argument, index) =>
          convertExpression(argument, filename, source, context, signature.parameters[index]?.type)),
        callee,
        kind: /** @type {const} */ ("CallExpression"),
        location
      }, {callee: prismLocation(node.messageLoc ?? node.location, filename, source)})
    }
  }
  if (node instanceof CallNode && node.receiver && node.name == "size" && !node.arguments_ && node.callOperatorLoc && !node.block) {
    const receiverType = knownValueExpressionType(node.receiver, context)

    if (receiverType?.kind == "RecordType") {
      return withParserRanges({
        field: node.name,
        kind: /** @type {const} */ ("MemberRead"),
        location,
        receiver: convertExpression(node.receiver, filename, source, context)
      }, {member: prismLocation(node.messageLoc ?? node.location, filename, source)})
    }
    return withParserRanges({
      collection: convertExpression(node.receiver, filename, source, context),
      kind: /** @type {const} */ ("CollectionSizeExpression"),
      location
    }, {operator: prismLocation(node.messageLoc ?? node.location, filename, source)})
  }
  if (node instanceof CallNode && node.receiver instanceof LocalVariableReadNode && node.name == "message" &&
    !node.arguments_ && node.callOperatorLoc && !node.block && context.bindings.get(node.receiver.name)?.kind == "ErrorType") {
    const receiverLocation = nodeLocation(node.receiver, filename, source)

    return withParserRanges({
      kind: /** @type {const} */ ("ErrorMessageRead"),
      location,
      receiver: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: receiverLocation, name: node.receiver.name}, {
        name: receiverLocation
      })
    }, {member: prismLocation(node.messageLoc ?? node.location, filename, source)})
  }
  if (node instanceof CallNode && node.receiver && node.callOperatorLoc && !node.arguments_ && !node.block) {
    if (["send", "public_send", "__send__", "instance_variable_get", "method"].includes(node.name)) {
      return unsupportedSyntax("ruby", "dynamic or reflective member access", prismLocation(node.messageLoc ?? node.location, filename, source))
    }
    return withParserRanges({
      field: node.name,
      kind: /** @type {const} */ ("MemberRead"),
      location,
      receiver: convertExpression(node.receiver, filename, source, context)
    }, {member: prismLocation(node.messageLoc ?? node.location, filename, source)})
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
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} Known result type.
 */
function knownExpressionType(node, context) {
  if (node instanceof ParenthesesNode && node.body instanceof StatementsNode && node.body.body.length == 1) {
    return knownExpressionType(node.body.body[0], context)
  }
  if (node instanceof LocalVariableReadNode) return context.bindings.get(node.name)
  if (node instanceof CallNode && !node.receiver) return context.functions.get(node.name)?.returnType
  if (node instanceof CallNode && node.receiver instanceof ConstantReadNode) {
    return context.functions.get(`${node.receiver.name}.${node.name}`)?.returnType
  }
  if (node instanceof CallNode && node.receiver && node.name == "[]") {
    const collectionType = knownValueExpressionType(node.receiver, context)

    if (collectionType?.kind == "ListType") return collectionType.elementType
  }
  if (node instanceof CallNode && node.receiver && node.name == "fetch") {
    const collectionType = knownValueExpressionType(node.receiver, context)

    if (collectionType?.kind == "MapType") return collectionType.valueType
  }
  if (node instanceof CallNode && (node.receiver instanceof ConstantReadNode || node.receiver instanceof ConstantPathNode) && node.name == "new") {
    const declaration = context.recordNames.get(constantPathName(node.receiver))

    if (declaration?.id) return {declarationId: declaration.id, kind: "RecordType"}
  }
  if (node instanceof CallNode && node.receiver && node.callOperatorLoc && !node.arguments_) {
    const receiver = knownValueExpressionType(node.receiver, context)
    const declaration = receiver?.kind == "RecordType" ? context.records.get(receiver.declarationId) : undefined

    return declaration?.fields.find((field) => field.name == node.name)?.type
  }

  return undefined
}

/**
 * Resolves the value type produced by the frontend's implicit optional-binding unwrap.
 * Semantic validation separately proves that the unwrap occurs only on a present path.
 * @param {import("@ruby/prism").Node} node - Parser-owned expression.
 * @param {RubyConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} Converted value type.
 */
function knownValueExpressionType(node, context) {
  if (node instanceof ParenthesesNode && node.body instanceof StatementsNode && node.body.body.length == 1) {
    return knownValueExpressionType(node.body.body[0], context)
  }
  const type = knownExpressionType(node, context)

  return node instanceof LocalVariableReadNode && type?.kind == "OptionalType" ? type.valueType : type
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
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @returns {{immutable: boolean, type: import("../semantic/types.js").SemanticValueType} | undefined} Metadata when present.
 */
function localMetadata(comments, node, filename, source, recordNames) {
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
    type: convertType(declaredType.sourceType, `Local '${node.name}'`, location, source, declaredType.location, recordNames)
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

  const metadata = localMetadata(comments, node, filename, source, context.recordNames)

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

  const bindingType = context.bindings.get(node.name)
  const semantic = withParserRanges({
    expression: convertExpression(node.value, filename, source, context,
      bindingType?.kind == "ErrorType" ? undefined : bindingType),
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
  if (node instanceof BeginNode) return convertRubyTry(node, comments, context, filename, source)
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
    if (!node.receiver && node.name == "raise") return convertRubyRaise(node, context, filename, source)
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
 * Converts exact `raise DeclaredError, message`.
 * @param {CallNode} node - Prism raise call.
 * @param {RubyConversionContext} context - Typed lexical context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").RaiseStatement} Semantic raise.
 */
function convertRubyRaise(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const arguments_ = node.arguments_?.arguments_ ?? []
  const errorNode = arguments_[0]

  if (node.block || node.callOperatorLoc || arguments_.length != 2 ||
    !(errorNode instanceof ConstantReadNode) && !(errorNode instanceof ConstantPathNode) ||
    !context.errorNames.has(constantPathName(errorNode))) {
    return unsupportedSyntax("ruby", "raise other than exact declared error and message", location)
  }
  const declaration = /** @type {import("../semantic/types.js").ErrorDeclaration} */ (context.errorNames.get(constantPathName(errorNode)))
  const typeLocation = nodeLocation(errorNode, filename, source)

  return withParserRanges({
    error: withParserRanges({
      error: withParserRanges({declarationId: /** @type {string} */ (declaration.id), kind: /** @type {const} */ ("ErrorType")}, {type: typeLocation}),
      kind: /** @type {const} */ ("ErrorConstruction"),
      location,
      message: convertExpression(arguments_[1], filename, source, context)
    }, {type: typeLocation}),
    kind: /** @type {const} */ ("RaiseStatement"),
    location
  }, {keyword: prismLocation(node.messageLoc ?? node.location, filename, source)})
}

/**
 * Converts one exact typed rescue with no else/ensure.
 * @param {BeginNode} node - Prism begin node.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Parser-owned comments.
 * @param {RubyConversionContext} context - Typed lexical context.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TryStatement} Semantic exact handler.
 */
function convertRubyTry(node, comments, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const handler = node.rescueClause

  if (!(handler instanceof RescueNode) || handler.subsequent || node.elseClause || node.ensureClause ||
    handler.exceptions.length != 1 ||
    !(handler.exceptions[0] instanceof ConstantReadNode) && !(handler.exceptions[0] instanceof ConstantPathNode) ||
    !context.errorNames.has(constantPathName(handler.exceptions[0])) || !(handler.reference instanceof LocalVariableTargetNode)) {
    return unsupportedSyntax("ruby", "begin without one exact typed rescue and binding", location)
  }
  const errorNode = handler.exceptions[0]
  const declaration = /** @type {import("../semantic/types.js").ErrorDeclaration} */ (context.errorNames.get(constantPathName(errorNode)))
  const caughtLocation = nodeLocation(errorNode, filename, source)
  const catchType = withParserRanges({declarationId: /** @type {string} */ (declaration.id), kind: /** @type {const} */ ("ErrorType")}, {
    type: caughtLocation
  })
  const bodyContext = {...context, bindings: new Map(context.bindings)}
  const catchContext = {...context, bindings: new Map(context.bindings)}

  catchContext.bindings.set(handler.reference.name, catchType)
  return withParserRanges({
    body: convertBlock(node.statements, comments, bodyContext, filename, source, location),
    catchBinding: withParserRanges({
      kind: /** @type {const} */ ("CatchBinding"),
      location: nodeLocation(handler.reference, filename, source),
      mutable: /** @type {const} */ (false),
      name: handler.reference.name,
      type: catchType
    }, {name: nodeLocation(handler.reference, filename, source)}),
    catchBody: convertBlock(handler.statements, comments, catchContext, filename, source, nodeLocation(handler, filename, source)),
    catchType,
    kind: /** @type {const} */ ("TryStatement"),
    location
  }, {catch: nodeLocation(handler, filename, source), try: location})
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
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, subject, location, source, typeLocation = location, recordNames = new Map()) {
  return documentedValueType({language: "ruby", location: typeLocation, ownerLocation: location, records: recordNames, source, sourceType, subject})
}

/**
 * Converts a Ruby definition signature before body expressions.
 * @param {DefNode} node - Prism definition.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @returns {RubyFunctionSignature} Semantic signature.
 */
function convertFunctionSignature(node, comments, filename, source, recordNames) {
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
      type: convertType(declaredType?.sourceType, `Parameter '${parameter.name}'`, parameterLocation, source, declaredType?.location, recordNames)
    }, {name: parameterLocation})
  })
  return {
    location,
    name: node.name,
    nameLocation,
    parameters,
    returnType: declaredTypes.returnType?.sourceType == "[void]"
      ? requireSourceReturnType("ruby", "[void]", `Function '${node.name}' return`, location, declaredTypes.returnType.location)
      : convertType(declaredTypes.returnType?.sourceType, `Function '${node.name}' return`, location, source, declaredTypes.returnType?.location, recordNames)
  }
}

/**
 * Converts a Ruby definition body using all already-proved signatures.
 * @param {DefNode} node - Prism definition.
 * @param {RubyFunctionSignature} signature - Converted signature.
 * @param {Map<string, RubyFunctionSignature>} functions - Module signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Error declarations by source name.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Error declarations by identity.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Prism comments.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, recordNames, records, errorNames, errors, comments, filename, source) {
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    errorNames,
    errors,
    functions,
    recordNames,
    records,
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
 * Converts one exact empty StandardError subclass.
 * @param {ClassNode} node - Prism class declaration.
 * @param {import("../semantic/types.js").ErrorDeclaration} declaration - Predeclared semantic error.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ErrorDeclaration} Semantic error declaration.
 */
function convertRubyError(node, declaration, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node.constantPath instanceof ConstantReadNode) || !(node.superclass instanceof ConstantReadNode) ||
    node.superclass.name != "StandardError" || !node.inheritanceOperatorLoc || node.body) {
    return unsupportedSyntax("ruby", "noncanonical typed error declaration", location)
  }

  return withParserRanges(declaration, {
    name: nodeLocation(node.constantPath, filename, source),
    type: nodeLocation(node.superclass, filename, source)
  })
}

/**
 * Converts one exact typed-reader/initializer/freeze Ruby record profile.
 * @param {ClassNode} node - Prism class declaration.
 * @param {import("../semantic/types.js").RecordDeclaration} declaration - Predeclared nominal identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by name.
 * @param {import("@ruby/prism/src/deserialize.js").Comment[]} comments - Parser-owned comments.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").RecordDeclaration} Semantic record.
 */
function convertRubyRecord(node, declaration, recordNames, comments, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!(node.constantPath instanceof ConstantReadNode) || node.superclass || node.inheritanceOperatorLoc) {
    return unsupportedSyntax("ruby", "record inheritance or qualified name", location)
  }
  const members = node.body instanceof StatementsNode ? node.body.body : []
  const initializerIndex = members.findIndex((member) => member instanceof DefNode && member.name == "initialize")

  if (initializerIndex < 0 || initializerIndex != members.length - 1 || members.slice(0, initializerIndex).some((member) =>
    !(member instanceof CallNode) || member.receiver || member.name != "attr_reader" || member.block ||
    member.arguments_?.arguments_.length != 1 || !(member.arguments_.arguments_[0] instanceof SymbolNode))) {
    return unsupportedSyntax("ruby", "record class body outside typed readers and one initializer", nodeLocation(members.find((member, index) =>
      index >= initializerIndex + 1 || !(member instanceof CallNode) || member.name != "attr_reader") ?? node, filename, source))
  }
  const readerNodes = /** @type {CallNode[]} */ (members.slice(0, initializerIndex))
  declaration.fields = readerNodes.map((reader) => {
    const symbol = /** @type {SymbolNode} */ (reader.arguments_?.arguments_[0])
    const metadata = associatedComments(comments, reader, source).map((comment) => commentTokens(comment, filename, source))
    const typeMetadata = metadata.filter(([token]) => token?.text == "@type")
    const fieldLocation = nodeLocation(reader, filename, source)

    if (typeMetadata.length != 1 || typeMetadata[0].length < 2 || metadata.some(([token]) => token?.text?.startsWith("@type") && token.text != "@type")) {
      return unsupportedSyntax("ruby", "missing or malformed record reader type", fieldLocation)
    }
    const declaredType = joinedCommentToken(typeMetadata[0], 1, source)
    const field = {
      kind: /** @type {const} */ ("RecordField"),
      location: fieldLocation,
      name: symbol.unescaped.value,
      type: convertType(declaredType.sourceType, `Record field '${symbol.unescaped.value}'`, fieldLocation, source, declaredType.location, recordNames)
    }

    return withParserRanges(field, {name: symbol.valueLoc ? prismLocation(symbol.valueLoc, filename, source) : fieldLocation})
  })
  const initializer = /** @type {DefNode} */ (members[initializerIndex])
  const parameterList = initializer.parameters
  const parameters = parameterList?.requireds ?? []
  const invalidParameter = parameterList && [parameterList.optionals[0], parameterList.rest, parameterList.posts[0],
    parameterList.keywords[0], parameterList.keywordRest, parameterList.block].find(Boolean)
  const initializerStatements = initializer.body instanceof StatementsNode ? initializer.body.body : []

  if (initializer.receiver || invalidParameter || parameters.length != declaration.fields.length ||
    parameters.some((parameter, index) => !(parameter instanceof RequiredParameterNode) || parameter.name != declaration.fields[index].name) ||
    initializerStatements.length != declaration.fields.length + 1) {
    return unsupportedSyntax("ruby", "noncanonical record initializer", nodeLocation(initializer, filename, source))
  }
  const annotations = typeComments(comments, initializer, filename, source)

  if (annotations.returnType || annotations.parameters.size != declaration.fields.length) {
    return unsupportedSyntax("ruby", "incomplete record initializer annotations", nodeLocation(initializer, filename, source))
  }
  for (let index = 0; index < declaration.fields.length; index += 1) {
    const field = declaration.fields[index]
    const parameter = /** @type {RequiredParameterNode} */ (parameters[index])
    const assignment = initializerStatements[index]
    const annotated = annotations.parameters.get(parameter.name)

    if (!(assignment instanceof InstanceVariableWriteNode) || assignment.name != `@${field.name}` ||
      !(assignment.value instanceof LocalVariableReadNode) || assignment.value.name != field.name || !annotated) {
      return unsupportedSyntax("ruby", "record field not initialized exactly once", nodeLocation(assignment ?? initializer, filename, source))
    }
    const parameterType = convertType(annotated.sourceType, `Record initializer parameter '${parameter.name}'`,
      nodeLocation(parameter, filename, source), source, annotated.location, recordNames)

    if (JSON.stringify(parameterType) != JSON.stringify(field.type)) {
      return unsupportedSyntax("ruby", "record reader/initializer type mismatch", annotated.location)
    }
  }
  const freeze = initializerStatements.at(-1)

  if (!isRubyRecordFreeze(freeze)) {
    return unsupportedSyntax("ruby", "record initializer without final freeze", nodeLocation(freeze ?? initializer, filename, source))
  }

  return withParserRanges(declaration, {name: nodeLocation(node.constantPath, filename, source)})
}

/**
 * Recognizes canonical source freezing or the generated root-owned Kernel implementation binding.
 * @param {import("@ruby/prism").Node | undefined} node - Final initializer statement.
 * @returns {boolean} Whether the statement owns the native record-freeze operation.
 */
function isRubyRecordFreeze(node) {
  if (!(node instanceof CallNode) || node.block) return false
  if (!node.receiver) return node.name == "freeze" && !node.arguments_
  if (node.name != "bind_call" || !node.callOperatorLoc || node.arguments_?.arguments_.length != 1 ||
    !(node.arguments_.arguments_[0] instanceof SelfNode) || !(node.receiver instanceof CallNode)) return false
  const method = node.receiver

  if (method.name != "instance_method" || !method.callOperatorLoc || method.block ||
    method.arguments_?.arguments_.length != 1 || !(method.arguments_.arguments_[0] instanceof SymbolNode) ||
    !(method.receiver instanceof ConstantPathNode)) return false

  return method.receiver.parent == null && method.receiver.delimiterLoc != null && method.receiver.name == "Kernel" &&
    method.arguments_.arguments_[0].unescaped.value == "freeze"
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
 * @param {{isEntry: boolean, functions: Map<string, import("../semantic/types.js").FunctionDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, errors?: Map<string, import("../semantic/types.js").ErrorDeclaration>}} [input.program] - Resolved program imports and entry role.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseRuby({filename, source, program}) {
  const result = parsePrism(source, {filepath: filename})

  if (result.errors.length > 0) {
    const error = result.errors[0]
    const location = locationFromOffsets(filename, source, error.location.startOffset, error.location.startOffset + error.location.length)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "ruby", location, message: error.message})
  }

  if (!(result.value instanceof ProgramNode)) throw new Error("Prism returned a non-program root.")

  let body = result.value.statements.body

  if (program) {
    inspectRubyModule({filename, source})
    const moduleNode = /** @type {ModuleNode} */ (body.find((node) => node instanceof ModuleNode))

    body = moduleNode.body instanceof StatementsNode ? moduleNode.body.body : []
    const moduleFunctionNodes = body.filter(isModuleFunctionMarker)
    const definitions = body.filter((node) => node instanceof DefNode)

    if (definitions.length > 0 && (moduleFunctionNodes.length != 1 || body.indexOf(moduleFunctionNodes[0]) > body.indexOf(definitions[0]))) {
      return unsupportedSyntax("ruby", "module functions outside one leading module_function profile",
        nodeLocation(moduleFunctionNodes[1] ?? definitions[0], filename, source))
    }
    body = body.filter((node) => !isModuleFunctionMarker(node) && !rubyVisibilityMarker(node))
  }
  const classNodes = body.filter((node) => node instanceof ClassNode)
  const errorNodes = classNodes.filter((node) => node.superclass instanceof ConstantReadNode && node.superclass.name == "StandardError")
  const recordNodes = classNodes.filter((node) => !errorNodes.includes(node))
  const errorDeclarations = errorNodes.map((node, index) => ({
    id: `error:${index}`,
    kind: /** @type {const} */ ("ErrorDeclaration"),
    location: nodeLocation(node, filename, source),
    name: node.name
  }))
  const recordDeclarations = recordNodes.map((node, index) => ({
    fields: [],
    id: `record:${index}`,
    kind: /** @type {const} */ ("RecordDeclaration"),
    location: nodeLocation(node, filename, source),
    name: node.name
  }))
  const recordNames = new Map(program?.records ?? [])
  const errorNames = new Map(program?.errors ?? [])
  for (const declaration of errorDeclarations) errorNames.set(declaration.name, declaration)
  const errorsById = new Map([...errorNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const errors = errorNodes.map((node, index) => convertRubyError(node, errorDeclarations[index], filename, source))
  for (const declaration of recordDeclarations) recordNames.set(declaration.name, declaration)
  const recordsById = new Map([...recordNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const records = recordNodes.map((node, index) =>
    convertRubyRecord(node, recordDeclarations[index], recordNames, result.comments, filename, source))
  const functionNodes = body.filter((node) => node instanceof DefNode)
  const signatures = functionNodes.map((node) => convertFunctionSignature(node, result.comments, filename, source, recordNames))
  const functionSignatures = new Map([...(program?.functions ?? [])].map(([localName, declaration]) => [localName, {
    location: declaration.location,
    name: localName,
    nameLocation: declaration.location,
    parameters: declaration.parameters,
    returnType: declaration.returnType
  }]))
  for (const signature of signatures) functionSignatures.set(signature.name, signature)
  const functions = functionNodes.map((node, index) =>
    convertFunction(node, signatures[index], functionSignatures, recordNames, recordsById, errorNames, errorsById, result.comments, filename, source))
  const entryNodes = body.filter((node) => !(node instanceof DefNode) && !(node instanceof ClassNode))
  const location = moduleLocation(filename, source)

  if (!program && functions.length == 0) return unsupportedSyntax("ruby", "module without a function", location)
  if (program && !program.isEntry && entryNodes.length > 0) {
    return unsupportedSyntax("ruby", "top-level side effect outside the selected entry module", nodeLocation(entryNodes[0], filename, source))
  }
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
  const entryContext = {bindings: new Map(), errorNames, errors: errorsById, functions: functionSignatures, recordNames, records: recordsById}
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
    location,
    ...(errors.length > 0 ? {errors} : {}),
    ...(records.length > 0 ? {records} : {})
  }
}

/**
 * Reads the canonical parser-owned Ruby module and literal require-relative edges.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @returns {{imports: {importedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, namespace: true, pathLocation: import("../semantic/types.js").SourceLocation, specifier: string, typeOnly: false}[], exports: {exportedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, typeOnly: false}[], nativeName: string}} Parser-owned Ruby module header.
 */
export function inspectRubyModule({filename, source}) {
  const result = parsePrism(source, {filepath: filename})

  if (result.errors.length > 0) {
    const error = result.errors[0]
    const location = locationFromOffsets(filename, source, error.location.startOffset, error.location.startOffset + error.location.length)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "ruby", location, message: error.message})
  }
  if (!(result.value instanceof ProgramNode)) throw new Error("Prism returned a non-program root.")
  const body = result.value.statements.body
  const modules = body.filter((node) => node instanceof ModuleNode)
  const invalid = body.find((node) => !(node instanceof ModuleNode) && !isRequireRelative(node))

  if (modules.length != 1 || !(modules[0].constantPath instanceof ConstantReadNode) || invalid) {
    return unsupportedSyntax("ruby", "one simple module with literal require_relative declarations",
      nodeLocation(invalid ?? modules[1] ?? modules[0] ?? result.value, filename, source))
  }
  const imports = body.filter(isRequireRelative).map((node) => {
    const call = /** @type {CallNode} */ (node)
    const argument = /** @type {StringNode} */ (call.arguments_?.arguments_[0])

    if (!argument.unescaped.validEncoding || argument.unescaped.encoding != "utf-8" || argument.isForcedBinaryEncoding()) {
      return unsupportedSyntax("ruby", "non-UTF-8 require_relative path", nodeLocation(argument, filename, source))
    }

    return {
      importedName: "*",
      kind: /** @type {const} */ ("Import"),
      localName: "",
      location: nodeLocation(call, filename, source),
      namespace: /** @type {const} */ (true),
      pathLocation: nodeLocation(argument, filename, source),
      specifier: argument.unescaped.value,
      typeOnly: /** @type {const} */ (false)
    }
  })
  const moduleBody = modules[0].body instanceof StatementsNode ? modules[0].body.body : []
  const visibility = new Map()

  for (const node of moduleBody) {
    if (!(node instanceof CallNode) || !["private_class_method", "private_constant"].includes(node.name)) continue
    const marker = rubyVisibilityMarker(node)

    if (!marker) return unsupportedSyntax("ruby", `malformed ${node.name}`, nodeLocation(node, filename, source))
    if (visibility.has(marker.name)) return unsupportedSyntax("ruby", `duplicate visibility marker for '${marker.name}'`, nodeLocation(node, filename, source))
    const declaration = moduleBody.find((candidate) => marker.kind == "function"
      ? candidate instanceof DefNode && candidate.name == marker.name
      : candidate instanceof ClassNode && candidate.name == marker.name)

    if (!declaration || moduleBody.indexOf(declaration) > moduleBody.indexOf(node)) {
      return unsupportedSyntax("ruby", `visibility marker without an earlier ${marker.kind}`, nodeLocation(node, filename, source))
    }
    visibility.set(marker.name, marker.kind)
  }
  const exports = moduleBody.flatMap((node) => {
    if (node instanceof DefNode || node instanceof ClassNode) {
      const kind = node instanceof DefNode ? "function" : "record"

      if (visibility.get(node.name) == kind) return []
      return [{
        exportedName: node.name,
        localName: node.name,
        location: nodeLocation(node instanceof ClassNode ? node.constantPath : node, filename, source),
        typeOnly: /** @type {const} */ (false)
      }]
    }
    return []
  })

  return {exports, imports, nativeName: modules[0].name}
}

/**
 * Reports whether a Ruby node is one canonical literal relative load edge.
 * @param {import("@ruby/prism").Node} node - Candidate call.
 * @returns {boolean} Whether the node is a supported require-relative call.
 */
function isRequireRelative(node) {
  return node instanceof CallNode && !node.receiver && !node.block && node.name == "require_relative" &&
    node.arguments_?.arguments_.length == 1 && node.arguments_.arguments_[0] instanceof StringNode
}

/**
 * Reports whether a Ruby node is the canonical module-function marker.
 * @param {import("@ruby/prism").Node} node - Candidate marker.
 * @returns {boolean} Whether the node is a bare module-function call.
 */
function isModuleFunctionMarker(node) {
  return node instanceof CallNode && !node.receiver && !node.block && node.name == "module_function" && !node.arguments_
}

/**
 * Reads one exact generated Ruby visibility marker.
 * @param {import("@ruby/prism").Node} node - Candidate module-body node.
 * @returns {{kind: import("../semantic/types.js").SemanticDeclarationKind, name: string} | undefined} Marker meaning.
 */
function rubyVisibilityMarker(node) {
  if (!(node instanceof CallNode) || node.receiver || node.block ||
    !["private_class_method", "private_constant"].includes(node.name) ||
    node.arguments_?.arguments_.length != 1 || !(node.arguments_.arguments_[0] instanceof SymbolNode)) return undefined

  return {
    kind: node.name == "private_class_method" ? "function" : "record",
    name: node.arguments_.arguments_[0].unescaped.value
  }
}

/**
 * Builds a parser-owned simple Ruby constant path without inspecting source text.
 * @param {ConstantReadNode | ConstantPathNode} node - Constant path.
 * @returns {string} Qualified constant name.
 */
function constantPathName(node) {
  if (node instanceof ConstantReadNode) return node.name
  if (typeof node.name != "string") throw new Error("Prism returned a constant path without a name.")
  if (!node.parent) return node.name
  if (!(node.parent instanceof ConstantReadNode) && !(node.parent instanceof ConstantPathNode)) {
    throw new Error("Prism returned an unsupported constant-path parent.")
  }

  return `${constantPathName(node.parent)}::${node.name}`
}
