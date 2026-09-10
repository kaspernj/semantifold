/**
 * @param {string|null} value
 * @returns {string}
 */
function label(value) {
  if (value !== null) return value
  else return "absent"
}

/** @type {ReadonlyArray<string|null>} */
const values = ["list-present", null]
/** @type {ReadonlyMap<string, string|null>} */
const byName = new Map([["present", "map-present"], ["absent", null]])
console.log(label(values[0]))
console.log(label(values[1]))
console.log(label(byName.get("present")))
console.log(label(byName.get("absent")))
