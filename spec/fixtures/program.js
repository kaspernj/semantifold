/**
 * Computes an absolute integer difference.
 * @param {number} left - Left integer.
 * @param {number} right - Right integer.
 * @returns {number} Absolute difference.
 */
function difference(left, right) {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(difference(4, 9))
