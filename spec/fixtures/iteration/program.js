/**
 * @param {ReadonlyArray<number>} values
 * @returns {ReadonlyArray<number>}
 */
function passList(values) {
  return values
}
/**
 * @param {ReadonlyArray<number>} values
 * @returns {number}
 */
function orderedTotal(values) {
  /** @type {number} */ let total = 0
  for (const value of passList(values)) {
    if (value < 5) {
      if (value === 2) {
        continue
      }
      total = total + value
    } else {
      if (value === 5) {
        break
      }
    }
  }
  return total
}
/** @type {ReadonlyArray<number>} */ const values = [1, 2, 3, 5, 8]
console.log(orderedTotal(values))
