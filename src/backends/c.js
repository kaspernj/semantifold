// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {statementSignature, planNativeModule} from "./ordered-expressions.js"
import {cRuntimeHeader} from "./c-runtime.js"
import {maximumCSourceLength, validateCMemory} from "./c-validation.js"
import {validateNativeGraph} from "./native-validation.js"
import {emitScalarType} from "./scalars.js"
import {validateBackendModule} from "./shared.js"
import {SourceWriter} from "./writer.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").SemanticNode} SemanticNode */
/** @typedef {import("../semantic/types.js").Statement} Statement */
/** @typedef {import("../semantic/types.js").Block} Block */
/** @typedef {import("./ordered-expressions.js").PlannedValue} PlannedValue */
/** @typedef {import("./ordered-expressions.js").PlannedStep} PlannedStep */
/** @typedef {{id: string, steps: PlannedStep[], value: PlannedValue}} StatementPlan */

const binaryTokens = new Map([
  ["IntegerAdd", "semantifold_integer_add"], ["IntegerSubtract", "semantifold_integer_subtract"],
  ["IntegerMultiply", "semantifold_integer_multiply"], ["StringConcat", "semantifold_string_concat"],
  ["StringEqual", "semantifold_string_equal"], ["StringNotEqual", "semantifold_string_not_equal"],
  ["IntegerEqual", "=="], ["IntegerNotEqual", "!="], ["BooleanEqual", "=="], ["BooleanNotEqual", "!="],
  ["IntegerLessThan", "<"], ["IntegerLessThanOrEqual", "<="],
  ["IntegerGreaterThan", ">"], ["IntegerGreaterThanOrEqual", ">="]
])

/**
 * Produces a fully validated, deterministic C17 translation unit and owned support header.
 * @param {{filename?: string, mapDirective?: unknown, module: SemanticModule, sourceMapFilename?: unknown, sources?: {filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} input - Backend request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], target: string}} Complete candidate.
 */
export function generateCProgram({filename, mapDirective, module, sourceMapFilename, sources}) {
  validateNativeGraph(module)
  validateBackendModule(module, "c")
  validateCMemory(module)
  if (filename !== undefined && filename != "program.c") unsupportedCapability("c", "artifact filename other than program.c", module.location)
  if (mapDirective !== undefined || sourceMapFilename !== undefined) unsupportedCapability("c", "source-map filename or directive option", module.location)
  const plans = planNativeModule(module)

  new CEmitter(undefined, plans, module.location).program(module)
  const writer = new SourceWriter({filename: "program.c", language: "c", module, sources})
  const emitter = new CEmitter(writer, plans, module.location)

  emitter.program(module)
  const mapping = finalizeMapping(writer.finish())
  const root = mapping.nodes.find(({path}) => path == "")

  if (!root) throw new Error("Validated C module omitted its root provenance.")
  const relatedOrigins = root.origin.kind == "source"
    ? [{location: root.origin.location, nodeId: root.id, role: "module", sourceId: root.origin.sourceId}]
    : (root.origin.kind == "derived" ? root.origin.origins : root.origin.relatedOrigins).map((origin) =>
      ({...origin, nodeId: origin.nodeId ?? root.id, role: origin.role ?? "module"}))

  return {target: "c", artifacts: [{
    content: mapping.generated.content, contentKind: "text", mediaType: "text/x-c", ownership: "generated", path: "program.c",
    provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping)}, role: "entry"
  }, {
    content: cRuntimeHeader, contentKind: "text", mediaType: "text/x-c", ownership: "generated", path: "semantifold_runtime.h",
    provenance: {kind: "synthetic", reason: "Canonical C17 scalar helpers and module-lifetime immutable UTF-8 arena.", relatedOrigins}, role: "support"
  }]}
}

/** Writes only target syntax from validated semantic occurrences and private plans. */
class CEmitter {
  /**
   * Binds the writer and complete plan.
   * @param {SourceWriter | undefined} writer - Provenance writer; omitted for exact size preflight.
   * @param {Map<string, StatementPlan>} plans - Validated occurrence plans.
   * @param {import("../semantic/types.js").SourceLocation} location - Root diagnostic location.
   */
  constructor(writer, plans, location) {
    this.writer = writer
    this.plans = plans
    this.location = location
    this.length = 0
  }

  /**
   * Writes generated scaffold with a related semantic origin.
   * @param {string} text - C syntax.
   * @param {SemanticNode} node - Related node.
   * @param {string} path - Occurrence path.
   * @returns {void}
   */
  synthetic(text, node, path) {
    this.checkSize(text, node)
    this.writer?.synthetic(text, "C17 ordered-expression and lifetime scaffold", [node], [path])
  }

