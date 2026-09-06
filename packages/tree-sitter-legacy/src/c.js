// @ts-check

import Parser from "tree-sitter"
import CLanguage from "tree-sitter-c"

/** @typedef {Readonly<{row: number, column: number}>} CstPosition */
/** @typedef {Readonly<{field: string | null, node: CstNode}>} CstChild */
/**
 * @typedef {Readonly<{
 *   type: string,
 *   named: boolean,
 *   extra: boolean,
 *   error: boolean,
 *   missing: boolean,
 *   hasError: boolean,
 *   startIndex: number,
 *   endIndex: number,
 *   startPosition: CstPosition,
 *   endPosition: CstPosition,
 *   children: readonly CstChild[]
 * }>} CstNode
 */
/**
 * @typedef {Readonly<{
 *   schema: "semantifold.parser-cst",
 *   version: 1,
 *   language: "c",
 *   root: CstNode
 * }>} CstSnapshot
 */

/**
 * Parses C source with the package-owned legacy Tree-sitter runtime.
 * @param {string} source - Caller-owned C source text.
 * @returns {CstSnapshot} Recursively frozen parser-neutral CST data.
 */
export function parseCst(source) {
  const parser = new Parser()

  parser.setLanguage(CLanguage)
  const tree = parser.parse(source)
  const convertIndex = createIndexConverter(source, tree.rootNode.endIndex)
  const lineStarts = createLineStarts(source)
  const root = snapshotNode(tree.rootNode, convertIndex, lineStarts)

  parser.reset()
  return Object.freeze({language: "c", root, schema: "semantifold.parser-cst", version: 1})
}

/**
 * @param {import("tree-sitter").SyntaxNode} node
 * @param {(index: number) => number} convertIndex
 * @param {readonly number[]} lineStarts
 * @returns {CstNode}
 */
function snapshotNode(node, convertIndex, lineStarts) {
  /** @type {CstChild[]} */
  const children = []

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)

    if (!child) throw new Error(`Legacy Tree-sitter returned no child at index ${index}`)
    children.push(Object.freeze({
      field: node.fieldNameForChild(index) ?? null,
      node: snapshotNode(child, convertIndex, lineStarts)
    }))
  }
  const startIndex = convertIndex(node.startIndex)
  const endIndex = convertIndex(node.endIndex)

  return Object.freeze({
    children: Object.freeze(children),
    endIndex,
    endPosition: positionForIndex(endIndex, lineStarts),
    error: node.isError,
    extra: node.isExtra,
    hasError: node.hasError,
    missing: node.isMissing,
    named: node.isNamed,
    startIndex,
    startPosition: positionForIndex(startIndex, lineStarts),
    type: node.type
  })
}

/**
 * Normalizes either legacy UTF-8 byte offsets or UTF-16 offsets to UTF-16.
 * @param {string} source
 * @param {number} rootEndIndex
 * @returns {(index: number) => number}
 */
function createIndexConverter(source, rootEndIndex) {
  if (rootEndIndex == source.length) return (index) => index

  const utf8Length = Buffer.byteLength(source, "utf8")

  if (rootEndIndex != utf8Length) {
    throw new Error(`Unsupported legacy Tree-sitter index extent ${rootEndIndex} for source length ${source.length}`)
  }
  /** @type {Map<number, number>} */
  const byteToUtf16 = new Map([[0, 0]])
  let byteIndex = 0

  for (let utf16Index = 0; utf16Index < source.length;) {
    const codePoint = source.codePointAt(utf16Index)

    if (codePoint == null) throw new Error(`Cannot read source code point at index ${utf16Index}`)
    const character = String.fromCodePoint(codePoint)

    byteIndex += Buffer.byteLength(character, "utf8")
    utf16Index += character.length
    byteToUtf16.set(byteIndex, utf16Index)
  }
  return (index) => {
    const converted = byteToUtf16.get(index)

    if (converted == null) throw new Error(`Legacy Tree-sitter returned a non-boundary byte index ${index}`)
    return converted
  }
}

/** @param {string} source @returns {readonly number[]} */
function createLineStarts(source) {
  const starts = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] == "\n") starts.push(index + 1)
  }
  return starts
}

/**
 * @param {number} index
 * @param {readonly number[]} lineStarts
 * @returns {CstPosition}
 */
function positionForIndex(index, lineStarts) {
  let low = 0
  let high = lineStarts.length

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)

    if (/** @type {number} */ (lineStarts[middle]) <= index) low = middle
    else high = middle
  }
  return Object.freeze({column: index - /** @type {number} */ (lineStarts[low]), row: low})
}
