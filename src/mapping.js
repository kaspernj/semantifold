// @ts-check

import {addSegment, GenMapping, maybeAddSegment, setSourceContent, toEncodedMap} from "@jridgewell/gen-mapping"
import {
  eachMapping,
  originalPositionFor as traceOriginalPositionFor,
  sourceContentFor,
  TraceMap
} from "@jridgewell/trace-mapping"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {locationFromOffsets, pointAt} from "./semantic/location.js"
import {primaryLocation} from "./semantic/provenance.js"

/**
 * Projects an authoritative Semantifold mapping to Source Map v3.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @returns {import("@jridgewell/gen-mapping").EncodedSourceMap} Source Map v3.
 */
export function toSourceMapV3(mapping) {
  validateMapping(mapping)

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

    const registered = sourceForOrigin(mapping, span.origin, location)

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
  validateMapping(mapping)
  const offset = positionOffset(mapping.generated.content, position)
  const span = mapping.spans.find((candidate) => offset >= candidate.generated.start.offset && offset < candidate.generated.end.offset)

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
  validateMapping(mapping)
  const source = "sourceId" in position
    ? mapping.sources.find((candidate) => candidate.id == position.sourceId)
    : mapping.sources.find((candidate) => candidate.filename == position.filename)

  if (!source) return []
  if (source.content == null && !("offset" in position)) {
    throw new TypeError(`Source content is required for line/column lookup of ${source.filename}.`)
  }

  const offset = "offset" in position ? position.offset : offsetAt(source.content ?? "", position.line, position.column)

  return mapping.spans.filter((span) => {
    const location = primaryLocation(span.origin)

    return location?.filename == source.filename && sourceIdForOrigin(span.origin) == source.id &&
      offset >= location.start.offset && offset < location.end.offset
  }).map(mappingResult)
}

/**
 * Returns every generated span associated with one canonical semantic node.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @param {string} nodeId - Canonical node identity.
 * @returns {import("./semantic/types.js").SemantifoldMappingSpan[]} Matching spans.
 */
export function spansForNode(mapping, nodeId) {
  validateMapping(mapping)
  if (!mapping.nodes.some((node) => node.id == nodeId)) throw new RangeError(`Unknown semantic node: ${nodeId}`)

  return mapping.spans.filter((span) => span.nodeId == nodeId)
}

/**
 * Returns every generated span associated with one canonical semantic symbol.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @param {string} symbolId - Canonical symbol identity.
 * @returns {import("./semantic/types.js").SemantifoldMappingSpan[]} Matching spans.
 */
export function spansForSymbol(mapping, symbolId) {
  validateMapping(mapping)
  if (!mapping.symbols.some((symbol) => symbol.id == symbolId)) throw new RangeError(`Unknown semantic symbol: ${symbolId}`)

  return mapping.spans.filter((span) => span.symbolId == symbolId)
}

/**
 * Serializes a validated rich mapping deterministically.
 * @param {import("./semantic/types.js").SemantifoldMapping} mapping - Rich mapping.
 * @returns {string} Canonical pretty JSON with one trailing LF.
 */
export function stringifyMapping(mapping) {
  validateMapping(mapping)

  return `${JSON.stringify(sortJson(mapping), null, 2)}\n`
}

/**
 * Parses and validates a rich mapping.
 * @param {string} serialized - Mapping JSON.
 * @returns {import("./semantic/types.js").SemantifoldMapping} Parsed mapping.
 */
export function parseMapping(serialized) {
  const mapping = /** @type {unknown} */ (JSON.parse(serialized))

  validateMapping(mapping)

  return mapping
}

/**
 * Composes an outer rich map through an inner rich map.
 * @param {import("./semantic/types.js").SemantifoldMapping} outer - Final output to intermediate map.
 * @param {import("./semantic/types.js").SemantifoldMapping} inner - Intermediate to original map.
 * @returns {import("./semantic/types.js").SemantifoldMapping} Composed rich map.
 */
