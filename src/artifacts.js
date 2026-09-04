// @ts-check

import {decodedMappings, encodedMappings, presortedDecodedMap, TraceMap} from "@jridgewell/trace-mapping"
import {isDenseArray} from "./array.js"
import {isSafeArtifactPath, isValidFilenameMetadata} from "./artifact-path.js"
import {finalizeByteMapping} from "./binary-mapping.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "./mapping.js"

const artifactRoles = new Set(["entry", "source", "manifest", "support", "mapping", "resource", "loader"])
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\u0020-\u007e]+)?$/u

/**
 * Transactionally validates and constructs one deterministic generated artifact set.
 * @param {unknown} candidate - Artifact-set fields.
 * @returns {import("./semantic/types.js").GeneratedArtifactSet} Detached immutable set.
 */
export function createGeneratedArtifactSet(candidate) {
  try {
    if (!isPlainObject(candidate) || typeof candidate.target != "string" || candidate.target.length == 0 ||
      !/^[a-z][a-z0-9-]*$/u.test(candidate.target)) {
      invalidArtifactSet("Artifact set requires a stable lowercase target ID.", targetOf(candidate))
    }
    if (!isDenseArray(candidate.artifacts) || candidate.artifacts.length == 0) {
      invalidArtifactSet("Artifact set requires a non-empty ordered artifact array.", candidate.target)
    }
    const target = candidate.target

    const paths = new Set()
    const directoryPaths = new Set()
    /** @type {string[]} */
    const entryPaths = []
    const artifacts = candidate.artifacts.map((artifact, index) => {
      if (!isPlainObject(artifact)) invalidArtifactSet(`Artifact ${index} must be a plain object.`, target)
      const artifactPath = artifact.path
      const mediaType = artifact.mediaType
      const role = artifact.role
      const contentKind = artifact.contentKind

      if (!isSafeArtifactPath(artifactPath)) invalidArtifactSet(`Artifact ${index} has an unsafe path.`, target)
      if (paths.has(artifactPath)) invalidArtifactSet(`Duplicate artifact path '${artifactPath}'.`, target)
      if (directoryPaths.has(artifactPath)) {
        invalidArtifactSet(`Artifact path '${artifactPath}' collides with a required directory.`, target)
      }
      const parentPaths = artifactDirectoryPaths(artifactPath)

      for (const parentPath of parentPaths) {
        if (paths.has(parentPath)) {
          invalidArtifactSet(`Artifact path '${artifactPath}' descends from artifact file '${parentPath}'.`, target)
        }
      }
      paths.add(artifactPath)
      for (const parentPath of parentPaths) directoryPaths.add(parentPath)
      if (typeof mediaType != "string" || !mediaTypePattern.test(mediaType) || /[\r\n]/u.test(mediaType)) {
        invalidArtifactSet(`Artifact '${artifactPath}' has an invalid media type.`, target)
      }
      if (typeof role != "string" || !artifactRoles.has(role)) invalidArtifactSet(`Artifact '${artifactPath}' has an invalid role.`, target)
      if (artifact.ownership != "generated") invalidArtifactSet(`Artifact '${artifactPath}' must have generated ownership.`, target)
      if (role == "entry") {
        if (entryPaths.length > 0) invalidArtifactSet("Artifact set must declare exactly one entry artifact.", target)
        entryPaths.push(artifactPath)
      }

      /** @type {string | Uint8Array} */
      let content

      if (contentKind == "text") {
        if (typeof artifact.content != "string" || artifact.content.length == 0) {
          invalidArtifactSet(`Text artifact '${artifactPath}' requires non-empty string content.`, target)
        }
        content = artifact.content
      } else if (contentKind == "binary") {
        if (!(artifact.content instanceof Uint8Array) || artifact.content.byteLength == 0) {
          invalidArtifactSet(`Binary artifact '${artifactPath}' requires non-empty bytes.`, target)
        }
        content = new Uint8Array(artifact.content)
      } else invalidArtifactSet(`Artifact '${artifactPath}' has an invalid content kind.`, target)

      const provenance = validateArtifactProvenance(artifact.provenance, contentKind, artifactPath, content, target)

      return /** @type {import("./semantic/types.js").GeneratedSetArtifact} */ (freezeArtifact({
        content,
        contentKind,
        mediaType,
        ownership: /** @type {const} */ ("generated"),
        path: artifactPath,
        provenance,
        role
      }))
    })

    if (entryPaths.length != 1) invalidArtifactSet("Artifact set must declare exactly one entry artifact.", candidate.target)

    return Object.freeze({
      artifacts: Object.freeze(artifacts),
      entry: entryPaths[0],
      schema: /** @type {const} */ ("GeneratedArtifactSet"),
      target,
      version: /** @type {const} */ (1)
    })
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic && error.code == "INVALID_ARTIFACT_SET") throw error

    return invalidArtifactSet("Artifact-set validation failed.", targetOf(candidate), error)
  }
}

