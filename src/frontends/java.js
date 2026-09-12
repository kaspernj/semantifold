// @ts-check

import {parser} from "@lezer/java"
import {SemantifoldDiagnostic, missingType, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {isTask034ResourceProbe} from "../semantic/capabilities.js"
import {hasExactEffectSupport} from "../backends/effects.js"
import {requireSourceReturnType, sourceScalarType} from "./scalars.js"
import {capabilityFunctionSignatures, instantiatedRecordFieldType, iterationBindingType, iterationOperandType, knownCallReturnType, listType, mapType, optionalType, orderedMapType, ownedResourceType, recordType, referenceType, sameValueType, typeVariable} from "./types.js"

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
const referenceMethodHooks = new Set(["clone", "equals", "finalize", "getClass", "hashCode", "notify", "notifyAll", "toString", "wait"])

/**
 * @typedef JavaConversionContext
 * @property {Map<string, import("../semantic/types.js").SemanticBindingType>} bindings - Explicitly typed visible bindings.
 * @property {Map<string, import("../semantic/types.js").ClassDeclaration>} classes - Reference classes by identity.
 * @property {import("../semantic/types.js").ClassDeclaration} [currentClass] - Enclosing reference class.
 * @property {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Errors by source name.
 * @property {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Errors by identity.
 * @property {Set<string>} erasedBindingNames - Source bindings consumed by exact semantic folds in this scope.
 * @property {Map<string, JavaFunctionSignature>} functions - Explicit module function signatures.
 * @property {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by source name.
 * @property {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Records by identity.
 * @property {import("../semantic/types.js").SemanticFunctionReturnType | undefined} returnType - Enclosing return type.
 * @property {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 */

/**
 * @typedef JavaFunctionSignature
 * @property {import("../semantic/types.js").SourceLocation} location - Complete declaration location.
 * @property {import("../semantic/types.js").SourceLocation} nameLocation - Parser-owned name location.
 * @property {string} name - Function name.
 * @property {import("../semantic/types.js").Parameter[]} parameters - Semantic parameters.
 * @property {import("../semantic/types.js").SemanticFunctionReturnType} returnType - Semantic return type.
 * @property {import("../semantic/types.js").TypeParameter[]} [typeParameters] - Declaration-scoped parameters.
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

  if (node.name == "this") {
    if (!context.currentClass) return unsupportedSyntax("java", "receiver outside a reference class", location)
    return withParserRanges({classId: /** @type {string} */ (context.currentClass.id),
      kind: /** @type {const} */ ("ReceiverExpression"), location}, {receiver: location})
  }

  if (node.name == "FieldAccess") {
    const children = structuralChildren(node)
    const receiver = children[0]
    const member = children[1]

    if (children.length != 2 || receiver?.name != "this" || member?.name != "Identifier" || !context.currentClass) {
      if (receiver && knownExpressionType(receiver, filename, source, context)?.kind == "ReferenceType") {
        return unsupportedSyntax("java", "private reference-class field access", location)
      }
      return unsupportedSyntax("java", "field access outside the declaring receiver", location)
    }
    const field = context.currentClass.fields.find((candidate) => candidate.name == nodeText(member, source))

    if (!field) return unsupportedSyntax("java", `unknown private field '${nodeText(member, source)}'`, nodeLocation(member, filename, source))
    return withParserRanges({field: /** @type {string} */ (field.id), kind: /** @type {const} */ ("PrivateFieldRead"), location,
      receiver: /** @type {import("../semantic/types.js").ReceiverExpression} */ (
        convertExpression(receiver, filename, source, context))}, {member: nodeLocation(member, filename, source)})
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
    const typeNode = children.find((child) => ["GenericType", "TypeName", "ScopedTypeName"].includes(child.name))
    const nameNode = typeNode?.name == "GenericType" ? structuralChildren(typeNode)[0] : typeNode
    const argumentList = node.getChild("ArgumentList")
    const declaration = nameNode ? context.recordNames.get(nodeText(nameNode, source)) : undefined

    if (!typeNode || !nameNode || !argumentList || !declaration || node.getChild("ClassBody")) {
      return unsupportedSyntax("java", "construction of an unknown nominal or anonymous class", location)
    }
    const argumentNodes = structuralChildren(argumentList)
    if (declaration.kind == "ClassDeclaration") {
      if (typeNode.name == "GenericType") return unsupportedSyntax("java", "generic reference construction", nodeLocation(typeNode, filename, source))
      const classLocation = nodeLocation(nameNode, filename, source)

      return withParserRanges({arguments: argumentNodes.map((argument, index) =>
        convertExpression(argument, filename, source, context, declaration.constructor.parameters[index]?.type)),
      kind: /** @type {const} */ ("ReferenceConstruction"), location,
      reference: referenceType(/** @type {string} */ (declaration.id), classLocation)}, {class: classLocation})
    }
    if (declaration.kind == "EffectResourceDeclaration") {
      return unsupportedSyntax("java", "owned resource construction", nodeLocation(typeNode, filename, source))
    }
    const typeArgumentsNode = typeNode.getChild("TypeArguments")

    if (typeNode.name == "GenericType" && !typeArgumentsNode) {
      return unsupportedSyntax("java", "malformed generic record construction", nodeLocation(typeNode, filename, source))
    }
    const typeArguments = typeArgumentsNode
      ? structuralChildren(typeArgumentsNode).map((argument) => convertJavaTypeArgument(
        argument, `Record '${declaration.name}' application`, location, filename, source, context.recordNames, context.typeParameters))
      : undefined
    return withParserRanges({
      arguments: argumentNodes.map((argument, index) =>
        convertExpression(argument, filename, source, context,
          instantiatedRecordFieldType(declaration, typeArguments, index))),
      kind: /** @type {const} */ ("RecordConstruction"),
      location,
      record: recordType(/** @type {string} */ (declaration.id), nodeLocation(nameNode, filename, source), typeArguments)
    }, {record: nodeLocation(nameNode, filename, source)})
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
      !isZeroArgumentRecordMemberInvocation(operand, filename, source, context)) {
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
    if (isEqualsInvocation(node, source) && !isZeroArgumentRecordMemberInvocation(node, filename, source, context)) {
      const methodName = requiredChild(node, "MethodName", filename, source)

      return convertStringEquality(node, false, location, nodeLocation(methodName, filename, source), filename, source, context)
    }

    const methodName = requiredChild(node, "MethodName", filename, source)
    const argumentList = requiredChild(node, "ArgumentList", filename, source)
    const argumentNodes = structuralChildren(argumentList)
    const receiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")
    const method = nodeText(methodName, source)
    const receiverText = receiver ? nodeText(receiver, source) : ""

    if (receiver?.name == "Identifier" && method == "getMessage" && argumentNodes.length == 0 &&
      context.bindings.get(receiverText)?.kind == "ErrorType") {
      const receiverLocation = nodeLocation(receiver, filename, source)

      return withParserRanges({
        kind: /** @type {const} */ ("ErrorMessageRead"),
        location,
        receiver: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: receiverLocation, name: receiverText}, {
          name: receiverLocation
        })
      }, {member: nodeLocation(methodName, filename, source)})
    }

    if (receiver && ["getClass", "hashCode", "toString", "clone", "notify", "notifyAll", "wait"].includes(method)) {
      return unsupportedSyntax("java", "reflective or Object member access", nodeLocation(methodName, filename, source))
    }

    if (receiver && knownExpressionType(receiver, filename, source, context)?.kind == "ReferenceType") {
      const receiverType = /** @type {import("../semantic/types.js").ReferenceType} */ (
        knownExpressionType(receiver, filename, source, context))
      const declaredMethod = context.classes.get(receiverType.declarationId)?.methods.find((candidate) => candidate.name == method)

      return withParserRanges({arguments: argumentNodes.map((argument, index) =>
        convertExpression(argument, filename, source, context, declaredMethod?.parameters[index]?.type)),
      kind: /** @type {const} */ ("MethodCallExpression"), location, method: declaredMethod?.id ?? method,
      receiver: convertExpression(receiver, filename, source, context)}, {member: nodeLocation(methodName, filename, source)})
    }

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

      if (receiverType?.kind == "MapType" || receiverType?.kind == "OrderedMapType" ||
        (!receiverType && argumentNodes[0].name == "StringLiteral")) {
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
      const receiverType = knownExpressionType(receiver, filename, source, context)

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

    if (receiver && receiverText == "Main" && context.currentClass && !context.bindings.has(receiverText)) {
      const localSignature = context.functions.get(method)

      if (localSignature) {
        const arguments_ = argumentNodes.map((child, index) =>
          convertExpression(child, filename, source, context, localSignature.parameters[index]?.type))

        return withParserRanges({arguments: arguments_, callee: method, kind: /** @type {const} */ ("CallExpression"), location}, {
          callee: nodeLocation(methodName, filename, source)
        })
      }
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
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {boolean} Whether this is a known record receiver with no arguments.
 */
function isZeroArgumentRecordMemberInvocation(node, filename, source, context) {
  const argumentList = node.getChild("ArgumentList")
  const receiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")

  return argumentList != null && structuralChildren(argumentList).length == 0 && receiver != null &&
    knownExpressionType(receiver, filename, source, context)?.kind == "RecordType"
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
    "FieldAccess",
    "this",
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
 * @returns {import("../semantic/types.js").LocalStatement | import("../semantic/types.js").PrivateFieldWriteStatement} Semantic local or private-field statement.
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

    if (context.erasedBindingNames.has(name)) {
      return unsupportedSyntax("java", "local binding collides with a consumed source binding", nodeLocation(definition, filename, source))
    }
    const type = convertType(typeNode, `Local '${name}'`, location, filename, source, context.recordNames, context.typeParameters)
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
    if (target?.name == "FieldAccess" && context.currentClass) {
      const targetChildren = structuralChildren(target)
      const receiver = targetChildren[0]
      const member = targetChildren[1]
      const field = targetChildren.length == 2 && receiver?.name == "this" && member?.name == "Identifier"
        ? context.currentClass.fields.find((candidate) => candidate.name == nodeText(member, source))
        : undefined

      if (!field || !expression || expression == target || expression == operator) {
        return unsupportedSyntax("java", "private field write outside the declaring receiver", nodeLocation(target, filename, source))
      }
      return withParserRanges({expression: convertExpression(expression, filename, source, context, field.type),
        field: /** @type {string} */ (field.id), kind: /** @type {const} */ ("PrivateFieldWriteStatement"), location,
        receiver: /** @type {import("../semantic/types.js").ReceiverExpression} */ (
          convertExpression(receiver, filename, source, context))},
      {member: nodeLocation(member, filename, source), operator: nodeLocation(operator, filename, source)})
    }
    if (!target || target.name != "Identifier") return unsupportedSyntax("java", target?.name ?? "assignment target", target ? nodeLocation(target, filename, source) : location)
    if (!expression || expression == target || expression == operator) return unsupportedSyntax("java", "assignment expression", nodeLocation(assignment, filename, source))

    const targetExpression = withParserRanges({
      kind: /** @type {const} */ ("IdentifierExpression"),
      location: nodeLocation(target, filename, source),
      name: nodeText(target, source)
    }, {name: nodeLocation(target, filename, source)})

    const targetName = nodeText(target, source)
    const bindingType = context.bindings.get(targetName)
    const value = convertExpression(expression, filename, source, context,
      bindingType?.kind == "ErrorType" ? undefined : bindingType)

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
  if (statement.name == "ThrowStatement") return convertJavaRaise(statement, filename, source, context)
  if (statement.name == "TryStatement") return convertJavaTry(statement, filename, source, context)
  if (statement.name == "WhileStatement") return convertWhile(statement, filename, source, context)
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
        expression: /** @type {import("../semantic/types.js").CallExpression | import("../semantic/types.js").MethodCallExpression} */ (
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
 * Converts exact `throw new DeclaredError(message)`.
 * @param {import("@lezer/common").SyntaxNode} statement - Java throw statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").RaiseStatement} Semantic raise.
 */
function convertJavaRaise(statement, filename, source, context) {
  const location = nodeLocation(statement, filename, source)
  const construction = statement.getChild("ObjectCreationExpression")
  const typeNode = construction?.getChild("TypeName")
  const argumentsNode = construction?.getChild("ArgumentList")
  const arguments_ = argumentsNode ? structuralChildren(argumentsNode) : []
  const declaration = typeNode ? context.errorNames.get(nodeText(typeNode, source)) : undefined

  if (!construction || !typeNode || !argumentsNode || !declaration || arguments_.length != 1 || construction.getChild("ClassBody")) {
    return unsupportedSyntax("java", "throw other than exact declared error construction", location)
  }
  const typeLocation = nodeLocation(typeNode, filename, source)

  return withParserRanges({
    error: withParserRanges({
      error: withParserRanges({declarationId: /** @type {string} */ (declaration.id), kind: /** @type {const} */ ("ErrorType")}, {type: typeLocation}),
      kind: /** @type {const} */ ("ErrorConstruction"),
      location: nodeLocation(construction, filename, source),
      message: convertExpression(arguments_[0], filename, source, context)
    }, {type: typeLocation}),
    kind: /** @type {const} */ ("RaiseStatement"),
    location
  }, {keyword: nodeLocation(requiredChild(statement, "throw", filename, source), filename, source)})
}

/**
 * Converts one exact catch with no resources or finally.
 * @param {import("@lezer/common").SyntaxNode} statement - Java try statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").TryStatement} Semantic exact handler.
 */
function convertJavaTry(statement, filename, source, context) {
  const location = nodeLocation(statement, filename, source)
  const body = statement.getChild("Block")
  const catches = statement.getChildren("CatchClause")

  if (!body || catches.length != 1 || statement.getChild("FinallyClause") || statement.getChild("ResourceSpecification")) {
    return unsupportedSyntax("java", "try without one catch and no resources or finally", location)
  }
  const handler = catches[0]
  const parameter = handler.getChild("CatchFormalParameter")
  const caught = parameter?.getChild("CatchType")
  const typeNodes = caught ? structuralChildren(caught) : []
  const definition = parameter?.getChild("Definition")
  const catchBody = handler.getChild("Block")
  const typeNode = typeNodes[0]
  const declaration = typeNode ? context.errorNames.get(nodeText(typeNode, source)) : undefined

  if (!parameter || !caught || typeNodes.length != 1 || typeNode?.name != "TypeName" || !definition || !catchBody || !declaration ||
    parameter.getChild("Modifiers")) {
    return unsupportedSyntax("java", "broad, multiple, or malformed catch", nodeLocation(handler, filename, source))
  }
  const caughtLocation = nodeLocation(typeNode, filename, source)
  const catchType = withParserRanges({declarationId: /** @type {string} */ (declaration.id), kind: /** @type {const} */ ("ErrorType")}, {
    type: caughtLocation
  })
  const bodyContext = {...context, bindings: new Map(context.bindings), erasedBindingNames: new Set(context.erasedBindingNames)}
  const catchContext = {...context, bindings: new Map(context.bindings), erasedBindingNames: new Set(context.erasedBindingNames)}
  const name = nodeText(definition, source)

  catchContext.bindings.set(name, catchType)
  return withParserRanges({
    body: convertBlock(body, filename, source, bodyContext),
    catchBinding: withParserRanges({
      kind: /** @type {const} */ ("CatchBinding"),
      location: nodeLocation(definition, filename, source),
      mutable: /** @type {const} */ (false),
      name,
      type: catchType
    }, {name: nodeLocation(definition, filename, source)}),
    catchBody: convertBlock(catchBody, filename, source, catchContext),
    catchType,
    kind: /** @type {const} */ ("TryStatement"),
    location
  }, {catch: nodeLocation(handler, filename, source), try: nodeLocation(requiredChild(statement, "try", filename, source), filename, source)})
}

/**
 * Converts exact Java enhanced-for syntax over one resolved `List<T>`.
 * @param {import("@lezer/common").SyntaxNode} node - Enhanced-for statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical context.
 * @returns {import("../semantic/types.js").ForEachStatement | import("../semantic/types.js").ForEachMapStatement} Semantic loop.
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

  if (collectionNode.name == "MethodInvocation") {
    const methodName = collectionNode.getChild("MethodName")
    const argumentList = collectionNode.getChild("ArgumentList")
    const mapNode = structuralChildren(collectionNode).find((child) => child.name != "MethodName" && child.name != "ArgumentList")
    const mapType_ = mapNode ? knownExpressionType(mapNode, filename, source, context) : undefined

    if (methodName && argumentList && mapNode?.name == "Identifier" &&
      nodeText(methodName, source) == "sequencedEntrySet" && structuralChildren(argumentList).length == 0 &&
      mapType_?.kind == "OrderedMapType") {
      const entryType = typeNode.name == "GenericType" ? structuralChildren(typeNode) : []
      const entryArguments = entryType[1]?.name == "TypeArguments" ? structuralChildren(entryType[1]) : []
      const parsedKeyType = entryArguments[0]
        ? convertJavaTypeArgument(entryArguments[0], "Map entry key", nodeLocation(typeNode, filename, source), filename, source,
          context.recordNames, context.typeParameters)
        : undefined
      const parsedValueType = entryArguments[1]
        ? convertJavaTypeArgument(entryArguments[1], "Map entry value", nodeLocation(typeNode, filename, source), filename, source,
          context.recordNames, context.typeParameters)
        : undefined

      if (entryType.length != 2 || nodeText(entryType[0], source) != "java.util.Map.Entry" || entryArguments.length != 2 ||
        !parsedKeyType || !parsedValueType || !sameValueType(parsedKeyType, mapType_.keyType) ||
        !sameValueType(parsedValueType, mapType_.valueType)) {
        return unsupportedSyntax("java", "ordered-map entry type", nodeLocation(typeNode, filename, source))
      }
      const bodyStatements = structuralChildren(body)

      if (bodyStatements.length < 2) {
        return unsupportedSyntax("java", "ordered-map pair bindings", nodeLocation(body, filename, source))
      }
      const entryName = nodeText(bindingNode, source)

      if (context.bindings.has(entryName) || context.erasedBindingNames.has(entryName)) {
        return unsupportedSyntax("java", "ordered-map entry binding collision", nodeLocation(bindingNode, filename, source))
      }
      const bodyContext = {
        ...context,
        bindings: new Map(context.bindings),
        erasedBindingNames: new Set(context.erasedBindingNames).add(entryName)
      }
      const keyBinding = convertJavaMapPairBinding(
        bodyStatements[0], entryName, "getKey", mapType_.keyType, filename, source, bodyContext
      )
      const valueBinding = convertJavaMapPairBinding(
        bodyStatements[1], entryName, "getValue", mapType_.valueType, filename, source, bodyContext
      )

      bodyContext.bindings.set(keyBinding.name, keyBinding.type)
      bodyContext.bindings.set(valueBinding.name, valueBinding.type)
      return withParserRanges({
        body: {
          kind: /** @type {const} */ ("Block"),
          location: nodeLocation(body, filename, source),
          statements: convertStatements(bodyStatements.slice(2), filename, source, bodyContext)
        },
        keyBinding,
        kind: /** @type {const} */ ("ForEachMapStatement"),
        location,
        map: convertExpression(mapNode, filename, source, context),
        valueBinding
      }, {operator: nodeLocation(children[colonIndex], filename, source)})
    }
    if (methodName && ["entrySet", "sequencedEntrySet"].includes(nodeText(methodName, source))) {
      return unsupportedSyntax("java", "unordered or unsupported map iteration", nodeLocation(collectionNode, filename, source))
    }
  }
  const bindingLocation = nodeLocation(bindingNode, filename, source)
  const declaredType = convertJavaTypeArgument(typeNode, `Iteration binding '${nodeText(bindingNode, source)}'`, bindingLocation,
    filename, source, context.recordNames, context.typeParameters)
  const collectionType = iterationOperandType(knownExpressionType(collectionNode, filename, source, context))

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
  const bodyContext = {...context, bindings: new Map(context.bindings), erasedBindingNames: new Set(context.erasedBindingNames)}

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
 * Converts one exact immutable local extracted from a Java ordered-map entry.
 * @param {import("@lezer/common").SyntaxNode} statement - Pair-binding declaration.
 * @param {string} entryName - Enhanced-for entry binding name.
 * @param {"getKey" | "getValue"} accessor - Required entry accessor.
 * @param {import("../semantic/types.js").SemanticValueType} expectedType - Canonical binding type.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed context.
 * @returns {import("../semantic/types.js").ValueBinding} Pair binding.
 */
