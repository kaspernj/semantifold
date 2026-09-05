// @ts-check

import Parser from "tree-sitter"
import GoLanguage from "tree-sitter-go/bindings/node/index.js"
import {missingType, parseFailure, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"

const parser = new Parser()

parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (GoLanguage)))

const immutableMarker = "// @semantifold-immutable"
const goKeywords = new Set([
  "break", "default", "func", "interface", "select", "case", "defer", "go", "map", "struct", "chan",
  "else", "goto", "package", "switch", "const", "fallthrough", "if", "range", "type", "continue",
  "for", "import", "return", "var"
])
const functionReserved = new Set(["main", "init", "fmt", "int64", "bool", "string", "true", "false"])
const bindingReserved = new Set(["fmt", "int64", "bool", "string", "true", "false"])
const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])

/** @typedef {{comments: import("tree-sitter").SyntaxNode[], usedMarkers: Set<import("tree-sitter").SyntaxNode>, assignmentTargets: Set<string>}} GoContext */

/**
 * Verifies one binding UTF-16 index through the shared byte converter.
 * @param {string} source Complete source.
 * @param {number} index Binding-reported UTF-16 index.
 * @returns {number} Verified UTF-16 offset.
 */
function bindingIndexToUtf16Offset(source, index) {
  if (!Number.isInteger(index) || index < 0 || index > source.length ||
    index > 0 && index < source.length && /[\uD800-\uDBFF]/u.test(source[index - 1]) && /[\uDC00-\uDFFF]/u.test(source[index])) {
    throw new RangeError("Invalid Tree-sitter source index: " + index)
  }
  return utf8ByteOffsetToUtf16Offset(source, new TextEncoder().encode(source.slice(0, index)).length)
}

/**
 * Finds an unpaired UTF-16 surrogate.
 * @param {string} source Complete source.
 * @returns {number} Invalid offset or -1.
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
 * Converts one CST range.
 * @param {import("tree-sitter").SyntaxNode} node CST node.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Exact location.
 */
function nodeLocation(node, filename, source) {
  return locationFromOffsets(filename, source, bindingIndexToUtf16Offset(source, node.startIndex),
    bindingIndexToUtf16Offset(source, node.endIndex))
}

/**
 * Requires one grammar field.
 * @param {import("tree-sitter").SyntaxNode} node Field owner.
 * @param {string} field Field name.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("tree-sitter").SyntaxNode} Required child.
 */
function requiredField(node, field, filename, source) {
  const child = node.childForFieldName(field)

  if (!child) return unsupportedSyntax("go", node.type + " without " + field, nodeLocation(node, filename, source))
  return child
}

/**
 * Traverses every named and anonymous node before conversion.
 * @param {import("tree-sitter").SyntaxNode} node Current node.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {void}
 */
function validateParserTree(node, filename, source) {
  if (node.hasError || node.isError || node.isMissing) {
    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "go",
      location: nodeLocation(node, filename, source),
      message: "Tree-sitter exposed recovery at '" + node.type + "'."
    })
  }
  if (!node.isNamed && node.type == ";") {
    return unsupportedSyntax("go", "explicit semicolon", nodeLocation(node, filename, source))
  }
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)

    if (!child) throw new Error("Tree-sitter omitted child " + index + " of " + node.type + ".")
    validateParserTree(child, filename, source)
  }
}

/**
 * Selects semantic children while retaining comments for metadata validation.
 * @param {import("tree-sitter").SyntaxNode} node Parent node.
 * @returns {import("tree-sitter").SyntaxNode[]} Non-comment named children.
 */
function semanticChildren(node) {
  return node.namedChildren.filter((child) => child.type != "comment")
}

/**
 * Validates one Go identifier.
 * @param {import("tree-sitter").SyntaxNode} node Identifier node.
 * @param {"function" | "parameter" | "local" | "assignment target" | "reference" | "callee"} role Identifier role.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {string} Accepted spelling.
 */
function identifier(node, role, filename, source) {
  const name = node.text
  const reserved = ["function", "callee"].includes(role) ? functionReserved : ["parameter", "local", "assignment target"].includes(role)
    ? bindingReserved
    : new Set()

  if (node.type != "identifier" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || name == "_" ||
    goKeywords.has(name) || reserved.has(name)) {
    return unsupportedSyntax("go", role + " identifier '" + name + "'", nodeLocation(node, filename, source))
  }
  return name
}