/**
 * Validates artifact-level text, byte, or synthetic provenance.
 * @param {unknown} value - Provenance candidate.
 * @param {unknown} contentKind - Validated artifact content kind.
 * @param {string} artifactPath - Validated artifact path.
 * @param {string | Uint8Array} content - Detached artifact content.
 * @param {string} target - Artifact target.
 * @returns {import("./semantic/types.js").ArtifactProvenance} Validated provenance.
 */
function validateArtifactProvenance(value, contentKind, artifactPath, content, target) {
  if (!isPlainObject(value)) invalidArtifactSet(`Artifact '${artifactPath}' requires provenance.`, target)

  if (value.kind == "synthetic") {
    if (typeof value.reason != "string" || value.reason.length == 0 || !isDenseArray(value.relatedOrigins)) {
      invalidArtifactSet(`Synthetic artifact '${artifactPath}' requires an explicit reason and related origins.`, target)
    }
    if (contentKind == "binary") {
      invalidArtifactSet(`Binary artifact '${artifactPath}' requires byte-range provenance.`, target)
    }

    const relatedOrigins = value.relatedOrigins.map((origin, index) => validateRelatedOrigin(origin, artifactPath, index, target))

    return Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: value.reason, relatedOrigins: Object.freeze(relatedOrigins)})
  }

  if (value.kind == "text") {
    const mappingCandidate = value.mapping

    if (contentKind != "text" || !isPlainObject(mappingCandidate) || mappingCandidate.schema != "SemantifoldMapping" ||
      !isPlainObject(mappingCandidate.generated) || mappingCandidate.generated.filename != artifactPath ||
      mappingCandidate.generated.content != content || !isPlainObject(value.sourceMap)) {
      invalidArtifactSet(`Text artifact '${artifactPath}' has mismatched rich or Source Map provenance.`, target)
    }
    if (value.sourceMapFilename !== undefined && !isValidFilenameMetadata(value.sourceMapFilename)) {
      invalidArtifactSet(`Text artifact '${artifactPath}' has invalid Source Map filename metadata.`, target)
    }
    const mapping = finalizeMapping(mappingCandidate)
    const sourceMap = validateSourceMap(value.sourceMap, artifactPath, target)
    const projectedSourceMap = toSourceMapV3(mapping)

    if (!sameJsonValue(sourceMap, projectedSourceMap)) {
      invalidArtifactSet(`Text artifact '${artifactPath}' has Source Map provenance that contradicts its rich mapping.`, target)
    }

    return Object.freeze({
      kind: /** @type {const} */ ("text"),
      mapping,
      sourceMap,
      sourceMapFilename: value.sourceMapFilename
    })
  }

  if (value.kind == "bytes") {
    if (contentKind != "binary") invalidArtifactSet(`Byte provenance requires binary content for '${artifactPath}'.`, target)
    const mapping = finalizeByteMapping(value.mapping)

    if (mapping.generated.path != artifactPath || mapping.generated.byteLength != /** @type {Uint8Array} */ (content).byteLength) {
      invalidArtifactSet(`Byte provenance does not match artifact '${artifactPath}'.`, target)
    }

    return Object.freeze({kind: /** @type {const} */ ("bytes"), mapping})
  }

  return invalidArtifactSet(`Artifact '${artifactPath}' has an unknown provenance kind.`, target)
}