function convertJavaMapPairBinding(statement, entryName, accessor, expectedType, filename, source, context) {
  const location = nodeLocation(statement, filename, source)
  const modifiers = statement.getChild("Modifiers")
  const declarators = statement.getChildren("VariableDeclarator")
  const declarator = declarators[0]
  const definition = declarator?.getChild("Definition")
  const assignment = declarator?.getChild("AssignOp")
  const initializer = declarator
    ? directChildren(declarator).find((child) => child.name != "Definition" && child.name != "AssignOp")
    : undefined
  const methodName = initializer?.getChild("MethodName")
  const argumentList = initializer?.getChild("ArgumentList")
  const receiver = initializer?.name == "MethodInvocation"
    ? structuralChildren(initializer).find((child) => child.name != "MethodName" && child.name != "ArgumentList")
    : undefined
  const typeNode = declarationType(statement)

  if (statement.name != "LocalVariableDeclaration" || nodeText(modifiers ?? statement, source) != "final" ||
    declarators.length != 1 || !definition || !assignment || nodeText(assignment, source) != "=" || !initializer ||
    initializer.name != "MethodInvocation" || !methodName || nodeText(methodName, source) != accessor ||
    !argumentList || structuralChildren(argumentList).length != 0 || receiver?.name != "Identifier" ||
    nodeText(receiver, source) != entryName || !typeNode) {
    return unsupportedSyntax("java", `ordered-map ${accessor} binding`, location)
  }
  const name = nodeText(definition, source)

  if (context.erasedBindingNames.has(name)) {
    return unsupportedSyntax("java", `ordered-map ${accessor} binding collision`, nodeLocation(definition, filename, source))
  }
  const type = convertType(typeNode, `Map iteration binding '${name}'`, location,
    filename, source, context.recordNames, context.typeParameters)

  if (!sameValueType(type, expectedType)) {
    return unsupportedSyntax("java", `ordered-map ${accessor} binding type`, nodeLocation(typeNode, filename, source))
  }

  return withParserRanges({
    kind: /** @type {const} */ ("ValueBinding"),
    location,
    mutable: /** @type {const} */ (false),
    name,
    type
  }, {name: nodeLocation(definition, filename, source)})
}