/**
 * Converts an explicit scalar.
 * @param {import("tree-sitter").SyntaxNode | null} node Type node.
 * @param {string} subject Diagnostic subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation Owner location.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(node, subject, ownerLocation, filename, source) {
  if (!node) return missingType("go", subject, ownerLocation)
  const location = nodeLocation(node, filename, source)
  const type = sourceScalarType("go", node.text, location)

  if (!type || node.type != "type_identifier") {
    return unsupportedSyntax("go", "unsupported scalar type '" + node.text + "'", location)
  }
  return type
}

/**
 * Finds exactly one accepted operator token.
 * @param {import("tree-sitter").SyntaxNode} node Operation node.
 * @param {Set<string>} spellings Accepted spellings.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("tree-sitter").SyntaxNode} Operator token.
 */
function operatorToken(node, spellings, filename, source) {
  const field = node.childForFieldName("operator")
  const candidates = field ? [field] : node.children.filter((child) => !child.isNamed && spellings.has(child.type))

  if (candidates.length != 1 || !spellings.has(candidates[0].type)) {
    return unsupportedSyntax("go", node.type + " operator", nodeLocation(node, filename, source))
  }
  return candidates[0]
}

/**
 * Requires one expression in an expression list.
 * @param {import("tree-sitter").SyntaxNode} node Expression list.
 * @param {string} subject Diagnostic subject.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("tree-sitter").SyntaxNode} Sole expression.
 */
function soleExpression(node, subject, filename, source) {
  const children = semanticChildren(node)

  if (node.type != "expression_list" || children.length != 1) {
    return unsupportedSyntax("go", subject, nodeLocation(node, filename, source))
  }
  return children[0]
}

/**
 * Converts one expression.
 * @param {import("tree-sitter").SyntaxNode} node Expression node.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "parenthesized_expression") {
    const children = semanticChildren(node)

    if (children.length != 1) return unsupportedSyntax("go", node.type, location)
    return convertExpression(children[0], filename, source)
  }
  if (node.type == "identifier") {
    const name = identifier(node, "reference", filename, source)

    return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name}, {name: location})
  }
  if (node.type == "int_literal") {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(node.text)) return unsupportedSyntax("go", "noncanonical integer literal", location)
    const value = Number(BigInt(node.text))

    if (!Number.isSafeInteger(value)) return unsupportedSyntax("go", "non-safe integer literal", location)
    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
  }
  if (node.type == "true" || node.type == "false") {
    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: node.type == "true"}, {literal: location})
  }
  if (node.type == "interpreted_string_literal") {
    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: decodeString(node, filename, source)}, {
      literal: location
    })
  }
  if (node.type == "unary_expression") {
    const operand = requiredField(node, "operand", filename, source)
    const operator = operatorToken(node, new Set(["!", "-"]), filename, source)

    if (semanticChildren(node).length != 1) return unsupportedSyntax("go", "unary expression shape", location)
    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(operand, filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), operator.type == "!" ? "Not" : "Negate")))
  }
  if (node.type == "binary_expression") {
    const left = requiredField(node, "left", filename, source)
    const right = requiredField(node, "right", filename, source)
    const operator = operatorToken(node, new Set(binaryOperations.keys()), filename, source)
    const adapted = binaryOperations.get(operator.type)

    if (!adapted || semanticChildren(node).length != 2) return unsupportedSyntax("go", "binary expression shape", location)
    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(left, filename, source),
      location,
      right: convertExpression(right, filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (adapted))))
  }
  if (node.type == "call_expression") {
    const calleeNode = requiredField(node, "function", filename, source)
    const argumentsNode = requiredField(node, "arguments", filename, source)

    if (calleeNode.type != "identifier" || argumentsNode.type != "argument_list" || semanticChildren(node).length != 2) {
      return unsupportedSyntax("go", "qualified or dynamic call", location)
    }
    const callee = identifier(calleeNode, "callee", filename, source)
    const arguments_ = semanticChildren(argumentsNode).map((argument) => convertExpression(argument, filename, source))

    return withParserRanges({arguments: arguments_, callee, kind: /** @type {const} */ ("CallExpression"), location}, {
      callee: nodeLocation(calleeNode, filename, source)
    })
  }
  return unsupportedSyntax("go", node.type, location)
}

/**
 * Decodes an interpreted Go string to valid Unicode scalar text.
 * @param {import("tree-sitter").SyntaxNode} node Literal node.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {string} Decoded value.
 */
