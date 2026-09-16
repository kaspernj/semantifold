// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {parseZigCst} from "../frontends/zig-parser.js"
import {validateNativeGraph} from "./native-validation.js"
import {emitScalarType} from "./scalars.js"
import {validateBackendModule} from "./shared.js"
import {SourceWriter} from "./writer.js"
import {zigBuild, zigRuntime} from "./zig-runtime.js"
import {maximumZigSourceLength, validateZigValues} from "./zig-validation.js"
import {collectZigBindingUsage} from "../zig-bindings.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").SemanticNode} SemanticNode */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").FunctionReturnTypeName} Scalar */

const operators = new Map([
  ["IntegerAdd", "semantifold_integer_add"], ["IntegerSubtract", "semantifold_integer_subtract"],
  ["IntegerMultiply", "semantifold_integer_multiply"], ["IntegerEqual", "=="], ["IntegerNotEqual", "!="],
  ["IntegerLessThan", "<"], ["IntegerLessThanOrEqual", "<="], ["IntegerGreaterThan", ">"], ["IntegerGreaterThanOrEqual", ">="],
  ["BooleanEqual", "=="], ["BooleanNotEqual", "!="], ["BooleanAnd", "and"], ["BooleanOr", "or"],
  ["StringConcat", "semantifold_string_concat"], ["StringEqual", "semantifold_string_equal"],
  ["StringNotEqual", "semantifold_string_not_equal"]
])

/**
 * Produces a deterministic dependency-free Zig 0.15.2 native project after complete preflight.
 * @param {{filename?: string, mapDirective?: unknown, module: SemanticModule, sourceMapFilename?: unknown, sources?: {filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} input - Artifact request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], target: string}} Candidate project.
 */
export function generateZigProject({filename, mapDirective, module, sourceMapFilename, sources}) {
  validateNativeGraph(module, "zig")
  validateBackendModule(module, "zig")
  validateZigValues(module)
  if (filename !== undefined && filename != "src/main.zig") unsupportedCapability("zig", "artifact filename other than src/main.zig", module.location)
  if (mapDirective !== undefined || sourceMapFilename !== undefined) unsupportedCapability("zig", "source-map filename or directive option", module.location)
  new ZigEmitter(module).program(module)
  const writer = new SourceWriter({filename: "src/main.zig", language: "zig", module, sources})

  new ZigEmitter(module, writer).program(module)
  const mapping = finalizeMapping(writer.finish())
  validateGeneratedZig(mapping.generated.content, module.location)
  const root = mapping.nodes.find(node => node.path == "")

  if (!root) throw new Error("Validated Zig module omitted root provenance.")
  const origin = root.origin
  const relatedOrigins = origin.kind == "source" ? [{location: origin.location, nodeId: root.id, role: "module", sourceId: origin.sourceId}] :
    (origin.kind == "derived" ? origin.origins : origin.relatedOrigins).map(item => ({...item, nodeId: item.nodeId ?? root.id, role: item.role ?? "module"}))

  return {target: "zig", artifacts: [{
    path: "build.zig", role: "manifest", ownership: "generated", contentKind: "text", mediaType: "text/x-zig", content: zigBuild,
    provenance: {kind: "synthetic", reason: "Fixed dependency-free Zig 0.15.2 native-host project with caller-selected Debug, ReleaseSafe, or ReleaseFast optimization.", relatedOrigins}
  }, {
    path: "src/main.zig", role: "entry", ownership: "generated", contentKind: "text", mediaType: "text/x-zig", content: mapping.generated.content,
    provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping)}
  }]}
}

/** Emits exact Zig support and Tasks 001-005 semantic occurrences. */
class ZigEmitter {
  /**
   * Creates a validation-only or writing emitter for one module.
   * @param {SemanticModule} module - Validated semantic module.
   * @param {SourceWriter} [writer] - Optional provenance-aware output writer.
   */
  constructor(module, writer) {
    this.writer = writer
    /** @type {Map<string, Scalar>} */
    this.functions = new Map(module.functions.map(declaration => [declaration.name, zigType(declaration.returnType, declaration.location)]))
    this.length = 0
    this.location = module.location
    this.usage = {reads: new Set(), writes: new Set()}
  }

