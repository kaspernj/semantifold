// @ts-check

import Parser from "tree-sitter"
import CSharpLanguage from "tree-sitter-c-sharp/bindings/node/index.js"
import {missingType, parseFailure, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"

const parser = new Parser()

parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (CSharpLanguage)))

const immutableMarker = "// @semantifold-immutable"
const checkedArithmetic = new WeakSet()
const csharpReservedIdentifiers = new Set([
  "abstract", "add", "alias", "allows", "and", "as", "ascending", "async", "await", "base", "bool", "break",
  "by", "byte", "case", "catch", "char", "checked", "class", "const", "continue", "decimal", "default",
  "delegate", "descending", "do", "double", "dynamic", "else", "enum", "equals", "event", "explicit", "extension", "extern",
  "false", "field", "file", "finally", "fixed", "float", "for", "foreach", "from", "get", "global", "goto",
  "group", "if", "implicit", "in", "init", "int", "interface", "internal", "into", "is", "join", "let", "lock",
  "long", "managed", "nameof", "namespace", "new", "nint", "not", "notnull", "null", "nuint", "object", "on",
  "operator", "or", "orderby", "out", "override", "params", "partial", "private", "protected", "public", "readonly",
  "record", "ref", "remove", "required", "return", "sbyte", "scoped", "sealed", "select", "set", "short", "sizeof",
  "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong",
  "unchecked", "unmanaged", "unsafe", "ushort", "using", "value", "var", "virtual", "void", "volatile", "when",
  "where", "while", "with", "yield"
])
const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])

/** @typedef {{comments: import("tree-sitter").SyntaxNode[], usedImmutableMarkers: Set<import("tree-sitter").SyntaxNode>}} CSharpContext */

/**
 * Verifies one Tree-sitter binding index through the shared byte converter.
 * @param {string} source - Complete source text.
 * @param {number} index - Binding-reported UTF-16 index.
 * @returns {number} Verified UTF-16 offset.
 */
function bindingIndexToUtf16Offset(source, index) {
  if (!Number.isInteger(index) || index < 0 || index > source.length ||
    index > 0 && index < source.length && /[\uD800-\uDBFF]/u.test(source[index - 1]) && /[\uDC00-\uDFFF]/u.test(source[index])) {
    throw new RangeError(`Invalid Tree-sitter source index: ${index}`)
  }
  return utf8ByteOffsetToUtf16Offset(source, new TextEncoder().encode(source.slice(0, index)).length)
}

/**
 * Finds the first unpaired UTF-16 surrogate.
 * @param {string} source - Complete source text.
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
 * Converts one binding range to a semantic source location.
 * @param {import("tree-sitter").SyntaxNode} node - Parser node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").SourceLocation} Exact location.
 */
function nodeLocation(node, filename, source) {
  return locationFromOffsets(filename, source, bindingIndexToUtf16Offset(source, node.startIndex),
    bindingIndexToUtf16Offset(source, node.endIndex))
}

/**
 * Requires one named grammar field.
 * @param {import("tree-sitter").SyntaxNode} node - Field owner.
 * @param {string} field - Grammar field name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("tree-sitter").SyntaxNode} Required child.
 */
function requiredField(node, field, filename, source) {
  const child = node.childForFieldName(field)

  if (!child) return unsupportedSyntax("csharp", `${node.type} without ${field}`, nodeLocation(node, filename, source))
  return child
}

/**
 * Traverses every parser child and rejects explicit or propagated recovery.
 * @param {import("tree-sitter").SyntaxNode} node - Current parser node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {void}
 */
function validateParserTree(node, filename, source) {
  if (node.hasError || node.isError || node.isMissing) {
    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "csharp",
      location: nodeLocation(node, filename, source),
      message: `Tree-sitter exposed recovery at '${node.type}'.`
    })
  }
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)

    if (!child) throw new Error(`Tree-sitter omitted child ${index} of ${node.type}.`)
    validateParserTree(child, filename, source)
  }
}

