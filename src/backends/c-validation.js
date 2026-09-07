// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").SourceLocation} SourceLocation */

const maximumObjectBytes = 9223372036854775807n
/** Maximum UTF-16 input accepted by the unchanged qualified legacy parser. */
export const maximumCSourceLength = 32767
const allocationMetadataBytes = 8n
const semanticEdges = new Set(["functions", "entryPoint", "body", "parameters", "returnType", "statements", "condition",
  "consequent", "alternate", "type", "target", "initializer", "expression", "operand", "left", "right", "arguments"])

/**
 * Bounds the C occurrence plan and rejects cycles before recursive shared validation.
 * @param {unknown} module - Untrusted backend request.
 * @returns {void}
 */
export function validateCGraph(module) {
  const active = new Set()
  const weights = new Map()

  /**
   * Counts expanded semantic occurrences while memoizing shared objects.
   * @param {unknown} value - Candidate semantic value.
   * @param {number} depth - Traversal depth.
   * @returns {number} Bounded expanded weight.
   */
  function visit(value, depth) {
    if (!value || typeof value != "object") return 0
    const location = /** @type {{location?: SourceLocation}} */ (value).location
    const kind = /** @type {{kind?: string}} */ (value).kind

    if (!Array.isArray(value) && (kind != "TypeReference" || "location" in value) && !validLocation(location)) {
      unsupportedCapability("c", "missing or invalid semantic location", undefined)
    }

    if (depth > 512 || active.has(value)) unsupportedCapability("c", "cyclic or excessively nested semantic graph", location)
    if (weights.has(value)) return weights.get(value)
    active.add(value)
    let size = 1
    const children = Array.isArray(value) ? value : Object.entries(value).filter(([key]) => semanticEdges.has(key)).map(([, child]) => child)

    for (const child of children) {
      size += visit(child, depth + 1)
      if (size > 999999) unsupportedCapability("c", "expanded C occurrence plan exceeds six-digit capacity", location)
    }
    active.delete(value)
    weights.set(value, size)
    return size
  }

  visit(module, 0)
}

/**
 * Checks required semantic coordinates before the provenance writer reads them.
 * @param {SourceLocation | undefined} location - Candidate origin.
 * @returns {boolean} Whether it is a complete ordered UTF-16 range.
 */
function validLocation(location) {
  return Boolean(location && typeof location.filename == "string" && location.filename.length > 0 &&
    [location.start, location.end].every((point) => point && Number.isSafeInteger(point.offset) && point.offset >= 0 &&
      Number.isSafeInteger(point.line) && point.line >= 1 && Number.isSafeInteger(point.column) && point.column >= 1) &&
    location.end.offset >= location.start.offset && location.end.line >= location.start.line &&
    (location.end.line != location.start.line || location.end.column >= location.start.column))
}

/**
 * Rejects compile-time-known object and arena sizes; unknown runtime lengths remain checked in C.
 * @param {SemanticModule} module - Shape/type-validated module.
 * @returns {void}
 */
export function validateCMemory(module) {
  /**
   * Checks one expression and its known byte lengths without folding the IR.
   * @param {Expression} expression - Semantic expression.
   * @param {Map<string, bigint | undefined>} lengths - Visible immutable or assigned lengths.
   * @param {{bytes: bigint}} arena - Known minimum allocations in this lexical path.
   * @returns {bigint | undefined} Known UTF-8 byte length.
   */
  function size(expression, lengths, arena) {
    if (expression.kind == "StringLiteral") {
      const bytes = BigInt(Buffer.byteLength(expression.value, "utf8"))

      if (bytes > 4095n) unsupportedCapability("c", "UTF-8 literal exceeds the strict C17 4095-byte translation limit", expression.location)
      return bytes
    }
    if (expression.kind == "IdentifierExpression") return lengths.get(expression.name)
    if (expression.kind == "CallExpression") {
      for (const argument of expression.arguments) size(argument, lengths, arena)
    } else if (expression.kind == "UnaryExpression") size(expression.operand, lengths, arena)
    else if (expression.kind == "BinaryExpression") {
      const left = size(expression.left, lengths, arena)
      const right = size(expression.right, lengths, arena)

      if (expression.operation == "StringConcat") {
        const minimum = (left ?? 0n) + (right ?? 0n)

        arena.bytes += allocationMetadataBytes + minimum
        if (minimum > maximumObjectBytes - allocationMetadataBytes || arena.bytes > maximumObjectBytes) {
          unsupportedCapability("c", "known immutable slice or module arena size exceeds PTRDIFF_MAX", expression.location)
        }
        return left === undefined || right === undefined ? undefined : left + right
      }
    }
    return undefined
  }

  /**
   * Propagates known local descriptor sizes through straight-line code and both branch paths.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {Map<string, bigint | undefined>} inherited - Visible known lengths.
   * @param {{bytes: bigint}} arena - Known path allocation size.
   * @returns {Map<string, bigint | undefined>} Outgoing known lengths.
   */
  function visit(block, inherited, arena) {
    const lengths = new Map(inherited)

    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration") lengths.set(statement.name, size(statement.initializer, lengths, arena))
      else if (statement.kind == "AssignmentStatement") lengths.set(statement.target.name, size(statement.expression, lengths, arena))
      else if (statement.kind == "IfStatement") {
        size(statement.condition, lengths, arena)
        const leftArena = {bytes: arena.bytes}
        const rightArena = {bytes: arena.bytes}
        const left = visit(statement.consequent, lengths, leftArena)
        const right = statement.alternate ? visit(statement.alternate, lengths, rightArena) : lengths

        for (const name of lengths.keys()) lengths.set(name, left.get(name) === right.get(name) ? left.get(name) : undefined)
        arena.bytes = leftArena.bytes < rightArena.bytes ? leftArena.bytes : rightArena.bytes
      } else size(statement.expression, lengths, arena)
    }
    return lengths
  }

  for (const declaration of module.functions) visit(declaration.body, new Map(), {bytes: 0n})
  visit(module.entryPoint.body, new Map(), {bytes: 0n})
}
