// @ts-check

import {addSegment, GenMapping, maybeAddSegment, setSourceContent, toEncodedMap} from "@jridgewell/gen-mapping"
import {
  eachMapping,
  originalPositionFor as traceOriginalPositionFor,
  sourceContentFor,
  TraceMap
} from "@jridgewell/trace-mapping"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {createCoordinateIndex, indexedOffsetAt, indexedPointAt, locationFromOffsets} from "./semantic/location.js"
import {primaryLocation} from "./semantic/provenance.js"

/** @typedef {ReturnType<typeof buildMappingIndex>} MappingIndex */
/** @type {WeakMap<import("./semantic/types.js").SemantifoldMapping, MappingIndex>} */
const mappingIndexes = new WeakMap()

/**
 * Projects an authoritative Semantifold mapping to Source Map v3.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @returns {import("@jridgewell/gen-mapping").EncodedSourceMap} Source Map v3.
 */
export function toSourceMapV3(mapping) {
  const index = mappingIndex(mapping)

  const generated = new GenMapping({file: mapping.generated.filename})

  for (const source of mapping.sources) setSourceContent(generated, source.filename, source.content)

  for (const span of mapping.spans) {
    const location = primaryLocation(span.origin)
    const line = span.generated.start.line - 1
    const column = span.generated.start.column - 1

    if (!location || span.mappingKind == "synthetic") {
      maybeAddSegment(generated, line, column)
      continue
    }

    const registered = sourceForOrigin(mapping, span.origin, location, index.sourcesById)

    if (span.name) {
      addSegment(generated, line, column, registered.filename, location.start.line - 1, location.start.column - 1, span.name, registered.content)
    } else {
      addSegment(generated, line, column, registered.filename, location.start.line - 1, location.start.column - 1, null, registered.content)
    }
  }

  return toEncodedMap(generated)
}

/**
 * Looks up original provenance for one generated UTF-16 position.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @param {{offset: number} | {line: number, column: number}} position - Generated position.
 * @returns {{generatedLocation: import("./semantic/types.js").SourceLocation, location: import("./semantic/types.js").SourceLocation | undefined, mappingKind: import("./semantic/types.js").MappingKind, name: string | undefined, nodeId: string | undefined, role: string | undefined, symbolId: string | undefined}} Lookup result.
 */
export function originalPositionFor(mapping, position) {
  const index = mappingIndex(mapping)
  const offset = positionOffset(index.generatedCoordinates, position)
  const span = spanForGenerated(mapping.spans, offset)

  if (!span) throw new RangeError(`No generated mapping at offset ${offset}.`)

  return mappingResult(span)
}

/**
 * Looks up every generated span containing one original UTF-16 position.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @param {({filename: string} | {sourceId: string}) & ({offset: number} | {line: number, column: number})} position - Original position.
 * @returns {{generatedLocation: import("./semantic/types.js").SourceLocation, location: import("./semantic/types.js").SourceLocation | undefined, mappingKind: import("./semantic/types.js").MappingKind, name: string | undefined, nodeId: string | undefined, role: string | undefined, symbolId: string | undefined}[]} Generated results.
 */
export function generatedPositionFor(mapping, position) {
  const index = mappingIndex(mapping)
  const source = "sourceId" in position
    ? index.sourcesById.get(position.sourceId)
    : mapping.sources.find((candidate) => candidate.filename == position.filename)

  if (!source) return []
  if (source.content == null && !("offset" in position)) {
    throw new TypeError(`Source content is required for line/column lookup of ${source.filename}.`)
  }

  let offset

  if ("offset" in position) {
    if (source.content == null) {
      if (!Number.isInteger(position.offset) || position.offset < 0) throw new RangeError(`Invalid source offset: ${position.offset}`)
    } else indexedPointAt(/** @type {ReturnType<typeof createCoordinateIndex>} */ (index.sourceCoordinates.get(source.id)), position.offset)
    offset = position.offset
  } else {
    offset = indexedOffsetAt(/** @type {ReturnType<typeof createCoordinateIndex>} */ (index.sourceCoordinates.get(source.id)),
      position.line, position.column)
  }
  const entries = index.originalBySource.get(source.id) ?? []
  let low = 0
  let high = entries.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (entries[middle].start <= offset) low = middle + 1
    else high = middle
  }

  const matches = []

  for (let candidate = low - 1; candidate >= 0 && entries[candidate].prefixEnd > offset; candidate--) {
    if (entries[candidate].end > offset) matches.push(entries[candidate].span)
  }

  return matches.sort((left, right) => left.generated.start.offset - right.generated.start.offset).map(mappingResult)
}

/**
 * Returns every generated span associated with one canonical semantic node.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @param {string} nodeId - Canonical node identity.
 * @returns {import("./semantic/types.js").SemantifoldMappingSpan[]} Matching spans.
 */
export function spansForNode(mapping, nodeId) {
  const index = mappingIndex(mapping)
  if (!index.nodeSpans.has(nodeId)) throw new RangeError(`Unknown semantic node: ${nodeId}`)

  return [...(index.nodeSpans.get(nodeId) ?? [])]
}

/**
 * Returns every generated span associated with one canonical semantic symbol.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @param {string} symbolId - Canonical symbol identity.
 * @returns {import("./semantic/types.js").SemantifoldMappingSpan[]} Matching spans.
 */
export function spansForSymbol(mapping, symbolId) {
  const index = mappingIndex(mapping)
  if (!index.symbolSpans.has(symbolId)) throw new RangeError(`Unknown semantic symbol: ${symbolId}`)

  return [...(index.symbolSpans.get(symbolId) ?? [])]
}

/**
 * Serializes a validated rich mapping deterministically.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @returns {string} Canonical pretty JSON with one trailing LF.
 */
