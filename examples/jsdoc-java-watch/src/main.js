/**
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
function add(left, right) {
  return left + right
}

/**
 * @param {boolean} enabled
 * @returns {string}
 */
function label(enabled) {
  if (enabled) return "enabled"
  else return "disabled"
}

console.log("task-044")
console.log(add(2, 3))
console.log(label(true))