  /**
   * Accounts for generated size before any text becomes observable.
   * @param {string} text - Text about to be emitted.
   * @param {SemanticNode} node - Owning semantic occurrence.
   */
  checkSize(text, node) {
    this.length += text.length
    if (this.length > maximumZigSourceLength) unsupportedCapability("zig", "generated source exceeds the 1000000 UTF-16 input limit", "location" in node ? node.location : this.location)
  }

  /**
   * Emits synthetic Zig syntax when a writer is present.
   * @param {string} text - Text to emit.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Canonical semantic path.
   * @param {string} [reason] - Synthetic provenance reason.
   */
  synthetic(text, node, path, reason = "Zig declaration and expression syntax") {
    this.checkSize(text, node)
    this.writer?.synthetic(text, reason, [node], [path])
  }

  /**
   * Emits an exact or anchored semantic occurrence when a writer is present.
   * @param {string} text - Text to emit.
   * @param {SemanticNode} node - Owning semantic node.
   * @param {string} path - Canonical semantic path.
   * @param {string} [role] - Exact parser-token role when available.
   */
  mapped(text, node, path, role) {
    this.checkSize(text, node)
    this.writer?.mapped(text, {mappingKind: role ? "exact" : "anchor", node, path, ...(role ? {role} : {})})
  }

  /**
   * Resolves the validated scalar result needed for output helper selection.
   * @param {Expression} expression - Semantic expression.
   * @param {Map<string, Scalar>} bindings - Visible binding types.
   * @returns {Scalar} Scalar result name.
   */
  type(expression, bindings) {
    if (expression.kind == "IntegerLiteral") return "integer"
    if (expression.kind == "BooleanLiteral") return "boolean"
    if (expression.kind == "StringLiteral") return "string"
    if (expression.kind == "UnaryExpression" || expression.kind == "BinaryExpression") return expression.type
    if (expression.kind != "CallExpression" && expression.kind != "IdentifierExpression") {
      return unsupportedCapability("zig", "collection expression reached scalar emission", expression.location)
    }
    const type = expression.kind == "CallExpression" ? this.functions.get(expression.callee) : bindings.get(expression.name)

    if (!type) throw new Error("Validated Zig expression lost its scalar type.")
    return type
  }