function decodeString(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const text = node.text

  if (!text.startsWith('"') || !text.endsWith('"') || /[\r\n]/u.test(text)) {
    return unsupportedSyntax("go", "noncanonical interpreted string literal", location)
  }
  /** @type {number[]} */
  const bytes = []
  /**
   * Appends one UTF-8 text segment.
   * @param {string} value Text segment.
   * @returns {number} New byte length.
   */
  const appendText = (value) => bytes.push(...new TextEncoder().encode(value))
  const simple = new Map([
    ["a", 7], ["b", 8], ["f", 12], ["n", 10], ["r", 13], ["t", 9], ["v", 11], ["\\", 92], ['"', 34]
  ])

  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index]

    if (character != "\\") {
      const codePoint = text.codePointAt(index)

      if (codePoint === undefined) return unsupportedSyntax("go", "invalid string literal", location)
      appendText(String.fromCodePoint(codePoint))
      if (codePoint > 0xFFFF) index += 1
      continue
    }
    const escape = text[++index]

    if (escape === undefined) return unsupportedSyntax("go", "invalid string escape", location)
    if (simple.has(escape)) {
      bytes.push(/** @type {number} */ (simple.get(escape)))
      continue
    }
    if (escape == "x") {
      const digits = text.slice(index + 1, index + 3)

      if (!/^[0-9A-Fa-f]{2}$/u.test(digits)) return unsupportedSyntax("go", "invalid byte escape", location)
      bytes.push(Number.parseInt(digits, 16))
      index += 2
      continue
    }
    if (/[0-7]/u.test(escape)) {
      const digits = text.slice(index, index + 3)

      if (!/^[0-7]{3}$/u.test(digits)) return unsupportedSyntax("go", "invalid octal escape", location)
      const value = Number.parseInt(digits, 8)

      if (value > 255) return unsupportedSyntax("go", "octal escape outside byte range", location)
      bytes.push(value)
      index += 2
      continue
    }
    const width = escape == "u" ? 4 : escape == "U" ? 8 : 0
    const digits = text.slice(index + 1, index + 1 + width)

    if (!width || digits.length != width || !/^[0-9A-Fa-f]+$/u.test(digits)) {
      return unsupportedSyntax("go", "unsupported string escape", location)
    }
    const value = Number.parseInt(digits, 16)

    if (value > 0x10FFFF || value >= 0xD800 && value <= 0xDFFF) {
      return unsupportedSyntax("go", "invalid Unicode string escape", location)
    }
    appendText(String.fromCodePoint(value))
    index += width
  }
  let decoded

  try {
    decoded = new TextDecoder("utf-8", {fatal: true}).decode(Uint8Array.from(bytes))
  } catch {
    return unsupportedSyntax("go", "string byte escapes do not form valid UTF-8", location)
  }
  if (!hasOnlyUnicodeScalars(decoded)) return unsupportedSyntax("go", "invalid Unicode string literal", location)
  return decoded
}

/**
 * Collects plain assignment targets in one root function.
 * @param {import("tree-sitter").SyntaxNode} body Root body.
 * @returns {Set<string>} Assigned names.
 */
function collectAssignmentTargets(body) {
  const names = new Set()

  for (const assignment of body.descendantsOfType("assignment_statement")) {
    const left = assignment.childForFieldName("left")
    const children = left ? semanticChildren(left) : []

    if (left?.type == "expression_list" && children.length == 1 && children[0].type == "identifier") {
      names.add(children[0].text)
    }
  }
  return names
}

/**
 * Claims an exact adjacent immutable marker.
 * @param {import("tree-sitter").SyntaxNode} node Local declaration.
 * @param {GoContext} context Comment context.
 * @returns {boolean} Whether marked immutable.
 */
function takeImmutableMarker(node, context) {
  const marker = context.comments.find((comment) => comment.text == immutableMarker &&
    comment.endPosition.row + 1 == node.startPosition.row && comment.startPosition.column == node.startPosition.column)

  if (!marker) return false
  context.usedMarkers.add(marker)
  return true
}

/**
 * Converts one exact initialized local.
 * @param {import("tree-sitter").SyntaxNode} node Declaration node.
 * @param {GoContext} context Function context.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").LocalDeclaration} Semantic local.
 */
