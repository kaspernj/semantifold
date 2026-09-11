// @ts-check

import {parser} from "@lezer/java"
import {SemantifoldDiagnostic, missingType, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceReturnType, sourceScalarType} from "./scalars.js"
import {iterationBindingType, iterationOperandType, listType, mapType, optionalType, recordType} from "./types.js"

/** @type {Readonly<Record<string, string>>} */
const simpleStringEscapes = Object.freeze({
  "\"": "\"",
  "'": "'",
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  s: " ",
  t: "\t"
})
const javaBinaryOperations = new Map([
  ["+", "Add"],
  ["-", "Subtract"],
  ["*", "Multiply"],
  ["&&", "And"],
  ["||", "Or"],
  ["==", "JavaEqual"],
  ["!=", "JavaNotEqual"],
  ["<", "LessThan"],
  ["<=", "LessThanOrEqual"],
  [">", "GreaterThan"],
  [">=", "GreaterThanOrEqual"]
])

/**
 * @typedef JavaConversionContext
 * @property {Map<string, import("../semantic/types.js").SemanticValueType>} bindings - Explicitly typed visible bindings.
 * @property {Map<string, JavaFunctionSignature>} functions - Explicit module function signatures.
 * @property {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Records by source name.
 * @property {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Records by identity.
 * @property {import("../semantic/types.js").SemanticFunctionReturnType | undefined} returnType - Enclosing return type.
 */

/**
 * @typedef JavaFunctionSignature
 * @property {import("../semantic/types.js").SourceLocation} location - Complete declaration location.
 * @property {import("../semantic/types.js").SourceLocation} nameLocation - Parser-owned name location.
 * @property {string} name - Function name.
 * @property {import("../semantic/types.js").Parameter[]} parameters - Semantic parameters.
 * @property {import("../semantic/types.js").SemanticFunctionReturnType} returnType - Semantic return type.
 */

/**
 * Returns all direct child syntax nodes.
 * @param {import("@lezer/common").SyntaxNode} node - Parent syntax node.
 * @returns {import("@lezer/common").SyntaxNode[]} Child syntax nodes.
 */
function directChildren(node) {
  const children = []

  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child)

  return children
}

/**
 * Returns structural direct children, excluding known grammar delimiters.
 * @param {import("@lezer/common").SyntaxNode} node - Parent syntax node.
 * @returns {import("@lezer/common").SyntaxNode[]} Named children.
 */
function structuralChildren(node) {
  return directChildren(node).filter((child) => !["{", "}", "(", ")", ",", ";", "."].includes(child.name))
}

/**
 * Finds all descendant syntax nodes with a given name.
 * @param {import("@lezer/common").SyntaxNode} node - Root syntax node.
 * @param {string} name - Node name.
 * @returns {import("@lezer/common").SyntaxNode[]} Matching descendants.
 */
function descendants(node, name) {
  const matches = []

  for (const child of directChildren(node)) {
    if (child.name == name) matches.push(child)
    matches.push(...descendants(child, name))
  }

  return matches
}

/**
 * Requires one direct child node.
 * @param {import("@lezer/common").SyntaxNode} node - Parent node.
 * @param {string} name - Child name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("@lezer/common").SyntaxNode} Child node.
 */
function requiredChild(node, name, filename, source) {
  const child = node.getChild(name)

  if (!child) return unsupportedSyntax("java", `${node.name} without ${name}`, nodeLocation(node, filename, source))

  return child
}

/**
 * Returns a normalized Lezer node location.
 * @param {import("@lezer/common").SyntaxNode} node - Lezer node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Source location.
 */
function nodeLocation(node, filename, source) {
  return locationFromOffsets(filename, source, node.from, node.to)
}

/**
 * Returns source text belonging to a syntax node.
 * @param {import("@lezer/common").SyntaxNode} node - Lezer node.
 * @param {string} source - Complete source.
 * @returns {string} Node text.
 */
function nodeText(node, source) {
  return source.slice(node.from, node.to)
}

/**
 * Proves an exact parser-structured Java qualified identifier.
 * @param {import("@lezer/common").SyntaxNode} node - Identifier or field-access node.
 * @param {string} source - Complete source.
 * @returns {string[] | undefined} Exact structural name parts.
 */
function qualifiedNameParts(node, source) {
  if (["Identifier", "TypeName"].includes(node.name)) return [nodeText(node, source)]
  if (!["FieldAccess", "ScopedTypeName"].includes(node.name)) return undefined
  const children = structuralChildren(node)

  if (children.length != 2) return undefined
  const left = qualifiedNameParts(children[0], source)
  const right = qualifiedNameParts(children[1], source)

  return left && right ? [...left, ...right] : undefined
}

/**
 * Checks the only accepted Java Optional type/factory symbol spellings.
 * @param {import("@lezer/common").SyntaxNode} node - Parser-qualified symbol node.
 * @param {string} source - Complete source.
 * @returns {boolean} Whether the node identifies java.util.Optional or Optional.
 */
function isJavaOptionalSymbol(node, source) {
  const parts = qualifiedNameParts(node, source)

  return parts?.join(".") == "java.util.Optional" || parts?.join(".") == "Optional"
}

