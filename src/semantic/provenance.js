// @ts-check

import {createCoordinateIndex, indexedPointAt} from "./location.js"

/** @type {WeakMap<object, Readonly<Record<string, import("./types.js").SourceLocation>>>} */
const parserRanges = new WeakMap()
/** @type {WeakMap<import("./types.js").RegisteredSource, ReturnType<typeof createCoordinateIndex>>} */
const sourceCoordinateIndexes = new WeakMap()

/**
 * Records parser-provided semantic-token ranges without exposing parser trees.
 * @param {object} node - Semantic node.
 * @param {Readonly<Record<string, import("./types.js").SourceLocation>>} ranges - Exact role ranges.
 * @returns {void}
 */
export function setParserRanges(node, ranges) {
  parserRanges.set(node, ranges)
}

/**
 * Records parser ranges and returns the same semantic node.
 * @template {object} Node
 * @param {Node} node - Semantic node.
 * @param {Readonly<Record<string, import("./types.js").SourceLocation>>} ranges - Exact role ranges.
 * @returns {Node} The same node.
 */
export function withParserRanges(node, ranges) {
  setParserRanges(node, ranges)

  return node
}

/**
 * Adds deterministic provenance to a validated frontend module.
 * @param {import("./types.js").SemanticModule} module - Validated semantic module.
 * @param {object} source - Parsed source.
 * @param {string} source.filename - Source filename.
 * @param {import("./types.js").SemanticLanguage} source.language - Source language.
 * @param {string} source.source - Exact source content.
 * @returns {import("./types.js").SemanticModule} The same semantic module.
 */
export function annotateParsedModule(module, {filename, language, source}) {
  const sources = [{content: source, filename, id: "source:0", language}]
  const entries = semanticEntries(module)
  /** @type {Map<string, import("./types.js").SemanticNodeProvenance>} */
  const recordsByPath = new Map()
  /** @type {import("./types.js").SemanticNodeProvenance[]} */
  const records = []

  for (const [index, entry] of entries.entries()) {
    const ranges = parserRanges.get(entry.node) ?? {}
    const location = "location" in entry.node ? entry.node.location : ranges.type ?? entry.ownerLocation
    const sourceProvenance = /** @type {import("./types.js").SemanticNodeSourceProvenance} */ ({
      origin: {kind: "source", location, sourceId: "source:0"},
      ranges,
      schema: "SemantifoldNodeProvenance",
      version: 1
    })
    const record = {
      id: `node:${index}`,
      kind: entry.node.kind,
      origin: sourceProvenance.origin,
      path: entry.path,
      ranges: sourceProvenance.ranges
    }

    records.push(record)
    recordsByPath.set(entry.path, record)
    entry.node.sourceProvenance = sourceProvenance
  }

  const symbols = resolveSymbols(module, recordsByPath)

  module.provenance = {
    coordinateSystem: "utf16",
    nodes: records,
    schema: "SemantifoldProvenance",
    sources,
    symbols,
    version: 1
  }

  return module
}

/**
 * Rebuilds canonical generation metadata without trusting caller-provided identities.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {{filename: string, content: string, language?: import("./types.js").SemanticLanguage}[]} [providedSources] - Additional source content.
 * @returns {{provenance: import("./types.js").SemanticProvenance, recordFor: (node: import("./types.js").SemanticNode, path?: string) => import("./types.js").SemanticNodeProvenance}} Canonical index.
 */
