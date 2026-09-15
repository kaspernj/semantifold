// @ts-check

import Parser from "tree-sitter"
import DartLanguage from "tree-sitter-dart-orchard/bindings/node/index.js"
import {isDartIdentifier} from "../backends/identifiers.js"
import {dartRuntime} from "../backends/dart-runtime.js"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation, utf8ByteOffsetToUtf16Offset} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"

const parser = new Parser()

parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (DartLanguage)))

const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])
/** @type {Map<string, readonly [string, Set<string>]>} */
const binaryNodeOperators = new Map([
  ["additive_expression", ["additive_operator", new Set(["+", "-"])]],
  ["multiplicative_expression", ["multiplicative_operator", new Set(["*"])]],
  ["equality_expression", ["equality_operator", new Set(["==", "!="])]],
  ["relational_expression", ["relational_operator", new Set(["<", "<=", ">", ">="])]],
  ["logical_and_expression", ["logical_and_operator", new Set(["&&"])]],
  ["logical_or_expression", ["logical_or_operator", new Set(["||"])]]
])
const commentTypes = new Set(["comment", "documentation_comment"])
/** @type {Map<string, import("../semantic/operators.js").AdaptedOperation>} */
const helperOperations = new Map([
  ["_semantifoldIntegerAdd", "Add"], ["_semantifoldIntegerSubtract", "Subtract"],
  ["_semantifoldIntegerMultiply", "Multiply"], ["_semantifoldIntegerNegate", "Negate"]
])

/**
 * Verifies a binding-reported UTF-16 index through the shared UTF-8 converter.
 * @param {string} source Complete source.
 * @param {number} index Binding index.
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
 * Finds the first unpaired UTF-16 surrogate.
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

/** Consumes exact qualified Dart CST shapes without retaining parser values. */
class DartReader {
  /**
   * Creates a reader bound to one exact Dart source unit.
   * @param {string} filename Original filename.
   * @param {string} source Complete source.
   */
  constructor(filename, source) {
    this.filename = filename
    this.source = source
    /** @type {Set<string>} */
    this.functionNames = new Set()
    this.runtime = false
  }

  /**
   * Builds a semantic source location from one parser node.
   * @param {import("tree-sitter").SyntaxNode} node Parser node.
   * @returns {import("../semantic/types.js").SourceLocation} Exact location.
   */
  location(node) {
    return locationFromOffsets(this.filename, this.source, bindingIndexToUtf16Offset(this.source, node.startIndex),
      bindingIndexToUtf16Offset(this.source, node.endIndex))
  }

  /**
   * Rejects one parser node with a located unsupported-syntax diagnostic.
   * @param {import("tree-sitter").SyntaxNode} node Violating node.
   * @param {string} [detail] Profile detail.
   * @returns {never} Always throws.
   */
  fail(node, detail = node.type) {
    unsupportedSyntax("dart", detail, this.location(node))
  }

  /**
   * Traverses every named, anonymous, extra, field, and recovery edge.
   * @param {import("tree-sitter").SyntaxNode} root Complete parser root.
   * @returns {void}
   */
  validateTree(root) {
    const pending = [{depth: 0, node: root, visited: false}]

    while (pending.length > 0) {
      const current = pending.pop()

      if (!current) throw new Error("Dart traversal lost a pending parser node.")
      const {depth, node, visited} = current

      if (depth > 512) this.fail(node, "CST exceeds the 512-level traversal limit")
      if (!visited) {
        pending.push({depth, node, visited: true})
        for (let index = node.childCount - 1; index >= 0; index -= 1) {
          const child = node.child(index)

          if (!child) throw new Error(`Tree-sitter omitted child ${index} of ${node.type}.`)
          node.fieldNameForChild(index)
          pending.push({depth: depth + 1, node: child, visited: false})
        }
        continue
      }
      if (node.hasError || node.isError || node.isMissing) {
        throw new SemantifoldDiagnostic({
          code: "PARSE_ERROR",
          language: "dart",
          location: this.location(node),
          message: `Tree-sitter exposed recovery at '${node.type}'.`
        })
      }
      if (["annotation", "import_or_export", "library_name", "part_header", "part_of_header"].includes(node.type)) {
        this.fail(node, node.type)
      }
      if (commentTypes.has(node.type) && /(?:@dart\s*=|dartfmt|ignore(?:_for_file)?\s*:|language[-_ ]version)/iu.test(node.text)) {
        this.fail(node, "directive-bearing comment")
      }
    }
  }