/**
 * Converts a supported Java expression node.
 * @param {import("@lezer/common").SyntaxNode} node - Lezer expression.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @param {import("../semantic/types.js").SemanticValueType} [expectedType] - Contextual semantic type.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source, context, expectedType) {
  const location = nodeLocation(node, filename, source)

  if (node.name == "ParenthesizedExpression") {
    const children = structuralChildren(node)

    if (children.length != 1) {
      return unsupportedSyntax("java", "unsupported parenthesized expression", location)
    }

    return convertExpression(children[0], filename, source, context, expectedType)
  }

  if (node.name == "Identifier") {
    return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: nodeText(node, source)}, {name: location})
  }

  if (node.name == "IntegerLiteral") {
    const value = Number(nodeText(node, source))

    if (!Number.isSafeInteger(value)) return unsupportedSyntax("java", "non-safe integer literal", location)

    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
  }

  if (node.name == "BooleanLiteral") {
    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: nodeText(node, source) == "true"}, {literal: location})
  }

  if (node.name == "StringLiteral") {
    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: decodeStringLiteral(node, filename, source)}, {literal: location})
  }

  if (node.name == "null") return unsupportedSyntax("java", "null reference", location)

  if (node.name == "ObjectCreationExpression") {
    const children = structuralChildren(node)
    const typeNode = children.find((child) => ["TypeName", "ScopedTypeName"].includes(child.name))
    const argumentList = node.getChild("ArgumentList")
    const declaration = typeNode ? context.recordNames.get(nodeText(typeNode, source)) : undefined

    if (!typeNode || !argumentList || !declaration || node.getChild("ClassBody")) {
      return unsupportedSyntax("java", "construction of a non-record or anonymous class", location)
    }
    const argumentNodes = structuralChildren(argumentList)

    return withParserRanges({
      arguments: argumentNodes.map((argument, index) =>
        convertExpression(argument, filename, source, context, declaration.fields[index]?.type)),
      kind: /** @type {const} */ ("RecordConstruction"),
      location,
      record: recordType(/** @type {string} */ (declaration.id), nodeLocation(typeNode, filename, source))
    }, {record: nodeLocation(typeNode, filename, source)})
  }

  if (node.name == "UnaryExpression") {
    const children = structuralChildren(node)
    const operatorNode = node.getChild("LogicOp") ?? node.getChild("ArithOp")
    const operand = children.find((child) => child.name != "LogicOp" && child.name != "ArithOp")
    const operator = operatorNode ? nodeText(operatorNode, source) : undefined

    if (!operatorNode || !operand || children.length != 2 || (operator != "!" && operator != "-")) {
      return unsupportedSyntax("java", "unary expression", location)
    }

    if (operator == "!" && operand.name == "MethodInvocation" && isEqualsInvocation(operand, source) &&
      !isZeroArgumentRecordMemberInvocation(operand, source, context)) {
      return convertStringEquality(operand, true, location, nodeLocation(operatorNode, filename, source), filename, source, context)
    }

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(operand, filename, source, context)
    }, {operator: nodeLocation(operatorNode, filename, source)}), operator == "!" ? "Not" : "Negate")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.name == "BinaryExpression") {
    const named = structuralChildren(node)
    const operatorNode = node.getChild("CompareOp") ?? node.getChild("ArithOp") ?? node.getChild("LogicOp") ?? node.getChild("BitOp")

    if (!operatorNode || named.length != 3) return unsupportedSyntax("java", "binary expression", location)

    const operands = [named[0], named[2]]
    const unsupportedOperand = operands.find((operand) => !isSupportedExpressionNode(operand))

    if (unsupportedOperand) return unsupportedSyntax("java", unsupportedOperand.name, nodeLocation(unsupportedOperand, filename, source))

    const operator = nodeText(operatorNode, source)

    if (!javaBinaryOperations.has(operator)) return unsupportedSyntax("java", `binary ${operator}`, location)

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(operands[0], filename, source, context),
      location,
      right: convertExpression(operands[1], filename, source, context)
    }, {operator: nodeLocation(operatorNode, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (javaBinaryOperations.get(operator)))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.name == "MethodInvocation") {
    if (isEqualsInvocation(node, source) && !isZeroArgumentRecordMemberInvocation(node, source, context)) {
      const methodName = requiredChild(node, "MethodName", filename, source)

      return convertStringEquality(node, false, location, nodeLocation(methodName, filename, source), filename, source, context)
    }

    const methodName = requiredChild(node, "MethodName", filename, source)
    const argumentList = requiredChild(node, "ArgumentList", filename, source)
    const argumentNodes = structuralChildren(argumentList)
    const receiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")
    const method = nodeText(methodName, source)
    const receiverText = receiver ? nodeText(receiver, source) : ""

    if (receiver && isJavaOptionalSymbol(receiver, source)) {
      const factoryLocation = nodeLocation(methodName, filename, source)

      if (method == "empty" && argumentNodes.length == 0) {
        return withParserRanges({kind: /** @type {const} */ ("OptionalNone"), location}, {
          absence: factoryLocation,
          factory: factoryLocation
        })
      }
      if (method == "of" && argumentNodes.length == 1) {
        return withParserRanges({
          kind: /** @type {const} */ ("OptionalSome"),
          location,
          value: convertExpression(argumentNodes[0], filename, source, context,
            expectedType?.kind == "OptionalType" ? expectedType.valueType : undefined)
        }, {factory: factoryLocation, some: factoryLocation})
      }

      return unsupportedSyntax("java", `unsupported Optional.${method}`, factoryLocation)
    }
    if (receiver?.name == "Identifier" && context.bindings.get(receiverText)?.kind == "OptionalType") {
      const operand = /** @type {import("../semantic/types.js").IdentifierExpression} */ (
        convertExpression(receiver, filename, source, context)
      )
      const operationLocation = nodeLocation(methodName, filename, source)

      if (method == "isPresent" && argumentNodes.length == 0) {
        return withParserRanges({kind: /** @type {const} */ ("OptionalIsPresent"), location, operand}, {
          operator: operationLocation
        })
      }
      if (method == "get" && argumentNodes.length == 0) {
        return withParserRanges({kind: /** @type {const} */ ("OptionalUnwrap"), location, operand}, {
          operator: operationLocation,
          unwrap: operationLocation
        })
      }

      return unsupportedSyntax("java", `unsupported Optional.${method}`, operationLocation)
    }

    if (receiver && method == "of" && receiverText == "java.util.List") {
      const elementType = expectedType?.kind == "ListType" ? expectedType.elementType : undefined

      return withParserRanges({
        elements: argumentNodes.map((argument) => convertExpression(argument, filename, source, context, elementType)),
        kind: /** @type {const} */ ("ListLiteral"),
        location
      }, {factory: nodeLocation(methodName, filename, source)})
    }
    if (receiver && method == "of" && receiverText == "java.util.Map") {
      if (argumentNodes.length % 2 != 0) return unsupportedSyntax("java", "Map.of odd argument count", location)
      if (argumentNodes.length > 20) {
        return unsupportedSyntax("java", "java.util.Map.of supports at most ten entries", nodeLocation(methodName, filename, source))
      }
      const entries = []
      const valueType = expectedType?.kind == "MapType" ? expectedType.valueType : undefined

      for (let index = 0; index < argumentNodes.length; index += 2) {
        const keyNode = argumentNodes[index]

        if (keyNode.name != "StringLiteral") {
          return unsupportedSyntax("java", "map key other than a string literal", nodeLocation(keyNode, filename, source))
        }
        const separator = directChildren(argumentList).find((child) => child.name == "," &&
          child.from >= keyNode.to && child.to <= argumentNodes[index + 1].from)

        if (!separator) throw new Error("Lezer omitted the Java Map.of entry separator.")
        entries.push(withParserRanges({
          key: /** @type {import("../semantic/types.js").StringLiteral} */ (convertExpression(keyNode, filename, source, context)),
          kind: /** @type {const} */ ("MapEntry"),
          location: locationFromOffsets(filename, source, keyNode.from, argumentNodes[index + 1].to),
          value: convertExpression(argumentNodes[index + 1], filename, source, context, valueType)
        }, {operator: nodeLocation(separator, filename, source)}))
      }

      return withParserRanges({entries, kind: /** @type {const} */ ("MapLiteral"), location}, {
        factory: nodeLocation(methodName, filename, source)
      })
    }
    if (receiver && method == "get" && argumentNodes.length == 1) {
      const receiverType = receiver.name == "Identifier" ? context.bindings.get(nodeText(receiver, source)) : undefined

      if (receiverType?.kind == "MapType" || (!receiverType && argumentNodes[0].name == "StringLiteral")) {
        return withParserRanges({
          collection: convertExpression(receiver, filename, source, context),
          key: convertExpression(argumentNodes[0], filename, source, context),
          kind: /** @type {const} */ ("MapLookupExpression"),
          location,
          totality: /** @type {const} */ ("proven")
        }, {operator: nodeLocation(methodName, filename, source)})
      }

      return withParserRanges({
        collection: convertExpression(receiver, filename, source, context),
        index: convertExpression(argumentNodes[0], filename, source, context),
        kind: /** @type {const} */ ("ListIndexExpression"),
        location,
        totality: /** @type {const} */ ("fail-on-absence")
      }, {operator: nodeLocation(methodName, filename, source)})
    }
    if (receiver && method == "size" && argumentNodes.length == 0) {
      const receiverType = knownExpressionType(receiver, context, source)

      if (receiverType?.kind == "RecordType") {
        return withParserRanges({
          field: method,
          kind: /** @type {const} */ ("MemberRead"),
          location,
          receiver: convertExpression(receiver, filename, source, context)
        }, {member: nodeLocation(methodName, filename, source)})
      }
      return withParserRanges({
        collection: convertExpression(receiver, filename, source, context),
        kind: /** @type {const} */ ("CollectionSizeExpression"),
        location
      }, {operator: nodeLocation(methodName, filename, source)})
    }

    if (receiver) {
      const qualifiedName = `${receiverText}.${method}`
      const qualifiedSignature = context.functions.get(qualifiedName)

      if (qualifiedSignature) {
        const arguments_ = argumentNodes.map((child, index) =>
          convertExpression(child, filename, source, context, qualifiedSignature.parameters[index]?.type))

        return withParserRanges({arguments: arguments_, callee: qualifiedName, kind: /** @type {const} */ ("CallExpression"), location}, {
          callee: nodeLocation(methodName, filename, source)
        })
      }
    }

    if (receiver && argumentNodes.length == 0) {
      if (["getClass", "hashCode", "toString", "clone", "notify", "notifyAll", "wait"].includes(method)) {
        return unsupportedSyntax("java", "reflective or Object member access", nodeLocation(methodName, filename, source))
      }
      return withParserRanges({
        field: method,
        kind: /** @type {const} */ ("MemberRead"),
        location,
        receiver: convertExpression(receiver, filename, source, context)
      }, {member: nodeLocation(methodName, filename, source)})
    }

    const unsupportedReceiver = receiver

    if (unsupportedReceiver) return unsupportedSyntax("java", "method invocation receiver", nodeLocation(unsupportedReceiver, filename, source))
    const unsupportedArgument = argumentNodes.find((child) => !isSupportedExpressionNode(child))

    if (unsupportedArgument) return unsupportedSyntax("java", `method argument ${unsupportedArgument.name}`, nodeLocation(unsupportedArgument, filename, source))

    const signature = context.functions.get(nodeText(methodName, source))
    const arguments_ = argumentNodes.map((child, index) =>
      convertExpression(child, filename, source, context, signature?.parameters[index]?.type))

    return withParserRanges({arguments: arguments_, callee: nodeText(methodName, source), kind: /** @type {const} */ ("CallExpression"), location}, {
      callee: nodeLocation(methodName, filename, source)
    })
  }

  return unsupportedSyntax("java", node.name, location)
}

