/**
 * @param {number} left - Left integer.
 * @param {number} right - Right integer.
 * @returns {number} Arithmetic result.
 */
function arithmetic(left, right) {
  if ((left < right) && !(left === right)) {
    return -left + right * 2
  } else {
    return left - right
  }
}

/**
 * @param {number} left - Left integer.
 * @param {number} right - Right integer.
 * @returns {boolean} Ordered result.
 */
function ordered(left, right) {
  if ((left <= right || left >= right) && left !== right) {
    return left > right
  } else {
    return left < right
  }
}

/**
 * @param {boolean} left - Left boolean.
 * @param {boolean} right - Right boolean.
 * @returns {boolean} Logic result.
 */
function logic(left, right) {
  if ((!left || right) && left !== right) {
    return left === right
  } else {
    return left || right
  }
}

/**
 * @param {string} left - Left string.
 * @param {string} right - Right string.
 * @returns {string} Joined string.
 */
function combine(left, right) {
  if (left === right || left !== right) {
    return left + ":" + right
  } else {
    return left + right
  }
}

/**
 * @param {number} left - Left integer.
 * @param {number} right - Right integer.
 * @returns {string} Report.
 */
function report(left, right) {
  if ((arithmetic(left, right) === 17 && ordered(right, left)) && !logic(false, true)) {
    return combine("typed", "operators")
  } else {
    return "bad"
  }
}

console.log(report(3, 10))
