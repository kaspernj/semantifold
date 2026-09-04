// @ts-check

/**
 * Checks that every index below an array's length is an own property.
 * @param {unknown} value - Candidate ordered array.
 * @returns {value is unknown[]} Whether the value is a dense array.
 */
export function isDenseArray(value) {
  if (!Array.isArray(value)) return false
  let indexedProperties = 0

  for (const property of Object.getOwnPropertyNames(value)) {
    const index = Number(property)

    if (Number.isInteger(index) && index >= 0 && index < value.length && String(index) == property) indexedProperties += 1
  }

  return indexedProperties == value.length
}