export function stringifyMapping(mapping) {
  mappingIndex(mapping)

  return `${JSON.stringify(sortJson(mapping), null, 2)}\n`
}

/**
 * Parses and validates a rich mapping.
 * @param {string} serialized - Mapping JSON.
 * @returns {import("./semantic/types.js").SemantifoldMapping} Parsed mapping.
 */
export function parseMapping(serialized) {
  const mapping = /** @type {unknown} */ (JSON.parse(serialized))

  return finalizeMapping(mapping)
}

/**
 * Composes an outer rich map through an inner rich map.
 * @param {import("./semantic/types.js").SemantifoldMapping} outer - Final output to intermediate map.
 * @param {import("./semantic/types.js").SemantifoldMapping} inner - Intermediate to original map.
 * @returns {import("./semantic/types.js").SemantifoldMapping} Composed rich map.
 */
export function composeMappings(outer, inner) {
  const outerIndex = mappingIndex(outer)

  mappingIndex(inner)

  /** @type {import("./semantic/types.js").RegisteredSource[]} */
  const sources = inner.sources.map((source) => ({...source}))
  const sourceIds = new Set(sources.map((source) => source.id))
  /** @type {Map<string, string>} */
  const outerSourceIds = new Map()
  let nextSourceIndex = 0

  for (const source of outer.sources) {
    if (sourceRepresentsGenerated(source, inner.generated)) continue
    let composedSource = sources.find((candidate) => sameRegisteredSource(candidate, source))

    if (!composedSource) {
      while (sourceIds.has(`source:${nextSourceIndex}`)) nextSourceIndex++
      composedSource = {...source, id: `source:${nextSourceIndex}`}
      sourceIds.add(composedSource.id)
      sources.push(composedSource)
    }
    outerSourceIds.set(source.id, composedSource.id)
  }

  const spans = outer.spans.flatMap((span) => {
    const location = primaryLocation(span.origin)
    const sourceId = sourceIdForOrigin(span.origin)
    const source = sourceId ? outerIndex.sourcesById.get(sourceId) : undefined
    const tracesIntermediate = source ? sourceRepresentsGenerated(source, inner.generated) : false
    const overlapping = tracesIntermediate && location
      ? spansOverlappingGenerated(inner.spans, location.start.offset, location.end.offset)
      : []
    const traced = overlapping[0] ?? (tracesIntermediate && location
      ? spanForGenerated(inner.spans, location.start.offset)
      : undefined)

    if (!traced) {
      const unidentified = {...span}

      delete unidentified.nodeId
      delete unidentified.symbolId

      return [{...unidentified, origin: remapOriginSourceIds(span.origin, outerSourceIds)}]
    }

    if (location && overlapping.length > 1 && span.mappingKind == "exact" &&
      span.generated.end.offset - span.generated.start.offset == location.end.offset - location.start.offset) {
      return overlapping.map((candidate) => {
        const overlapStart = Math.max(location.start.offset, candidate.generated.start.offset)
        const overlapEnd = Math.min(location.end.offset, candidate.generated.end.offset)
        const generatedStart = span.generated.start.offset + overlapStart - location.start.offset
        const generatedEnd = span.generated.start.offset + overlapEnd - location.start.offset
        const preservesWholeOrigin = overlapStart == candidate.generated.start.offset && overlapEnd == candidate.generated.end.offset

        return composedSpan(span, candidate, locationFromOffsets(
          outer.generated.filename,
          outer.generated.content,
          generatedStart,
          generatedEnd
        ), preservesWholeOrigin)
      })
    }

    const preservesWholeOrigin = Boolean(location && location.start.offset == traced.generated.start.offset &&
      location.end.offset == traced.generated.end.offset)

    return [composedSpan(span, traced, span.generated, preservesWholeOrigin)]
  })

  return finalizeMapping({
    coordinateSystem: "utf16",
    generated: outer.generated,
    nodes: inner.nodes,
    schema: "SemantifoldMapping",
    sources,
    spans,
    symbols: inner.symbols,
    version: 1
  })

  /**
   * Composes one outer generated range with an inner range.
   * @param {import("./semantic/types.js").SemantifoldMappingSpan} outerSpan - Outer span.
   * @param {import("./semantic/types.js").SemantifoldMappingSpan} innerSpan - Inner span.
   * @param {import("./semantic/types.js").SourceLocation} generated - Final generated subrange.
   * @param {boolean} preservesWholeOrigin - Whether adopting the inner origin retains its complete range.
   * @returns {import("./semantic/types.js").SemantifoldMappingSpan} Composed span.
   */
  function composedSpan(outerSpan, innerSpan, generated, preservesWholeOrigin) {
    if (outerSpan.mappingKind == "synthetic" && outerSpan.origin.kind == "synthetic") {
      const relationship = outerSpan.origin.relatedOrigins[0]

      return definedProperties({
        generated,
        mappingKind: /** @type {const} */ ("synthetic"),
        name: outerSpan.name,
        origin: {
          kind: /** @type {const} */ ("synthetic"),
          reason: outerSpan.origin.reason,
          relatedOrigins: relatedOriginsForSpan(innerSpan).map((related) => definedProperties({
            ...related,
            nodeId: related.nodeId ?? innerSpan.nodeId,
            role: relationship?.role ?? related.role,
            symbolId: related.symbolId ?? innerSpan.symbolId
          }))
        },
        role: outerSpan.role
      })
    }

    return definedProperties({
      ...outerSpan,
      generated,
      mappingKind: innerSpan.mappingKind == "synthetic" ? /** @type {const} */ ("synthetic") :
        outerSpan.mappingKind == "exact" && innerSpan.mappingKind == "exact" && preservesWholeOrigin
          ? /** @type {const} */ ("exact")
          : /** @type {const} */ ("anchor"),
      name: outerSpan.name ?? innerSpan.name,
      nodeId: innerSpan.nodeId,
      origin: innerSpan.origin,
      role: innerSpan.role ?? outerSpan.role,
      symbolId: innerSpan.symbolId
    })
  }
}

