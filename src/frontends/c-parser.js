// @ts-check

import {createRequire} from "node:module"

/**
 * Parser-neutral read-only data supplied by the frozen private legacy boundary.
 * @typedef {Readonly<{type: string, named: boolean, extra: boolean, error: boolean, missing: boolean,
 * hasError: boolean, startIndex: number, endIndex: number,
 * children: readonly Readonly<{field: string | null, node: CstNode}>[]}>} CstNode
 */
/** @typedef {Readonly<{root: CstNode}>} CstSnapshot */

const require = createRequire(import.meta.url)
const boundary = /** @type {{parseCst: (source: string) => CstSnapshot}} */ (require("semantifold-tree-sitter-legacy-internal"))

/** The root-bundled private parser is the only C parsing implementation. */
export const parseCst = boundary.parseCst
