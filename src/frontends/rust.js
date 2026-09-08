// @ts-check

import {rustRuntime} from "../backends/rust-runtime.js"
import {maximumRustSourceLength} from "../backends/rust-validation.js"
import {isRustIdentifier} from "../backends/identifiers.js"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {createCoordinateIndex, indexedPointAt} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"
import {parseRustCst} from "./rust-parser.js"

/** @typedef {import("./rust-parser.js").CstNode} CstNode */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").Statement} Statement */
/** @typedef {import("../semantic/types.js").SemanticTypeName} Scalar */

const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])
const arithmeticHelpers = new Map([
  ["semantifold_integer_add", "PhpAdd"], ["semantifold_integer_subtract", "Subtract"],
  ["semantifold_integer_multiply", "Multiply"]
])

/** Consumes complete Rust CST shapes and retains source-only scaffold constraints. */
class RustReader {
  /**
   * Owns source text and parser-origin metadata, never native parser handles.
   * @param {string} filename - Original filename.
   * @param {string} source - Exact source.
   */
  constructor(filename, source) {
    this.filename = filename
    this.source = source
    this.coordinates = createCoordinateIndex(source)
    /** @type {Set<string>} */
    this.helpers = new Set()
    /** @type {Map<Expression, CstNode>} */
    this.clones = new Map()
    /** @type {Map<Expression, {borrowed: boolean, node: CstNode}>} */
    this.additions = new Map()
    /** @type {Map<Statement, {type: string, node: CstNode}>} */
    this.prints = new Map()
    /** @type {Map<string, Scalar>} */
    this.functions = new Map()
  }

  /**
   * Locates an original parser node in UTF-16 coordinates.
   * @param {CstNode} node - Original node.
   * @returns {import("../semantic/types.js").SourceLocation} Exact location.
   */
  location(node) {
    return {filename: this.filename, start: indexedPointAt(this.coordinates, node.startIndex), end: indexedPointAt(this.coordinates, node.endIndex)}
  }

  /**
   * Reads the spelling of an already recognized parser node.
   * @param {CstNode} node - Recognized node.
   * @returns {string} Original spelling.
   */
  text(node) {
    return this.source.slice(node.startIndex, node.endIndex)
  }

  /**
   * Rejects one located source-profile violation.
   * @param {CstNode} node - Violating node.
   * @param {string} [detail] - Profile detail.
   * @returns {never} Always throws.
   */
  fail(node, detail = node.type) {
    unsupportedSyntax("rust", detail, this.location(node))
  }

