// @ts-check

import {isDenseArray} from "./array.js"
import {isSafeArtifactPath} from "./artifact-path.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {isSourceRangeOrdered} from "./semantic/location.js"

/**
 * Creates and validates an immutable byte-coordinate provenance map.
 * @param {object} input - Mapping fields.
 * @param {number} input.byteLength - Generated artifact byte length.
 * @param {string} input.path - Generated artifact path.
 * @param {import("./semantic/types.js").GeneratedByteRange[]} input.ranges - Ordered byte ranges.
 * @returns {import("./semantic/types.js").SemantifoldByteMapping} Validated mapping.
 */
export function createByteMapping(input) {
  if (!isPlainObject(input)) invalidByteMapping("Byte mapping construction requires an object.")
  const {byteLength, path, ranges} = input

  return finalizeByteMapping({
    coordinateSystem: "bytes",
    generated: {byteLength, path},
    ranges,
    schema: "SemantifoldByteMapping",
    version: 1
  })
}

/**
 * Parses serialized byte-coordinate provenance.
 * @param {string} serialized - JSON mapping.
 * @returns {import("./semantic/types.js").SemantifoldByteMapping} Validated mapping.
 */
export function parseByteMapping(serialized) {
  try {
    return finalizeByteMapping(JSON.parse(serialized))
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic && error.code == "INVALID_BYTE_MAPPING") throw error

    return invalidByteMapping("Byte mapping must be valid JSON.", error)
  }
}

/**
 * Serializes a validated mapping with stable object-key ordering.
 * @param {import("./semantic/types.js").SemantifoldByteMapping} mapping - Byte mapping.
 * @returns {string} Canonical JSON with trailing LF.
 */
export function stringifyByteMapping(mapping) {
  const validated = finalizeByteMapping(mapping)

  return `${JSON.stringify(sortJson(validated), null, 2)}\n`
}

/**
 * Validates an existing mapping and returns a detached immutable value.
 * @param {unknown} candidate - Mapping candidate.
 * @returns {import("./semantic/types.js").SemantifoldByteMapping} Validated mapping.
 */
export function finalizeByteMapping(candidate) {
  try {
    if (!isPlainObject(candidate)) invalidByteMapping("Byte mapping must be a plain object.")
    if (candidate.schema != "SemantifoldByteMapping" || candidate.version !== 1 || candidate.coordinateSystem != "bytes") {
      invalidByteMapping("Byte mapping requires SemantifoldByteMapping version 1 with byte coordinates.")
    }
    if (!isPlainObject(candidate.generated)) {
      invalidByteMapping("Byte mapping requires a safe generated artifact path.")
    }
    const generatedPath = candidate.generated.path

    if (!isSafeArtifactPath(generatedPath)) {
      invalidByteMapping("Byte mapping requires a safe generated artifact path.")
    }
    const byteLength = candidate.generated.byteLength

    if (typeof byteLength != "number" || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      invalidByteMapping("Byte mapping requires a non-negative safe byte length.")
    }
    if (!isDenseArray(candidate.ranges)) invalidByteMapping("Byte mapping ranges must be an ordered dense array.")
    let previousEnd = 0
    /** @type {import("./semantic/types.js").GeneratedByteRange[]} */
    const ranges = []

    for (let index = 0; index < candidate.ranges.length; index += 1) {
      const range = candidate.ranges[index]

      if (!isPlainObject(range) || !isPlainObject(range.generated)) invalidByteMapping(`Byte range ${index} is malformed.`)
      const end = range.generated.end
      const start = range.generated.start

      if (typeof start != "number" || typeof end != "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end <= start || end > byteLength) {
        invalidByteMapping(`Byte range ${index} must be a non-empty in-bounds half-open integer range.`)
      }
      if (start < previousEnd) invalidByteMapping(`Byte range ${index} is out of order or overlaps its predecessor.`)
      previousEnd = end
      const origin = validateOrigin(range.origin, `Byte range ${index}`)
      const result = {
        generated: {end, start},
        origin,
        ...(optionalIdentity(range.nodeId, "nodeId", index)),
        ...(optionalIdentity(range.symbolId, "symbolId", index)),
        ...(optionalIdentity(range.role, "role", index))
      }

      ranges.push(result)
    }
    const mapping = {
      coordinateSystem: /** @type {const} */ ("bytes"),
      generated: {byteLength, path: generatedPath},
      ranges,
      schema: /** @type {const} */ ("SemantifoldByteMapping"),
      version: /** @type {const} */ (1)
    }

    return deepFreeze(mapping)
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic && error.code == "INVALID_BYTE_MAPPING") throw error

    return invalidByteMapping("Byte mapping validation failed.", error)
  }
}

/**
 * Validates one closed provenance origin.
 * @param {unknown} value - Origin candidate.
 * @param {string} label - Diagnostic range label.
 * @returns {import("./semantic/types.js").SemanticOrigin} Detached origin.
 */