/**
 * Checks the one parser-native Java string equality invocation form.
 * @param {import("@lezer/common").SyntaxNode} node - Method invocation node.
 * @param {string} source - Complete source.
 * @returns {boolean} Whether the invocation spells `.equals` with a receiver.
 */
function isEqualsInvocation(node, source) {
  const methodName = node.getChild("MethodName")
  const receivers = structuralChildren(node).filter((child) => child.name != "MethodName" && child.name != "ArgumentList")

  return methodName != null && nodeText(methodName, source) == "equals" && receivers.length == 1
}

/**
 * Distinguishes a zero-argument nominal field accessor from Java string equality syntax.
 * @param {import("@lezer/common").SyntaxNode} node - Method invocation node.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {boolean} Whether this is a known record receiver with no arguments.
 */
function isZeroArgumentRecordMemberInvocation(node, source, context) {
  const argumentList = node.getChild("ArgumentList")
  const receiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")

  return argumentList != null && structuralChildren(argumentList).length == 0 && receiver != null &&
    knownExpressionType(receiver, context, source)?.kind == "RecordType"
}

/**
 * Converts Java `.equals` or its directly negated form without source-text inference.
 * @param {import("@lezer/common").SyntaxNode} node - Parser method invocation.
 * @param {boolean} negated - Whether a parser-owned unary not wraps the invocation.
 * @param {import("../semantic/types.js").SourceLocation} location - Whole equality expression location.
 * @param {import("../semantic/types.js").SourceLocation} operatorLocation - Parser-owned operator/method location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").Expression} Adapted equality expression.
 */
function convertStringEquality(node, negated, location, operatorLocation, filename, source, context) {
  const argumentList = requiredChild(node, "ArgumentList", filename, source)
  const arguments_ = structuralChildren(argumentList)
  const receivers = structuralChildren(node).filter((child) => child.name != "MethodName" && child.name != "ArgumentList")
  const unsupportedArgument = arguments_.find((child) => !isSupportedExpressionNode(child))

  if (receivers.length != 1 || arguments_.length != 1 || unsupportedArgument) {
    return unsupportedSyntax("java", "string equals invocation", nodeLocation(node, filename, source))
  }

  /** @type {Record<string, import("../semantic/types.js").SourceLocation>} */
  const ranges = {operator: operatorLocation}

  if (negated) {
    ranges.equalityOperator = nodeLocation(requiredChild(node, "MethodName", filename, source), filename, source)
  }

  const semantic = withAdaptedOperation(withParserRanges({
    kind: "BinaryExpression",
    left: convertExpression(receivers[0], filename, source, context),
    location,
    right: convertExpression(arguments_[0], filename, source, context)
  }, ranges), negated ? "StringNotEqual" : "StringEqual")

  return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
}

/**
 * Checks whether a Lezer node is in the expression subset.
 * @param {import("@lezer/common").SyntaxNode} node - Java syntax node.
 * @returns {boolean} Whether the node is supported.
 */
function isSupportedExpressionNode(node) {
  return [
    "Identifier",
    "IntegerLiteral",
    "BooleanLiteral",
    "StringLiteral",
    "UnaryExpression",
    "BinaryExpression",
    "MethodInvocation",
    "ObjectCreationExpression",
    "null",
    "ParenthesizedExpression"
  ].includes(node.name)
}

/**
 * Applies Java Unicode translation before token-level string escape decoding.
 * @param {string} literal - Parser-confirmed Java string literal.
 * @param {import("../semantic/types.js").SourceLocation} location - Literal source location.
 * @returns {string} Unicode-translated literal.
 */
function translateUnicodeEscapes(literal, location) {
  let translated = ""
  let consecutiveBackslashes = 0
  let previousWasUnicodeEscape = false

  for (let index = 0; index < literal.length; index++) {
    const character = literal[index]
    const eligible = character == "\\" && (previousWasUnicodeEscape || consecutiveBackslashes % 2 == 0)

    if (eligible && literal[index + 1] == "u") {
      let digitsStart = index + 2

      while (literal[digitsStart] == "u") digitsStart++

      const hexadecimal = literal.slice(digitsStart, digitsStart + 4)
      const isHexadecimal = hexadecimal.length == 4 && [...hexadecimal].every((digit) =>
        (digit >= "0" && digit <= "9") || (digit >= "A" && digit <= "F") || (digit >= "a" && digit <= "f")
      )

      if (!isHexadecimal) return unsupportedSyntax("java", "unsupported string escape", location)

      const translatedCharacter = String.fromCharCode(Number.parseInt(hexadecimal, 16))

      translated += translatedCharacter
      consecutiveBackslashes = translatedCharacter == "\\" ? consecutiveBackslashes + 1 : 0
      previousWasUnicodeEscape = true
      index = digitsStart + 3
      continue
    }

    translated += character
    consecutiveBackslashes = character == "\\" ? consecutiveBackslashes + 1 : 0
    previousWasUnicodeEscape = false
  }

  return translated
}

/**
 * Decodes the accepted escapes from one parser-confirmed Java string literal.
 * @param {import("@lezer/common").SyntaxNode} node - Java StringLiteral node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {string} Decoded Unicode string.
 */
function decodeStringLiteral(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const literal = translateUnicodeEscapes(nodeText(node, source), location)
  let value = ""

  for (let index = 1; index < literal.length - 1; index++) {
    const character = literal[index]

    if (character == "\"" || character == "\n" || character == "\r") {
      return unsupportedSyntax("java", "invalid string literal", location)
    }

    if (character != "\\") {
      value += character
      continue
    }

    if (index + 1 >= literal.length - 1) return unsupportedSyntax("java", "invalid string literal", location)

    const escaped = literal[++index]
    const simple = simpleStringEscapes[escaped]

    if (simple !== undefined) {
      value += simple
      continue
    }

    if (escaped >= "0" && escaped <= "7") {
      let octal = escaped
      const maximumLength = escaped <= "3" ? 3 : 2

      while (octal.length < maximumLength && literal[index + 1] >= "0" && literal[index + 1] <= "7") {
        octal += literal[++index]
      }

      value += String.fromCharCode(Number.parseInt(octal, 8))
      continue
    }

    return unsupportedSyntax("java", "unsupported string escape", location)
  }

  if (!hasOnlyUnicodeScalars(value)) return unsupportedSyntax("java", "invalid Unicode string literal", location)

  return value
}

/**
 * Converts one explicit Java return statement.
 * @param {import("@lezer/common").SyntaxNode} statement - Java statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(statement, filename, source, context) {
  const location = nodeLocation(statement, filename, source)

  if (statement.name != "ReturnStatement") return unsupportedSyntax("java", statement.name, location)

  const expressionNodes = directChildren(statement).filter((child) => child.name != "return" && child.name != ";")
  const expression = expressionNodes.length == 1 ? expressionNodes[0] : undefined

  if (expressionNodes.length > 1) {
    const unsupported = expressionNodes[0]

    return unsupportedSyntax(
      "java",
      unsupported?.name ?? "return expression",
      unsupported ? nodeLocation(unsupported, filename, source) : location
    )
  }

  return {
    ...(expression ? {expression: convertExpression(
      expression,
      filename,
      source,
      context,
      context.returnType?.kind == "TypeReference" && context.returnType.name == "void"
        ? undefined
        : /** @type {import("../semantic/types.js").SemanticValueType | undefined} */ (context.returnType)
    )} : {}),
    kind: "ReturnStatement",
    location
  }
}

