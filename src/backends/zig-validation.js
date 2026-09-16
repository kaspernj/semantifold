// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** Repository-owned bound for frozen CST traversal and deterministic project generation. */
export const maximumZigSourceLength = 1_000_000

/**
 * Rejects statically impossible UTF-8 arena sizes without changing the semantic graph.
 * @param {import("../semantic/types.js").SemanticModule} module - Fully validated module.
 * @returns {void}
 */
export function validateZigValues(module) {
  /**
   * Infers a known UTF-8 byte size while validating literal shape.
   * @param {import("../semantic/types.js").Expression} expression - Expression to inspect.
   * @param {Map<string, bigint | undefined>} sizes - Known binding sizes.
   * @returns {bigint | undefined} Known byte size when statically available.
   */
  const size = (expression, sizes) => {
    if (expression.kind == "IntegerLiteral" && (!Number.isSafeInteger(expression.value) || expression.value < 0 || Object.is(expression.value, -0))) {
      unsupportedCapability("zig", "non-safe or noncanonical i64 literal", expression.location)
    }
    if (expression.kind == "StringLiteral") return BigInt(Buffer.byteLength(expression.value, "utf8"))
    if (expression.kind == "IdentifierExpression") return sizes.get(expression.name)
    if (expression.kind == "CallExpression") expression.arguments.forEach(argument => size(argument, sizes))
    else if (expression.kind == "UnaryExpression") size(expression.operand, sizes)
    else if (expression.kind == "BinaryExpression") {
      const left = size(expression.left, sizes)
      const right = size(expression.right, sizes)

      if (expression.operation == "StringConcat") {
        if ((left ?? 0n) + (right ?? 0n) > 9223372036854775807n) {
          unsupportedCapability("zig", "known immutable UTF-8 slice exceeds the qualified native allocation limit", expression.location)
        }
        if (left !== undefined && right !== undefined) return left + right
      }
    }
    return undefined
  }
  /**
   * Propagates conservative known string sizes through one block.
   * @param {import("../semantic/types.js").Block} block - Block to inspect.
   * @param {Map<string, bigint | undefined>} inherited - Sizes visible on entry.
   * @returns {Map<string, bigint | undefined>} Sizes known after the block.
   */
  const visit = (block, inherited) => {
    const sizes = new Map(inherited)

    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration") sizes.set(statement.name, size(statement.initializer, sizes))
      else if (statement.kind == "AssignmentStatement") sizes.set(statement.target.name, size(statement.expression, sizes))
      else if (statement.kind == "IfStatement") {
        size(statement.condition, sizes)
        const left = visit(statement.consequent, sizes)
        const right = statement.alternate ? visit(statement.alternate, sizes) : sizes

        for (const name of sizes.keys()) sizes.set(name, left.get(name) === right.get(name) ? left.get(name) : undefined)
      } else if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" || statement.kind == "ReturnStatement") {
        if (statement.expression) size(statement.expression, sizes)
      }
    }
    return sizes
  }

  for (const declaration of module.functions) visit(declaration.body, new Map())
  visit(module.entryPoint.body, new Map())
}