function validateOrigin(value, label) {
  if (!isPlainObject(value)) invalidByteMapping(`${label} requires provenance.`)

  if (value.kind == "synthetic") {
    if (typeof value.reason != "string" || value.reason.length == 0 || !isDenseArray(value.relatedOrigins)) {
      invalidByteMapping(`${label} synthetic provenance requires an explicit reason and related-origin array.`)
    }
    /** @type {import("./semantic/types.js").RelatedOrigin[]} */
    const relatedOrigins = []

    for (let index = 0; index < value.relatedOrigins.length; index += 1) {
      relatedOrigins.push(validateRelatedOrigin(value.relatedOrigins[index], `${label} related origin ${index}`))
    }

    return {kind: "synthetic", reason: value.reason, relatedOrigins}
  }
  if (value.kind == "source") {
    if (typeof value.sourceId != "string" || value.sourceId.length == 0) invalidByteMapping(`${label} source provenance requires a source ID.`)

    return {kind: "source", location: validateLocation(value.location, label), sourceId: value.sourceId}
  }
  if (value.kind == "derived") {
    if (!isDenseArray(value.origins) || value.origins.length == 0) invalidByteMapping(`${label} derived provenance requires origins.`)
    /** @type {import("./semantic/types.js").RelatedOrigin[]} */
    const origins = []

    for (let index = 0; index < value.origins.length; index += 1) {
      origins.push(validateRelatedOrigin(value.origins[index], `${label} origin ${index}`))
    }

    return {kind: "derived", origins}
  }

  return invalidByteMapping(`${label} has an unknown provenance kind.`)
}

/**
 * Validates one related source origin.
 * @param {unknown} value - Related-origin candidate.
 * @param {string} label - Diagnostic range label.
 * @returns {import("./semantic/types.js").RelatedOrigin} Detached related origin.
 */
function validateRelatedOrigin(value, label) {
  if (!isPlainObject(value) || typeof value.sourceId != "string" || value.sourceId.length == 0) {
    invalidByteMapping(`${label} requires a source ID and location.`)
  }
  const result = {
    location: validateLocation(value.location, label),
    sourceId: value.sourceId,
    ...optionalRelated(value.nodeId, "nodeId", label),
    ...optionalRelated(value.symbolId, "symbolId", label),
    ...optionalRelated(value.role, "role", label)
  }

  return result
}

/**
 * Validates a UTF-16 original source location carried by byte provenance.
 * @param {unknown} value - Location candidate.
 * @param {string} label - Diagnostic range label.
 * @returns {import("./semantic/types.js").SourceLocation} Detached source location.
 */
function validateLocation(value, label) {
  if (!isPlainObject(value) || typeof value.filename != "string" || value.filename.length == 0) {
    invalidByteMapping(`${label} contains an invalid source location.`)
  }
  const start = snapshotPoint(value.start)
  const end = snapshotPoint(value.end)

  if (start == undefined || end == undefined || end.offset < start.offset || !isSourceRangeOrdered(start, end)) {
    invalidByteMapping(`${label} contains an invalid source location.`)
  }

  return {
    end,
    filename: value.filename,
    start
  }
}

/**
 * Snapshots one valid UTF-16 source point without retaining undeclared fields.
 * @param {unknown} value - Candidate point.
 * @returns {import("./semantic/types.js").SourcePoint | undefined} Canonical point when valid.
 */
function snapshotPoint(value) {
  if (!isPlainObject(value)) return undefined
  const line = value.line
  const column = value.column
  const offset = value.offset

  if (typeof line != "number" || !Number.isSafeInteger(line) || line <= 0 ||
    typeof column != "number" || !Number.isSafeInteger(column) || column <= 0 ||
    typeof offset != "number" || !Number.isSafeInteger(offset) || offset < 0) return undefined

  return {column, line, offset}
}

/**
 * Validates an optional byte-range identity.
 * @param {unknown} value - Candidate identity.
 * @param {string} property - Property name.
 * @param {number} index - Byte-range index.
 * @returns {Record<string, string>} Present identity or an empty record.
 */
function optionalIdentity(value, property, index) {
  if (value === undefined) return {}
  if (typeof value != "string" || value.length == 0) invalidByteMapping(`Byte range ${index} has an invalid ${property}.`)

  return {[property]: value}
}

/**
 * Validates an optional related-origin identity.
 * @param {unknown} value - Candidate identity.
 * @param {string} property - Property name.
 * @param {string} label - Diagnostic range label.
 * @returns {Record<string, string>} Present identity or an empty record.
 */
function optionalRelated(value, property, label) {
  if (value === undefined) return {}
  if (typeof value != "string" || value.length == 0) invalidByteMapping(`${label} has an invalid ${property}.`)

  return {[property]: value}
}

/**
 * Throws a normalized byte-mapping diagnostic.
 * @param {string} message - Failure detail.
 * @param {unknown} [error] - Preserved validation cause.
 * @returns {never} Always throws.
 */
function invalidByteMapping(message, error) {
  throw new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code: "INVALID_BYTE_MAPPING",
    language: "binary",
    message
  })
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Deeply freezes detached JSON mapping values.
 * @template T
 * @param {T} value - Detached value.
 * @returns {T} Frozen value.
 */
function deepFreeze(value) {
  if (!value || typeof value != "object" || Object.isFrozen(value)) return value

  for (const nested of Object.values(value)) deepFreeze(nested)

  return Object.freeze(value)
}

/**
 * Recursively sorts JSON object keys without reordering arrays.
 * @param {unknown} value - JSON value.
 * @returns {unknown} Key-sorted JSON value.
 */
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainObject(value)) return value

  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]))
}
