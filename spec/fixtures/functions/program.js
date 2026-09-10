/**
 * @returns {number}
 */
function zero() {
  return 0
}

/**
 * @param {string} value
 * @returns {string}
 */
function passText(value) {
  return value
}

/**
 * @param {number} first
 * @param {number} second
 * @param {number} third
 * @returns {number}
 */
function sum3(first, second, third) {
  return first + second + third
}

/**
 * @param {number} value
 * @returns {number}
 */
function countdown(value) {
  if (value > 0) return countdown(value - 1)
  return value
}

/**
 * @param {string} value
 * @returns {void}
 */
function announce(value) {
  console.log(value)
}

/**
 * @returns {void}
 */
function noop() {
  return
}

/**
 * @param {number} first
 * @param {number} second
 * @param {number} third
 * @returns {number}
 */
function nested(first, second, third) {
  return sum3(zero(), sum3(first, second, third), countdown(2))
}

announce(passText("ready"))
noop()
console.log(nested(1, 2, 3))
