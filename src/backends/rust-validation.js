// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** Qualified legacy Rust grammar input limit, including support source. */
export const maximumRustSourceLength = 32767

/** Propagates known owned UTF-8 lengths to reject impossible native allocations before emission. */
class RustValueValidator {
  /**
   * Validates each expression without folding or changing the semantic graph.
   * @param {import("../semantic/types.js").Expression} expression - Validated expression.
   * @param {Map<string, bigint | undefined>} sizes - Known lexical string byte sizes.
   * @returns {bigint | undefined} Proven result size when known.
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
          unsupportedCapability("rust", "known owned string size exceeds the qualified signed-64-bit allocation limit", expression.location)
        }
        if (left !== undefined && right !== undefined) return left + right
      }
    }
    return undefined
  }

  /**
   * Follows value copies and independent branches, retaining only equal outgoing size proofs.
   * @param {import("../semantic/types.js").Block} block - Lexical block.
   * @param {Map<string, bigint | undefined>} inherited - Visible sizes.
   * @returns {Map<string, bigint | undefined>} Outgoing size proofs.
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
      } else {
        const expression = statement.expression

        if (expression) this.size(expression, sizes)
      }
    }
    return sizes
  }
}

/**
 * Rejects statically unrepresentable owned values before constructing any artifacts.
 * @param {import("../semantic/types.js").SemanticModule} module - Fully validated semantics.
 * @returns {void}
 */
export function validateRustValues(module) {
  const validator = new RustValueValidator()

  for (const declaration of module.functions) validator.block(declaration.body, new Map())
  validator.block(module.entryPoint.body, new Map())
}
