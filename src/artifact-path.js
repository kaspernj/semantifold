// @ts-check

import {hasOnlyUnicodeScalars} from "./semantic/scalars.js"

const lineTerminatorPattern = /[\n\r\u2028\u2029]/u

/**
 * Validates filename metadata without imposing artifact-set path semantics.
 * @param {unknown} value - Candidate filename.
 * @returns {value is string} Whether the value is a non-empty single-line string.
 */
export function isValidFilenameMetadata(value) {
  return typeof value == "string" && value.length > 0 && !lineTerminatorPattern.test(value)
}

/**
 * Validates a safe relative POSIX artifact path.
 * @param {unknown} value - Candidate path.
 * @returns {value is string} Whether the value is safe.
 */
export function isSafeArtifactPath(value) {
  if (typeof value != "string" || value.length == 0 || value.includes("\\") || value.includes("\0") ||
    !hasOnlyUnicodeScalars(value)) return false
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false

  const parts = value.split("/")

  return parts.every((part) => part.length > 0 && part != "." && part != ".." &&
    [...part].every((character) => {
      const codePoint = character.codePointAt(0)

      return codePoint != undefined && codePoint > 31 && codePoint != 127
    }))
}

/**
 * Produces a conservative portable comparison key for a validated artifact path.
 * @param {string} value - Safe relative POSIX path.
 * @returns {string} Compatibility-normalized case-fold key.
 */
export function portableArtifactPathKey(value) {
  return value.split("/").map(part => part.normalize("NFKC").toLocaleLowerCase("en-US")).join("/")
}

/**
 * Finds the first unsafe, duplicate, portable case-fold, or file/directory-prefix conflict.
 * @param {readonly string[]} paths - Ordered candidate artifact paths.
 * @returns {{kind: "case-fold" | "duplicate" | "prefix" | "unsafe", path: string, other?: string} | null} First conflict.
 */
export function findPortableArtifactPathConflict(paths) {
  /** @type {{key: string, path: string}[]} */
  const accepted = []

  for (const path of paths) {
    if (!isSafeArtifactPath(path)) return {kind: "unsafe", path: String(path)}
    const key = portableArtifactPathKey(path)

    for (const previous of accepted) {
      if (path == previous.path) return {kind: "duplicate", other: previous.path, path}
      if (key == previous.key) return {kind: "case-fold", other: previous.path, path}
      if (key.startsWith(`${previous.key}/`) || previous.key.startsWith(`${key}/`)) {
        return {kind: "prefix", other: previous.path, path}
      }
    }
    accepted.push({key, path})
  }

  return null
}
