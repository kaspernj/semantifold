// @ts-check

/** @typedef {"Add" | "Subtract" | "Multiply" | "Negate" | "Not" | "And" | "Or" | "Equal" | "NotEqual" | "JavaEqual" | "JavaNotEqual" | "StringEqual" | "StringNotEqual" | "StringConcat" | "LessThan" | "LessThanOrEqual" | "GreaterThan" | "GreaterThanOrEqual"} AdaptedOperation */

/** @type {WeakMap<object, AdaptedOperation>} */
const adaptedOperations = new WeakMap()

/**
 * Associates parser-normalized intent without adding it to a semantic value.
 * @template {object} Expression
 * @param {Expression} expression - Adapted expression awaiting type resolution.
 * @param {AdaptedOperation} operation - Parser-normalized operation intent.
 * @returns {Expression} The same expression.
 */
export function withAdaptedOperation(expression, operation) {
  adaptedOperations.set(expression, operation)

  return expression
}

/**
 * Reads private frontend intent during parsed-module validation.
 * @param {object} expression - Adapted expression.
 * @returns {AdaptedOperation | undefined} Associated operation.
 */
export function adaptedOperationFor(expression) {
  return adaptedOperations.get(expression)
}