export function composeMappings(outer, inner) {
  validateMapping(outer)
  validateMapping(inner)

  /** @type {import("./semantic/types.js").RegisteredSource[]} */
  const sources = inner.sources.map((source, index) => ({...source, id: `source:${index}`}))

  for (const source of outer.sources) {
    if (source.filename == inner.generated.filename) continue
    if (!sources.some((candidate) => candidate.filename == source.filename && candidate.content == source.content)) {
      sources.push({...source, id: `source:${sources.length}`})
    }
  }

  const spans = outer.spans.map((span) => {
    const location = primaryLocation(span.origin)
    const traced = location?.filename == inner.generated.filename
      ? inner.spans.find((candidate) => location.start.offset >= candidate.generated.start.offset &&
        location.start.offset < candidate.generated.end.offset)
      : undefined

    if (!traced) {
      const unidentified = {...span}

      delete unidentified.nodeId
      delete unidentified.symbolId

      return {...unidentified, origin: remapOriginSources(span.origin, outer.sources, sources, false)}
    }

    return definedProperties({
      ...span,
      mappingKind: traced.mappingKind == "synthetic" ? /** @type {const} */ ("synthetic") :
        span.mappingKind == "exact" && traced.mappingKind == "exact" ? /** @type {const} */ ("exact") : /** @type {const} */ ("anchor"),
      name: span.name ?? traced.name,
      nodeId: traced.nodeId,
      origin: remapOriginSources(traced.origin, inner.sources, sources, true),
      role: traced.role ?? span.role,
      symbolId: traced.symbolId
    })
  })

  return {
    coordinateSystem: "utf16",
    generated: outer.generated,
    nodes: inner.nodes,
    schema: "SemantifoldMapping",
    sources,
    spans,
    symbols: inner.symbols,
    version: 1
  }
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

  for (const source of innerMap.sources) {
    if (source != null) setSourceContent(composed, source, sourceContentFor(innerMap, source))
  }
  for (const source of outerMap.sources) {
    if (source != null && source != innerMap.file && !source.endsWith(`/${innerMap.file}`)) {
      setSourceContent(composed, source, sourceContentFor(outerMap, source))
    }
  }

  eachMapping(outerMap, (mapping) => {
    if (mapping.source == null || mapping.originalLine == null || mapping.originalColumn == null) {
      maybeAddSegment(composed, mapping.generatedLine - 1, mapping.generatedColumn)
      return
    }

    const isIntermediate = mapping.source == innerMap.file || mapping.source.endsWith(`/${innerMap.file}`)
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

  /** @type {{generatedOffset: number, mapping: import("@jridgewell/trace-mapping").EachMapping}[]} */
  const points = []

  eachMapping(trace, (mapping) => {
    points.push({generatedOffset: offsetAt(content, mapping.generatedLine, mapping.generatedColumn + 1), mapping})
  })

  /** @type {import("./semantic/types.js").SemantifoldMappingSpan[]} */
  const spans = []

  if (points.length == 0 && content.length > 0) {
    spans.push({
      generated: locationFromOffsets(filename, content, 0, content.length),
      mappingKind: "synthetic",
      origin: {kind: "synthetic", reason: "unmapped Source Map content", relatedOrigins: []}
    })
  } else if (points[0]?.generatedOffset > 0) {
    spans.push({
      generated: locationFromOffsets(filename, content, 0, points[0].generatedOffset),
      mappingKind: "synthetic",
      origin: {kind: "synthetic", reason: "unmapped Source Map prefix", relatedOrigins: []}
    })
  }

  points.forEach(({generatedOffset, mapping}, index) => {
    const end = points[index + 1]?.generatedOffset ?? content.length

    if (end <= generatedOffset) return

    if (mapping.source == null || mapping.originalLine == null || mapping.originalColumn == null) {
      spans.push({
        generated: locationFromOffsets(filename, content, generatedOffset, end),
        mappingKind: "synthetic",
        origin: {kind: "synthetic", reason: "unmapped Source Map segment", relatedOrigins: []}
      })
      return
    }

    const source = sources.find((candidate) => candidate.filename == mapping.source || mapping.source?.endsWith(`/${candidate.filename}`))

    if (!source) throw new RangeError(`Source Map references unregistered source '${mapping.source}'.`)

    const originalOffset = source.content == null ? 0 : offsetAt(source.content, mapping.originalLine, mapping.originalColumn + 1)
    const originalEnd = source.content == null ? originalOffset : Math.min(source.content.length, originalOffset + 1)
    const originalLocation = source.content == null
      ? {
          end: {column: mapping.originalColumn + 1, line: mapping.originalLine, offset: originalOffset},
          filename: source.filename,
          start: {column: mapping.originalColumn + 1, line: mapping.originalLine, offset: originalOffset}
        }
      : locationFromOffsets(source.filename, source.content, originalOffset, originalEnd)

    spans.push(definedProperties({
      generated: locationFromOffsets(filename, content, generatedOffset, end),
      mappingKind: "anchor",
      name: mapping.name ?? undefined,
      origin: {kind: "source", location: originalLocation, sourceId: source.id}
    }))
  })

  return {
    coordinateSystem: "utf16",
    generated: {content, filename, language},
    nodes: [],
    schema: "SemantifoldMapping",
    sources,
    spans,
    symbols: [],
    version: 1
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
    validateOrigin(node.origin, mapping.sources, nodeIds, symbolIds)
    for (const [role, location] of Object.entries(node.ranges)) {
      if (role.length == 0) throw new TypeError("Semantic node range roles must be non-empty strings.")
      validateLocationForSources(location, mapping.sources)
    }
    if (node.symbolId !== undefined && (typeof node.symbolId != "string" || !symbolIds.has(node.symbolId))) {
      throw new TypeError("Semantic node references an unknown symbol.")
    }
  }

  for (const symbol of mapping.symbols) {
    validateLocationForSources(symbol.location, mapping.sources)
    for (const reference of symbol.references) {
      if (!reference || typeof reference != "object" || !nodeIds.has(reference.nodeId) ||
        !["declaration", "read", "write", "call"].includes(reference.role)) {
        throw new TypeError("Malformed semantic symbol reference.")
      }
      validateLocationForSources(reference.location, mapping.sources)
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
      !samePoint(pointAt(content, location.start.offset), location.start) ||
      !samePoint(pointAt(content, location.end.offset), location.end)) {
      throw new TypeError("SemantifoldMapping spans must exactly cover ordered normalized generated ranges.")
    }
    validateOrigin(
      /** @type {import("./semantic/types.js").SemanticOrigin} */ (Reflect.get(span, "origin")),
      mapping.sources,
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
 * Validates one closed mapping origin.
 * @param {import("./semantic/types.js").SemanticOrigin} origin - Origin.
 * @param {import("./semantic/types.js").RegisteredSource[]} sources - Sources.
 * @param {Set<unknown>} [nodeIds] - Known semantic nodes.
 * @param {Set<unknown>} [symbolIds] - Known semantic symbols.
 * @returns {void}
 */
function validateOrigin(origin, sources, nodeIds, symbolIds) {
  if (!origin || typeof origin != "object") throw new TypeError("Mapping origin must be a closed provenance value.")

  if (origin.kind == "source") {
    validateRelated({location: origin.location, sourceId: origin.sourceId}, sources, nodeIds, symbolIds)
    return
  }
  if (origin.kind == "derived") {
    if (!Array.isArray(origin.origins) || origin.origins.length == 0) throw new TypeError("Derived provenance requires origins.")
    origin.origins.forEach((related) => validateRelated(related, sources, nodeIds, symbolIds))
    return
  }
  if (origin.kind == "synthetic") {
    if (typeof origin.reason != "string" || !Array.isArray(origin.relatedOrigins)) throw new TypeError("Malformed synthetic provenance.")
    origin.relatedOrigins.forEach((related) => validateRelated(related, sources, nodeIds, symbolIds))
    return
  }

  throw new TypeError("Unknown provenance kind.")
}

/**
 * Validates one source-related origin.
 * @param {import("./semantic/types.js").RelatedOrigin} related - Related origin.
 * @param {import("./semantic/types.js").RegisteredSource[]} sources - Sources.
 * @param {Set<unknown> | undefined} nodeIds - Known semantic nodes.
 * @param {Set<unknown> | undefined} symbolIds - Known semantic symbols.
 * @returns {void}
 */
function validateRelated(related, sources, nodeIds, symbolIds) {
  const source = sources.find((candidate) => candidate.id == related.sourceId)

  if (!source || !related.location || related.location.filename != source.filename ||
    related.nodeId !== undefined && typeof related.nodeId != "string" ||
    related.symbolId !== undefined && typeof related.symbolId != "string" ||
    related.role !== undefined && typeof related.role != "string") throw new TypeError("Origin references an unknown source.")
  if (nodeIds && related.nodeId !== undefined && !nodeIds.has(related.nodeId)) throw new TypeError("Origin references an unknown node.")
  if (symbolIds && related.symbolId !== undefined && !symbolIds.has(related.symbolId)) {
    throw new TypeError("Origin references an unknown symbol.")
  }
  validateLocationForSource(related.location, source)
}

/**
 * Validates a location against at least one same-filename source.
 * @param {unknown} value - Candidate location.
 * @param {import("./semantic/types.js").RegisteredSource[]} sources - Sources.
 * @returns {void}
 */
function validateLocationForSources(value, sources) {
  if (!value || typeof value != "object") throw new TypeError("Malformed original location.")
  const location = /** @type {import("./semantic/types.js").SourceLocation} */ (value)
  const candidates = sources.filter((source) => source.filename == location.filename)

  if (candidates.length == 0 || !candidates.some((source) => locationMatchesSource(location, source))) {
    throw new TypeError("Stale original location.")
  }
}

/**
 * Validates a location against its identified source.
 * @param {unknown} value - Candidate location.
 * @param {import("./semantic/types.js").RegisteredSource} source - Source.
 * @returns {void}
 */
function validateLocationForSource(value, source) {
  if (!value || typeof value != "object" || !locationMatchesSource(
    /** @type {import("./semantic/types.js").SourceLocation} */ (value), source
  )) throw new TypeError("Stale original location.")
}

/**
 * Tests a location against one source entry.
 * @param {import("./semantic/types.js").SourceLocation} location - Location.
 * @param {import("./semantic/types.js").RegisteredSource} source - Source.
 * @returns {boolean} Whether the range is normalized for the source.
 */
function locationMatchesSource(location, source) {
  if (!location || location.filename != source.filename || !location.start || !location.end ||
    !validPoint(location.start) || !validPoint(location.end) || location.end.offset < location.start.offset) return false

  if (source.content == null) return true

  return location.end.offset <= source.content.length && samePoint(pointAt(source.content, location.start.offset), location.start) &&
    samePoint(pointAt(source.content, location.end.offset), location.end)
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
 * @param {string} content - Source content.
 * @param {{offset: number} | {line: number, column: number}} position - Position.
 * @returns {number} UTF-16 offset.
 */
function positionOffset(content, position) {
  if ("offset" in position) {
    pointAt(content, position.offset)

    return position.offset
  }

  return offsetAt(content, position.line, position.column)
}

/**
 * Converts a one-based line and column to a UTF-16 offset.
 * @param {string} content - Source content.
 * @param {number} line - One-based line.
 * @param {number} column - One-based UTF-16 column.
 * @returns {number} UTF-16 offset.
 */
function offsetAt(content, line, column) {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
    throw new RangeError(`Invalid source position ${line}:${column}.`)
  }

  for (let offset = 0; offset <= content.length; offset++) {
    const point = pointAt(content, offset)

    if (point.line == line && point.column == column) return offset
  }

  throw new RangeError(`Invalid source position ${line}:${column}.`)
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
 * @returns {import("./semantic/types.js").RegisteredSource} Registered source.
 */
function sourceForOrigin(mapping, origin, location) {
  const sourceId = sourceIdForOrigin(origin)
  const source = mapping.sources.find((candidate) => candidate.id == sourceId) ??
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
 * @param {import("./semantic/types.js").RegisteredSource[]} originalSources - Registry owning the origin.
 * @param {import("./semantic/types.js").RegisteredSource[]} composedSources - Composed sources.
 * @param {boolean} preserveIdentities - Whether related node/symbol identities belong to the composed node index.
 * @returns {import("./semantic/types.js").SemanticOrigin} Rewritten origin.
 */
function remapOriginSources(origin, originalSources, composedSources, preserveIdentities) {
  if (origin.kind == "source") {
    const source = remappedSource(origin.sourceId, origin.location.filename)

    if (!source) throw new RangeError(`Composed mapping omitted source '${origin.location.filename}'.`)

    return {kind: "source", location: origin.location, sourceId: source.id}
  }

  const remapRelated = (/** @type {import("./semantic/types.js").RelatedOrigin} */ related) => {
    const source = remappedSource(related.sourceId, related.location.filename)

    if (!source) throw new RangeError(`Composed mapping omitted source '${related.location.filename}'.`)

    if (preserveIdentities) return {...related, sourceId: source.id}

    const unidentified = {...related}

    delete unidentified.nodeId
    delete unidentified.symbolId

    return {...unidentified, sourceId: source.id}
  }

  if (origin.kind == "derived") return {kind: "derived", origins: origin.origins.map(remapRelated)}

  return {kind: "synthetic", reason: origin.reason, relatedOrigins: origin.relatedOrigins.map(remapRelated)}

  /**
   * Resolves one old registry identity into the deterministic composed registry.
   * @param {string} sourceId - Old source identity.
   * @param {string} filename - Location filename.
   * @returns {import("./semantic/types.js").RegisteredSource | undefined} Composed source.
   */
  function remappedSource(sourceId, filename) {
    const original = originalSources.find((source) => source.id == sourceId)

    return original
      ? composedSources.find((source) => source.filename == original.filename && source.content == original.content)
      : composedSources.find((source) => source.filename == filename)
  }
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
