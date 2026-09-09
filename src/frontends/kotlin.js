// @ts-check

import Parser from "tree-sitter"
import KotlinLanguage from "tree-sitter-kotlin"
import {isKotlinIdentifier} from "../backends/identifiers.js"
import {kotlinRuntime} from "../backends/kotlin-runtime.js"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"

const parser = new Parser()

parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (KotlinLanguage)))

const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])
const binaryNodeOperators = new Map([
  ["additive_expression", new Set(["+", "-"])],
  ["multiplicative_expression", new Set(["*"])],
  ["equality_expression", new Set(["==", "!="])],
  ["comparison_expression", new Set(["<", "<=", ">", ">="])],
  ["conjunction_expression", new Set(["&&"])],
  ["disjunction_expression", new Set(["||"])]
])
/** @type {Map<string, import("../semantic/operators.js").AdaptedOperation>} */
const helperOperations = new Map([
  ["semantifold_integer_add", "Add"], ["semantifold_integer_subtract", "Subtract"],
  ["semantifold_integer_multiply", "Multiply"], ["semantifold_integer_negate", "Negate"]
])
const commentTypes = new Set(["line_comment", "multiline_comment"])

/**
 * Verifies a Tree-sitter binding index through the shared byte converter.
 * @param {string} source - Complete source.
 * @param {number} index - Binding-reported UTF-16 index.
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
 * @param {string} source - Complete source.
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

/** Consumes exact qualified Kotlin CST shapes without retaining parser handles. */
class KotlinReader {
  /**
   * Creates a reader over one parser-owned Kotlin source.
   * @param {string} filename - Original filename.
   * @param {string} source - Complete source.
   */
  constructor(filename, source) {
    this.filename = filename
    this.source = source
    this.runtime = false
  }

  /**
   * Converts one parser range to Semantifold UTF-16 coordinates.
   * @param {import("tree-sitter").SyntaxNode} node - Parser node.
   * @returns {import("../semantic/types.js").SourceLocation} Exact location.
   */
  location(node) {
    return locationFromOffsets(this.filename, this.source, bindingIndexToUtf16Offset(this.source, node.startIndex),
      bindingIndexToUtf16Offset(this.source, node.endIndex))
  }

  /**
   * Rejects one located source-profile violation.
   * @param {import("tree-sitter").SyntaxNode} node - Violating node.
   * @param {string} [detail] - Profile detail.
   * @returns {never} Always throws.
   */
  fail(node, detail = node.type) {
    unsupportedSyntax("kotlin", detail, this.location(node))
  }

  /**
   * Traverses every named, anonymous, extra, directive, and recovery node.
   * @param {import("tree-sitter").SyntaxNode} root - Complete parser root.
   * @returns {void}
   */
  validateTree(root) {
    const pending = [{depth: 0, node: root, visited: false}]

    while (pending.length) {
      const current = pending.pop()

      if (!current) throw new Error("Kotlin traversal lost a pending parser node.")
      const {depth, node, visited} = current

      if (depth > 512) this.fail(node, "CST exceeds the 512-level traversal limit")
      if (!visited) {
        pending.push({depth, node, visited: true})
        for (let index = node.childCount - 1; index >= 0; index -= 1) {
          const child = node.child(index)

          if (!child) throw new Error(`Tree-sitter omitted child ${index} of ${node.type}.`)
          pending.push({depth: depth + 1, node: child, visited: false})
        }
        continue
      }
      if (node.hasError || node.isError || node.isMissing) {
        throw new SemantifoldDiagnostic({
          code: "PARSE_ERROR",
          language: "kotlin",
          location: this.location(node),
          message: `Tree-sitter exposed recovery at '${node.type}'.`
        })
      }
      if (["annotation", "file_annotation", "shebang_line"].includes(node.type)) this.fail(node, node.type)
      if (commentTypes.has(node.type) && /(?:language|api|jvm)[-_ ]version/iu.test(node.text)) {
        this.fail(node, "directive-bearing comment")
      }
    }
  }

