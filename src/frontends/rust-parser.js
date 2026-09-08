// @ts-check

import {createRequire} from "node:module"

/** @typedef {import("./c-parser.js").CstNode} CstNode */
/** @typedef {Readonly<{root: CstNode}>} CstSnapshot */

const require = createRequire(import.meta.url)
const boundary = /** @type {{parseCst: (source: string, language: "rust") => CstSnapshot}} */ (require("semantifold-tree-sitter-legacy-internal"))

/**
 * Receives only frozen parser-neutral data from the qualified isolated Rust grammar.
 * @param {string} source - Exact caller-owned Rust source.
 * @returns {CstSnapshot} Complete Rust CST snapshot.
 */
export function parseRustCst(source) {
  return boundary.parseCst(source, "rust")
}
