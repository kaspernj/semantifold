// @ts-check

import Parser from "tree-sitter"
import PythonLanguage from "tree-sitter-python"
import {missingType, parseFailure, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceScalarType} from "./scalars.js"

const parser = new Parser()

parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (PythonLanguage)))

const immutableMarker = "# @semantifold-immutable"
const pythonReservedIdentifiers = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "case", "class", "continue",
  "def", "del", "elif", "else", "except", "exec", "finally", "for", "from", "global", "if", "import", "in",
  "is", "lambda", "match", "nonlocal", "not", "or", "pass", "print", "raise", "return", "try", "type",
  "while", "with", "yield", "_", "int", "bool", "str"
])
const binaryOperations = new Map([
  ["+", "Add"],
  ["-", "Subtract"],
  ["*", "Multiply"]
])
const comparisonOperations = new Map([
  ["==", "Equal"],
  ["!=", "NotEqual"],
  ["<", "LessThan"],
  ["<=", "LessThanOrEqual"],
  [">", "GreaterThan"],
  [">=", "GreaterThanOrEqual"]
])

/** @typedef {{comments: import("tree-sitter").SyntaxNode[], usedImmutableMarkers: Set<import("tree-sitter").SyntaxNode>}} PythonContext */

/**
 * Routes the binding's UTF-16 index through the shared UTF-8 byte converter.
 * node-tree-sitter parses JavaScript strings as UTF-16LE and exposes code-unit
 * indexes even though the grammar's native coordinate contract is byte-based.
 * @param {string} source - Complete source.
 * @param {number} index - Binding UTF-16 index.
 * @returns {number} Verified UTF-16 offset.
 */
function bindingIndexToUtf16Offset(source, index) {
  if (!Number.isInteger(index) || index < 0 || index > source.length ||
    index > 0 && index < source.length && /[\uD800-\uDBFF]/u.test(source[index - 1]) && /[\uDC00-\uDFFF]/u.test(source[index])) {
    throw new RangeError(`Invalid Tree-sitter source index: ${index}`)
  }
  const byteOffset = new TextEncoder().encode(source.slice(0, index)).length

  return utf8ByteOffsetToUtf16Offset(source, byteOffset)
}

/**
 * Finds the first unpaired UTF-16 surrogate.
 * @param {string} source - Complete source.
 * @returns {number} Invalid offset, or -1.
 */
function firstLoneSurrogateOffset(source) {
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)

    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = source.charCodeAt(index + 1)

      if (next >= 0xDC00 && next <= 0xDFFF) index += 1
      else return index
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return index
  }

  return -1
}

/**
 * Converts a Tree-sitter byte range into Semantifold's UTF-16 coordinates.
 * @param {import("tree-sitter").SyntaxNode} node - Parser node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Exact location.
 */
function nodeLocation(node, filename, source) {
  return locationFromOffsets(
    filename,
    source,
    bindingIndexToUtf16Offset(source, node.startIndex),
    bindingIndexToUtf16Offset(source, node.endIndex)
  )
}

/**
 * Requires one parser field.
 * @param {import("tree-sitter").SyntaxNode} node - Field owner.
 * @param {string} field - Grammar field name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("tree-sitter").SyntaxNode} Field node.
 */
function requiredField(node, field, filename, source) {
  const child = node.childForFieldName(field)

  if (!child) return unsupportedSyntax("python", `${node.type} without ${field}`, nodeLocation(node, filename, source))

  return child
}

/**
 * Validates every named and anonymous parser child and rejects recovery.
 * @param {import("tree-sitter").SyntaxNode} node - Current parser node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {void}
 */
function validateParserTree(node, filename, source) {
  if (node.isError || node.isMissing) {
    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "python",
      location: nodeLocation(node, filename, source),
      message: `Tree-sitter exposed ${node.isMissing ? "a missing" : "an error"} recovery node '${node.type}'.`
    })
  }

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)

    if (!child) throw new Error(`Tree-sitter omitted child ${index} of ${node.type}.`)
    validateParserTree(child, filename, source)
  }
}

