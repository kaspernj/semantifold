// @ts-check

/**
 * Produces the complete parser-neutral meaning used by acceptance specs.
 *
 * Source coordinates and provenance describe where meaning came from, not the
 * meaning itself. Function declaration IDs and the matching resolved-call IDs
 * are regenerated from declaration order on every parse; the rest of each
 * resolved signature remains part of the comparison.
 *
 * @param {unknown} value - Semantic value to normalize.
 * @returns {unknown} A detached, location-insensitive semantic value.
 */
export function semanticMeaning(value) {
  return copyMeaning(value, new Set())
}

/**
 * Copies one semantic value without using serialization as a generic clone.
 * @param {unknown} value - Current value.
 * @param {Set<object>} activePath - Objects active on the recursive path.
 * @returns {unknown} Detached semantic meaning.
 */
function copyMeaning(value, activePath) {
  if (value === null || typeof value != "object") return value
  if (activePath.has(value)) throw new TypeError("Cyclic semantic values cannot be compared.")

  const nextPath = new Set(activePath)

  nextPath.add(value)
  if (Array.isArray(value)) return value.map((item) => copyMeaning(item, nextPath))

  const candidate = /** @type {Record<string, unknown>} */ (value)
  const result = {}

  for (const key of Object.keys(candidate)) {
    if (["location", "provenance", "sourceProvenance"].includes(key)) continue
    if (key == "id" && candidate.kind == "FunctionDeclaration") continue
    if (key == "declarationId" && candidate.kind == "ResolvedFunctionSignature") continue
    Reflect.set(result, key, copyMeaning(candidate[key], nextPath))
  }

  return result
}