export function createGenerationIndex(module, providedSources = []) {
  const entries = semanticEntries(module)
  const priorSources = usableSourceProvenance(module.provenance)
  /** @type {import("./types.js").RegisteredSource[]} */
  const sources = []
  /** @type {Map<string, import("./types.js").RegisteredSource>} */
  const priorSourcesById = new Map()

  for (const source of providedSources) addSource(source.filename, source.content, source.language ?? null)
  if (priorSources) {
    for (const source of priorSources.sources) {
      const canonical = addSource(source.filename, source.content, source.language)

      priorSourcesById.set(source.id, canonical)
    }
  }
  for (const entry of entries) {
    const location = "location" in entry.node ? entry.node.location : entry.ownerLocation

    if (!sources.some((source) => source.filename == location.filename)) addSource(location.filename, null, null)
  }
  const verifiableSources = sources.filter((source) => source.content != null)

  /** @type {Map<object, import("./types.js").SemanticNodeProvenance[]>} */
  const recordsByNode = new Map()
  /** @type {Map<string, import("./types.js").SemanticNodeProvenance>} */
  const recordsByPath = new Map()
  /** @type {import("./types.js").SemanticNodeProvenance[]} */
  const records = []

  for (const [index, entry] of entries.entries()) {
    const located = "location" in entry.node ? entry.node.location : entry.ownerLocation
    const associated = usableNodeProvenance(entry.node.sourceProvenance)
    const ranges = associated ? validRanges(associated.ranges, verifiableSources) : {}
    const normalizedOrigin = associated
      ? normalizeOrigin(associated.origin, priorSourcesById, verifiableSources)
      : undefined
    const fallbackSource = sourceForLocation(located, sources)
    const origin = normalizedOrigin ?? sourceOrigin(fallbackSource, located)

    const record = {
      id: `node:${index}`,
      kind: entry.node.kind,
      origin,
      path: entry.path,
      ranges
    }

    records.push(record)
    recordsByPath.set(entry.path, record)
    const occurrences = recordsByNode.get(entry.node) ?? []

    occurrences.push(record)
    recordsByNode.set(entry.node, occurrences)
  }

  const symbols = resolveSymbols(module, recordsByPath)
  const provenance = /** @type {import("./types.js").SemanticProvenance} */ ({
    coordinateSystem: "utf16",
    nodes: records,
    schema: "SemantifoldProvenance",
    sources,
    symbols,
    version: 1
  })

  return {
    provenance,
    recordFor(node, path) {
      const occurrences = recordsByNode.get(node)

      if (!occurrences) throw new RangeError("Semantic node is not part of this module.")
      if (path !== undefined) {
        const record = occurrences.find((candidate) => candidate.path == path)

        if (!record) throw new RangeError(`Semantic node does not occur at '${path}'.`)

        return record
      }
      if (occurrences.length != 1) {
        throw new RangeError("Shared semantic node requires an occurrence path.")
      }

      return occurrences[0]
    }
  }

  /**
   * Registers one canonical source.
   * @param {string} filename - Source filename.
   * @param {string | null} content - Source content.
   * @param {import("./types.js").SemanticLanguage | null} language - Source language.
   * @returns {import("./types.js").RegisteredSource} Canonical source.
   */
  function addSource(filename, content, language) {
    if (typeof filename != "string" || content !== null && typeof content != "string" ||
      language !== null && !["php", "ruby", "javascript", "typescript", "java", "python"].includes(language)) {
      throw new TypeError("Malformed semantic source registry entry.")
    }

    const existing = sources.find((source) => source.filename == filename && source.content == content)

    if (existing) return existing

    const registered = {content, filename, id: `source:${sources.length}`, language}

    sources.push(registered)

    return registered
  }
}

/**
 * Selects the safe primary original location for closed provenance.
 * @param {import("./types.js").SemanticOrigin} origin - Closed provenance.
 * @returns {import("./types.js").SourceLocation | undefined} Primary location.
 */
export function primaryLocation(origin) {
  if (origin.kind == "source") return origin.location
  if (origin.kind == "derived") return origin.origins[0]?.location

  return origin.relatedOrigins[0]?.location
}

/**
 * Accepts source metadata only when it is attached to the semantic node it describes.
 * Registry-local IDs and paths are intentionally ignored and rebuilt.
 * @param {import("./types.js").SemanticNodeSourceProvenance | undefined} record - Candidate node association.
 * @returns {import("./types.js").SemanticNodeSourceProvenance | undefined} Usable association.
 */
function usableNodeProvenance(record) {
  if (!record || record.schema != "SemantifoldNodeProvenance" || record.version != 1 ||
    !record.origin || typeof record.origin != "object" ||
    !record.ranges || typeof record.ranges != "object" || Array.isArray(record.ranges)) return undefined

  return record
}