  /**
   * Omits only ordinary comments already covered by exhaustive traversal.
   * @param {import("tree-sitter").SyntaxNode} node Parent node.
   * @returns {import("tree-sitter").SyntaxNode[]} Structural children.
   */
  parts(node) {
    return node.children.filter((child) => !commentTypes.has(child.type))
  }

  /**
   * Verifies an exact structural child sequence.
   * @param {import("tree-sitter").SyntaxNode} node Shape owner.
   * @param {(import("tree-sitter").SyntaxNode | string)[]} expected Exact child sequence.
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
   * Consumes an Orchard operator wrapper whether its token is aliased into the wrapper or exposed anonymously.
   * @param {import("tree-sitter").SyntaxNode} node Operator node.
   * @returns {void}
   */
  operatorShape(node) {
    const parts = this.parts(node)

    if (parts.length > 1 || parts.length == 1 && (parts[0].isNamed || parts[0].text != node.text)) {
      this.fail(node, `${node.type} child shape`)
    }
    this.shape(node, parts.length == 0 ? [] : [node.text])
  }

  /**
   * Returns exactly one parser child carrying a requested field name.
   * @param {import("tree-sitter").SyntaxNode} node Field owner.
   * @param {string} name Field name.
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
   * Validates and returns a source identifier.
   * @param {import("tree-sitter").SyntaxNode} node Identifier token.
   * @param {boolean} [allowMain] Whether fixed main is expected.
   * @param {boolean} [allowPrint] Whether fixed print is expected.
   * @returns {string} Accepted name.
   */
  identifier(node, allowMain = false, allowPrint = false) {
    const name = node.text

    if (node.type != "identifier" || !(allowMain && name == "main") && !(allowPrint && name == "print") &&
      !isDartIdentifier(name)) this.fail(node, "reserved or unsupported identifier")
    return name
  }

  /**
   * Converts one explicitly named scalar type.
   * @param {import("tree-sitter").SyntaxNode} node Type node.
   * @returns {import("../semantic/types.js").TypeReference} Scalar type.
   */
  scalarType(node) {
    if (node.type != "type_identifier" || this.parts(node).length != 0) this.fail(node, "scalar type shape")
    const type = sourceScalarType("dart", node.text, this.location(node))

    if (!type) this.fail(node, `unsupported scalar type '${node.text}'`)
    return type
  }

  /**
   * Converts one explicit scalar or void result type.
   * @param {import("tree-sitter").SyntaxNode} node Return type node.
   * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Function return type.
   */
  returnType(node) {
    if (node.type == "void_type") {
      const parts = this.parts(node)

      if (node.text != "void" || parts.length > 1 || parts.length == 1 && parts[0].text != "void") {
        this.fail(node, "void type shape")
      }
      this.shape(node, parts)
      const type = {kind: /** @type {const} */ ("TypeReference"), name: /** @type {const} */ ("void")}

      return withParserRanges(type, {type: this.location(node)})
    }
    return this.scalarType(node)
  }

  /**
   * Decodes one ordinary noninterpolated, non-raw, single-line Dart string.
   * @param {import("tree-sitter").SyntaxNode} node String node.
   * @returns {string} Decoded Unicode scalar value.
   */
  string(node) {
    const parts = this.parts(node)
    const delimiter = node.text[0]

    if (node.type != "string_literal" || !["\"", "'"].includes(delimiter) || node.text.startsWith(delimiter.repeat(3)) ||
      node.text.at(-1) != delimiter || parts.length < 2 || parts[0].text != delimiter || parts.at(-1)?.text != delimiter ||
      parts.slice(1, -1).some(({type}) => type != "escape_sequence")) {
      this.fail(node, "ordinary noninterpolated string literal required")
    }
    this.shape(node, parts)
    const source = node.text.slice(1, -1)
    const simpleEscapes = new Map([
      ["b", "\b"], ["f", "\f"], ["n", "\n"], ["r", "\r"], ["t", "\t"], ["v", "\v"],
      ["$", "$"], ["'", "'"], ['"', '"'], ["\\", "\\"]
    ])
    let value = ""

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index]

      if (character != "\\") {
        if (character == "\n" || character == "\r" || character == delimiter || character == "$") {
          this.fail(node, "invalid or interpolated string content")
        }
        value += character
        continue
      }
      const escaped = source[++index]