/**
 * Rejects Python identifiers that cannot safely participate in the exact profile.
 * @param {import("tree-sitter").SyntaxNode} node - Identifier node.
 * @param {string} role - Diagnostic role.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {string} Accepted name.
 */
function identifier(node, role, filename, source) {
  const name = node.text

  if (node.type != "identifier" || pythonReservedIdentifiers.has(name) || name.normalize("NFKC") != name) {
    return unsupportedSyntax("python", `${role} identifier '${name}'`, nodeLocation(node, filename, source))
  }

  return name
}

/**
 * Converts one exact int/bool/str annotation.
 * @param {import("tree-sitter").SyntaxNode | null} node - Type node, if present.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(node, subject, ownerLocation, filename, source) {
  if (!node) return missingType("python", subject, ownerLocation)
  const typeLocation = nodeLocation(node, filename, source)
  const children = node.namedChildren.filter((child) => child.type != "comment")

  if (node.type != "type" || children.length != 1 || children[0].type != "identifier" ||
    !["int", "bool", "str"].includes(children[0].text) || node.text != children[0].text) {
    return unsupportedSyntax("python", "unsupported scalar annotation", typeLocation)
  }

  return requireSourceScalarType("python", children[0].text, subject, ownerLocation, typeLocation)
}

/**
 * Finds exactly one anonymous operator token directly owned by a parser node.
 * @param {import("tree-sitter").SyntaxNode} node - Operation node.
 * @param {Set<string>} spellings - Accepted spellings.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("tree-sitter").SyntaxNode} Operator token.
 */
function operatorToken(node, spellings, filename, source) {
  const tokens = node.children.filter((child) => !child.isNamed && spellings.has(child.type))

  if (tokens.length != 1) return unsupportedSyntax("python", `${node.type} operator`, nodeLocation(node, filename, source))

  return tokens[0]
}

/**
 * Converts one supported Python expression.
 * @param {import("tree-sitter").SyntaxNode} node - Expression node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "parenthesized_expression") {
    const expressions = node.namedChildren.filter((child) => child.type != "comment")

    if (expressions.length != 1) return unsupportedSyntax("python", node.type, location)

    return convertExpression(expressions[0], filename, source)
  }
  if (node.type == "identifier") {
    const name = identifier(node, "reference", filename, source)

    return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name}, {name: location})
  }
  if (node.type == "integer") {
    let value

    try {
      value = Number(BigInt(node.text.replaceAll("_", "")))
    } catch {
      return unsupportedSyntax("python", "integer literal", location)
    }
    if (!Number.isSafeInteger(value)) return unsupportedSyntax("python", "non-safe integer literal", location)

    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
  }
  if (node.type == "true" || node.type == "false") {
    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: node.type == "true"}, {literal: location})
  }
  if (node.type == "string") {
    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: decodeString(node, filename, source)}, {
      literal: location
    })
  }
  if (node.type == "concatenated_string") return unsupportedSyntax("python", "implicit string concatenation", location)
  if (node.type == "unary_operator") {
    const operandNode = requiredField(node, "argument", filename, source)
    const operator = operatorToken(node, new Set(["-"]), filename, source)
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(operandNode, filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), "Negate")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }
  if (node.type == "not_operator") {
    const operandNode = requiredField(node, "argument", filename, source)
    const operator = operatorToken(node, new Set(["not"]), filename, source)
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(operandNode, filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), "Not")

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }
  if (node.type == "binary_operator" || node.type == "comparison_operator" || node.type == "boolean_operator") {
    const expressionChildren = node.namedChildren.filter((child) => child.type != "comment")
    const leftNode = node.childForFieldName("left") ?? expressionChildren[0]
    const rightNode = node.childForFieldName("right") ?? expressionChildren[1]

    if (!leftNode || !rightNode) return unsupportedSyntax("python", node.type, location)
    const operations = node.type == "binary_operator" ? binaryOperations : node.type == "comparison_operator"
      ? comparisonOperations : new Map([["and", "And"], ["or", "Or"]])
    const operator = operatorToken(node, new Set(operations.keys()), filename, source)
    const adapted = operations.get(operator.type)

    if (!adapted || expressionChildren.length != 2) {
      return unsupportedSyntax("python", node.type, location)
    }
    const semantic = withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(leftNode, filename, source),
      location,
      right: convertExpression(rightNode, filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (adapted))

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (semantic))
  }
  if (node.type == "call") {
    const calleeNode = requiredField(node, "function", filename, source)
    const argumentsNode = requiredField(node, "arguments", filename, source)

    if (calleeNode.type != "identifier" || argumentsNode.type != "argument_list") {
      return unsupportedSyntax("python", "dynamic call", location)
    }
    const callee = identifier(calleeNode, "callee", filename, source)
    const arguments_ = argumentsNode.namedChildren.filter((child) => child.type != "comment")
      .map((argument) => convertExpression(argument, filename, source))

    return withParserRanges({arguments: arguments_, callee, kind: /** @type {const} */ ("CallExpression"), location}, {
      callee: nodeLocation(calleeNode, filename, source)
    })
  }

  return unsupportedSyntax("python", node.type, location)
}