/**
 * Converts one mapped span's closed origin into related provenance.
 * @param {import("./semantic/types.js").SemantifoldMappingSpan} span - Traced inner span.
 * @returns {import("./semantic/types.js").RelatedOrigin[]} Related original ranges.
 */
function relatedOriginsForSpan(span) {
  if (span.origin.kind == "source") {
    return [{location: span.origin.location, sourceId: span.origin.sourceId}]
  }
  if (span.origin.kind == "derived") return span.origin.origins

  return span.origin.relatedOrigins
}

/**
 * Determines whether a registered source is the generated artifact consumed by an inner map.
 * @param {import("./semantic/types.js").RegisteredSource} source - Outer source registry entry.
 * @param {import("./semantic/types.js").GeneratedSource} generated - Inner generated artifact.
 * @returns {boolean} Whether identity-selected provenance may be traced through the inner map.
 */
function sourceRepresentsGenerated(source, generated) {
  return source.filename == generated.filename && source.content == generated.content &&
    (source.language == null || source.language == generated.language)
}

/**
 * Compares complete registered-source identity fields other than registry-local ID.
 * @param {import("./semantic/types.js").RegisteredSource} left - First registered source.
 * @param {import("./semantic/types.js").RegisteredSource} right - Second registered source.
 * @returns {boolean} Whether both entries represent the same source artifact.
 */
function sameRegisteredSource(left, right) {
  return left.filename == right.filename && left.content == right.content && left.language == right.language
}

/**
 * Composes Source Map v3 maps with maintained tracing machinery.
 * @param {import("@jridgewell/trace-mapping").SourceMapInput} outer - Final output to intermediate map.
 * @param {import("@jridgewell/trace-mapping").SourceMapInput} inner - Intermediate to original map.
 * @returns {import("@jridgewell/gen-mapping").EncodedSourceMap} Composed v3 map.
 */
export function composeSourceMaps(outer, inner) {
  const outerMap = new TraceMap(outer)
  const innerMap = new TraceMap(inner)
  const composed = new GenMapping({file: outerMap.file})
  const intermediateIndexes = typeof innerMap.file == "string"
    ? outerMap.resolvedSources.flatMap((source, index) => source == innerMap.file ? [index] : [])
    : []
  const intermediateIndex = intermediateIndexes.length == 1 ? intermediateIndexes[0] : undefined
  const intermediateSource = intermediateIndex === undefined ? undefined : outerMap.resolvedSources[intermediateIndex]

  for (const source of innerMap.sources) {
    if (source != null) setSourceContent(composed, source, sourceContentFor(innerMap, source))
  }
  outerMap.sources.forEach((source, index) => {
    if (source != null && index != intermediateIndex) {
      setSourceContent(composed, source, sourceContentFor(outerMap, source))
    }
  })

  eachMapping(outerMap, (mapping) => {
    if (mapping.source == null || mapping.originalLine == null || mapping.originalColumn == null) {
      maybeAddSegment(composed, mapping.generatedLine - 1, mapping.generatedColumn)
      return
    }

    const isIntermediate = intermediateSource !== undefined && mapping.source == intermediateSource
    const traced = isIntermediate
      ? traceOriginalPositionFor(innerMap, {column: mapping.originalColumn, line: mapping.originalLine})
      : {column: mapping.originalColumn, line: mapping.originalLine, name: mapping.name, source: mapping.source}

    if (traced.source == null || traced.line == null || traced.column == null) {
      maybeAddSegment(composed, mapping.generatedLine - 1, mapping.generatedColumn)
      return
    }

    const content = isIntermediate ? sourceContentFor(innerMap, traced.source) : sourceContentFor(outerMap, traced.source)
    const name = traced.name ?? mapping.name

    if (name == null) {
      addSegment(composed, mapping.generatedLine - 1, mapping.generatedColumn, traced.source, traced.line - 1, traced.column, null, content)
    } else {
      addSegment(composed, mapping.generatedLine - 1, mapping.generatedColumn, traced.source, traced.line - 1, traced.column, name, content)
    }
  })

  return toEncodedMap(composed)
}

/**
 * Imports a point-based Source Map v3 as a range-based Semantifold map.
 * @param {import("@jridgewell/trace-mapping").SourceMapInput} sourceMap - Source Map v3.
 * @param {object} generated - Generated program.
 * @param {string} generated.content - Exact generated content.
 * @param {string} generated.filename - Generated filename.
 * @param {import("./semantic/types.js").SemanticLanguage} generated.language - Generated language.
 * @param {{filename: string, content: string, language?: import("./semantic/types.js").SemanticLanguage}[]} [generated.sources] - Exact source content overrides.
 * @returns {import("./semantic/types.js").SemantifoldMapping} Imported rich map.
 */
