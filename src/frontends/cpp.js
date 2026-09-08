// @ts-check

import {generateCpp} from "../backends/cpp.js"
import {OrderedExpressionPlanner} from "../backends/ordered-expressions.js"
import {maximumCppSourceLength} from "../backends/cpp-validation.js"
import {validateNativeGraph} from "../backends/native-validation.js"
import {cppRuntime} from "../backends/cpp-runtime.js"
import {validateBackendModule} from "../backends/shared.js"
import {isCppIdentifier} from "../backends/identifiers.js"
import {parseCppCst} from "./cpp-parser.js"
import {missingType, SemantifoldDiagnostic, unsupportedSyntax} from "../diagnostic.js"
import {createCoordinateIndex, indexedPointAt} from "../semantic/location.js"
import {withAdaptedOperation} from "../semantic/operators.js"
import {withParserRanges} from "../semantic/provenance.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {validateParsedModule} from "../semantic/validate.js"
import {sourceScalarType} from "./scalars.js"

/** @typedef {import("./cpp-parser.js").CstNode} CstNode */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").Statement} Statement */

const binaryOperations = new Map([
  ["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["==", "Equal"], ["!=", "NotEqual"],
  ["<", "LessThan"], ["<=", "LessThanOrEqual"], [">", "GreaterThan"], [">=", "GreaterThanOrEqual"],
  ["&&", "And"], ["||", "Or"]
])
const helpers = new Map([
  ["semantifold_integer_add", "PhpAdd"], ["semantifold_integer_subtract", "Subtract"],
  ["semantifold_integer_multiply", "Multiply"], ["semantifold_string_concat", "StringConcat"],
  ["semantifold_string_equal", "StringEqual"], ["semantifold_string_not_equal", "StringNotEqual"]
])

/** Strict field-and-token consumer for the private frozen CPP CST. */
export class CppReader {
  /**
   * Owns source content and its coordinate index, never native parser handles.
   * @param {string} filename - Original filename.
   * @param {string} source - Exact original source.
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
    /** @type {Map<Statement, {node: CstNode, type: string}>} */
    this.printTypes = new Map()
    /** @type {Set<string>} */
    this.declaredFunctions = new Set()
  }

  /**
   * Locates one parser-owned range in UTF-16 coordinates.
   * @param {CstNode} node - Parser node.
   * @returns {import("../semantic/types.js").SourceLocation} Verified location.
   */
  location(node) {
    return {filename: this.filename, start: indexedPointAt(this.coordinates, node.startIndex), end: indexedPointAt(this.coordinates, node.endIndex)}
  }

  /**
   * Reads only the spelling of an already recognized parser node.
   * @param {CstNode} node - Parser node.
   * @returns {string} Exact token spelling.
   */
  text(node) {
    return this.source.slice(node.startIndex, node.endIndex)
  }

  /**
   * Rejects a located source-profile violation.
   * @param {CstNode} node - Rejected node.
   * @param {string} [detail] - Profile violation.
   * @returns {never} Always throws.
   */
  fail(node, detail = node.type) {
    unsupportedSyntax("cpp", detail, this.location(node))
  }

  /**
   * Traverses all edges before interpreting any source meaning.
   * @param {CstNode} node - Current parser node.
   * @param {number} [depth] - Bounded CST traversal depth.
   * @returns {void}
   */
  validateTree(node, depth = 0) {
    if (depth > 512) this.fail(node, "CPP CST exceeds the 512-level traversal limit")
    for (const {node: child} of node.children) this.validateTree(child, depth + 1)
    if (node.error || node.missing || node.hasError) {
      throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "cpp", location: this.location(node), message: `CPP parser recovery at '${node.type}'.`})
    }
    if (node.extra && node.type != "comment") this.fail(node, "unexpected extra parser child")
    if ((node.type == "comment" || node.type == "string_content") && /\?\?[=/'()!<>-]/u.test(this.text(node))) {
      this.fail(node, "trigraph preprocessing")
    }
    if (node.type == "comment") {
      const text = this.text(node)

      // A terminal CR belongs to ordinary CRLF; content after a bare CR is not a CPP line comment.
      if (/\\(?:\r\n?|\n)/u.test(text) || text.startsWith("//") && /\r(?!\n|$)/u.test(text)) {
        this.fail(node, "preprocessing-sensitive comment")
      }
    }
  }

  /**
   * Separates harmless comments after every child has been validated.
   * @param {CstNode} node - Parent node.
   * @returns {CstNode[]} Ordered structural children.
   */
  parts(node) {
    return node.children.map(({node: child}) => child).filter((child) => child.type != "comment")
  }

  /**
   * Requires one exact field rather than searching descendants.
   * @param {CstNode} node - Field owner.
   * @param {string} name - Field name.
   * @returns {CstNode} Sole field child.
   */
  field(node, name) {
    const matches = node.children.filter(({field}) => field == name)

    if (matches.length != 1) return this.fail(node, `expected one '${name}' field`)
    return matches[0].node
  }

  /**
   * Consumes every structural child, including punctuation.
   * @param {CstNode} node - Shape owner.
   * @param {(CstNode | string)[]} expected - Ordered nodes or token kinds.
   * @returns {void}
   */
  shape(node, expected) {
    const children = this.parts(node)

    if (children.length != expected.length || children.some((child, index) =>
      typeof expected[index] == "string" ? child.type != expected[index] : child !== expected[index])) this.fail(node, `${node.type} child shape`)
  }

  /**
   * Requires an ordinary caller identifier outside the protected namespace.
   * @param {CstNode} node - Identifier token.
   * @returns {string} Accepted spelling.
   */
  identifier(node) {
    const name = this.text(node)

    if (node.type != "identifier" || !isCppIdentifier(name)) this.fail(node, "reserved or unsupported identifier")
    return name
  }

  /**
   * Converts only the canonical scalar type spellings.
   * @param {CstNode} node - Type token.
   * @returns {import("../semantic/types.js").TypeReference} Semantic scalar.
   */
  type(node) {
    const spelling = node.type == "qualified_identifier" ? this.qualified(node) : this.text(node)

    if (node.type != "qualified_identifier" && (node.type != "primitive_type" || spelling != "bool")) this.fail(node, "scalar type shape")
    const type = sourceScalarType("cpp", spelling, this.location(node))

    if (!type) return this.fail(node, "unsupported scalar type")
    return type
  }

  /**
   * Reads exactly one std-qualified scalar name from CPP fields and punctuation.
   * @param {CstNode} node - Qualified grammar node.
   * @returns {string} Canonical qualified scalar spelling.
   */
  qualified(node) {
    const scope = this.field(node, "scope")
    const name = this.field(node, "name")

    this.shape(node, [scope, "::", name])
    if (scope.type != "namespace_identifier" || this.text(scope) != "std" ||
      !["type_identifier", "identifier"].includes(name.type) || !["int64_t", "string"].includes(this.text(name))) this.fail(node, "qualified scalar name")
    return "std::" + this.text(name)
  }

  /**
   * Converts a direct function call's exact argument list.
   * @param {CstNode} node - Call node.
   * @returns {{name: CstNode, arguments: CstNode[]}} Parsed call shape.
   */
  call(node) {
    if (node.type != "call_expression") return this.fail(node, "direct call required")
    const name = this.field(node, "function")
    const list = this.field(node, "arguments")

    this.shape(node, [name, list])
    if (!["identifier", "qualified_identifier"].includes(name.type) || list.type != "argument_list") this.fail(node, "direct call shape")
    const parts = this.parts(list)
    const args = parts.slice(1, -1).filter((_part, index) => index % 2 == 0)

    this.shape(list, ["(", ...args.flatMap((arg, index) => index == 0 ? [arg] : [",", arg]), ")"])
    return {arguments: args, name}
  }

  /**
   * Decodes a parser-backed ordinary CPP string token as UTF-8 bytes.
   * @param {CstNode} node - String literal.
   * @returns {string} Complete Unicode scalar value.
   */
  string(node) {
    if (node.type != "string_literal") return this.fail(node, "ordinary string literal required")
    const parts = this.parts(node)

    if (parts[0]?.type != '"' || parts.at(-1)?.type != '"') this.fail(node, "prefixed string literal")
    const bytes = []

    for (let index = 1; index < parts.length - 1; index++) {
      const child = parts[index]
      const text = this.text(child)

      if (child.type == "string_content") {
        if (/[\r\n]/u.test(text)) this.fail(child, "raw line terminator in string literal")
        for (const byte of new TextEncoder().encode(text)) bytes.push(byte)
      }
      else if (child.type == "escape_sequence") {
        const simple = new Map([["a", 7], ["b", 8], ["f", 12], ["n", 10], ["r", 13], ["t", 9], ["v", 11], ["\\", 92], ['"', 34], ["'", 39], ["?", 63]])
        const value = text.slice(1)

        if (text[0] != "\\") this.fail(child, "invalid escape")
        if (simple.has(value)) bytes.push(/** @type {number} */ (simple.get(value)))
        else if (/^[0-7]{1,3}$/u.test(value) || /^x[0-9a-fA-F]+$/u.test(value)) {
          const next = parts[index + 1]

          // CPP consumes every adjacent hex digit; the frozen grammar caps each escape node at four.
          if (value.startsWith("x") && next.type == "string_content" && next.startIndex == child.endIndex && /^[0-9a-fA-F]/u.test(this.text(next))) {
            this.fail(child, "hexadecimal escape split by parser boundary")
          }
          const number = Number.parseInt(value[0] == "x" ? value.slice(1) : value, value[0] == "x" ? 16 : 8)

          if (number > 255) this.fail(child, "escape outside byte range")
          bytes.push(number)
        } else this.fail(child, "unsupported escape")
      } else this.fail(child, "string child")
    }
    try {
      return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(new Uint8Array(bytes))
    } catch (error) {
      if (error instanceof TypeError) return this.fail(node, "invalid UTF-8 literal bytes")
      throw error
    }
  }

  /**
   * Converts supported expressions without assuming CPP argument evaluation order.
   * @param {CstNode} node - Expression node.
   * @param {boolean} [nested] - Whether a semantic call would have unspecified order.
   * @returns {Expression} Semantic expression.
   */
  expression(node, nested = false) {
    const location = this.location(node)

    if (node.type == "condition_clause") {
      const value = this.field(node, "value")

      this.shape(node, ["(", value, ")"])
      return this.expression(value, nested)
    }
    if (node.type == "parenthesized_expression") {
      const parts = this.parts(node)

      this.shape(node, ["(", parts[1], ")"])
      return this.expression(parts[1], nested)
    }
    if (node.type == "identifier") {
      const temporary = this.temporaryExpressions?.get(this.text(node))

      if (temporary) {
        this.temporaryExpressions?.delete(this.text(node))
        return temporary
      }
      return withParserRanges({kind: "IdentifierExpression", location, name: this.identifier(node)}, {name: location})
    }
    if (node.type == "true" || node.type == "false") {
      if (this.text(node) != node.type) this.fail(node, "noncanonical Boolean literal spelling")
      return withParserRanges({kind: "BooleanLiteral", location, value: node.type == "true"}, {literal: location})
    }
    if (node.type == "number_literal") this.fail(node, "integer literal requires exact std::int64_t construction")
    if (node.type == "binary_expression") {
      const left = this.field(node, "left")
      const right = this.field(node, "right")
      const operator = this.field(node, "operator")
      const intent = binaryOperations.get(operator.type)

      this.shape(node, [left, operator, right])
      if (!intent) return this.fail(operator, "unsupported binary operator")
      return this.binary(node, intent, this.expression(left, true), this.expression(right, true), operator)
    }
    if (node.type == "unary_expression") {
      const operator = this.field(node, "operator")
      const argument = this.field(node, "argument")

      this.shape(node, [operator, argument])
      if (!["-", "!"].includes(operator.type)) this.fail(operator, "unsupported unary operator")
      return this.unary(node, operator.type == "-" ? "Negate" : "Not", this.expression(argument, true), operator)
    }
    if (node.type == "call_expression") {
      const call = this.call(node)
      const name = this.text(call.name)

      if (call.name.type == "qualified_identifier") {
        const qualified = this.qualified(call.name)

        if (qualified == "std::int64_t") {
          if (call.arguments.length != 1 || call.arguments[0].type != "number_literal") this.fail(node, "exact integer literal construction")
          const spelling = this.text(call.arguments[0])

          if (!/^(?:0|[1-9][0-9]*)$/u.test(spelling) || !Number.isSafeInteger(Number(spelling))) this.fail(call.arguments[0], "non-safe or noncanonical integer")
          return withParserRanges({kind: "IntegerLiteral", location, value: Number(spelling)}, {literal: location})
        }
        if (qualified == "std::string") {
          if (call.arguments.length != 2 || call.arguments[1].type != "number_literal") this.fail(node, "byte-counted string literal construction")
          const value = this.string(call.arguments[0])
          const length = this.text(call.arguments[1])

          if (length != String(Buffer.byteLength(value, "utf8"))) this.fail(node, "string literal byte count")
          return withParserRanges({kind: "StringLiteral", location, value}, {literal: location})
        }
        this.fail(call.name, "qualified user call")
      }
      // Generated operations are separate temporary initializers; only exact scalar literal constructions may nest as calls.
      if (nested) this.fail(node, "caller call in unspecified-order expression")
      if (name == "semantifold_integer_negate") {
        if (call.arguments.length != 1) this.fail(node, "negation helper arity")
        return this.unary(node, "Negate", this.expression(call.arguments[0], true), call.name)
      }
      const intent = helpers.get(name)

      if (intent) {
        if (call.arguments.length != 2) this.fail(node, "scalar helper arity")
        return this.binary(node, intent, this.expression(call.arguments[0], true), this.expression(call.arguments[1], true), call.name)
      }
      if (call.arguments.length != 2) this.fail(node, "semantic call arity")
      const callee = this.identifier(call.name)

      if (!this.generated && !this.declaredFunctions.has(callee)) this.fail(call.name, "implicit function declaration")
      return withParserRanges({kind: "CallExpression", location, callee,
        arguments: call.arguments.map((argument) => this.expression(argument, true))}, {callee: this.location(call.name)})
    }
    return this.fail(node)
  }

  /**
   * Records parser intent before shared type resolution.
   * @param {CstNode} node - Owning expression.
   * @param {string} intent - Adapted operation.
   * @param {Expression} left - Left operand.
   * @param {Expression} right - Right operand.
   * @param {CstNode} operator - Operator token.
   * @returns {Expression} Pending binary expression.
   */
  binary(node, intent, left, right, operator) {
    return /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "BinaryExpression", location: this.location(node), left, right},
      {operator: this.location(operator)}), /** @type {import("../semantic/operators.js").AdaptedOperation} */ (intent)))
  }

  /**
   * Records parser intent for a unary operation.
   * @param {CstNode} node - Owning expression.
   * @param {"Negate" | "Not"} intent - Adapted operation.
   * @param {Expression} operand - Operand.
   * @param {CstNode} operator - Operator token.
   * @returns {Expression} Pending unary expression.
   */
  unary(node, intent, operand, operator) {
    return /** @type {Expression} */ (withAdaptedOperation(withParserRanges({kind: "UnaryExpression", location: this.location(node), operand},
      {operator: this.location(operator)}), intent))
  }

  /**
   * Converts one initialized declaration or executable statement.
   * @param {CstNode} node - Statement node.
   * @returns {Statement} Semantic statement.
   */
  statement(node) {
    const location = this.location(node)

    if (node.type == "declaration") {
      const typeNode = node.children.find(({field}) => field == "type")?.node

      if (!typeNode) return missingType("cpp", "local", location)
      const declarator = this.field(node, "declarator")
      const parts = this.parts(node)
      const immutable = parts[0].type == "type_qualifier"

      this.shape(node, [...(immutable ? [parts[0]] : []), typeNode, declarator, ";"])
      if (immutable && this.text(parts[0]) != "const") this.fail(parts[0], "local qualifier")
      if (declarator.type != "init_declarator") this.fail(declarator, "initialized simple local required")
      const name = this.field(declarator, "declarator")
      const value = this.field(declarator, "value")

      this.shape(declarator, [name, "=", value])
      return withParserRanges({kind: "LocalDeclaration", location, name: this.identifier(name), type: this.type(typeNode), mutable: !immutable,
        initializer: this.expression(value)}, {name: this.location(name), operator: this.location(this.parts(declarator)[1])})
    }
    if (node.type == "return_statement") {
      const parts = this.parts(node)

      this.shape(node, ["return", parts[1], ";"])
      return {kind: "ReturnStatement", location, expression: this.expression(parts[1])}
    }
    if (node.type == "if_statement") {
      const condition = this.field(node, "condition")
      const consequence = this.field(node, "consequence")
      const alternative = node.children.find(({field}) => field == "alternative")?.node

      this.shape(node, ["if", condition, consequence, ...(alternative ? [alternative] : [])])
      const statement = {kind: /** @type {const} */ ("IfStatement"), location, condition: this.expression(condition), consequent: this.block(consequence)}

      if (!alternative) return statement
      const branch = this.parts(alternative)[1]

      this.shape(alternative, ["else", branch])
      return {...statement, alternate: branch.type == "if_statement"
        ? {kind: "Block", location: this.location(branch), statements: [this.statement(branch)]} : this.block(branch)}
    }
    if (node.type == "expression_statement") {
      const expression = this.parts(node)[0]

      this.shape(node, [expression, ";"])
      if (expression.type == "assignment_expression") {
        const left = this.field(expression, "left")
        const right = this.field(expression, "right")
        const operator = this.field(expression, "operator")

        this.shape(expression, [left, "=", right])
        const target = withParserRanges({kind: /** @type {const} */ ("IdentifierExpression"), name: this.identifier(left), location: this.location(left)}, {name: this.location(left)})

        return withParserRanges({kind: "AssignmentStatement", location, target, expression: this.expression(right)}, {operator: this.location(operator)})
      }
      const call = this.call(expression)

      if (!/^semantifold_print_(?:integer|boolean|string)$/u.test(this.text(call.name)) || call.arguments.length != 1) this.fail(node, "print scaffold")
      const value = this.expression(call.arguments[0])

      const statement = {kind: /** @type {const} */ ("PrintStatement"), location, expression: value}

      this.printTypes.set(statement, {node: call.name, type: this.text(call.name).slice("semantifold_print_".length)})
      return statement
    }
    return this.fail(node)
  }

  /**
   * Converts one lexical braced block in source order.
   * @param {CstNode} node - Block node.
   * @returns {import("../semantic/types.js").Block} Semantic block.
   */
  block(node) {
    if (node.type != "compound_statement") this.fail(node, "braced block required")
    const parts = this.parts(node)

    this.shape(node, ["{", ...parts.slice(1, -1), "}"])
    return {kind: "Block", location: this.location(node), statements: this.generated
      ? this.generatedStatements(node.children.map(({node: child}) => child).slice(1, -1))
      : parts.slice(1, -1).map((child) => this.statement(child))}
  }

  /**
   * Converts one namespace-scope semantic function.
   * @param {CstNode} node - Function definition.
   * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
   */
  function(node) {
    const type = this.field(node, "type")
    const declarator = this.field(node, "declarator")
    const body = this.field(node, "body")

    this.shape(node, [type, declarator, body])
    if (declarator.type != "function_declarator") this.fail(node, "namespace-scope function required")
    const name = this.field(declarator, "declarator")
    const parameters = this.field(declarator, "parameters")

    this.shape(declarator, [name, parameters])
    const parts = this.parts(parameters)

    this.shape(parameters, ["(", "parameter_declaration", ",", "parameter_declaration", ")"])
    const converted = [parts[1], parts[3]].map((parameter) => {
      const typeNode = this.field(parameter, "type")
      const nameNode = this.field(parameter, "declarator")

      this.shape(parameter, [typeNode, nameNode])
      return withParserRanges({kind: /** @type {const} */ ("Parameter"), location: this.location(parameter), name: this.identifier(nameNode), type: this.type(typeNode)}, {name: this.location(nameNode)})
    })

    this.declaredFunctions.add(this.identifier(name))
    return withParserRanges({kind: "FunctionDeclaration", location: this.location(node), name: this.identifier(name), parameters: converted,
      returnType: this.type(type), body: this.block(body)}, {name: this.location(name)})
  }

  /**
   * Removes only the exact parameterless main and zero-status scaffolding.
   * @param {CstNode} node - Entry definition.
   * @returns {import("../semantic/types.js").EntryPoint} Semantic entry.
   */
  main(node) {
    const type = this.field(node, "type")
    const declarator = this.field(node, "declarator")
    const body = this.field(node, "body")

    this.shape(node, [type, declarator, body])
    const name = this.field(declarator, "declarator")
    const parameters = this.field(declarator, "parameters")

    this.shape(declarator, [name, parameters])
    if (this.text(type) != "int" || this.text(name) != "main") this.fail(node, "main signature")
    this.shape(parameters, ["(", ")"])
    if (body.type != "compound_statement") this.fail(body, "braced main required")
    const parts = this.parts(body)
    const status = parts.at(-2)

    if (!status) this.fail(body, "main status")
    this.shape(body, ["{", ...parts.slice(1, -1), "}"])
    this.shape(status, ["return", "number_literal", ";"])
    if (this.text(this.parts(status)[1]) != "0") this.fail(status, "entry status")
    return {kind: "EntryPoint", location: this.location(node), body: {kind: "Block", location: this.location(body),
      statements: this.generated ? this.generatedStatements(body.children.map(({node: child}) => child).filter((child) =>
        child.startIndex > body.startIndex && child.endIndex <= status.startIndex))
        : parts.slice(1, -2).map((child) => this.statement(child))}}
  }

  /**
   * Converts one complete translation unit after exhaustive recovery rejection.
   * @param {CstNode} root - Frozen translation unit.
   * @returns {import("../semantic/types.js").SemanticModule} Validated semantic module.
   */
  module(root) {
    this.validateTree(root)
    this.generated = root.children.some(({node}) => node.type == "comment" && this.text(node) == "/* semantifold:program:cpp:v1 */")
    if (root.type != "translation_unit") this.fail(root, "translation unit required")
    const runtime = new CppReader(this.filename, cppRuntime)
    const expected = runtime.significant(parseCppCst(cppRuntime).root)
    const actual = this.significant(root).filter((node) => !(node.type == "comment" && this.text(node) == "/* semantifold:program:cpp:v1 */"))

    if (actual.length < expected.length) this.fail(root, "complete CPP runtime required")
    expected.forEach((node, index) => this.compareTree(actual[index], node, runtime))
    const remaining = actual.slice(expected.length)

    if (!this.generated) for (const node of remaining) this.rejectScaffoldComments(node)
    const definitions = remaining.filter((node) => node.type != "comment" && (!this.generated || node.type != "declaration"))

    if (definitions.some((node) => node.type != "function_definition")) this.fail(root, "translation unit members")
    if (definitions.length < 2) this.fail(root, "semantic function and main required")
    const module = {kind: /** @type {const} */ ("Module"), location: this.location(root), functions: definitions.slice(0, -1).map((node) => this.function(node)),
      entryPoint: this.main(definitions[definitions.length - 1])}

    if (this.generated) validateNativeGraph(module, "cpp")
    const validated = validateParsedModule(module, "cpp")

    this.validatePrintTypes(validated)
    if (this.generated) {
      validateBackendModule(validated, "cpp")
      const canonical = generateCpp(validated)

      if (typeof canonical != "string") throw new Error("CPP backend returned a nontext entry artifact.")
      this.compareTree(root, parseCppCst(canonical).root, new CppReader(this.filename, canonical))
    }
    return validated
  }

  /**
   * Checks native print helper selection after semantic scalar resolution.
   * @param {import("../semantic/types.js").SemanticModule} module - Resolved module.
   * @returns {void}
   */
  validatePrintTypes(module) {
    const planner = new OrderedExpressionPlanner(module, "cpp")
    /**
     * Checks one lexical block with its visible scalar bindings.
     * @param {import("../semantic/types.js").Block} block - Semantic block.
     * @param {Map<string, import("../semantic/types.js").SemanticTypeName>} inherited - Visible bindings.
     * @returns {void}
     */
    const visit = (block, inherited) => {
      const bindings = new Map(inherited)

      for (const statement of block.statements) {
        if (statement.kind == "LocalDeclaration") bindings.set(statement.name, statement.type.name)
        if (statement.kind == "PrintStatement") {
          const expected = this.printTypes.get(statement)

          if (!expected) throw new Error("CPP print statement lost its parser helper identity.")
          if (planner.type(statement.expression, bindings) != expected.type) this.fail(expected.node, "print helper scalar mismatch")
        }
        if (statement.kind == "IfStatement") {
          visit(statement.consequent, bindings)
          if (statement.alternate) visit(statement.alternate, bindings)
        }
      }
    }

    for (const declaration of module.functions) visit(declaration.body, new Map(declaration.parameters.map((parameter) => [parameter.name, parameter.type.name])))
    visit(module.entryPoint.body, new Map())
  }

  /**
   * Rejects profile-looking comments outside a complete canonical generated program.
   * @param {CstNode} node - Current node.
   * @returns {void}
   */
  rejectScaffoldComments(node) {
    if (node.type == "comment" && /semantifold:|@semantifold/u.test(this.text(node))) this.fail(node, "unrecognized scaffold comment")
    for (const {node: child} of node.children) this.rejectScaffoldComments(child)
  }

  /**
   * Retains every scaffold comment and structural edge, ignoring only ordinary comments.
   * @param {CstNode} node - CST parent.
   * @returns {CstNode[]} Complete significant child list.
   */
  significant(node) {
    return node.children.map(({node: child}) => child).filter((child) =>
      child.type != "comment" || /semantifold:|@semantifold/u.test(this.text(child)))
  }

  /**
   * Verifies every token, field, type, use, ordering edge and consumer against the canonical plan.
   * This checks the original CST; it never recovers meaning from generated source text.
   * @param {CstNode} actual - Original tree node.
   * @param {CstNode} expected - Canonical tree node for the reconstructed semantics.
   * @param {CppReader} canonical - Canonical token reader.
   * @returns {void}
   */
  compareTree(actual, expected, canonical) {
    if (actual.type != expected.type || actual.named != expected.named || actual.extra != expected.extra) this.fail(actual, "generated scaffold node shape")
    const left = this.significant(actual)
    const right = canonical.significant(expected)

    if (left.length != right.length) this.fail(actual, "generated scaffold child count")
    if (!left.length && this.text(actual) != canonical.text(expected)) this.fail(actual, "generated scaffold token, type, order or consumer")
    left.forEach((child, index) => {
      if (actual.children.find((edge) => edge.node === child)?.field != expected.children.find((edge) => edge.node === right[index])?.field) this.fail(child, "generated scaffold field")
      this.compareTree(child, right[index], canonical)
    })
  }

  /**
   * Recognizes the shape of an inert generated unused-binding cast; canonical comparison checks its exact target and placement.
   * @param {CstNode} node - Candidate statement.
   * @returns {boolean} Whether this is a discard-shaped candidate.
   */
  discard(node) {
    return node.type == "expression_statement" && this.parts(node)[0]?.type == "cast_expression"
  }

  /**
   * Reconstructs paired statement regions before mandatory whole-CST canonical verification.
   * @param {CstNode[]} children - Ordered block children without braces or main cleanup.
   * @returns {Statement[]} Candidate semantic statements.
   */
  generatedStatements(children) {
    const nodes = children.filter((node) => node.type != "comment" || /semantifold:|@semantifold/u.test(this.text(node)))
    /** @type {Statement[]} */
    const statements = []
    let cursor = 0

    while (cursor < nodes.length && this.discard(nodes[cursor])) cursor++
    while (cursor < nodes.length) {
      const begin = nodes[cursor++]
      const match = begin.type == "comment" && /^\/\* semantifold:ordered-expression:cpp:v1 begin ([0-9]{6}) ([0-9a-f]{64}) \*\/$/u.exec(this.text(begin))

      if (!match) this.fail(begin, "complete ordered statement region required")
      const outer = this.temporaryExpressions
      const outerNames = this.temporaryNames

      this.temporaryExpressions = new Map()
      this.temporaryNames = new Set()
      while (cursor < nodes.length && this.temporaryDeclaration(nodes[cursor])) cursor = this.readTemporary(nodes, cursor)
      const consumer = nodes[cursor++]

      if (!consumer) this.fail(begin, "missing ordered consumer")
      const statement = this.statement(consumer)

      if (this.temporaryExpressions.size != 0) this.fail(consumer, "unconsumed ordered temporary")
      if (statement.kind == "LocalDeclaration" && nodes[cursor] && this.discard(nodes[cursor])) cursor++
      const end = nodes[cursor++]

      if (!end || end.type != "comment" || this.text(end) != `/* semantifold:ordered-expression:cpp:v1 end ${match[1]} ${match[2]} */`) this.fail(end ?? begin, "ordered marker pair")
      this.temporaryExpressions = outer
      this.temporaryNames = outerNames
      statements.push(statement)
    }
    return statements
  }

  /**
   * Identifies only a declaration at the current region level, without descendant searching.
   * @param {CstNode} node - Candidate node.
   * @returns {boolean} Whether the direct initialized name uses the reserved prefix.
   */
  temporaryDeclaration(node) {
    if (node.type != "declaration") return false
    const declarator = node.children.find(({field}) => field == "declarator")?.node
    const name = declarator?.children.find(({field}) => field == "declarator")?.node

    return name?.type == "identifier" && this.text(name).startsWith("semantifold_ordered_")
  }

  /**
   * Expands one candidate temporary, including its conditional RHS, retaining original operation tokens.
   * @param {CstNode[]} nodes - Current lexical sequence.
   * @param {number} cursor - Declaration position.
   * @returns {number} Next unconsumed position.
   */
  readTemporary(nodes, cursor) {
    const node = nodes[cursor++]
    const declarator = this.field(node, "declarator")
    const nameNode = this.field(declarator, "declarator")
    const name = this.text(nameNode)
    const type = this.field(node, "type")
    const value = this.field(declarator, "value")

    this.shape(node, [type, declarator, ";"])
    this.shape(declarator, [nameNode, "=", value])
    this.type(type)
    if (!/^semantifold_ordered_[0-9]{6}$/u.test(name) || this.temporaryNames?.has(name)) this.fail(nameNode, "ordered temporary declaration")
    this.temporaryNames?.add(name)
    let expression = this.expression(value)
    const branch = nodes[cursor]

    if (branch?.type == "if_statement" && ["identifier", "true", "false"].includes(value.type)) {
      const condition = this.field(branch, "condition")
      const body = this.field(branch, "consequence")

      this.shape(branch, ["if", condition, body])
      this.shape(condition, ["(", this.parts(condition)[1], ")"])
      const test = this.parts(condition)[1]
      const isOr = test.type == "unary_expression"
      const target = isOr ? this.field(test, "argument") : test

      if (target.type != "identifier" || this.text(target) != name) this.fail(target, "short-circuit temporary test")
      if (isOr) this.shape(test, ["!", target])
      if (body.type != "compound_statement") this.fail(body, "short-circuit block")
      const inside = this.significant(body).slice(1, -1)
      let offset = 0

      while (offset < inside.length && this.temporaryDeclaration(inside[offset])) offset = this.readTemporary(inside, offset)
      if (offset != inside.length - 1) this.fail(body, "short-circuit final write")
      const assignment = inside[offset]

      this.shape(assignment, ["assignment_expression", ";"])
      const assigned = this.parts(assignment)[0]
      const left = this.field(assigned, "left")
      const right = this.field(assigned, "right")

      this.shape(assigned, [left, "=", right])
      if (left.type != "identifier" || this.text(left) != name) this.fail(left, "short-circuit result write")
      this.shape(right, ["(", "binary_expression", ")"])
      const binary = this.parts(right)[1]
      const repeated = this.field(binary, "left")
      const operand = this.field(binary, "right")
      const operator = this.field(binary, "operator")

      this.shape(binary, [repeated, isOr ? "||" : "&&", operand])
      if (repeated.type != "identifier" || this.text(repeated) != name) this.fail(repeated, "short-circuit consumed value")
      expression = this.binary(node, isOr ? "Or" : "And", expression, this.expression(operand), operator)
      cursor++
    }
    this.temporaryExpressions?.set(name, expression)
    return cursor
  }
}