  /**
   * Omits only inert comments already accounted for by exhaustive traversal.
   * @param {import("tree-sitter").SyntaxNode} node - Parent node.
   * @returns {import("tree-sitter").SyntaxNode[]} Structural children.
   */
  parts(node) {
    return node.children.filter((child) => !commentTypes.has(child.type))
  }

  /**
   * Requires all ordered children, including anonymous punctuation.
   * @param {import("tree-sitter").SyntaxNode} node - Shape owner.
   * @param {(import("tree-sitter").SyntaxNode | string)[]} expected - Exact child sequence.
   * @returns {void}
   */
  shape(node, expected) {
    const actual = this.parts(node)

    if (actual.length != expected.length) this.fail(actual[Math.min(actual.length, expected.length)] ?? node, `${node.type} child shape`)
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index]
      const child = actual[index]
      const matches = typeof wanted == "string" ? child.text == wanted : child.id == wanted.id

      if (!matches) this.fail(child, `${node.type} child shape`)
    }
  }

  /**
   * Requires one exact parser field edge.
   * @param {import("tree-sitter").SyntaxNode} node - Field owner.
   * @param {string} name - Field name.
   * @returns {import("tree-sitter").SyntaxNode} Sole field node.
   */
  field(node, name) {
    const matches = []

    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index)

      if (!child) throw new Error(`Tree-sitter omitted child ${index} of ${node.type}.`)
      if (node.fieldNameForChild(index) == name) matches.push(child)
    }
    if (matches.length != 1) this.fail(node, `expected one '${name}' field`)
    return matches[0]
  }

  /**
   * Validates one Kotlin identifier in the portable source profile.
   * @param {import("tree-sitter").SyntaxNode} node - Identifier token.
   * @param {boolean} [allowMain] - Whether the fixed main scaffold is expected.
   * @param {boolean} [allowPrint] - Whether the fixed print scaffold is expected.
   * @returns {string} Accepted spelling.
   */
  identifier(node, allowMain = false, allowPrint = false) {
    const name = node.text

    if (node.type != "simple_identifier" || !(allowMain && name == "main") && !(allowPrint && name == "println") &&
      (!isKotlinIdentifier(name) || name.normalize("NFC") != name)) this.fail(node, "reserved or unsupported identifier")
    return name
  }

  /**
   * Converts exactly Long, Boolean, or String.
   * @param {import("tree-sitter").SyntaxNode} node - Type node.
   * @returns {import("../semantic/types.js").TypeReference} Semantic scalar.
   */
  type(node) {
    const parts = this.parts(node)

    if (node.type != "user_type" || parts.length != 1 || parts[0].type != "type_identifier") this.fail(node, "scalar type shape")
    this.shape(node, [parts[0]])
    const type = sourceScalarType("kotlin", parts[0].text, this.location(parts[0]))

    if (!type) this.fail(parts[0], `unsupported scalar type '${parts[0].text}'`)
    return type
  }

  /**
   * Decodes an ordinary noninterpolated Kotlin string.
   * @param {import("tree-sitter").SyntaxNode} node - String literal node.
   * @returns {string} Decoded Unicode scalar string.
   */
  string(node) {
    const parts = this.parts(node)

    if (node.type != "string_literal" || parts.some((part) => part.type != "string_content") ||
      !node.text.startsWith('"') || !node.text.endsWith('"')) this.fail(node, "ordinary noninterpolated string literal required")
    this.shape(node, parts)
    let value = ""
    const simpleEscapes = new Map([
      ["t", "\t"], ["b", "\b"], ["n", "\n"], ["r", "\r"], ["'", "'"], ['"', '"'], ["\\", "\\"], ["$", "$"]
    ])

    for (let index = 1; index < node.text.length - 1; index += 1) {
      const character = node.text[index]

      if (character != "\\") {
        if (character == "\n" || character == "\r" || character == '"') this.fail(node, "invalid string content")
        value += character
        continue
      }
      const escaped = node.text[++index]

      if (simpleEscapes.has(escaped)) value += simpleEscapes.get(escaped)
      else if (escaped == "u") {
        const hexadecimal = node.text.slice(index + 1, index + 5)

        if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) this.fail(node, "unsupported string escape")
        value += String.fromCharCode(Number.parseInt(hexadecimal, 16))
        index += 4
      } else this.fail(node, "unsupported string escape")
    }
    if (!hasOnlyUnicodeScalars(value)) this.fail(node, "invalid Unicode string literal")
    return value
  }

  /**
   * Extracts exact unnamed call arguments.
   * @param {import("tree-sitter").SyntaxNode} suffix - Call suffix node.
   * @returns {import("tree-sitter").SyntaxNode[]} Argument expression nodes.
   */
  arguments(suffix) {
    const suffixParts = this.parts(suffix)

    if (suffix.type != "call_suffix" || suffixParts.length != 1 || suffixParts[0].type != "value_arguments") {
      return this.fail(suffix, "call suffix shape")
    }
    this.shape(suffix, [suffixParts[0]])
    const list = suffixParts[0]
    const parts = this.parts(list)

    if (parts.length < 2 || parts[0].text != "(" || parts.at(-1)?.text != ")") this.fail(list, "call argument list shape")
    const arguments_ = parts.slice(1, -1).filter((_part, index) => index % 2 == 0)

    this.shape(list, ["(", ...arguments_.flatMap((argument, index) => index ? [",", argument] : [argument]), ")"])
    return arguments_.map((argument) => {
      const argumentParts = this.parts(argument)

      if (argument.type != "value_argument" || argumentParts.length != 1) this.fail(argument, "unnamed argument required")
      this.shape(argument, [argumentParts[0]])
      return argumentParts[0]
    })
  }

  /**
   * Converts a direct semantic or generated-helper call.
   * @param {import("tree-sitter").SyntaxNode} node - Call expression node.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  call(node) {
    const parts = this.parts(node)

    if (node.type != "call_expression" || parts.length != 2 || parts[0].type != "simple_identifier") this.fail(node, "direct call shape")
    this.shape(node, [parts[0], parts[1]])
    const argumentNodes = this.arguments(parts[1])
    const name = parts[0].text
    const helper = this.runtime ? helperOperations.get(name) : undefined
    const location = this.location(node)

    if (helper) {
      const count = helper == "Negate" ? 1 : 2

      if (argumentNodes.length != count) this.fail(node, "Kotlin checked-integer helper shape")
      if (helper == "Negate") {
        return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
          kind: /** @type {const} */ ("UnaryExpression"), location, operand: this.expression(argumentNodes[0])
        }, {operator: this.location(parts[0])}), helper)))
      }
      return /** @type {import("../semantic/types.js").Expression} */ (withAdaptedOperation(withParserRanges({
        kind: /** @type {const} */ ("BinaryExpression"), left: this.expression(argumentNodes[0]), location, right: this.expression(argumentNodes[1])
      }, {operator: this.location(parts[0])}), helper))
    }
    const semanticName = this.identifier(parts[0])

    if (argumentNodes.length != 2) this.fail(parts[1], "semantic call argument count")
    return withParserRanges({
      arguments: argumentNodes.map((argument) => this.expression(argument)), callee: semanticName,
      kind: /** @type {const} */ ("CallExpression"), location
    }, {callee: this.location(parts[0])})
  }

  /**
   * Converts one supported scalar expression.
   * @param {import("tree-sitter").SyntaxNode} node - Expression node.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  expression(node) {
    const location = this.location(node)

    if (node.type == "simple_identifier") {
      return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name: this.identifier(node)}, {name: location})
    }
    if (node.type == "integer_literal" || node.type == "long_literal") {
      const literal = node.type == "long_literal" ? this.parts(node)[0] : node

      if (node.type == "long_literal") this.shape(node, [literal, "L"])
      if (!literal || literal.type != "integer_literal" || !/^(?:0|[1-9][0-9]*)$/u.test(literal.text) ||
        node.type == "long_literal" && !/L$/u.test(node.text)) this.fail(node, "noncanonical integer literal")
      const value = Number(BigInt(literal.text))

      if (!Number.isSafeInteger(value)) this.fail(node, "non-safe integer literal")
      return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
    }
    if (node.type == "boolean_literal") {
      const parts = this.parts(node)

      if (parts.length != 1 || !["true", "false"].includes(parts[0].text)) this.fail(node, "Boolean literal shape")
      this.shape(node, [parts[0].text])
      return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: parts[0].text == "true"}, {literal: location})
    }
    if (node.type == "string_literal") {
      return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: this.string(node)}, {literal: location})
    }
    if (node.type == "parenthesized_expression") {
      const parts = this.parts(node)

      if (parts.length != 3) this.fail(node, "parenthesized expression shape")
      this.shape(node, ["(", parts[1], ")"])
      return this.expression(parts[1])
    }
    if (node.type == "prefix_expression") {
      const parts = this.parts(node)

      if (parts.length != 2 || !["-", "!"].includes(parts[0].text)) this.fail(node, "unary operator")
      this.shape(node, [parts[0].text, parts[1]])
      return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
        kind: /** @type {const} */ ("UnaryExpression"), location, operand: this.expression(parts[1])
      }, {operator: this.location(parts[0])}), parts[0].text == "-" ? "Negate" : "Not")))
    }
    if (binaryNodeOperators.has(node.type)) return this.binary(node)
    if (node.type == "call_expression") return this.call(node)
    return this.fail(node)
  }

  /**
   * Converts one binary expression.
   * @param {import("tree-sitter").SyntaxNode} node - Binary expression node.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  binary(node) {
    const parts = this.parts(node)
    const accepted = binaryNodeOperators.get(node.type)

    if (parts.length != 3) this.fail(node, `${node.type} child shape`)
    this.shape(node, [parts[0], parts[1], parts[2]])
    const operation = binaryOperations.get(parts[1].text)

    if (!accepted?.has(parts[1].text) || !operation) this.fail(parts[1], "unsupported binary operator")
    return /** @type {import("../semantic/types.js").Expression} */ (withAdaptedOperation(withParserRanges({
      kind: /** @type {const} */ ("BinaryExpression"), left: this.expression(parts[0]), location: this.location(node), right: this.expression(parts[2])
    }, {operator: this.location(parts[1])}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (operation)))
  }

  /**
   * Converts one explicitly typed local declaration.
   * @param {import("tree-sitter").SyntaxNode} node - Property declaration node.
   * @returns {import("../semantic/types.js").LocalDeclaration} Semantic declaration.
   */
  local(node) {
    const parts = this.parts(node)
    const location = this.location(node)

    if (node.type != "property_declaration" || parts.length != 4 || parts[0].type != "binding_pattern_kind" ||
      parts[1].type != "variable_declaration" || parts[2].text != "=") this.fail(node, "local declaration shape")
    const bindingParts = this.parts(parts[0])
    const variableParts = this.parts(parts[1])

    if (bindingParts.length != 1 || !["val", "var"].includes(bindingParts[0].text)) this.fail(parts[0], "local binding kind")
    if (variableParts.length == 1) return missingType("kotlin", "Local", location)
    if (variableParts.length != 3 || variableParts[0].type != "simple_identifier" || variableParts[1].text != ":") {
      this.fail(parts[1], "local declaration shape")
    }
    this.shape(parts[0], [bindingParts[0].text])
    this.shape(parts[1], [variableParts[0], ":", variableParts[2]])
    this.shape(node, [parts[0], parts[1], "=", parts[3]])
    const name = this.identifier(variableParts[0])

    return withParserRanges({
      initializer: this.expression(parts[3]), kind: /** @type {const} */ ("LocalDeclaration"), location,
      mutable: bindingParts[0].text == "var", name, type: this.type(variableParts[2])
    }, {name: this.location(variableParts[0]), operator: this.location(parts[2])})
  }

  /**
   * Converts one plain local assignment.
   * @param {import("tree-sitter").SyntaxNode} node - Assignment node.
   * @returns {import("../semantic/types.js").AssignmentStatement} Semantic assignment.
   */
  assignment(node) {
    const parts = this.parts(node)

    if (node.type != "assignment" || parts.length != 3 || parts[0].type != "directly_assignable_expression" || parts[1].text != "=") {
      this.fail(node, "assignment shape")
    }
    const targetParts = this.parts(parts[0])

    if (targetParts.length != 1 || targetParts[0].type != "simple_identifier") this.fail(parts[0], "assignment target shape")
    this.shape(parts[0], [targetParts[0]])
    this.shape(node, [parts[0], "=", parts[2]])
    const name = this.identifier(targetParts[0])
    const targetLocation = this.location(targetParts[0])

    return withParserRanges({
      expression: this.expression(parts[2]), kind: /** @type {const} */ ("AssignmentStatement"), location: this.location(node),
      target: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name}, {name: targetLocation})
    }, {operator: this.location(parts[1])})
  }

  /**
   * Converts the exact println entry scaffold.
   * @param {import("tree-sitter").SyntaxNode} node - Call node.
   * @returns {import("../semantic/types.js").PrintStatement} Semantic print.
   */
  print(node) {
    const parts = this.parts(node)

    if (node.type != "call_expression" || parts.length != 2 || parts[0].type != "simple_identifier" ||
      this.identifier(parts[0], false, true) != "println") this.fail(node, "exact println call required")
    const arguments_ = this.arguments(parts[1])

    if (arguments_.length != 1) this.fail(parts[1], "println argument count")
    return {expression: this.expression(arguments_[0]), kind: /** @type {const} */ ("PrintStatement"), location: this.location(node)}
  }

  /**
   * Converts one supported statement.
   * @param {import("tree-sitter").SyntaxNode} node - Statement node.
   * @returns {import("../semantic/types.js").Statement} Semantic statement.
   */
  statement(node) {
    if (node.type == "property_declaration") return this.local(node)
    if (node.type == "assignment") return this.assignment(node)
    if (node.type == "if_expression") return this.conditional(node)
    if (node.type == "call_expression") return this.print(node)
    if (node.type == "jump_expression") {
      const parts = this.parts(node)

      if (parts.length != 2 || parts[0].text != "return") this.fail(node, "return expression shape")
      this.shape(node, ["return", parts[1]])
      return {expression: this.expression(parts[1]), kind: /** @type {const} */ ("ReturnStatement"), location: this.location(node)}
    }
    return this.fail(node)
  }

  /**
   * Converts an optional parser statement list.
   * @param {import("tree-sitter").SyntaxNode | undefined} node - Statement-list node.
   * @returns {import("../semantic/types.js").Statement[]} Semantic statements.
   */
  statements(node) {
    if (!node) return []
    if (node.type != "statements") this.fail(node, "statement list shape")
    return this.parts(node).map((statement) => this.statement(statement))
  }

  /**
   * Converts one braced conditional body.
   * @param {import("tree-sitter").SyntaxNode} node - Control body node.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  controlBody(node) {
    const parts = this.parts(node)
    const statements = parts[1]?.type == "statements" ? parts[1] : undefined

    if (node.type != "control_structure_body") this.fail(node, "conditional block shape")
    this.shape(node, ["{", ...(statements ? [statements] : []), "}"])
    return {kind: /** @type {const} */ ("Block"), location: this.location(node), statements: this.statements(statements)}
  }

  /**
   * Converts one strict Boolean conditional.
   * @param {import("tree-sitter").SyntaxNode} node - If expression node.
   * @returns {import("../semantic/types.js").IfStatement} Semantic conditional.
   */
  conditional(node) {
    const parts = this.parts(node)
    const condition = this.field(node, "condition")
    const consequence = this.field(node, "consequence")
    const base = ["if", "(", condition, ")", consequence]

    if (node.type != "if_expression" || consequence.type != "control_structure_body") this.fail(node, "if expression shape")
    const statement = /** @type {import("../semantic/types.js").IfStatement} */ ({
      condition: this.expression(condition), consequent: this.controlBody(consequence), kind: /** @type {const} */ ("IfStatement"),
      location: this.location(node)
    })

    if (parts.length == base.length) {
      this.shape(node, base)
      return statement
    }
    const alternative = this.field(node, "alternative")

    this.shape(node, [...base, "else", alternative])
    if (alternative.type != "control_structure_body") this.fail(alternative, "if alternate shape")
    const alternativeParts = this.parts(alternative)

    if (alternativeParts.length == 1 && alternativeParts[0].type == "if_expression") {
      this.shape(alternative, [alternativeParts[0]])
      return {...statement, alternate: {kind: /** @type {const} */ ("Block"), location: this.location(alternative),
        statements: [this.conditional(alternativeParts[0])]}}
    }
    return {...statement, alternate: this.controlBody(alternative)}
  }

  /**
   * Converts one exact braced block.
   * @param {import("tree-sitter").SyntaxNode} node - Block node.
   * @param {"function_body" | "control_structure_body"} type - Required parser node type.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  block(node, type = "function_body") {
    const parts = this.parts(node)
    const statements = parts[1]?.type == "statements" ? parts[1] : undefined

    if (node.type != type) this.fail(node, `${type} shape`)
    this.shape(node, ["{", ...(statements ? [statements] : []), "}"])
    return {kind: /** @type {const} */ ("Block"), location: this.location(node), statements: this.statements(statements)}
  }

  /**
   * Converts one explicitly typed parameter.
   * @param {import("tree-sitter").SyntaxNode} node - Parameter node.
   * @returns {import("../semantic/types.js").Parameter} Semantic parameter.
   */
  parameter(node) {
    const parts = this.parts(node)

    if (node.type != "parameter" || parts.length != 3 || parts[0].type != "simple_identifier" || parts[1].text != ":") {
      this.fail(node, "parameter shape")
    }
    this.shape(node, [parts[0], ":", parts[2]])
    const name = this.identifier(parts[0])

    return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: this.location(node), name, type: this.type(parts[2])}, {
      name: this.location(parts[0])
    })
  }

  /**
   * Converts one supported top-level function.
   * @param {import("tree-sitter").SyntaxNode} node - Function declaration node.
   * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
   */
  function(node) {
    const parts = this.parts(node)

    if (node.type != "function_declaration" || parts.length < 4 || parts[0].text != "fun" || parts[1].type != "simple_identifier" ||
      parts[2].type != "function_value_parameters" || parts.at(-1)?.type != "function_body") this.fail(node, "function declaration shape")
    if (!parts.some((part) => part.text == ":")) return missingType("kotlin", "Function return", this.location(node))
    if (parts.length != 6 || parts[3].text != ":") this.fail(node, "function declaration shape")
    this.shape(node, ["fun", parts[1], parts[2], ":", parts[4], parts[5]])
    const parameterParts = this.parts(parts[2])
    const parameters = parameterParts.filter((part) => part.type == "parameter")

    if (parameters.length != 2) this.fail(parts[2], "function parameter count other than two")
    this.shape(parts[2], ["(", parameters[0], ",", parameters[1], ")"])
    const name = this.identifier(parts[1])

    return withParserRanges({
      body: this.block(parts[5]), kind: /** @type {const} */ ("FunctionDeclaration"), location: this.location(node), name,
      parameters: parameters.map((parameter) => this.parameter(parameter)), returnType: this.type(parts[4])
    }, {name: this.location(parts[1])})
  }

  /**
   * Converts the exact final main function.
   * @param {import("tree-sitter").SyntaxNode} node - Main declaration node.
   * @returns {import("../semantic/types.js").EntryPoint} Semantic entry point.
   */
  main(node) {
    const parts = this.parts(node)

    if (node.type != "function_declaration" || parts.length != 4 || parts[0].text != "fun" ||
      this.identifier(parts[1], true) != "main" || parts[2].type != "function_value_parameters" || parts[3].type != "function_body") {
      this.fail(node, "exact main declaration required")
    }
    this.shape(parts[2], ["(", ")"])
    this.shape(node, ["fun", parts[1], parts[2], parts[3]])
    return {body: this.block(parts[3]), kind: /** @type {const} */ ("EntryPoint"), location: this.location(node)}
  }

  /**
   * Compares source support with the canonical generated helper CST.
   * @param {import("tree-sitter").SyntaxNode} actual - Source node.
   * @param {import("tree-sitter").SyntaxNode} expected - Canonical support node.
   * @returns {void}
   */
  compareTree(actual, expected) {
    if (actual.type != expected.type || actual.isNamed != expected.isNamed || actual.isExtra != expected.isExtra ||
      actual.childCount != expected.childCount) this.fail(actual, "modified Kotlin support node")
    if (!actual.childCount && actual.text != expected.text) this.fail(actual, "modified Kotlin support token")
    for (let index = 0; index < actual.childCount; index += 1) {
      const left = actual.child(index)
      const right = expected.child(index)

      if (!left || !right || actual.fieldNameForChild(index) != expected.fieldNameForChild(index)) {
        this.fail(left ?? actual, "modified Kotlin support field")
      }
      this.compareTree(left, right)
    }
  }

  /**
   * Converts and validates one complete Kotlin source file.
   * @param {import("tree-sitter").SyntaxNode} root - Source file root.
   * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
   */
  module(root) {
    this.validateTree(root)
    if (root.type != "source_file") this.fail(root, "source file root")
    const parts = this.parts(root)
    const supportTree = parser.parse(kotlinRuntime)
    const support = this.parts(supportTree.rootNode)
    let supportIndex = 0

    while (supportIndex < parts.length && supportIndex < support.length && parts[supportIndex].type == support[supportIndex].type) {
      this.compareTree(parts[supportIndex], support[supportIndex])
      supportIndex += 1
    }
    if (supportIndex > 0 && supportIndex != support.length) this.fail(parts[supportIndex - 1], "complete Kotlin support required")
    this.runtime = supportIndex == support.length
    const semanticParts = parts.slice(supportIndex)
    const mainIndex = semanticParts.findIndex((node) => node.type == "function_declaration" && this.parts(node)[1]?.text == "main")

    if (mainIndex < 0) this.fail(root, "source file without main")
    if (mainIndex == 0) this.fail(semanticParts[0], "top-level semantic function required")
    if (mainIndex != semanticParts.length - 1) this.fail(semanticParts[mainIndex + 1], "declaration after main")
    const declarations = semanticParts.slice(0, mainIndex)

    for (const declaration of declarations) {
      if (declaration.type != "function_declaration") this.fail(declaration)
    }
    const module = {
      entryPoint: this.main(semanticParts[mainIndex]), functions: declarations.map((declaration) => this.function(declaration)),
      kind: /** @type {const} */ ("Module"), location: this.location(root)
    }

    validateParsedModule(module, "kotlin")
    return module
  }
}

/**
 * Parses the strict Task 023 Kotlin/JVM profile through the qualified grammar.
 * @param {{filename: string, source: string}} input - Exact source request.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseKotlin({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const offset = firstLoneSurrogateOffset(source)

    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR", language: "kotlin", location: locationFromOffsets(filename, source, offset, offset + 1),
      message: "Kotlin source contains an invalid lone UTF-16 surrogate."
    })
  }
  let tree

  try {
    tree = parser.parse(source)
  } catch (error) {
    throw new SemantifoldDiagnostic({
      cause: error instanceof Error ? error : undefined, code: "PARSE_ERROR", language: "kotlin",
      location: moduleLocation(filename, source), message: "The qualified Kotlin parser could not produce a complete CST."
    })
  }
  return new KotlinReader(filename, source).module(tree.rootNode)
}