export function mappingFromSourceMap(sourceMap, {content, filename, language, sources: provided = []}) {
  const trace = new TraceMap(sourceMap)
  const generatedCoordinates = createCoordinateIndex(content)
  /** @type {import("./semantic/types.js").RegisteredSource[]} */
  const sources = []

  trace.sources.forEach((source, index) => {
    if (source == null) return

    const providedSource = provided.find((candidate) => candidate.filename == source || source.endsWith(`/${candidate.filename}`))
    sources.push({
      content: providedSource?.content ?? trace.sourcesContent?.[index] ?? null,
      filename: providedSource?.filename ?? source,
      id: `source:${sources.length}`,
      language: providedSource?.language ?? null
    })
  })
  const sourceCoordinates = new Map(sources.filter((source) => source.content != null)
    .map((source) => [source.id, createCoordinateIndex(/** @type {string} */ (source.content))]))

  /** @type {{generatedOffset: number, mapping: import("@jridgewell/trace-mapping").EachMapping}[]} */
  const points = []

  eachMapping(trace, (mapping) => {
    points.push({generatedOffset: indexedOffsetAt(generatedCoordinates, mapping.generatedLine, mapping.generatedColumn + 1), mapping})
  })

  /** @type {import("./semantic/types.js").SemantifoldMappingSpan[]} */
  const mappedSpans = []

  points.forEach(({generatedOffset, mapping}, index) => {
    const next = points[index + 1]
    const end = next?.mapping.generatedLine == mapping.generatedLine
      ? next.generatedOffset
      : lineEndOffset(content, generatedOffset)

    if (end <= generatedOffset) return

    if (mapping.source == null || mapping.originalLine == null || mapping.originalColumn == null) {
      mappedSpans.push({
        generated: locationFromOffsets(filename, content, generatedOffset, end),
        mappingKind: "synthetic",
        origin: {kind: "synthetic", reason: "unmapped Source Map segment", relatedOrigins: []}
      })
      return
    }

    const source = sources.find((candidate) => candidate.filename == mapping.source || mapping.source?.endsWith(`/${candidate.filename}`))

    if (!source) throw new RangeError(`Source Map references unregistered source '${mapping.source}'.`)

    const originalOffset = source.content == null
      ? 0
      : indexedOffsetAt(/** @type {ReturnType<typeof createCoordinateIndex>} */ (sourceCoordinates.get(source.id)),
          mapping.originalLine, mapping.originalColumn + 1)
    const originalEnd = source.content == null ? originalOffset : Math.min(source.content.length, originalOffset + 1)
    const originalLocation = source.content == null
      ? {
          end: {column: mapping.originalColumn + 1, line: mapping.originalLine, offset: originalOffset},
          filename: source.filename,
          start: {column: mapping.originalColumn + 1, line: mapping.originalLine, offset: originalOffset}
        }
      : locationFromOffsets(source.filename, source.content, originalOffset, originalEnd)

    mappedSpans.push(definedProperties({
      generated: locationFromOffsets(filename, content, generatedOffset, end),
      mappingKind: "anchor",
      name: mapping.name ?? undefined,
      origin: {kind: "source", location: originalLocation, sourceId: source.id}
    }))
  })

  /** @type {import("./semantic/types.js").SemantifoldMappingSpan[]} */
  const spans = []
  let cursor = 0

  for (const span of mappedSpans) {
    if (span.generated.start.offset > cursor) spans.push(unmappedSpan(cursor, span.generated.start.offset))
    if (span.generated.end.offset > cursor) {
      spans.push(span.generated.start.offset < cursor ? {
        ...span,
        generated: locationFromOffsets(filename, content, cursor, span.generated.end.offset)
      } : span)
      cursor = span.generated.end.offset
    }
  }
  if (cursor < content.length) spans.push(unmappedSpan(cursor, content.length))

  return finalizeMapping({
    coordinateSystem: "utf16",
    generated: {content, filename, language},
    nodes: [],
    schema: "SemantifoldMapping",
    sources,
    spans,
    symbols: [],
    version: 1
  })

  /**
   * Creates one explicit unmapped range.
   * @param {number} start - Generated start offset.
   * @param {number} end - Generated end offset.
   * @returns {import("./semantic/types.js").SemantifoldMappingSpan} Synthetic span.
   */
  function unmappedSpan(start, end) {
    return {
      generated: locationFromOffsets(filename, content, start, end),
      mappingKind: "synthetic",
      origin: {kind: "synthetic", reason: "unmapped Source Map range", relatedOrigins: []}
    }
  }
}

/**
 * Remaps a generated location while retaining the generated range in the result.
 * @param {import("./semantic/types.js").SourceLocation} location - Generated location.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @returns {ReturnType<typeof originalPositionFor>} Remapped lookup.
 */
export function remapLocation(location, mapping) {
  if (location.filename != mapping.generated.filename) throw new RangeError(`Location is not in ${mapping.generated.filename}.`)

  return originalPositionFor(mapping, {offset: location.start.offset})
}

/**
 * Remaps a Semantifold diagnostic and preserves its generated location and cause.
 * @param {SemantifoldDiagnostic} diagnostic - Generated-program diagnostic.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @returns {SemantifoldDiagnostic} Remapped diagnostic.
 */
export function remapDiagnostic(diagnostic, mapping) {
  if (!diagnostic.location) return diagnostic

  const remapped = remapLocation(diagnostic.location, mapping)

  if (!remapped.location) return diagnostic

  return new SemantifoldDiagnostic({
    cause: diagnostic,
    code: diagnostic.code,
    generatedLocation: diagnostic.location,
    language: diagnostic.language,
    location: remapped.location,
    message: diagnostic.detail
  })
}

/**
 * Validates the public mapping envelope and ordered half-open generated ranges.
 * @param {unknown} value - Candidate mapping.
 * @returns {asserts value is import("./semantic/types.js").SemantifoldMapping} Nothing when valid.
 */
