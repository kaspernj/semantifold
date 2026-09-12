/**
 * @param {number} value
 * @returns {number}
 */
function identity(value) {
  return value
}

/** @type {ReadonlyMap<string, number>} */ const values = new Map([["b", 2], ["a", 1], ["c", 3]])
console.log(values.size)
console.log(values.get("b"))
for (const [key, value] of values) {
  if (key === "a") {
    continue
  }
  console.log(key)
  console.log(identity(value))
  if (key === "c") {
    break
  }
}