/**
 * Selects named semantic children while retaining comments in the parser tree.
 * @param {import("tree-sitter").SyntaxNode} node - Parent parser node.
 * @returns {import("tree-sitter").SyntaxNode[]} Non-comment named children.
 */
function semanticChildren(node) {
  return node.namedChildren.filter((child) => child.type != "comment")
}

/**
 * Validates one identifier against the exact C# source profile.
 * @param {import("tree-sitter").SyntaxNode} node - Identifier node.
 * @param {string} role - Diagnostic role.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {string} Accepted identifier.
 */
function identifier(node, role, filename, source) {
  const name = node.text

  if (node.type != "identifier" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || csharpReservedIdentifiers.has(name)) {
    return unsupportedSyntax("csharp", `${role} identifier '${name}'`, nodeLocation(node, filename, source))
  }
  return name
}

/**
 * Converts one exact supported scalar type.
 * @param {import("tree-sitter").SyntaxNode | null} node - Type node, if present.
 * @param {string} subject - Typed subject for diagnostics.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @param {boolean} [allowVar] - Whether inferred `var` produces MISSING_TYPE.
 * @returns {import("../semantic/types.js").TypeReference} Semantic scalar type.
 */
function convertType(node, subject, ownerLocation, filename, source, allowVar = false) {
  if (!node) return missingType("csharp", subject, ownerLocation)
  const location = nodeLocation(node, filename, source)

  if (allowVar && node.text == "var") return missingType("csharp", subject, ownerLocation)
  const type = sourceScalarType("csharp", node.text, location)

  if (!type || !["predefined_type", "qualified_name"].includes(node.type)) {
    return unsupportedSyntax("csharp", `unsupported scalar type '${node.text}'`, location)
  }
  return type
}

/**
 * Finds exactly one accepted operator token owned by a parser node.
 * @param {import("tree-sitter").SyntaxNode} node - Operation node.
 * @param {Set<string>} spellings - Accepted operator spellings.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("tree-sitter").SyntaxNode} Operator token.
 */
function operatorToken(node, spellings, filename, source) {
  const field = node.childForFieldName("operator")
  const candidates = field ? [field] : node.children.filter((child) => !child.isNamed && spellings.has(child.type))

  if (candidates.length != 1 || !spellings.has(candidates[0].type)) {
    return unsupportedSyntax("csharp", `${node.type} operator`, nodeLocation(node, filename, source))
  }
  return candidates[0]
}