/**
 * Converts one Java local declaration or assignment.
 * @param {import("@lezer/common").SyntaxNode} statement - Java statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(statement, filename, source, context) {
  const location = nodeLocation(statement, filename, source)

  if (statement.name == "LocalVariableDeclaration") {
    const declarators = statement.getChildren("VariableDeclarator")
    const typeNode = declarationType(statement)
    const varNode = statement.getChild("var")
    const modifiers = statement.getChild("Modifiers")
    const modifierChildren = modifiers ? structuralChildren(modifiers) : []

    if (varNode) return unsupportedSyntax("java", "var local declaration", nodeLocation(varNode, filename, source))
    if (declarators.length != 1) return unsupportedSyntax("java", "multiple local declarators", location)
    if (!typeNode || typeNode.name == "ArrayType") return unsupportedSyntax("java", "unsupported local type", location)
    if (modifierChildren.some((child) => child.name != "final") || modifierChildren.length > 1) {
      return unsupportedSyntax("java", "unsupported local modifiers", modifiers ? nodeLocation(modifiers, filename, source) : location)
    }

    const declarator = declarators[0]
    const definition = requiredChild(declarator, "Definition", filename, source)
    const assignment = declarator.getChild("AssignOp")
    const dimensions = declarator.getChildren("Dimension")
    const initializerNodes = directChildren(declarator).filter((child) => child.name != "Definition" && child.name != "AssignOp")

    if (dimensions.length > 0) return unsupportedSyntax("java", "array local declaration", nodeLocation(declarator, filename, source))
    if (!assignment || nodeText(assignment, source) != "=" || initializerNodes.length != 1) {
      return unsupportedSyntax("java", "uninitialized local declaration", nodeLocation(declarator, filename, source))
    }

    const name = nodeText(definition, source)
    const type = convertType(typeNode, `Local '${name}'`, location, filename, source, context.recordNames)
    const initializer = convertExpression(initializerNodes[0], filename, source, context, type)

    context.bindings.set(name, type)

    return withParserRanges({
      initializer,
      kind: "LocalDeclaration",
      location,
      mutable: modifierChildren.length == 0,
      name,
      type
    }, {name: nodeLocation(definition, filename, source), operator: nodeLocation(assignment, filename, source)})
  }

  if (statement.name == "ExpressionStatement") {
    const assignment = statement.getChild("AssignmentExpression")

    if (!assignment) return unsupportedSyntax("java", statement.name, location)

    const children = structuralChildren(assignment)
    const operator = assignment.getChild("AssignOp")
    const target = children[0]
    const expression = children.at(-1)

    if (!operator || nodeText(operator, source) != "=") return unsupportedSyntax("java", "compound assignment", nodeLocation(assignment, filename, source))
    if (!target || target.name != "Identifier") return unsupportedSyntax("java", target?.name ?? "assignment target", target ? nodeLocation(target, filename, source) : location)
    if (!expression || expression == target || expression == operator) return unsupportedSyntax("java", "assignment expression", nodeLocation(assignment, filename, source))

    const targetExpression = withParserRanges({
      kind: /** @type {const} */ ("IdentifierExpression"),
      location: nodeLocation(target, filename, source),
      name: nodeText(target, source)
    }, {name: nodeLocation(target, filename, source)})

    const targetName = nodeText(target, source)
    const bindingType = context.bindings.get(targetName)
    const value = convertExpression(expression, filename, source, context, bindingType)

    return withParserRanges({
      expression: value,
      kind: "AssignmentStatement",
      location,
      target: targetExpression
    }, {operator: nodeLocation(operator, filename, source)})
  }

  return unsupportedSyntax("java", statement.name, location)
}

/**
 * Converts one exhaustive direct Java block child.
 * @param {import("@lezer/common").SyntaxNode} statement - Java statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(statement, filename, source, context) {
  if (statement.name == "ReturnStatement") return convertReturn(statement, filename, source, context)
  if (statement.name == "IfStatement") return convertIf(statement, filename, source, context)
  if (statement.name == "EnhancedForStatement") return convertForEach(statement, filename, source, context)
  if (statement.name == "BreakStatement" || statement.name == "ContinueStatement") {
    const label = statement.getChild("Label")

    if (label) return unsupportedSyntax("java", `labeled ${statement.name == "BreakStatement" ? "break" : "continue"}`,
      nodeLocation(label, filename, source))
    const keyword = requiredChild(statement, statement.name == "BreakStatement" ? "break" : "continue", filename, source)
    const location = nodeLocation(keyword, filename, source)

    return withParserRanges({
      kind: /** @type {"BreakStatement" | "ContinueStatement"} */ (
        statement.name == "BreakStatement" ? "BreakStatement" : "ContinueStatement"
      ),
      location
    }, {keyword: location})
  }
  if (statement.name == "LocalVariableDeclaration") return convertLocalStatement(statement, filename, source, context)
  if (statement.name == "ExpressionStatement") {
    if (statement.getChild("AssignmentExpression")) return convertLocalStatement(statement, filename, source, context)
    const invocation = statement.getChild("MethodInvocation")

    if (!invocation) {
      return unsupportedSyntax("java", statement.name, nodeLocation(statement, filename, source))
    }
    const fieldAccess = invocation.getChild("FieldAccess")
    const methodName = invocation.getChild("MethodName")

    if (!fieldAccess || !methodName || nodeText(fieldAccess, source) != "System.out" || nodeText(methodName, source) != "println") {
      return {
        expression: /** @type {import("../semantic/types.js").CallExpression} */ (
          convertExpression(invocation, filename, source, context)
        ),
        kind: "ExpressionStatement",
        location: nodeLocation(statement, filename, source)
      }
    }

    return convertPrint(statement, filename, source, context)
  }

  return unsupportedSyntax("java", statement.name, nodeLocation(statement, filename, source))
}

/**
 * Converts exact Java enhanced-for syntax over one resolved `List<T>`.
 * @param {import("@lezer/common").SyntaxNode} node - Enhanced-for statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").ForEachStatement} Semantic loop.
 */
function convertForEach(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)
  const spec = node.getChild("ForSpec")
  const body = directChildren(node).findLast((child) => child.name != "ForSpec" && child.name != "for")

  if (!spec) return unsupportedSyntax("java", "enhanced for without specification", location)
  if (!body || body.name != "Block") return unsupportedSyntax("java", "enhanced for without block body", body ? nodeLocation(body, filename, source) : location)
  const children = directChildren(spec)
  const colonIndex = children.findIndex((child) => child.name == ":")
  const typeNode = colonIndex >= 2 ? children[colonIndex - 2] : undefined
  const bindingNode = colonIndex >= 2 ? children[colonIndex - 1] : undefined
  const collectionNode = colonIndex >= 0 ? children[colonIndex + 1] : undefined

  if (!typeNode || !bindingNode || bindingNode.name != "Definition" || !collectionNode ||
    children.filter((child) => child.name == ":").length != 1) {
    const unsupported = bindingNode ?? collectionNode ?? spec

    return unsupportedSyntax("java", "malformed enhanced for specification", nodeLocation(unsupported, filename, source))
  }
  if (children.some((child) => child.name == "Modifiers")) {
    const modifiers = /** @type {import("@lezer/common").SyntaxNode} */ (children.find((child) => child.name == "Modifiers"))

    return unsupportedSyntax("java", "enhanced for modifiers", nodeLocation(modifiers, filename, source))
  }
  const bindingLocation = nodeLocation(bindingNode, filename, source)
  const declaredType = convertJavaTypeArgument(typeNode, `Iteration binding '${nodeText(bindingNode, source)}'`, bindingLocation, filename, source, context.recordNames)
  const collectionType = iterationOperandType(knownExpressionType(collectionNode, context, source))

  if (!collectionType || collectionType.kind != "ListType" && collectionType.kind != "MapType") {
    return missingType("java", "Iteration collection", nodeLocation(collectionNode, filename, source))
  }
  const valueBinding = withParserRanges({
    kind: /** @type {const} */ ("ValueBinding"),
    location: bindingLocation,
    mutable: /** @type {const} */ (false),
    name: nodeText(bindingNode, source),
    type: declaredType
  }, {name: bindingLocation})
  const bodyContext = {...context, bindings: new Map(context.bindings)}

  bodyContext.bindings.set(valueBinding.name, iterationBindingType(declaredType, bindingLocation))
  return withParserRanges({
    body: convertBlock(body, filename, source, bodyContext),
    kind: /** @type {const} */ ("ForEachStatement"),
    list: convertExpression(collectionNode, filename, source, context),
    location,
    valueBinding
  }, {operator: nodeLocation(children[colonIndex], filename, source)})
}

/**
 * Resolves expression types established by Java declarations and function signatures.
 * @param {import("@lezer/common").SyntaxNode} node - Parser expression.
 * @param {JavaConversionContext} context - Typed context.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | undefined} Known type.
 */