/**
 * Decodes one non-prefixed, non-triple Python string without evaluating source.
 * @param {import("tree-sitter").SyntaxNode} node - String node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {string} Unicode scalar string.
 */
function decodeString(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const text = node.text
  const quote = text[0]

  if ((quote != "\"" && quote != "'") || text.at(-1) != quote || text.startsWith(`${quote}${quote}${quote}`)) {
    return unsupportedSyntax("python", "prefixed or triple-quoted string", location)
  }
  let decoded = ""

  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index]

    if (character != "\\") {
      decoded += character
      continue
    }
    const escape = text[++index]

    if (escape === undefined) return unsupportedSyntax("python", "invalid string escape", location)
    const simple = new Map([
      ["\\", "\\"], ["'", "'"], ["\"", "\""], ["a", "\u0007"], ["b", "\b"], ["f", "\f"], ["n", "\n"],
      ["r", "\r"], ["t", "\t"], ["v", "\v"]
    ])

    if (simple.has(escape)) {
      decoded += simple.get(escape)
      continue
    }
    if (/[0-7]/u.test(escape)) {
      let digits = escape

      while (digits.length < 3 && /[0-7]/u.test(text[index + 1] ?? "")) digits += text[++index]
      decoded += String.fromCodePoint(Number.parseInt(digits, 8))
      continue
    }
    const widths = new Map([["x", 2], ["u", 4], ["U", 8]])
    const width = widths.get(escape)

    if (!width) return unsupportedSyntax("python", `unsupported string escape \\${escape}`, location)
    const digits = text.slice(index + 1, index + 1 + width)
    if (digits.length != width || !/^[0-9A-Fa-f]+$/u.test(digits)) return unsupportedSyntax("python", "invalid string escape", location)
    index += width
    const codePoint = Number.parseInt(digits, 16)

    if (codePoint > 0x10FFFF || codePoint >= 0xD800 && codePoint <= 0xDFFF) {
      return unsupportedSyntax("python", "invalid Unicode string escape", location)
    }
    decoded += String.fromCodePoint(codePoint)
  }

  if (!hasOnlyUnicodeScalars(decoded)) return unsupportedSyntax("python", "invalid Unicode string literal", location)

  return decoded
}