/**
 * Converts one expression and records exact checked-wrapper ownership.
 * @param {import("tree-sitter").SyntaxNode} node - Expression node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @param {boolean} [checkedRoot] - Whether the node is the direct checked-expression operand.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source, checkedRoot = false) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "parenthesized_expression") {
    const children = semanticChildren(node)

    if (children.length != 1) return unsupportedSyntax("csharp", node.type, location)
    return convertExpression(children[0], filename, source)
  }
  if (node.type == "checked_expression") {
    const children = semanticChildren(node)
    const checkedTokens = node.children.filter((child) => !child.isNamed && child.type == "checked")

    if (checkedTokens.length != 1 || children.length != 1 ||
      !["binary_expression", "prefix_unary_expression"].includes(children[0].type)) {
      return unsupportedSyntax("csharp", "checked expression shape", location)
    }
    const expression = convertExpression(children[0], filename, source, true)

    checkedArithmetic.add(expression)
    expression.location = location
    return expression
  }
  if (node.type == "identifier") {
    const name = identifier(node, "reference", filename, source)

    return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name}, {name: location})
  }
  if (node.type == "integer_literal") {
    if (!/^(?:0|[1-9][0-9]*)L$/u.test(node.text)) return unsupportedSyntax("csharp", "noncanonical long literal", location)
    const value = Number(BigInt(node.text.slice(0, -1)))

    if (!Number.isSafeInteger(value)) return unsupportedSyntax("csharp", "non-safe integer literal", location)
    return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
  }
  if (node.type == "boolean_literal") {
    if (node.text != "true" && node.text != "false") return unsupportedSyntax("csharp", "boolean literal", location)
    return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: node.text == "true"}, {literal: location})
  }
  if (node.type == "string_literal") {
    return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: decodeString(node, filename, source)}, {
      literal: location
    })
  }
  if (node.type == "prefix_unary_expression") {
    const children = semanticChildren(node)
    const operator = operatorToken(node, new Set(["!", "-"]), filename, source)

    if (children.length != 1 || operator.type == "-" && !checkedRoot) {
      return unsupportedSyntax("csharp", "unwrapped or malformed unary expression", location)
    }
    const expression = /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression",
      location,
      operand: convertExpression(children[0], filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), operator.type == "!" ? "Not" : "Negate")))

    if (checkedRoot) checkedArithmetic.add(expression)
    return expression
  }
  if (node.type == "binary_expression") {
    const leftNode = requiredField(node, "left", filename, source)
    const rightNode = requiredField(node, "right", filename, source)
    const operator = operatorToken(node, new Set(binaryOperations.keys()), filename, source)
    const adapted = binaryOperations.get(operator.type)

    if (!adapted || semanticChildren(node).length != 2 || ["-", "*"].includes(operator.type) && !checkedRoot) {
      return unsupportedSyntax("csharp", "unwrapped or unsupported binary expression", location)
    }
    const expression = /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression",
      left: convertExpression(leftNode, filename, source),
      location,
      right: convertExpression(rightNode, filename, source)
    }, {operator: nodeLocation(operator, filename, source)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (adapted))))

    if (checkedRoot) checkedArithmetic.add(expression)
    return expression
  }
  if (node.type == "invocation_expression") {
    const calleeNode = requiredField(node, "function", filename, source)
    const argumentsNode = requiredField(node, "arguments", filename, source)

    if (calleeNode.type != "identifier" || argumentsNode.type != "argument_list") {
      return unsupportedSyntax("csharp", "qualified or dynamic call", location)
    }
    const arguments_ = /** @type {import("../semantic/types.js").Expression[]} */ (
      semanticChildren(argumentsNode).map((argument) => convertArgument(argument, filename, source)))
    const callee = identifier(calleeNode, "callee", filename, source)

    return withParserRanges({arguments: arguments_, callee, kind: /** @type {const} */ ("CallExpression"), location}, {
      callee: nodeLocation(calleeNode, filename, source)
    })
  }
  return unsupportedSyntax("csharp", node.type, location)
}

/**
 * Converts one positional argument.
 * @param {import("tree-sitter").SyntaxNode} node - Argument node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").Expression} Semantic argument expression.
 */
function convertArgument(node, filename, source) {
  const children = semanticChildren(node)

  if (node.type != "argument" || children.length != 1 || node.children.some((child) => !child.isNamed && child.type == ":")) {
    return unsupportedSyntax("csharp", "non-positional argument", nodeLocation(node, filename, source))
  }
  return convertExpression(children[0], filename, source)
}

/**
 * Decodes one ordinary C# string literal without interpolation or raw forms.
 * @param {import("tree-sitter").SyntaxNode} node - String literal node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {string} Decoded Unicode scalar string.
 */