/**
 * Resolves expression types established by Java declarations and function signatures.
 * @param {import("@lezer/common").SyntaxNode} node - Parser expression.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed context.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | import("../semantic/types.js").ErrorType | undefined} Known type.
 */
function knownExpressionType(node, filename, source, context) {
  if (node.name == "ParenthesizedExpression") {
    const children = structuralChildren(node)

    return children.length == 1 ? knownExpressionType(children[0], filename, source, context) : undefined
  }
  if (node.name == "this" && context.currentClass?.id) {
    return {declarationId: context.currentClass.id, kind: "ReferenceType"}
  }
  if (node.name == "Identifier") return context.bindings.get(nodeText(node, source))
  if (node.name == "FieldAccess" && context.currentClass) {
    const children = structuralChildren(node)

    if (children.length == 2 && children[0].name == "this" && children[1].name == "Identifier") {
      return context.currentClass.fields.find((field) => field.name == nodeText(children[1], source))?.type
    }
  }
  if (node.name == "MethodInvocation") {
    const methodName = node.getChild("MethodName")
    const argumentList = node.getChild("ArgumentList")
    const receiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")

    if (methodName && !receiver) {
      const signature = context.functions.get(nodeText(methodName, source))
      const arguments_ = argumentList ? structuralChildren(argumentList) : []

      if (signature) return knownCallReturnType(signature, arguments_.map((argument) =>
        knownExpressionType(argument, filename, source, context)))
    }
    if (methodName && receiver) {
      const receiverType = knownExpressionType(receiver, filename, source, context)

      if (receiverType?.kind == "ReferenceType") {
        return context.classes.get(receiverType.declarationId)?.methods.find((method) =>
          method.name == nodeText(methodName, source))?.returnType
      }
      const qualified = `${nodeText(receiver, source)}.${nodeText(methodName, source)}`
      const signature = context.functions.get(qualified)
      const arguments_ = argumentList ? structuralChildren(argumentList) : []
      const returnType = signature ? knownCallReturnType(signature, arguments_.map((argument) =>
        knownExpressionType(argument, filename, source, context))) : undefined

      if (returnType) return returnType
    }
    if (methodName && receiver && argumentList && nodeText(methodName, source) == "get") {
      const arguments_ = structuralChildren(argumentList)
      const receiverType = knownExpressionType(receiver, filename, source, context)

      if (arguments_.length == 0 && receiver.name == "Identifier" && receiverType?.kind == "OptionalType") {
        return receiverType.valueType
      }
      if (arguments_.length == 1 && receiverType?.kind == "ListType") return receiverType.elementType
      if (arguments_.length == 1 && (receiverType?.kind == "MapType" || receiverType?.kind == "OrderedMapType")) {
        return receiverType.valueType
      }
    }
    if (methodName && receiver && argumentList && structuralChildren(argumentList).length == 0) {
      const receiverType = knownExpressionType(receiver, filename, source, context)

      if (receiverType?.kind != "RecordType") return undefined
      const declaration = context.records.get(receiverType.declarationId)
      const index = declaration?.fields.findIndex((field) => field.name == nodeText(methodName, source)) ?? -1

      return declaration ? instantiatedRecordFieldType(declaration, receiverType.arguments, index) : undefined
    }
  }
  if (node.name == "ObjectCreationExpression") {
    const typeNode = structuralChildren(node).find((child) => ["GenericType", "TypeName", "ScopedTypeName"].includes(child.name))
    const nameNode = typeNode?.name == "GenericType" ? structuralChildren(typeNode)[0] : typeNode
    const declaration = nameNode ? context.recordNames.get(nodeText(nameNode, source)) : undefined

    if (declaration?.id && typeNode) {
      const typeArgumentsNode = typeNode?.getChild("TypeArguments")
      const typeArguments = typeArgumentsNode
        ? structuralChildren(typeArgumentsNode).map((argument) => convertJavaTypeArgument(
          argument,
          `Record '${declaration.name}' application`,
          nodeLocation(typeNode, filename, source),
          filename,
          source,
          context.recordNames,
          context.typeParameters
        ))
        : undefined

      return declaration.kind == "ClassDeclaration"
        ? {declarationId: declaration.id, kind: "ReferenceType"}
        : {declarationId: declaration.id, kind: "RecordType", ...(typeArguments ? {arguments: typeArguments} : {})}
    }
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
  if (node.name != "Block" && node.name != "ConstructorBody") {
    return unsupportedSyntax("java", `expected block, received ${node.name}`, nodeLocation(node, filename, source))
  }

  return {
    kind: "Block",
    location: nodeLocation(node, filename, source),
    statements: convertStatements(structuralChildren(node), filename, source, context)
  }
}

/**
 * Converts a Java statement sequence, folding the exact protected ordered-map construction profile.
 * @param {import("@lezer/common").SyntaxNode[]} statements - Direct block statements.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").Statement[]} Semantic statements.
 */
function convertStatements(statements, filename, source, context) {
  const converted = []

  for (let index = 0; index < statements.length;) {
    const ordered = convertJavaOrderedMapSequence(statements, index, filename, source, context)

    if (ordered) {
      converted.push(ordered.statement)
      index = ordered.nextIndex
    } else {
      converted.push(convertStatement(statements[index], filename, source, context))
      index += 1
    }
  }

  return converted
}

/**
 * Recognizes construction through a private LinkedHashMap backing followed by an unmodifiable SequencedMap boundary.
 * @param {import("@lezer/common").SyntaxNode[]} statements - Direct block statements.
 * @param {number} start - Candidate backing-declaration index.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {{statement: import("../semantic/types.js").LocalDeclaration, nextIndex: number} | undefined} Folded declaration.
 */
function convertJavaOrderedMapSequence(statements, start, filename, source, context) {
  const backingStatement = statements[start]
  const backingTypeNode = backingStatement?.name == "LocalVariableDeclaration" ? declarationType(backingStatement) : null
  const backingTypeChildren = backingTypeNode?.name == "GenericType" ? structuralChildren(backingTypeNode) : []

  if (backingTypeChildren.length != 2 || nodeText(backingTypeChildren[0], source) != "java.util.LinkedHashMap") return undefined

  const location = nodeLocation(backingStatement, filename, source)
  const backingModifiers = backingStatement.getChild("Modifiers")
  const backingDeclarators = backingStatement.getChildren("VariableDeclarator")
  const backingDeclarator = backingDeclarators[0]
  const backingDefinition = backingDeclarator?.getChild("Definition")
  const backingAssignment = backingDeclarator?.getChild("AssignOp")
  const backingInitializer = backingDeclarator
    ? directChildren(backingDeclarator).find((child) => child.name != "Definition" && child.name != "AssignOp")
    : undefined
  const constructionType = backingInitializer?.name == "ObjectCreationExpression"
    ? structuralChildren(backingInitializer).find((child) => child.name == "GenericType")
    : undefined
  const constructionTypeChildren = constructionType ? structuralChildren(constructionType) : []
  const constructionArguments = backingInitializer?.getChild("ArgumentList")
  const backingArgumentsNode = backingTypeChildren[1]
  const backingArguments = backingArgumentsNode?.name == "TypeArguments" ? structuralChildren(backingArgumentsNode) : []

  if (nodeText(backingModifiers ?? backingStatement, source) != "final" || backingDeclarators.length != 1 ||
    !backingDefinition || !backingAssignment || nodeText(backingAssignment, source) != "=" || !backingInitializer ||
    backingInitializer.name != "ObjectCreationExpression" || backingInitializer.getChild("ClassBody") ||
    constructionTypeChildren.length != 2 || nodeText(constructionTypeChildren[0], source) != "java.util.LinkedHashMap" ||
    structuralChildren(constructionTypeChildren[1]).length != 0 || !constructionArguments ||
    structuralChildren(constructionArguments).length != 0 || backingArguments.length != 2) {
    return unsupportedSyntax("java", "ordered-map LinkedHashMap backing", location)
  }

  const backingName = nodeText(backingDefinition, source)

  if (context.bindings.has(backingName) || context.erasedBindingNames.has(backingName)) {
    return unsupportedSyntax("java", "ordered-map backing binding collision", nodeLocation(backingDefinition, filename, source))
  }
  const keyType = convertJavaTypeArgument(backingArguments[0], "Ordered map key", location, filename, source,
    context.recordNames, context.typeParameters)
  const valueType = convertJavaTypeArgument(backingArguments[1], "Ordered map value", location, filename, source,
    context.recordNames, context.typeParameters)
  const entries = []
  let index = start + 1

  while (index < statements.length) {
    const putStatement = statements[index]
    const invocation = putStatement.name == "ExpressionStatement" ? putStatement.getChild("MethodInvocation") : null
    const methodName = invocation?.getChild("MethodName")
    const argumentList = invocation?.getChild("ArgumentList")
    const receiver = invocation
      ? structuralChildren(invocation).find((child) => child.name != "MethodName" && child.name != "ArgumentList")
      : undefined

    if (!invocation || receiver?.name != "Identifier" || nodeText(receiver, source) != backingName ||
      !methodName || nodeText(methodName, source) != "put") break
    const arguments_ = argumentList ? structuralChildren(argumentList) : []

    if (arguments_.length != 2 || arguments_[0].name != "StringLiteral") {
      return unsupportedSyntax("java", "ordered-map put", nodeLocation(putStatement, filename, source))
    }
    entries.push(withParserRanges({
      key: /** @type {import("../semantic/types.js").StringLiteral} */ (
        convertExpression(arguments_[0], filename, source, context, keyType)
      ),
      kind: /** @type {const} */ ("MapEntry"),
      location: nodeLocation(invocation, filename, source),
      value: convertExpression(arguments_[1], filename, source, context, valueType)
    }, {operator: nodeLocation(methodName, filename, source)}))
    index += 1
  }

  const sealStatement = statements[index]
  const sealTypeNode = sealStatement?.name == "LocalVariableDeclaration" ? declarationType(sealStatement) : null
  const sealDeclarators = sealStatement?.name == "LocalVariableDeclaration" ? sealStatement.getChildren("VariableDeclarator") : []
  const sealDeclarator = sealDeclarators[0]
  const sealDefinition = sealDeclarator?.getChild("Definition")
  const sealAssignment = sealDeclarator?.getChild("AssignOp")
  const sealInitializer = sealDeclarator
    ? directChildren(sealDeclarator).find((child) => child.name != "Definition" && child.name != "AssignOp")
    : undefined
  const sealMethod = sealInitializer?.getChild("MethodName")
  const sealArgumentsNode = sealInitializer?.getChild("ArgumentList")
  const sealArguments = sealArgumentsNode ? structuralChildren(sealArgumentsNode) : []
  const sealReceiver = sealInitializer?.name == "MethodInvocation"
    ? structuralChildren(sealInitializer).find((child) => child.name != "MethodName" && child.name != "ArgumentList")
    : undefined

  if (!sealStatement || nodeText(sealStatement.getChild("Modifiers") ?? sealStatement, source) != "final" ||
    !sealTypeNode || sealDeclarators.length != 1 || !sealDefinition || !sealAssignment || nodeText(sealAssignment, source) != "=" ||
    sealInitializer?.name != "MethodInvocation" || nodeText(sealReceiver ?? sealStatement, source) != "java.util.Collections" ||
    !sealMethod || nodeText(sealMethod, source) != "unmodifiableSequencedMap" || sealArguments.length != 1 ||
    sealArguments[0].name != "Identifier" || nodeText(sealArguments[0], source) != backingName) {
    return unsupportedSyntax("java", "ordered-map unmodifiable SequencedMap boundary", location)
  }
  const name = nodeText(sealDefinition, source)

  if (name == backingName) {
    return unsupportedSyntax("java", "ordered-map boundary binding collision", nodeLocation(sealDefinition, filename, source))
  }
  const boundaryType = convertType(sealTypeNode, `Local '${name}'`, nodeLocation(sealStatement, filename, source),
    filename, source, context.recordNames, context.typeParameters)
  const sealTypeChildren = sealTypeNode.name == "GenericType" ? structuralChildren(sealTypeNode) : []
  const sealTypeArguments = sealTypeChildren[1]?.name == "TypeArguments" ? structuralChildren(sealTypeChildren[1]) : []

  if (sealTypeChildren.length != 2 || nodeText(sealTypeChildren[0], source) != "java.util.SequencedMap" ||
    sealTypeArguments.length != 2 || boundaryType.kind != "MapType" || !sameValueType(boundaryType.keyType, keyType) ||
    !sameValueType(boundaryType.valueType, valueType)) {
    return unsupportedSyntax("java", "ordered-map boundary type mismatch", nodeLocation(sealTypeNode, filename, source))
  }
  const type = orderedMapType(
    boundaryType.keyType,
    boundaryType.valueType,
    nodeLocation(sealTypeNode, filename, source),
    nodeLocation(sealTypeArguments[0], filename, source),
    nodeLocation(sealTypeArguments[1], filename, source)
  )

  context.bindings.set(name, type)
  context.erasedBindingNames.add(backingName)
  return {
    nextIndex: index + 1,
    statement: withParserRanges({
      initializer: withParserRanges({
        entries,
        kind: /** @type {const} */ ("OrderedMapLiteral"),
        location: locationFromOffsets(filename, source, backingInitializer.from, sealInitializer.to)
      }, {factory: nodeLocation(backingInitializer, filename, source)}),
      kind: /** @type {const} */ ("LocalDeclaration"),
      location: locationFromOffsets(filename, source, backingStatement.from, sealStatement.to),
      mutable: /** @type {const} */ (false),
      name,
      type
    }, {name: nodeLocation(sealDefinition, filename, source), operator: nodeLocation(sealAssignment, filename, source)})
  }
}

/**
 * Requires an exact Java scalar type node.
 * @param {import("@lezer/common").SyntaxNode | null} sourceType - Java type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertType(sourceType, subject, location, filename, source, recordNames = new Map(), typeParameters = new Map()) {
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
        convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames, typeParameters),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source)
      )
    }
    if (name == "java.util.Map" && arguments_.length == 2) {
      const keyType = convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames, typeParameters)

      if (keyType.kind != "TypeReference") {
        return unsupportedSyntax("java", "map key type other than string", nodeLocation(arguments_[0], filename, source))
      }
      return mapType(
        keyType,
        convertJavaTypeArgument(arguments_[1], subject, location, filename, source, recordNames, typeParameters),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source),
        nodeLocation(arguments_[1], filename, source)
      )
    }
    if (name == "java.util.SequencedMap" && arguments_.length == 2) {
      const keyType = convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames, typeParameters)

      if (keyType.kind != "TypeReference" || keyType.name != "string") {
        return unsupportedSyntax("java", "map key type other than string", nodeLocation(arguments_[0], filename, source))
      }
      return mapType(
        keyType,
        convertJavaTypeArgument(arguments_[1], subject, location, filename, source, recordNames, typeParameters),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source),
        nodeLocation(arguments_[1], filename, source)
      )
    }
    if ((name == "java.util.Optional" || name == "Optional") && arguments_.length == 1) {
      return optionalType(
        convertJavaTypeArgument(arguments_[0], subject, location, filename, source, recordNames, typeParameters),
        nodeLocation(sourceType, filename, source),
        nodeLocation(arguments_[0], filename, source)
      )
    }

    const record = recordNames.get(name)

    if (record?.id) {
      if (record.kind == "ClassDeclaration") {
        return unsupportedSyntax("java", "generic reference class type", nodeLocation(sourceType, filename, source))
      }
      return recordType(record.id, nodeLocation(nameNode, filename, source), arguments_.map((argument) =>
        convertJavaTypeArgument(argument, subject, location, filename, source, recordNames, typeParameters)))
    }

    return unsupportedSyntax("java", "unsupported generic type", nodeLocation(sourceType, filename, source))
  }
  if (!["PrimitiveType", "TypeName", "ScopedTypeName"].includes(sourceType.name)) {
    return unsupportedSyntax("java", "unsupported scalar type", location)
  }

  const typeParameter = typeParameters.get(nodeText(sourceType, source))

  if (typeParameter?.id) return typeVariable(typeParameter.id, nodeLocation(sourceType, filename, source))
  const declaration = recordNames.get(nodeText(sourceType, source))

  if (declaration?.id) return declaration.kind == "ClassDeclaration"
    ? referenceType(declaration.id, nodeLocation(sourceType, filename, source))
    : declaration.kind == "EffectResourceDeclaration"
      ? ownedResourceType(declaration.id, nodeLocation(sourceType, filename, source))
      : recordType(declaration.id, nodeLocation(sourceType, filename, source))

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
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticValueType} Semantic type.
 */
function convertJavaTypeArgument(node, subject, location, filename, source, recordNames = new Map(), typeParameters = new Map()) {
  if (node.name == "GenericType") return convertType(node, subject, location, filename, source, recordNames, typeParameters)
  const typeParameter = typeParameters.get(nodeText(node, source))

  if (typeParameter?.id) return typeVariable(typeParameter.id, nodeLocation(node, filename, source))
  const declaration = recordNames.get(nodeText(node, source))

  if (declaration?.id) return declaration.kind == "ClassDeclaration"
    ? referenceType(declaration.id, nodeLocation(node, filename, source))
    : declaration.kind == "EffectResourceDeclaration"
      ? ownedResourceType(declaration.id, nodeLocation(node, filename, source))
      : recordType(declaration.id, nodeLocation(node, filename, source))
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
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} [recordNames] - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").TypeParameter>} [typeParameters] - Declaration-scoped parameters.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic return type.
 */
function convertReturnType(sourceType, subject, location, filename, source, recordNames = new Map(), typeParameters = new Map()) {
  if (sourceType?.name == "void") {
    return requireSourceReturnType("java", "void", subject, location, nodeLocation(sourceType, filename, source))
  }

  return convertType(sourceType, subject, location, filename, source, recordNames, typeParameters)
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
 * Converts one native unbounded invariant Java type-parameter list.
 * @param {import("@lezer/common").SyntaxNode | null} node - TypeParameters node.
 * @param {string} ownerId - Stable owning declaration identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeParameter[] | undefined} Semantic parameters.
 */
function convertJavaTypeParameters(node, ownerId, filename, source) {
  if (!node) return undefined
  const parameters = structuralChildren(node)

  return parameters.map((parameter, index) => {
    const children = structuralChildren(parameter)
    const definition = children[0]

    if (parameter.name != "TypeParameter" || children.length != 1 || definition?.name != "Definition") {
      return unsupportedSyntax("java", "bounded, annotated, or malformed type parameter", nodeLocation(parameter, filename, source))
    }
    const location = nodeLocation(definition, filename, source)

    return withParserRanges({
      id: `${ownerId}:type:${index}`,
      kind: /** @type {const} */ ("TypeParameter"),
      location,
      name: nodeText(definition, source)
    }, {name: location})
  })
}

/**
 * Converts one supported Java function signature before adapting any body.
 * @param {import("@lezer/common").SyntaxNode} node - Method declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by source name.
 * @param {boolean} [programFunction] - Whether the canonical project profile admits explicit public or private visibility.
 * @param {string} [ownerId] - Stable function identity.
 * @param {boolean} [referenceModule] - Whether package-visible static functions are required by sibling reference classes.
 * @returns {JavaFunctionSignature} Semantic function signature.
 */
function convertFunctionSignature(node, filename, source, recordNames, programFunction = false, ownerId = "function:0",
  referenceModule = false) {
  const location = nodeLocation(node, filename, source)
  const modifiers = node.getChild("Modifiers")
  const modifierNames = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name) : []

  const requiredModifiers = programFunction ? "public or private static" : referenceModule ? "private or package-visible static" : "private static"
  const modifiersText = modifierNames.join(" ")

  if (programFunction ? !["public static", "private static"].includes(modifiersText) :
    referenceModule ? !["private static", "static"].includes(modifiersText) : modifiersText != "private static") {
    return unsupportedSyntax("java", `semantic function without ${requiredModifiers}`, modifiers ? nodeLocation(modifiers, filename, source) : location)
  }
  const typeParameters = node.getChild("TypeParameters")
  const throws = node.getChild("Throws")

  if (throws) return unsupportedSyntax("java", "checked throws", nodeLocation(throws, filename, source))
  const semanticTypeParameters = convertJavaTypeParameters(typeParameters, ownerId, filename, source)
  const typeParameterNames = new Map((semanticTypeParameters ?? []).map((parameter) => [parameter.name, parameter]))
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
      type: convertType(declarationType(parameter), `Parameter '${parameterName}'`, parameterLocation, filename, source,
        recordNames, typeParameterNames)
    }

    return withParserRanges(semanticParameter, {name: nodeLocation(parameterNameNode, filename, source)})
  })
  return {
    location,
    name,
    nameLocation: nodeLocation(definition, filename, source),
    parameters,
    returnType: convertReturnType(declarationType(node), `Function '${name}' return`, location, filename, source,
      recordNames, typeParameterNames),
    ...(semanticTypeParameters ? {typeParameters: semanticTypeParameters} : {})
  }
}

