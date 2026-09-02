/**
 * Selects a string with a boolean flag.
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback string.
 * @returns {string} Selected string.
 */
function label(flag, fallback) {
  if (flag) {
    return "yes"
  } else {
    return fallback
  }
}

console.log(label(true, "no"))
