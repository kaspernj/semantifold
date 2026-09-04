// @ts-check

export const maximumTimeoutMs = 2_147_483_647

/**
 * Checks whether a public subprocess timeout fits one exact Node timer.
 * @param {unknown} value - Candidate timeout.
 * @returns {value is number} Whether the timeout is a supported positive integer.
 */
export function isSupportedTimeoutMs(value) {
  return typeof value == "number" && Number.isSafeInteger(value) && value > 0 && value <= maximumTimeoutMs
}