/**
 * Retains a valid source registry independently from potentially stale node metadata.
 * @param {import("./types.js").SemanticProvenance | undefined} provenance - Candidate provenance.
 * @returns {import("./types.js").SemanticProvenance | undefined} Provenance with a usable source registry.
 */
function usableSourceProvenance(provenance) {
  if (!provenance || provenance.schema != "SemantifoldProvenance" || provenance.version != 1 ||
    provenance.coordinateSystem != "utf16" || !Array.isArray(provenance.sources)) return undefined

  const sourceIds = new Set()

  for (const source of provenance.sources) {
    if (!source || typeof source.id != "string" || sourceIds.has(source.id) || typeof source.filename != "string" ||
      source.filename.length == 0 ||
      source.content !== null && typeof source.content != "string" || source.language !== null &&
      !["php", "ruby", "javascript", "typescript", "java", "python"].includes(source.language)) return undefined
    sourceIds.add(source.id)
  }

  return provenance
}

/**
 * Retains only self-consistent source ranges.
 * @param {Readonly<Record<string, import("./types.js").SourceLocation>>} ranges - Candidate ranges.
 * @param {import("./types.js").RegisteredSource[]} sources - Canonical sources.
 * @returns {Readonly<Record<string, import("./types.js").SourceLocation>>} Safe ranges.
 */
function validRanges(ranges, sources) {
  if (!ranges || typeof ranges != "object" || Array.isArray(ranges)) return {}

  /** @type {Record<string, import("./types.js").SourceLocation>} */
  const valid = {}

  for (const [role, location] of Object.entries(ranges)) {
    if (validLocation(location, sources)) valid[role] = location
  }

  return valid
}

/**
 * Normalizes a closed origin while remapping untrusted source identities.
 * @param {import("./types.js").SemanticOrigin} origin - Candidate origin.
 * @param {Map<string, import("./types.js").RegisteredSource>} priorSources - Prior-to-canonical source mapping.
 * @param {import("./types.js").RegisteredSource[]} sources - Canonical sources.
 * @returns {import("./types.js").SemanticOrigin | undefined} Safe origin.
 */
function normalizeOrigin(origin, priorSources, sources) {
  if (!origin || typeof origin != "object") return undefined

  if (origin.kind == "source" && validLocation(origin.location, sources)) {
    const claimed = priorSources.get(origin.sourceId)
    const source = claimed && sourceOwnsLocation(claimed, origin.location) ? claimed : sourceForLocation(origin.location, sources)

    return sourceOrigin(source, origin.location)
  }
  if (origin.kind == "derived" && Array.isArray(origin.origins) && origin.origins.length > 0) {
    const origins = origin.origins.map((related) => normalizeRelatedOrigin(related, priorSources, sources))

    if (origins.every(Boolean)) return {kind: "derived", origins: /** @type {import("./types.js").RelatedOrigin[]} */ (origins)}
  }
  if (origin.kind == "synthetic" && typeof origin.reason == "string" && Array.isArray(origin.relatedOrigins)) {
    const relatedOrigins = origin.relatedOrigins.map((related) => normalizeRelatedOrigin(related, priorSources, sources))

    if (relatedOrigins.every(Boolean)) {
      return {kind: "synthetic", reason: origin.reason, relatedOrigins: /** @type {import("./types.js").RelatedOrigin[]} */ (relatedOrigins)}
    }
  }

  return undefined
}

/**
 * Normalizes one related origin.
 * @param {import("./types.js").RelatedOrigin} related - Candidate related origin.
 * @param {Map<string, import("./types.js").RegisteredSource>} priorSources - Prior sources.
 * @param {import("./types.js").RegisteredSource[]} sources - Canonical sources.
 * @returns {import("./types.js").RelatedOrigin | undefined} Safe related origin.
 */
function normalizeRelatedOrigin(related, priorSources, sources) {
  if (!related || !validLocation(related.location, sources)) return undefined

  const claimed = priorSources.get(related.sourceId)
  const source = claimed && sourceOwnsLocation(claimed, related.location) ? claimed : sourceForLocation(related.location, sources)
  const normalized = {location: related.location, sourceId: source.id}

  if (typeof related.role == "string") Object.assign(normalized, {role: related.role})

  return normalized
}