function convertLocal(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const children = semanticChildren(node)

  if (children.length != 1 || children[0].type != "var_spec") return unsupportedSyntax("go", "local declaration shape", location)
  const spec = children[0]
  const nameNode = requiredField(spec, "name", filename, source)
  const typeNode = spec.childForFieldName("type")
  const valueNode = requiredField(spec, "value", filename, source)

  if (semanticChildren(spec).length != (typeNode ? 3 : 2)) return unsupportedSyntax("go", "local declaration shape", location)
  const expressionNode = soleExpression(valueNode, "local initializer count", filename, source)
  const name = identifier(nameNode, "local", filename, source)
  const markedImmutable = takeImmutableMarker(node, context)
  const operator = operatorToken(spec, new Set(["="]), filename, source)

  return withParserRanges({
    initializer: convertExpression(expressionNode, filename, source),
    kind: /** @type {const} */ ("LocalDeclaration"),
    location,
    mutable: !markedImmutable && context.assignmentTargets.has(name),
    name,
    type: convertType(typeNode, "Local '" + name + "'", location, filename, source)
  }, {name: nodeLocation(nameNode, filename, source), operator: nodeLocation(operator, filename, source)})
}

/**
 * Converts one plain assignment.
 * @param {import("tree-sitter").SyntaxNode} node Assignment node.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").AssignmentStatement} Semantic assignment.
 */
function convertAssignment(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const leftList = requiredField(node, "left", filename, source)
  const rightList = requiredField(node, "right", filename, source)
  const operator = operatorToken(node, new Set(["="]), filename, source)
  const left = soleExpression(leftList, "assignment target count", filename, source)
  const right = soleExpression(rightList, "assignment value count", filename, source)

  if (left.type != "identifier" || semanticChildren(node).length != 2) {
    return unsupportedSyntax("go", "assignment shape", location)
  }
  const name = identifier(left, "assignment target", filename, source)
  const nameLocation = nodeLocation(left, filename, source)

  return withParserRanges({
    expression: convertExpression(right, filename, source),
    kind: /** @type {const} */ ("AssignmentStatement"),
    location,
    target: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: nameLocation, name}, {name: nameLocation})
  }, {operator: nodeLocation(operator, filename, source)})
}

/**
 * Recognizes exact fmt.Println.
 * @param {import("tree-sitter").SyntaxNode} node Candidate selector.
 * @returns {boolean} Exact print receiver.
 */
function isPrintReceiver(node) {
  return node.type == "selector_expression" && semanticChildren(node).length == 2 &&
    node.childForFieldName("operand")?.type == "identifier" && node.childForFieldName("operand")?.text == "fmt" &&
    node.childForFieldName("field")?.type == "field_identifier" && node.childForFieldName("field")?.text == "Println"
}

/**
 * Converts one print expression statement.
 * @param {import("tree-sitter").SyntaxNode} node Expression statement.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").PrintStatement} Semantic print.
 */
function convertPrint(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const children = semanticChildren(node)

  if (children.length != 1 || children[0].type != "call_expression") {
    return unsupportedSyntax("go", "expression statement other than print", location)
  }
  const call = children[0]
  const callee = requiredField(call, "function", filename, source)
  const argumentsNode = requiredField(call, "arguments", filename, source)
  const arguments_ = semanticChildren(argumentsNode)

  if (!isPrintReceiver(callee) || semanticChildren(call).length != 2 || argumentsNode.type != "argument_list" ||
    arguments_.length != 1) {
    return unsupportedSyntax("go", "print call shape", nodeLocation(call, filename, source))
  }
  return {expression: convertExpression(arguments_[0], filename, source), kind: /** @type {const} */ ("PrintStatement"), location}
}

/**
 * Converts one conditional.
 * @param {import("tree-sitter").SyntaxNode} node If node.
 * @param {GoContext} context Function context.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic conditional.
 */
function convertIf(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const condition = requiredField(node, "condition", filename, source)
  const consequence = requiredField(node, "consequence", filename, source)
  const alternative = node.childForFieldName("alternative")
  const expectedChildren = alternative ? 3 : 2

  if (semanticChildren(node).length != expectedChildren) return unsupportedSyntax("go", "if initializer or shape", location)
  return {
    ...(alternative ? {alternate: alternative.type == "if_statement"
      ? {kind: /** @type {const} */ ("Block"), location: nodeLocation(alternative, filename, source),
          statements: [convertIf(alternative, context, filename, source)]}
      : convertBlock(alternative, context, filename, source)} : {}),
    condition: convertExpression(condition, filename, source),
    consequent: convertBlock(consequence, context, filename, source),
    kind: /** @type {const} */ ("IfStatement"),
    location
  }
}

