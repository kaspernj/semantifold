// @ts-check

/**
 * Validates a safe relative POSIX artifact path.
 * @param {unknown} value - Candidate path.
 * @returns {value is string} Whether the value is safe.
 */
export function isSafeArtifactPath(value) {
  if (typeof value != "string" || value.length == 0 || value.includes("\\") || value.includes("\0")) return false
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false

  const parts = value.split("/")

  return parts.every((part) => part.length > 0 && part != "." && part != ".." &&
    [...part].every((character) => {
      const codePoint = character.codePointAt(0)

      return codePoint != undefined && codePoint > 31 && codePoint != 127
    }))
}
