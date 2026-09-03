// @ts-check

import {pointAt} from "./location.js"

/** @type {WeakMap<object, Readonly<Record<string, import("./types.js").SourceLocation>>>} */
const parserRanges = new WeakMap()

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
  /** @type {Map<object, import("./types.js").SemanticNodeProvenance>} */
  const records = new Map()

  for (const [index, entry] of entries.entries()) {
    const ranges = parserRanges.get(entry.node) ?? {}
    const location = "location" in entry.node ? entry.node.location : ranges.type ?? entry.ownerLocation
    const record = {
      id: `node:${index}`,
      kind: entry.node.kind,
      origin: /** @type {const} */ ({kind: "source", location, sourceId: "source:0"}),
      path: entry.path,
      ranges
    }

    records.set(entry.node, record)
  }

  const symbols = resolveSymbols(module, records)

  module.provenance = {
    coordinateSystem: "utf16",
    nodes: [...records.values()],
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
 * @returns {{provenance: import("./types.js").SemanticProvenance, recordFor: (node: import("./types.js").SemanticNode) => import("./types.js").SemanticNodeProvenance}} Canonical index.
 */
export function createGenerationIndex(module, providedSources = []) {
  const entries = semanticEntries(module)
  const priorSources = usableSourceProvenance(module.provenance)
  const prior = usablePriorProvenance(module.provenance, entries)
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

  const priorNodes = new Map(prior?.nodes.map((record) => [record.path, record]) ?? [])
  /** @type {Map<object, import("./types.js").SemanticNodeProvenance>} */
  const records = new Map()

  for (const [index, entry] of entries.entries()) {
    const located = "location" in entry.node ? entry.node.location : entry.ownerLocation
    const priorRecord = priorNodes.get(entry.path)
    const ranges = priorRecord ? validRanges(priorRecord.ranges, sources) : {}
    const fallbackLocation = ranges.type ?? located
    const fallbackSource = sourceForLocation(fallbackLocation, sources)
    const origin = priorRecord
      ? normalizeOrigin(priorRecord.origin, priorSourcesById, sources) ?? sourceOrigin(fallbackSource, fallbackLocation)
      : sourceOrigin(fallbackSource, fallbackLocation)

    records.set(entry.node, {
      id: `node:${index}`,
      kind: entry.node.kind,
      origin,
      path: entry.path,
      ranges
    })
  }

  const symbols = resolveSymbols(module, records)
  const provenance = /** @type {import("./types.js").SemanticProvenance} */ ({
    coordinateSystem: "utf16",
    nodes: [...records.values()],
    schema: "SemantifoldProvenance",
    sources,
    symbols,
    version: 1
  })

  return {
    provenance,
    recordFor(node) {
      const record = records.get(node)

      if (!record) throw new RangeError("Semantic node is not part of this module.")

      return record
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
      language !== null && !["php", "ruby", "javascript", "typescript", "java"].includes(language)) {
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
 * Accepts only structurally current prior metadata; identities are still rebuilt.
 * @param {import("./types.js").SemanticProvenance | undefined} provenance - Caller metadata.
 * @param {{node: import("./types.js").SemanticNode, path: string}[]} entries - Current semantic entries.
 * @returns {import("./types.js").SemanticProvenance | undefined} Usable prior metadata.
 */
function usablePriorProvenance(provenance, entries) {
  const usable = usableSourceProvenance(provenance)

  if (!usable || !Array.isArray(usable.nodes) ||
    !Array.isArray(usable.symbols) || usable.nodes.length != entries.length) return undefined

  const paths = new Set()

  for (const [index, record] of usable.nodes.entries()) {
    const entry = entries[index]

    if (!record || record.path != entry.path || record.kind != entry.node.kind || paths.has(record.path)) return undefined
    paths.add(record.path)
  }

  return usable
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
      source.content !== null && typeof source.content != "string" || source.language !== null &&
      !["php", "ruby", "javascript", "typescript", "java"].includes(source.language)) return undefined
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
    const source = priorSources.get(origin.sourceId) ?? sourceForLocation(origin.location, sources)

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

  const source = priorSources.get(related.sourceId) ?? sourceForLocation(related.location, sources)
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

  return candidates.some((source) => {
    if (source.content == null) return true
    if (location.end.offset > source.content.length) return false

    return samePoint(pointAt(source.content, location.start.offset), location.start) &&
      samePoint(pointAt(source.content, location.end.offset), location.end)
  })
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
  const source = sources.find((candidate) => candidate.filename == location.filename &&
    (candidate.content == null || location.end.offset <= candidate.content.length))

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
  const provenance = requireProvenance(module)
  const id = typeof node == "string" ? node : nodeIdForObject(module, node, provenance.nodes)
  const record = provenance.nodes.find((candidate) => candidate.id == id)

  if (!record) throw new RangeError(`Unknown semantic node: ${id}`)

  return record
}

/**
 * Finds one semantic symbol record.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {string} symbolId - Symbol identity.
 * @returns {import("./types.js").SemanticSymbolProvenance} Symbol record.
 */
export function getSymbolProvenance(module, symbolId) {
  const symbol = requireProvenance(module).symbols.find((candidate) => candidate.id == symbolId)

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
 * Resolves a semantic object to its current deterministic path.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").SemanticNode} node - Semantic node.
 * @param {import("./types.js").SemanticNodeProvenance[]} records - Indexed records.
 * @returns {string} Node identity.
 */
function nodeIdForObject(module, node, records) {
  const entry = semanticEntries(module).find((candidate) => candidate.node === node)

  if (!entry) throw new RangeError("Semantic node is not part of this module.")

  const record = records.find((candidate) => candidate.path == entry.path && candidate.kind == node.kind)

  if (!record) throw new RangeError(`Stale semantic provenance at ${entry.path}.`)

  return record.id
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
      node.body.forEach((child, index) => visit(child, `${path}/body/${index}`, location))
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
      node.consequent.forEach((child, index) => visit(child, `${path}/consequent/${index}`, location))
      node.alternate.forEach((child, index) => visit(child, `${path}/alternate/${index}`, location))
    } else if (node.kind == "EntryPoint") {
      node.body.forEach((child, index) => visit(child, `${path}/body/${index}`, location))
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
 * @param {Map<object, import("./types.js").SemanticNodeProvenance>} records - Node records.
 * @returns {import("./types.js").SemanticSymbolProvenance[]} Symbols.
 */
function resolveSymbols(module, records) {
  /** @type {import("./types.js").SemanticSymbolProvenance[]} */
  const symbols = []
  /** @type {Map<string, string>} */
  const functions = new Map()

  for (const declaration of module.functions) {
    functions.set(declaration.name, declare(declaration, declaration.name, "function"))
  }

  for (const declaration of module.functions) {
    const scope = new Map()

    for (const parameter of declaration.parameters) scope.set(parameter.name, declare(parameter, parameter.name, "parameter"))
    visitStatements(declaration.body, scope)
  }

  visitStatements(module.entryPoint.body, new Map())

  return symbols

  /**
   * Declares one canonical symbol.
   * @param {import("./types.js").FunctionDeclaration | import("./types.js").Parameter | import("./types.js").LocalDeclaration} node - Declaration.
   * @param {string} name - Symbol name.
   * @param {import("./types.js").SemanticSymbolKind} kind - Symbol kind.
   * @returns {string} Symbol identity.
   */
  function declare(node, name, kind) {
    const record = records.get(node)

    if (!record) throw new Error(`Missing provenance for ${node.kind}.`)

    const location = record.ranges.name ?? node.location
    const id = `symbol:${symbols.length}`

    record.symbolId = id
    symbols.push({declarationNodeId: record.id, id, kind, location, name, references: []})

    return id
  }

  /**
   * Resolves references in one statement sequence.
   * @param {(import("./types.js").FunctionStatement | import("./types.js").PrintStatement)[]} statements - Statements.
   * @param {Map<string, string>} parent - Visible bindings.
   * @returns {void}
   */
  function visitStatements(statements, parent) {
    const scope = new Map(parent)

    for (const statement of statements) {
      if (statement.kind == "LocalDeclaration") {
        visitExpression(statement.initializer, scope)
        scope.set(statement.name, declare(statement, statement.name, "local"))
      } else if (statement.kind == "AssignmentStatement") {
        reference(statement.target, scope.get(statement.target.name), "write")
        visitExpression(statement.expression, scope)
      } else if (statement.kind == "ReturnStatement" || statement.kind == "PrintStatement") {
        visitExpression(statement.expression, scope)
      } else if (statement.kind == "IfStatement") {
        visitExpression(statement.condition, scope)
        visitStatements(statement.consequent, scope)
        visitStatements(statement.alternate, scope)
      }
    }
  }

  /**
   * Resolves references in one expression.
   * @param {import("./types.js").Expression} expression - Expression.
   * @param {Map<string, string>} scope - Visible bindings.
   * @returns {void}
   */
  function visitExpression(expression, scope) {
    if (expression.kind == "IdentifierExpression") reference(expression, scope.get(expression.name), "read")
    else if (expression.kind == "CallExpression") {
      reference(expression, functions.get(expression.callee), "call")
      for (const argument of expression.arguments) visitExpression(argument, scope)
    } else if (expression.kind == "BinaryExpression") {
      visitExpression(expression.left, scope)
      visitExpression(expression.right, scope)
    }
  }

  /**
   * Attaches one resolved symbol reference.
   * @param {import("./types.js").IdentifierExpression | import("./types.js").CallExpression} node - Reference node.
   * @param {string | undefined} symbolId - Resolved symbol.
   * @param {"read" | "write" | "call"} role - Reference role.
   * @returns {void}
   */
  function reference(node, symbolId, role) {
    if (!symbolId) return

    const record = records.get(node)
    const symbol = symbols.find((candidate) => candidate.id == symbolId)

    if (!record || !symbol) throw new Error(`Missing provenance while resolving ${node.kind}.`)

    const location = record.ranges[role == "call" ? "callee" : "name"] ?? node.location

    record.symbolId = symbolId
    symbol.references.push({location, nodeId: record.id, role})
  }
}