/**
 * Converts one supported statement.
 * @param {import("tree-sitter").SyntaxNode} node Statement node.
 * @param {GoContext} context Function context.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "var_declaration") return convertLocal(node, context, filename, source)
  if (node.type == "assignment_statement") return convertAssignment(node, filename, source)
  if (node.type == "if_statement") return convertIf(node, context, filename, source)
  if (node.type == "expression_statement") return convertPrint(node, filename, source)
  if (node.type == "return_statement") {
    const children = semanticChildren(node)

    if (children.length != 1) return unsupportedSyntax("go", "return without one expression", location)
    return {
      expression: convertExpression(soleExpression(children[0], "return expression count", filename, source), filename, source),
      kind: /** @type {const} */ ("ReturnStatement"),
      location
    }
  }
  return unsupportedSyntax("go", node.type, location)
}

/**
 * Converts one lexical block.
 * @param {import("tree-sitter").SyntaxNode} node Block node.
 * @param {GoContext} context Function context.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const children = semanticChildren(node)

  if (node.type != "block" || children.length > 1 || children[0]?.type != "statement_list") {
    if (!(node.type == "block" && children.length == 0)) return unsupportedSyntax("go", "block shape", location)
  }
  const statements = children.length == 0 ? [] : semanticChildren(children[0])

  return {kind: /** @type {const} */ ("Block"), location,
    statements: statements.map((statement) => convertStatement(statement, context, filename, source))}
}

/**
 * Converts one parameter.
 * @param {import("tree-sitter").SyntaxNode} node Parameter node.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").Parameter} Semantic parameter.
 */
function convertParameter(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const nameNode = requiredField(node, "name", filename, source)
  const typeNode = node.childForFieldName("type")

  if (node.type != "parameter_declaration" || semanticChildren(node).length != 2) {
    return unsupportedSyntax("go", "parameter shape", location)
  }
  const name = identifier(nameNode, "parameter", filename, source)

  return withParserRanges({
    kind: /** @type {const} */ ("Parameter"),
    location,
    name,
    type: convertType(typeNode, "Parameter '" + name + "'", location, filename, source)
  }, {name: nodeLocation(nameNode, filename, source)})
}

/**
 * Converts one semantic function.
 * @param {import("tree-sitter").SyntaxNode} node Function node.
 * @param {GoContext} baseContext File context.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, baseContext, filename, source) {
  const location = nodeLocation(node, filename, source)
  const nameNode = requiredField(node, "name", filename, source)
  const parametersNode = requiredField(node, "parameters", filename, source)
  const resultNode = node.childForFieldName("result")
  const bodyNode = requiredField(node, "body", filename, source)

  if (node.type != "function_declaration" || semanticChildren(node).length != (resultNode ? 4 : 3) ||
    node.childForFieldName("receiver") || node.childForFieldName("type_parameters")) {
    return unsupportedSyntax("go", "function declaration shape", location)
  }
  const name = identifier(nameNode, "function", filename, source)
  const parameterNodes = semanticChildren(parametersNode)

  if (parameterNodes.length != 2 || parameterNodes.some((parameter) => parameter.type != "parameter_declaration")) {
    return unsupportedSyntax("go", "function parameter count or shape", nodeLocation(parametersNode, filename, source))
  }
  const context = {...baseContext, assignmentTargets: collectAssignmentTargets(bodyNode)}

  return withParserRanges({
    body: convertBlock(bodyNode, context, filename, source),
    kind: /** @type {const} */ ("FunctionDeclaration"),
    location,
    name,
    parameters: parameterNodes.map((parameter) => convertParameter(parameter, filename, source)),
    returnType: convertType(resultNode, "Function '" + name + "' return", location, filename, source)
  }, {name: nodeLocation(nameNode, filename, source)})
}

/**
 * Converts the exact final func main() entry.
 * @param {import("tree-sitter").SyntaxNode} node Main node.
 * @param {GoContext} baseContext File context.
 * @param {string} filename Source filename.
 * @param {string} source Complete source.
 * @returns {import("../semantic/types.js").EntryPoint} Semantic entry.
 */
function convertMain(node, baseContext, filename, source) {
  const location = nodeLocation(node, filename, source)
  const name = requiredField(node, "name", filename, source)
  const parameters = requiredField(node, "parameters", filename, source)
  const body = requiredField(node, "body", filename, source)

  if (semanticChildren(node).length != 3 || name.text != "main" || semanticChildren(parameters).length != 0 ||
    node.childForFieldName("result") || node.childForFieldName("receiver") || node.childForFieldName("type_parameters")) {
    return unsupportedSyntax("go", "main scaffolding", location)
  }
  const context = {...baseContext, assignmentTargets: collectAssignmentTargets(body)}

  return {body: convertBlock(body, context, filename, source), kind: /** @type {const} */ ("EntryPoint"), location}
}

