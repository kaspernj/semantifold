// @ts-check

import Parser from "tree-sitter"
import SwiftLanguage from "tree-sitter-swift/bindings/node/index.js"
import {isSwiftIdentifier} from "../backends/identifiers.js"
import {swiftRuntime} from "../backends/swift-runtime.js"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"

const parser = new Parser()

parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (SwiftLanguage)))

const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])
const binaryNodeOperators = new Map([
  ["additive_expression", new Set(["+", "-"])],
  ["multiplicative_expression", new Set(["*"])],
  ["equality_expression", new Set(["=="])],
  ["comparison_expression", new Set(["<", ">"])],
  ["conjunction_expression", new Set(["&&"])],
  ["disjunction_expression", new Set(["||"])],
  ["infix_expression", new Set(["!=", "<=", ">="])]
])
/** @type {Map<string, import("../semantic/operators.js").AdaptedOperation>} */
const helperOperations = new Map([
  ["semantifold_string_equal", "StringEqual"], ["semantifold_string_not_equal", "StringNotEqual"]
])
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

/** Consumes exact qualified Swift CST shapes without retaining parser handles. */
class SwiftReader {
  /**
   * Creates a reader over one parser-owned Swift source.
   * @param {string} filename - Original filename.
   * @param {string} source - Complete source.
   */
  constructor(filename, source) {
    this.filename = filename
    this.source = source
    /** @type {Set<string>} */
    this.helpers = new Set()
    this.mutableMarker = false
    /** @type {WeakMap<object, import("tree-sitter").SyntaxNode>} */
    this.nativeEqualityOperators = new WeakMap()
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
    unsupportedSyntax("swift", detail, this.location(node))
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

      if (!current) throw new Error("Swift traversal lost a pending parser node.")
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
          language: "swift",
          location: this.location(node),
          message: `Tree-sitter exposed recovery at '${node.type}'.`
        })
      }
      if (["attribute", "directive", "shebang_line"].includes(node.type)) this.fail(node, node.type)
      if (node.type == "comment" && /swift-tools-version/u.test(node.text)) {
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
    return node.children.filter((child) => child.type != "comment")
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
   * Validates one Swift identifier in the portable source profile.
   * @param {import("tree-sitter").SyntaxNode} node - Identifier token.
   * @param {boolean} [allowPrint] - Whether the fixed print scaffold is expected.
   * @returns {string} Accepted spelling.
   */
  identifier(node, allowPrint = false) {
    const name = node.text

    if (node.type != "simple_identifier" || !(allowPrint && name == "print") &&
      (!isSwiftIdentifier(name) || name.normalize("NFC") != name)) this.fail(node, "reserved or unsupported identifier")
    return name
  }

  /**
   * Converts exactly Int64, Bool, or String.
   * @param {import("tree-sitter").SyntaxNode} node - Type node.
   * @returns {import("../semantic/types.js").TypeReference} Semantic scalar.
   */
  type(node) {
    const parts = this.parts(node)

    if (node.type != "user_type" || parts.length != 1 || parts[0].type != "type_identifier") this.fail(node, "scalar type shape")
    this.shape(node, [parts[0]])
    const type = sourceScalarType("swift", parts[0].text, this.location(parts[0]))

    if (!type) this.fail(parts[0], `unsupported scalar type '${parts[0].text}'`)
    return type
  }

  /**
   * Converts one exact ordinary Swift string literal.
   * @param {import("tree-sitter").SyntaxNode} node - String node.
   * @returns {string} Unicode scalar value.
   */
  string(node) {
    const parts = this.parts(node)

    if (node.type != "line_string_literal" || parts.length < 2 || parts[0].text != '"' || parts.at(-1)?.text != '"') {
      return this.fail(node, "ordinary noninterpolated string literal required")
    }
    this.shape(node, ['"', ...parts.slice(1, -1), '"'])
    let value = ""
    const simpleEscapes = new Map([
      ["\\0", "\0"], ["\\n", "\n"], ["\\r", "\r"], ["\\t", "\t"], ["\\\\", "\\"], ['\\"', '"'], ["\\'", "'"]
    ])

    for (const part of parts.slice(1, -1)) {
      if (part.type == "line_str_text") {
        if (/[\r\n]/u.test(part.text)) this.fail(part, "string line terminator")
        value += part.text
      } else if (part.type == "str_escaped_char") {
        const escape = part.text

        if (simpleEscapes.has(escape)) value += simpleEscapes.get(escape)
        else {
          const match = /^\\u\{([0-9A-Fa-f]{1,8})\}$/u.exec(escape)

          if (!match) this.fail(part, "unsupported string escape")
          const scalar = Number.parseInt(match[1], 16)

          if (scalar > 0x10FFFF || scalar >= 0xD800 && scalar <= 0xDFFF) this.fail(part, "non-scalar Unicode escape")
          value += String.fromCodePoint(scalar)
        }
      } else this.fail(part, part.type == "interpolated_expression" ? "interpolated string" : "string child")
    }
    if (!hasOnlyUnicodeScalars(value)) this.fail(node, "invalid Unicode string literal")
    return value
  }

  /**
   * Reads exact unlabeled call arguments.
   * @param {import("tree-sitter").SyntaxNode} suffix - Call suffix.
   * @returns {import("tree-sitter").SyntaxNode[]} Argument value nodes.
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
    const expected = ["(", ...arguments_.flatMap((argument, index) => index == 0 ? [argument] : [",", argument]), ")"]

    this.shape(list, expected)
    return arguments_.map((argument) => {
      const value = this.field(argument, "value")

      if (argument.type != "value_argument") this.fail(argument, "unlabeled argument required")
      this.shape(argument, [value])
      return value
    })
  }

  /**
   * Converts a direct semantic call, including qualified negated-call and trailing-call binary shapes.
   * @param {import("tree-sitter").SyntaxNode} node - Call node.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  call(node) {
    const location = this.location(node)
    const parts = this.parts(node)

    if (node.type != "call_expression" || parts.length != 2) this.fail(node, "direct call shape")
    const target = parts[0]
    const suffix = parts[1]

    if (binaryNodeOperators.has(target.type)) {
      const right = this.field(target, "rhs")
      const callLocation = locationFromOffsets(this.filename, this.source,
        bindingIndexToUtf16Offset(this.source, right.startIndex), bindingIndexToUtf16Offset(this.source, suffix.endIndex))

      if (right.type != "simple_identifier") this.fail(node, "trailing direct call shape")
      this.shape(node, [target, suffix])

      return this.binary(target, undefined, location, this.callParts(right, suffix, callLocation))
    }

    return this.callParts(target, suffix, location)
  }

  /**
   * Converts one direct call from its parser target and suffix.
   * @param {import("tree-sitter").SyntaxNode} target - Direct call target.
   * @param {import("tree-sitter").SyntaxNode} suffix - Argument suffix.
   * @param {import("../semantic/types.js").SourceLocation} location - Complete call location.
   * @returns {import("../semantic/types.js").Expression} Semantic call or prefixed call.
   */
  callParts(target, suffix, location) {
    const argumentNodes = this.arguments(suffix)
    let nameNode = target
    /** @type {import("tree-sitter").SyntaxNode | undefined} */
    let unaryOperator

    if (["!", "-"].includes(nameNode.text)) {
      if (argumentNodes.length != 1) this.fail(target, "parenthesized unary expression shape")
      const expression = this.expression(argumentNodes[0])

      return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
        kind: "UnaryExpression", location, operand: expression
      }, {operator: this.location(nameNode)}), nameNode.text == "-" ? "Negate" : "Not")))
    }
    if (nameNode.type == "prefix_expression") {
      const operation = this.field(nameNode, "operation")
      const target = this.field(nameNode, "target")

      this.shape(nameNode, [operation, target])
      if (!["!", "-"].includes(operation.text) || target.type != "simple_identifier") this.fail(nameNode, "prefixed direct call shape")
      unaryOperator = operation
      nameNode = target
    }
    const name = nameNode.text

    const helperOperation = this.helpers.has(name) ? helperOperations.get(name) : undefined

    if (helperOperation) {
      if (unaryOperator || argumentNodes.length != 2) this.fail(target, "Swift scalar equality helper shape")
      return /** @type {import("../semantic/types.js").Expression} */ (withAdaptedOperation(withParserRanges({
        kind: "BinaryExpression", left: this.expression(argumentNodes[0]), location, right: this.expression(argumentNodes[1])
      }, {operator: this.location(nameNode)}), helperOperation))
    }
    const semanticName = this.identifier(nameNode)

    if (argumentNodes.length != 2) this.fail(suffix, "semantic call argument count")
    const call = withParserRanges({
      arguments: argumentNodes.map((argument) => this.expression(argument)),
      callee: semanticName,
      kind: /** @type {const} */ ("CallExpression"),
      location
    }, {callee: this.location(nameNode)})

    if (!unaryOperator) return call
    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression", location, operand: call
    }, {operator: this.location(unaryOperator)}), unaryOperator.text == "-" ? "Negate" : "Not")))
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
    if (node.type == "integer_literal") {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(node.text)) this.fail(node, "noncanonical integer literal")
      const value = Number(BigInt(node.text))

      if (!Number.isSafeInteger(value)) this.fail(node, "non-safe integer literal")
      return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
    }
    if (node.type == "boolean_literal") {
      const parts = this.parts(node)

      if (parts.length != 1 || !["true", "false"].includes(parts[0].text)) this.fail(node, "Boolean literal shape")
      this.shape(node, [parts[0].text])
      return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: parts[0].text == "true"}, {literal: location})
    }
    if (node.type == "line_string_literal") {
      return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: this.string(node)}, {literal: location})
    }
    if (node.type == "tuple_expression") {
      const value = this.field(node, "value")

      this.shape(node, ["(", value, ")"])
      return this.expression(value)
    }
    if (node.type == "prefix_expression") {
      const operation = this.field(node, "operation")
      const target = this.field(node, "target")

      this.shape(node, [operation, target])
      if (!["-", "!"].includes(operation.text)) this.fail(operation, "unary operator")
      return this.prefixed(operation, target)
    }
    const acceptedOperators = binaryNodeOperators.get(node.type)

    if (acceptedOperators) {
      return this.binary(node)
    }
    if (node.type == "call_expression") return this.call(node)
    return this.fail(node)
  }

  /**
   * Converts the grammar's broad prefix target with Swift's tighter prefix precedence.
   * @param {import("tree-sitter").SyntaxNode} operator - Prefix operator.
   * @param {import("tree-sitter").SyntaxNode} target - Grammar target.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  prefixed(operator, target) {
    const location = locationFromOffsets(this.filename, this.source,
      bindingIndexToUtf16Offset(this.source, operator.startIndex), bindingIndexToUtf16Offset(this.source, target.endIndex))

    if (binaryNodeOperators.has(target.type)) {
      const left = this.field(target, "lhs")

      return this.binary(target, this.prefixed(operator, left), location)
    }

    return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "UnaryExpression", location, operand: this.expression(target)
    }, {operator: this.location(operator)}), operator.text == "-" ? "Negate" : "Not")))
  }

  /**
   * Converts one qualified binary node, optionally replacing its left edge for prefix precedence.
   * @param {import("tree-sitter").SyntaxNode} node - Binary node.
   * @param {import("../semantic/types.js").Expression} [leftExpression] - Adapted left operand.
   * @param {import("../semantic/types.js").SourceLocation} [location] - Adapted expression range.
   * @param {import("../semantic/types.js").Expression} [rightExpression] - Adapted trailing-call right operand.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  binary(node, leftExpression, location = this.location(node), rightExpression) {
    const acceptedOperators = binaryNodeOperators.get(node.type)
    const left = this.field(node, "lhs")
    const operator = this.field(node, "op")
    const right = this.field(node, "rhs")
    const operation = binaryOperations.get(operator.text)

    this.shape(node, [left, operator, right])
    if (!acceptedOperators?.has(operator.text) || !operation) this.fail(operator, "unsupported binary operator")
    const expression = /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
      kind: "BinaryExpression", left: leftExpression ?? this.expression(left), location, right: rightExpression ?? this.expression(right)
    }, {operator: this.location(operator)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (operation))))

    if (["==", "!="].includes(operator.text)) this.nativeEqualityOperators.set(expression, operator)
    return expression
  }

  /**
   * Converts one explicitly typed initialized local.
   * @param {import("tree-sitter").SyntaxNode} node - Property declaration.
   * @returns {import("../semantic/types.js").LocalDeclaration} Semantic local.
   */
  local(node) {
    const location = this.location(node)
    const parts = this.parts(node)
    const binding = parts.find((child) => child.type == "value_binding_pattern")
    const pattern = node.childForFieldName("name")
    const annotation = parts.find((child) => child.type == "type_annotation")
    const value = node.childForFieldName("value")

    if (!annotation) return missingType("swift", "Local", location)
    if (!binding || !pattern || !value || pattern.type != "pattern") this.fail(node, "local declaration shape")
    const bindingParts = this.parts(binding)
    const nameNode = pattern.childForFieldName("bound_identifier")
    const annotationParts = this.parts(annotation)

    if (bindingParts.length != 1 || !["let", "var"].includes(bindingParts[0].text) || !nameNode || annotationParts.length != 2) {
      this.fail(node, "local declaration shape")
    }
    this.shape(binding, [bindingParts[0].text])
    this.shape(pattern, [nameNode])
    this.shape(annotation, [":", annotationParts[1]])
    this.shape(node, [binding, pattern, annotation, "=", value])
    const name = this.identifier(nameNode)

    return withParserRanges({
      initializer: this.expression(value),
      kind: /** @type {const} */ ("LocalDeclaration"),
      location,
      mutable: bindingParts[0].text == "var",
      name,
      type: this.type(annotationParts[1])
    }, {name: this.location(nameNode), operator: this.location(parts[3])})
  }

  /**
   * Converts one plain identifier assignment.
   * @param {import("tree-sitter").SyntaxNode} node - Assignment node.
   * @returns {import("../semantic/types.js").AssignmentStatement} Semantic assignment.
   */
  assignment(node) {
    const target = this.field(node, "target")
    const operator = this.field(node, "operator")
    const value = this.field(node, "result")
    const targetParts = this.parts(target)

    if (target.type != "directly_assignable_expression" || targetParts.length != 1 || operator.text != "=") {
      this.fail(node, "assignment shape")
    }
    this.shape(target, [targetParts[0]])
    this.shape(node, [target, operator, value])
    const name = this.identifier(targetParts[0])
    const targetLocation = this.location(targetParts[0])

    return withParserRanges({
      expression: this.expression(value),
      kind: /** @type {const} */ ("AssignmentStatement"),
      location: this.location(node),
      target: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name}, {name: targetLocation})
    }, {operator: this.location(operator)})
  }

  /**
   * Converts one exact print call.
   * @param {import("tree-sitter").SyntaxNode} node - Call statement.
   * @returns {import("../semantic/types.js").PrintStatement} Semantic print.
   */
  print(node) {
    const parts = this.parts(node)

    if (node.type != "call_expression" || parts.length != 2 || parts[0].type != "simple_identifier" ||
      this.identifier(parts[0], true) != "print") this.fail(node, "exact print call required")
    const arguments_ = this.arguments(parts[1])

    if (arguments_.length != 1) this.fail(parts[1], "print argument count")
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
    if (node.type == "if_statement") return this.conditional(node)
    if (node.type == "call_expression") return this.print(node)
    if (node.type == "control_transfer_statement") {
      const result = node.childForFieldName("result")

      if (!result) this.fail(node, "return without expression")
      this.shape(node, ["return", result])
      return {expression: this.expression(result), kind: /** @type {const} */ ("ReturnStatement"), location: this.location(node)}
    }
    return this.fail(node)
  }

  /**
   * Converts one parser statements node.
   * @param {import("tree-sitter").SyntaxNode | undefined} node - Optional statements node.
   * @returns {import("../semantic/types.js").Statement[]} Ordered statements.
   */
  statements(node) {
    if (!node) return []
    if (node.type != "statements") this.fail(node, "statement list shape")
    return this.statementList(this.parts(node))
  }

  /**
   * Converts a statement sequence while collapsing an adjacent generated marker.
   * @param {import("tree-sitter").SyntaxNode[]} nodes - Ordered statement nodes.
   * @returns {import("../semantic/types.js").Statement[]} Semantic statements.
   */
  statementList(nodes) {
    /** @type {import("../semantic/types.js").Statement[]} */
    const statements = []

    for (const statement of nodes) {
      const parts = this.parts(statement)
      const marker = statement.type == "call_expression" && parts[0]?.text == "semantifold_keep_mutable"

      if (marker) {
        const previous = statements.at(-1)

        if (!previous || previous.kind != "LocalDeclaration" || !previous.mutable) this.fail(statement, "Swift mutable-local warning marker")
        this.mutableMarkerCall(statement, previous)
      } else statements.push(this.statement(statement))
    }
    return statements
  }

  /**
   * Collapses the generated inout call only beside its declared mutable local.
   * @param {import("tree-sitter").SyntaxNode} node - Generated marker call.
   * @param {import("../semantic/types.js").LocalDeclaration} local - Preceding local.
   * @returns {void}
   */
  mutableMarkerCall(node, local) {
    const parts = this.parts(node)
    const arguments_ = parts.length == 2 ? this.arguments(parts[1]) : []
    const argument = arguments_[0]
    const target = argument?.type == "prefix_expression" ? this.field(argument, "target") : undefined

    if (!this.mutableMarker || parts[0]?.type != "simple_identifier" || parts[0].text != "semantifold_keep_mutable" ||
      arguments_.length != 1 || !target || target.type != "simple_identifier" || target.text != local.name) {
      this.fail(node, "Swift mutable-local warning marker")
    }
    this.shape(node, [parts[0], parts[1]])
    this.shape(argument, ["&", target])
  }

  /**
   * Converts one exact braced conditional, including direct else-if.
   * @param {import("tree-sitter").SyntaxNode} node - If node.
   * @returns {import("../semantic/types.js").IfStatement} Semantic conditional.
   */
  conditional(node) {
    const parts = this.parts(node)
    const condition = this.field(node, "condition")
    let index = 3
    const consequentStatements = parts[index]?.type == "statements" ? parts[index++] : undefined

    if (node.type != "if_statement" || parts[0]?.text != "if" || parts[1]?.id != condition.id || parts[2]?.text != "{" ||
      parts[index]?.text != "}") this.fail(node, "if statement shape")
    index += 1
    const statement = {
      condition: this.expression(condition),
      consequent: {kind: /** @type {const} */ ("Block"), location: this.location(consequentStatements ?? node),
        statements: this.statements(consequentStatements)},
      kind: /** @type {const} */ ("IfStatement"),
      location: this.location(node)
    }

    if (index == parts.length) {
      this.shape(node, ["if", condition, "{", ...(consequentStatements ? [consequentStatements] : []), "}"])
      return statement
    }
    if (parts[index]?.text != "else") this.fail(parts[index] ?? node, "if alternate shape")
    index += 1
    const branch = parts[index]

    if (branch?.type == "if_statement" && index + 1 == parts.length) {
      this.shape(node, ["if", condition, "{", ...(consequentStatements ? [consequentStatements] : []), "}", "else", branch])
      return {...statement, alternate: {kind: /** @type {const} */ ("Block"), location: this.location(branch), statements: [this.conditional(branch)]}}
    }
    if (branch?.text != "{") this.fail(branch ?? node, "if alternate block shape")
    index += 1
    const alternateStatements = parts[index]?.type == "statements" ? parts[index++] : undefined

    if (parts[index]?.text != "}" || index + 1 != parts.length) this.fail(parts[index] ?? node, "if alternate block shape")
    this.shape(node, ["if", condition, "{", ...(consequentStatements ? [consequentStatements] : []), "}", "else", "{",
      ...(alternateStatements ? [alternateStatements] : []), "}"])
    return {...statement, alternate: {kind: /** @type {const} */ ("Block"), location: this.location(alternateStatements ?? node),
      statements: this.statements(alternateStatements)}}
  }

  /**
   * Converts one function body.
   * @param {import("tree-sitter").SyntaxNode} node - Function body.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  block(node) {
    const parts = this.parts(node)
    const statements = parts[1]?.type == "statements" ? parts[1] : undefined

    if (node.type != "function_body") this.fail(node, "function body shape")
    this.shape(node, ["{", ...(statements ? [statements] : []), "}"])
    return {kind: /** @type {const} */ ("Block"), location: this.location(node), statements: this.statements(statements)}
  }

  /**
   * Converts one exact underscore-labeled parameter.
   * @param {import("tree-sitter").SyntaxNode} node - Parameter node.
   * @returns {import("../semantic/types.js").Parameter} Semantic parameter.
   */
  parameter(node) {
    const parts = this.parts(node)

    if (node.type != "parameter" || parts.length != 4 || parts[0].text != "_" || parts[0].type != "simple_identifier" ||
      parts[1].type != "simple_identifier" || parts[2].text != ":") this.fail(node, "parameter shape")
    this.shape(node, [parts[0], parts[1], ":", parts[3]])
    const name = this.identifier(parts[1])

    return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: this.location(node), name, type: this.type(parts[3])}, {
      name: this.location(parts[1])
    })
  }

  /**
   * Converts one synchronous top-level scalar function.
   * @param {import("tree-sitter").SyntaxNode} node - Function node.
   * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
   */
  function(node) {
    const parts = this.parts(node)
    const nameNode = node.childForFieldName("name")
    const body = node.childForFieldName("body")
    const parameters = parts.filter((part) => part.type == "parameter")

    if (!nameNode || !body || node.type != "function_declaration") this.fail(node, "function declaration shape")
    if (parameters.length != 2) this.fail(node, "function parameter count other than two")
    if (!parts.some((part) => part.text == "->")) return missingType("swift", "Function return", this.location(node))
    if (parts.length != 10) this.fail(parts.find((part) => !["func", "(", ",", ")", "->"].includes(part.text) &&
      part.id != nameNode.id && part.id != body.id && !parameters.some((parameter) => parameter.id == part.id)) ?? node, "function declaration shape")
    const returnType = parts[8]

    this.shape(node, ["func", nameNode, "(", parameters[0], ",", parameters[1], ")", "->", returnType, body])
    const name = this.identifier(nameNode)

    return withParserRanges({
      body: this.block(body),
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location: this.location(node),
      name,
      parameters: parameters.map((parameter) => this.parameter(parameter)),
      returnType: this.type(returnType)
    }, {name: this.location(nameNode)})
  }

  /**
   * Compares every child field and leaf token against target-only canonical support.
   * @param {import("tree-sitter").SyntaxNode} actual - Source support node.
   * @param {import("tree-sitter").SyntaxNode} expected - Canonical support node.
   * @param {SwiftReader} canonical - Canonical source reader.
   * @returns {void}
   */
  compareTree(actual, expected, canonical) {
    if (actual.type != expected.type || actual.isNamed != expected.isNamed || actual.isExtra != expected.isExtra ||
      actual.childCount != expected.childCount) this.fail(actual, "modified Swift support node")
    if (!actual.childCount && actual.text != expected.text) this.fail(actual, "modified Swift support token")
    for (let index = 0; index < actual.childCount; index += 1) {
      const left = actual.child(index)
      const right = expected.child(index)

      if (!left || !right || actual.fieldNameForChild(index) != expected.fieldNameForChild(index)) {
        this.fail(left ?? actual, "modified Swift support field")
      }
      this.compareTree(left, right, canonical)
    }
  }

  /**
   * Rejects ordinary Swift equality after shared type resolution identifies Strings.
   * @param {import("../semantic/types.js").SemanticModule} module - Validated semantic module.
   * @returns {void}
   */
  rejectNativeStringEquality(module) {
    const pending = [module.entryPoint.body, ...module.functions.map((declaration) => declaration.body)]

    while (pending.length) {
      const block = pending.pop()

      if (!block) throw new Error("Swift semantic traversal lost a pending block.")
      for (const statement of block.statements) {
        if (statement.kind == "IfStatement") {
          pending.push(statement.consequent)
          if (statement.alternate) pending.push(statement.alternate)
          this.rejectNativeStringEqualityExpression(statement.condition)
        } else if (statement.kind == "LocalDeclaration") this.rejectNativeStringEqualityExpression(statement.initializer)
        else if (statement.kind == "AssignmentStatement") this.rejectNativeStringEqualityExpression(statement.expression)
        else if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") {
          this.rejectNativeStringEqualityExpression(statement.expression)
        } else if (statement.kind == "ReturnStatement" && statement.expression) {
          this.rejectNativeStringEqualityExpression(statement.expression)
        }
      }
    }
  }

  /**
   * Checks one validated expression without retaining parser state in public values.
   * @param {import("../semantic/types.js").Expression} root - Validated expression.
   * @returns {void}
   */
  rejectNativeStringEqualityExpression(root) {
    const pending = [root]

    while (pending.length) {
      const expression = pending.pop()

      if (!expression) throw new Error("Swift semantic traversal lost a pending expression.")
      if (expression.kind == "BinaryExpression") {
        const operator = this.nativeEqualityOperators.get(expression)

        if (operator && ["StringEqual", "StringNotEqual"].includes(expression.operation)) {
          this.fail(operator, "ordinary Swift String equality")
        }
        pending.push(expression.left, expression.right)
      } else if (expression.kind == "UnaryExpression") pending.push(expression.operand)
      else if (expression.kind == "CallExpression") pending.push(...expression.arguments)
    }
  }

  /**
   * Converts the complete source file with declarations before top-level entry statements.
   * @param {import("tree-sitter").SyntaxNode} root - Source root.
   * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
   */
  module(root) {
    this.validateTree(root)
    if (root.type != "source_file") this.fail(root, "source file root")
    const parts = this.parts(root)
    const canonical = new SwiftReader(this.filename, swiftRuntime)
    const support = canonical.parts(parser.parse(swiftRuntime).rootNode)
    let supportIndex = 0

    while (supportIndex < parts.length && supportIndex < support.length) {
      const node = parts[supportIndex]
      const name = node.type == "function_declaration" ? node.childForFieldName("name") : undefined
      const expectedName = support[supportIndex].childForFieldName("name")

      if (!name || !expectedName || name.text != expectedName.text) break
      this.compareTree(node, support[supportIndex], canonical)
      if (helperOperations.has(name.text)) this.helpers.add(name.text)
      else if (name.text == "semantifold_keep_mutable") this.mutableMarker = true
      supportIndex += 1
    }
    if (supportIndex > 0 && supportIndex != support.length) this.fail(parts[supportIndex - 1], "complete Swift support required")
    const semanticParts = parts.slice(supportIndex)
    const firstEntry = semanticParts.findIndex((node) => node.type != "function_declaration")
    const split = firstEntry < 0 ? semanticParts.length : firstEntry
    const declarations = semanticParts.slice(0, split)
    const entries = semanticParts.slice(split)

    if (!declarations.length) this.fail(root, "top-level semantic function required")
    const laterFunction = entries.find((node) => node.type == "function_declaration")
    const unsupportedEntry = entries.find((node) => !["assignment", "call_expression", "control_transfer_statement", "if_statement",
      "property_declaration", "function_declaration"].includes(node.type))

    if (unsupportedEntry) this.fail(unsupportedEntry)
    if (laterFunction) this.fail(laterFunction, "function declaration after entry statement")
    if (!entries.length) this.fail(root, "top-level entry/print shell required")
    const module = {
      entryPoint: {body: {kind: /** @type {const} */ ("Block"), location: this.location(root),
        statements: this.statementList(entries)}, kind: /** @type {const} */ ("EntryPoint"), location: this.location(root)},
      functions: declarations.map((declaration) => this.function(declaration)),
      kind: /** @type {const} */ ("Module"),
      location: this.location(root)
    }

    validateParsedModule(module, "swift")
    this.rejectNativeStringEquality(module)
    return module
  }
}

/**
 * Parses the strict Task 022 Swift profile through the qualified grammar.
 * @param {{filename: string, source: string}} input - Exact source request.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseSwift({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const offset = firstLoneSurrogateOffset(source)

    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR",
      language: "swift",
      location: locationFromOffsets(filename, source, offset, offset + 1),
      message: "Swift source contains an invalid lone UTF-16 surrogate."
    })
  }
  let tree

  try {
    tree = parser.parse(source)
  } catch (error) {
    throw new SemantifoldDiagnostic({
      cause: error instanceof Error ? error : undefined,
      code: "PARSE_ERROR",
      language: "swift",
      location: moduleLocation(filename, source),
      message: "The qualified Swift parser could not produce a complete CST."
    })
  }
  return new SwiftReader(filename, source).module(tree.rootNode)
}
