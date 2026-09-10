/**
 * @param {string} value
 * @param {boolean} present
 * @returns {string|null}
 */
function maybe(value, present) {
  if (present) return value
  else return null
}

/**
 * @param {string|null} value
 * @returns {string}
 */
function label(value) {
  if (value !== null) return value
  else return "absent"
}

/** @type {string|null} */
const presentValue = maybe("present", true)
/** @type {string|null} */
const absentValue = maybe("ignored", false)
console.log(label(presentValue))
console.log(label(absentValue))