function decodeString(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const text = node.text

  if (!text.startsWith("\"") || !text.endsWith("\"") || text.startsWith("\"\"\"") || /[\r\n]/u.test(text)) {
    return unsupportedSyntax("csharp", "noncanonical string literal", location)
  }
  let decoded = ""
  const simple = new Map([["\"", "\""], ["\\", "\\"], ["0", "\0"], ["a", "\u0007"], ["b", "\b"], ["f", "\f"],
    ["n", "\n"], ["r", "\r"], ["t", "\t"], ["v", "\v"]])

  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index]

    if (character != "\\") {
      decoded += character
      continue
    }
    const escape = text[++index]

    if (escape === undefined) return unsupportedSyntax("csharp", "invalid string escape", location)
    if (simple.has(escape)) {
      decoded += simple.get(escape)
      continue
    }
    const width = escape == "u" ? 4 : escape == "U" ? 8 : 0
    const digits = text.slice(index + 1, index + 1 + width)

    if (!width || digits.length != width || !/^[0-9A-Fa-f]+$/u.test(digits)) {
      return unsupportedSyntax("csharp", "unsupported string escape", location)
    }
    index += width
    const value = Number.parseInt(digits, 16)

    if (escape == "U" && (value > 0x10FFFF || value >= 0xD800 && value <= 0xDFFF)) {
      return unsupportedSyntax("csharp", "invalid Unicode string escape", location)
    }
    decoded += escape == "U" ? String.fromCodePoint(value) : String.fromCharCode(value)
  }
  if (!hasOnlyUnicodeScalars(decoded)) return unsupportedSyntax("csharp", "invalid Unicode string literal", location)
  return decoded
}

/**
 * Converts one exact initialized local declaration.
 * @param {import("tree-sitter").SyntaxNode} node - Local statement node.
 * @param {CSharpContext} context - Comment-carrier state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").LocalDeclaration} Semantic declaration.
 */
function convertLocal(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const declaration = semanticChildren(node)[0]

  if (semanticChildren(node).length != 1 || declaration?.type != "variable_declaration") {
    return unsupportedSyntax("csharp", node.type, location)
  }
  const typeNode = declaration.childForFieldName("type")
  const declarators = semanticChildren(declaration).filter((child) => child.type == "variable_declarator")

  if (declarators.length != 1 || semanticChildren(declaration).length != 2) {
    return unsupportedSyntax("csharp", "local declaration shape", location)
  }
  const declarator = declarators[0]
  const nameNode = requiredField(declarator, "name", filename, source)
  const values = semanticChildren(declarator).filter((child) => child.id != nameNode.id)

  if (values.length != 1) return unsupportedSyntax("csharp", "local without one initializer", location)
  const name = identifier(nameNode, "local", filename, source)

  if (name == "System") return unsupportedSyntax("csharp", "local captures System", nodeLocation(nameNode, filename, source))
  const operator = operatorToken(declarator, new Set(["="]), filename, source)
  const mutable = !takeImmutableMarker(node, context)

  return withParserRanges({
    initializer: convertExpression(values[0], filename, source),
    kind: /** @type {const} */ ("LocalDeclaration"),
    location,
    mutable,
    name,
    type: convertType(typeNode, `Local '${name}'`, location, filename, source, true)
  }, {name: nodeLocation(nameNode, filename, source), operator: nodeLocation(operator, filename, source)})
}

/**
 * Claims an exactly adjacent immutable-local carrier if present.
 * @param {import("tree-sitter").SyntaxNode} node - Local declaration node.
 * @param {CSharpContext} context - Comment-carrier state.
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
 * Converts one supported C# statement.
 * @param {import("tree-sitter").SyntaxNode} node - Statement node.
 * @param {CSharpContext} context - Comment-carrier state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").Statement} Semantic statement.
 */
function convertStatement(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "local_declaration_statement") return convertLocal(node, context, filename, source)
  if (node.type == "return_statement") {
    const children = semanticChildren(node)

    if (children.length != 1) return unsupportedSyntax("csharp", "return without one expression", location)
    return {expression: convertExpression(children[0], filename, source), kind: /** @type {const} */ ("ReturnStatement"), location}
  }
  if (node.type == "if_statement") return convertIf(node, context, filename, source)
  if (node.type == "expression_statement") {
    const children = semanticChildren(node)

    if (children.length != 1) return unsupportedSyntax("csharp", node.type, location)
    if (children[0].type == "assignment_expression") return convertAssignment(children[0], filename, source, location)
    return convertPrint(children[0], filename, source, location)
  }
  return unsupportedSyntax("csharp", node.type, location)
}

/**
 * Converts one plain identifier assignment.
 * @param {import("tree-sitter").SyntaxNode} node - Assignment expression node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @param {import("../semantic/types.js").SourceLocation} location - Owning statement location.
 * @returns {import("../semantic/types.js").AssignmentStatement} Semantic assignment.
 */
