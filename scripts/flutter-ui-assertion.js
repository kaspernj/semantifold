// @ts-check

import {readFile} from "node:fs/promises"
import {pathToFileURL} from "node:url"

/**
 * Verifies one Android UIAutomator dump contains exactly one Flutter semantics label and exact output.
 * @param {string} source - Complete UIAutomator XML dump.
 * @param {string} expectedOutput - Exact semantic output including line boundaries.
 * @returns {{label: "semantifold-output", output: string}} Verified values.
 */
export function assertFlutterUiDump(source, expectedOutput) {
  if (typeof source != "string" || typeof expectedOutput != "string" || expectedOutput.length == 0) failure()
  const nodes = parseNodes(source)
  const labels = indexes(nodes, "content-desc", "semantifold-output")
  const textOutputs = indexes(nodes, "text", expectedOutput)
  const semanticOutputs = indexes(nodes, "content-desc", expectedOutput)
  const combined = indexes(nodes, "content-desc", `semantifold-output\n${expectedOutput}`)
  const nativeTextMatch = combined.length == 0 && labels.length == 1 && textOutputs.length == 1 &&
    semanticOutputs.length == 0 && labels[0] == textOutputs[0]
  const flutterSemanticMatch = combined.length == 0 && labels.length == 1 && textOutputs.length == 0 &&
    semanticOutputs.length == 1 && isDescendant(nodes, semanticOutputs[0], labels[0])
  const combinedMatch = combined.length == 1 && labels.length == 0 && textOutputs.length == 0 &&
    semanticOutputs.length == 0

  if (!nativeTextMatch && !flutterSemanticMatch && !combinedMatch) failure(nodes)

  return {label: "semantifold-output", output: expectedOutput}
}

/**
 * Parses UIAutomator's nested node subset while retaining ancestry.
 * @param {string} source Complete XML dump.
 * @returns {{attributes: Map<string, string>, parent: number | undefined}[]} Parsed nodes.
 */
function parseNodes(source) {
  /** @type {{attributes: Map<string, string>, parent: number | undefined}[]} */
  const nodes = []
  /** @type {number[]} */
  const stack = []

  for (const match of source.matchAll(/<node\b[^>]*\/?>|<\/node\s*>/gu)) {
    const token = match[0]

    if (token.startsWith("</")) {
      if (stack.pop() === undefined) return []
      continue
    }
    const index = nodes.length

    nodes.push({attributes: attributes(token), parent: stack.at(-1)})
    if (!token.endsWith("/>")) stack.push(index)
  }

  return stack.length == 0 ? nodes : []
}

/**
 * Finds nodes whose exact attribute value matches.
 * @param {{attributes: Map<string, string>}[]} nodes Parsed nodes.
 * @param {string} name Attribute name.
 * @param {string} value Required value.
 * @returns {number[]} Matching indexes.
 */
function indexes(nodes, name, value) {
  return nodes.flatMap((node, index) => node.attributes.get(name) == value ? [index] : [])
}

/**
 * Reports whether one node is a strict descendant of another.
 * @param {{parent: number | undefined}[]} nodes Parsed nodes.
 * @param {number} child Child index.
 * @param {number} ancestor Ancestor index.
 * @returns {boolean} Whether the relationship is exact.
 */
function isDescendant(nodes, child, ancestor) {
  let parent = nodes[child]?.parent

  while (parent !== undefined) {
    if (parent == ancestor) return true
    parent = nodes[parent]?.parent
  }

  return false
}

/** @param {string} node @returns {Map<string, string>} */
function attributes(node) {
  return new Map([...node.matchAll(/([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/gu)]
    .map(([, name, value]) => [name, decodeXml(value)]))
}

/** @param {string} value @returns {string} */
function decodeXml(value) {
  return value.replaceAll(/&(?:#(\d+)|#x([0-9A-Fa-f]+)|(?:amp|apos|gt|lt|quot));/gu, entity => {
    if (entity == "&amp;") return "&"
    if (entity == "&apos;") return "'"
    if (entity == "&gt;") return ">"
    if (entity == "&lt;") return "<"
    if (entity == "&quot;") return '"'
    const decimal = /^&#(\d+);$/u.exec(entity)
    const hexadecimal = /^&#x([0-9A-Fa-f]+);$/u.exec(entity)
    const scalar = Number.parseInt(decimal?.[1] ?? hexadecimal?.[1] ?? "", decimal ? 10 : 16)

    return Number.isInteger(scalar) && scalar >= 0 && scalar <= 0x10_FFFF && (scalar < 0xD800 || scalar > 0xDFFF)
      ? String.fromCodePoint(scalar) : entity
  })
}

/** @param {{attributes: Map<string, string>}[]} [nodes] Parsed nodes. */
function failure(nodes = []) {
  const observedDescriptions = observed(nodes, "content-desc")
  const observedText = observed(nodes, "text")

  throw new Error("Android UI dump does not contain one exact labelled Flutter output. " +
    `Observed content-desc values: ${JSON.stringify(observedDescriptions)}; text values: ${JSON.stringify(observedText)}.`)
}

/** @param {{attributes: Map<string, string>}[]} nodes @param {string} name @returns {string[]} */
function observed(nodes, name) {
  return nodes.flatMap(({attributes: node}) => {
    const value = node.get(name)

    return value ? [value.slice(0, 256)] : []
  })
}

if (process.argv[1] && import.meta.url == pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2]
  const expected = process.argv[3]

  if (!filename || !expected) throw new Error("Flutter UI assertion requires an XML path and base64 output.")
  assertFlutterUiDump(await readFile(filename, "utf8"), Buffer.from(expected, "base64").toString("utf8"))
}
