// @ts-check

import {createHash} from "node:crypto"
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
/** @typedef {import("../semantic/types.js").Statement} Statement */
/** @typedef {import("../semantic/types.js").FunctionReturnTypeName} Scalar */
/** @typedef {{expression: Expression, path: string, type: Scalar, name?: string}} ZigPlannedValue */
/** @typedef {{result: ZigPlannedValue, operands: ZigPlannedValue[], rightSteps?: ZigPlannedStep[]}} ZigPlannedStep */
/** @typedef {{id: string, steps: ZigPlannedStep[], terminal?: ZigPlannedStep, value?: ZigPlannedValue}} ZigStatementPlan */

const operators = new Map([
  ["IntegerAdd", "semantifold_integer_add"], ["IntegerSubtract", "semantifold_integer_subtract"],
  ["IntegerMultiply", "semantifold_integer_multiply"], ["IntegerEqual", "=="], ["IntegerNotEqual", "!="],
  ["IntegerLessThan", "<"], ["IntegerLessThanOrEqual", "<="], ["IntegerGreaterThan", ">"], ["IntegerGreaterThanOrEqual", ">="],
  ["BooleanEqual", "=="], ["BooleanNotEqual", "!="], ["BooleanAnd", "and"], ["BooleanOr", "or"],
  ["StringConcat", "semantifold_string_concat"], ["StringEqual", "semantifold_string_equal"],
  ["StringNotEqual", "semantifold_string_not_equal"]
])

/** Plans scalar operations by occurrence without rewriting caller-owned semantic values. */
class ZigExpressionPlanner {
  /**
   * Creates a planner for one validated scalar module.
   * @param {SemanticModule} module - Validated module.
   */
  constructor(module) {
    this.functions = new Map(module.functions.map(declaration => [declaration.name, zigType(declaration.returnType, declaration.location)]))
    this.nextTemporary = 1
  }

  /**
   * Resolves one already-validated expression type.
   * @param {Expression} expression - Expression occurrence.
   * @param {Map<string, Scalar>} bindings - Visible scalar bindings.
   * @returns {Scalar} Exact result type.
   */
  type(expression, bindings) {
    if (expression.kind == "IntegerLiteral") return "integer"
    if (expression.kind == "BooleanLiteral") return "boolean"
    if (expression.kind == "StringLiteral") return "string"
    if (expression.kind == "UnaryExpression" || expression.kind == "BinaryExpression") return expression.type
    if (expression.kind != "CallExpression" && expression.kind != "IdentifierExpression") {
      return unsupportedCapability("zig", "collection expression reached scalar planning", expression.location)
    }
    const type = expression.kind == "CallExpression" ? this.functions.get(expression.callee) : bindings.get(expression.name)

    if (!type) return unsupportedCapability("zig", "unresolved expression type", expression.location)
    return type
  }

  /**
   * Plans one value expression in semantic left-to-right order.
   * @param {Expression} expression - Expression occurrence.
   * @param {string} path - Canonical occurrence path.
   * @param {Map<string, Scalar>} bindings - Visible scalar bindings.
   * @param {ZigPlannedStep[]} steps - Ordered enclosing prelude.
   * @returns {ZigPlannedValue} Pure final value.
   */
  plan(expression, path, bindings, steps) {
    const result = {expression, path, type: this.type(expression, bindings)}

    if (!["CallExpression", "UnaryExpression", "BinaryExpression"].includes(expression.kind)) return result
    const operands = []
    /** @type {ZigPlannedStep[] | undefined} */
    let rightSteps

    if (expression.kind == "CallExpression") {
      for (const [index, argument] of expression.arguments.entries()) operands.push(this.plan(argument, `${path}/arguments/${index}`, bindings, steps))
    } else if (expression.kind == "UnaryExpression") operands.push(this.plan(expression.operand, `${path}/operand`, bindings, steps))
    else if (expression.kind == "BinaryExpression") {
      operands.push(this.plan(expression.left, `${path}/left`, bindings, steps))
      if (expression.operation == "BooleanAnd" || expression.operation == "BooleanOr") {
        const planned = {...result, name: this.allocate(expression)}

        rightSteps = []
        operands.push(this.plan(expression.right, `${path}/right`, bindings, rightSteps))
        steps.push({operands, result: planned, rightSteps})
        return planned
      }
      operands.push(this.plan(expression.right, `${path}/right`, bindings, steps))
    }
    if (result.type == "void") throw new Error("Void Zig call reached value planning.")
    const planned = {...result, name: this.allocate(expression)}

    steps.push({operands, result: planned})
    return planned
  }