/**
 * Converts one Java function body using already-proved module signatures.
 * @param {import("@lezer/common").SyntaxNode} node - Method declaration.
 * @param {JavaFunctionSignature} signature - Preconverted function signature.
 * @param {Map<string, JavaFunctionSignature>} functions - Module function signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @param {Map<string, import("../semantic/types.js").ClassDeclaration>} classes - Reference classes by identity.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Error declarations by source name.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Error declarations by identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, signature, functions, recordNames, records, classes, errorNames, errors, filename, source) {
  const block = requiredChild(node, "Block", filename, source)
  const context = {
    bindings: new Map(signature.parameters.map((parameter) => [parameter.name, parameter.type])),
    classes,
    errorNames,
    erasedBindingNames: new Set(),
    errors,
    functions,
    recordNames,
    records,
    returnType: signature.returnType,
    typeParameters: new Map((signature.typeParameters ?? []).map((parameter) => [parameter.name, parameter]))
  }

  return withParserRanges({
    body: convertBlock(block, filename, source, context),
    kind: "FunctionDeclaration",
    location: signature.location,
    name: signature.name,
    parameters: signature.parameters,
    returnType: signature.returnType,
    ...(signature.typeParameters ? {typeParameters: signature.typeParameters} : {})
  }, {name: signature.nameLocation})
}

/**
 * Converts one exact final RuntimeException subclass.
 * @param {import("@lezer/common").SyntaxNode} node - Java class declaration.
 * @param {import("../semantic/types.js").ErrorDeclaration} declaration - Predeclared semantic error.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {boolean} [programError] - Whether public program visibility is admitted.
 * @returns {import("../semantic/types.js").ErrorDeclaration} Semantic error declaration.
 */
