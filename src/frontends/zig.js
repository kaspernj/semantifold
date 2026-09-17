// @ts-check

import {isZigIdentifier} from "../backends/identifiers.js"
import {generateZigProject} from "../backends/zig.js"
import {zigRuntime} from "../backends/zig-runtime.js"
import {maximumZigSourceLength} from "../backends/zig-validation.js"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {createCoordinateIndex, indexedPointAt} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"
import {parseZigCst} from "./zig-parser.js"
import {collectZigBindingUsage} from "../zig-bindings.js"

/** @typedef {import("./zig-parser.js").CstNode} CstNode */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").Statement} Statement */
/** @typedef {import("../semantic/types.js").FunctionReturnTypeName} Scalar */

const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["and", "And"], ["or", "Or"]
])
const helperOperations = new Map([
  ["semantifold_integer_add", "Add"], ["semantifold_integer_subtract", "Subtract"],
  ["semantifold_integer_multiply", "Multiply"], ["semantifold_string_concat", "Add"],
  ["semantifold_string_equal", "Equal"], ["semantifold_string_not_equal", "NotEqual"]
])
const operationSpellings = new Map([
  ["IntegerAdd", "semantifold_integer_add"], ["IntegerSubtract", "semantifold_integer_subtract"],
  ["IntegerMultiply", "semantifold_integer_multiply"], ["IntegerNegate", "semantifold_integer_negate"],
  ["IntegerEqual", "=="], ["IntegerNotEqual", "!="], ["IntegerLessThan", "<"],
  ["IntegerLessThanOrEqual", "<="], ["IntegerGreaterThan", ">"], ["IntegerGreaterThanOrEqual", ">="],
  ["BooleanEqual", "=="], ["BooleanNotEqual", "!="], ["BooleanAnd", "and"], ["BooleanOr", "or"], ["BooleanNot", "!"],
  ["StringConcat", "semantifold_string_concat"], ["StringEqual", "semantifold_string_equal"],
  ["StringNotEqual", "semantifold_string_not_equal"]
])

/** Consumes the complete qualified Zig CST and retains exact generated-shell constraints. */
class ZigReader {
  /**
   * Creates a reader over one complete parser snapshot.
   * @param {string} filename - Logical source filename.
   * @param {string} source - Exact Zig source text.
   */
  constructor(filename, source) {
    this.filename = filename
    this.source = source
    this.coordinates = createCoordinateIndex(source)
    this.generated = false
    /** @type {Map<string, Expression> | undefined} */
    this.temporaryExpressions = undefined
    /** @type {Set<string> | undefined} */
    this.temporaryNames = undefined
    /** @type {Map<Expression, {node: CstNode, spelling: string}>} */
    this.operations = new Map()
    /** @type {Map<Statement, {node: CstNode, type: string}>} */
    this.prints = new Map()
    /** @type {Map<string, Scalar>} */
    this.functions = new Map()
    /** @type {Map<import("../semantic/types.js").Parameter | import("../semantic/types.js").LocalDeclaration, "use" | "address" | "none">} */
    this.scaffolds = new Map()
  }

  /**
   * Converts a parser node boundary to a semantic location.
   * @param {CstNode} node - Parser node.
   * @returns {import("../semantic/types.js").SourceLocation} UTF-16 location.
   */
  location(node) {
    return {filename: this.filename, start: indexedPointAt(this.coordinates, node.startIndex), end: indexedPointAt(this.coordinates, node.endIndex)}
  }

  /**
   * Reads the exact source spelling owned by a parser node.
   * @param {CstNode} node - Parser node.
   * @returns {string} Node source text.
   */
  text(node) {
    return this.source.slice(node.startIndex, node.endIndex)
  }

  /**
   * Reads one generated line-comment marker independent of the source newline convention.
   * @param {CstNode} node - Marker comment node.
   * @returns {string} Marker spelling without a parser-owned trailing carriage return.
   */
  marker(node) {
    return this.text(node).replace(/\r$/u, "")
  }

  /**
   * Raises a located unsupported-syntax diagnostic.
   * @param {CstNode} node - Rejected parser node.
   * @param {string} [detail] - Diagnostic detail.
   * @returns {never} This function always throws.
   */
  fail(node, detail = node.type) {
    unsupportedSyntax("zig", detail, this.location(node))
  }