function knownExpressionType(node, context, source) {
  if (node.name == "ParenthesizedExpression") {
    const children = structuralChildren(node)

    return children.length == 1 ? knownExpressionType(children[0], context, source) : undefined
  }
  if (node.name == "Identifier") return context.bindings.get(nodeText(node, source))
  if (node.name == "MethodInvocation") {
    const methodName = node.getChild("MethodName")
    const argumentList = node.getChild("ArgumentList")
    const receiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")

    if (methodName && !receiver) return context.functions.get(nodeText(methodName, source))?.returnType
    if (methodName && receiver) {
      const qualified = `${nodeText(receiver, source)}.${nodeText(methodName, source)}`
      const returnType = context.functions.get(qualified)?.returnType

      if (returnType) return returnType
    }
    if (methodName && receiver && argumentList && nodeText(methodName, source) == "get") {
      const arguments_ = structuralChildren(argumentList)
      const receiverType = knownExpressionType(receiver, context, source)

      if (arguments_.length == 0 && receiver.name == "Identifier" && receiverType?.kind == "OptionalType") {
        return receiverType.valueType
      }
      if (arguments_.length == 1 && receiverType?.kind == "ListType") return receiverType.elementType
      if (arguments_.length == 1 && receiverType?.kind == "MapType") return receiverType.valueType
    }
    if (methodName && receiver && argumentList && structuralChildren(argumentList).length == 0) {
      const receiverType = knownExpressionType(receiver, context, source)
      const declaration = receiverType?.kind == "RecordType" ? context.records.get(receiverType.declarationId) : undefined

      return declaration?.fields.find((field) => field.name == nodeText(methodName, source))?.type
    }
  }
  if (node.name == "ObjectCreationExpression") {
    const typeNode = structuralChildren(node).find((child) => ["TypeName", "ScopedTypeName"].includes(child.name))
    const declaration = typeNode ? context.recordNames.get(nodeText(typeNode, source)) : undefined

    if (declaration?.id) return {declarationId: declaration.id, kind: "RecordType"}
  }

  return undefined
}

/**
 * Converts direct structural children of one Java block in source order.
 * @param {import("@lezer/common").SyntaxNode} node - Java Block node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(node, filename, source, context) {
  if (node.name != "Block") return unsupportedSyntax("java", `expected block, received ${node.name}`, nodeLocation(node, filename, source))

  return {
    kind: "Block",
    location: nodeLocation(node, filename, source),
    statements: structuralChildren(node).map((statement) => convertStatement(statement, filename, source, context))
  }
}

/**
 * Requires an exact Java scalar type node.
 * @param {import("@lezer/common").SyntaxNode | null} sourceType - Java type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, subject, location, filename, source, recordNames = new Map()) {
  if (!sourceType) return missingType("java", subject, location)
  if (sourceType.name == "void") return unsupportedSyntax("java", "void value type", nodeLocation(sourceType, filename, source))
  if (sourceType.name == "GenericType") {
    const children = structuralChildren(sourceType)
    const nameNode = children[0]
    const argumentsNode = children[1]

    if (!nameNode || !argumentsNode || argumentsNode.name != "TypeArguments") {
      return unsupportedSyntax("java", "malformed generic collection type", nodeLocation(sourceType, filename, source))
    }
    const name = nodeText(nameNode, source)
    const arguments_ = structuralChildren(argumentsNode)

    if (name == "java.util.List" && arguments_.length == 1) {
      return listType(
        convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source)
      )
    }
    if (name == "java.util.Map" && arguments_.length == 2) {
      const keyType = convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames)

      if (keyType.kind != "TypeReference") {
        return unsupportedSyntax("java", "map key type other than string", nodeLocation(arguments_[0], filename, source))
      }
      return mapType(
        keyType,
        convertJavaTypeArgument(arguments_[1], subject, location, filename, source, recordNames),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source),
        nodeLocation(arguments_[1], filename, source)
      )
    }
    if ((name == "java.util.Optional" || name == "Optional") && arguments_.length == 1) {
      return optionalType(
        convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source)
      )
    }

    return unsupportedSyntax("java", "unsupported generic type", nodeLocation(sourceType, filename, source))
  }
  if (!["PrimitiveType", "TypeName", "ScopedTypeName"].includes(sourceType.name)) {
    return unsupportedSyntax("java", "unsupported scalar type", location)
  }

  const declaration = recordNames.get(nodeText(sourceType, source))

  if (declaration?.id) return recordType(declaration.id, nodeLocation(sourceType, filename, source))

  const type = sourceScalarType("java", nodeText(sourceType, source), nodeLocation(sourceType, filename, source))

  if (!type) return unsupportedSyntax("java", "unsupported scalar type", nodeLocation(sourceType, location.filename, source))

  return type
}

/**
 * Converts one exact boxed Java collection type argument or nested collection.
 * @param {import("@lezer/common").SyntaxNode} node - Type argument node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Owning location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertJavaTypeArgument(node, subject, location, filename, source, recordNames = new Map()) {
  if (node.name == "GenericType") return convertType(node, subject, location, filename, source, recordNames)
  const declaration = recordNames.get(nodeText(node, source))

  if (declaration?.id) return recordType(declaration.id, nodeLocation(node, filename, source))
  const spelling = nodeText(node, source)
  const scalar = spelling == "Integer" ? "integer" : spelling == "Boolean" ? "boolean" : spelling == "String" ? "string" : undefined

  if (!scalar) return unsupportedSyntax("java", "unsupported collection type argument", nodeLocation(node, filename, source))
  const type = {kind: /** @type {const} */ ("TypeReference"), name: /** @type {import("../semantic/types.js").SemanticTypeName} */ (scalar)}

  return withParserRanges(type, {type: nodeLocation(node, filename, source)})
}

/**
 * Converts one explicit Java function return type.
 * @param {import("@lezer/common").SyntaxNode | null} sourceType - Java return type node.
 * @param {string} subject - Typed function return.
 * @param {import("../semantic/types.js").SourceLocation} location - Function location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} [recordNames] - Record declarations by source name.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertReturnType(sourceType, subject, location, filename, source, recordNames = new Map()) {
  if (sourceType?.name == "void") {
    return requireSourceReturnType("java", "void", subject, location, nodeLocation(sourceType, filename, source))
  }

  return convertType(sourceType, subject, location, filename, source, recordNames)
}

/**
 * Returns the direct Java declaration type node supported by scalar conversion.
 * @param {import("@lezer/common").SyntaxNode} node - Declaration node.
 * @returns {import("@lezer/common").SyntaxNode | null} Type syntax node.
 */
function declarationType(node) {
  return node.getChild("GenericType") ?? node.getChild("PrimitiveType") ?? node.getChild("TypeName") ?? node.getChild("ScopedTypeName") ?? node.getChild("void")
}

/**
 * Converts one supported Java function signature before adapting any body.
 * @param {import("@lezer/common").SyntaxNode} node - Method declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @param {boolean} [programFunction] - Whether the canonical project profile admits explicit public or private visibility.
 * @returns {JavaFunctionSignature} Semantic function signature.
 */
function convertFunctionSignature(node, filename, source, recordNames, programFunction = false) {
  const location = nodeLocation(node, filename, source)
  const modifiers = node.getChild("Modifiers")
  const modifierNames = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name) : []

  const requiredModifiers = programFunction ? "public or private static" : "private static"
  const modifiersText = modifierNames.join(" ")

  if (programFunction ? !["public static", "private static"].includes(modifiersText) : modifiersText != "private static") {
    return unsupportedSyntax("java", `semantic function without ${requiredModifiers}`, modifiers ? nodeLocation(modifiers, filename, source) : location)
  }
  const typeParameters = node.getChild("TypeParameters")
  const throws = node.getChild("Throws")

  if (typeParameters) return unsupportedSyntax("java", "generic method", nodeLocation(typeParameters, filename, source))
  if (throws) return unsupportedSyntax("java", "checked throws", nodeLocation(throws, filename, source))
  const definition = requiredChild(node, "Definition", filename, source)
  const name = nodeText(definition, source)
  const parametersNode = requiredChild(node, "FormalParameters", filename, source)
  const parameterNodes = structuralChildren(parametersNode)
  const unsupportedParameter = parameterNodes.find((parameter) => parameter.name != "FormalParameter")

  if (unsupportedParameter) {
    return unsupportedSyntax("java", "unsupported parameter form", nodeLocation(unsupportedParameter, filename, source))
  }
  const parameters = parameterNodes.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)
    const parameterChildren = structuralChildren(parameter)

    if (parameterChildren.length != 2 || parameter.getChild("Modifiers") || parameter.getChild("Dimension")) {
      return unsupportedSyntax("java", "unsupported parameter form", parameterLocation)
    }
    const parameterNameNode = requiredChild(parameter, "Definition", filename, source)
    const parameterName = nodeText(parameterNameNode, source)

    const semanticParameter = {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: convertType(declarationType(parameter), `Parameter '${parameterName}'`, parameterLocation, filename, source, recordNames)
    }

    return withParserRanges(semanticParameter, {name: nodeLocation(parameterNameNode, filename, source)})
  })
  return {
    location,
    name,
    nameLocation: nodeLocation(definition, filename, source),
    parameters,
    returnType: convertReturnType(declarationType(node), `Function '${name}' return`, location, filename, source, recordNames)
  }
}