function convertJavaError(node, declaration, filename, source, programError = false) {
  const location = nodeLocation(node, filename, source)
  const modifiers = node.getChild("Modifiers")
  const modifierText = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name).join(" ") : ""
  const superclass = node.getChild("Superclass")
  const superclassChildren = superclass ? structuralChildren(superclass) : []
  const parent = superclassChildren.at(-1)
  const body = node.getChild("ClassBody")
  const members = body ? structuralChildren(body) : []
  const constructor = members[0]
  const parameters = constructor?.getChild("FormalParameters")
  const parameterNodes = parameters ? structuralChildren(parameters) : []
  const parameter = parameterNodes[0]
  const parameterType = parameter ? declarationType(parameter) : null
  const parameterName = parameter?.getChild("Definition")
  const constructorBody = constructor?.getChild("ConstructorBody")
  const constructorStatements = constructorBody ? structuralChildren(constructorBody) : []
  const superCall = constructorStatements[0]
  const superArguments = superCall?.getChild("ArgumentList")
  const superValues = superArguments ? structuralChildren(superArguments) : []

  if ((programError ? !["public final", "final"].includes(modifierText) : modifierText != "final") ||
    !superclass || superclassChildren.length != 2 || parent?.name != "TypeName" || nodeText(parent, source) != "RuntimeException" ||
    node.getChild("SuperInterfaces") || node.getChild("TypeParameters") || !body || members.length != 1 ||
    constructor?.name != "ConstructorDeclaration" ||
    (programError ? nodeText(constructor.getChild("Modifiers") ?? constructor, source) != "public" : constructor.getChild("Modifiers")) ||
    constructor.getChild("Throws") ||
    nodeText(constructor.getChild("Definition") ?? node, source) != declaration.name || parameterNodes.length != 1 ||
    parameter?.name != "FormalParameter" || nodeText(parameterType ?? node, source) != "String" ||
    nodeText(parameterName ?? node, source) != "message" || !constructorBody || constructorStatements.length != 1 ||
    superCall?.name != "ExplicitConstructorInvocation" || !superCall.getChild("super") || superValues.length != 1 ||
    superValues[0].name != "Identifier" || nodeText(superValues[0], source) != "message") {
    return unsupportedSyntax("java", "noncanonical typed error declaration", location)
  }

  return withParserRanges(declaration, {
    name: nodeLocation(requiredChild(node, "Definition", filename, source), filename, source),
    type: nodeLocation(parent, filename, source)
  })
}

