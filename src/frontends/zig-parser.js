// @ts-check

import {createRequire} from "node:module"

/** @typedef {Readonly<{row: number, column: number}>} CstPosition */
/** @typedef {Readonly<{field: string | null, node: CstNode}>} CstChild */
/** @typedef {Readonly<{type: string, named: boolean, extra: boolean, error: boolean, missing: boolean, hasError: boolean, startIndex: number, endIndex: number, startPosition: CstPosition, endPosition: CstPosition, children: readonly CstChild[]}>} CstNode */
/** @typedef {Readonly<{root: CstNode}>} CstSnapshot */

const require = createRequire(import.meta.url)
const boundary = /** @type {{parseCst: (source: string) => CstSnapshot}} */ (require("semantifold-tree-sitter-zig-internal"))

/**
 * Receives only frozen parser-neutral data from the qualified isolated Zig grammar.
 * @param {string} source - Exact caller-owned Zig source.
 * @returns {CstSnapshot} Complete Zig CST snapshot.
 */
export function parseZigCst(source) {
  return boundary.parseCst(source)
}
