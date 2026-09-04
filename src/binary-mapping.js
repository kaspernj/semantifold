// @ts-check

import {isSafeArtifactPath} from "./artifact-path.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"

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
    if (candidate.schema != "SemantifoldByteMapping" || candidate.version != 1 || candidate.coordinateSystem != "bytes") {
      invalidByteMapping("Byte mapping requires SemantifoldByteMapping version 1 with byte coordinates.")
    }
    if (!isPlainObject(candidate.generated) || !isSafeArtifactPath(candidate.generated.path)) {
      invalidByteMapping("Byte mapping requires a safe generated artifact path.")
    }
    if (typeof candidate.generated.byteLength != "number" || !Number.isSafeInteger(candidate.generated.byteLength) ||
      candidate.generated.byteLength < 0) {
      invalidByteMapping("Byte mapping requires a non-negative safe byte length.")
    }
    if (!Array.isArray(candidate.ranges)) invalidByteMapping("Byte mapping ranges must be an ordered array.")
    const byteLength = /** @type {number} */ (candidate.generated.byteLength)
    const generatedPath = candidate.generated.path

    let previousEnd = 0
    const ranges = candidate.ranges.map((range, index) => {
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

      return result
    })
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
    if (typeof value.reason != "string" || value.reason.length == 0 || !Array.isArray(value.relatedOrigins)) {
      invalidByteMapping(`${label} synthetic provenance requires an explicit reason and related-origin array.`)
    }

    return {kind: "synthetic", reason: value.reason, relatedOrigins: value.relatedOrigins.map((origin, index) =>
      validateRelatedOrigin(origin, `${label} related origin ${index}`))}
  }
  if (value.kind == "source") {
    if (typeof value.sourceId != "string" || value.sourceId.length == 0) invalidByteMapping(`${label} source provenance requires a source ID.`)

    return {kind: "source", location: validateLocation(value.location, label), sourceId: value.sourceId}
  }
  if (value.kind == "derived") {
    if (!Array.isArray(value.origins) || value.origins.length == 0) invalidByteMapping(`${label} derived provenance requires origins.`)

    return {kind: "derived", origins: value.origins.map((origin, index) => validateRelatedOrigin(origin, `${label} origin ${index}`))}
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
  if (!isPlainObject(value) || typeof value.filename != "string" || value.filename.length == 0 ||
    !validPoint(value.start) || !validPoint(value.end) || value.end.offset < value.start.offset) {
    invalidByteMapping(`${label} contains an invalid source location.`)
  }

  return {
    end: {...value.end},
    filename: value.filename,
    start: {...value.start}
  }
}

/**
 * Checks one UTF-16 source point.
 * @param {unknown} value - Candidate point.
 * @returns {value is import("./semantic/types.js").SourcePoint} Whether the point is valid.
 */
function validPoint(value) {
  return isPlainObject(value) && typeof value.line == "number" && Number.isSafeInteger(value.line) && value.line > 0 &&
    typeof value.column == "number" && Number.isSafeInteger(value.column) && value.column > 0 &&
    typeof value.offset == "number" && Number.isSafeInteger(value.offset) && value.offset >= 0
}

/**
 * Validates an optional byte-range identity.
 * @param {unknown} value - Candidate identity.
 * @param {string} property - Property name.
 * @param {number} index - Byte-range index.
 * @returns {Record<string, string>} Present identity or an empty record.
 */
function optionalIdentity(value, property, index) {
  if (value == undefined) return {}
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
  if (value == undefined) return {}
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