export function validateMapping(value) {
  if (!value || typeof value != "object" || Reflect.get(value, "schema") != "SemantifoldMapping" ||
    Reflect.get(value, "version") != 1 || Reflect.get(value, "coordinateSystem") != "utf16") {
    throw new TypeError("Expected a SemantifoldMapping v1 value.")
  }

  const mapping = /** @type {Record<string, unknown>} */ (value)
  const generated = /** @type {Record<string, unknown>} */ (mapping.generated)
  const spans = mapping.spans

  if (!generated || typeof generated != "object" || typeof Reflect.get(generated, "filename") != "string" ||
    typeof Reflect.get(generated, "content") != "string" || !isLanguage(Reflect.get(generated, "language")) ||
    !Array.isArray(mapping.sources) ||
    !Array.isArray(mapping.nodes) || !Array.isArray(mapping.symbols) || !Array.isArray(spans)) {
    throw new TypeError("Malformed SemantifoldMapping v1 envelope.")
  }

  const content = /** @type {string} */ (generated.content)
  const filename = /** @type {string} */ (generated.filename)

  if (content.includes("\r")) throw new TypeError("SemantifoldMapping generated content must use LF line endings.")

  const sourceIds = new Set()

  for (const source of mapping.sources) {
    if (!source || typeof source != "object" || typeof source.id != "string" || source.id.length == 0 || sourceIds.has(source.id) ||
      typeof source.filename != "string" || source.filename.length == 0 || source.content !== null && typeof source.content != "string" ||
      source.language !== null && !isLanguage(source.language)) {
      throw new TypeError("Malformed or duplicate SemantifoldMapping source.")
    }
    sourceIds.add(source.id)
  }
  const sourceCoordinates = new Map(mapping.sources.filter((source) => source.content != null)
    .map((source) => [source.id, createCoordinateIndex(/** @type {string} */ (source.content))]))
  const sourcesById = new Map(mapping.sources.map((source) => [source.id, source]))
  /** @type {Map<string, import("./semantic/types.js").RegisteredSource[]>} */
  const sourcesByFilename = new Map()

  for (const source of mapping.sources) {
    const sameName = sourcesByFilename.get(source.filename) ?? []

    sameName.push(source)
    sourcesByFilename.set(source.filename, sameName)
  }
  const generatedCoordinates = createCoordinateIndex(content)

  const nodeIds = new Set()
  const nodePaths = new Set()

  for (const node of mapping.nodes) {
    if (!node || typeof node != "object" || typeof node.id != "string" || node.id.length == 0 || nodeIds.has(node.id) ||
      typeof node.path != "string" || nodePaths.has(node.path) ||
      typeof node.kind != "string" || node.kind.length == 0 || !node.origin || typeof node.ranges != "object" ||
      node.ranges === null || Array.isArray(node.ranges)) throw new TypeError("Malformed or duplicate semantic node identity.")
    nodeIds.add(node.id)
    nodePaths.add(node.path)
  }

  const symbolIds = new Set()

  for (const symbol of mapping.symbols) {
    if (!symbol || typeof symbol != "object" || typeof symbol.id != "string" || symbol.id.length == 0 || symbolIds.has(symbol.id) ||
      typeof symbol.name != "string" || symbol.name.length == 0 || !["function", "parameter", "local"].includes(symbol.kind) ||
      !nodeIds.has(symbol.declarationNodeId) || !Array.isArray(symbol.references)) {
      throw new TypeError("Malformed or duplicate semantic symbol identity.")
    }
    symbolIds.add(symbol.id)
  }

  for (const node of mapping.nodes) {
    validateOrigin(node.origin, sourcesById, sourceCoordinates, nodeIds, symbolIds)
    for (const [role, location] of Object.entries(node.ranges)) {
      if (role.length == 0) throw new TypeError("Semantic node range roles must be non-empty strings.")
      validateLocationForSources(location, sourcesByFilename, sourceCoordinates)
    }
    if (node.symbolId !== undefined && (typeof node.symbolId != "string" || !symbolIds.has(node.symbolId))) {
      throw new TypeError("Semantic node references an unknown symbol.")
    }
  }

  for (const symbol of mapping.symbols) {
    validateLocationForSources(symbol.location, sourcesByFilename, sourceCoordinates)
    for (const reference of symbol.references) {
      if (!reference || typeof reference != "object" || !nodeIds.has(reference.nodeId) ||
        !["declaration", "read", "write", "call"].includes(reference.role)) {
        throw new TypeError("Malformed semantic symbol reference.")
      }
      validateLocationForSources(reference.location, sourcesByFilename, sourceCoordinates)
    }
  }

  let previousEnd = 0

  for (const span of spans) {
    if (!span || typeof span != "object" || !["exact", "anchor", "synthetic"].includes(Reflect.get(span, "mappingKind")) ||
      !Reflect.get(span, "generated") || !Reflect.get(span, "origin")) {
      throw new TypeError("Malformed SemantifoldMapping span.")
    }

    const location = /** @type {import("./semantic/types.js").SourceLocation} */ (Reflect.get(span, "generated"))

    if (!location.start || !location.end || location.filename != filename || location.start.offset != previousEnd ||
      location.end.offset <= location.start.offset || location.end.offset > content.length ||
      !samePoint(indexedPointAt(generatedCoordinates, location.start.offset), location.start) ||
      !samePoint(indexedPointAt(generatedCoordinates, location.end.offset), location.end)) {
      throw new TypeError("SemantifoldMapping spans must exactly cover ordered normalized generated ranges.")
    }
    validateOrigin(
      /** @type {import("./semantic/types.js").SemanticOrigin} */ (Reflect.get(span, "origin")),
      sourcesById,
      sourceCoordinates,
      nodeIds,
      symbolIds
    )
    const nodeId = Reflect.get(span, "nodeId")
    const symbolId = Reflect.get(span, "symbolId")

    if (nodeId !== undefined && (typeof nodeId != "string" || !nodeIds.has(nodeId))) throw new TypeError("Mapping span references an unknown node.")
    if (symbolId !== undefined && (typeof symbolId != "string" || !symbolIds.has(symbolId))) throw new TypeError("Mapping span references an unknown symbol.")
    if (Reflect.get(span, "role") !== undefined && typeof Reflect.get(span, "role") != "string" ||
      Reflect.get(span, "name") !== undefined && typeof Reflect.get(span, "name") != "string") {
      throw new TypeError("Mapping span roles and names must be strings.")
    }
    previousEnd = location.end.offset
  }

  if (previousEnd != content.length) throw new TypeError("SemantifoldMapping spans must cover all generated content.")
}

