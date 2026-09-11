/** @returns {number} */
function zero() {
  return 0
}

/**
 * @param {string} value
 * @returns {string}
 */
function identityText(value) {
  return value
}

/**
 * @param {number} first
 * @param {number} second
 * @param {number} third
 * @returns {number}
 */
function sumThree(first, second, third) {
  return first + second + third
}

/**
 * @param {number} value
 * @returns {number}
 */
function countdown(value) {
  if (value > 0) {
    return countdown(value - 1)
  }
  return value
}

/**
 * @param {string} value
 * @returns {void}
 */
function announce(value) {
  console.log(value)
}

/** @returns {void} */
function noop() {
  return
}

/**
 * @param {string} value
 * @param {boolean} present
 * @returns {string|null}
 */
function maybe(value, present) {
  if (present) {
    return value
  } else {
    return null
  }
}

/**
 * @param {string|null} value
 * @returns {string}
 */
function optionalLabel(value) {
  if (value !== null) {
    return value
  } else {
    return "absent"
  }
}

/**
 * @param {number} value
 * @param {boolean} enabled
 * @param {string} prefix
 * @returns {string}
 */
function branchLabel(value, enabled, prefix) {
  /** @type {number} */ let total = value + zero()
  total = total * 2
  /** @type {number} */ const threshold = 5
  /** @type {string} */ let label = prefix + "fallback"
  if (enabled && total > threshold) {
    label = prefix + "ok"
    if (total !== threshold && (!enabled || enabled)) {
      label = label + "!"
    }
  } else {
    label = label + "!"
  }
  return label
}

/**
 * @param {ReadonlyArray<number>} values
 * @returns {number}
 */
function orderedTotal(values) {
  /** @type {number} */ let total = 0
  for (const item of values) {
    if (item < 5) {
      if (item === 2) {
        continue
      }
      total = total + item
    } else {
      if (item === 5) {
        break
      }
    }
  }
  return total
}

/** @type {string|null} */ const presentValue = maybe("present", true)
/** @type {string|null} */ const absentValue = maybe("ignored", false)
/** @type {ReadonlyArray<number>} */ const values = [1, 2, 3, 5, 8]
/** @type {ReadonlyMap<string, ReadonlyArray<number>>} */ const groups = new Map([["main", [7, 8]], ["spare", [9]]])
/** @type {ReadonlyArray<ReadonlyArray<number>>} */ const nested = [[1, 2], [3]]
announce(identityText("compat"))
noop()
console.log(branchLabel(sumThree(countdown(1), 1, 2), true, "branch-"))
console.log(optionalLabel(presentValue))
console.log(optionalLabel(absentValue))
console.log(groups.get("main")[0])
console.log(groups.size)
console.log(nested[1][0])
console.log(values.length)
console.log(orderedTotal(values))
