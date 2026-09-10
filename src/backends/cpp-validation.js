// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** Qualified frozen parser input bound, including the inline support. */
export const maximumCppSourceLength = 32767

/** Propagates proven UTF-8 value sizes without evaluating or rewriting semantic expressions. */
class CppValueValidator {
  /**
   * Checks every expression, including skipped-runtime candidates before generation.
   * @param {import("../semantic/types.js").Expression} expression - Validated expression.
   * @param {Map<string, bigint | undefined>} sizes - Visible value byte sizes.
   * @returns {bigint | undefined} Statically known string size.
   */
  size(expression, sizes) {
    if (expression.kind == "StringLiteral") return BigInt(Buffer.byteLength(expression.value, "utf8"))
    if (expression.kind == "IdentifierExpression") return sizes.get(expression.name)
    if (expression.kind == "CallExpression") {
      for (const argument of expression.arguments) this.size(argument, sizes)
    } else if (expression.kind == "UnaryExpression") this.size(expression.operand, sizes)
    else if (expression.kind == "BinaryExpression") {
      const left = this.size(expression.left, sizes)
      const right = this.size(expression.right, sizes)

      if (expression.operation == "StringConcat") {
        if ((left ?? 0n) + (right ?? 0n) > 9223372036854775807n) {
          unsupportedCapability("cpp", "known owned string size exceeds the qualified 64-bit object limit", expression.location)
        }
        if (left !== undefined && right !== undefined) return left + right
      }
    }
    return undefined
  }

  /**
   * Follows value copies and merges only identical proven branch results.
   * @param {import("../semantic/types.js").Block} block - Lexical block.
   * @param {Map<string, bigint | undefined>} inherited - Visible byte sizes.
   * @returns {Map<string, bigint | undefined>} Outgoing proven sizes.
   */
  block(block, inherited) {
    const sizes = new Map(inherited)

    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration") sizes.set(statement.name, this.size(statement.initializer, sizes))
      else if (statement.kind == "AssignmentStatement") sizes.set(statement.target.name, this.size(statement.expression, sizes))
      else if (statement.kind == "IfStatement") {
        this.size(statement.condition, sizes)
        const left = this.block(statement.consequent, sizes)
        const right = statement.alternate ? this.block(statement.alternate, sizes) : sizes

        for (const name of sizes.keys()) sizes.set(name, left.get(name) === right.get(name) ? left.get(name) : undefined)
      } else if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ||
        statement.kind == "ReturnStatement") {
        const expression = statement.expression

        if (expression) this.size(expression, sizes)
      }
    }
    return sizes
  }
}

/**
 * Rejects known unrepresentable values before target emission.
 * @param {import("../semantic/types.js").SemanticModule} module - Fully validated semantic module.
 * @returns {void}
 */
export function validateCppValues(module) {
  const validator = new CppValueValidator()

  for (const declaration of module.functions) validator.block(declaration.body, new Map())
  validator.block(module.entryPoint.body, new Map())
}