/**
 * Reads one package-private Java reference constructor or instance-method signature.
 * @param {import("@lezer/common").SyntaxNode} node - Constructor or method declaration.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Declaring class.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} nominalNames - Visible nominal declarations.
 * @param {boolean} constructor - Whether this is the sole constructor.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{location: import("../semantic/types.js").SourceLocation, name: string, nameLocation: import("../semantic/types.js").SourceLocation, parameters: import("../semantic/types.js").Parameter[], returnType?: import("../semantic/types.js").SemanticFunctionReturnType}} Exact signature.
 */
function convertJavaClassCallableSignature(node, declaration, nominalNames, constructor, filename, source) {
  const location = nodeLocation(node, filename, source)
  const definition = requiredChild(node, "Definition", filename, source)
  const name = nodeText(definition, source)
  const parametersNode = requiredChild(node, "FormalParameters", filename, source)
  const parameterNodes = structuralChildren(parametersNode)
  const modifiers = node.getChild("Modifiers")

  if (modifiers || node.getChild("Throws") || node.getChild("TypeParameters") ||
    constructor != (node.name == "ConstructorDeclaration") || constructor && name != declaration.name) {
    return unsupportedSyntax("java", "noncanonical reference class callable", location)
  }
  if (!constructor && referenceMethodHooks.has(name)) {
    return unsupportedSyntax("java", `reserved reference method '${name}'`, nodeLocation(definition, filename, source))
  }
  const parameters = parameterNodes.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)
    const children = structuralChildren(parameter)
    const parameterNameNode = parameter.getChild("Definition")

    if (parameter.name != "FormalParameter" || children.length != 2 || parameter.getChild("Modifiers") ||
      parameter.getChild("Dimension") || !parameterNameNode) {
      return unsupportedSyntax("java", "unsupported reference class parameter", parameterLocation)
    }
    const parameterName = nodeText(parameterNameNode, source)

    return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: parameterLocation, name: parameterName,
      type: convertType(declarationType(parameter), `Parameter '${parameterName}'`, parameterLocation, filename, source, nominalNames)},
    {name: nodeLocation(parameterNameNode, filename, source)})
  })

  return {location, name: constructor ? "constructor" : name, nameLocation: nodeLocation(definition, filename, source), parameters,
    ...(constructor ? {} : {returnType: convertReturnType(declarationType(node), `Method '${name}' return`, location,
      filename, source, nominalNames)})}
}

/**
 * Converts the bounded final/private-field Java reference-class profile.
 * @param {import("@lezer/common").SyntaxNode} node - Class declaration.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Predeclared class identity.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} nominalNames - Visible nominal declarations.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Records by identity.
 * @param {Map<string, import("../semantic/types.js").ClassDeclaration>} classes - Classes by identity.
 * @param {Map<string, JavaFunctionSignature>} functions - Top-level signatures.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Errors by name.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Errors by identity.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ClassDeclaration} Semantic class.
 */
