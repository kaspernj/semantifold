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
  const nodes = [...source.matchAll(/<node\b[^>]*>/gu)].map(match => attributes(match[0]))
  const labels = nodes.filter(node => node.get("content-desc") == "semantifold-output")
  const outputs = nodes.filter(node => node.get("text") == expectedOutput)
  const combined = nodes.filter(node => node.get("content-desc") == `semantifold-output\n${expectedOutput}`)
  const separateMatch = combined.length == 0 && labels.length == 1 && outputs.length == 1
  const combinedMatch = combined.length == 1 && labels.length == 0 &&
    (outputs.length == 0 || outputs.length == 1 && outputs[0] === combined[0])

  if (!separateMatch && !combinedMatch) failure()

  return {label: "semantifold-output", output: expectedOutput}
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

function failure() {
  throw new Error("Android UI dump does not contain one exact labelled Flutter output.")
}

if (process.argv[1] && import.meta.url == pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2]
  const expected = process.argv[3]

  if (!filename || !expected) throw new Error("Flutter UI assertion requires an XML path and base64 output.")
  assertFlutterUiDump(await readFile(filename, "utf8"), Buffer.from(expected, "base64").toString("utf8"))
}
