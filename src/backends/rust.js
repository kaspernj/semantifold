// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {validateBackendModule} from "./shared.js"
import {validateNativeGraph} from "./native-validation.js"
import {maximumRustSourceLength, validateRustValues} from "./rust-validation.js"
import {rustLockfile, rustManifest, rustRuntime} from "./rust-runtime.js"
import {emitScalarType} from "./scalars.js"
import {SourceWriter} from "./writer.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").SemanticNode} SemanticNode */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").SemanticTypeName} Scalar */

const operators = new Map([
  ["IntegerAdd", "semantifold_integer_add"], ["IntegerSubtract", "semantifold_integer_subtract"],
  ["IntegerMultiply", "semantifold_integer_multiply"], ["IntegerEqual", "=="], ["IntegerNotEqual", "!="],
  ["IntegerLessThan", "<"], ["IntegerLessThanOrEqual", "<="], ["IntegerGreaterThan", ">"], ["IntegerGreaterThanOrEqual", ">="],
  ["BooleanEqual", "=="], ["BooleanNotEqual", "!="], ["BooleanAnd", "&&"], ["BooleanOr", "||"],
  ["StringConcat", "+"], ["StringEqual", "=="], ["StringNotEqual", "!="]
])

/**
 * Produces a complete deterministic offline Cargo project after full validation and size preflight.
 * @param {{filename?: string, mapDirective?: unknown, module: SemanticModule, sourceMapFilename?: unknown, sources?: {filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} input - Artifact-set request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], target: string}} Complete candidate set.
 */
export function generateRustProject({filename, mapDirective, module, sourceMapFilename, sources}) {
  validateNativeGraph(module, "rust")
  validateBackendModule(module, "rust")
  validateRustValues(module)
  if (filename !== undefined && filename != "src/main.rs") unsupportedCapability("rust", "artifact filename other than src/main.rs", module.location)
  if (mapDirective !== undefined || sourceMapFilename !== undefined) unsupportedCapability("rust", "source-map filename or directive option", module.location)
  new RustEmitter(module).program(module)
  const writer = new SourceWriter({filename: "src/main.rs", language: "rust", module, sources})

  new RustEmitter(module, writer).program(module)
  const mapping = finalizeMapping(writer.finish())
  const root = mapping.nodes.find(node => node.path == "")

  if (!root) throw new Error("Validated Rust module omitted root provenance.")
  const origin = root.origin
  const relatedOrigins = origin.kind == "source" ? [{location: origin.location, nodeId: root.id, role: "module", sourceId: origin.sourceId}] :
    (origin.kind == "derived" ? origin.origins : origin.relatedOrigins).map(item => ({...item, nodeId: item.nodeId ?? root.id, role: item.role ?? "module"}))

  return {target: "rust", artifacts: [{
    path: "Cargo.toml", role: "manifest", ownership: "generated", contentKind: "text", mediaType: "text/plain", content: rustManifest,
    provenance: {kind: "synthetic", reason: "Fixed dependency-free edition-2021 Cargo package, Rust 1.98.1 minimum and matching dev/release abort/overflow profiles.", relatedOrigins}
  }, {
    path: "Cargo.lock", role: "support", ownership: "generated", contentKind: "text", mediaType: "text/plain", content: rustLockfile,
    provenance: {kind: "synthetic", reason: "Exact dependency-free format-4 lockfile generated and qualified with Cargo 1.98.1.", relatedOrigins}
  }, {
    path: "src/main.rs", role: "entry", ownership: "generated", contentKind: "text", mediaType: "text/x-rust", content: mapping.generated.content,
    provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping)}
  }]}
}

/** Emits native left-to-right expressions with explicit owned String copy boundaries. */
class RustEmitter {
  /**
   * Binds validated result types and an optional writer for the size-only preflight.
   * @param {SemanticModule} module - Complete validated semantics.
   * @param {SourceWriter} [writer] - Absent during size preflight.
   */
  constructor(module, writer) {
    this.writer = writer
    this.functions = new Map(module.functions.map(declaration => [declaration.name, declaration.returnType.name]))
    this.length = 0
    this.location = module.location
  }

  /**
   * Bounds exact source length before any public artifact or writer is exposed.
   * @param {string} text - Next text chunk.
   * @param {SemanticNode} node - Related semantic origin.
   * @returns {void}
   */
  checkSize(text, node) {
    this.length += text.length
    if (this.length > maximumRustSourceLength) unsupportedCapability("rust", "generated program exceeds the frozen Rust parser's 32767 UTF-16 input limit",
      "location" in node ? node.location : this.location)
  }

  /**
   * Emits target-owned syntax with explicit related semantic provenance.
   * @param {string} text - Rust syntax.
   * @param {SemanticNode} node - Related node.
   * @param {string} path - Semantic occurrence.
   * @param {string} [reason] - Synthetic syntax purpose.
   * @returns {void}
   */
  synthetic(text, node, path, reason = "Rust declaration and expression syntax") {
    this.checkSize(text, node)
    this.writer?.synthetic(text, reason, [node], [path])
  }