/**
 * Converts one Java function body using already-proved module signatures.
 * @param {import("@lezer/common").SyntaxNode} node - Method declaration.
 * @param {JavaFunctionSignature} signature - Preconverted function signature.
 * @param {Map<string, JavaFunctionSignature>} functions - Module function signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, recordNames, records, filename, source) {
  const block = requiredChild(node, "Block", filename, source)
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    functions,
    recordNames,
    records,
    returnType: signature.returnType
  }

  return withParserRanges({
    body: convertBlock(block, filename, source, context),
    kind: "FunctionDeclaration",
    location: signature.location,
    name: signature.name,
    parameters: signature.parameters,
    returnType: signature.returnType
  }, {name: signature.nameLocation})
}

/**
 * Converts one conventional final Java class with exact private-final storage,
 * constructor initialization, and canonical field-name accessors.
 * @param {import("@lezer/common").SyntaxNode} node - Class declaration.
 * @param {import("../semantic/types.js").RecordDeclaration} declaration - Predeclared nominal identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Records by source name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} [programRecord] - Whether the canonical project profile admits public or package-private class visibility.
 * @returns {import("../semantic/types.js").RecordDeclaration} Semantic record.
 */
function convertJavaRecord(node, declaration, recordNames, filename, source, programRecord = false) {
  const location = nodeLocation(node, filename, source)
  const modifiers = node.getChild("Modifiers")
  const modifierNames = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name) : []

  const modifiersText = modifierNames.join(" ")

  if ((programRecord ? !["public final", "final"].includes(modifiersText) : modifiersText != "final") ||
    node.getChild("Superclass") || node.getChild("SuperInterfaces") ||
    node.getChild("TypeParameters")) return unsupportedSyntax("java", "noncanonical record class modifiers", location)
  const classBody = requiredChild(node, "ClassBody", filename, source)
  const members = structuralChildren(classBody)
  const fields = members.filter((member) => member.name == "FieldDeclaration")
  const constructors = members.filter((member) => member.name == "ConstructorDeclaration")
  const accessors = members.filter((member) => member.name == "MethodDeclaration")
  const unsupported = members.find((member) => !["FieldDeclaration", "ConstructorDeclaration", "MethodDeclaration"].includes(member.name))

  if (unsupported || constructors.length != 1 || accessors.length != fields.length ||
    members.slice(0, fields.length).some((member) => member.name != "FieldDeclaration") || members[fields.length] != constructors[0] ||
    members.slice(fields.length + 1).some((member) => member.name != "MethodDeclaration")) {
    return unsupportedSyntax("java", "record class member order or shape", nodeLocation(unsupported ?? node, filename, source))
  }
  declaration.fields = fields.map((fieldNode) => {
    const fieldLocation = nodeLocation(fieldNode, filename, source)
    const fieldModifiers = fieldNode.getChild("Modifiers")
    const names = fieldModifiers ? structuralChildren(fieldModifiers).map((modifier) => modifier.name) : []
    const variable = requiredChild(fieldNode, "VariableDeclarator", filename, source)
    const definition = requiredChild(variable, "Definition", filename, source)
    const variableChildren = structuralChildren(variable)

    if (names.join(" ") != "private final" || variableChildren.length != 1 || fieldNode.getChild("Dimension")) {
      return unsupportedSyntax("java", "record field outside private final storage profile", fieldLocation)
    }
    const field = {
      kind: /** @type {const} */ ("RecordField"),
      location: fieldLocation,
      name: nodeText(definition, source),
      type: convertType(declarationType(fieldNode), `Record field '${nodeText(definition, source)}'`, fieldLocation, filename, source, recordNames)
    }

    return withParserRanges(field, {name: nodeLocation(definition, filename, source)})
  })
  const constructor = constructors[0]
  const constructorName = requiredChild(constructor, "Definition", filename, source)
  const parametersNode = requiredChild(constructor, "FormalParameters", filename, source)
  const parameters = structuralChildren(parametersNode)
  const body = requiredChild(constructor, "ConstructorBody", filename, source)
  const assignments = structuralChildren(body)

  const constructorModifiers = constructor.getChild("Modifiers")
  const constructorModifierNames = constructorModifiers ? structuralChildren(constructorModifiers).map((modifier) => modifier.name) : []

  if (nodeText(constructorName, source) != declaration.name ||
    constructorModifierNames.join(" ") != (programRecord ? "public" : "") || constructor.getChild("Throws") ||
    constructor.getChild("TypeParameters") || parameters.length != declaration.fields.length || assignments.length != declaration.fields.length) {
    return unsupportedSyntax("java", "noncanonical record constructor", nodeLocation(constructor, filename, source))
  }
  for (let index = 0; index < declaration.fields.length; index += 1) {
    const field = declaration.fields[index]
    const parameter = parameters[index]
    const parameterName = parameter?.getChild("Definition")
    const assignment = assignments[index]
    const assignmentExpression = assignment?.getChild("AssignmentExpression")
    const assignmentChildren = assignmentExpression ? structuralChildren(assignmentExpression) : []
    const fieldAccess = assignmentChildren[0]
    const operator = assignmentChildren[1]
    const value = assignmentChildren[2]
    const parameterType = parameter ? convertType(declarationType(parameter), `Record constructor parameter '${field.name}'`,
      nodeLocation(parameter, filename, source), filename, source, recordNames) : undefined

    if (parameter?.name != "FormalParameter" || !parameterName || nodeText(parameterName, source) != field.name ||
      parameter.getChild("Modifiers") || parameter.getChild("Dimension") || JSON.stringify(parameterType) != JSON.stringify(field.type) ||
      assignment?.name != "ExpressionStatement" || assignmentChildren.length != 3 || fieldAccess?.name != "FieldAccess" ||
      nodeText(fieldAccess, source) != `this.${field.name}` || operator?.name != "AssignOp" || nodeText(operator, source) != "=" ||
      value?.name != "Identifier" || nodeText(value, source) != field.name) {
      return unsupportedSyntax("java", "record field not initialized exactly once", nodeLocation(assignment ?? constructor, filename, source))
    }
  }
  for (let index = 0; index < declaration.fields.length; index += 1) {
    const field = declaration.fields[index]
    const accessor = accessors[index]
    const name = requiredChild(accessor, "Definition", filename, source)
    const parameters = requiredChild(accessor, "FormalParameters", filename, source)
    const block = requiredChild(accessor, "Block", filename, source)
    const statements = structuralChildren(block)
    const returned = statements[0]?.getChild("FieldAccess")
    const accessorType = convertType(declarationType(accessor), `Record accessor '${field.name}'`,
      nodeLocation(accessor, filename, source), filename, source, recordNames)

    const accessorModifiers = accessor.getChild("Modifiers")
    const accessorModifierNames = accessorModifiers ? structuralChildren(accessorModifiers).map((modifier) => modifier.name) : []

    if (accessorModifierNames.join(" ") != (programRecord ? "public" : "") || accessor.getChild("Throws") || accessor.getChild("TypeParameters") ||
      nodeText(name, source) != field.name || structuralChildren(parameters).length != 0 || statements.length != 1 ||
      statements[0].name != "ReturnStatement" || !returned || nodeText(returned, source) != `this.${field.name}` ||
      JSON.stringify(accessorType) != JSON.stringify(field.type)) {
      return unsupportedSyntax("java", "noncanonical record accessor", nodeLocation(accessor, filename, source))
    }
  }

  return withParserRanges(declaration, {name: nodeLocation(requiredChild(node, "Definition", filename, source), filename, source)})
}