  /**
   * Validates or emits the complete deterministic entry source.
   * @param {SemanticModule} module - Semantic module to process.
   */
  program(module) {
    this.synthetic(zigRuntime, module, "", "Exact Zig arena, UTF-8, output, comparison, and checked-arithmetic support")
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
        this.mapped(emitScalarType("zig", parameter.type), parameter.type, `${parameterPath}/type`, "type")
      })
      this.synthetic(") ", declaration, path)
      this.mapped(emitScalarType("zig", declaration.returnType), declaration.returnType, `${path}/returnType`, "type")
      this.synthetic(" {\n", declaration, path)
      this.usage = collectZigBindingUsage(declaration.body)
      declaration.parameters.forEach((parameter, parameterIndex) => {
        const parameterPath = `${path}/parameters/${parameterIndex}`

        if (!this.usage.reads.has(parameter.name)) {
          this.synthetic("    _ = ", parameter, parameterPath, "Zig explicit unused-parameter scaffold")
          this.mapped(parameter.name, parameter, parameterPath, "name")
          this.synthetic(";\n", parameter, parameterPath, "Zig explicit unused-parameter scaffold")
        }
      })
      this.block(declaration.body, `${path}/body`, "    ", new Map(declaration.parameters.map(parameter => [parameter.name, zigType(parameter.type, parameter.location)])))
      this.synthetic("}\n", declaration, path)
    })
    this.usage = collectZigBindingUsage(module.entryPoint.body)
    this.synthetic("\npub fn main() void {\n    defer semantifold_arena.deinit();\n", module.entryPoint, "/entryPoint", "Zig generated entry and arena lifetime shell")
    this.block(module.entryPoint.body, "/entryPoint/body", "    ", new Map())
    this.synthetic("}\n", module.entryPoint, "/entryPoint", "Zig generated entry shell")
  }

  /**
   * Emits one lexical block and compiler-required binding scaffolds.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {string} path - Canonical block path.
   * @param {string} indent - Current output indentation.
   * @param {Map<string, Scalar>} inherited - Visible binding types.
   */
  block(block, path, indent, inherited) {
    const bindings = new Map(inherited)

    block.statements.forEach((statement, index) => {
      this.statement(statement, `${path}/statements/${index}`, indent, bindings)
      if (statement.kind == "LocalDeclaration") {
        bindings.set(statement.name, zigType(statement.type, statement.location))
        const unmutated = statement.mutable && !this.usage.writes.has(statement.name)
        const unread = !statement.mutable && !this.usage.reads.has(statement.name)

        if (unmutated || unread) {
          this.synthetic(indent + "_ = ", statement, `${path}/statements/${index}`, "Zig explicit local binding scaffold")
          if (unmutated) this.synthetic("&", statement, `${path}/statements/${index}`, "Zig explicit unmutated-var scaffold")
          this.mapped(statement.name, statement, `${path}/statements/${index}`, "name")
          this.synthetic(";\n", statement, `${path}/statements/${index}`, "Zig explicit local binding scaffold")
        }
      }
    })
  }

  /**
   * Emits one supported statement.
   * @param {import("../semantic/types.js").Statement} statement - Statement to emit.
   * @param {string} path - Canonical statement path.
   * @param {string} indent - Current output indentation.
   * @param {Map<string, Scalar>} bindings - Visible binding types.
   */
  statement(statement, path, indent, bindings) {
    this.synthetic(indent, statement, path, "indentation")
    if (statement.kind == "LocalDeclaration") {
      this.mapped(statement.mutable ? "var" : "const", statement, path)
      this.synthetic(" ", statement, path)
      this.mapped(statement.name, statement, path, "name")
      this.synthetic(": ", statement, path)
      this.mapped(emitScalarType("zig", statement.type), statement.type, `${path}/type`, "type")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
      this.expression(statement.initializer, `${path}/initializer`, bindings)
    } else if (statement.kind == "AssignmentStatement") {
      this.mapped(statement.target.name, statement.target, `${path}/target`, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
      this.expression(statement.expression, `${path}/expression`, bindings)
    } else if (statement.kind == "ReturnStatement") {
      this.mapped("return", statement, path)
      if (statement.expression) {
        this.synthetic(" ", statement, path)
        this.expression(statement.expression, `${path}/expression`, bindings)
      }
    } else if (statement.kind == "PrintStatement") {
      this.mapped(`semantifold_print_${this.type(statement.expression, bindings)}`, statement, path)
      this.synthetic("(", statement, path)
      this.expression(statement.expression, `${path}/expression`, bindings)
      this.synthetic(")", statement, path)
    } else if (statement.kind == "ExpressionStatement") {
      this.expression(statement.expression, `${path}/expression`, bindings)
    } else if (statement.kind == "IfStatement") {
      this.mapped("if", statement, path)
      this.synthetic(" (", statement, path)
      this.expression(statement.condition, `${path}/condition`, bindings)
      this.synthetic(") {\n", statement, path)
      this.block(statement.consequent, `${path}/consequent`, indent + "    ", bindings)
      this.synthetic(indent + "}", statement, path)
      if (statement.alternate) {
        this.mapped(" else", statement, path)
        this.synthetic(" {\n", statement, path)
        this.block(statement.alternate, `${path}/alternate`, indent + "    ", bindings)
        this.synthetic(indent + "}", statement, path)
      }
      this.synthetic("\n", statement, path)
      return
    } else throw new TypeError("Unsupported Zig statement reached emission after preflight.")
    this.synthetic(";\n", statement, path)
  }

  /**
   * Emits one scalar expression.
   * @param {Expression} expression - Expression to emit.
   * @param {string} path - Canonical expression path.
   * @param {Map<string, Scalar>} bindings - Visible binding types.
   * @returns {void} Text is emitted through the configured writer.
   */
  expression(expression, path, bindings) {
    if (expression.kind == "IdentifierExpression") this.mapped(expression.name, expression, path, "name")
    else if (expression.kind == "BooleanLiteral") this.mapped(String(expression.value), expression, path, "literal")
    else if (expression.kind == "IntegerLiteral") this.mapped(String(expression.value), expression, path, "literal")
    else if (expression.kind == "StringLiteral") this.mapped(zigString(expression.value), expression, path, "literal")
    else if (expression.kind == "CallExpression") {
      this.mapped(expression.callee, expression, path, "callee")
      this.synthetic("(", expression, path)
      expression.arguments.forEach((argument, index) => {
        if (index) this.synthetic(", ", expression, path)
        this.expression(argument, `${path}/arguments/${index}`, bindings)
      })
      this.synthetic(")", expression, path)
    } else if (expression.kind == "UnaryExpression") {
      if (expression.operation == "IntegerNegate") {
        this.mapped("semantifold_integer_negate", expression, path, "operator")
        this.synthetic("(", expression, path)
        this.expression(expression.operand, `${path}/operand`, bindings)
        this.synthetic(")", expression, path)
      } else {
        this.mapped("!", expression, path, "operator")
        this.synthetic("(", expression, path)
        this.expression(expression.operand, `${path}/operand`, bindings)
        this.synthetic(")", expression, path)
      }
    } else {
      if (expression.kind != "BinaryExpression") return unsupportedCapability("zig", "collection expression reached scalar emission", expression.location)
      const token = operators.get(expression.operation)

      if (!token) throw new Error("Unsupported operation passed Zig validation.")
      const helper = token.startsWith("semantifold_")

      if (helper) this.mapped(token, expression, path, "operator")
      this.synthetic("(", expression, path)
      this.expression(expression.left, `${path}/left`, bindings)
      if (helper) this.synthetic(", ", expression, path)
      else {
        this.synthetic(" ", expression, path)
        this.mapped(token, expression, path, "operator")
        this.synthetic(" ", expression, path)
      }
      this.expression(expression.right, `${path}/right`, bindings)
      this.synthetic(")", expression, path)
    }
  }
}

