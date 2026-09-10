// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").SourceLocation} SourceLocation */

const maximumObjectBytes = 9223372036854775807n
/** Maximum UTF-16 input accepted by the unchanged qualified legacy parser. */
export const maximumCSourceLength = 32767
const allocationMetadataBytes = 8n
/**
 * Rejects compile-time-known object and arena sizes; unknown runtime lengths remain checked in C.
 * @param {SemanticModule} module - Shape/type-validated module.
 * @returns {void}
 */
export function validateCMemory(module) {
  /**
   * Checks one expression and its known byte lengths without folding the IR.
   * @param {Expression} expression - Semantic expression.
   * @param {Map<string, bigint | undefined>} lengths - Visible immutable or assigned lengths.
   * @param {{bytes: bigint}} arena - Known minimum allocations in this lexical path.
   * @returns {bigint | undefined} Known UTF-8 byte length.
   */
  function size(expression, lengths, arena) {
    if (expression.kind == "StringLiteral") {
      const bytes = BigInt(Buffer.byteLength(expression.value, "utf8"))

      if (bytes > 4095n) unsupportedCapability("c", "UTF-8 literal exceeds the strict C17 4095-byte translation limit", expression.location)
      return bytes
    }
    if (expression.kind == "IdentifierExpression") return lengths.get(expression.name)
    if (expression.kind == "CallExpression") {
      for (const argument of expression.arguments) size(argument, lengths, arena)
    } else if (expression.kind == "UnaryExpression") size(expression.operand, lengths, arena)
    else if (expression.kind == "BinaryExpression") {
      const left = size(expression.left, lengths, arena)
      const right = size(expression.right, lengths, arena)

      if (expression.operation == "StringConcat") {
        const minimum = (left ?? 0n) + (right ?? 0n)

        arena.bytes += allocationMetadataBytes + minimum
        if (minimum > maximumObjectBytes - allocationMetadataBytes || arena.bytes > maximumObjectBytes) {
          unsupportedCapability("c", "known immutable slice or module arena size exceeds PTRDIFF_MAX", expression.location)
        }
        return left === undefined || right === undefined ? undefined : left + right
      }
    }
    return undefined
  }

  /**
   * Propagates known local descriptor sizes through straight-line code and both branch paths.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {Map<string, bigint | undefined>} inherited - Visible known lengths.
   * @param {{bytes: bigint}} arena - Known path allocation size.
   * @returns {Map<string, bigint | undefined>} Outgoing known lengths.
   */
  function visit(block, inherited, arena) {
    const lengths = new Map(inherited)

    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration") lengths.set(statement.name, size(statement.initializer, lengths, arena))
      else if (statement.kind == "AssignmentStatement") lengths.set(statement.target.name, size(statement.expression, lengths, arena))
      else if (statement.kind == "IfStatement") {
        size(statement.condition, lengths, arena)
        const leftArena = {bytes: arena.bytes}
        const rightArena = {bytes: arena.bytes}
        const left = visit(statement.consequent, lengths, leftArena)
        const right = statement.alternate ? visit(statement.alternate, lengths, rightArena) : lengths

        for (const name of lengths.keys()) lengths.set(name, left.get(name) === right.get(name) ? left.get(name) : undefined)
        arena.bytes = leftArena.bytes < rightArena.bytes ? leftArena.bytes : rightArena.bytes
      } else if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ||
        statement.kind == "ReturnStatement") {
        const expression = statement.expression

        if (expression) size(expression, lengths, arena)
      }
    }
    return lengths
  }

  for (const declaration of module.functions) visit(declaration.body, new Map(), {bytes: 0n})
  visit(module.entryPoint.body, new Map(), {bytes: 0n})
}