/**
 * Converts one annotated assignment or plain assignment.
 * @param {import("tree-sitter").SyntaxNode} node - Assignment node.
 * @param {PythonContext} context - Comment association state.
 * @param {Set<string>} visible - Visible bindings in this lexical scope.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertAssignment(node, context, visible, filename, source) {
  const location = nodeLocation(node, filename, source)
  const left = requiredField(node, "left", filename, source)
  const right = requiredField(node, "right", filename, source)
  const typeNode = node.childForFieldName("type")

  if (left.type != "identifier") return unsupportedSyntax("python", "non-identifier assignment target", nodeLocation(left, filename, source))
  const name = identifier(left, typeNode ? "local" : "assignment target", filename, source)
  const nameLocation = nodeLocation(left, filename, source)
  const operator = operatorToken(node, new Set(["="]), filename, source)

  if (!typeNode) {
    if (!visible.has(name)) return missingType("python", `Local '${name}'`, location)
    const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: nameLocation, name}, {name: nameLocation})

    return withParserRanges({
      expression: convertExpression(right, filename, source),
      kind: /** @type {const} */ ("AssignmentStatement"),
      location,
      target
    }, {operator: nodeLocation(operator, filename, source)})
  }

  const declaration = withParserRanges({
    initializer: convertExpression(right, filename, source),
    kind: /** @type {const} */ ("LocalDeclaration"),
    location,
    mutable: !takeImmutableMarker(node, context),
    name,
    type: convertType(typeNode, `Local '${name}'`, location, filename, source)
  }, {name: nameLocation, operator: nodeLocation(operator, filename, source)})

  visible.add(name)

  return declaration
}

/**
 * Associates the exact immediately preceding immutable marker with a local.
 * @param {import("tree-sitter").SyntaxNode} node - Local assignment.
 * @param {PythonContext} context - Comment state.
 * @returns {boolean} Whether the local is immutable.
 */
function takeImmutableMarker(node, context) {
  const marker = context.comments.find((comment) => comment.text == immutableMarker &&
    comment.endPosition.row + 1 == node.startPosition.row && comment.startPosition.column == node.startPosition.column)

  if (!marker) return false
  context.usedImmutableMarkers.add(marker)

  return true
}

/**
 * Converts one statement.
 * @param {import("tree-sitter").SyntaxNode} node - Statement node.
 * @param {PythonContext} context - Comment state.
 * @param {Set<string>} visible - Visible bindings in this lexical scope.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, context, visible, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "return_statement") {
    const expressions = node.namedChildren.filter((child) => child.type != "comment")

    if (expressions.length != 1) return unsupportedSyntax("python", "return without one expression", location)

    return {expression: convertExpression(expressions[0], filename, source), kind: "ReturnStatement", location}
  }
  if (node.type == "if_statement") return convertIf(node, context, visible, filename, source)
  if (node.type == "expression_statement") {
    const expressions = node.namedChildren.filter((child) => child.type != "comment")

    if (expressions.length != 1) return unsupportedSyntax("python", node.type, location)
    if (expressions[0].type == "assignment") return convertAssignment(expressions[0], context, visible, filename, source)

    return convertPrint(expressions[0], filename, source, location)
  }

  return unsupportedSyntax("python", node.type, location)
}

/**
 * Converts the exact print(expression) statement.
 * @param {import("tree-sitter").SyntaxNode} node - Expression statement value.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @param {import("../semantic/types.js").SourceLocation} location - Whole statement location.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, filename, source, location) {
  if (node.type != "call") return unsupportedSyntax("python", "entry expression other than print", nodeLocation(node, filename, source))
  const callee = requiredField(node, "function", filename, source)
  const argumentsNode = requiredField(node, "arguments", filename, source)
  const arguments_ = argumentsNode.namedChildren.filter((child) => child.type != "comment")

  if (callee.type != "identifier" || callee.text != "print" || argumentsNode.type != "argument_list" || arguments_.length != 1) {
    return unsupportedSyntax("python", "print call shape", nodeLocation(node, filename, source))
  }

  return {expression: convertExpression(arguments_[0], filename, source), kind: "PrintStatement", location}
}

/**
 * Converts one if/elif/else node into nested semantic blocks.
 * @param {import("tree-sitter").SyntaxNode} node - If or elif node.
 * @param {PythonContext} context - Comment state.
 * @param {Set<string>} visible - Visible bindings in this lexical scope.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, context, visible, filename, source) {
  const location = nodeLocation(node, filename, source)
  const conditionNode = requiredField(node, "condition", filename, source)
  const consequenceNode = requiredField(node, "consequence", filename, source)
  const alternativeNodes = node.namedChildren.filter((_child, index) => node.fieldNameForNamedChild(index) == "alternative")
  const alternate = convertAlternatives(alternativeNodes, context, new Set(visible), filename, source)

  return {
    ...(alternate ? {alternate} : {}),
    condition: convertExpression(conditionNode, filename, source),
    consequent: convertBlock(consequenceNode, context, new Set(visible), filename, source),
    kind: "IfStatement",
    location
  }
}

/**
 * Converts an else block or nests one elif inside its semantic alternate block.
 * @param {import("tree-sitter").SyntaxNode[]} nodes - Ordered elif/else nodes.
 * @param {PythonContext} context - Comment state.
 * @param {Set<string>} visible - Visible bindings in this lexical scope.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Block | undefined} Alternate block.
 */