function convertAssignment(node, filename, source, location) {
  const left = requiredField(node, "left", filename, source)
  const right = requiredField(node, "right", filename, source)
  const operator = operatorToken(node, new Set(["="]), filename, source)

  if (left.type != "identifier") return unsupportedSyntax("csharp", "assignment target", nodeLocation(left, filename, source))
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
 * Converts the exact System.Console.WriteLine print scaffold.
 * @param {import("tree-sitter").SyntaxNode} node - Invocation node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @param {import("../semantic/types.js").SourceLocation} location - Owning statement location.
 * @returns {import("../semantic/types.js").PrintStatement} Semantic print statement.
 */
function convertPrint(node, filename, source, location) {
  if (node.type != "invocation_expression") return unsupportedSyntax("csharp", "expression statement other than print", nodeLocation(node, filename, source))
  const callee = requiredField(node, "function", filename, source)
  const argumentsNode = requiredField(node, "arguments", filename, source)
  const arguments_ = semanticChildren(argumentsNode)

  if (!isPrintReceiver(callee) || argumentsNode.type != "argument_list" || arguments_.length != 1) {
    return unsupportedSyntax("csharp", "print call shape", nodeLocation(node, filename, source))
  }
  return {expression: convertArgument(arguments_[0], filename, source), kind: /** @type {const} */ ("PrintStatement"), location}
}

/**
 * Recognizes only the fully qualified print receiver.
 * @param {import("tree-sitter").SyntaxNode} node - Candidate callee.
 * @returns {boolean} Whether the callee is the exact print receiver.
 */
function isPrintReceiver(node) {
  if (node.type != "member_access_expression") return false
  const outerExpression = node.childForFieldName("expression")
  const outerName = node.childForFieldName("name")

  if (outerName?.text != "WriteLine" || outerExpression?.type != "member_access_expression") return false
  return outerExpression.childForFieldName("expression")?.type == "identifier" &&
    outerExpression.childForFieldName("expression")?.text == "System" && outerExpression.childForFieldName("name")?.text == "Console"
}

/**
 * Converts one braced conditional and optional alternate.
 * @param {import("tree-sitter").SyntaxNode} node - If-statement node.
 * @param {CSharpContext} context - Comment-carrier state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").IfStatement} Semantic conditional.
 */
function convertIf(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const condition = requiredField(node, "condition", filename, source)
  const consequence = requiredField(node, "consequence", filename, source)
  const alternative = node.childForFieldName("alternative")

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
 * Converts one lexical C# block.
 * @param {import("tree-sitter").SyntaxNode} node - Block node.
 * @param {CSharpContext} context - Comment-carrier state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").Block} Semantic block.
 */
function convertBlock(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "block") return unsupportedSyntax("csharp", node.type, location)
  return {kind: /** @type {const} */ ("Block"), location,
    statements: semanticChildren(node).map((statement) => convertStatement(statement, context, filename, source))}
}

/**
 * Converts one exact private static semantic method.
 * @param {import("tree-sitter").SyntaxNode} node - Method node.
 * @param {CSharpContext} context - Comment-carrier state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const children = semanticChildren(node)
  const modifiers = children.filter((child) => child.type == "modifier")

  if (node.type != "method_declaration" || modifiers.map(({text}) => text).join(" ") != "private static" ||
    children.length != 6 || node.childForFieldName("type_parameters") || node.childForFieldName("constraints") ||
    !node.childForFieldName("body")) {
    return unsupportedSyntax("csharp", "method scaffolding", location)
  }
  const nameNode = requiredField(node, "name", filename, source)
  const parametersNode = requiredField(node, "parameters", filename, source)
  const returnNode = requiredField(node, "returns", filename, source)
  const bodyNode = requiredField(node, "body", filename, source)
  const name = identifier(nameNode, "function", filename, source)

  if (["Main", "Program", "System"].includes(name)) {
    return unsupportedSyntax("csharp", `reserved semantic method '${name}'`, nodeLocation(nameNode, filename, source))
  }
  const parameterNodes = semanticChildren(parametersNode)

  if (parameterNodes.length != 2 || parameterNodes.some((parameter) => parameter.type != "parameter")) {
    return unsupportedSyntax("csharp", "function parameter count or shape", nodeLocation(parametersNode, filename, source))
  }
  const parameters = parameterNodes.map((parameterNode) => convertParameter(parameterNode, filename, source))

  return withParserRanges({
    body: convertBlock(bodyNode, context, filename, source),
    kind: /** @type {const} */ ("FunctionDeclaration"),
    location,
    name,
    parameters,
    returnType: convertType(returnNode, `Function '${name}' return`, location, filename, source)
  }, {name: nodeLocation(nameNode, filename, source)})
}