/**
 * Narrows an already validated semantic type to the Zig scalar cohort.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @param {import("../semantic/types.js").SourceLocation} location - Diagnostic location.
 * @returns {Scalar} Scalar type name.
 */
function zigType(type, location) {
  if (type.kind != "TypeReference") return unsupportedCapability("zig", "collection type reached scalar emission", location)
  return type.name
}

/**
 * Encodes a Unicode scalar string as a canonical Zig literal.
 * @param {string} value - Semantic string value.
 * @returns {string} Zig literal spelling.
 */
function zigString(value) {
  let literal = '"'

  for (const character of value) {
    const scalar = /** @type {number} */ (character.codePointAt(0))

    if (character == '"') literal += '\\"'
    else if (character == "\\") literal += "\\\\"
    else if (scalar < 32 || scalar == 127) literal += `\\x${scalar.toString(16).padStart(2, "0")}`
    else if (scalar == 0x2028 || scalar == 0x2029) literal += `\\u{${scalar.toString(16)}}`
    else literal += character
  }
  return literal + '"'
}

/**
 * Reparses the complete generated source and rejects recovery or excessive depth.
 * @param {string} source - Generated Zig source.
 * @param {import("../semantic/types.js").SourceLocation} location - Module diagnostic location.
 * @returns {void} Returns only after the complete CST is accepted.
 */
function validateGeneratedZig(source, location) {
  let snapshot

  try {
    snapshot = parseZigCst(source)
  } catch (error) {
    return unsupportedCapability("zig", `generated source could not be reparsed: ${error instanceof Error ? error.message : error}`, location)
  }
  /**
   * Validates one generated CST subtree.
   * @param {import("../frontends/zig-parser.js").CstNode} node - Current parser node.
   * @param {number} depth - Current nesting depth.
   */
  const visit = (node, depth) => {
    if (depth > 512 || node.error || node.missing || node.hasError) unsupportedCapability("zig", "generated source contains parser recovery or exceeds the CST depth limit", location)
    for (const {node: child} of node.children) visit(child, depth + 1)
  }

  visit(snapshot.root, 0)
}