/**
 * Freezes one validated artifact record.
 * @param {Record<string, unknown>} artifact - Validated fields.
 * @returns {Readonly<Record<string, unknown>>} Frozen record.
 */
function freezeArtifact(artifact) {
  if (artifact.contentKind == "binary" && artifact.content instanceof Uint8Array) {
    const content = artifact.content

    Object.defineProperty(artifact, "content", {
      configurable: false,
      enumerable: true,
      get() {
        return new Uint8Array(content)
      }
    })
  }

  return Object.freeze(artifact)
}

/**
 * Lists every directory a safe relative POSIX artifact path requires.
 * @param {string} artifactPath - Validated artifact path.
 * @returns {string[]} Ordered parent directory paths.
 */
function artifactDirectoryPaths(artifactPath) {
  const parts = artifactPath.split("/")
  /** @type {string[]} */
  const directories = []

  for (let index = 1; index < parts.length; index += 1) directories.push(parts.slice(0, index).join("/"))

  return directories
}

/**
 * Throws a normalized artifact-set diagnostic.
 * @param {string} message - Failure detail.
 * @param {string} target - Artifact target.
 * @param {unknown} [error] - Preserved validation cause.
 * @returns {never} Always throws.
 */
function invalidArtifactSet(message, target, error) {
  throw new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code: "INVALID_ARTIFACT_SET",
    language: target,
    message
  })
}

/**
 * Derives a safe diagnostic identity from an unknown request.
 * @param {unknown} value - Candidate set.
 * @returns {string} Diagnostic identity.
 */
