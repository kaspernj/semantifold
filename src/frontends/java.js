// @ts-check

import {parser} from "@lezer/java"
import {SemantifoldDiagnostic, missingType, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {sourceScalarType} from "./scalars.js"

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
 * Converts a supported Java expression node.
 * @param {import("@lezer/common").SyntaxNode} node - Lezer expression.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.name == "ParenthesizedExpression") {
    const children = structuralChildren(node)

    if (children.length != 1) {
      return unsupportedSyntax("java", "unsupported parenthesized expression", location)
    }

    return convertExpression(children[0], filename, source)
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

  if (node.name == "UnaryExpression") {
    const children = structuralChildren(node)
    const operatorNode = node.getChild("LogicOp") ?? node.getChild("ArithOp")
    const operand = children.find((child) => child.name != "LogicOp" && child.name != "ArithOp")
    const operator = operatorNode ? nodeText(operatorNode, source) : undefined

    if (!operatorNode || !operand || children.length != 2 || (operator != "!" && operator != "-")) {
      return unsupportedSyntax("java", "unary expression", location)
    }

    if (operator == "!" && operand.name == "MethodInvocation" && isEqualsInvocation(operand, source)) {
      return convertStringEquality(operand, true, location, nodeLocation(operatorNode, filename, source), filename, source)
    }

    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(operand, filename, source)
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
      left: convertExpression(operands[0], filename, source),
      location,
      right: convertExpression(operands[1], filename, source)
    }, {operator: nodeLocation(operatorNode, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (javaBinaryOperations.get(operator)))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }

  if (node.name == "MethodInvocation") {
    if (isEqualsInvocation(node, source)) {
      const methodName = requiredChild(node, "MethodName", filename, source)

      return convertStringEquality(node, false, location, nodeLocation(methodName, filename, source), filename, source)
    }

    const unsupportedReceiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")

    if (unsupportedReceiver) return unsupportedSyntax("java", "method invocation receiver", nodeLocation(unsupportedReceiver, filename, source))

    const methodName = requiredChild(node, "MethodName", filename, source)
    const argumentList = requiredChild(node, "ArgumentList", filename, source)
    const argumentNodes = structuralChildren(argumentList)
    const unsupportedArgument = argumentNodes.find((child) => !isSupportedExpressionNode(child))

    if (unsupportedArgument) return unsupportedSyntax("java", `method argument ${unsupportedArgument.name}`, nodeLocation(unsupportedArgument, filename, source))

    const arguments_ = argumentNodes.map((child) => convertExpression(child, filename, source))

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
 * Converts Java `.equals` or its directly negated form without source-text inference.
 * @param {import("@lezer/common").SyntaxNode} node - Parser method invocation.
 * @param {boolean} negated - Whether a parser-owned unary not wraps the invocation.
 * @param {import("../semantic/types.js").SourceLocation} location - Whole equality expression location.
 * @param {import("../semantic/types.js").SourceLocation} operatorLocation - Parser-owned operator/method location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Expression} Adapted equality expression.
 */
function convertStringEquality(node, negated, location, operatorLocation, filename, source) {
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
    left: convertExpression(receivers[0], filename, source),
    location,
    right: convertExpression(arguments_[0], filename, source)
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
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(statement, filename, source) {
  const location = nodeLocation(statement, filename, source)

  if (statement.name != "ReturnStatement") return unsupportedSyntax("java", statement.name, location)

  const expressionNodes = directChildren(statement).filter((child) => child.name != "return" && child.name != ";")
  const expression = expressionNodes.length == 1 ? expressionNodes[0] : undefined

  if (!expression) {
    const unsupported = expressionNodes[0]

    return unsupportedSyntax(
      "java",
      unsupported?.name ?? "empty return",
      unsupported ? nodeLocation(unsupported, filename, source) : location
    )
  }

  return {expression: convertExpression(expression, filename, source), kind: "ReturnStatement", location}
}

/**
 * Converts one Java local declaration or assignment.
 * @param {import("@lezer/common").SyntaxNode} statement - Java statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(statement, filename, source) {
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

    return withParserRanges({
      initializer: convertExpression(initializerNodes[0], filename, source),
      kind: "LocalDeclaration",
      location,
      mutable: modifierChildren.length == 0,
      name,
      type: convertType(typeNode, `Local '${name}'`, location, filename, source)
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

    return withParserRanges({
      expression: convertExpression(expression, filename, source),
      kind: "AssignmentStatement",
      location,
      target: targetExpression
    }, {operator: nodeLocation(operator, filename, source)})
  }

  return unsupportedSyntax("java", statement.name, location)
}

/**
 * Converts a declaration/assignment prefix followed by one exact Java terminal.
 * @template {import("../semantic/types.js").IfStatement | import("../semantic/types.js").ReturnStatement | import("../semantic/types.js").PrintStatement} Terminal
 * @param {import("@lezer/common").SyntaxNode[]} statements - Java statements.
 * @param {string} terminalName - Required terminal node name.
 * @param {(node: import("@lezer/common").SyntaxNode) => Terminal} convertTerminal - Terminal converter.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {(import("../semantic/types.js").LocalStatement | Terminal)[]} Semantic statements.
 */
function convertRestrictedSequence(statements, terminalName, convertTerminal, filename, source) {
  const terminal = statements.at(-1)

  if (!terminal || terminal.name != terminalName) {
    return unsupportedSyntax("java", `statement sequence without ${terminalName}`, terminal ? nodeLocation(terminal, filename, source) : moduleLocation(filename, source))
  }

  return [
    ...statements.slice(0, -1).map((statement) => convertLocalStatement(statement, filename, source)),
    convertTerminal(terminal)
  ]
}

/**
 * Requires an exact Java scalar type node.
 * @param {import("@lezer/common").SyntaxNode | null} sourceType - Java type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, subject, location, filename, source) {
  if (!sourceType) return missingType("java", subject, location)
  if (!["PrimitiveType", "TypeName", "ScopedTypeName"].includes(sourceType.name)) {
    return unsupportedSyntax("java", "unsupported scalar type", location)
  }

  const type = sourceScalarType("java", nodeText(sourceType, source), nodeLocation(sourceType, filename, source))

  if (!type) return unsupportedSyntax("java", "unsupported scalar type", nodeLocation(sourceType, location.filename, source))

  return type
}

/**
 * Returns the direct Java declaration type node supported by scalar conversion.
 * @param {import("@lezer/common").SyntaxNode} node - Declaration node.
 * @returns {import("@lezer/common").SyntaxNode | null} Type syntax node.
 */
function declarationType(node) {
  return node.getChild("PrimitiveType") ?? node.getChild("TypeName") ?? node.getChild("ScopedTypeName")
}

/**
 * Converts the supported Java function method.
 * @param {import("@lezer/common").SyntaxNode} node - Method declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const definition = requiredChild(node, "Definition", filename, source)
  const name = nodeText(definition, source)
  const parametersNode = requiredChild(node, "FormalParameters", filename, source)
  const parameters = parametersNode.getChildren("FormalParameter").map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)
    const parameterNameNode = requiredChild(parameter, "Definition", filename, source)
    const parameterName = nodeText(parameterNameNode, source)

    const semanticParameter = {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: convertType(declarationType(parameter), `Parameter '${parameterName}'`, parameterLocation, filename, source)
    }

    return withParserRanges(semanticParameter, {name: nodeLocation(parameterNameNode, filename, source)})
  })
  const block = requiredChild(node, "Block", filename, source)
  const bodyNodes = directChildren(block).filter((child) => child.name != "{" && child.name != "}")

  const body = convertRestrictedSequence(
    bodyNodes,
    "IfStatement",
    (statement) => convertIf(statement, filename, source),
    filename,
    source
  )

  return withParserRanges({
    body: /** @type {import("../semantic/types.js").FunctionStatement[]} */ (body),
    kind: "FunctionDeclaration",
    location,
    name,
    parameters,
    returnType: convertType(declarationType(node), `Function '${name}' return`, location, filename, source)
  }, {name: nodeLocation(definition, filename, source)})
}