/**
 * Validates, freezes, and indexes one mapping produced at a trust boundary.
 * @param {unknown} value - Candidate mapping.
 * @returns {import("./semantic/types.js").SemantifoldMapping} Immutable indexed mapping.
 */
export function finalizeMapping(value) {
  // Producers may retain references to mutable semantic locations; mappings own their immutable copy.
  const mapping = structuredClone(value)

  validateMapping(mapping)
  freezeJson(mapping)
  mappingIndexes.set(mapping, buildMappingIndex(mapping))

  return mapping
}

/**
 * Gets an index, validating mutable caller mappings on every trust-boundary use.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Mapping.
 * @returns {MappingIndex} Lookup index.
 */
function mappingIndex(mapping) {
  const cached = mappingIndexes.get(mapping)

  if (cached) return cached

  validateMapping(mapping)

  return buildMappingIndex(mapping)
}

/**
 * Builds generated, original, node, and symbol indexes in one pass.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Validated mapping.
 * @returns {{generatedCoordinates: ReturnType<typeof createCoordinateIndex>, nodeSpans: Map<string, import("./semantic/types.js").SemantifoldMappingSpan[]>, originalBySource: Map<string, {end: number, prefixEnd: number, span: import("./semantic/types.js").SemantifoldMappingSpan, start: number}[]>, sourceCoordinates: Map<string, ReturnType<typeof createCoordinateIndex>>, sourcesById: Map<string, import("./semantic/types.js").RegisteredSource>, symbolSpans: Map<string, import("./semantic/types.js").SemantifoldMappingSpan[]>}} Mapping index.
 */
function buildMappingIndex(mapping) {
  const generatedCoordinates = createCoordinateIndex(mapping.generated.content)
  const sourcesById = new Map(mapping.sources.map((source) => [source.id, source]))
  const sourceCoordinates = new Map(mapping.sources.filter((source) => source.content != null)
    .map((source) => [source.id, createCoordinateIndex(/** @type {string} */ (source.content))]))
  const nodeSpans = new Map(mapping.nodes.map((node) => [node.id, /** @type {import("./semantic/types.js").SemantifoldMappingSpan[]} */ ([])]))
  const symbolSpans = new Map(mapping.symbols.map((symbol) => [symbol.id, /** @type {import("./semantic/types.js").SemantifoldMappingSpan[]} */ ([])]))
  /** @type {Map<string, {end: number, prefixEnd: number, span: import("./semantic/types.js").SemantifoldMappingSpan, start: number}[]>} */
  const originalBySource = new Map(mapping.sources.map((source) => [source.id, []]))

  for (const span of mapping.spans) {
    if (span.nodeId) nodeSpans.get(span.nodeId)?.push(span)
    if (span.symbolId) symbolSpans.get(span.symbolId)?.push(span)
    const location = primaryLocation(span.origin)
    const sourceId = sourceIdForOrigin(span.origin)

    if (location && sourceId && location.end.offset > location.start.offset) {
      originalBySource.get(sourceId)?.push({
        end: location.end.offset,
        prefixEnd: location.end.offset,
        span,
        start: location.start.offset
      })
    }
  }

  for (const entries of originalBySource.values()) {
    entries.sort((left, right) => left.start - right.start || left.span.generated.start.offset - right.span.generated.start.offset)
    let prefixEnd = 0

    for (const entry of entries) {
      prefixEnd = Math.max(prefixEnd, entry.end)
      entry.prefixEnd = prefixEnd
    }
  }

  return {generatedCoordinates, nodeSpans, originalBySource, sourceCoordinates, sourcesById, symbolSpans}
}

/**
 * Finds the generated span containing an offset by binary search.
 * @param {import("./semantic/types.js").SemantifoldMappingSpan[]} spans - Ordered spans.
 * @param {number} offset - Generated offset.
 * @returns {import("./semantic/types.js").SemantifoldMappingSpan | undefined} Containing span.
 */
function spanForGenerated(spans, offset) {
  let low = 0
  let high = spans.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (spans[middle].generated.start.offset <= offset) low = middle + 1
    else high = middle
  }
  const candidate = spans[low - 1]

  return candidate && offset < candidate.generated.end.offset ? candidate : undefined
}

/**
 * Finds ordered generated spans intersecting a half-open range.
 * @param {import("./semantic/types.js").SemantifoldMappingSpan[]} spans - Ordered spans.
 * @param {number} start - Inclusive generated offset.
 * @param {number} end - Exclusive generated offset.
 * @returns {import("./semantic/types.js").SemantifoldMappingSpan[]} Overlapping spans.
 */
function spansOverlappingGenerated(spans, start, end) {
  if (end <= start) {
    const containing = spanForGenerated(spans, start)

    return containing ? [containing] : []
  }

  let low = 0
  let high = spans.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (spans[middle].generated.end.offset <= start) low = middle + 1
    else high = middle
  }
  const overlapping = []

  for (let index = low; index < spans.length && spans[index].generated.start.offset < end; index++) {
    overlapping.push(spans[index])
  }

  return overlapping
}

/**
 * Deep-freezes a JSON tree.
 * @param {unknown} value - JSON value.
 * @param {WeakSet<object>} [visited] - Cycle protection for rejected caller extras.
 * @returns {void}
 */
