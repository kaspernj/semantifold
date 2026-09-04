/**
 * Selects a sequenced result.
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback value.
 * @returns {string} Selected value.
 */
function select(flag, fallback) {
  /** @type {string} */
  let result = fallback
  if (flag) {
    result = "yes"
    console.log("checking")
    if (fallback === "alt") {
      return fallback
    } else if (fallback === "no") {
      return result
    } else {
      return "other"
    }
  }
  return result
}

/** @type {string} */
let output = select(true, "no")
console.log(output)
if (output === "yes") {
  console.log("matched")
}
output = select(false, "fallback")
console.log(output)