  /**
   * Exhaustively rejects recovery, unexpected extras, directives, and excessive nesting.
   * @param {CstNode} node - Current CST node.
   * @param {number} [depth] - Current nesting depth.
   */
  validateTree(node, depth = 0) {
    if (depth > 512) this.fail(node, "Zig CST exceeds the 512-level traversal limit")
    for (const {node: child} of node.children) this.validateTree(child, depth + 1)
    if (node.error || node.missing || node.hasError) {
      throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "zig", location: this.location(node), message: `Zig parser recovery at '${node.type}'.`})
    }
    if (node.extra && node.type != "comment") this.fail(node, "unexpected extra parser child")
    if (node.type == "comment" && (/^\s*\/\/[/!]/u.test(this.text(node)) || /^\s*\/\/\s*zig fmt:/u.test(this.text(node)))) {
      this.fail(node, "doc or formatter-directive comment")
    }
  }

  /**
   * Returns every non-comment child without hiding syntax edges.
   * @param {CstNode} node - Parent parser node.
   * @returns {CstNode[]} Ordered non-comment children.
   */
  parts(node) {
    return node.children.map(({node: child}) => child).filter(child => child.type != "comment")
  }

  /**
   * Retains compiler-owned scaffold markers while ignoring ordinary inert comments.
   * @param {CstNode} node - Parent parser node.
   * @returns {CstNode[]} Complete significant child list.
   */
  significant(node) {
    return node.children.map(({node: child}) => child).filter(child =>
      child.type != "comment" || /semantifold:/u.test(this.text(child)))
  }

  /**
   * Requires exactly one parser field edge.
   * @param {CstNode} node - Parent parser node.
   * @param {string} name - Required field name.
   * @returns {CstNode} Field child.
   */
  field(node, name) {
    const edges = node.children.filter(({field}) => field == name)

    if (edges.length != 1) this.fail(node, `expected one '${name}' field`)
    return edges[0].node
  }

  /**
   * Requires an exact ordered child/token shape.
   * @param {CstNode} node - Parser node to check.
   * @param {(CstNode | string)[]} expected - Expected node identities or token types.
   */
  shape(node, expected) {
    const parts = this.parts(node)

    if (parts.length != expected.length || parts.some((child, index) =>
      typeof expected[index] == "string" ? child.type != expected[index] || !child.named && this.text(child) != expected[index] : child !== expected[index])) {
      this.fail(node, `${node.type} child shape`)
    }
  }

  /**
   * Validates and returns one ordinary Zig identifier.
   * @param {CstNode} node - Candidate identifier node.
   * @returns {string} Validated identifier.
   */
  identifier(node) {
    const name = this.text(node)

    if (node.type != "identifier" || !isZigIdentifier(name)) this.fail(node, "reserved or unsupported identifier")
    return name
  }

  /**
   * Converts an exact source scalar annotation.
   * @param {CstNode} node - Type node.
   * @param {boolean} [allowVoid] - Whether void is valid here.
   * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Semantic type.
   */
  type(node, allowVoid = false) {
    const spelling = this.text(node)

    if (allowVoid && node.type == "builtin_type" && spelling == "void") {
      this.shape(node, ["void"])
      return withParserRanges({kind: "TypeReference", name: "void"}, {type: this.location(node)})
    }
    if (node.type == "builtin_type" && ["i64", "bool"].includes(spelling)) {
      if (spelling == "bool") this.shape(node, ["bool"])
      else if (node.children.length) this.fail(node, "scalar type shape")
    } else if (node.type == "slice_type" && spelling == "[]const u8") {
      this.shape(node, ["[", "]", "const", this.parts(node)[3]])
      const child = this.parts(node)[3]

      if (child.type != "builtin_type" || this.text(child) != "u8" || child.children.length) this.fail(child, "immutable UTF-8 slice element")
    } else return missingType("zig", allowVoid ? "function return" : "scalar", this.location(node))
    const type = sourceScalarType("zig", spelling, this.location(node))

    if (!type) return missingType("zig", "scalar", this.location(node))
    return type
  }

  /**
   * Decomposes an exact direct call.
   * @param {CstNode} node - Call expression node.
   * @returns {{name: CstNode, arguments: CstNode[]}} Callee and ordered arguments.
   */
  call(node) {
    if (node.type != "call_expression") this.fail(node, "direct call required")
    const name = this.field(node, "function")
    const parts = this.parts(node)
    const argumentsAndCommas = parts.slice(2, -1)
    const args = argumentsAndCommas.filter((_part, index) => index % 2 == 0)

    this.shape(node, [name, "(", ...args.flatMap((argument, index) => index ? [",", argument] : [argument]), ")"])
    return {name, arguments: args}
  }

  /**
   * Decodes one bounded ordinary Zig string literal.
   * @param {CstNode} node - String node.
   * @returns {string} Unicode scalar value.
   */
  string(node) {
    if (node.type != "string") this.fail(node, "ordinary UTF-8 string literal required")
    const parts = this.parts(node)

    this.shape(node, ['"', ...parts.slice(1, -1), '"'])
    let value = ""

    for (const part of parts.slice(1, -1)) {
      const spelling = this.text(part)

      if (part.type == "string_content") {
        if (/[\r\n]/u.test(spelling)) this.fail(part, "raw string line terminator")
        value += spelling
      } else if (part.type == "escape_sequence") {
        const simple = new Map([["\\n", "\n"], ["\\r", "\r"], ["\\t", "\t"], ["\\\\", "\\"], ['\\"', '"']])

        if (simple.has(spelling)) value += simple.get(spelling)
        else if (/^\\x[0-9a-fA-F]{2}$/u.test(spelling)) {
          const scalar = Number.parseInt(spelling.slice(2), 16)

          if (scalar > 127) this.fail(part, "non-ASCII byte escape")
          value += String.fromCodePoint(scalar)
        } else if (/^\\u\{[0-9a-fA-F]{1,6}\}$/u.test(spelling)) {
          const scalar = Number.parseInt(spelling.slice(3, -1), 16)

          if (scalar > 0x10FFFF || scalar >= 0xD800 && scalar <= 0xDFFF) this.fail(part, "non-scalar Unicode escape")
          value += String.fromCodePoint(scalar)
        } else this.fail(part, "unsupported string escape")
      } else this.fail(part, "string child")
    }
    if (!hasOnlyUnicodeScalars(value)) this.fail(node, "non-scalar string value")
    return value
  }

  /**
   * Converts one supported scalar expression.
   * @param {CstNode} node - Expression node.
   * @returns {Expression} Semantic expression.
   */
  expression(node) {
    const location = this.location(node)

    if (node.type == "parenthesized_expression") {
      const parts = this.parts(node)

      this.shape(node, ["(", parts[1], ")"])
      return this.expression(parts[1])
    }
    if (node.type == "identifier") {
      const temporary = this.temporaryExpressions?.get(this.text(node))

      if (temporary) {
        this.temporaryExpressions?.delete(this.text(node))
        return temporary
      }
      return withParserRanges({kind: "IdentifierExpression", location, name: this.identifier(node)}, {name: location})
    }
    if (node.type == "integer") {
      const spelling = this.text(node)
      const value = Number(spelling)

      if (!/^(?:0|[1-9][0-9]*)$/u.test(spelling) || !Number.isSafeInteger(value)) this.fail(node, "non-safe or noncanonical i64 literal")
      return withParserRanges({kind: "IntegerLiteral", location, value}, {literal: location})
    }
    if (node.type == "boolean") {
      const spelling = this.text(node)

      if (spelling != "true" && spelling != "false") this.fail(node, "Boolean literal spelling")
      this.shape(node, [spelling])
      return withParserRanges({kind: "BooleanLiteral", location, value: spelling == "true"}, {literal: location})
    }
    if (node.type == "string") return withParserRanges({kind: "StringLiteral", location, value: this.string(node)}, {literal: location})
    if (node.type == "unary_expression" || node.type == "error_union_type") {
      const parts = this.parts(node)
      const operator = node.type == "unary_expression" ? this.field(node, "operator") : parts[0]
      const operand = node.type == "unary_expression" ? this.field(node, "argument") : this.field(node, "ok")

      this.shape(node, [operator, operand])
      if (operator.type != "-" && operator.type != "!") this.fail(operator, "unary operator")
      return this.unary(node, operator.type == "-" ? "Negate" : "Not", this.expression(operand), operator)
    }
    if (node.type == "binary_expression") {
      const left = this.field(node, "left")
      const right = this.field(node, "right")
      const operator = this.field(node, "operator")
      const intent = binaryOperations.get(operator.type)

      this.shape(node, [left, operator, right])
      if (!intent) this.fail(operator, "unsupported binary operator")
      return this.binary(node, intent, this.expression(left), this.expression(right), operator)
    }
    if (node.type == "call_expression") {
      const call = this.call(node)

      if (call.name.type != "identifier") this.fail(call.name, "direct function call required")
      const name = this.text(call.name)

      if (name == "semantifold_integer_negate") {
        if (call.arguments.length != 1) this.fail(node, "negation helper arity")
        return this.unary(node, "Negate", this.expression(call.arguments[0]), call.name)
      }
      const intent = helperOperations.get(name)

      if (intent) {
        if (call.arguments.length != 2) this.fail(node, "operator helper arity")
        return this.binary(node, intent, this.expression(call.arguments[0]), this.expression(call.arguments[1]), call.name)
      }
      if (name.startsWith("semantifold_")) this.fail(call.name, "support helper outside its exact semantic role")
      const callee = this.identifier(call.name)

      return withParserRanges({kind: "CallExpression", location, callee, arguments: call.arguments.map(argument => this.expression(argument))}, {callee: this.location(call.name)})
    }
    return this.fail(node)
  }

  /**
   * Adapts one typed binary operator.
   * @param {CstNode} node - Whole expression node.
   * @param {string} intent - Shared operator intent.
   * @param {Expression} left - Left operand.
   * @param {Expression} right - Right operand.
   * @param {CstNode} operator - Source operator occurrence.
   * @returns {Expression} Adapted semantic expression.
   */
  binary(node, intent, left, right, operator) {
    const expression = /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "BinaryExpression", location: this.location(node), left, right},
      {operator: this.location(operator)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (intent)))

    this.operations.set(expression, {node: operator, spelling: this.text(operator)})
    return expression
  }

  /**
   * Adapts one typed unary operator.
   * @param {CstNode} node - Whole expression node.
   * @param {"Negate" | "Not"} intent - Shared operator intent.
   * @param {Expression} operand - Converted operand.
   * @param {CstNode} operator - Source operator occurrence.
   * @returns {Expression} Adapted semantic expression.
   */
  unary(node, intent, operand, operator) {
    const expression = /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "UnaryExpression", location: this.location(node), operand},
      {operator: this.location(operator)}), intent))

    this.operations.set(expression, {node: operator, spelling: this.text(operator)})
    return expression
  }

  /**
   * Converts one supported statement.
   * @param {CstNode} node - Statement node.
   * @returns {Statement} Semantic statement.
   */
  statement(node) {
    const location = this.location(node)
    const parts = this.parts(node)

    if (node.type == "variable_declaration") {
      if (["const", "var"].includes(parts[0]?.type)) {
        const typeNode = node.children.find(({field}) => field == "type")?.node

        if (!typeNode) return missingType("zig", "local", location)
        const name = parts[1]
        const value = parts[5]

        this.shape(node, [parts[0], name, ":", typeNode, "=", value, ";"])
        return withParserRanges({kind: "LocalDeclaration", location, name: this.identifier(name), type: /** @type {import("../semantic/types.js").TypeReference} */ (this.type(typeNode)), mutable: parts[0].type == "var",
          initializer: this.expression(value)}, {name: this.location(name), operator: this.location(parts[4])})
      }
      const targetNode = parts[0]
      const value = parts[2]

      this.shape(node, [targetNode, "=", value, ";"])
      const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: this.location(targetNode), name: this.identifier(targetNode)}, {name: this.location(targetNode)})

      return withParserRanges({kind: "AssignmentStatement", location, target, expression: this.expression(value)}, {operator: this.location(parts[1])})
    }
    if (node.type == "if_statement") return this.conditional(node)
    if (node.type != "expression_statement") this.fail(node, "explicit statement required")
    const expression = parts[0]

    this.shape(node, [expression, ";"])
    if (expression.type == "return_expression") {
      const returned = this.parts(expression)

      if (returned.length == 1) {
        this.shape(expression, ["return"])
        return {kind: "ReturnStatement", location}
      }
      this.shape(expression, ["return", returned[1]])
      return {kind: "ReturnStatement", location, expression: this.expression(returned[1])}
    }
    if (expression.type != "call_expression") this.fail(expression, "direct void call statement required")
    const call = this.call(expression)
    const name = this.text(call.name)

    if (/^semantifold_print_(?:integer|boolean|string)$/u.test(name)) {
      if (call.name.type != "identifier" || call.arguments.length != 1) this.fail(expression, "exact print helper call required")
      const statement = {kind: /** @type {const} */ ("PrintStatement"), location, expression: this.expression(call.arguments[0])}

      this.prints.set(statement, {node: call.name, type: name.slice("semantifold_print_".length)})
      return statement
    }
    const value = this.expression(expression)

    if (value.kind != "CallExpression") this.fail(expression, "direct void call statement required")
    return {kind: "ExpressionStatement", location, expression: value}
  }

  /**
   * Converts one strict Boolean conditional.
   * @param {CstNode} node - If-statement node.
   * @returns {import("../semantic/types.js").IfStatement} Semantic conditional.
   */
  conditional(node) {
    const condition = this.field(node, "condition")
    const body = this.field(node, "body")
    const alternative = this.parts(node).find(child => child.type == "else_clause")

    this.shape(node, ["if", "(", condition, ")", body, ...(alternative ? [alternative] : [])])
    const statement = {kind: /** @type {const} */ ("IfStatement"), location: this.location(node), condition: this.expression(condition), consequent: this.blockExpression(body)}

    if (!alternative) return statement
    const branch = this.field(alternative, "alternative")

    this.shape(alternative, ["else", branch])
    if (branch.type != "labeled_statement") this.fail(branch, "braced else block required")
    const block = this.parts(branch)[0]

    this.shape(branch, [block])
    return {...statement, alternate: this.block(block)}
  }

  /**
   * Unwraps one braced conditional block expression.
   * @param {CstNode} node - Block-expression node.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  blockExpression(node) {
    if (node.type != "block_expression") this.fail(node, "braced conditional block required")
    const block = this.parts(node)[0]

    this.shape(node, [block])
    return this.block(block)
  }

  /**
   * Converts one lexical block while consuming exact compiler scaffolds.
   * @param {CstNode} node - Block node.
   * @param {number} [skip] - Fixed leading generated statements to omit.
   * @param {import("../semantic/types.js").Parameter[]} [parameters] - Parameters requiring scaffold checks.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  block(node, skip = 0, parameters = []) {
    if (node.type != "block") this.fail(node, "braced block required")
    const parts = this.parts(node)

    this.shape(node, ["{", ...parts.slice(1, -1), "}"])
    const sourceStatements = this.significant(node).slice(1 + skip, -1)
    return {kind: "Block", location: this.location(node), statements: this.generated
      ? this.generatedStatements(sourceStatements, parameters)
      : this.directStatements(sourceStatements, parameters)}
  }

  /**
   * Converts the legacy direct statement shape when diagnosing a missing generated marker.
   * @param {CstNode[]} sourceStatements - Ordered direct children.
   * @param {import("../semantic/types.js").Parameter[]} parameters - Function parameters.
   * @returns {Statement[]} Semantic statements.
   */
  directStatements(sourceStatements, parameters) {
    let cursor = 0

    for (const parameter of parameters) {
      const kind = sourceStatements[cursor] ? this.useScaffold(sourceStatements[cursor], parameter.name) : undefined

      this.scaffolds.set(parameter, kind ?? "none")
      if (kind) cursor += 1
    }
    /** @type {Statement[]} */
    const statements = []

    while (cursor < sourceStatements.length) {
      const statement = this.statement(sourceStatements[cursor])

      statements.push(statement)
      cursor += 1
      if (statement.kind == "LocalDeclaration") {
        const kind = sourceStatements[cursor] ? this.useScaffold(sourceStatements[cursor], statement.name) : undefined

        this.scaffolds.set(statement, kind ?? "none")
        if (kind) cursor += 1
      }
    }
    return statements
  }

  /**
   * Reconstructs complete generated statement regions before canonical whole-CST verification.
   * @param {CstNode[]} sourceStatements - Significant direct block children.
   * @param {import("../semantic/types.js").Parameter[]} parameters - Function parameters.
   * @returns {Statement[]} Reconstructed semantic statements.
   */
  generatedStatements(sourceStatements, parameters) {
    /** @type {Statement[]} */
    const statements = []
    let cursor = 0

    for (const parameter of parameters) {
      const kind = sourceStatements[cursor] ? this.useScaffold(sourceStatements[cursor], parameter.name) : undefined

      this.scaffolds.set(parameter, kind ?? "none")
      if (kind) cursor += 1
    }
    while (cursor < sourceStatements.length) {
      const begin = sourceStatements[cursor++]
      const match = begin.type == "comment" &&
        /^\/\/ semantifold:ordered-expression:zig:v1 begin ([0-9]{6}) ([0-9a-f]{64})$/u.exec(this.marker(begin))

      if (!match) this.fail(begin, "complete generated ordered statement region required")
      const outerExpressions = this.temporaryExpressions
      const outerNames = this.temporaryNames

      this.temporaryExpressions = new Map()
      this.temporaryNames = new Set()
      while (cursor < sourceStatements.length && this.temporaryDeclaration(sourceStatements[cursor])) {
        cursor = this.readTemporary(sourceStatements, cursor)
      }
      const consumer = sourceStatements[cursor++]

      if (!consumer) this.fail(begin, "missing generated ordered consumer")
      const statement = this.statement(consumer)

      if (this.temporaryExpressions.size != 0) this.fail(consumer, "unconsumed generated ordered temporary")
      if (statement.kind == "LocalDeclaration") {
        const kind = sourceStatements[cursor] ? this.useScaffold(sourceStatements[cursor], statement.name) : undefined

        this.scaffolds.set(statement, kind ?? "none")
        if (kind) cursor += 1
      }
      const end = sourceStatements[cursor++]

      if (!end || end.type != "comment" || this.marker(end) !=
        `// semantifold:ordered-expression:zig:v1 end ${match[1]} ${match[2]}`) this.fail(end ?? begin, "generated ordered marker pair")
      this.temporaryExpressions = outerExpressions
      this.temporaryNames = outerNames
      statements.push(statement)
    }
    return statements
  }

  /**
   * Identifies a reserved ordered temporary declaration at the current region level.
   * @param {CstNode} node - Candidate direct child.
   * @returns {boolean} Whether it declares a reserved ordered temporary.
   */
  temporaryDeclaration(node) {
    const parts = this.parts(node)

    return node.type == "variable_declaration" && ["const", "var"].includes(parts[0]?.type) &&
      parts[1]?.type == "identifier" && this.text(parts[1]).startsWith("semantifold_ordered_")
  }

  /**
   * Expands one typed ordered temporary and an optional conditional Boolean RHS.
   * @param {CstNode[]} nodes - Current region children.
   * @param {number} cursor - Temporary declaration position.
   * @returns {number} Next unconsumed position.
   */
  readTemporary(nodes, cursor) {
    const node = nodes[cursor++]
    const parts = this.parts(node)
    const nameNode = parts[1]
    const name = this.text(nameNode)
    const typeNode = this.field(node, "type")
    const value = parts[5]

    this.shape(node, [parts[0], nameNode, ":", typeNode, "=", value, ";"])
    this.type(typeNode)
    if (!/^semantifold_ordered_[0-9]{6}$/u.test(name) || this.temporaryNames?.has(name)) {
      this.fail(nameNode, "generated ordered temporary declaration")
    }
    this.temporaryNames?.add(name)
    let expression = this.expression(value)
    const branch = nodes[cursor]

    if (branch && this.shortCircuitBranch(branch, name)) {
      const condition = this.field(branch, "condition")
      const body = this.field(branch, "body")
      const conditionParts = this.parts(condition)
      const isOr = conditionParts[0]?.type == "!"
      const target = isOr ? this.field(condition, condition.type == "unary_expression" ? "argument" : "ok") : condition

      this.shape(branch, ["if", "(", condition, ")", body])
      if (target.type != "identifier" || this.text(target) != name) this.fail(target, "generated short-circuit temporary test")
      if (isOr) this.shape(condition, [conditionParts[0], target])
      if (isOr && conditionParts[0]?.type != "!") this.fail(conditionParts[0] ?? condition, "generated short-circuit negation")
      if (body.type != "block_expression") this.fail(body, "generated short-circuit block")
      const block = this.parts(body)[0]

      this.shape(body, [block])
      if (block.type != "block") this.fail(block, "generated short-circuit block")
      const inside = this.significant(block).slice(1, -1)
      let offset = 0

      while (offset < inside.length && this.temporaryDeclaration(inside[offset])) offset = this.readTemporary(inside, offset)
      if (offset != inside.length - 1) this.fail(block, "generated short-circuit final assignment")
      const assignment = inside[offset]
      const assignmentParts = this.parts(assignment)
      const left = assignmentParts[0]
      const right = assignmentParts[2]

      this.shape(assignment, [left, "=", right, ";"])
      if (left.type != "identifier" || this.text(left) != name) this.fail(left, "generated short-circuit result write")
      if (right.type != "binary_expression") this.fail(right, "generated short-circuit result expression")
      const repeated = this.field(right, "left")
      const operand = this.field(right, "right")
      const operator = this.field(right, "operator")
      const spelling = isOr ? "or" : "and"

      this.shape(right, [repeated, spelling, operand])
      if (repeated.type != "identifier" || this.text(repeated) != name) this.fail(repeated, "generated short-circuit consumed value")
      expression = this.binary(right, isOr ? "Or" : "And", expression, this.expression(operand), operator)
      cursor += 1
    }
    this.temporaryExpressions?.set(name, expression)
    return cursor
  }

  /**
   * Distinguishes an internal conditional RHS from the following semantic `if` consumer using only direct CST structure.
   * @param {CstNode} node - Candidate conditional.
   * @param {string} name - Ordered Boolean result name.
   * @returns {boolean} Whether the node has the complete outer shape of a short-circuit update.
   */
  shortCircuitBranch(node, name) {
    if (node.type != "if_statement" || this.parts(node).some(child => child.type == "else_clause")) return false
    const body = node.children.find(({field}) => field == "body")?.node

    if (body?.type != "block_expression") return false
    const block = this.parts(body)[0]

    if (block?.type != "block") return false
    const inside = this.significant(block).slice(1, -1)
    const final = inside.at(-1)
    const finalParts = final ? this.parts(final) : []

    return inside.length > 0 && !inside.some(child => child.type == "comment") && final?.type == "variable_declaration" &&
      finalParts[0]?.type == "identifier" && this.text(finalParts[0]) == name && finalParts[1]?.type == "="
  }

  /**
   * Recognizes one exact generated unused or unmutated binding scaffold.
   * @param {CstNode} node - Candidate statement node.
   * @param {string} name - Binding name.
   * @returns {"use" | "address" | undefined} Scaffold form when matched.
   */
  useScaffold(node, name) {
    const parts = this.parts(node)

    if (node.type != "variable_declaration" || parts.length != 4 || parts[0].type != "identifier" || this.text(parts[0]) != "_" || parts[1].type != "=" || parts[3].type != ";") return undefined
    if (parts[2].type == "identifier" && this.text(parts[2]) == name) return "use"
    if (parts[2].type == "reference_expression") {
      const reference = this.parts(parts[2])

      if (reference.length == 2 && reference[0].type == "&" && reference[1].type == "identifier" && this.text(reference[1]) == name) return "address"
    }
    return undefined
  }

  /**
   * Converts one canonical top-level semantic function.
   * @param {CstNode} node - Function declaration node.
   * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
   */
  function(node) {
    const name = this.field(node, "name")
    const parameters = this.parts(node).find(child => child.type == "parameters")
    const returnType = this.field(node, "type")
    const body = this.field(node, "body")

    if (!parameters) this.fail(node, "parameter list required")
    this.shape(node, ["fn", name, parameters, returnType, body])
    const parameterParts = this.parts(parameters)
    const declarations = parameterParts.slice(1, -1).filter((_part, index) => index % 2 == 0)

    this.shape(parameters, ["(", ...declarations.flatMap((parameter, index) => index ? [",", parameter] : [parameter]), ")"])
    const converted = declarations.map(parameter => {
      if (parameter.type != "parameter") this.fail(parameter, "required typed parameter")
      const parameterName = this.field(parameter, "name")
      const type = this.field(parameter, "type")

      this.shape(parameter, [parameterName, ":", type])
      return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: this.location(parameter), name: this.identifier(parameterName), type: /** @type {import("../semantic/types.js").TypeReference} */ (this.type(type))}, {name: this.location(parameterName)})
    })

    return withParserRanges({kind: "FunctionDeclaration", location: this.location(node), name: this.identifier(name), parameters: converted,
      returnType: this.type(returnType, true), body: this.block(body, 0, converted)}, {name: this.location(name)})
  }

  /**
   * Compares every node, token, and field against canonical generated support.
   * @param {CstNode} actual - Source subtree.
   * @param {CstNode} expected - Canonical subtree.
   * @param {ZigReader} canonical - Reader owning the canonical source.
   */
  compareTree(actual, expected, canonical) {
    if (actual.type != expected.type || actual.named != expected.named || actual.extra != expected.extra) this.fail(actual, "modified Zig support node")
    const left = this.significant(actual)
    const right = canonical.significant(expected)

    if (left.length != right.length) this.fail(actual, "modified Zig support children")
    if (!left.length) {
      const actualText = actual.type == "comment" && /semantifold:/u.test(this.text(actual)) ? this.marker(actual) : this.text(actual)
      const expectedText = expected.type == "comment" && /semantifold:/u.test(canonical.text(expected)) ? canonical.marker(expected) : canonical.text(expected)

      if (actualText != expectedText) this.fail(actual, "modified Zig support token")
    }
    left.forEach((child, index) => {
      const expectedChild = right[index]

      if (!expectedChild || actual.children.find(edge => edge.node === child)?.field != expected.children.find(edge => edge.node === expectedChild)?.field) {
        this.fail(child, "modified Zig support field")
      }
      this.compareTree(child, expectedChild, canonical)
    })
  }

  /**
   * Resolves a validated expression's scalar result.
   * @param {Expression} expression - Semantic expression.
   * @param {Map<string, Scalar>} bindings - Visible binding types.
   * @returns {Scalar} Scalar result name.
   */
  expressionType(expression, bindings) {
    if (expression.kind == "StringLiteral") return "string"
    if (expression.kind == "IntegerLiteral") return "integer"
    if (expression.kind == "BooleanLiteral") return "boolean"
    if (expression.kind == "BinaryExpression" || expression.kind == "UnaryExpression") return expression.type
    if (expression.kind != "CallExpression" && expression.kind != "IdentifierExpression") throw new Error("Validated Zig source exposed a collection expression.")
    const type = expression.kind == "CallExpression" ? this.functions.get(expression.callee) : bindings.get(expression.name)

    if (!type) throw new Error("Validated Zig expression lost its scalar binding.")
    return type
  }

  /**
   * Requires each typed operation to retain the one exact Zig operator/helper spelling that implements it.
   * @param {Expression} expression - Resolved scalar expression.
   */
  validateOperationExpression(expression) {
    if (expression.kind == "CallExpression") {
      expression.arguments.forEach(argument => this.validateOperationExpression(argument))
      return
    }
    if (expression.kind == "UnaryExpression") {
      const identity = this.operations.get(expression)
      const expected = operationSpellings.get(expression.operation)

      if (!identity) throw new Error("Resolved Zig unary operation lost its parser identity.")
      if (identity.spelling != expected) this.fail(identity.node, `exact ${expression.operation} Zig operator/helper required`)
      this.validateOperationExpression(expression.operand)
      return
    }
    if (expression.kind == "BinaryExpression") {
      const identity = this.operations.get(expression)
      const expected = operationSpellings.get(expression.operation)

      if (!identity) throw new Error("Resolved Zig binary operation lost its parser identity.")
      if (identity.spelling != expected) this.fail(identity.node, `exact ${expression.operation} Zig operator/helper required`)
      this.validateOperationExpression(expression.left)
      this.validateOperationExpression(expression.right)
    }
  }

  /**
   * Validates operation identity throughout one lexical block.
   * @param {import("../semantic/types.js").Block} block - Block whose expressions must retain exact Zig identity.
   */
  validateOperations(block) {
    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration") this.validateOperationExpression(statement.initializer)
      else if (statement.kind == "AssignmentStatement" || statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") {
        this.validateOperationExpression(statement.expression)
      } else if (statement.kind == "ReturnStatement") {
        if (statement.expression) this.validateOperationExpression(statement.expression)
      } else if (statement.kind == "IfStatement") {
        this.validateOperationExpression(statement.condition)
        this.validateOperations(statement.consequent)
        if (statement.alternate) this.validateOperations(statement.alternate)
      }
    }
  }

  /**
   * Confirms each generated output helper matches its semantic operand.
   * @param {import("../semantic/types.js").Block} block - Block to inspect.
   * @param {Map<string, Scalar>} inherited - Visible binding types.
   */
  validatePrints(block, inherited) {
    const bindings = new Map(inherited)

    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration") {
        bindings.set(statement.name, /** @type {import("../semantic/types.js").TypeReference} */ (statement.type).name)
      } else if (statement.kind == "PrintStatement") {
        const print = this.prints.get(statement)

        if (!print || this.expressionType(statement.expression, bindings) != print.type) this.fail(print?.node ?? /** @type {CstNode} */ ({}), "print helper scalar mismatch")
      } else if (statement.kind == "IfStatement") {
        this.validatePrints(statement.consequent, bindings)
        if (statement.alternate) this.validatePrints(statement.alternate, bindings)
      }
    }
  }

  /**
   * Confirms all and only compiler-required binding scaffolds are present.
   * @param {import("../semantic/types.js").FunctionDeclaration | import("../semantic/types.js").EntryPoint} owner - Function or entry owner.
   */
  validateScaffolds(owner) {
    const usage = collectZigBindingUsage(owner.body)
    const parameters = owner.kind == "FunctionDeclaration" ? owner.parameters : []

    for (const parameter of parameters) {
      const expected = usage.reads.has(parameter.name) ? "none" : "use"

      if (this.scaffolds.get(parameter) != expected) unsupportedSyntax("zig", `incorrect unused-parameter scaffold for '${parameter.name}'`, parameter.location)
    }
    /**
     * Checks local scaffolds recursively.
     * @param {import("../semantic/types.js").Block} block - Block to inspect.
     */
    const visit = (block) => {
      for (const statement of block.statements) {
        if (statement.kind == "LocalDeclaration") {
          const expected = statement.mutable && !usage.writes.has(statement.name) ? "address" :
            !statement.mutable && !usage.reads.has(statement.name) ? "use" : "none"

          if (this.scaffolds.get(statement) != expected) unsupportedSyntax("zig", `incorrect local binding scaffold for '${statement.name}'`, statement.location)
        } else if (statement.kind == "IfStatement") {
          visit(statement.consequent)
          if (statement.alternate) visit(statement.alternate)
        }
      }
    }

    visit(owner.body)
  }

  /**
   * Converts a complete canonical Zig project entry.
   * @param {CstNode} root - Source-file root.
   * @returns {import("../semantic/types.js").SemanticModule} Validated semantic module.
   */
  module(root) {
    this.validateTree(root)
    if (root.type != "source_file") this.fail(root, "Zig source root required")
    const canonical = new ZigReader(this.filename, zigRuntime)
    const support = canonical.significant(parseZigCst(zigRuntime).root)
    const nodes = this.significant(root)

    if (nodes.length < support.length + 2) this.fail(root, "complete Zig runtime, ordered marker, and main shell required")
    support.forEach((expected, index) => this.compareTree(nodes[index], expected, canonical))
    const programMarker = nodes[support.length]

    if (programMarker.type != "comment" || this.marker(programMarker) != "// semantifold:program:zig:v1") {
      this.fail(programMarker, "exact generated Zig ordered-expression marker required")
    }
    this.generated = true
    const definitions = nodes.slice(support.length + 1)
    /** @type {CstNode | undefined} */
    let main
    /** @type {CstNode[]} */
    const functions = []

    for (const node of definitions) {
      if (node.type != "function_declaration") this.fail(node, "top-level free functions only")
      const name = this.text(this.field(node, "name"))

      if (name == "main") {
        if (main) this.fail(node, "duplicate main")
        main = node
      } else {
        if (main) this.fail(node, "semantic function after main")
        functions.push(node)
      }
    }
    if (!main) this.fail(root, "canonical pub fn main() void required")
    const mainParts = this.parts(main)
    const mainName = this.field(main, "name")
    const parameters = mainParts.find(child => child.type == "parameters")
    const returnType = this.field(main, "type")
    const body = this.field(main, "body")

    if (!parameters) this.fail(main, "main parameters")
    this.shape(main, ["pub", "fn", mainName, parameters, returnType, body])
    if (this.text(mainName) != "main") this.fail(mainName, "main name")
    this.shape(parameters, ["(", ")"])
    this.type(returnType, true)
    if (this.text(returnType) != "void") this.fail(returnType, "main return type")
    const bodyParts = this.parts(body)
    const deferNode = bodyParts[1]
    const shellSource = "pub fn main() void {\n    defer semantifold_arena.deinit();\n}\n"
    const shellReader = new ZigReader(this.filename, shellSource)
    const shellMain = shellReader.parts(parseZigCst(shellSource).root)[0]
    const expectedDefer = shellReader.parts(shellReader.field(shellMain, "body"))[1]

    if (!deferNode) this.fail(body, "arena lifetime defer required")
    this.compareTree(deferNode, expectedDefer, shellReader)
    const module = validateParsedModule({kind: "Module", location: this.location(root), functions: functions.map(node => this.function(node)),
      entryPoint: {kind: "EntryPoint", location: this.location(main), body: this.block(body, 1)}}, "zig")

    this.functions = new Map(module.functions.map(declaration => [declaration.name,
      /** @type {import("../semantic/types.js").TypeReference} */ (declaration.returnType).name]))
    for (const declaration of module.functions) this.validateOperations(declaration.body)
    this.validateOperations(module.entryPoint.body)
    for (const declaration of module.functions) this.validatePrints(declaration.body, new Map(declaration.parameters.map(parameter => [parameter.name,
      /** @type {import("../semantic/types.js").TypeReference} */ (parameter.type).name])))
    this.validatePrints(module.entryPoint.body, new Map())
    for (const declaration of module.functions) this.validateScaffolds(declaration)
    this.validateScaffolds(module.entryPoint)
    const canonicalSource = generateZigProject({module}).artifacts[1]?.content

    if (typeof canonicalSource != "string") throw new Error("Zig backend returned a nontext entry artifact.")
    this.compareTree(root, parseZigCst(canonicalSource).root, new ZigReader(this.filename, canonicalSource))
    return module
  }
}