  /**
   * Writes an original semantic token or anchor.
   * @param {string} text - Target token.
   * @param {SemanticNode} node - Original node.
   * @param {string} path - Occurrence path.
   * @param {string} [role] - Parser token role.
   * @returns {void}
   */
  mapped(text, node, path, role) {
    this.checkSize(text, node)
    this.writer?.mapped(text, {mappingKind: role ? "exact" : "anchor", node, path, ...(role ? {role} : {})})
  }

  /**
   * Bounds private emission before any artifact can escape the parser's proven input profile.
   * @param {string} text - Next exact output chunk.
   * @param {SemanticNode} node - Related semantic occurrence.
   * @returns {void}
   */
  checkSize(text, node) {
    this.length += text.length
    if (this.length > maximumCSourceLength) unsupportedCapability("c", "generated program exceeds the frozen C parser's 32767 UTF-16 input limit",
      "location" in node ? node.location : this.location)
  }

  /**
   * Emits canonical prototypes, definitions, and the cleanup-owning main.
   * @param {SemanticModule} module - Semantic module.
   * @returns {void}
   */
  program(module) {
    this.synthetic('/* semantifold:program:c:v1 */\n#include "semantifold_runtime.h"\n\n', module, "")
    module.functions.forEach((declaration, index) => {
      const parameters = declaration.parameters.map((parameter) => `${emitScalarType("c", parameter.type)} ${parameter.name}`).join(", ")

      this.synthetic(`static ${emitScalarType("c", declaration.returnType)} ${declaration.name}(${parameters});\n`, declaration, `/functions/${index}`)
    })
    module.functions.forEach((declaration, index) => {
      const path = `/functions/${index}`

      this.synthetic("\nstatic ", declaration, path)
      this.mapped(emitScalarType("c", declaration.returnType), declaration.returnType, `${path}/returnType`, "type")
      this.synthetic(" ", declaration, path)
      this.mapped(declaration.name, declaration, path, "name")
      this.synthetic("(", declaration, path)
      declaration.parameters.forEach((parameter, parameterIndex) => {
        const parameterPath = `${path}/parameters/${parameterIndex}`

        if (parameterIndex) this.synthetic(", ", parameter, parameterPath)
        this.mapped(emitScalarType("c", parameter.type), parameter.type, `${parameterPath}/type`, "type")
        this.synthetic(" ", parameter, parameterPath)
        this.mapped(parameter.name, parameter, parameterPath, "name")
      })
      this.synthetic(") {\n", declaration, path)
      declaration.parameters.forEach((parameter, parameterIndex) => this.synthetic(`    (void)${parameter.name};\n`, parameter, `${path}/parameters/${parameterIndex}`))
      this.block(declaration.body, `${path}/body`, "    ")
      this.synthetic("}\n", declaration, path)
    })
    this.synthetic("\nint main(void) {\n", module.entryPoint, "/entryPoint")
    module.functions.forEach((declaration, index) => this.synthetic(`    (void)${declaration.name};\n`, declaration, `/functions/${index}`))
    this.block(module.entryPoint.body, "/entryPoint/body", "    ")
    this.synthetic("    semantifold_cleanup();\n    return 0;\n}\n", module.entryPoint, "/entryPoint")
  }

  /**
   * Emits statements in semantic source order.
   * @param {Block} block - Semantic block.
   * @param {string} path - Occurrence path.
   * @param {string} indent - Current indentation.
   * @returns {void}
   */
  block(block, path, indent) {
    block.statements.forEach((statement, index) => this.statement(statement, `${path}/statements/${index}`, indent))
  }

