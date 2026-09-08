// @ts-check

import {createHash} from "node:crypto"
import {unsupportedCapability} from "../diagnostic.js"

/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").SemanticTypeName} Scalar */
/** @typedef {{expression: Expression, path: string, type: Scalar, name?: string}} PlannedValue */
/** @typedef {{result: PlannedValue, operands: PlannedValue[], rightSteps?: PlannedStep[]}} PlannedStep */
/** @typedef {Array<string | number | boolean | Signature>} Signature */

/** Private occurrence-based native expression sequencer; it never rewrites the IR. */
export class OrderedExpressionPlanner {
  /**
   * Indexes already validated callable return types.
   * @param {import("../semantic/types.js").SemanticModule} module - Validated module.
   * @param {"c" | "cpp"} [language] - Owning backend diagnostic language.
   */
  constructor(module, language = "c") {
    this.language = language
    this.functions = new Map(module.functions.map((declaration) => [declaration.name, declaration.returnType.name]))
    this.nextTemporary = 1
  }

  /**
   * Resolves an expression type from the validated lexical environment.
   * @param {Expression} expression - Semantic expression.
   * @param {Map<string, Scalar>} bindings - Lexical scalar types.
   * @returns {Scalar} Exact semantic result type.
   */
  type(expression, bindings) {
    if (expression.kind == "IntegerLiteral") return "integer"
    if (expression.kind == "BooleanLiteral") return "boolean"
    if (expression.kind == "StringLiteral") return "string"
    if (expression.kind == "UnaryExpression" || expression.kind == "BinaryExpression") return expression.type
    const type = expression.kind == "CallExpression" ? this.functions.get(expression.callee) : bindings.get(expression.name)

    if (!type) return unsupportedCapability(this.language, "unresolved expression type", expression.location)
    return type
  }

  /**
   * Plans one expression in semantic order, keeping the short-circuit RHS conditional.
   * @param {Expression} expression - Original occurrence.
   * @param {string} path - Occurrence path.
   * @param {Map<string, Scalar>} bindings - Lexical types.
   * @param {PlannedStep[]} steps - Enclosing ordered prelude.
   * @returns {PlannedValue} Pure final value.
   */
  plan(expression, path, bindings, steps) {
    const result = {expression, path, type: this.type(expression, bindings)}

    if (!["CallExpression", "UnaryExpression", "BinaryExpression"].includes(expression.kind)) return result
    const operands = []
    /** @type {PlannedStep[] | undefined} */
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
    const planned = {...result, name: this.allocate(expression)}

    steps.push({operands, result: planned})
    return planned
  }

  /**
   * Allocates one bounded deterministic occurrence name.
   * @param {Expression} expression - Related expression.
   * @returns {string} Reserved temporary name.
   */
  allocate(expression) {
    if (this.nextTemporary > 999999) return unsupportedCapability(this.language, "ordered-expression occurrence limit", expression.location)
    return `semantifold_ordered_${String(this.nextTemporary++).padStart(6, "0")}`
  }
}

/**
 * Binds a region marker to its semantic consumer and expression, independently of locations.
 * The digest detects edits; structural CST validation remains mandatory and authoritative.
 * @param {import("../semantic/types.js").Statement} statement - Reconstructed or original statement.
 * @returns {string} Stable SHA-256 profile signature.
 */
export function statementSignature(statement) {
  const consumer = statement.kind == "LocalDeclaration" ? [statement.kind, statement.name, statement.type.name, statement.mutable] :
    statement.kind == "AssignmentStatement" ? [statement.kind, statement.target.name] : [statement.kind]
  const expression = statement.kind == "IfStatement" ? statement.condition : statement.kind == "LocalDeclaration" ? statement.initializer : statement.expression

  return createHash("sha256").update(JSON.stringify([consumer, expressionSignature(expression)])).digest("hex")
}

/**
 * Serializes only the closed semantic expression fields.
 * @param {Expression} expression - Expression occurrence.
 * @returns {Signature} Signature data.
 */
function expressionSignature(expression) {
  if (expression.kind == "IdentifierExpression") return [expression.kind, expression.name]
  if (expression.kind == "IntegerLiteral" || expression.kind == "BooleanLiteral" || expression.kind == "StringLiteral") return [expression.kind, expression.value]
  if (expression.kind == "CallExpression") return [expression.kind, expression.callee, ...expression.arguments.map(expressionSignature)]
  if (expression.kind == "UnaryExpression") return [expression.kind, expression.operation, expression.type, expressionSignature(expression.operand)]
  return [expression.kind, expression.operation, expression.type, expressionSignature(expression.left), expressionSignature(expression.right)]
}

/** @typedef {{id: string, steps: PlannedStep[], value: PlannedValue}} StatementPlan */
/**
 * Plans every occurrence before constructing a writer or exposing either artifact.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated module.
 * @param {"c" | "cpp"} [language] - Native diagnostic owner.
 * @returns {Map<string, StatementPlan>} Plans indexed by semantic occurrence path.
 */
export function planNativeModule(module, language = "c") {
  const planner = new OrderedExpressionPlanner(module, language)
  /** @type {Map<string, StatementPlan>} */
  const plans = new Map()

  /**
   * Plans one lexical block with independent branch environments.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {string} path - Occurrence path.
   * @param {Map<string, import("../semantic/types.js").SemanticTypeName>} inherited - Visible types.
   * @returns {void}
   */
  function visit(block, path, inherited) {
    const bindings = new Map(inherited)

    block.statements.forEach((statement, index) => {
      const statementPath = `${path}/statements/${index}`
      const field = statement.kind == "IfStatement" ? "condition" : statement.kind == "LocalDeclaration" ? "initializer" : "expression"
      const expression = statement.kind == "IfStatement" ? statement.condition : statement.kind == "LocalDeclaration" ? statement.initializer : statement.expression
      /** @type {PlannedStep[]} */
      const steps = []
      const value = planner.plan(expression, `${statementPath}/${field}`, bindings, steps)

      if (plans.size >= 999999) unsupportedCapability(language, "ordered statement limit", statement.location)
      plans.set(statementPath, {id: String(plans.size + 1).padStart(6, "0"), steps, value})
      if (statement.kind == "LocalDeclaration") bindings.set(statement.name, statement.type.name)
      if (statement.kind == "IfStatement") {
        visit(statement.consequent, `${statementPath}/consequent`, bindings)
        if (statement.alternate) visit(statement.alternate, `${statementPath}/alternate`, bindings)
      }
    })
  }

  module.functions.forEach((declaration, index) => visit(declaration.body, `/functions/${index}/body`,
    new Map(declaration.parameters.map((parameter) => [parameter.name, parameter.type.name]))))
  visit(module.entryPoint.body, "/entryPoint/body", new Map())
  return plans
}