/**
 * Checks normalized coordinates against exact source content when available.
 * @param {import("./types.js").SourceLocation} location - Candidate location.
 * @param {import("./types.js").RegisteredSource[]} sources - Registered sources.
 * @returns {boolean} Whether the location is safe.
 */
function validLocation(location, sources) {
  if (!location || typeof location.filename != "string" || !location.start || !location.end ||
    !Number.isInteger(location.start.offset) || !Number.isInteger(location.end.offset) || location.start.offset < 0 ||
    location.end.offset < location.start.offset || !validPointShape(location.start) || !validPointShape(location.end)) return false

  const candidates = sources.filter((source) => source.filename == location.filename)

  return candidates.some((source) => sourceOwnsLocation(source, location))
}

/**
 * Checks that one identified registry source owns a normalized location.
 * @param {import("./types.js").RegisteredSource} source - Identified source.
 * @param {import("./types.js").SourceLocation} location - Candidate location.
 * @returns {boolean} Whether the source owns the location.
 */
function sourceOwnsLocation(source, location) {
  if (source.filename != location.filename) return false
  if (source.content == null) return true
  if (location.end.offset > source.content.length) return false
  let coordinates = sourceCoordinateIndexes.get(source)

  if (!coordinates) {
    coordinates = createCoordinateIndex(source.content)
    sourceCoordinateIndexes.set(source, coordinates)
  }

  return samePoint(indexedPointAt(coordinates, location.start.offset), location.start) &&
    samePoint(indexedPointAt(coordinates, location.end.offset), location.end)
}

/**
 * Checks the integer shape of one source point.
 * @param {import("./types.js").SourcePoint} point - Source point.
 * @returns {boolean} Whether it is structurally valid.
 */
function validPointShape(point) {
  return Number.isInteger(point.line) && point.line >= 1 && Number.isInteger(point.column) && point.column >= 1
}

/**
 * Compares normalized source coordinates.
 * @param {import("./types.js").SourcePoint} left - Left point.
 * @param {import("./types.js").SourcePoint} right - Right point.
 * @returns {boolean} Whether all coordinates match.
 */
function samePoint(left, right) {
  return left.offset == right.offset && left.line == right.line && left.column == right.column
}

/**
 * Finds the deterministic source owning a location.
 * @param {import("./types.js").SourceLocation} location - Source location.
 * @param {import("./types.js").RegisteredSource[]} sources - Canonical sources.
 * @returns {import("./types.js").RegisteredSource} Owning source.
 */
function sourceForLocation(location, sources) {
  const source = sources.find((candidate) => sourceOwnsLocation(candidate, location))

  if (!source) throw new RangeError(`No registered source owns ${location.filename}:${location.start.offset}.`)

  return source
}

/**
 * Creates direct source provenance.
 * @param {import("./types.js").RegisteredSource} source - Source.
 * @param {import("./types.js").SourceLocation} location - Location.
 * @returns {import("./types.js").SourceOrigin} Origin.
 */
function sourceOrigin(source, location) {
  return {kind: "source", location, sourceId: source.id}
}

/**
 * Finds one node provenance record by semantic object or node identity.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").SemanticNode | string} node - Semantic object or node identity.
 * @returns {import("./types.js").SemanticNodeProvenance} Provenance record.
 */
export function getNodeProvenance(module, node) {
  requireProvenance(module)
  const index = createGenerationIndex(module)
  const record = typeof node == "string"
    ? index.provenance.nodes.find((candidate) => candidate.id == node)
    : index.recordFor(node)

  if (!record) throw new RangeError(`Unknown semantic node: ${node}`)

  return record
}

/**
 * Finds one semantic symbol record.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {string} symbolId - Symbol identity.
 * @returns {import("./types.js").SemanticSymbolProvenance} Symbol record.
 */
export function getSymbolProvenance(module, symbolId) {
  requireProvenance(module)
  const symbol = createGenerationIndex(module).provenance.symbols.find((candidate) => candidate.id == symbolId)

  if (!symbol) throw new RangeError(`Unknown semantic symbol: ${symbolId}`)

  return symbol
}