  /**
   * Emits one paired region with a pure final consumer.
   * @param {Statement} statement - Original statement.
   * @param {string} path - Occurrence path.
   * @param {string} indent - Current indentation.
   * @returns {void}
   */
  statement(statement, path, indent) {
    const plan = this.plans.get(path)

    if (!plan) throw new Error("Missing validated C statement plan.")
    const marker = `semantifold:ordered-expression:c:v1`
    const signature = statementSignature(statement)

    this.synthetic(`${indent}/* ${marker} begin ${plan.id} ${signature} */\n`, statement, path)
    this.steps(plan.steps, indent)
    this.synthetic(indent, statement, path)
    if (statement.kind == "LocalDeclaration") {
      if (!statement.mutable) this.synthetic("const ", statement, path)
      this.mapped(emitScalarType("c", statement.type), statement.type, `${path}/type`, "type")
      this.synthetic(" ", statement, path)
      this.mapped(statement.name, statement, path, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
    } else if (statement.kind == "AssignmentStatement") {
      this.mapped(statement.target.name, statement.target, `${path}/target`, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
    } else if (statement.kind == "ReturnStatement") this.mapped("return ", statement, path)
    else if (statement.kind == "PrintStatement") this.mapped(`semantifold_print_${plan.value.type}(`, statement, path)
    else this.mapped("if (", statement, path)
    this.value(plan.value)
    if (statement.kind == "IfStatement") {
      this.synthetic(") {\n", statement, path)
      this.block(statement.consequent, `${path}/consequent`, `${indent}    `)
      this.synthetic(`${indent}}`, statement, path)
      if (statement.alternate) {
        this.mapped(" else ", statement, path)
        this.synthetic("{\n", statement, path)
        this.block(statement.alternate, `${path}/alternate`, `${indent}    `)
        this.synthetic(`${indent}}`, statement, path)
      }
      this.synthetic("\n", statement, path)
    } else {
      this.synthetic(`${statement.kind == "PrintStatement" ? ")" : ""};\n`, statement, path)
      if (statement.kind == "LocalDeclaration") this.synthetic(`${indent}(void)${statement.name};\n`, statement, path)
    }
    this.synthetic(`${indent}/* ${marker} end ${plan.id} ${signature} */\n`, statement, path)
  }

  /**
   * Emits each eager step or conditional RHS at its planned location.
   * @param {PlannedStep[]} steps - Ordered private steps.
   * @param {string} indent - Current indentation.
   * @returns {void}
   */
  steps(steps, indent) {
    for (const step of steps) {
      const {result, operands, rightSteps} = step
      const {expression, path, name} = result
      const type = emitScalarType("c", {kind: "TypeReference", name: result.type})

      this.synthetic(`${indent}${type} ${name} = `, expression, path)
      if (rightSteps) {
        this.value(operands[0])
        this.synthetic(`;\n${indent}if (`, expression, path)
        if (expression.kind != "BinaryExpression") throw new Error("Invalid conditional C plan.")
        this.synthetic(`${expression.operation == "BooleanOr" ? "!" : ""}${name}) {\n`, expression, path)
        this.steps(rightSteps, `${indent}    `)
        this.synthetic(`${indent}    ${name} = (${name} `, expression, path)
        this.mapped(expression.operation == "BooleanOr" ? "||" : "&&", expression, path, "operator")
        this.synthetic(" ", expression, path)
        this.value(operands[1])
        this.synthetic(`);\n${indent}}\n`, expression, path)
      } else {
        this.operation(step)
        this.synthetic(";\n", expression, path)
      }
    }
  }

  /**
   * Emits one nontrivial operation with pure operands.
   * @param {PlannedStep} step - Eager step.
   * @returns {void}
   */
  operation({result: {expression, path}, operands}) {
    if (expression.kind == "CallExpression") {
      this.mapped(expression.callee, expression, path, "callee")
      this.synthetic("(", expression, path)
      operands.forEach((operand, index) => {
        if (index) this.synthetic(", ", expression, path)
        this.value(operand)
      })
      this.synthetic(")", expression, path)
    } else if (expression.kind == "UnaryExpression") {
      this.mapped(expression.operation == "IntegerNegate" ? "semantifold_integer_negate" : "!", expression, path, "operator")
      this.synthetic("(", expression, path)
      this.value(operands[0])
      this.synthetic(")", expression, path)
    } else if (expression.kind == "BinaryExpression") {
      const token = binaryTokens.get(expression.operation)

      if (!token) throw new Error("Unsupported operation passed C planning.")
      const helper = token.startsWith("semantifold_")

      if (helper) this.mapped(token, expression, path, "operator")
      this.synthetic("(", expression, path)
      this.value(operands[0])
      if (helper) this.synthetic(", ", expression, path)
      else {
        this.synthetic(" ", expression, path)
        this.mapped(token, expression, path, "operator")
        this.synthetic(" ", expression, path)
      }
      this.value(operands[1])
      this.synthetic(")", expression, path)
    } else throw new Error("Pure expression was scheduled as a C operation.")
  }

  /**
   * Emits a pure operand with original token provenance or a synthetic temporary use.
   * @param {PlannedValue} value - Planned pure operand.
   * @returns {void}
   */
  value({expression, path, name}) {
    if (name) return this.synthetic(name, expression, path)
    if (expression.kind == "IdentifierExpression") return this.mapped(expression.name, expression, path, "name")
    if (expression.kind == "BooleanLiteral") return this.mapped(String(expression.value), expression, path, "literal")
    if (expression.kind == "IntegerLiteral") return this.mapped(`INT64_C(${expression.value})`, expression, path, "literal")
    if (expression.kind == "StringLiteral") {
      const bytes = new TextEncoder().encode(expression.value)
      const literal = Array.from(bytes, (byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("")

      return this.mapped(`SEMANTIFOLD_STRING("${literal}")`, expression, path, "literal")
    }
    throw new Error("Unsequenced expression passed C planning.")
  }
}