  /**
   * Plans the arguments of one terminal void call without inventing a void temporary.
   * @param {Expression} expression - Terminal expression occurrence.
   * @param {string} path - Canonical occurrence path.
   * @param {Map<string, Scalar>} bindings - Visible scalar bindings.
   * @param {ZigPlannedStep[]} steps - Ordered enclosing prelude.
   * @returns {ZigPlannedStep} Terminal direct-call step.
   */
  terminal(expression, path, bindings, steps) {
    if (expression.kind != "CallExpression" || this.type(expression, bindings) != "void") {
      throw new Error("Non-void expression reached Zig terminal-call planning.")
    }
    const result = {expression, path, type: /** @type {const} */ ("void")}
    const operands = expression.arguments.map((argument, index) => this.plan(argument, `${path}/arguments/${index}`, bindings, steps))

    return {operands, result}
  }

  /**
   * Allocates one bounded deterministic occurrence name.
   * @param {Expression} expression - Related semantic occurrence.
   * @returns {string} Reserved occurrence name.
   */
  allocate(expression) {
    if (this.nextTemporary > 999999) return unsupportedCapability("zig", "ordered-expression occurrence limit", expression.location)
    return `semantifold_ordered_${String(this.nextTemporary++).padStart(6, "0")}`
  }
}

/**
 * Plans every Zig statement before writer construction or artifact exposure.
 * @param {SemanticModule} module - Validated module.
 * @returns {Map<string, ZigStatementPlan>} Plans by semantic occurrence path.
 */
function planZigModule(module) {
  const planner = new ZigExpressionPlanner(module)
  /** @type {Map<string, ZigStatementPlan>} */
  const plans = new Map()
  /**
   * Plans one lexical block with independent branch environments.
   * @param {import("../semantic/types.js").Block} block - Block to plan.
   * @param {string} path - Canonical block path.
   * @param {Map<string, Scalar>} inherited - Visible scalar bindings.
   */
  const visit = (block, path, inherited) => {
    const bindings = new Map(inherited)

    block.statements.forEach((statement, index) => {
      const statementPath = `${path}/statements/${index}`
      const field = statement.kind == "IfStatement" ? "condition" : statement.kind == "LocalDeclaration" ? "initializer" : "expression"
      const expression = statement.kind == "IfStatement" ? statement.condition : statement.kind == "LocalDeclaration" ? statement.initializer :
        statement.kind == "AssignmentStatement" || statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ? statement.expression :
          statement.kind == "ReturnStatement" ? statement.expression : undefined
      /** @type {ZigPlannedStep[]} */
      const steps = []
      /** @type {ZigStatementPlan} */
      const plan = {id: String(plans.size + 1).padStart(6, "0"), steps}

      if (statement.kind == "ExpressionStatement") plan.terminal = planner.terminal(statement.expression, `${statementPath}/${field}`, bindings, steps)
      else if (expression) plan.value = planner.plan(expression, `${statementPath}/${field}`, bindings, steps)
      plans.set(statementPath, plan)
      if (statement.kind == "LocalDeclaration") bindings.set(statement.name, zigType(statement.type, statement.location))
      if (statement.kind == "IfStatement") {
        visit(statement.consequent, `${statementPath}/consequent`, bindings)
        if (statement.alternate) visit(statement.alternate, `${statementPath}/alternate`, bindings)
      }
    })
  }

  module.functions.forEach((declaration, index) => visit(declaration.body, `/functions/${index}/body`,
    new Map(declaration.parameters.map(parameter => [parameter.name, zigType(parameter.type, parameter.location)]))))
  visit(module.entryPoint.body, "/entryPoint/body", new Map())
  return plans
}

/**
 * Binds an ordered region to its exact semantic consumer and expression.
 * @param {Statement} statement - Semantic statement occurrence.
 * @returns {string} Stable scaffold signature.
 */
function zigStatementSignature(statement) {
  const consumer = statement.kind == "LocalDeclaration" ? [statement.kind, statement.name,
    zigType(statement.type, statement.location), statement.mutable] :
    statement.kind == "AssignmentStatement" ? [statement.kind, statement.target.name] : [statement.kind]
  const expression = statement.kind == "IfStatement" ? statement.condition : statement.kind == "LocalDeclaration" ? statement.initializer :
    statement.kind == "AssignmentStatement" || statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ? statement.expression :
      statement.kind == "ReturnStatement" ? statement.expression : undefined

  return createHash("sha256").update(JSON.stringify([consumer, expression ? zigExpressionSignature(expression) : null])).digest("hex")
}