/**
 * Requires frontend provenance.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @returns {import("./types.js").SemanticProvenance} Provenance.
 */
function requireProvenance(module) {
  if (!module.provenance) throw new TypeError("Semantic module does not contain source provenance.")

  return module.provenance
}

/**
 * Traverses public semantic nodes in one stable order.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @returns {{node: import("./types.js").SemanticNode, ownerLocation: import("./types.js").SourceLocation, path: string}[]} Entries.
 */
export function semanticEntries(module) {
  /** @type {{node: import("./types.js").SemanticNode, ownerLocation: import("./types.js").SourceLocation, path: string}[]} */
  const entries = []

  visit(module, "", module.location)

  return entries

  /**
   * Visits one semantic node and its children.
   * @param {import("./types.js").SemanticNode} node - Current node.
   * @param {string} path - Current JSON Pointer.
   * @param {import("./types.js").SourceLocation} ownerLocation - Nearest located owner.
   * @returns {void}
   */
  function visit(node, path, ownerLocation) {
    const location = "location" in node ? node.location : ownerLocation

    entries.push({node, ownerLocation: location, path})

    if (node.kind == "Module") {
      node.functions.forEach((child, index) => visit(child, `/functions/${index}`, location))
      visit(node.entryPoint, "/entryPoint", location)
    } else if (node.kind == "FunctionDeclaration") {
      node.parameters.forEach((child, index) => visit(child, `${path}/parameters/${index}`, location))
      visit(node.returnType, `${path}/returnType`, location)
      visit(node.body, `${path}/body`, location)
    } else if (node.kind == "Block") {
      node.statements.forEach((child, index) => visit(child, `${path}/statements/${index}`, location))
    } else if (node.kind == "Parameter") {
      visit(node.type, `${path}/type`, location)
    } else if (node.kind == "LocalDeclaration") {
      visit(node.type, `${path}/type`, location)
      visit(node.initializer, `${path}/initializer`, location)
    } else if (node.kind == "AssignmentStatement") {
      visit(node.target, `${path}/target`, location)
      visit(node.expression, `${path}/expression`, location)
    } else if (node.kind == "ReturnStatement" || node.kind == "PrintStatement") {
      visit(node.expression, `${path}/expression`, location)
    } else if (node.kind == "IfStatement") {
      visit(node.condition, `${path}/condition`, location)
      visit(node.consequent, `${path}/consequent`, location)
      if (node.alternate) visit(node.alternate, `${path}/alternate`, location)
    } else if (node.kind == "EntryPoint") {
      visit(node.body, `${path}/body`, location)
    } else if (node.kind == "UnaryExpression") {
      visit(node.operand, `${path}/operand`, location)
    } else if (node.kind == "BinaryExpression") {
      visit(node.left, `${path}/left`, location)
      visit(node.right, `${path}/right`, location)
    } else if (node.kind == "CallExpression") {
      node.arguments.forEach((child, index) => visit(child, `${path}/arguments/${index}`, location))
    }
  }
}

/**
 * Resolves declarations and references after semantic validation.
 * @param {import("./types.js").SemanticModule} module - Validated module.
 * @param {Map<string, import("./types.js").SemanticNodeProvenance>} records - Node records by occurrence path.
 * @returns {import("./types.js").SemanticSymbolProvenance[]} Symbols.
 */
