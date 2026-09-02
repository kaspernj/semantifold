/**
 * Selects a local string.
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback value.
 * @returns {string} Selected value.
 */
function select(flag, fallback) {
  /** @type {string} */
  const preferred = "yes"
  /** @type {string} */
  let result = fallback
  if (flag) {
    result = preferred
    return result
  } else {
    return result
  }
}

/** @type {string} */
let output = "no"
output = select(true, output)
console.log(output)