function freezeJson(value, visited = new WeakSet()) {
  if (!value || typeof value != "object" || visited.has(value)) return

  visited.add(value)
  for (const child of Object.values(value)) freezeJson(child, visited)
  if (!Object.isFrozen(value)) Object.freeze(value)
}

/**
 * Validates one closed mapping origin.
 * @param {import("./semantic/types.js").SemanticOrigin} origin - Origin.
 * @param {Map<string, import("./semantic/types.js").RegisteredSource>} sourcesById - Sources by identity.
 * @param {Map<string, ReturnType<typeof createCoordinateIndex>>} coordinates - Source coordinate indexes.
 * @param {Set<unknown>} [nodeIds] - Known semantic nodes.
 * @param {Set<unknown>} [symbolIds] - Known semantic symbols.
 * @returns {void}
 */
function validateOrigin(origin, sourcesById, coordinates, nodeIds, symbolIds) {
  if (!origin || typeof origin != "object") throw new TypeError("Mapping origin must be a closed provenance value.")

  if (origin.kind == "source") {
    validateRelated({location: origin.location, sourceId: origin.sourceId}, sourcesById, coordinates, nodeIds, symbolIds)
    return
  }
  if (origin.kind == "derived") {
    if (!Array.isArray(origin.origins) || origin.origins.length == 0) throw new TypeError("Derived provenance requires origins.")
    origin.origins.forEach((related) => validateRelated(related, sourcesById, coordinates, nodeIds, symbolIds))
    return
  }
  if (origin.kind == "synthetic") {
    if (typeof origin.reason != "string" || !Array.isArray(origin.relatedOrigins)) throw new TypeError("Malformed synthetic provenance.")
    origin.relatedOrigins.forEach((related) => validateRelated(related, sourcesById, coordinates, nodeIds, symbolIds))
    return
  }

  throw new TypeError("Unknown provenance kind.")
}

/**
 * Validates one source-related origin.
 * @param {import("./semantic/types.js").RelatedOrigin} related - Related origin.
 * @param {Map<string, import("./semantic/types.js").RegisteredSource>} sourcesById - Sources by identity.
 * @param {Map<string, ReturnType<typeof createCoordinateIndex>>} coordinates - Source coordinate indexes.
 * @param {Set<unknown> | undefined} nodeIds - Known semantic nodes.
 * @param {Set<unknown> | undefined} symbolIds - Known semantic symbols.
 * @returns {void}
 */
function validateRelated(related, sourcesById, coordinates, nodeIds, symbolIds) {
  const source = sourcesById.get(related.sourceId)

  if (!source || !related.location || related.location.filename != source.filename ||
    related.nodeId !== undefined && typeof related.nodeId != "string" ||
    related.symbolId !== undefined && typeof related.symbolId != "string" ||
    related.role !== undefined && typeof related.role != "string") throw new TypeError("Origin references an unknown source.")
  if (nodeIds && related.nodeId !== undefined && !nodeIds.has(related.nodeId)) throw new TypeError("Origin references an unknown node.")
  if (symbolIds && related.symbolId !== undefined && !symbolIds.has(related.symbolId)) {
    throw new TypeError("Origin references an unknown symbol.")
  }
  validateLocationForSource(related.location, source, coordinates.get(source.id))
}

/**
 * Validates a location against at least one same-filename source.
 * @param {unknown} value - Candidate location.
 * @param {Map<string, import("./semantic/types.js").RegisteredSource[]>} sourcesByFilename - Sources by filename.
 * @param {Map<string, ReturnType<typeof createCoordinateIndex>>} coordinates - Source coordinate indexes.
 * @returns {void}
 */
function validateLocationForSources(value, sourcesByFilename, coordinates) {
  if (!value || typeof value != "object") throw new TypeError("Malformed original location.")
  const location = /** @type {import("./semantic/types.js").SourceLocation} */ (value)
  const candidates = sourcesByFilename.get(location.filename) ?? []

  if (candidates.length == 0 || !candidates.some((source) => locationMatchesSource(location, source, coordinates.get(source.id)))) {
    throw new TypeError("Stale original location.")
  }
}

/**
 * Validates a location against its identified source.
 * @param {unknown} value - Candidate location.
 * @param {import("./semantic/types.js").RegisteredSource} source - Source.
 * @param {ReturnType<typeof createCoordinateIndex> | undefined} coordinates - Source coordinates when content exists.
 * @returns {void}
 */
function validateLocationForSource(value, source, coordinates) {
  if (!value || typeof value != "object" || !locationMatchesSource(
    /** @type {import("./semantic/types.js").SourceLocation} */ (value), source, coordinates
  )) throw new TypeError("Stale original location.")
}

/**
 * Tests a location against one source entry.
 * @param {import("./semantic/types.js").SourceLocation} location - Location.
 * @param {import("./semantic/types.js").RegisteredSource} source - Source.
 * @param {ReturnType<typeof createCoordinateIndex> | undefined} coordinates - Source coordinates when content exists.
 * @returns {boolean} Whether the range is normalized for the source.
 */
function locationMatchesSource(location, source, coordinates) {
  if (!location || location.filename != source.filename || !location.start || !location.end ||
    !validPoint(location.start) || !validPoint(location.end) || location.end.offset < location.start.offset) return false

  if (source.content == null) return true

  return location.end.offset <= source.content.length && coordinates !== undefined &&
    samePoint(indexedPointAt(coordinates, location.start.offset), location.start) &&
    samePoint(indexedPointAt(coordinates, location.end.offset), location.end)
}

/**
 * Tests the structural validity of one source point.
 * @param {unknown} value - Candidate point.
 * @returns {value is import("./semantic/types.js").SourcePoint} Whether it is a point.
 */
