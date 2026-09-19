// @ts-check

import {hasOnlyUnicodeScalars} from "./semantic/scalars.js"

const lineTerminatorPattern = /[\n\r\u2028\u2029]/u
const portableArtifactComponentPattern = /^[A-Za-z0-9._-]+$/u

/**
 * Validates filename metadata without imposing artifact-set path semantics.
 * @param {unknown} value - Candidate filename.
 * @returns {value is string} Whether the value is a non-empty single-line string.
 */
export function isValidFilenameMetadata(value) {
  return typeof value == "string" && value.length > 0 && !lineTerminatorPattern.test(value)
}

/**
 * Validates a safe relative POSIX source path while retaining Unicode filename metadata.
 * @param {unknown} value - Candidate path.
 * @returns {value is string} Whether the value is safe.
 */
export function isSafeSourcePath(value) {
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
 * Validates a safe portable artifact/resource path in the closed ASCII comparison domain.
 * @param {unknown} value - Candidate path.
 * @returns {value is string} Whether the value is safe and portably comparable.
 */
export function isSafeArtifactPath(value) {
  return isSafeSourcePath(value) && value.split("/").every(part => portableArtifactComponentPattern.test(part))
}

/**
 * Produces a conservative portable comparison key for a validated artifact path.
 * @param {string} value - Safe relative POSIX path.
 * @returns {string} Complete ASCII case-fold key.
 */
export function portableArtifactPathKey(value) {
  return value.toLowerCase()
}

/**
 * Produces a deterministic case-fold comparison key for a validated source path.
 * @param {string} value - Safe relative POSIX source path.
 * @returns {string} Unicode case-fold comparison key.
 */
export function portableSourcePathKey(value) {
  return value.toLowerCase()
}

/**
 * Finds the first unsafe, duplicate, portable case-fold, or file/directory-prefix conflict.
 * @param {readonly string[]} paths - Ordered candidate artifact paths.
 * @returns {{kind: "case-fold" | "duplicate" | "prefix" | "unsafe", path: string, other?: string} | null} First conflict.
 */
export function findPortableArtifactPathConflict(paths) {
  return findPortablePathConflict(paths, isSafeArtifactPath, portableArtifactPathKey)
}

/**
 * Finds the first unsafe, duplicate, portable case-fold, or file/directory-prefix source conflict.
 * @param {readonly string[]} paths - Ordered candidate source paths.
 * @returns {{kind: "case-fold" | "duplicate" | "prefix" | "unsafe", path: string, other?: string} | null} First conflict.
 */
export function findPortableSourcePathConflict(paths) {
  return findPortablePathConflict(paths, isSafeSourcePath, portableSourcePathKey)
}

/**
 * Compares paths inside one explicitly selected validation domain.
 * @param {readonly string[]} paths - Ordered candidate paths.
 * @param {(value: unknown) => boolean} isSafe - Domain-specific path validator.
 * @param {(value: string) => string} comparisonKey - Domain-specific portable comparison key.
 * @returns {{kind: "case-fold" | "duplicate" | "prefix" | "unsafe", path: string, other?: string} | null} First conflict.
 */
function findPortablePathConflict(paths, isSafe, comparisonKey) {
  /** @type {{key: string, path: string}[]} */
  const accepted = []

  for (const path of paths) {
    if (!isSafe(path)) return {kind: "unsafe", path: String(path)}
    const key = comparisonKey(path)

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
