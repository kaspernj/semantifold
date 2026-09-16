// @ts-check

import {isZigIdentifier} from "../backends/identifiers.js"
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
    if (node.type == "identifier") return withParserRanges({kind: "IdentifierExpression", location, name: this.identifier(node)}, {name: location})
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
    return /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "BinaryExpression", location: this.location(node), left, right},
      {operator: this.location(operator)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (intent)))
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
    return /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "UnaryExpression", location: this.location(node), operand},
      {operator: this.location(operator)}), intent))
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
    const sourceStatements = parts.slice(1 + skip, -1)
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
    return {kind: "Block", location: this.location(node), statements}
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
    const left = this.parts(actual)
    const right = canonical.parts(expected)

    if (left.length != right.length) this.fail(actual, "modified Zig support children")
    if (!left.length && this.text(actual) != canonical.text(expected)) this.fail(actual, "modified Zig support token")
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
    const support = canonical.parts(parseZigCst(zigRuntime).root)
    const nodes = this.parts(root)

    if (nodes.length < support.length + 1) this.fail(root, "complete Zig runtime and main shell required")
    support.forEach((expected, index) => this.compareTree(nodes[index], expected, canonical))
    const definitions = nodes.slice(support.length)
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
    for (const declaration of module.functions) this.validatePrints(declaration.body, new Map(declaration.parameters.map(parameter => [parameter.name,
      /** @type {import("../semantic/types.js").TypeReference} */ (parameter.type).name])))
    this.validatePrints(module.entryPoint.body, new Map())
    for (const declaration of module.functions) this.validateScaffolds(declaration)
    this.validateScaffolds(module.entryPoint)
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
  return new ZigReader(filename, source).module(snapshot.root)
}