/**
 * Converts one explicitly typed unmodified parameter.
 * @param {import("tree-sitter").SyntaxNode} node - Parameter node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").Parameter} Semantic parameter.
 */
function convertParameter(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const nameNode = requiredField(node, "name", filename, source)
  const typeNode = node.childForFieldName("type")

  if (semanticChildren(node).length != 2) return unsupportedSyntax("csharp", "parameter modifiers or defaults", location)
  const name = identifier(nameNode, "parameter", filename, source)

  if (name == "System") return unsupportedSyntax("csharp", "parameter captures System", nodeLocation(nameNode, filename, source))
  return withParserRanges({
    kind: /** @type {const} */ ("Parameter"), location, name,
    type: convertType(typeNode, `Parameter '${name}'`, location, filename, source)
  }, {name: nodeLocation(nameNode, filename, source)})
}

/**
 * Converts the exact final zero-argument Main method.
 * @param {import("tree-sitter").SyntaxNode} node - Main method node.
 * @param {CSharpContext} context - Comment-carrier state.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source text.
 * @returns {import("../semantic/types.js").EntryPoint} Semantic entry point.
 */
function convertMain(node, context, filename, source) {
  const location = nodeLocation(node, filename, source)
  const children = semanticChildren(node)
  const modifiers = children.filter((child) => child.type == "modifier")
  const name = requiredField(node, "name", filename, source)
  const returns = requiredField(node, "returns", filename, source)
  const parameters = requiredField(node, "parameters", filename, source)
  const body = requiredField(node, "body", filename, source)

  if (children.length != 6 || modifiers.map(({text}) => text).join(" ") != "private static" || name.text != "Main" || returns.text != "void" ||
    semanticChildren(parameters).length != 0) return unsupportedSyntax("csharp", "Main scaffolding", location)
  return {body: convertBlock(body, context, filename, source), kind: /** @type {const} */ ("EntryPoint"), location}
}

/**
 * Requires exactly one checked wrapper around every integer arithmetic root.
 * @param {import("../semantic/types.js").SemanticModule} module - Resolved semantic module.
 * @returns {void}
 */
function validateCheckedArithmetic(module) {
  /** @type {import("../semantic/types.js").Expression[]} */
  const expressions = []
  /**
   * Collects expressions recursively.
   * @param {import("../semantic/types.js").Expression} expression - Current expression.
   * @returns {void}
   */
  const visitExpression = (expression) => {
    expressions.push(expression)
    if (expression.kind == "UnaryExpression") visitExpression(expression.operand)
    else if (expression.kind == "BinaryExpression") {
      visitExpression(expression.left)
      visitExpression(expression.right)
    } else if (expression.kind == "CallExpression") expression.arguments.forEach(visitExpression)
  }
  /**
   * Collects expressions from a semantic block.
   * @param {import("../semantic/types.js").Block} block - Current block.
   * @returns {void}
   */
  const visitBlock = (block) => block.statements.forEach((statement) => {
    if (statement.kind == "LocalDeclaration") visitExpression(statement.initializer)
    else if (statement.kind == "AssignmentStatement" || statement.kind == "PrintStatement" || statement.kind == "ReturnStatement") {
      visitExpression(statement.expression)
    } else {
      visitExpression(statement.condition)
      visitBlock(statement.consequent)
      if (statement.alternate) visitBlock(statement.alternate)
    }
  })

  module.functions.forEach((declaration) => visitBlock(declaration.body))
  visitBlock(module.entryPoint.body)
  for (const expression of expressions) {
    const arithmetic = expression.kind == "UnaryExpression" && expression.operation == "IntegerNegate" ||
      expression.kind == "BinaryExpression" && ["IntegerAdd", "IntegerSubtract", "IntegerMultiply"].includes(expression.operation)

    if (arithmetic != checkedArithmetic.has(expression)) {
      return unsupportedSyntax("csharp", arithmetic ? "integer arithmetic without exact checked wrapper" : "checked non-integer expression",
        expression.location)
    }
  }
}

