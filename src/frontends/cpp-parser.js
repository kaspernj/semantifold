// @ts-check

import {createRequire} from "node:module"

/** @typedef {import("./c-parser.js").CstNode} CstNode */
/** @typedef {Readonly<{root: CstNode}>} CstSnapshot */

const require = createRequire(import.meta.url)
const boundary = /** @type {{parseCst: (source: string, language: "cpp") => CstSnapshot}} */ (require("semantifold-tree-sitter-legacy-internal"))

/**
 * Invokes only the official CPP grammar and receives frozen parser-neutral data.
 * @param {string} source - Caller-owned C++ source.
 * @returns {CstSnapshot} CPP grammar snapshot.
 */
export function parseCppCst(source) {
  return boundary.parseCst(source, "cpp")
}