function resolveSymbols(module, records) {
  /** @type {import("./types.js").SemanticSymbolProvenance[]} */
  const symbols = []
  /** @type {Map<string, string>} */
  const functions = new Map()

  for (const [index, declaration] of module.functions.entries()) {
    functions.set(declaration.name, declare(declaration, declaration.name, "function", `/functions/${index}`))
  }

  for (const [index, declaration] of module.functions.entries()) {
    const declarationPath = `/functions/${index}`
    const scope = new Map()

    for (const [parameterIndex, parameter] of declaration.parameters.entries()) {
      scope.set(parameter.name, declare(parameter, parameter.name, "parameter", `${declarationPath}/parameters/${parameterIndex}`))
    }
    visitBlock(declaration.body, scope, `${declarationPath}/body`)
  }

  visitBlock(module.entryPoint.body, new Map(), "/entryPoint/body")

  return symbols

  /**
   * Declares one canonical symbol.
   * @param {import("./types.js").FunctionDeclaration | import("./types.js").Parameter | import("./types.js").LocalDeclaration} node - Declaration.
   * @param {string} name - Symbol name.
   * @param {import("./types.js").SemanticSymbolKind} kind - Symbol kind.
   * @param {string} path - Declaration occurrence path.
   * @returns {string} Symbol identity.
   */
  function declare(node, name, kind, path) {
    const record = records.get(path)

    if (!record) throw new Error(`Missing provenance for ${node.kind}.`)

    const location = record.ranges.name ?? node.location
    const id = `symbol:${symbols.length}`

    record.symbolId = id
    symbols.push({declarationNodeId: record.id, id, kind, location, name, references: []})

    return id
  }

  /**
   * Resolves references in one lexical block.
   * @param {import("./types.js").Block} block - Semantic block.
   * @param {Map<string, string>} parent - Visible bindings.
   * @param {string} path - Statement sequence path.
   * @returns {void}
   */
  function visitBlock(block, parent, path) {
    const scope = new Map(parent)

    for (const [index, statement] of block.statements.entries()) {
      const statementPath = `${path}/statements/${index}`

      if (statement.kind == "LocalDeclaration") {
        visitExpression(statement.initializer, scope, `${statementPath}/initializer`)
        scope.set(statement.name, declare(statement, statement.name, "local", statementPath))
      } else if (statement.kind == "AssignmentStatement") {
        reference(statement.target, scope.get(statement.target.name), "write", `${statementPath}/target`)
        visitExpression(statement.expression, scope, `${statementPath}/expression`)
      } else if (statement.kind == "ReturnStatement" || statement.kind == "PrintStatement") {
        visitExpression(statement.expression, scope, `${statementPath}/expression`)
      } else if (statement.kind == "IfStatement") {
        visitExpression(statement.condition, scope, `${statementPath}/condition`)
        visitBlock(statement.consequent, scope, `${statementPath}/consequent`)
        if (statement.alternate) visitBlock(statement.alternate, scope, `${statementPath}/alternate`)
      }
    }
  }

  /**
   * Resolves references in one expression.
   * @param {import("./types.js").Expression} expression - Expression.
   * @param {Map<string, string>} scope - Visible bindings.
   * @param {string} path - Expression occurrence path.
   * @returns {void}
   */
  function visitExpression(expression, scope, path) {
    if (expression.kind == "IdentifierExpression") reference(expression, scope.get(expression.name), "read", path)
    else if (expression.kind == "CallExpression") {
      reference(expression, functions.get(expression.callee), "call", path)
      for (const [index, argument] of expression.arguments.entries()) visitExpression(argument, scope, `${path}/arguments/${index}`)
    } else if (expression.kind == "UnaryExpression") {
      visitExpression(expression.operand, scope, `${path}/operand`)
    } else if (expression.kind == "BinaryExpression") {
      visitExpression(expression.left, scope, `${path}/left`)
      visitExpression(expression.right, scope, `${path}/right`)
    }
  }

  /**
   * Attaches one resolved symbol reference.
   * @param {import("./types.js").IdentifierExpression | import("./types.js").CallExpression} node - Reference node.
   * @param {string | undefined} symbolId - Resolved symbol.
   * @param {"read" | "write" | "call"} role - Reference role.
   * @param {string} path - Reference occurrence path.
   * @returns {void}
   */
  function reference(node, symbolId, role, path) {
    if (!symbolId) return

    const record = records.get(path)
    const symbol = symbols.find((candidate) => candidate.id == symbolId)

    if (!record || !symbol) throw new Error(`Missing provenance while resolving ${node.kind}.`)

    const location = record.ranges[role == "call" ? "callee" : "name"] ?? node.location

    record.symbolId = symbolId
    symbol.references.push({location, nodeId: record.id, role})
  }
}
