// @ts-check

import {createHash} from "node:crypto"
import {unsupportedCapability} from "../diagnostic.js"

/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").SemanticTypeName} Scalar */
/** @typedef {{expression: Expression, path: string, type: Scalar, name?: string}} PlannedValue */
/** @typedef {{result: PlannedValue, operands: PlannedValue[], rightSteps?: PlannedStep[]}} PlannedStep */
/** @typedef {Array<string | number | boolean | Signature>} Signature */

/** Private occurrence-based C expression sequencer; it never rewrites the IR. */
export class CExpressionPlanner {
  /**
   * Indexes already validated callable return types.
   * @param {import("../semantic/types.js").SemanticModule} module - Validated module.
   */
  constructor(module) {
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

    if (!type) return unsupportedCapability("c", "unresolved expression type", expression.location)
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
    if (this.nextTemporary > 999999) return unsupportedCapability("c", "ordered-expression occurrence limit", expression.location)
    return `semantifold_ordered_${String(this.nextTemporary++).padStart(6, "0")}`
  }
}

/**
 * Binds a region marker to its semantic consumer and expression, independently of locations.
 * The digest detects edits; structural CST validation remains mandatory and authoritative.
 * @param {import("../semantic/types.js").Statement} statement - Reconstructed or original statement.
 * @returns {string} Stable SHA-256 profile signature.
 */
export function cStatementSignature(statement) {
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