  /**
   * Accounts for recovery, every extra, and doc comments before interpreting meaning.
   * @param {CstNode} node - Current node.
   * @param {number} [depth] - Bounded traversal depth.
   * @returns {void}
   */
  validateTree(node, depth = 0) {
    if (depth > 512) this.fail(node, "Rust CST exceeds the 512-level traversal limit")
    for (const {node: child} of node.children) this.validateTree(child, depth + 1)
    if (node.error || node.missing || node.hasError) {
      throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "rust", location: this.location(node), message: `Rust parser recovery at '${node.type}'.`})
    }
    if (node.extra && !["line_comment", "block_comment"].includes(node.type)) this.fail(node, "unexpected extra parser child")
    if (["line_comment", "block_comment"].includes(node.type) && /^(?:\/\/[!/]|\/\*[*!])/u.test(this.text(node))) {
      this.fail(node, "doc-comment attribute")
    }
  }

  /**
   * Omits only inert comments already checked during exhaustive traversal.
   * @param {CstNode} node - Parent.
   * @returns {CstNode[]} Ordered structural children.
   */
  parts(node) {
    return node.children.map(({node: child}) => child).filter(child => !["line_comment", "block_comment"].includes(child.type))
  }

  /**
   * Requires an exact sole parser field.
   * @param {CstNode} node - Field owner.
   * @param {string} name - Field name.
   * @returns {CstNode} Sole field value.
   */
  field(node, name) {
    const edges = node.children.filter(({field}) => field == name)

    if (edges.length != 1) this.fail(node, `expected one '${name}' field`)
    return edges[0].node
  }

  /**
   * Requires all ordered children, including anonymous punctuation.
   * @param {CstNode} node - Shape owner.
   * @param {(CstNode | string)[]} expected - Exact child sequence.
   * @returns {void}
   */
  shape(node, expected) {
    const parts = this.parts(node)

    if (parts.length != expected.length || parts.some((child, index) =>
      typeof expected[index] == "string" ? child.type != expected[index] || !child.named && this.text(child) != expected[index] : child !== expected[index])) this.fail(node, `${node.type} child shape`)
  }

  /**
   * Protects Rust keywords and the private support namespace.
   * @param {CstNode} node - Identifier token.
   * @returns {string} Validated name.
   */
  identifier(node) {
    const name = this.text(node)

    if (node.type != "identifier" || !isRustIdentifier(name)) this.fail(node, "reserved or unsupported identifier")
    return name
  }

  /**
   * Accepts only explicitly spelled i64, bool and owned String.
   * @param {CstNode} node - Type token.
   * @returns {import("../semantic/types.js").TypeReference} Semantic scalar type.
   */
  type(node) {
    if (node.children.length || !["primitive_type", "type_identifier"].includes(node.type)) this.fail(node, "scalar type shape")
    const spelling = this.text(node)
    const type = sourceScalarType("rust", spelling, this.location(node))

    if (!type) return missingType("rust", "scalar", this.location(node))
    if ((spelling == "String") != (node.type == "type_identifier")) this.fail(node, "scalar type spelling")
    return type
  }

  /**
   * Converts exact call syntax without interpreting macro token trees as calls.
   * @param {CstNode} node - Call expression.
   * @returns {{name: CstNode, arguments: CstNode[]}} Parsed direct argument sequence.
   */
  call(node) {
    if (node.type != "call_expression") this.fail(node, "direct call required")
    const name = this.field(node, "function")
    const list = this.field(node, "arguments")

    this.shape(node, [name, list])
    if (list.type != "arguments") this.fail(list, "call arguments")
    const args = this.parts(list).slice(1, -1).filter((_part, index) => index % 2 == 0)

    this.shape(list, ["(", ...args.flatMap((arg, index) => index == 0 ? [arg] : [",", arg]), ")"])
    return {arguments: args, name}
  }

  /**
   * Decodes parser-owned ordinary string content and exact scalar escapes.
   * @param {CstNode} node - String literal.
   * @returns {string} Unicode scalar value.
   */
  string(node) {
    if (node.type != "string_literal") this.fail(node, "ordinary String literal required")
    const parts = this.parts(node)

    this.shape(node, ['"', ...parts.slice(1, -1), '"'])
    let value = ""

    for (const part of parts.slice(1, -1)) {
      const spelling = this.text(part)

      if (part.type == "string_content") {
        if (/[\r\n]/u.test(spelling)) this.fail(part, "raw string line terminator")
        value += spelling
      } else if (part.type == "escape_sequence") {
        const escape = spelling.slice(1)
        const simple = new Map([["0", "\0"], ["n", "\n"], ["r", "\r"], ["t", "\t"], ["\\", "\\"], ['"', '"'], ["'", "'"]])

        if (spelling[0] != "\\") this.fail(part, "escape prefix")
        if (simple.has(escape)) value += simple.get(escape)
        else if (/^x[0-9a-fA-F]{2}$/u.test(escape)) {
          const scalar = Number.parseInt(escape.slice(1), 16)

          if (scalar > 127) this.fail(part, "non-ASCII byte escape")
          value += String.fromCodePoint(scalar)
        } else if (/^u\{[0-9a-fA-F]{1,6}\}$/u.test(escape)) {
          const scalar = Number.parseInt(escape.slice(2, -1), 16)

          if (scalar > 0x10FFFF || scalar >= 0xD800 && scalar <= 0xDFFF) this.fail(part, "non-scalar Unicode escape")
          value += String.fromCodePoint(scalar)
        } else this.fail(part, "unsupported string escape")
      } else this.fail(part, "string child")
    }
    return value
  }

  /**
   * Converts exact scalar expressions while retaining source clone/borrow constraints.
   * @param {CstNode} node - Expression node.
   * @returns {Expression} Pending typed semantic expression.
   */
  expression(node) {
    const location = this.location(node)

    if (node.type == "parenthesized_expression") {
      const parts = this.parts(node)

      this.shape(node, ["(", parts[1], ")"])
      return this.expression(parts[1])
    }
    if (node.type == "identifier") return withParserRanges({kind: "IdentifierExpression", location, name: this.identifier(node)}, {name: location})
    if (node.type == "integer_literal") {
      const spelling = this.text(node)
      const value = Number(spelling.slice(0, -3))

      if (!/^(?:0|[1-9][0-9]*)i64$/u.test(spelling) || !Number.isSafeInteger(value)) this.fail(node, "non-safe or noncanonical i64 literal")
      return withParserRanges({kind: "IntegerLiteral", location, value}, {literal: location})
    }
    if (node.type == "boolean_literal") {
      const spelling = this.text(node)

      if (spelling != "true" && spelling != "false") this.fail(node, "Boolean literal spelling")
      this.shape(node, [spelling])
      return withParserRanges({kind: "BooleanLiteral", location, value: spelling == "true"}, {literal: location})
    }
    if (node.type == "unary_expression") {
      const parts = this.parts(node)

      this.shape(node, [parts[0], parts[1]])
      if (!["-", "!"].includes(parts[0].type)) this.fail(parts[0], "unary operator")
      return this.unary(node, parts[0].type == "-" ? "Negate" : "Not", this.expression(parts[1]), parts[0])
    }
    if (node.type == "binary_expression") {
      const left = this.field(node, "left")
      const right = this.field(node, "right")
      const operator = this.field(node, "operator")
      const intent = binaryOperations.get(operator.type)

      this.shape(node, [left, operator, right])
      if (!intent) this.fail(operator, "unsupported binary operator")
      const borrowed = operator.type == "+" && right.type == "reference_expression"
      const value = borrowed ? this.field(right, "value") : right

      if (borrowed) this.shape(right, ["&", value])
      const expression = this.binary(node, intent, this.expression(left), this.expression(value), operator)

      if (operator.type == "+") this.additions.set(expression, {borrowed, node: right})
      return expression
    }
    if (node.type == "call_expression") {
      const call = this.call(node)
      const name = this.text(call.name)

      if (call.name.type == "scoped_identifier") {
        const owner = this.field(call.name, "path")
        const method = this.field(call.name, "name")

        this.shape(call.name, [owner, "::", method])
        if (owner.type != "identifier" || this.text(owner) != "String" || method.type != "identifier" || this.text(method) != "from" || call.arguments.length != 1) {
          this.fail(call.name, "exact String::from construction required")
        }
        return withParserRanges({kind: "StringLiteral", location, value: this.string(call.arguments[0])}, {literal: this.location(call.arguments[0])})
      }
      if (call.name.type == "field_expression") {
        const receiver = this.field(call.name, "value")
        const method = this.field(call.name, "field")

        this.shape(call.name, [receiver, ".", method])
        if (method.type != "field_identifier" || this.text(method) != "clone" || call.arguments.length) this.fail(call.name, "exact owned String clone required")
        const expression = this.expression(receiver)

        this.clones.set(expression, call.name)
        return expression
      }
      if (call.name.type != "identifier") this.fail(call.name, "direct function call required")
      if (this.helpers.has(name) && name == "semantifold_integer_negate") {
        if (call.arguments.length != 1) this.fail(node, "negation helper arity")
        return this.unary(node, "Negate", this.expression(call.arguments[0]), call.name)
      }
      const intent = this.helpers.has(name) ? arithmeticHelpers.get(name) : undefined

      if (intent) {
        if (call.arguments.length != 2) this.fail(node, "arithmetic helper arity")
        return this.binary(node, intent, this.expression(call.arguments[0]), this.expression(call.arguments[1]), call.name)
      }
      const callee = this.identifier(call.name)

      if (call.arguments.length != 2) this.fail(node, "semantic call arity")
      return withParserRanges({kind: "CallExpression", location, callee, arguments: call.arguments.map(argument => this.expression(argument))}, {callee: this.location(call.name)})
    }
    return this.fail(node)
  }

  /**
   * Retains parser operator intent until shared scalar resolution.
   * @param {CstNode} node - Owning node.
   * @param {string} intent - Parser operation.
   * @param {Expression} left - Left operand.
   * @param {Expression} right - Right operand.
   * @param {CstNode} operator - Exact operator token.
   * @returns {Expression} Pending binary expression.
   */
  binary(node, intent, left, right, operator) {
    return /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "BinaryExpression", location: this.location(node), left, right},
      {operator: this.location(operator)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (intent)))
  }

  /**
   * Retains unary parser intent and its original token range.
   * @param {CstNode} node - Owning node.
   * @param {"Negate" | "Not"} intent - Unary intent.
   * @param {Expression} operand - Operand.
   * @param {CstNode} operator - Exact token.
   * @returns {Expression} Pending unary expression.
   */
  unary(node, intent, operand, operator) {
    return /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "UnaryExpression", location: this.location(node), operand},
      {operator: this.location(operator)}), intent))
  }

  /**
   * Converts one explicitly typed initialized binding or executable statement.
   * @param {CstNode} node - Statement.
   * @returns {Statement} Semantic statement.
   */
  statement(node) {
    const location = this.location(node)
    const parts = this.parts(node)

    if (node.type == "let_declaration") {
      const typeNode = node.children.find(({field}) => field == "type")?.node

      if (!typeNode) return missingType("rust", "local", location)
      const name = this.field(node, "pattern")
      const value = this.field(node, "value")
      const mutable = parts[1].type == "mutable_specifier"

      this.shape(node, ["let", ...(mutable ? [parts[1]] : []), name, ":", typeNode, "=", value, ";"])
      if (mutable && this.text(parts[1]) != "mut") this.fail(parts[1], "mutability token")
      return withParserRanges({kind: "LocalDeclaration", location, name: this.identifier(name), type: this.type(typeNode), mutable,
        initializer: this.expression(value)}, {name: this.location(name), operator: this.location(parts[parts.length - 3])})
    }
    if (node.type != "expression_statement") this.fail(node, "explicit statement required; tail expressions are unsupported")
    const expression = parts[0]

    if (expression.type == "if_expression") {
      this.shape(node, [expression])
      return this.conditional(expression)
    }
    this.shape(node, [expression, ";"])
    if (expression.type == "return_expression") {
      const returned = this.parts(expression)

      this.shape(expression, ["return", returned[1]])
      return {kind: "ReturnStatement", location, expression: this.expression(returned[1])}
    }
    if (expression.type == "assignment_expression") {
      const left = this.field(expression, "left")
      const right = this.field(expression, "right")

      this.shape(expression, [left, "=", right])
      const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), location: this.location(left), name: this.identifier(left)}, {name: this.location(left)})

      return withParserRanges({kind: "AssignmentStatement", location, target, expression: this.expression(right)}, {operator: this.location(this.parts(expression)[1])})
    }
    const call = this.call(expression)
    const name = this.text(call.name)

    if (call.name.type != "identifier" || !this.helpers.has(name) || !/^semantifold_print_(?:integer|boolean|string)$/u.test(name) || call.arguments.length != 1) this.fail(node, "exact print helper call required")
    const statement = {kind: /** @type {const} */ ("PrintStatement"), location, expression: this.expression(call.arguments[0])}

    this.prints.set(statement, {node: call.name, type: name.slice("semantifold_print_".length)})
    return statement
  }

  /**
   * Converts exact braced conditionals and else-if nesting.
   * @param {CstNode} node - If expression used as a statement.
   * @returns {import("../semantic/types.js").IfStatement} Conditional statement.
   */
  conditional(node) {
    const condition = this.field(node, "condition")
    const consequence = this.field(node, "consequence")
    const alternative = node.children.find(({field}) => field == "alternative")?.node

    this.shape(node, ["if", condition, consequence, ...(alternative ? [alternative] : [])])
    const statement = {kind: /** @type {const} */ ("IfStatement"), location: this.location(node), condition: this.expression(condition), consequent: this.block(consequence)}

    if (!alternative) return statement
    const branch = this.parts(alternative)[1]

    this.shape(alternative, ["else", branch])
    return {...statement, alternate: branch.type == "if_expression" ? {kind: "Block", location: this.location(branch), statements: [this.conditional(branch)]} : this.block(branch)}
  }

  /**
   * Converts one complete lexical block.
   * @param {CstNode} node - Braced block.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  block(node) {
    if (node.type != "block") this.fail(node, "braced block required")
    const parts = this.parts(node)

    this.shape(node, ["{", ...parts.slice(1, -1), "}"])
    return {kind: "Block", location: this.location(node), statements: parts.slice(1, -1).map(child => this.statement(child))}
  }

  /**
   * Converts a crate-root function with exactly two required by-value parameters.
   * @param {CstNode} node - Function item.
   * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic declaration.
   */
  function(node) {
    const name = this.field(node, "name")
    const parameters = this.field(node, "parameters")
    const returnType = node.children.find(({field}) => field == "return_type")?.node
    const body = this.field(node, "body")

    if (!returnType) return missingType("rust", "function return", this.location(node))
    this.shape(node, ["fn", name, parameters, "->", returnType, body])
    this.shape(parameters, ["(", "parameter", ",", "parameter", ")"])
    const converted = [this.parts(parameters)[1], this.parts(parameters)[3]].map(parameter => {
      const pattern = this.field(parameter, "pattern")
      const type = this.field(parameter, "type")

      this.shape(parameter, [pattern, ":", type])
      return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: this.location(parameter), name: this.identifier(pattern), type: this.type(type)}, {name: this.location(pattern)})
    })

    return withParserRanges({kind: "FunctionDeclaration", location: this.location(node), name: this.identifier(name), parameters: converted,
      returnType: this.type(returnType), body: this.block(body)}, {name: this.location(name)})
  }

  /**
   * Compares all fields, children and leaf spellings against qualified support syntax.
   * @param {CstNode} actual - Original node.
   * @param {CstNode} expected - Qualified node.
   * @param {RustReader} canonical - Qualified spelling reader.
   * @returns {void}
   */
  compareTree(actual, expected, canonical) {
    if (actual.type != expected.type || actual.named != expected.named || actual.extra != expected.extra) this.fail(actual, "modified Rust support node")
    const left = this.parts(actual)
    const right = canonical.parts(expected)

    if (left.length != right.length) this.fail(actual, "modified Rust support children")
    if (!left.length && this.text(actual) != canonical.text(expected)) this.fail(actual, "modified Rust support token")
    left.forEach((child, index) => {
      if (actual.children.find(edge => edge.node === child)?.field != expected.children.find(edge => edge.node === right[index])?.field) this.fail(child, "modified Rust support field")
      this.compareTree(child, right[index], canonical)
    })
  }

  /**
   * Resolves only already validated scalar expressions for scaffold checking.
   * @param {Expression} expression - Resolved semantic expression.
   * @param {Map<string, Scalar>} bindings - Lexical types.
   * @returns {Scalar} Semantic result type.
   */
  expressionType(expression, bindings) {
    if (expression.kind == "StringLiteral") return "string"
    if (expression.kind == "IntegerLiteral") return "integer"
    if (expression.kind == "BooleanLiteral") return "boolean"
    if (expression.kind == "BinaryExpression" || expression.kind == "UnaryExpression") return expression.type
    const type = expression.kind == "CallExpression" ? this.functions.get(expression.callee) : bindings.get(expression.name)

    if (!type) throw new Error("Validated Rust expression lost its scalar binding.")
    return type
  }

  /**
   * Checks clone, borrow and print constraints after shared operation resolution.
   * @param {import("../semantic/types.js").Block} block - Resolved block.
   * @param {Map<string, Scalar>} inherited - Enclosing types.
   * @returns {void}
   */
  validateScalars(block, inherited) {
    const bindings = new Map(inherited)
    /**
     * Checks each original clone and borrowed concatenation after scalar resolution.
     * @param {Expression} expression - Current expression.
     * @returns {void}
     */
    const visit = expression => {
      const clone = this.clones.get(expression)
      const addition = this.additions.get(expression)

      if (clone && this.expressionType(expression, bindings) != "string") this.fail(clone, "clone requires owned String")
      if (addition && (this.expressionType(expression, bindings) == "string") != addition.borrowed) this.fail(addition.node, "string concatenation requires exactly a borrowed String RHS")
      if (expression.kind == "CallExpression") expression.arguments.forEach(visit)
      else if (expression.kind == "UnaryExpression") visit(expression.operand)
      else if (expression.kind == "BinaryExpression") { visit(expression.left); visit(expression.right) }
    }

    for (const statement of block.statements) {
      const expression = statement.kind == "IfStatement" ? statement.condition : statement.kind == "LocalDeclaration" ? statement.initializer : statement.expression

      visit(expression)
      if (statement.kind == "LocalDeclaration") bindings.set(statement.name, statement.type.name)
      if (statement.kind == "PrintStatement") {
        const print = this.prints.get(statement)

        if (!print) throw new Error("Rust print lost its original helper identity.")
        if (this.expressionType(expression, bindings) != print.type) this.fail(print.node, "print helper scalar mismatch")
      }
      if (statement.kind == "IfStatement") {
        this.validateScalars(statement.consequent, bindings)
        if (statement.alternate) this.validateScalars(statement.alternate, bindings)
      }
    }
  }

  /**
   * Validates genuine source moves in evaluation order, retaining implicit comparison borrows.
   * @param {Expression} expression - Original expression occurrence.
   * @param {Map<string, Scalar>} bindings - Validated lexical types.
   * @param {Set<string>} moved - Definitely or possibly consumed String bindings.
   * @param {Set<string>} borrowed - Borrows held by enclosing operand evaluation.
   * @param {"move" | "borrow"} [usage] - How this expression's result is consumed.
   * @param {boolean} [applyClone] - Whether to apply this occurrence's checked clone wrapper.
   * @returns {Set<string>} Place borrows held until the containing operation completes.
   */
  ownershipExpression(expression, bindings, moved, borrowed, usage = "move", applyClone = true) {
    if (applyClone && this.clones.has(expression)) {
      this.ownershipExpression(expression, bindings, moved, borrowed, "borrow", false)
      return new Set()
    }
    if (expression.kind == "IdentifierExpression" && this.expressionType(expression, bindings) == "string") {
      const name = expression.name

      if (moved.has(name)) unsupportedSyntax("rust", `use of moved String '${name}'`, expression.location)
      if (usage == "borrow") return new Set([name])
      if (borrowed.has(name)) unsupportedSyntax("rust", `cannot move borrowed String '${name}' during operand evaluation`, expression.location)
      moved.add(name)
    } else if (expression.kind == "CallExpression") {
      for (const argument of expression.arguments) this.ownershipExpression(argument, bindings, moved, borrowed)
    } else if (expression.kind == "UnaryExpression") this.ownershipExpression(expression.operand, bindings, moved, borrowed)
    else if (expression.kind == "BinaryExpression") {
      if (expression.operation == "StringEqual" || expression.operation == "StringNotEqual") {
        const held = this.ownershipExpression(expression.left, bindings, moved, borrowed, "borrow")

        this.ownershipExpression(expression.right, bindings, moved, new Set([...borrowed, ...held]), "borrow")
      } else {
        this.ownershipExpression(expression.left, bindings, moved, borrowed)
        if (expression.operation == "BooleanAnd" || expression.operation == "BooleanOr") {
          const conditional = new Set(moved)

          this.ownershipExpression(expression.right, bindings, conditional, borrowed)
          for (const name of conditional) moved.add(name)
        } else this.ownershipExpression(expression.right, bindings, moved, borrowed, expression.operation == "StringConcat" ? "borrow" : "move")
      }
    }
    return new Set()
  }

  /**
   * Merges source availability only from paths that continue, restoring explicit assignments.
   * @param {import("../semantic/types.js").Block} block - Original lexical block.
   * @param {Map<string, Scalar>} inherited - Visible scalar bindings.
   * @param {Set<string>} inheritedMoved - Incoming consumed bindings.
   * @returns {{moved: Set<string>, returns: boolean}} Outgoing source availability and control flow.
   */
  validateOwnership(block, inherited, inheritedMoved) {
    const bindings = new Map(inherited)
    const moved = new Set(inheritedMoved)

    for (const statement of block.statements) {
      const expression = statement.kind == "IfStatement" ? statement.condition : statement.kind == "LocalDeclaration" ? statement.initializer : statement.expression

      this.ownershipExpression(expression, bindings, moved, new Set())
      if (statement.kind == "ReturnStatement") return {moved, returns: true}
      if (statement.kind == "LocalDeclaration") bindings.set(statement.name, statement.type.name)
      else if (statement.kind == "AssignmentStatement") moved.delete(statement.target.name)
      else if (statement.kind == "IfStatement") {
        const consequent = this.validateOwnership(statement.consequent, bindings, moved)
        const alternate = statement.alternate ? this.validateOwnership(statement.alternate, bindings, moved) : {moved: new Set(moved), returns: false}

        if (consequent.returns && alternate.returns) return {moved, returns: true}
        moved.clear()
        for (const path of [consequent, alternate]) {
          if (!path.returns) for (const name of path.moved) if (bindings.has(name)) moved.add(name)
        }
      }
    }
    return {moved, returns: false}
  }

  /**
   * Validates the complete crate and collapses only exact declared support.
   * @param {CstNode} root - Complete root.
   * @returns {import("../semantic/types.js").SemanticModule} Resolved semantics.
   */
  module(root) {
    this.validateTree(root)
    if (root.type != "source_file") this.fail(root, "crate root required")
    const canonical = new RustReader(this.filename, rustRuntime)
    const support = canonical.parts(parseRustCst(rustRuntime).root)
    const helpers = new Map(support.filter(node => node.type == "function_item").map(node => [canonical.text(canonical.field(node, "name")), node]))
    /** @type {CstNode[]} */
    const definitions = []
    let lint = false
    /** @type {CstNode | undefined} */
    let main

    for (const node of this.parts(root)) {
      if (node.type == "inner_attribute_item") {
        if (lint || definitions.length || main || this.helpers.size) this.fail(node, "misplaced Rust lint support")
        this.compareTree(node, support[0], canonical)
        lint = true
        continue
      }
      if (node.type != "function_item") this.fail(node, "crate-root free functions only")
      const name = this.text(this.field(node, "name"))
      const helper = helpers.get(name)

      if (helper) {
        if (this.helpers.has(name)) this.fail(node, "duplicate Rust helper")
        this.compareTree(node, helper, canonical)
        this.helpers.add(name)
      } else if (name == "main") {
        if (main) this.fail(node, "duplicate main")
        main = node
      } else definitions.push(node)
    }
    if (!main) this.fail(root, "canonical fn main() required")
    const name = this.field(main, "name")
    const parameters = this.field(main, "parameters")
    const body = this.field(main, "body")

    this.shape(main, ["fn", name, parameters, body])
    this.shape(parameters, ["(", ")"])
    const module = validateParsedModule({kind: "Module", location: this.location(root), functions: definitions.map(node => this.function(node)),
      entryPoint: {kind: "EntryPoint", location: this.location(main), body: this.block(body)}}, "rust")

    this.functions = new Map(module.functions.map(declaration => [declaration.name, declaration.returnType.name]))
    for (const declaration of module.functions) {
      const bindings = new Map(declaration.parameters.map(parameter => [parameter.name, parameter.type.name]))

      this.validateScalars(declaration.body, bindings)
      this.validateOwnership(declaration.body, bindings, new Set())
    }
    this.validateScalars(module.entryPoint.body, new Map())
    this.validateOwnership(module.entryPoint.body, new Map(), new Set())
    return module
  }
}

/**
 * Parses only the qualified frozen CST and rejects unsupported input before adaptation.
 * @param {{filename: string, source: string}} input - Exact source request.
 * @returns {import("../semantic/types.js").SemanticModule} Rust semantic module.
 */
export function parseRust({filename, source}) {
  const coordinates = createCoordinateIndex(source)
  const location = {filename, start: indexedPointAt(coordinates, 0), end: indexedPointAt(coordinates, source.length)}

  if (!hasOnlyUnicodeScalars(source)) {
    const offset = source.search(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "rust", message: "Rust source contains a lone UTF-16 surrogate.",
      location: {filename, start: indexedPointAt(coordinates, offset), end: indexedPointAt(coordinates, offset + 1)}})
  }
  if (source.length > maximumRustSourceLength) return unsupportedSyntax("rust", "source exceeds the frozen Rust parser's 32767 UTF-16 input limit", location)
  let snapshot

  try {
    snapshot = parseRustCst(source)
  } catch (error) {
    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "rust", location,
      cause: error instanceof Error ? error : undefined, message: "The qualified Rust parser could not produce a complete CST."})
  }
  return new RustReader(filename, source).module(snapshot.root)
}