/**
 * Reports whether any print exists.
 * @param {import("../semantic/types.js").SemanticModule} module Module.
 * @returns {boolean} Print presence.
 */
function hasPrint(module) {
  /**
   * Reports whether one nested block prints.
   * @type {(block: import("../semantic/types.js").Block) => boolean}
   */
  const blockHasPrint = (block) => block.statements.some((statement) => statement.kind == "PrintStatement" ||
    statement.kind == "IfStatement" && (blockHasPrint(statement.consequent) || Boolean(statement.alternate && blockHasPrint(statement.alternate))))

  return module.functions.some(({body}) => blockHasPrint(body)) || blockHasPrint(module.entryPoint.body)
}

/**
 * Parses the strict Task 024 Go profile.
 * @param {{filename: string, source: string}} input Parser input.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseGo({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const offset = firstLoneSurrogateOffset(source)

    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "go",
      location: locationFromOffsets(filename, source, offset, offset + 1),
      message: "Go source contains an invalid lone UTF-16 surrogate."
    })
  }
  let tree

  try {
    tree = parser.parse(source)
  } catch (error) {
    return parseFailure("go", error)
  }
  const root = tree.rootNode

  validateParserTree(root, filename, source)
  if (root.type != "source_file") throw new Error("Tree-sitter returned Go root '" + root.type + "'.")
  const location = moduleLocation(filename, source)
  const comments = root.descendantsOfType("comment")

  for (const comment of comments) {
    if (/^\/\/go:/u.test(comment.text) || /^\/\/ \+build(?:\s|$)/u.test(comment.text) ||
      /^\/\/line(?:\s|$)/u.test(comment.text)) {
      return unsupportedSyntax("go", "source directive", nodeLocation(comment, filename, source))
    }
    if (comment.text.includes("@semantifold") && comment.text != immutableMarker) {
      return unsupportedSyntax("go", "invalid Semantifold metadata comment", nodeLocation(comment, filename, source))
    }
  }
  const children = semanticChildren(root)

  if (children.length < 3 || children[0].type != "package_clause") {
    return unsupportedSyntax("go", "compilation-unit scaffolding", location)
  }
  const packageChildren = semanticChildren(children[0])

  if (packageChildren.length != 1 || packageChildren[0].type != "package_identifier" || packageChildren[0].text != "main") {
    return unsupportedSyntax("go", "package main scaffolding", nodeLocation(children[0], filename, source))
  }
  let memberStart = 1
  let hasFmtImport = false

  if (children[1]?.type == "import_declaration") {
    const declaration = children[1]
    const imports = semanticChildren(declaration)

    if (imports.length != 1 || imports[0].type != "import_spec" || semanticChildren(imports[0]).length != 1 ||
      imports[0].childForFieldName("path")?.type != "interpreted_string_literal" ||
      imports[0].childForFieldName("path")?.text != '"fmt"') {
      return unsupportedSyntax("go", "fmt import scaffolding", nodeLocation(declaration, filename, source))
    }
    hasFmtImport = true
    memberStart = 2
  }
  const members = children.slice(memberStart)

  if (members.length < 2 || members.some((member) => member.type != "function_declaration")) {
    return unsupportedSyntax("go", "top-level declarations", location)
  }
  const mainNodes = members.filter((member) => member.childForFieldName("name")?.text == "main")

  if (mainNodes.length != 1 || members.at(-1)?.id != mainNodes[0].id) {
    return unsupportedSyntax("go", "main ordering", location)
  }
  const baseContext = {assignmentTargets: new Set(), comments, usedMarkers: new Set()}
  const module = {
    entryPoint: convertMain(mainNodes[0], baseContext, filename, source),
    functions: members.slice(0, -1).map((member) => convertFunction(member, baseContext, filename, source)),
    kind: /** @type {const} */ ("Module"),
    location
  }
  const invalidMarker = comments.find((comment) => comment.text == immutableMarker && !baseContext.usedMarkers.has(comment))

  if (invalidMarker) return unsupportedSyntax("go", "unattached immutable marker", nodeLocation(invalidMarker, filename, source))
  if (hasFmtImport != hasPrint(module)) return unsupportedSyntax("go", "fmt import and print usage mismatch", location)
  validateParsedModule(module, "go")
  return module
}
