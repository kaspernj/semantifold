// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** @typedef {import("../semantic/types.js").SourceLocation} SourceLocation */

const semanticEdges = new Set(["functions", "entryPoint", "body", "parameters", "returnType", "statements", "condition",
  "consequent", "alternate", "type", "target", "initializer", "expression", "operand", "left", "right", "arguments"])

/**
 * Bounds a native occurrence plan and rejects cycles before recursive shared validation.
 * @param {unknown} module - Untrusted backend request.
 * @param {"c" | "cpp" | "kotlin" | "rust" | "swift" | "wasm"} [language] - Backend diagnostic language.
 * @returns {void}
 */
export function validateNativeGraph(module, language = "c") {
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
      unsupportedCapability(language, "missing or invalid semantic location", undefined)
    }

    if (depth > 512 || active.has(value)) unsupportedCapability(language, "cyclic or excessively nested semantic graph", location)
    if (weights.has(value)) return weights.get(value)
    active.add(value)
    let size = 1
    const children = Array.isArray(value) ? value : Object.entries(value).filter(([key]) => semanticEdges.has(key)).map(([, child]) => child)

    for (const child of children) {
      size += visit(child, depth + 1)
      if (size > 999999) unsupportedCapability(language, "expanded native occurrence plan exceeds six-digit capacity", location)
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
