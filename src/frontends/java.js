// @ts-check

import {parser} from "@lezer/java"
import {SemantifoldDiagnostic, missingType, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
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
    return {kind: "IdentifierExpression", location, name: nodeText(node, source)}
  }

  if (node.name == "IntegerLiteral") {
    const value = Number(nodeText(node, source))

    if (!Number.isSafeInteger(value)) return unsupportedSyntax("java", "non-safe integer literal", location)

    return {kind: "IntegerLiteral", location, value}
  }

  if (node.name == "BooleanLiteral") {
    return {kind: "BooleanLiteral", location, value: nodeText(node, source) == "true"}
  }

  if (node.name == "StringLiteral") {
    return {kind: "StringLiteral", location, value: decodeStringLiteral(node, filename, source)}
  }

  if (node.name == "BinaryExpression") {
    const operands = structuralChildren(node).filter(isSupportedExpressionNode)
    const operatorNode = node.getChild("CompareOp") ?? node.getChild("ArithOp")
    const named = structuralChildren(node)

    if (operands.length != 2 || !operatorNode || named.length != 3) return unsupportedSyntax("java", "binary expression", location)

    const operator = nodeText(operatorNode, source)

    if (![">", "-", "+"].includes(operator)) return unsupportedSyntax("java", `binary ${operator}`, location)

    return {
      kind: "BinaryExpression",
      left: convertExpression(operands[0], filename, source),
      location,
      operator: /** @type {">" | "-" | "+"} */ (operator),
      right: convertExpression(operands[1], filename, source)
    }
  }

  if (node.name == "MethodInvocation") {
    const unsupportedReceiver = structuralChildren(node).find((child) => child.name != "MethodName" && child.name != "ArgumentList")

    if (unsupportedReceiver) return unsupportedSyntax("java", "method invocation receiver", nodeLocation(unsupportedReceiver, filename, source))

    const methodName = requiredChild(node, "MethodName", filename, source)
    const argumentList = requiredChild(node, "ArgumentList", filename, source)
    const argumentNodes = structuralChildren(argumentList)
    const unsupportedArgument = argumentNodes.find((child) => !isSupportedExpressionNode(child))

    if (unsupportedArgument) return unsupportedSyntax("java", `method argument ${unsupportedArgument.name}`, nodeLocation(unsupportedArgument, filename, source))

    const arguments_ = argumentNodes.map((child) => convertExpression(child, filename, source))

    return {arguments: arguments_, callee: nodeText(methodName, source), kind: "CallExpression", location}
  }

  return unsupportedSyntax("java", node.name, location)
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

  for (let index = 0; index < literal.length; index++) {
    const character = literal[index]
    const eligible = character == "\\" && consecutiveBackslashes % 2 == 0

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
      index = digitsStart + 3
      continue
    }

    translated += character
    consecutiveBackslashes = character == "\\" ? consecutiveBackslashes + 1 : 0
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

    if (character != "\\") {
      value += character
      continue
    }

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
 * Converts a Java block containing supported returns.
 * @param {import("@lezer/common").SyntaxNode} block - Java block.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement[]} Semantic returns.
 */
function convertReturnBlock(block, filename, source) {
  const statements = directChildren(block).filter((child) => child.name != "{" && child.name != "}")

  return statements.map((statement) => {
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

    return {expression: convertExpression(expression, filename, source), kind: /** @type {const} */ ("ReturnStatement"), location}
  })
}

/**
 * Requires an exact Java scalar type node.
 * @param {import("@lezer/common").SyntaxNode | null} sourceType - Java type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, subject, location, source) {
  if (!sourceType) return missingType("java", subject, location)
  if (!["PrimitiveType", "TypeName", "ScopedTypeName"].includes(sourceType.name)) {
    return unsupportedSyntax("java", "unsupported scalar type", location)
  }

  const type = sourceScalarType("java", nodeText(sourceType, source))

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

    return {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: convertType(declarationType(parameter), `Parameter '${parameterName}'`, parameterLocation, source)
    }
  })
  const block = requiredChild(node, "Block", filename, source)
  const bodyNodes = directChildren(block).filter((child) => child.name != "{" && child.name != "}")

  if (bodyNodes.length != 1 || bodyNodes[0].name != "IfStatement") return unsupportedSyntax("java", "function body", location)

  const ifNode = bodyNodes[0]
  const ifLocation = nodeLocation(ifNode, filename, source)
  const conditionContainer = requiredChild(ifNode, "ParenthesizedExpression", filename, source)
  const conditionNodes = structuralChildren(conditionContainer)
  const condition = conditionNodes.length == 1 ? conditionNodes[0] : undefined
  const branches = ifNode.getChildren("Block")

  if (!condition || branches.length != 2) return unsupportedSyntax("java", "if without two block branches", ifLocation)

  return {
    body: [{
      alternate: convertReturnBlock(branches[1], filename, source),
      condition: convertExpression(condition, filename, source),
      consequent: convertReturnBlock(branches[0], filename, source),
      kind: "IfStatement",
      location: ifLocation
    }],
    kind: "FunctionDeclaration",
    location,
    name,
    parameters,
    returnType: convertType(declarationType(node), `Function '${name}' return`, location, source)
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

  if (statements.length != 1 || statements[0].name != "ExpressionStatement") {
    const unsupported = statements.length == 1 ? statements[0] : block

    return unsupportedSyntax("java", "main body other than one print statement", nodeLocation(unsupported, filename, source))
  }

  const printInvocation = statements[0].getChild("MethodInvocation")

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

  return {
    body: [{expression: convertExpression(arguments_[0], filename, source), kind: "PrintStatement", location: printLocation}],
    kind: "EntryPoint",
    location
  }
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