/**
 * Detects only the pinned grammar's parser-backed recovery shape for Java record syntax.
 * @param {import("@lezer/common").SyntaxNode} root - Program root.
 * @param {string} source - Complete source.
 * @returns {import("@lezer/common").SyntaxNode | undefined} The parser-owned `record` type token.
 */
function javaRecordRecoveryToken(root, source) {
  const first = structuralChildren(root)[0]
  const type = first?.name == "LocalVariableDeclaration" ? first.getChild("TypeName") : null

  return type && nodeText(type, source) == "record" ? type : undefined
}

/**
 * Converts the existing exact Java if/else terminal with restricted branch prefixes.
 * @param {import("@lezer/common").SyntaxNode} node - Java if statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)
  const conditionContainer = requiredChild(node, "ParenthesizedExpression", filename, source)
  const conditionNodes = structuralChildren(conditionContainer)
  const condition = conditionNodes.length == 1 ? conditionNodes[0] : undefined
  const direct = directChildren(node)
  const conditionIndex = direct.findIndex((child) => child.name == conditionContainer.name &&
    child.from == conditionContainer.from && child.to == conditionContainer.to)
  const consequentNode = direct[conditionIndex + 1]
  const alternateNode = direct.at(-1) == consequentNode ? undefined : direct.at(-1)

  if (!condition || !consequentNode || consequentNode.name != "Block") {
    return unsupportedSyntax("java", "if without block consequent", location)
  }

  const semanticCondition = convertExpression(condition, filename, source, context)
  let alternate
  const consequentContext = {...context, bindings: new Map(context.bindings)}
  const alternateContext = {...context, bindings: new Map(context.bindings)}

  if (alternateNode?.name == "Block") {
    alternate = convertBlock(alternateNode, filename, source, alternateContext)
  } else if (alternateNode?.name == "IfStatement") {
    alternate = {
      kind: /** @type {const} */ ("Block"),
      location: nodeLocation(alternateNode, filename, source),
      statements: [convertIf(alternateNode, filename, source, alternateContext)]
    }
  } else if (alternateNode && alternateNode.name != "else") {
    return unsupportedSyntax("java", `if alternate ${alternateNode.name}`, nodeLocation(alternateNode, filename, source))
  }

  return {
    ...(alternate ? {alternate} : {}),
    condition: semanticCondition,
    consequent: convertBlock(consequentNode, filename, source, consequentContext),
    kind: "IfStatement",
    location
  }
}

/**
 * Converts Java's supported main method.
 * @param {import("@lezer/common").SyntaxNode} node - Main method.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, JavaFunctionSignature>} functions - Module function signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} recordNames - Record declarations by source name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @returns {import("../semantic/types.js").EntryPoint} Semantic entry point.
 */
function convertEntryPoint(node, filename, source, functions, recordNames, records) {
  const location = nodeLocation(node, filename, source)
  const modifiers = node.getChild("Modifiers")
  const parameters = node.getChild("FormalParameters")
  const definition = node.getChild("Definition")
  const returnType = node.getChild("void")
  const modifierNames = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name) : []
  const parameterNodes = parameters ? structuralChildren(parameters) : []
  const parameter = parameterNodes[0]
  const parameterType = parameter?.getChild("ArrayType")
  const parameterName = parameter?.getChild("Definition")

  if (modifierNames.join(" ") != "public static" || !parameters || parameterNodes.length != 1 ||
    parameter?.name != "FormalParameter" || nodeText(parameterType ?? node, source) != "String[]" ||
    nodeText(parameterName ?? node, source) != "args" || !definition || nodeText(definition, source) != "main" || !returnType ||
    node.getChild("TypeParameters") || node.getChild("Throws")) {
    return unsupportedSyntax("java", "main method signature", location)
  }
  const block = requiredChild(node, "Block", filename, source)
  const body = convertBlock(block, filename, source, {
    bindings: new Map(),
    functions,
    recordNames,
    records,
    returnType: undefined
  })

  return {body, kind: "EntryPoint", location}
}

/**
 * Converts one supported Java print statement.
 * @param {import("@lezer/common").SyntaxNode} statement - Expression statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").PrintStatement} Semantic print.
 */
function convertPrint(statement, filename, source, context) {
  const location = nodeLocation(statement, filename, source)

  const printInvocation = statement.getChild("MethodInvocation")

  if (!printInvocation) return unsupportedSyntax("java", "main without System.out.println", location)

  const fieldAccess = printInvocation.getChild("FieldAccess")
  const methodName = printInvocation.getChild("MethodName")

  if (!fieldAccess || !methodName || nodeText(fieldAccess, source) != "System.out" || nodeText(methodName, source) != "println") {
    return unsupportedSyntax("java", "main without System.out.println", nodeLocation(printInvocation, filename, source))
  }

  const argumentList = requiredChild(printInvocation, "ArgumentList", filename, source)
  const arguments_ = structuralChildren(argumentList)

  if (arguments_.length != 1) {
    return unsupportedSyntax("java", "println without one supported argument", nodeLocation(argumentList, filename, source))
  }

  const printLocation = nodeLocation(printInvocation, filename, source)

  return {expression: convertExpression(arguments_[0], filename, source, context), kind: "PrintStatement", location: printLocation}
}

/**
 * Parses Java into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @param {{isEntry: boolean, functions: Map<string, import("../semantic/types.js").FunctionDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>}} [input.program] - Resolved program imports and entry role.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseJava({filename, source, program}) {
  const tree = parser.parse(source)
  const error = descendants(tree.topNode, "⚠")[0]

  if (error) {
    const recordToken = javaRecordRecoveryToken(tree.topNode, source)

    if (recordToken) return unsupportedSyntax("java", "Java record declaration under the pinned parser", nodeLocation(recordToken, filename, source))
    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "java",
      location: nodeLocation(error, filename, source),
      message: "Java parser reported invalid syntax."
    })
  }

  if (program) return parseJavaProgramModule(tree.topNode, filename, source, program)

  const programMembers = structuralChildren(tree.topNode)
  const classDeclarations = programMembers.filter((member) => member.name == "ClassDeclaration")
  const unexpectedProgramMember = programMembers.find((member) => member.name != "ClassDeclaration")
  const mainClasses = classDeclarations.filter((declaration) => nodeText(requiredChild(declaration, "Definition", filename, source), source) == "Main")
  const classDeclaration = mainClasses[0]

  if (!classDeclaration || mainClasses.length != 1 || unexpectedProgramMember || classDeclarations.at(-1) != classDeclaration) {
    return unsupportedSyntax("java", "compilation unit other than record classes followed by one Main class",
      nodeLocation(unexpectedProgramMember ?? tree.topNode, filename, source))
  }
  const className = requiredChild(classDeclaration, "Definition", filename, source)
  const classModifiers = classDeclaration.getChild("Modifiers")
  const classModifierNames = classModifiers ? structuralChildren(classModifiers).map((modifier) => modifier.name) : []

  if (nodeText(className, source) != "Main" || classModifierNames.join(" ") != "public final") {
    return unsupportedSyntax("java", "public final Main class", nodeLocation(classDeclaration, filename, source))
  }
  const classBody = requiredChild(classDeclaration, "ClassBody", filename, source)
  const members = structuralChildren(classBody)
  const unsupportedMember = members.find((member) => member.name != "MethodDeclaration")

  if (unsupportedMember) return unsupportedSyntax("java", unsupportedMember.name, nodeLocation(unsupportedMember, filename, source))
  const methods = members
  const mainMethods = methods.filter((method) => nodeText(requiredChild(method, "Definition", filename, source), source) == "main")
  const mainMethod = mainMethods[0]
  const functionMethods = methods.filter((method) => method != mainMethod)
  const location = moduleLocation(filename, source)

  if (functionMethods.length == 0) return unsupportedSyntax("java", "class without a semantic function", location)
  if (!mainMethod || mainMethods.length != 1) return unsupportedSyntax("java", "class without one unambiguous main", location)

  const recordNodes = classDeclarations.filter((declaration) => declaration != classDeclaration)
  const recordDeclarations = recordNodes.map((recordNode, index) => ({
    fields: [],
    id: `record:${index}`,
    kind: /** @type {const} */ ("RecordDeclaration"),
    location: nodeLocation(recordNode, filename, source),
    name: nodeText(requiredChild(recordNode, "Definition", filename, source), source)
  }))
  const recordNames = new Map(recordDeclarations.map((declaration) => [declaration.name, declaration]))
  const recordsById = new Map(recordDeclarations.map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const records = recordNodes.map((recordNode, index) =>
    convertJavaRecord(recordNode, recordDeclarations[index], recordNames, filename, source))
  const signatures = functionMethods.map((method) => convertFunctionSignature(method, filename, source, recordNames))
  const functionSignatures = new Map(signatures.map((signature) => [signature.name, signature]))
  const functions = functionMethods.map((method, index) =>
    convertFunction(method, signatures[index], functionSignatures, recordNames, recordsById, filename, source))
  const entryPoint = convertEntryPoint(mainMethod, filename, source, functionSignatures, recordNames, recordsById)

  return {entryPoint, functions, kind: "Module", location, ...(records.length > 0 ? {records} : {})}
}