/**
 * Parses only the frozen legacy CST, with no source-text recovery path.
 * @param {{filename: string, source: string}} input - Exact caller source.
 * @returns {import("../semantic/types.js").SemanticModule} Parsed C++ semantics.
 */
export function parseCpp({filename, source}) {
  if (!hasOnlyUnicodeScalars(source)) {
    const coordinates = createCoordinateIndex(source)
    const offset = source.search(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "cpp", message: "CPP source contains a lone UTF-16 surrogate.",
      location: {filename, start: indexedPointAt(coordinates, offset), end: indexedPointAt(coordinates, offset + 1)}})
  }
  if (source.length > maximumCppSourceLength) {
    const coordinates = createCoordinateIndex(source)

    return unsupportedSyntax("cpp", "source exceeds the frozen CPP parser's 32767 UTF-16 input limit", {
      filename, start: indexedPointAt(coordinates, 0), end: indexedPointAt(coordinates, source.length)
    })
  }
  let snapshot

  try {
    snapshot = parseCppCst(source)
  } catch (error) {
    const coordinates = createCoordinateIndex(source)

    throw new SemantifoldDiagnostic({code: "PARSE_ERROR", language: "cpp",
      cause: error instanceof Error ? error : undefined, message: "The qualified CPP parser could not produce a complete CST.",
      location: {filename, start: indexedPointAt(coordinates, 0), end: indexedPointAt(coordinates, source.length)}})
  }
  const reader = new CppReader(filename, source)

  try {
    return reader.module(snapshot.root)
  } catch (error) {
    if (reader.generated && error instanceof SemantifoldDiagnostic && error.language == "cpp" &&
      error.code != "PARSE_ERROR" && error.code != "UNSUPPORTED_SYNTAX") {
      return unsupportedSyntax("cpp", `invalid generated ordered scaffold: ${error.code}`, error.location ?? reader.location(snapshot.root))
    }
    throw error
  }
}