  /**
   * Emits an original semantic token or declaration anchor.
   * @param {string} text - Target token.
   * @param {SemanticNode} node - Original node.
   * @param {string} path - Occurrence path.
   * @param {string} [role] - Original parser role.
   * @returns {void}
   */
  mapped(text, node, path, role) {
    this.checkSize(text, node)
    this.writer?.mapped(text, {mappingKind: role ? "exact" : "anchor", node, path, ...(role ? {role} : {})})
  }

  /**
   * Resolves an already validated expression's native scalar representation.
   * @param {Expression} expression - Validated expression.
   * @param {Map<string, Scalar>} bindings - Lexical types.
   * @returns {Scalar} Result scalar.
   */
  type(expression, bindings) {
    if (expression.kind == "IntegerLiteral") return "integer"
    if (expression.kind == "BooleanLiteral") return "boolean"
    if (expression.kind == "StringLiteral") return "string"
    if (expression.kind == "UnaryExpression" || expression.kind == "BinaryExpression") return expression.type
    const type = expression.kind == "CallExpression" ? this.functions.get(expression.callee) : bindings.get(expression.name)

    if (!type) throw new Error("Validated Rust expression lost its scalar type.")
    return type
  }

  /**
   * Emits fixed support, crate-root functions and the parameterless entry point.
   * @param {SemanticModule} module - Validated module.
   * @returns {void}
   */
  program(module) {
    this.synthetic(rustRuntime, module, "", "Exact Rust scalar, print and overflow support")
    module.functions.forEach((declaration, index) => {
      const path = `/functions/${index}`

      this.synthetic("\n", declaration, path)
      this.mapped("fn", declaration, path)
      this.synthetic(" ", declaration, path)
      this.mapped(declaration.name, declaration, path, "name")
      this.synthetic("(", declaration, path)
      declaration.parameters.forEach((parameter, parameterIndex) => {
        const parameterPath = `${path}/parameters/${parameterIndex}`

        if (parameterIndex) this.synthetic(", ", parameter, parameterPath)
        this.mapped(parameter.name, parameter, parameterPath, "name")
        this.synthetic(": ", parameter, parameterPath)
        this.mapped(emitScalarType("rust", parameter.type), parameter.type, `${parameterPath}/type`, "type")
      })
      this.synthetic(") -> ", declaration, path)
      this.mapped(emitScalarType("rust", declaration.returnType), declaration.returnType, `${path}/returnType`, "type")
      this.synthetic(" {\n", declaration, path)
      this.block(declaration.body, `${path}/body`, "    ", new Map(declaration.parameters.map(parameter => [parameter.name, parameter.type.name])))
      this.synthetic("}\n", declaration, path)
    })
    this.synthetic("\nfn main() {\n", module.entryPoint, "/entryPoint")
    this.block(module.entryPoint.body, "/entryPoint/body", "    ", new Map())
    this.synthetic("}\n", module.entryPoint, "/entryPoint")
  }

  /**
   * Emits statements in order with independent branch binding environments.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {string} path - Occurrence path.
   * @param {string} indent - Current indentation.
   * @param {Map<string, Scalar>} inherited - Visible lexical types.
   * @param {number} [depth] - Exact generated CST block depth, root source file at zero.
   * @returns {void}
   */
  block(block, path, indent, inherited, depth = 2) {
    if (depth + 1 > 512) unsupportedCapability("rust", "generated Rust CST exceeds the 512-level traversal limit", block.location)
    const bindings = new Map(inherited)

    block.statements.forEach((statement, index) => {
      this.statement(statement, `${path}/statements/${index}`, indent, bindings, depth)
      if (statement.kind == "LocalDeclaration") bindings.set(statement.name, statement.type.name)
    })
  }

