// @ts-check

import {createGenerationIndex, primaryLocation} from "../semantic/provenance.js"

/** Source-aware deterministic generated-output builder. */
export class SourceWriter {
  /**
   * Creates a source-aware writer.
   * @param {object} options - Writer options.
   * @param {string} options.filename - Output filename.
   * @param {import("../semantic/types.js").SemanticLanguage} options.language - Output language.
   * @param {import("../semantic/types.js").SemanticModule} options.module - Semantic module.
   * @param {{filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]} [options.sources] - Caller-provided sources.
   */
  constructor({filename, language, module, sources}) {
    const index = createGenerationIndex(module, sources)

    this.filename = filename
    this.language = language
    this.index = index
    /** @type {string[]} */
    this.parts = []
    /** @type {import("../semantic/types.js").SemantifoldMappingSpan[]} */
    this.spans = []
    this.offset = 0
    this.line = 1
    this.column = 1
  }

  /**
   * Returns generated content so far.
   * @returns {string} Generated content.
   */
  get code() {
    return this.parts.join("")
  }

  /**
   * Writes text mapped to a semantic node.
   * @param {string} text - Generated text.
   * @param {object} annotation - Mapping annotation.
   * @param {import("../semantic/types.js").SemanticNode} annotation.node - Semantic node.
   * @param {"exact" | "anchor"} annotation.mappingKind - Mapping precision.
   * @param {string} [annotation.role] - Semantic token role.
   * @param {string} [annotation.name] - Source Map name.
   * @returns {void}
   */
  mapped(text, {mappingKind, name, node, role}) {
    if (text.length == 0) return

    const record = this.index.recordFor(node)
    const roleLocation = role ? record.ranges[role] : undefined
    const origin = roleLocation ? this.#sourceOrigin(roleLocation, record.origin) : record.origin
    const precision = mappingKind == "exact" && role && !roleLocation ? "anchor" : mappingKind
    const symbol = record.symbolId
      ? this.index.provenance.symbols.find((candidate) => candidate.id == record.symbolId)
      : undefined

    this.#append(text, {
      mappingKind: precision,
      name: name ?? symbol?.name,
      nodeId: record.id,
      origin,
      role,
      symbolId: record.symbolId
    })
  }

  /**
   * Writes source-free scaffolding with optional semantic context.
   * @param {string} text - Generated text.
   * @param {string} reason - Stable reason.
   * @param {import("../semantic/types.js").SemanticNode[]} [relatedNodes] - Related nodes.
   * @returns {void}
   */
  synthetic(text, reason, relatedNodes = []) {
    if (text.length == 0) return

    const relatedOrigins = relatedNodes.flatMap((node) => {
      const record = this.index.recordFor(node)
      const location = primaryLocation(record.origin)

      if (!location) return []

      const sourceId = record.origin.kind == "source" ? record.origin.sourceId : record.origin.kind == "derived"
        ? record.origin.origins[0]?.sourceId
        : record.origin.relatedOrigins[0]?.sourceId

      return sourceId ? [{location, nodeId: record.id, role: "context", sourceId}] : []
    })

    this.#append(text, {mappingKind: "synthetic", origin: {kind: "synthetic", reason, relatedOrigins}})
  }

  /**
   * Returns the authoritative rich map for the current content.
   * @returns {import("../semantic/types.js").SemantifoldMapping} Mapping.
   */
  finish() {
    return {
      coordinateSystem: "utf16",
      generated: {content: this.code, filename: this.filename, language: this.language},
      nodes: [...this.index.provenance.nodes],
      schema: "SemantifoldMapping",
      sources: [...this.index.provenance.sources],
      spans: [...this.spans],
      symbols: [...this.index.provenance.symbols],
      version: 1
    }
  }

  /**
   * Appends one mapped span.
   * @param {string} text - Generated text.
   * @param {Omit<import("../semantic/types.js").SemantifoldMappingSpan, "generated">} annotation - Span annotation.
   * @returns {void}
   */
  #append(text, annotation) {
    if (text.includes("\r")) throw new TypeError("Generated output must use deterministic LF line endings.")

    const start = {column: this.column, line: this.line, offset: this.offset}

    this.parts.push(text)
    for (let index = 0; index < text.length; index++) {
      this.offset++
      if (text[index] == "\n") {
        this.line++
        this.column = 1
      } else this.column++
    }
    const compact = /** @type {Omit<import("../semantic/types.js").SemantifoldMappingSpan, "generated">} */ (
      Object.fromEntries(Object.entries(annotation).filter(([, value]) => value !== undefined))
    )

    this.spans.push({
      ...compact,
      generated: {
        end: {column: this.column, line: this.line, offset: this.offset},
        filename: this.filename,
        start
      }
    })
  }

  /**
   * Creates a direct role origin using canonical source identities.
   * @param {import("../semantic/types.js").SourceLocation} location - Exact role range.
   * @param {import("../semantic/types.js").SemanticOrigin} fallback - Owning origin.
   * @returns {import("../semantic/types.js").SemanticOrigin} Role origin.
   */
  #sourceOrigin(location, fallback) {
    /** @type {string | undefined} */
    let fallbackSourceId

    if (fallback.kind == "source" && fallback.location.filename == location.filename) fallbackSourceId = fallback.sourceId
    else if (fallback.kind == "derived") {
      fallbackSourceId = fallback.origins.find((origin) => origin.location.filename == location.filename)?.sourceId
    } else if (fallback.kind == "synthetic") {
      fallbackSourceId = fallback.relatedOrigins.find((origin) => origin.location.filename == location.filename)?.sourceId
    }
    const source = this.index.provenance.sources.find((candidate) => candidate.id == fallbackSourceId) ??
      this.index.provenance.sources.find((candidate) => candidate.filename == location.filename)

    return source ? {kind: "source", location, sourceId: source.id} : fallback
  }
}