/**
 * Parses the strict Task 017 C# profile.
 * @param {{filename: string, source: string}} input - Parser input.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseCSharp({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const invalidOffset = firstLoneSurrogateOffset(source)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "csharp",
      location: locationFromOffsets(filename, source, invalidOffset, invalidOffset + 1),
      message: "C# source contains an invalid lone UTF-16 surrogate."})
  }
  let tree

  try {
    tree = parser.parse(source)
  } catch (error) {
    return parseFailure("csharp", error)
  }
  const root = tree.rootNode

  validateParserTree(root, filename, source)
  if (root.type != "compilation_unit") throw new Error(`Tree-sitter returned C# root '${root.type}'.`)
  const children = semanticChildren(root)
  const location = moduleLocation(filename, source)

  if (children.length != 3 || children[0].type != "preproc_nullable" ||
    !/^#nullable enable(?:(?:\r\n|\n|\r))+$/u.test(children[0].text) ||
    children[1].type != "file_scoped_namespace_declaration" || children[2].type != "class_declaration") {
    return unsupportedSyntax("csharp", "compilation-unit scaffolding", location)
  }
  const namespaceName = requiredField(children[1], "name", filename, source)

  if (namespaceName.text != "Semantifold.Generated") {
    return unsupportedSyntax("csharp", "namespace scaffolding", nodeLocation(children[1], filename, source))
  }
  const classNode = children[2]
  const className = requiredField(classNode, "name", filename, source)
  const classBody = requiredField(classNode, "body", filename, source)
  const classChildren = semanticChildren(classNode)
  const classModifiers = classChildren.filter((child) => child.type == "modifier")

  if (classChildren.length != 4 || className.text != "Program" ||
    classModifiers.map(({text}) => text).join(" ") != "internal static") {
    return unsupportedSyntax("csharp", "Program class scaffolding", nodeLocation(classNode, filename, source))
  }
  const members = semanticChildren(classBody)

  if (members.length < 2 || members.some((member) => member.type != "method_declaration")) {
    return unsupportedSyntax("csharp", "Program members", nodeLocation(classBody, filename, source))
  }
  const mainNodes = members.filter((member) => member.childForFieldName("name")?.text == "Main")

  if (mainNodes.length != 1 || members.at(-1)?.id != mainNodes[0].id) {
    return unsupportedSyntax("csharp", "Main ordering", nodeLocation(classBody, filename, source))
  }
  const comments = root.descendantsOfType("comment")
  const context = {comments, usedImmutableMarkers: new Set()}
  const module = {
    entryPoint: convertMain(mainNodes[0], context, filename, source),
    functions: members.slice(0, -1).map((member) => convertFunction(member, context, filename, source)),
    kind: /** @type {const} */ ("Module"),
    location
  }
  const unusedMarker = comments.find((comment) => comment.text == immutableMarker && !context.usedImmutableMarkers.has(comment))

  if (unusedMarker) return unsupportedSyntax("csharp", "unattached immutable marker", nodeLocation(unusedMarker, filename, source))
  validateParsedModule(module, "csharp")
  validateCheckedArithmetic(module)
  return module
}