function convertAlternatives(nodes, context, visible, filename, source) {
  /** @type {import("../semantic/types.js").Block | undefined} */
  let alternate

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]

    if (node.type == "else_clause") {
      if (alternate) return unsupportedSyntax("python", "multiple else clauses", nodeLocation(node, filename, source))
      alternate = convertBlock(requiredField(node, "body", filename, source), context, new Set(visible), filename, source)
      continue
    }
    if (node.type != "elif_clause") return unsupportedSyntax("python", node.type, nodeLocation(node, filename, source))
    const nested = convertIf(node, context, new Set(visible), filename, source)

    if (alternate) nested.alternate = alternate
    alternate = {kind: "Block", location: nodeLocation(node, filename, source), statements: [nested]}
  }

  return alternate
}

/**
 * Converts one indentation block and permits pass only as its sole executable node.
 * @param {import("tree-sitter").SyntaxNode} node - Block node.
 * @param {PythonContext} context - Comment state.
 * @param {Set<string>} visible - Visible bindings in this lexical scope.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(node, context, visible, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "block") return unsupportedSyntax("python", node.type, location)
  const statements = node.namedChildren.filter((child) => child.type != "comment")

  if (statements.some((statement) => statement.type == "pass_statement")) {
    if (statements.length != 1) return unsupportedSyntax("python", "pass with executable siblings", location)

    return {kind: "Block", location, statements: []}
  }

  return {kind: "Block", location, statements: statements.map((statement) => convertStatement(statement, context, visible, filename, source))}
}

/**
 * Converts one exact synchronous top-level function.
 * @param {import("tree-sitter").SyntaxNode} node - Function node.
 * @param {PythonContext} context - Comment state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "function_definition" || node.children.some((child) => !child.isNamed && child.type == "async")) {
    return unsupportedSyntax("python", node.type, location)
  }
  const typeParametersNode = node.childForFieldName("type_parameters")

  if (typeParametersNode) {
    return unsupportedSyntax("python", typeParametersNode.type, nodeLocation(typeParametersNode, filename, source))
  }
  const nameNode = requiredField(node, "name", filename, source)
  const parametersNode = requiredField(node, "parameters", filename, source)
  const returnNode = node.childForFieldName("return_type")
  const bodyNode = requiredField(node, "body", filename, source)
  const name = identifier(nameNode, "function", filename, source)
  const parameterNodes = parametersNode.namedChildren.filter((child) => child.type != "comment")

  if (parametersNode.children.some((child) => !child.isNamed && !["(", ")", ","].includes(child.type))) {
    return unsupportedSyntax("python", "parameter separators", nodeLocation(parametersNode, filename, source))
  }
  const parameters = parameterNodes.map((parameterNode) => {
    const parameterLocation = nodeLocation(parameterNode, filename, source)

    if (parameterNode.type != "typed_parameter") {
      if (parameterNode.type == "identifier") return missingType("python", `Parameter '${parameterNode.text}'`, parameterLocation)

      return unsupportedSyntax("python", parameterNode.type, parameterLocation)
    }
    const parameterNameNode = parameterNode.namedChildren.find((child) => child.type == "identifier")
    const typeNode = parameterNode.childForFieldName("type")

    if (!parameterNameNode) return unsupportedSyntax("python", "parameter without identifier", parameterLocation)
    const parameterName = identifier(parameterNameNode, "parameter", filename, source)

    return withParserRanges({
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: convertType(typeNode, `Parameter '${parameterName}'`, parameterLocation, filename, source)
    }, {name: nodeLocation(parameterNameNode, filename, source)})
  })

  const visible = new Set(parameters.map((parameter) => parameter.name))

  return withParserRanges({
    body: convertBlock(bodyNode, context, visible, filename, source),
    kind: "FunctionDeclaration",
    location,
    name,
    parameters,
    returnType: convertType(returnNode, `Function '${name}' return`, location, filename, source)
  }, {name: nodeLocation(nameNode, filename, source)})
}

/**
 * Parses the strict Task 016 Python profile.
 * @param {{filename: string, source: string}} input - Parser input.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parsePython({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const invalidOffset = firstLoneSurrogateOffset(source)

    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "python",
      location: locationFromOffsets(filename, source, invalidOffset, invalidOffset + 1),
      message: "Python source contains an invalid lone UTF-16 surrogate."
    })
  }
  let tree

  try {
    tree = parser.parse(source)
  } catch (error) {
    return parseFailure("python", error)
  }
  const root = tree.rootNode

  validateParserTree(root, filename, source)
  if (root.type != "module") throw new Error(`Tree-sitter returned Python root '${root.type}'.`)

  const comments = root.descendantsOfType("comment")
  const context = {comments, usedImmutableMarkers: new Set()}
  const functions = []
  const entryNodes = []
  let sawEntry = false

  for (const node of root.namedChildren) {
    if (node.type == "comment") continue
    if (node.type == "function_definition" && !sawEntry) functions.push(convertFunction(node, context, filename, source))
    else {
      sawEntry = true
      entryNodes.push(node)
    }
  }
  const location = moduleLocation(filename, source)
  const entryLocation = entryNodes.length == 0 ? location : locationFromOffsets(
    filename,
    source,
    bindingIndexToUtf16Offset(source, entryNodes[0].startIndex),
    bindingIndexToUtf16Offset(source, entryNodes.at(-1)?.endIndex ?? root.endIndex)
  )
  const entryVisible = new Set()
  const entryHasPass = entryNodes.some((node) => node.type == "pass_statement")

  if (entryHasPass && entryNodes.length != 1) {
    return unsupportedSyntax("python", "top-level pass with executable siblings", entryLocation)
  }
  const entryBlock = {
    kind: /** @type {const} */ ("Block"),
    location: entryLocation,
    statements: entryHasPass ? [] : entryNodes.map((node) => convertStatement(node, context, entryVisible, filename, source))
  }
  const unusedMarker = comments.find((comment) => comment.text == immutableMarker && !context.usedImmutableMarkers.has(comment))

  if (unusedMarker) return unsupportedSyntax("python", "unattached immutable marker", nodeLocation(unusedMarker, filename, source))
  if (functions.length == 0) return unsupportedSyntax("python", "module without a function", location)

  return {
    entryPoint: {body: entryBlock, kind: "EntryPoint", location: entryLocation},
    functions,
    kind: "Module",
    location
  }
}