  /**
   * Emits one semantic statement, copying String values except for terminal owned returns.
   * @param {import("../semantic/types.js").Statement} statement - Statement.
   * @param {string} path - Occurrence path.
   * @param {string} indent - Indentation.
   * @param {Map<string, Scalar>} bindings - Visible types.
   * @param {number} depth - Enclosing generated CST block depth.
   * @returns {void}
   */
  statement(statement, path, indent, bindings, depth) {
    this.synthetic(indent, statement, path)
    if (statement.kind == "LocalDeclaration") {
      this.mapped(statement.mutable ? "let mut" : "let", statement, path)
      this.synthetic(" ", statement, path)
      this.mapped(statement.name, statement, path, "name")
      this.synthetic(": ", statement, path)
      this.mapped(emitScalarType("rust", statement.type), statement.type, `${path}/type`, "type")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
      this.expression(statement.initializer, `${path}/initializer`, bindings, true, depth + 2)
    } else if (statement.kind == "AssignmentStatement") {
      this.mapped(statement.target.name, statement.target, `${path}/target`, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
      this.expression(statement.expression, `${path}/expression`, bindings, true, depth + 3)
    } else if (statement.kind == "ReturnStatement") {
      this.mapped("return", statement, path)
      this.synthetic(" ", statement, path)
      this.expression(statement.expression, `${path}/expression`, bindings, false, depth + 3)
    } else if (statement.kind == "PrintStatement") {
      this.mapped(`semantifold_print_${this.type(statement.expression, bindings)}`, statement, path)
      this.synthetic("(", statement, path)
      this.expression(statement.expression, `${path}/expression`, bindings, true, depth + 4)
      this.synthetic(")", statement, path)
    } else {
      this.mapped("if", statement, path)
      this.synthetic(" ", statement, path)
      this.expression(statement.condition, `${path}/condition`, bindings, true, depth + 3)
      this.synthetic(" {\n", statement, path)
      this.block(statement.consequent, `${path}/consequent`, indent + "    ", bindings, depth + 3)
      this.synthetic(indent + "}", statement, path)
      if (statement.alternate) {
        this.mapped(" else ", statement, path)
        this.synthetic("{\n", statement, path)
        this.block(statement.alternate, `${path}/alternate`, indent + "    ", bindings, depth + 4)
        this.synthetic(indent + "}", statement, path)
      }
      this.synthetic("\n", statement, path)
      return
    }
    this.synthetic(";\n", statement, path)
  }

  /**
   * Emits ordinary Rust left-to-right and short-circuit expressions without temporary reordering.
   * @param {Expression} expression - Expression occurrence.
   * @param {string} path - Occurrence path.
   * @param {Map<string, Scalar>} bindings - Lexical types.
   * @param {boolean} [copy] - Whether an identifier crosses an owned value-copy boundary.
   * @param {number} [depth] - Exact generated CST expression depth.
   * @returns {void}
   */
  expression(expression, path, bindings, copy = true, depth = 0) {
    const leafDepth = expression.kind == "StringLiteral" ? 3 : expression.kind == "IdentifierExpression" && copy && this.type(expression, bindings) == "string" ? 2 :
      expression.kind == "BooleanLiteral" ? 1 : 0

    if (depth + leafDepth > 512) unsupportedCapability("rust", "generated Rust CST exceeds the 512-level traversal limit", expression.location)
    if (expression.kind == "IdentifierExpression") {
      this.mapped(expression.name, expression, path, "name")
      if (copy && this.type(expression, bindings) == "string") this.synthetic(".clone()", expression, path, "Owned String value copy")
    } else if (expression.kind == "BooleanLiteral") this.mapped(String(expression.value), expression, path, "literal")
    else if (expression.kind == "IntegerLiteral") {
      this.mapped(String(expression.value), expression, path, "literal")
      this.synthetic("i64", expression, path, "Exact signed-64-bit scalar suffix")
    } else if (expression.kind == "StringLiteral") {
      this.synthetic("String::from(", expression, path, "Owned UTF-8 String construction")
      let literal = '"'

      for (const character of expression.value) {
        const codePoint = /** @type {number} */ (character.codePointAt(0))

        if (character == '"') literal += '\\"'
        else if (character == "\\") literal += "\\\\"
        else if (codePoint < 32 || codePoint == 127 || codePoint == 0x2028 || codePoint == 0x2029) literal += `\\u{${codePoint.toString(16)}}`
        else literal += character
      }
      this.mapped(literal + '"', expression, path, "literal")
      this.synthetic(")", expression, path, "Owned UTF-8 String construction")
    } else if (expression.kind == "CallExpression") {
      this.mapped(expression.callee, expression, path, "callee")
      this.synthetic("(", expression, path)
      expression.arguments.forEach((argument, index) => {
        if (index) this.synthetic(", ", expression, path)
        this.expression(argument, `${path}/arguments/${index}`, bindings, true, depth + 2)
      })
      this.synthetic(")", expression, path)
    } else if (expression.kind == "UnaryExpression") {
      this.mapped(expression.operation == "IntegerNegate" ? "semantifold_integer_negate" : "!", expression, path, "operator")
      this.synthetic("(", expression, path)
      this.expression(expression.operand, `${path}/operand`, bindings, true, depth + 2)
      this.synthetic(")", expression, path)
    } else {
      const token = operators.get(expression.operation)

      if (!token) throw new Error("Unsupported operation passed Rust validation.")
      const helper = token.startsWith("semantifold_")
      const comparison = expression.operation == "StringEqual" || expression.operation == "StringNotEqual"

      if (helper) this.mapped(token, expression, path, "operator")
      this.synthetic("(", expression, path)
      this.expression(expression.left, `${path}/left`, bindings, !comparison, depth + 2)
      if (helper) this.synthetic(", ", expression, path)
      else {
        this.synthetic(" ", expression, path)
        this.mapped(token, expression, path, "operator")
        this.synthetic(" ", expression, path)
      }
      if (expression.operation == "StringConcat") this.synthetic("&(", expression.right, `${path}/right`, "Borrowed String concatenation operand")
      this.expression(expression.right, `${path}/right`, bindings, !comparison && expression.operation != "StringConcat",
        depth + (expression.operation == "StringConcat" ? 4 : 2))
      if (expression.operation == "StringConcat") this.synthetic(")", expression.right, `${path}/right`, "Borrowed String concatenation operand")
      this.synthetic(")", expression, path)
    }
  }
}