/**
 * Parses only the qualified frozen Zig CST and rejects unsupported input before adaptation.
 * @param {{filename: string, source: string}} input - Exact source request.
 * @returns {import("../semantic/types.js").SemanticModule} Zig semantic module.
 */
export function parseZig({filename, source}) {
  const coordinates = createCoordinateIndex(source)
  const location = {filename, start: indexedPointAt(coordinates, 0), end: indexedPointAt(coordinates, source.length)}

  if (!hasOnlyUnicodeScalars(source)) {
    const offset = source.search(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "zig", message: "Zig source contains a lone UTF-16 surrogate.",
      location: {filename, start: indexedPointAt(coordinates, offset), end: indexedPointAt(coordinates, offset + 1)}})
  }
  if (source.length > maximumZigSourceLength) return unsupportedSyntax("zig", "source exceeds the 1000000 UTF-16 input limit", location)
  let snapshot

  try {
    snapshot = parseZigCst(source)
  } catch (error) {
    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "zig", location,
      cause: error instanceof Error ? error : undefined, message: "The qualified Zig parser could not produce a complete CST."})
  }
  const reader = new ZigReader(filename, source)

  try {
    return reader.module(snapshot.root)
  } catch (error) {
    if (reader.generated && error instanceof SemantifoldDiagnostic && error.language == "zig" &&
      error.code != "PARSE_ERROR" && error.code != "UNSUPPORTED_SYNTAX") {
      return unsupportedSyntax("zig", `invalid generated ordered scaffold: ${error.code}`, error.location ?? location)
    }
    throw error
  }
}