function targetOf(value) {
  return isPlainObject(value) && typeof value.target == "string" && value.target.length > 0 ? value.target : "artifact"
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
 * Validates an artifact-level related origin without interpreting source offsets as generated bytes.
 * @param {unknown} value - Related-origin candidate.
 * @param {string} artifactPath - Owning artifact path.
 * @param {number} index - Origin index.
 * @param {string} target - Artifact target.
 * @returns {import("./semantic/types.js").RelatedOrigin} Detached related origin.
 */
function validateRelatedOrigin(value, artifactPath, index, target) {
  if (!isPlainObject(value) || typeof value.sourceId != "string" || value.sourceId.length == 0 ||
    !isPlainObject(value.location) || typeof value.location.filename != "string" || value.location.filename.length == 0 ||
    !validSourcePoint(value.location.start) || !validSourcePoint(value.location.end) ||
    value.location.end.offset < value.location.start.offset) {
    invalidArtifactSet(`Artifact '${artifactPath}' has malformed related origin ${index}.`, target)
  }

  return deepFreeze({
    location: {
      end: {...value.location.end},
      filename: value.location.filename,
      start: {...value.location.start}
    },
    sourceId: value.sourceId,
    ...(optionalString(value.nodeId, "nodeId", artifactPath, index, target)),
    ...(optionalString(value.symbolId, "symbolId", artifactPath, index, target)),
    ...(optionalString(value.role, "role", artifactPath, index, target))
  })
}

/**
 * Validates one optional related-origin string field.
 * @param {unknown} value - Candidate value.
 * @param {string} property - Property name.
 * @param {string} artifactPath - Owning artifact path.
 * @param {number} index - Origin index.
 * @param {string} target - Artifact target.
 * @returns {Record<string, string>} Present validated property or an empty record.
 */
function optionalString(value, property, artifactPath, index, target) {
  if (value === undefined) return {}
  if (typeof value != "string" || value.length == 0) {
    invalidArtifactSet(`Artifact '${artifactPath}' has invalid ${property} in related origin ${index}.`, target)
  }

  return {[property]: value}
}

/**
 * Checks one UTF-16 source point.
 * @param {unknown} value - Candidate point.
 * @returns {value is import("./semantic/types.js").SourcePoint} Whether the point is structurally valid.
 */
function validSourcePoint(value) {
  return isPlainObject(value) && typeof value.line == "number" && Number.isSafeInteger(value.line) && value.line > 0 &&
    typeof value.column == "number" && Number.isSafeInteger(value.column) && value.column > 0 &&
    typeof value.offset == "number" && Number.isSafeInteger(value.offset) && value.offset >= 0
}

/**
 * Validates and detaches the Source Map v3 projection carried by a text artifact.
 * @param {unknown} value - Source Map candidate.
 * @param {string} artifactPath - Owning artifact path.
 * @param {string} target - Artifact target.
 * @returns {import("@jridgewell/gen-mapping").EncodedSourceMap} Detached Source Map.
 */
function validateSourceMap(value, artifactPath, target) {
  if (!isPlainObject(value) || value.version != 3 || value.file != artifactPath || typeof value.mappings != "string" ||
    !isDenseArray(value.names) || !value.names.every((name) => typeof name == "string") ||
    !isDenseArray(value.sources) || !value.sources.every((source) => typeof source == "string") ||
    (value.sourcesContent !== undefined && (!isDenseArray(value.sourcesContent) ||
      !value.sourcesContent.every((source) => source == null || typeof source == "string")))) {
    invalidArtifactSet(`Text artifact '${artifactPath}' has malformed Source Map v3 provenance.`, target)
  }
  validateEncodedSourceMapMappings(
    /** @type {import("@jridgewell/trace-mapping").EncodedSourceMap} */ (/** @type {unknown} */ (value)),
    artifactPath,
    target
  )

  const detached = /** @type {unknown} */ (structuredClone(value))

  return deepFreeze(/** @type {import("@jridgewell/gen-mapping").EncodedSourceMap} */ (detached))
}

/**
 * Decodes and validates the Source Map payload with the installed mapping implementation.
 * @param {import("@jridgewell/trace-mapping").EncodedSourceMap} sourceMap - Structurally validated map.
 * @param {string} artifactPath - Owning artifact path.
 * @param {string} target - Artifact target.
 * @returns {void}
 */
function validateEncodedSourceMapMappings(sourceMap, artifactPath, target) {
  /** @type {Readonly<import("@jridgewell/trace-mapping").SourceMapSegment[][]>} */
  let decoded
  let canonicalMappings

  try {
    decoded = decodedMappings(new TraceMap(sourceMap))
    const decodedMap = /** @type {import("@jridgewell/trace-mapping").DecodedSourceMap} */ ({
      ...sourceMap,
      mappings: structuredClone(decoded)
    })

    canonicalMappings = encodedMappings(presortedDecodedMap(decodedMap))
  } catch (error) {
    invalidArtifactSet(`Text artifact '${artifactPath}' has invalid encoded Source Map mappings.`, target, error)
  }

  if (canonicalMappings != sourceMap.mappings ||
    !validDecodedSourceMapMappings(decoded, sourceMap.sources.length, sourceMap.names.length)) {
    invalidArtifactSet(`Text artifact '${artifactPath}' has invalid encoded Source Map mappings.`, target)
  }
}

/**
 * Validates decoded Source Map segment shape and referenced indices.
 * @param {Readonly<import("@jridgewell/trace-mapping").SourceMapSegment[][]>} lines - Decoded mapping lines.
 * @param {number} sourceCount - Declared source count.
 * @param {number} nameCount - Declared name count.
 * @returns {boolean} Whether every segment is semantically valid.
 */
function validDecodedSourceMapMappings(lines, sourceCount, nameCount) {
  return lines.every((line) => line.every((segment) => {
    if (segment.length != 1 && segment.length != 4 && segment.length != 5) return false
    if (!segment.every((field) => Number.isSafeInteger(field) && field >= 0)) return false
    if (segment.length == 1) return true
    if (segment[1] >= sourceCount) return false

    return segment.length == 4 || segment[4] < nameCount
  }))
}

/**
 * Compares detached JSON values without depending on caller object-key order.
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} Whether both values are structurally identical.
 */
function sameJsonValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length == right.length &&
      left.every((entry, index) => sameJsonValue(entry, right[index]))
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  return leftKeys.length == rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]))
}

/**
 * Deeply freezes a detached JSON value.
 * @template T
 * @param {T} value - Detached value.
 * @returns {T} Frozen value.
 */
function deepFreeze(value) {
  if (!value || typeof value != "object" || Object.isFrozen(value)) return value

  for (const nested of Object.values(value)) deepFreeze(nested)

  return Object.freeze(value)
}