/**
 * Serializes only the closed semantic expression fields.
 * @param {Expression} expression - Closed scalar expression.
 * @returns {unknown[]} Stable signature data.
 */
function zigExpressionSignature(expression) {
  if (expression.kind == "IdentifierExpression") return [expression.kind, expression.name]
  if (expression.kind == "IntegerLiteral" || expression.kind == "BooleanLiteral" || expression.kind == "StringLiteral") {
    return [expression.kind, expression.value]
  }
  if (expression.kind == "CallExpression") return [expression.kind, expression.callee, ...expression.arguments.map(zigExpressionSignature)]
  if (expression.kind == "UnaryExpression") return [expression.kind, expression.operation, expression.type, zigExpressionSignature(expression.operand)]
  if (expression.kind == "BinaryExpression") {
    return [expression.kind, expression.operation, expression.type, zigExpressionSignature(expression.left), zigExpressionSignature(expression.right)]
  }
  return [expression.kind]
}

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
    this.plans = planZigModule(module)
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
   * Validates or emits the complete deterministic entry source.
   * @param {SemanticModule} module - Semantic module to process.
   */
  program(module) {
    this.synthetic(zigRuntime, module, "", "Exact Zig arena, UTF-8, output, comparison, and checked-arithmetic support")
    this.synthetic("// semantifold:program:zig:v1\n", module, "", "Exact generated Zig ordered-expression profile marker")
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
      this.block(declaration.body, `${path}/body`, "    ")
      this.synthetic("}\n", declaration, path)
    })
    this.usage = collectZigBindingUsage(module.entryPoint.body)
    this.synthetic("\npub fn main() void {\n    defer semantifold_arena.deinit();\n", module.entryPoint, "/entryPoint", "Zig generated entry and arena lifetime shell")
    this.block(module.entryPoint.body, "/entryPoint/body", "    ")
    this.synthetic("}\n", module.entryPoint, "/entryPoint", "Zig generated entry shell")
  }

  /**
   * Emits one lexical block and compiler-required binding scaffolds.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {string} path - Canonical block path.
   * @param {string} indent - Current output indentation.
   */
  block(block, path, indent) {
    block.statements.forEach((statement, index) => {
      this.statement(statement, `${path}/statements/${index}`, indent)
    })
  }

  /**
   * Emits one complete paired ordered region and its pure final consumer.
   * @param {import("../semantic/types.js").Statement} statement - Statement to emit.
   * @param {string} path - Canonical statement path.
   * @param {string} indent - Current output indentation.
   */
  statement(statement, path, indent) {
    const plan = this.plans.get(path)

    if (!plan) throw new Error("Missing validated Zig statement plan.")
    const marker = "semantifold:ordered-expression:zig:v1"
    const signature = zigStatementSignature(statement)

    this.synthetic(`${indent}// ${marker} begin ${plan.id} ${signature}\n`, statement, path, "Zig ordered-expression region marker")
    this.steps(plan.steps, indent)
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
      this.value(requiredPlanValue(plan, statement))
    } else if (statement.kind == "AssignmentStatement") {
      this.mapped(statement.target.name, statement.target, `${path}/target`, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
      this.value(requiredPlanValue(plan, statement))
    } else if (statement.kind == "ReturnStatement") {
      this.mapped("return", statement, path)
      if (statement.expression) {
        this.synthetic(" ", statement, path)
        this.value(requiredPlanValue(plan, statement))
      }
    } else if (statement.kind == "PrintStatement") {
      const value = requiredPlanValue(plan, statement)

      this.mapped(`semantifold_print_${value.type}`, statement, path)
      this.synthetic("(", statement, path)
      this.value(value)
      this.synthetic(")", statement, path)
    } else if (statement.kind == "ExpressionStatement") {
      if (!plan.terminal) throw new Error("Missing validated Zig terminal call.")
      this.operation(plan.terminal)
    } else if (statement.kind == "IfStatement") {
      this.mapped("if", statement, path)
      this.synthetic(" (", statement, path)
      this.value(requiredPlanValue(plan, statement))
      this.synthetic(") {\n", statement, path)
      this.block(statement.consequent, `${path}/consequent`, indent + "    ")
      this.synthetic(indent + "}", statement, path)
      if (statement.alternate) {
        this.mapped(" else", statement, path)
        this.synthetic(" {\n", statement, path)
        this.block(statement.alternate, `${path}/alternate`, indent + "    ")
        this.synthetic(indent + "}", statement, path)
      }
      this.synthetic("\n", statement, path)
    } else throw new TypeError("Unsupported Zig statement reached emission after preflight.")
    if (statement.kind != "IfStatement") this.synthetic(";\n", statement, path)
    if (statement.kind == "LocalDeclaration") {
      const unmutated = statement.mutable && !this.usage.writes.has(statement.name)
      const unread = !statement.mutable && !this.usage.reads.has(statement.name)

      if (unmutated || unread) {
        this.synthetic(indent + "_ = ", statement, path, "Zig explicit local binding scaffold")
        if (unmutated) this.synthetic("&", statement, path, "Zig explicit unmutated-var scaffold")
        this.mapped(statement.name, statement, path, "name")
        this.synthetic(";\n", statement, path, "Zig explicit local binding scaffold")
      }
    }
    this.synthetic(`${indent}// ${marker} end ${plan.id} ${signature}\n`, statement, path, "Zig ordered-expression region marker")
  }

  /**
   * Emits eager steps in semantic order and keeps a Boolean RHS conditional.
   * @param {ZigPlannedStep[]} steps - Ordered private steps.
   * @param {string} indent - Current indentation.
   */
  steps(steps, indent) {
    for (const step of steps) {
      const {expression, path, name, type} = step.result

      if (!name || type == "void") throw new Error("Invalid Zig ordered value step.")
      this.synthetic(`${indent}${step.rightSteps ? "var" : "const"} ${name}: ${emitScalarType("zig", {kind: "TypeReference", name: type})} = `,
        expression, path, "Zig typed ordered-expression temporary")
      if (step.rightSteps) {
        this.value(step.operands[0])
        this.synthetic(`;\n${indent}if (`, expression, path, "Zig conditional ordered-expression RHS")
        if (expression.kind != "BinaryExpression") throw new Error("Invalid Zig conditional ordered plan.")
        this.synthetic(`${expression.operation == "BooleanOr" ? "!" : ""}${name}) {\n`, expression, path,
          "Zig conditional ordered-expression RHS")
        this.steps(step.rightSteps, indent + "    ")
        this.synthetic(`${indent}    ${name} = ${name} `, expression, path, "Zig conditional ordered-expression result")
        this.mapped(expression.operation == "BooleanOr" ? "or" : "and", expression, path, "operator")
        this.synthetic(" ", expression, path)
        this.value(step.operands[1])
        this.synthetic(`;\n${indent}}\n`, expression, path, "Zig conditional ordered-expression RHS")
      } else {
        this.operation(step)
        this.synthetic(";\n", expression, path)
      }
    }
  }

  /**
   * Emits one operation whose operands are already pure.
   * @param {ZigPlannedStep} step - Planned operation.
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
      const token = operators.get(expression.operation)

      if (!token) throw new Error("Unsupported operation passed Zig validation.")
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
    } else throw new Error("Pure value reached Zig operation emission.")
  }

  /**
   * Emits one pure literal, binding, or ordered temporary use.
   * @param {ZigPlannedValue} value - Planned pure value.
   * @returns {void} Text is emitted through the configured writer.
   */
  value({expression, path, name}) {
    if (name) return this.synthetic(name, expression, path, "Zig ordered-expression temporary use")
    if (expression.kind == "IdentifierExpression") return this.mapped(expression.name, expression, path, "name")
    if (expression.kind == "BooleanLiteral") return this.mapped(String(expression.value), expression, path, "literal")
    if (expression.kind == "IntegerLiteral") return this.mapped(String(expression.value), expression, path, "literal")
    if (expression.kind == "StringLiteral") return this.mapped(zigString(expression.value), expression, path, "literal")
    throw new Error("Unsequenced expression passed Zig emission.")
  }
}

/**
 * Requires the final pure value owned by a non-void statement plan.
 * @param {ZigStatementPlan} plan - Statement plan.
 * @param {Statement} statement - Owning semantic statement.
 * @returns {ZigPlannedValue} Required planned value.
 */
function requiredPlanValue(plan, statement) {
  if (!plan.value) throw new Error(`Missing validated Zig value for ${statement.kind}.`)
  return plan.value
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