/**
 * Converts one already-qualified canonical Java compilation unit.
 * @param {import("@lezer/common").SyntaxNode} root - Error-free Program node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @param {{isEntry: boolean, functions: Map<string, import("../semantic/types.js").FunctionDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>}} program - Resolved program imports and entry role.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
function parseJavaProgramModule(root, filename, source, program) {
  inspectJavaModule({filename, source})
  const classDeclaration = /** @type {import("@lezer/common").SyntaxNode} */ (structuralChildren(root).find((node) => node.name == "ClassDeclaration"))
  const classModifiers = classDeclaration.getChild("Modifiers")
  const classModifierNames = classModifiers ? structuralChildren(classModifiers).map(({name}) => name) : []
  const classBody = requiredChild(classDeclaration, "ClassBody", filename, source)
  const members = structuralChildren(classBody)
  const mainMethods = members.filter((method) => method.name == "MethodDeclaration" &&
    nodeText(requiredChild(method, "Definition", filename, source), source) == "main")
  const isRecord = members.some((member) => member.name == "FieldDeclaration" || member.name == "ConstructorDeclaration")
  const location = moduleLocation(filename, source)

  if (program.isEntry && classModifierNames.join(" ") != "public final") {
    return unsupportedSyntax("java", "selected entry class without public final visibility", nodeLocation(classDeclaration, filename, source))
  }
  if (program.isEntry && mainMethods.length != 1) return unsupportedSyntax("java", "selected entry class without one main method", location)
  if (!program.isEntry && mainMethods.length > 0) return unsupportedSyntax("java", "main method outside the selected entry module", nodeLocation(mainMethods[0], filename, source))
  if (isRecord && mainMethods.length > 0) return unsupportedSyntax("java", "record class containing main", nodeLocation(classDeclaration, filename, source))

  const recordDeclarations = isRecord ? [{
    fields: [],
    id: "record:0",
    kind: /** @type {const} */ ("RecordDeclaration"),
    location: nodeLocation(classDeclaration, filename, source),
    name: nodeText(requiredChild(classDeclaration, "Definition", filename, source), source)
  }] : []
  const recordNames = new Map(program.records)

  for (const declaration of recordDeclarations) recordNames.set(declaration.name, declaration)
  const recordsById = new Map([...recordNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const records = recordDeclarations.map((declaration) =>
    convertJavaRecord(classDeclaration, declaration, recordNames, filename, source, true))
  const functionMethods = isRecord ? [] : members.filter((member) => member.name == "MethodDeclaration" && !mainMethods.includes(member))
  const signatures = functionMethods.map((method) => convertFunctionSignature(method, filename, source, recordNames, true))
  const functionSignatures = new Map([...program.functions].map(([localName, declaration]) => [localName, {
    location: declaration.location,
    name: localName,
    nameLocation: declaration.location,
    parameters: declaration.parameters,
    returnType: declaration.returnType
  }]))

  for (const signature of signatures) functionSignatures.set(signature.name, signature)
  const functions = functionMethods.map((method, index) =>
    convertFunction(method, signatures[index], functionSignatures, recordNames, recordsById, filename, source))
  const emptyBlock = {kind: /** @type {const} */ ("Block"), location, statements: []}
  const entryPoint = program.isEntry
    ? convertEntryPoint(mainMethods[0], filename, source, functionSignatures, recordNames, recordsById)
    : {body: emptyBlock, kind: /** @type {const} */ ("EntryPoint"), location}

  return {entryPoint, functions, kind: "Module", location, ...(records.length > 0 ? {records} : {})}
}

/**
 * Reads direct package/import/class nodes from the pinned Lezer grammar.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @returns {{imports: {importedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, namespace: true, pathLocation: import("../semantic/types.js").SourceLocation, specifier: string, typeOnly: false}[], exports: {exportedName: string, localName: string, location: import("../semantic/types.js").SourceLocation, typeOnly: false}[], nativeName: string}} Parser-owned Java module header.
 */
export function inspectJavaModule({filename, source}) {
  const tree = parser.parse(source)
  const error = descendants(tree.topNode, "⚠")[0]

  if (error) {
    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "java",
      location: nodeLocation(error, filename, source),
      message: "Java parser reported invalid syntax."
    })
  }
  const members = structuralChildren(tree.topNode)
  const packages = members.filter((node) => node.name == "PackageDeclaration")
  const importsNodes = members.filter((node) => node.name == "ImportDeclaration")
  const classes = members.filter((node) => node.name == "ClassDeclaration")
  const invalid = members.find((node) => !["PackageDeclaration", "ImportDeclaration", "ClassDeclaration"].includes(node.name))
  const packageNode = packages[0]
  const classNode = classes[0]

  if (!packageNode || packages.length != 1 || !classNode || classes.length != 1 || invalid ||
    members.indexOf(packageNode) != 0 || members.indexOf(classNode) != members.length - 1) {
    return unsupportedSyntax("java", "one package followed by imports and one public class",
      nodeLocation(invalid ?? packages[1] ?? classes[1] ?? tree.topNode, filename, source))
  }
  const packageNameNode = packageNode.getChild("ScopedIdentifier") ?? packageNode.getChild("Identifier")
  const classNameNode = requiredChild(classNode, "Definition", filename, source)
  const modifiers = classNode.getChild("Modifiers")
  const modifierNames = modifiers ? structuralChildren(modifiers).map(({name}) => name) : []
  const packageName = packageNameNode ? nodeText(packageNameNode, source) : ""
  const className = nodeText(classNameNode, source)
  const expectedSuffix = `${packageName.replaceAll(".", "/")}/${className}.java`

  if (!packageNameNode || !["public final", "final"].includes(modifierNames.join(" ")) || !filename.endsWith(expectedSuffix)) {
    return unsupportedSyntax("java", "package/path/public-class contract", nodeLocation(classNode, filename, source))
  }
  const imports = importsNodes.map((node) => {
    const name = node.getChild("ScopedIdentifier") ?? node.getChild("Identifier")

    if (!name || node.getChild("static") || node.getChild("Asterisk")) {
      return unsupportedSyntax("java", "static or wildcard import", nodeLocation(node, filename, source))
    }
    const specifier = nodeText(name, source)

    return {
      importedName: "*",
      localName: specifier.split(".").at(-1) ?? "",
      location: nodeLocation(node, filename, source),
      namespace: /** @type {const} */ (true),
      pathLocation: nodeLocation(name, filename, source),
      specifier,
      typeOnly: /** @type {const} */ (false)
    }
  })
  const classBody = requiredChild(classNode, "ClassBody", filename, source)
  const classMembers = structuralChildren(classBody)
  const recordClass = classMembers.some((member) => member.name == "FieldDeclaration" || member.name == "ConstructorDeclaration")
  const exports = recordClass
    ? modifierNames.join(" ") == "public final"
      ? [{exportedName: className, localName: className, location: nodeLocation(classNameNode, filename, source), typeOnly: /** @type {const} */ (false)}]
      : []
    : modifierNames.join(" ") != "public final" ? [] : classMembers.flatMap((member) => {
      if (member.name != "MethodDeclaration") return []
      const name = requiredChild(member, "Definition", filename, source)
      const methodModifiers = member.getChild("Modifiers")
      const methodModifierNames = methodModifiers ? structuralChildren(methodModifiers).map(({name: modifierName}) => modifierName) : []

      if (nodeText(name, source) == "main" || methodModifierNames.join(" ") == "private static") return []

      return [{exportedName: nodeText(name, source), localName: nodeText(name, source), location: nodeLocation(name, filename, source), typeOnly: /** @type {const} */ (false)}]
    })

  return {exports, imports, nativeName: `${packageName}.${className}`}
}