function convertJavaReferenceClass(node, declaration, nominalNames, records, classes, functions, errorNames, errors,
  filename, source) {
  const location = nodeLocation(node, filename, source)
  const modifiers = node.getChild("Modifiers")
  const modifierNames = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name) : []
  const body = requiredChild(node, "ClassBody", filename, source)
  const members = structuralChildren(body)
  const fieldNodes = members.filter((member) => member.name == "FieldDeclaration")
  const constructorNodes = members.filter((member) => member.name == "ConstructorDeclaration")
  const methodNodes = members.filter((member) => member.name == "MethodDeclaration")

  if (modifierNames.join(" ") != "final" || node.getChild("Superclass") || node.getChild("SuperInterfaces") ||
    node.getChild("TypeParameters") || constructorNodes.length != 1 || fieldNodes.length == 0 ||
    fieldNodes.length + constructorNodes.length + methodNodes.length != members.length ||
    members.slice(0, fieldNodes.length).some((member) => member.name != "FieldDeclaration") ||
    members[fieldNodes.length] != constructorNodes[0] ||
    members.slice(fieldNodes.length + 1).some((member) => member.name != "MethodDeclaration")) {
    return unsupportedSyntax("java", "noncanonical reference class declaration", location)
  }
  declaration.fields = fieldNodes.map((fieldNode, index) => {
    const fieldLocation = nodeLocation(fieldNode, filename, source)
    const fieldModifiers = fieldNode.getChild("Modifiers")
    const names = fieldModifiers ? structuralChildren(fieldModifiers).map((modifier) => modifier.name) : []
    const variableNodes = fieldNode.getChildren("VariableDeclarator")
    const variable = variableNodes[0]
    const definition = variable ? variable.getChild("Definition") : null

    if (names.join(" ") != "private" || variableNodes.length != 1 || !definition ||
      structuralChildren(variable).length != 1 || fieldNode.getChild("Dimension")) {
      return unsupportedSyntax("java", "noncanonical private instance field", fieldLocation)
    }
    const name = nodeText(definition, source)

    return withParserRanges({id: `${declaration.id}:field:${index}`, kind: /** @type {const} */ ("PrivateField"),
      location: fieldLocation, name,
      type: convertType(declarationType(fieldNode), `Private field '${name}'`, fieldLocation, filename, source, nominalNames)},
    {name: nodeLocation(definition, filename, source)})
  })
  const constructorNode = constructorNodes[0]
  const constructorSignature = convertJavaClassCallableSignature(constructorNode, declaration, nominalNames, true, filename, source)

  declaration.constructor = withParserRanges({body: /** @type {import("../semantic/types.js").Block} */ ({}),
    id: `${declaration.id}:constructor`, kind: /** @type {const} */ ("ConstructorDeclaration"),
    location: constructorSignature.location, parameters: constructorSignature.parameters}, {constructor: constructorSignature.nameLocation})
  const methodSignatures = methodNodes.map((method) =>
    convertJavaClassCallableSignature(method, declaration, nominalNames, false, filename, source))

  declaration.methods = methodSignatures.map((signature, index) => withParserRanges({
    body: /** @type {import("../semantic/types.js").Block} */ ({}), id: `${declaration.id}:method:${index}`,
    kind: /** @type {const} */ ("MethodDeclaration"), location: signature.location, name: signature.name,
    parameters: signature.parameters,
    returnType: /** @type {import("../semantic/types.js").SemanticFunctionReturnType} */ (signature.returnType)
  }, {name: signature.nameLocation}))
  const base = {bindings: new Map(), classes, currentClass: declaration, errorNames, erasedBindingNames: new Set(), errors,
    functions, recordNames: nominalNames, records}
  const constructorBody = requiredChild(constructorNode, "ConstructorBody", filename, source)

  declaration.constructor.body = convertBlock(constructorBody, filename, source,
    {...base, bindings: new Map(declaration.constructor.parameters.map((parameter) => [parameter.name, parameter.type])),
      returnType: {kind: /** @type {const} */ ("TypeReference"), name: /** @type {const} */ ("void")}})
  for (let index = 0; index < methodNodes.length; index += 1) {
    const method = declaration.methods[index]

    method.body = convertBlock(requiredChild(methodNodes[index], "Block", filename, source), filename, source,
      {...base, bindings: new Map(method.parameters.map((parameter) => [parameter.name, parameter.type])), returnType: method.returnType})
  }

  return withParserRanges(declaration, {name: nodeLocation(requiredChild(node, "Definition", filename, source), filename, source)})
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
  const typeParameterNames = new Map((declaration.typeParameters ?? []).map((parameter) => [parameter.name, parameter]))
  const modifiers = node.getChild("Modifiers")
  const modifierNames = modifiers ? structuralChildren(modifiers).map((modifier) => modifier.name) : []

  const modifiersText = modifierNames.join(" ")

  if ((programRecord ? !["public final", "final"].includes(modifiersText) : modifiersText != "final") ||
    node.getChild("Superclass") || node.getChild("SuperInterfaces")) {
    return unsupportedSyntax("java", "noncanonical record class modifiers", location)
  }
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
      type: convertType(declarationType(fieldNode), `Record field '${nodeText(definition, source)}'`, fieldLocation, filename, source,
        recordNames, typeParameterNames)
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
      nodeLocation(parameter, filename, source), filename, source, recordNames, typeParameterNames) : undefined

    if (parameter?.name != "FormalParameter" || !parameterName || nodeText(parameterName, source) != field.name ||
      parameter.getChild("Modifiers") || parameter.getChild("Dimension") || !parameterType || !sameValueType(parameterType, field.type) ||
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
      nodeLocation(accessor, filename, source), filename, source, recordNames, typeParameterNames)

    const accessorModifiers = accessor.getChild("Modifiers")
    const accessorModifierNames = accessorModifiers ? structuralChildren(accessorModifiers).map((modifier) => modifier.name) : []

    if (accessorModifierNames.join(" ") != (programRecord ? "public" : "") || accessor.getChild("Throws") || accessor.getChild("TypeParameters") ||
      nodeText(name, source) != field.name || structuralChildren(parameters).length != 0 || statements.length != 1 ||
      statements[0].name != "ReturnStatement" || !returned || nodeText(returned, source) != `this.${field.name}` ||
      !sameValueType(accessorType, field.type)) {
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
  const consequentContext = {...context, bindings: new Map(context.bindings), erasedBindingNames: new Set(context.erasedBindingNames)}
  const alternateContext = {...context, bindings: new Map(context.bindings), erasedBindingNames: new Set(context.erasedBindingNames)}

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
 * Converts one exact block-bodied Java pre-condition loop.
 * @param {import("@lezer/common").SyntaxNode} node - Java WhileStatement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {JavaConversionContext} context - Typed lexical conversion context.
 * @returns {import("../semantic/types.js").WhileStatement} Semantic loop.
 */
function convertWhile(node, filename, source, context) {
  const location = nodeLocation(node, filename, source)
  const direct = directChildren(node)
  const conditionContainer = node.getChild("ParenthesizedExpression")
  const body = node.getChild("Block")
  const conditionNodes = conditionContainer ? structuralChildren(conditionContainer) : []

  if (direct.length != 3 || direct[0].name != "while" || direct[1].name != "ParenthesizedExpression" ||
    direct[2].name != "Block" || !conditionContainer || !body || conditionNodes.length != 1) {
    return unsupportedSyntax("java", "while without exact condition and block body", location)
  }
  const bodyContext = {
    ...context,
    bindings: new Map(context.bindings),
    erasedBindingNames: new Set(context.erasedBindingNames)
  }

  return withParserRanges({
    body: convertBlock(body, filename, source, bodyContext),
    condition: convertExpression(conditionNodes[0], filename, source, context),
    kind: /** @type {const} */ ("WhileStatement"),
    location
  }, {keyword: nodeLocation(direct[0], filename, source)})
}

/**
 * Converts Java's supported main method.
 * @param {import("@lezer/common").SyntaxNode} node - Main method.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {Map<string, JavaFunctionSignature>} functions - Module function signatures.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} recordNames - Nominal declarations by source name.
 * @param {Map<string, import("../semantic/types.js").RecordDeclaration>} records - Record declarations by identity.
 * @param {Map<string, import("../semantic/types.js").ClassDeclaration>} classes - Reference classes by identity.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errorNames - Error declarations by source name.
 * @param {Map<string, import("../semantic/types.js").ErrorDeclaration>} errors - Error declarations by identity.
 * @returns {import("../semantic/types.js").EntryPoint} Semantic entry point.
 */
function convertEntryPoint(node, filename, source, functions, recordNames, records, classes, errorNames, errors) {
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
    classes,
    errorNames,
    erasedBindingNames: new Set(),
    errors,
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
 * @param {readonly import("../semantic/types.js").EffectCapabilityDeclaration[]} [input.capabilities] - Compiler-authorized declarations.
 * @param {{isEntry: boolean, functions: Map<string, import("../semantic/types.js").FunctionDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, errors?: Map<string, import("../semantic/types.js").ErrorDeclaration>}} [input.program] - Resolved program imports and entry role.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseJava({capabilities = [], filename, source, program}) {
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

  const programMembers = task034JavaProgramMembers(structuralChildren(tree.topNode), capabilities, filename, source)
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
  const members = task034JavaMainMembers(structuralChildren(classBody), capabilities, filename, source)
  const unsupportedMember = members.find((member) => member.name != "MethodDeclaration")

  if (unsupportedMember) return unsupportedSyntax("java", unsupportedMember.name, nodeLocation(unsupportedMember, filename, source))
  const methods = members
  const mainMethods = methods.filter((method) => nodeText(requiredChild(method, "Definition", filename, source), source) == "main")
  const mainMethod = mainMethods[0]
  const functionMethods = methods.filter((method) => method != mainMethod)
  const location = moduleLocation(filename, source)

  if (functionMethods.length == 0) return unsupportedSyntax("java", "class without a semantic function", location)
  if (!mainMethod || mainMethods.length != 1) return unsupportedSyntax("java", "class without one unambiguous main", location)

  const nominalNodes = classDeclarations.filter((declaration) => declaration != classDeclaration)
  const errorNodes = nominalNodes.filter((declaration) => {
    const parent = declaration.getChild("Superclass")
    return parent && nodeText(parent, source) == "extends RuntimeException"
  })
  const referenceClassNodes = nominalNodes.filter((declaration) => !errorNodes.includes(declaration) &&
    structuralChildren(requiredChild(declaration, "ClassBody", filename, source)).some((member) =>
      member.name == "FieldDeclaration" && nodeText(member.getChild("Modifiers") ?? member, source) == "private"))
  const recordNodes = nominalNodes.filter((declaration) => !errorNodes.includes(declaration) && !referenceClassNodes.includes(declaration))
  const errorDeclarations = errorNodes.map((errorNode, index) => ({
    id: `error:${index}`,
    kind: /** @type {const} */ ("ErrorDeclaration"),
    location: nodeLocation(errorNode, filename, source),
    name: nodeText(requiredChild(errorNode, "Definition", filename, source), source)
  }))
  const recordDeclarations = recordNodes.map((recordNode, index) => {
    const id = `record:${index}`
    const typeParameters = convertJavaTypeParameters(recordNode.getChild("TypeParameters"), id, filename, source)

    return {
      fields: [],
      id,
      kind: /** @type {const} */ ("RecordDeclaration"),
      location: nodeLocation(recordNode, filename, source),
      name: nodeText(requiredChild(recordNode, "Definition", filename, source), source),
      ...(typeParameters ? {typeParameters} : {})
    }
  })
  const referenceDeclarations = referenceClassNodes.map((classNode, index) => ({
    constructor: /** @type {import("../semantic/types.js").ConstructorDeclaration} */ ({}), fields: [], id: `class:${index}`,
    kind: /** @type {const} */ ("ClassDeclaration"), location: nodeLocation(classNode, filename, source), methods: [],
    name: nodeText(requiredChild(classNode, "Definition", filename, source), source)
  }))
  const recordNames = /** @type {Map<string, import("../semantic/types.js").RecordDeclaration | import("../semantic/types.js").ClassDeclaration | import("../semantic/types.js").EffectResourceDeclaration>} */ (
    new Map(recordDeclarations.map((declaration) => /** @type {const} */ ([declaration.name, declaration]))))
  for (const resource of capabilities.flatMap(({resources}) => resources)) recordNames.set(resource.name, resource)
  for (const declaration of referenceDeclarations) recordNames.set(declaration.name, declaration)
  /** @type {Map<string, import("../semantic/types.js").ErrorDeclaration>} */
  const errorNames = new Map(errorDeclarations.map((declaration) => /** @type {const} */ ([declaration.name, declaration])))
  for (const failure of capabilities.flatMap(({failures}) => failures)) {
    errorNames.set(failure.name, /** @type {import("../semantic/types.js").ErrorDeclaration} */ (/** @type {unknown} */ (failure)))
  }
  const errorsById = new Map([...errorNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const errors = errorNodes.map((errorNode, index) => convertJavaError(errorNode, errorDeclarations[index], filename, source))
  const recordsById = new Map(recordDeclarations.map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const classesById = new Map(referenceDeclarations.map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const records = recordNodes.map((recordNode, index) =>
    convertJavaRecord(recordNode, recordDeclarations[index],
      /** @type {Map<string, import("../semantic/types.js").RecordDeclaration>} */ (/** @type {unknown} */ (recordNames)), filename, source))
  const signatures = functionMethods.map((method, index) =>
    convertFunctionSignature(method, filename, source, recordNames, false, `function:${index}`, referenceDeclarations.length > 0))
  /** @type {Map<string, JavaFunctionSignature>} */
  const functionSignatures = new Map(capabilityFunctionSignatures(capabilities, location))
  for (const signature of signatures) functionSignatures.set(signature.name, signature)
  const classes = referenceClassNodes.map((classNode, index) => convertJavaReferenceClass(classNode, referenceDeclarations[index],
    recordNames, recordsById, classesById, functionSignatures, errorNames, errorsById, filename, source))
  const functions = functionMethods.map((method, index) =>
    convertFunction(method, signatures[index], functionSignatures, recordNames, recordsById, classesById,
      errorNames, errorsById, filename, source))
  const entryPoint = convertEntryPoint(mainMethod, filename, source, functionSignatures, recordNames, recordsById,
    classesById, errorNames, errorsById)

  return {entryPoint, functions, kind: "Module", location, ...(errors.length > 0 ? {errors} : {}),
    ...(classes.length > 0 ? {classes} : {}), ...(records.length > 0 ? {records} : {})}
}

/**
 * Removes the exact protected top-level support emitted for the built-in probe.
 * @param {import("@lezer/common").SyntaxNode[]} members - Parsed program members.
 * @param {readonly import("../semantic/types.js").EffectCapabilityDeclaration[]} capabilities - Authorized declarations.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("@lezer/common").SyntaxNode[]} Portable program members.
 */
function task034JavaProgramMembers(members, capabilities, filename, source) {
  if (!isTask034ResourceProbe(capabilities) || nodeText(members[0], source) != "// semantifold-task034-support") return members
  if (!hasExactEffectSupport(source, "java", "top")) {
    return unsupportedSyntax("java", "malformed protected Task 034 top-level support", nodeLocation(members[0], filename, source))
  }
  const names = ["ProbeOperationFailure", "ProbeAcquireFailure", "ProbeReadFailure", "ProbeCloseFailure",
    "ProbeResourceClosed", "ProbeResource"]
  const matches = names.every((name, index) => members[index + 1]?.name == "ClassDeclaration" &&
    nodeText(requiredChild(members[index + 1], "Definition", filename, source), source) == name)

  if (!matches || nodeText(members[names.length + 1], source) != "// semantifold-task034-support-top-end") {
    return unsupportedSyntax("java", "malformed protected Task 034 top-level support", nodeLocation(members[0], filename, source))
  }
  return members.slice(names.length + 2)
}

/**
 * Removes the exact protected Main-member support emitted for the built-in probe.
 * @param {import("@lezer/common").SyntaxNode[]} members - Parsed Main members.
 * @param {readonly import("../semantic/types.js").EffectCapabilityDeclaration[]} capabilities - Authorized declarations.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("@lezer/common").SyntaxNode[]} Portable Main members.
 */
function task034JavaMainMembers(members, capabilities, filename, source) {
  if (!isTask034ResourceProbe(capabilities) || nodeText(members[0], source) != "// semantifold-task034-support-members") return members
  if (!hasExactEffectSupport(source, "java", "members")) {
    return unsupportedSyntax("java", "malformed protected Task 034 member support", nodeLocation(members[0], filename, source))
  }
  const expected = [
    ["FieldDeclaration", "__semantifoldTask034Trace"], ["MethodDeclaration", "probeEffect"],
    ["MethodDeclaration", "probeAcquire"], ["MethodDeclaration", "probeRead"],
    ["MethodDeclaration", "probeClose"], ["MethodDeclaration", "probeTrace"]
  ]
  const matches = expected.every(([kind, name], index) => {
    const member = members[index + 1]
    if (member?.name != kind) return false
    if (kind == "FieldDeclaration") return nodeText(member, source).includes(` ${name} =`)
    return nodeText(requiredChild(member, "Definition", filename, source), source) == name
  })

  if (!matches || nodeText(members[expected.length + 1], source) != "// semantifold-task034-support-members-end") {
    return unsupportedSyntax("java", "malformed protected Task 034 member support", nodeLocation(members[0], filename, source))
  }
  return members.slice(expected.length + 2)
}

/**
 * Converts one already-qualified canonical Java compilation unit.
 * @param {import("@lezer/common").SyntaxNode} root - Error-free Program node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @param {{isEntry: boolean, functions: Map<string, import("../semantic/types.js").FunctionDeclaration>, records: Map<string, import("../semantic/types.js").RecordDeclaration>, errors?: Map<string, import("../semantic/types.js").ErrorDeclaration>}} program - Resolved program imports and entry role.
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
  const superclass = classDeclaration.getChild("Superclass")
  const isError = Boolean(superclass && nodeText(superclass, source) == "extends RuntimeException")
  const isRecord = !isError && members.some((member) => member.name == "FieldDeclaration" || member.name == "ConstructorDeclaration")
  const location = moduleLocation(filename, source)

  if (program.isEntry && classModifierNames.join(" ") != "public final") {
    return unsupportedSyntax("java", "selected entry class without public final visibility", nodeLocation(classDeclaration, filename, source))
  }
  if (program.isEntry && mainMethods.length != 1) return unsupportedSyntax("java", "selected entry class without one main method", location)
  if (!program.isEntry && mainMethods.length > 0) return unsupportedSyntax("java", "main method outside the selected entry module", nodeLocation(mainMethods[0], filename, source))
  if ((isRecord || isError) && mainMethods.length > 0) {
    return unsupportedSyntax("java", "nominal class containing main", nodeLocation(classDeclaration, filename, source))
  }

  const errorDeclarations = isError ? [{
    id: "error:0",
    kind: /** @type {const} */ ("ErrorDeclaration"),
    location: nodeLocation(classDeclaration, filename, source),
    name: nodeText(requiredChild(classDeclaration, "Definition", filename, source), source)
  }] : []

  const recordTypeParameters = isRecord
    ? convertJavaTypeParameters(classDeclaration.getChild("TypeParameters"), "record:0", filename, source)
    : undefined
  const recordDeclarations = isRecord ? [{
    fields: [],
    id: "record:0",
    kind: /** @type {const} */ ("RecordDeclaration"),
    location: nodeLocation(classDeclaration, filename, source),
    name: nodeText(requiredChild(classDeclaration, "Definition", filename, source), source),
    ...(recordTypeParameters ? {typeParameters: recordTypeParameters} : {})
  }] : []
  const recordNames = new Map(program.records)
  const errorNames = new Map(program.errors ?? [])

  for (const declaration of recordDeclarations) recordNames.set(declaration.name, declaration)
  for (const declaration of errorDeclarations) errorNames.set(declaration.name, declaration)
  const errorsById = new Map([...errorNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const errors = errorDeclarations.map((declaration) => convertJavaError(classDeclaration, declaration, filename, source, true))
  const recordsById = new Map([...recordNames.values()].map((declaration) => [/** @type {string} */ (declaration.id), declaration]))
  const classesById = new Map()
  const records = recordDeclarations.map((declaration) =>
    convertJavaRecord(classDeclaration, declaration, recordNames, filename, source, true))
  const functionMethods = isRecord || isError ? [] : members.filter((member) => member.name == "MethodDeclaration" && !mainMethods.includes(member))
  const signatures = functionMethods.map((method, index) =>
    convertFunctionSignature(method, filename, source, recordNames, true, `function:${index}`))
  const functionSignatures = new Map([...program.functions].map(([localName, declaration]) => [localName, {
    location: declaration.location,
    name: localName,
    nameLocation: declaration.location,
    parameters: declaration.parameters,
    returnType: declaration.returnType,
    ...(declaration.typeParameters ? {typeParameters: declaration.typeParameters} : {})
  }]))

  for (const signature of signatures) functionSignatures.set(signature.name, signature)
  const functions = functionMethods.map((method, index) =>
    convertFunction(method, signatures[index], functionSignatures, recordNames, recordsById, classesById,
      errorNames, errorsById, filename, source))
  const emptyBlock = {kind: /** @type {const} */ ("Block"), location, statements: []}
  const entryPoint = program.isEntry
    ? convertEntryPoint(mainMethods[0], filename, source, functionSignatures, recordNames, recordsById, classesById,
      errorNames, errorsById)
    : {body: emptyBlock, kind: /** @type {const} */ ("EntryPoint"), location}

  return {
    entryPoint,
    functions,
    kind: "Module",
    location,
    ...(errors.length > 0 ? {errors} : {}),
    ...(records.length > 0 ? {records} : {})
  }
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