/**
 * Converts the existing exact Java if/else terminal with restricted branch prefixes.
 * @param {import("@lezer/common").SyntaxNode} node - Java if statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const conditionContainer = requiredChild(node, "ParenthesizedExpression", filename, source)
  const conditionNodes = structuralChildren(conditionContainer)
  const condition = conditionNodes.length == 1 ? conditionNodes[0] : undefined
  const branches = node.getChildren("Block")

  if (!condition || branches.length != 2) return unsupportedSyntax("java", "if without two block branches", location)

  const consequentStatements = directChildren(branches[0]).filter((child) => child.name != "{" && child.name != "}")
  const alternateStatements = directChildren(branches[1]).filter((child) => child.name != "{" && child.name != "}")

  return {
    alternate: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
      convertRestrictedSequence(alternateStatements, "ReturnStatement", (statement) => convertReturn(statement, filename, source), filename, source)
    ),
    condition: convertExpression(condition, filename, source),
    consequent: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
      convertRestrictedSequence(consequentStatements, "ReturnStatement", (statement) => convertReturn(statement, filename, source), filename, source)
    ),
    kind: "IfStatement",
    location
  }
}

/**
 * Converts Java's supported main method.
 * @param {import("@lezer/common").SyntaxNode} node - Main method.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").EntryPoint} Semantic entry point.
 */
function convertEntryPoint(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const block = requiredChild(node, "Block", filename, source)
  const statements = structuralChildren(block)

  const body = convertRestrictedSequence(statements, "ExpressionStatement", (statement) => convertPrint(statement, filename, source), filename, source)

  return {body: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").PrintStatement)[]} */ (body), kind: "EntryPoint", location}
}

/**
 * Converts Java's one supported print statement.
 * @param {import("@lezer/common").SyntaxNode} statement - Expression statement.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").PrintStatement} Semantic print.
 */
function convertPrint(statement, filename, source) {
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

  return {expression: convertExpression(arguments_[0], filename, source), kind: "PrintStatement", location: printLocation}
}

/**
 * Parses Java into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseJava({filename, source}) {
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

  const methods = descendants(tree.topNode, "MethodDeclaration")
  const mainMethod = methods.find((method) => nodeText(requiredChild(method, "Definition", filename, source), source) == "main")
  const functionMethods = methods.filter((method) => method != mainMethod)
  const location = moduleLocation(filename, source)

  if (functionMethods.length == 0) return unsupportedSyntax("java", "class without a semantic function", location)
  if (!mainMethod) return unsupportedSyntax("java", "class without main", location)

  const functions = functionMethods.map((method) => convertFunction(method, filename, source))
  const entryPoint = convertEntryPoint(mainMethod, filename, source)

  return {entryPoint, functions, kind: "Module", location}
}