function validPoint(value) {
  if (!value || typeof value != "object") return false
  const point = /** @type {Record<string, unknown>} */ (value)

  return Number.isInteger(point.offset) && Number.isInteger(point.line) && Number.isInteger(point.column) &&
    /** @type {number} */ (point.offset) >= 0 && /** @type {number} */ (point.line) >= 1 && /** @type {number} */ (point.column) >= 1
}

/**
 * Tests a supported semantic language value.
 * @param {unknown} value - Candidate language.
 * @returns {value is import("./semantic/types.js").SemanticLanguage} Whether supported.
 */
function isLanguage(value) {
  return value == "php" || value == "ruby" || value == "javascript" || value == "typescript" || value == "java"
}

/**
 * Builds one stable lookup result.
 * @param {import("./semantic/types.js").SemantifoldMappingSpan} span - Mapping span.
 * @returns {{generatedLocation: import("./semantic/types.js").SourceLocation, location: import("./semantic/types.js").SourceLocation | undefined, mappingKind: import("./semantic/types.js").MappingKind, name: string | undefined, nodeId: string | undefined, role: string | undefined, symbolId: string | undefined}} Lookup result.
 */
function mappingResult(span) {
  return {
    generatedLocation: span.generated,
    location: primaryLocation(span.origin),
    mappingKind: span.mappingKind,
    name: span.name,
    nodeId: span.nodeId,
    role: span.role,
    symbolId: span.symbolId
  }
}

/**
 * Resolves an offset-form or line/column-form position.
 * @param {ReturnType<typeof createCoordinateIndex>} coordinates - Source coordinate index.
 * @param {{offset: number} | {line: number, column: number}} position - Position.
 * @returns {number} UTF-16 offset.
 */
function positionOffset(coordinates, position) {
  if ("offset" in position) {
    indexedPointAt(coordinates, position.offset)

    return position.offset
  }

  return indexedOffsetAt(coordinates, position.line, position.column)
}

/**
 * Finds the exclusive content offset before the next generated line break.
 * @param {string} content - Generated content.
 * @param {number} offset - Offset on the current line.
 * @returns {number} End of the current line or content.
 */
function lineEndOffset(content, offset) {
  const newline = content.indexOf("\n", offset)

  return newline == -1 ? content.length : newline
}

/**
 * Compares complete normalized points.
 * @param {import("./semantic/types.js").SourcePoint} left - Left point.
 * @param {import("./semantic/types.js").SourcePoint} right - Right point.
 * @returns {boolean} Whether coordinates match.
 */
function samePoint(left, right) {
  return left.offset == right.offset && left.line == right.line && left.column == right.column
}

/**
 * Resolves a source registry entry for an origin.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Mapping.
 * @param {import("./semantic/types.js").SemanticOrigin} origin - Origin.
 * @param {import("./semantic/types.js").SourceLocation} location - Primary location.
 * @param {Map<string, import("./semantic/types.js").RegisteredSource>} sourcesById - Indexed sources.
 * @returns {import("./semantic/types.js").RegisteredSource} Registered source.
 */
function sourceForOrigin(mapping, origin, location, sourcesById) {
  const sourceId = sourceIdForOrigin(origin)
  const source = sourcesById.get(sourceId ?? "") ??
    mapping.sources.find((candidate) => candidate.filename == location.filename)

  if (!source) throw new RangeError(`Unknown mapping source for ${location.filename}.`)

  return source
}

/**
 * Resolves the registry identity of an origin's primary location.
 * @param {import("./semantic/types.js").SemanticOrigin} origin - Origin.
 * @returns {string | undefined} Source identity.
 */
function sourceIdForOrigin(origin) {
  if (origin.kind == "source") return origin.sourceId
  if (origin.kind == "derived") return origin.origins[0]?.sourceId

  return origin.relatedOrigins[0]?.sourceId
}

/**
 * Rewrites closed-origin source identities against a composed registry.
 * @param {import("./semantic/types.js").SemanticOrigin} origin - Origin.
 * @param {Map<string, string>} sourceIds - Original-to-composed source identities.
 * @returns {import("./semantic/types.js").SemanticOrigin} Rewritten origin.
 */
function remapOriginSourceIds(origin, sourceIds) {
  if (origin.kind == "source") {
    const sourceId = sourceIds.get(origin.sourceId)

    if (!sourceId) throw new RangeError(`Composed mapping omitted source '${origin.location.filename}'.`)

    return {kind: "source", location: origin.location, sourceId}
  }

  const remapRelated = (/** @type {import("./semantic/types.js").RelatedOrigin} */ related) => {
    const sourceId = sourceIds.get(related.sourceId)

    if (!sourceId) throw new RangeError(`Composed mapping omitted source '${related.location.filename}'.`)

    const unidentified = {...related}

    delete unidentified.nodeId
    delete unidentified.symbolId

    return {...unidentified, sourceId}
  }

  if (origin.kind == "derived") return {kind: "derived", origins: origin.origins.map(remapRelated)}

  return {kind: "synthetic", reason: origin.reason, relatedOrigins: origin.relatedOrigins.map(remapRelated)}
}

/**
 * Sorts object keys recursively while preserving semantic array order.
 * @param {unknown} value - JSON value.
 * @returns {unknown} Deterministically keyed value.
 */
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value == "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, sortJson(child)]))
  }

  return value
}

/**
 * Removes undefined optional properties from a public JSON value.
 * @template {Record<string, unknown>} Value
 * @param {Value} value - Candidate object.
 * @returns {Value} Compact JSON-safe object.
 */
function definedProperties(value) {
  return /** @type {Value} */ (Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)))
}