      if (simpleEscapes.has(escaped)) value += simpleEscapes.get(escaped)
      else if (escaped == "x") {
        const hexadecimal = source.slice(index + 1, index + 3)

        if (!/^[0-9A-Fa-f]{2}$/u.test(hexadecimal)) this.fail(node, "unsupported string escape")
        value += String.fromCodePoint(Number.parseInt(hexadecimal, 16))
        index += 2
      } else if (escaped == "u") {
        if (source[index + 1] == "{") {
          const closing = source.indexOf("}", index + 2)
          const hexadecimal = closing < 0 ? "" : source.slice(index + 2, closing)
          const codePoint = /^[0-9A-Fa-f]{1,6}$/u.test(hexadecimal) ? Number.parseInt(hexadecimal, 16) : -1

          if (codePoint < 0 || codePoint > 0x10FFFF) this.fail(node, "unsupported string escape")
          value += String.fromCodePoint(codePoint)
          index = closing
        } else {
          const hexadecimal = source.slice(index + 1, index + 5)

          if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) this.fail(node, "unsupported string escape")
          value += String.fromCharCode(Number.parseInt(hexadecimal, 16))
          index += 4
        }
      } else this.fail(node, "unsupported string escape")
    }
    if (!hasOnlyUnicodeScalars(value)) this.fail(node, "invalid Unicode string literal")
    return value
  }

  /**
   * Extracts exact required positional arguments.
   * @param {import("tree-sitter").SyntaxNode} part Call argument part.
   * @returns {import("tree-sitter").SyntaxNode[][]} Argument expression edges.
   */
  arguments(part) {
    const partChildren = this.parts(part)

    if (part.type != "argument_part" || partChildren.length != 1 || partChildren[0].type != "arguments") {
      this.fail(part, "call argument part shape")
    }
    this.shape(part, [partChildren[0]])
    const list = partChildren[0]
    const listParts = this.parts(list)

    if (listParts.length < 2 || listParts[0].text != "(" || listParts.at(-1)?.text != ")") {
      this.fail(list, "call argument list shape")
    }
    const arguments_ = listParts.slice(1, -1).filter((_child, index) => index % 2 == 0)

    this.shape(list, ["(", ...arguments_.flatMap((argument, index) => index ? [",", argument] : [argument]), ")"])
    return arguments_.map((argument) => {
      if (argument.type != "argument") this.fail(argument, "required positional argument")
      const expressionParts = this.parts(argument)

      if (expressionParts.length == 0) this.fail(argument, "empty argument")
      return expressionParts
    })
  }

  /**
   * Converts one direct method-invocation node whose function is a plain identifier.
   * @param {import("tree-sitter").SyntaxNode[]} nodes Exact one-node call.
   * @param {import("tree-sitter").SyntaxNode} owner Expression owner.
   * @param {boolean} [allowPrint] Whether this is the print scaffold.
   * @returns {import("../semantic/types.js").Expression} Semantic call or private generated operation.
   */
  call(nodes, owner, allowPrint = false) {
    if (nodes.length != 1 || nodes[0].type != "method_invocation") {
      this.fail(nodes[0] ?? owner, "direct call shape")
    }
    const invocation = nodes[0]
    const parts = this.parts(invocation)
    const functionNode = this.field(invocation, "function")
    const argumentPart = this.field(invocation, "arguments")

    if (parts.length != 2 || parts[0].id != functionNode.id || functionNode.type != "identifier" ||
      parts[1].id != argumentPart.id || argumentPart.type != "argument_part") this.fail(invocation, "direct call shape")
    this.shape(invocation, [functionNode, argumentPart])
    const name = functionNode.text
    const helper = this.runtime ? helperOperations.get(name) : undefined
    const location = this.location(invocation)
    const argumentNodes = this.arguments(argumentPart)

    if (helper) {
      const count = helper == "Negate" ? 1 : 2

      if (argumentNodes.length != count) this.fail(argumentPart, "Dart checked-integer helper shape")
      if (helper == "Negate") {
        return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (
          withAdaptedOperation(withParserRanges({
            kind: /** @type {const} */ ("UnaryExpression"), location,
            operand: this.expression(argumentNodes[0], owner)
          }, {operator: this.location(functionNode)}), helper)))
      }
      return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (
        withAdaptedOperation(withParserRanges({
          kind: /** @type {const} */ ("BinaryExpression"), left: this.expression(argumentNodes[0], owner), location,
          right: this.expression(argumentNodes[1], owner)
        }, {operator: this.location(functionNode)}), helper)))
    }
    this.identifier(functionNode, false, allowPrint)

    return withParserRanges({
      arguments: argumentNodes.map((argument) => this.expression(argument, owner)),
      callee: name,
      kind: /** @type {const} */ ("CallExpression"),
      location
    }, {callee: this.location(functionNode)})
  }

  /**
   * Recursively compares one source support subtree with the canonical runtime CST.
   * @param {import("tree-sitter").SyntaxNode} actual Source node.
   * @param {import("tree-sitter").SyntaxNode} expected Canonical node.
   * @returns {void}
   */
  compareTree(actual, expected) {
    if (actual.type != expected.type || actual.isNamed != expected.isNamed || actual.isExtra != expected.isExtra ||
      actual.childCount != expected.childCount) this.fail(actual, "modified Dart support node")
    if (actual.childCount == 0 && actual.text != expected.text) this.fail(actual, "modified Dart support token")
    for (let index = 0; index < actual.childCount; index += 1) {
      const left = actual.child(index)
      const right = expected.child(index)

      if (!left || !right || actual.fieldNameForChild(index) != expected.fieldNameForChild(index)) {
        this.fail(left ?? actual, "modified Dart support field")
      }
      this.compareTree(left, right)
    }
  }

  /**
   * Converts an expression represented by one or more adjacent Dart CST nodes.
   * @param {import("tree-sitter").SyntaxNode[]} nodes Expression nodes.
   * @param {import("tree-sitter").SyntaxNode} owner Owning node.
   * @returns {import("../semantic/types.js").Expression} Semantic expression.
   */
  expression(nodes, owner) {
    if (nodes.length == 1 && nodes[0].type == "method_invocation") return this.call(nodes, owner)
    if (nodes.length != 1) return this.fail(nodes[0] ?? owner, "scalar expression shape")
    const node = nodes[0]
    const location = this.location(node)

    if (node.type == "identifier") {
      const name = this.identifier(node)

      if (this.functionNames.has(name)) this.fail(node, "function tear-off")
      return withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location, name}, {name: location})
    }
    if (node.type == "decimal_integer_literal") {
      if (this.parts(node).length != 0 || !/^(?:0|[1-9][0-9]*)$/u.test(node.text)) this.fail(node, "noncanonical integer literal")
      const value = Number(BigInt(node.text))

      if (!Number.isSafeInteger(value)) this.fail(node, "non-safe integer literal")
      return withParserRanges({kind: /** @type {const} */ ("IntegerLiteral"), location, value}, {literal: location})
    }
    if (node.type == "true" || node.type == "false") {
      this.shape(node, [node.type])
      return withParserRanges({kind: /** @type {const} */ ("BooleanLiteral"), location, value: node.type == "true"}, {literal: location})
    }
    if (node.type == "string_literal") {
      return withParserRanges({kind: /** @type {const} */ ("StringLiteral"), location, value: this.string(node)}, {literal: location})
    }
    if (node.type == "parenthesized_expression") {
      const parts = this.parts(node)

      if (parts.length < 3 || parts[0].text != "(" || parts.at(-1)?.text != ")") this.fail(node, "parenthesized expression shape")
      this.shape(node, ["(", ...parts.slice(1, -1), ")"])
      return this.expression(parts.slice(1, -1), node)
    }
    if (node.type == "unary_expression") {
      const parts = this.parts(node)
      const operator = parts[0]

      if (parts.length < 2 || operator.type != "prefix_operator" || !["-", "!"].includes(operator.text)) {
        this.fail(node, "unary operator")
      }
      const operatorParts = this.parts(operator)

      if (operatorParts.length != 1 || operatorParts[0].text != operator.text ||
        !["minus_operator", "negation_operator"].includes(operatorParts[0].type)) this.fail(operator, "unary operator shape")
      this.operatorShape(operatorParts[0])
      this.shape(node, [operator, ...parts.slice(1)])
      return /** @type {import("../semantic/types.js").Expression} */ (/** @type {unknown} */ (withAdaptedOperation(withParserRanges({
        kind: /** @type {const} */ ("UnaryExpression"),
        location,
        operand: this.expression(parts.slice(1), node)
      }, {operator: this.location(operator)}), operator.text == "-" ? "Negate" : "Not")))
    }
    if (binaryNodeOperators.has(node.type)) return this.binary(node)
    return this.fail(node)
  }

  /**
   * Converts a bounded binary expression tree.
   * @param {import("tree-sitter").SyntaxNode} node Binary expression node.
   * @returns {import("../semantic/types.js").Expression} Semantic binary expression.
   */
  binary(node) {
    /** @type {import("tree-sitter").SyntaxNode[][]} */
    const operands = []
    /** @type {import("tree-sitter").SyntaxNode[]} */
    const operators = []
    let current = node

    while (true) {
      const parts = this.parts(current)
      const declaration = binaryNodeOperators.get(current.type)
      const operatorType = declaration?.[0]
      const accepted = declaration?.[1]
      const operatorIndexes = parts.flatMap((part, index) => part.type == operatorType ? [index] : [])

      if (operatorIndexes.length != 1) this.fail(current, `${current.type} child shape`)
      const operatorIndex = operatorIndexes[0]
      const operator = parts[operatorIndex]

      if (operatorIndex == 0 || operatorIndex == parts.length - 1 || !accepted?.has(operator.text) ||
        !binaryOperations.has(operator.text)) this.fail(operator, "unsupported binary operator")
      this.operatorShape(operator)
      this.shape(current, parts)
      operands.push(parts.slice(0, operatorIndex))
      operators.push(operator)
      const right = parts.slice(operatorIndex + 1)

      if (right.length == 1 && right[0].type == node.type) current = right[0]
      else {
        operands.push(right)
        break
      }
    }
    let expression = this.expression(operands[0], node)

    for (let index = 0; index < operators.length; index += 1) {
      const operator = operators[index]
      const operation = binaryOperations.get(operator.text)
      const right = this.expression(operands[index + 1], node)
      const first = operands[0][0]
      const last = operands[index + 1].at(-1)
      const location = first && last
        ? locationFromOffsets(this.filename, this.source, bindingIndexToUtf16Offset(this.source, first.startIndex),
          bindingIndexToUtf16Offset(this.source, last.endIndex))
        : this.location(node)

      expression = /** @type {import("../semantic/types.js").Expression} */ (withAdaptedOperation(withParserRanges({
        kind: /** @type {const} */ ("BinaryExpression"), left: expression, location, right
      }, {operator: this.location(operator)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (operation)))
    }
    return expression
  }

  /**
   * Converts one explicitly typed initialized local declaration.
   * @param {import("tree-sitter").SyntaxNode} node Local declaration.
   * @returns {import("../semantic/types.js").LocalDeclaration} Semantic local.
   */
  local(node) {
    const declarationParts = this.parts(node)

    if (node.type != "local_variable_declaration" || declarationParts.length != 2 ||
      declarationParts[0].type != "initialized_variable_definition" || declarationParts[1].text != ";") {
      this.fail(node, "local declaration shape")
    }
    this.shape(node, [declarationParts[0], ";"])
    const definition = declarationParts[0]
    const parts = this.parts(definition)

    if (parts[0]?.type == "inferred_type" || parts[0]?.type == "final_builtin" && parts[1]?.type == "identifier") {
      return missingType("dart", "Local", this.location(definition))
    }
    const immutable = parts[0]?.type == "final_builtin"
    const typeIndex = immutable ? 1 : 0
    const typeNode = parts[typeIndex]
    const nameNode = parts[typeIndex + 1]
    const equals = parts[typeIndex + 2]
    const expressionParts = parts.slice(typeIndex + 3)

    if (parts.length < typeIndex + 4 || typeNode?.type != "type_identifier" || nameNode?.type != "identifier" ||
      equals?.text != "=" || expressionParts.length == 0 || immutable && parts[0].text != "final") {
      this.fail(parts[0] ?? definition, "explicitly typed initialized local required")
    }
    this.shape(definition, [...(immutable ? [parts[0]] : []), typeNode, nameNode, "=", ...expressionParts])
    if (this.field(definition, "name").id != nameNode.id) this.fail(nameNode, "local name field")
    const name = this.identifier(nameNode)

    return withParserRanges({
      initializer: this.expression(expressionParts, definition),
      kind: /** @type {const} */ ("LocalDeclaration"),
      location: this.location(node),
      mutable: !immutable,
      name,
      type: this.scalarType(typeNode)
    }, {name: this.location(nameNode), operator: this.location(equals)})
  }

  /**
   * Converts one simple identifier assignment.
   * @param {import("tree-sitter").SyntaxNode} node Assignment expression.
   * @returns {import("../semantic/types.js").AssignmentStatement} Semantic assignment.
   */
  assignment(node) {
    const parts = this.parts(node)
    const target = parts[0]
    const operator = parts[1]

    if (node.type != "assignment_expression" || parts.length < 3 || target?.type != "assignable_expression" ||
      operator?.type != "assignment_operator" || operator.text != "=") this.fail(node, "simple assignment shape")
    const targetParts = this.parts(target)

    if (targetParts.length != 1 || targetParts[0].type != "identifier") this.fail(target, "simple assignment target")
    this.shape(target, [targetParts[0]])
    this.operatorShape(operator)
    this.shape(node, [target, "=", ...parts.slice(2)])
    const name = this.identifier(targetParts[0])
    const targetLocation = this.location(targetParts[0])

    return withParserRanges({
      expression: this.expression(parts.slice(2), node),
      kind: /** @type {const} */ ("AssignmentStatement"),
      location: this.location(node),
      target: withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: targetLocation, name}, {name: targetLocation})
    }, {operator: this.location(operator)})
  }

  /**
   * Converts one supported Dart statement.
   * @param {import("tree-sitter").SyntaxNode} node Source statement.
   * @returns {import("../semantic/types.js").Statement} Semantic statement.
   */
  statement(node) {
    if (node.type == "local_variable_declaration") return this.local(node)
    if (node.type == "if_statement") return this.conditional(node)
    if (node.type == "return_statement") {
      const parts = this.parts(node)

      if (parts.length < 2 || parts[0].text != "return" || parts.at(-1)?.text != ";") this.fail(node, "return statement shape")
      this.shape(node, ["return", ...parts.slice(1, -1), ";"])
      const expressionParts = parts.slice(1, -1)

      return {
        ...(expressionParts.length > 0 ? {expression: this.expression(expressionParts, node)} : {}),
        kind: /** @type {const} */ ("ReturnStatement"),
        location: this.location(node)
      }
    }
    if (node.type == "expression_statement") {
      const parts = this.parts(node)

      if (parts.length < 2 || parts.at(-1)?.text != ";") this.fail(node, "expression statement shape")
      this.shape(node, [...parts.slice(0, -1), ";"])
      if (parts.length == 2 && parts[0].type == "assignment_expression") return this.assignment(parts[0])
      const callParts = parts.slice(0, -1)
      const callChildren = callParts.length == 1 && callParts[0].type == "method_invocation"
        ? this.parts(callParts[0]) : []
      const print = callChildren[0]?.type == "identifier" && callChildren[0].text == "print"
      const expression = this.call(callParts, node, print)

      if (print) {
        if (expression.kind != "CallExpression" || expression.arguments.length != 1) {
          this.fail(callParts[0], "print argument count")
        }
        return {expression: expression.arguments[0], kind: /** @type {const} */ ("PrintStatement"), location: this.location(node)}
      }
      if (expression.kind != "CallExpression") this.fail(callParts[0], "generated helper expression statement")
      return {expression, kind: /** @type {const} */ ("ExpressionStatement"), location: this.location(node)}
    }
    return this.fail(node)
  }

  /**
   * Converts a braced Dart block.
   * @param {import("tree-sitter").SyntaxNode} node Braced block.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  block(node) {
    const parts = this.parts(node)

    if (node.type != "block" || parts.length < 2 || parts[0].text != "{" || parts.at(-1)?.text != "}") {
      this.fail(node, "braced block shape")
    }
    this.shape(node, ["{", ...parts.slice(1, -1), "}"])
    return {
      kind: /** @type {const} */ ("Block"),
      location: this.location(node),
      statements: parts.slice(1, -1).map((statement) => this.statement(statement))
    }
  }

  /**
   * Unwraps a synchronous braced function body.
   * @param {import("tree-sitter").SyntaxNode} body Function body wrapper.
   * @returns {import("../semantic/types.js").Block} Semantic body.
   */
  functionBody(body) {
    const parts = this.parts(body)

    if (body.type != "function_body" || parts.length != 1 || parts[0].type != "block") {
      this.fail(body, "synchronous braced function body required")
    }
    this.shape(body, [parts[0]])
    return this.block(parts[0])
  }

  /**
   * Converts one strict-Boolean conditional.
   * @param {import("tree-sitter").SyntaxNode} node Strict Boolean conditional.
   * @returns {import("../semantic/types.js").IfStatement} Semantic conditional.
   */
  conditional(node) {
    const parts = this.parts(node)
    const consequence = this.field(node, "consequence")
    const consequenceIndex = parts.findIndex(({id}) => id == consequence.id)

    if (node.type != "if_statement" || parts[0]?.text != "if" || parts[1]?.text != "(" || consequence.type != "block" ||
      consequenceIndex < 4 || parts[consequenceIndex - 1]?.text != ")") this.fail(node, "if statement shape")
    const conditionParts = parts.slice(2, consequenceIndex - 1)

    if (conditionParts.length == 0) this.fail(node, "empty if condition")
    const statement = /** @type {import("../semantic/types.js").IfStatement} */ ({
      condition: this.expression(conditionParts, node),
      consequent: this.block(consequence),
      kind: /** @type {const} */ ("IfStatement"),
      location: this.location(node)
    })
    if (parts.length == consequenceIndex + 1) {
      this.shape(node, ["if", "(", ...conditionParts, ")", consequence])
      return statement
    }
    const alternative = this.field(node, "alternative")

    if (parts.length != consequenceIndex + 3 || parts[consequenceIndex + 1]?.text != "else" ||
      parts[consequenceIndex + 2]?.id != alternative.id) this.fail(alternative, "if alternate shape")
    this.shape(node, ["if", "(", ...conditionParts, ")", consequence, "else", alternative])
    if (alternative.type == "block") return {...statement, alternate: this.block(alternative)}
    if (alternative.type == "if_statement") {
      return {...statement, alternate: {
        kind: /** @type {const} */ ("Block"), location: this.location(alternative), statements: [this.conditional(alternative)]
      }}
    }
    return this.fail(alternative, "braced block or else-if required")
  }

  /**
   * Converts one required explicitly typed positional parameter.
   * @param {import("tree-sitter").SyntaxNode} node Required positional parameter.
   * @returns {import("../semantic/types.js").Parameter} Semantic parameter.
   */
  parameter(node) {
    const parts = this.parts(node)

    if (parts.length == 1 && parts[0].type == "identifier") return missingType("dart", "Parameter", this.location(node))
    if (node.type != "formal_parameter" || parts.length != 2 || parts[0].type != "type_identifier" ||
      parts[1].type != "identifier") this.fail(node, "required explicitly typed positional parameter")
    this.shape(node, [parts[0], parts[1]])
    if (this.field(node, "name").id != parts[1].id) this.fail(parts[1], "parameter name field")
    const name = this.identifier(parts[1])

    return withParserRanges({
      kind: /** @type {const} */ ("Parameter"), location: this.location(node), name, type: this.scalarType(parts[0])
    }, {name: this.location(parts[1])})
  }

  /**
   * Converts a required positional parameter list.
   * @param {import("tree-sitter").SyntaxNode} node Parameter list.
   * @returns {import("../semantic/types.js").Parameter[]} Semantic parameters.
   */
  parameters(node) {
    const parts = this.parts(node)

    if (node.type != "formal_parameter_list" || parts.length < 2 || parts[0].text != "(" || parts.at(-1)?.text != ")") {
      this.fail(node, "formal parameter list shape")
    }
    const parameters = parts.slice(1, -1).filter((_child, index) => index % 2 == 0)

    this.shape(node, ["(", ...parameters.flatMap((parameter, index) => index ? [",", parameter] : [parameter]), ")"])
    return parameters.map((parameter) => this.parameter(parameter))
  }

  /**
   * Converts one ordinary top-level function declaration.
   * @param {import("tree-sitter").SyntaxNode} signature Function signature.
   * @param {import("tree-sitter").SyntaxNode} body Function body.
   * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
   */
  function(signature, body) {
    const parts = this.parts(signature)

    if (signature.type != "function_signature") this.fail(signature, "function signature")
    if (parts.length == 2 && parts[0].type == "identifier") return missingType("dart", "Function return", this.location(signature))
    if (parts.length != 3 || !["type_identifier", "void_type"].includes(parts[0].type) || parts[1].type != "identifier" ||
      parts[2].type != "formal_parameter_list") this.fail(signature, "explicit top-level function signature")
    this.shape(signature, [parts[0], parts[1], parts[2]])
    if (this.field(signature, "name").id != parts[1].id) this.fail(parts[1], "function name field")
    const name = this.identifier(parts[1])
    const location = locationFromOffsets(this.filename, this.source, bindingIndexToUtf16Offset(this.source, signature.startIndex),
      bindingIndexToUtf16Offset(this.source, body.endIndex))

    return withParserRanges({
      body: this.functionBody(body),
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location,
      name,
      parameters: this.parameters(parts[2]),
      returnType: this.returnType(parts[0])
    }, {name: this.location(parts[1])})
  }

  /**
   * Converts the exact void main entry shell.
   * @param {import("tree-sitter").SyntaxNode} signature Main signature.
   * @param {import("tree-sitter").SyntaxNode} body Main body.
   * @returns {import("../semantic/types.js").EntryPoint} Semantic entry point.
   */
  main(signature, body) {
    const parts = this.parts(signature)

    if (signature.type != "function_signature" || parts.length != 3 || parts[0].type != "void_type" ||
      this.identifier(parts[1], true) != "main" || parts[2].type != "formal_parameter_list") {
      this.fail(signature, "exact void main() signature required")
    }
    this.shape(signature, [parts[0], parts[1], parts[2]])
    this.shape(parts[2], ["(", ")"])
    const location = locationFromOffsets(this.filename, this.source, bindingIndexToUtf16Offset(this.source, signature.startIndex),
      bindingIndexToUtf16Offset(this.source, body.endIndex))

    return {body: this.functionBody(body), kind: /** @type {const} */ ("EntryPoint"), location}
  }

  /**
   * Converts one complete Dart compilation unit.
   * @param {import("tree-sitter").SyntaxNode} root Complete Dart program.
   * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
   */
  module(root) {
    this.validateTree(root)
    if (root.type != "program") this.fail(root, "program root")
    const parts = this.parts(root)
    const supportTree = parser.parse(dartRuntime)
    const support = this.parts(supportTree.rootNode)
    let supportIndex = 0

    while (supportIndex < parts.length && supportIndex < support.length &&
      parts[supportIndex].type == support[supportIndex].type) {
      this.compareTree(parts[supportIndex], support[supportIndex])
      supportIndex += 1
    }
    if (supportIndex > 0 && supportIndex != support.length) {
      this.fail(parts[supportIndex - 1], "complete Dart support required")
    }
    this.runtime = supportIndex == support.length
    const semanticParts = parts.slice(supportIndex)

    if (semanticParts.length == 0) this.fail(root, "program without main")
    /** @type {{body: import("tree-sitter").SyntaxNode, signature: import("tree-sitter").SyntaxNode}[]} */
    const declarations = []

    for (const declaration of semanticParts) {
      if (declaration.type != "function_declaration") this.fail(declaration, "top-level function declaration required")
      const signature = this.field(declaration, "signature")
      const body = this.field(declaration, "body")
      const declarationParts = this.parts(declaration)

      if (declarationParts.length != 2 || declarationParts[0].id != signature.id || signature.type != "function_signature" ||
        declarationParts[1].id != body.id || body.type != "function_body") {
        this.fail(declaration, "paired top-level function signature and body required")
      }
      this.shape(declaration, [signature, body])
      declarations.push({body, signature})
    }
    const mainIndexes = declarations.flatMap(({signature}, index) => this.parts(signature)[1]?.text == "main" ? [index] : [])

    if (mainIndexes.length != 1) this.fail(root, "exactly one main declaration required")
    const mainIndex = mainIndexes[0]

    this.functionNames = new Set(declarations.map(({signature}) => this.parts(signature)[1]?.text).filter(Boolean))

    if (mainIndex != declarations.length - 1) this.fail(declarations[mainIndex + 1].signature, "declaration after main")
    const main = declarations[mainIndex]
    const module = {
      entryPoint: this.main(main.signature, main.body),
      functions: declarations.slice(0, mainIndex).map(({body, signature}) => this.function(signature, body)),
      kind: /** @type {const} */ ("Module"),
      location: this.location(root)
    }

    validateParsedModule(module, "dart")
    return module
  }
}

/**
 * Parses the strict Task 029 Dart VM/native profile through the qualified grammar.
 * @param {{filename: string, source: string}} input Exact source request.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseDart({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const offset = firstLoneSurrogateOffset(source)

    throw new SemantifoldDiagnostic({
      code: "PARSE_ERROR", language: "dart", location: locationFromOffsets(filename, source, offset, offset + 1),
      message: "Dart source contains an invalid lone UTF-16 surrogate."
    })
  }
  let tree

  try {
    tree = parser.parse(source)
  } catch (error) {
    throw new SemantifoldDiagnostic({
      cause: error instanceof Error ? error : undefined,
      code: "PARSE_ERROR",
      language: "dart",
      location: moduleLocation(filename, source),
      message: "The qualified Dart parser could not produce a complete CST."
    })
  }
  return new DartReader(filename, source).module(tree.rootNode)
}
