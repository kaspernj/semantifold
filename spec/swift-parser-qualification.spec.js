// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import Parser from "tree-sitter"
import SwiftLanguage from "tree-sitter-swift/bindings/node/index.js"

const archive = "https://github.com/kaspernj/tree-sitter-swift/archive/2a4515bb1d2d075c4c72a3466fbccb75f5269caf.tar.gz"
const fixtures = [
  ["fixtures/program.swift", "6b5548a722da3a94a7f26bf0590e6a7811c8b13b242dae328007471eac2fa075"],
  ["fixtures/scalars/program.swift", "5bc1fd210fb93ebf26abc7ed9d10c9d5c531d3d1c94e134b4215afa0ebc88a45"],
  ["fixtures/locals/program.swift", "86bf2e710b19c1aeee55a65004e05af8cfde93fa4431408a606b30a22ed4d9f8"],
  ["fixtures/operators/program.swift", "98a757c6c97a319e4a340beda099a826d3da6dda75917deb17a2dedc2224bb63"],
  ["fixtures/statements/program.swift", "abbf5a47fbebf3bee95fbdc06de23d22ca910cc3db5d423cd5fd556ceab2e936"]
]

/** @param {import("tree-sitter").SyntaxNode} root */
function descendants(root) {
  const pending = [root]
  const visited = []

  while (pending.length) {
    const node = pending.pop()

    assert.ok(node)
    visited.push(node)
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index)

      assert.ok(child)
      pending.push(child)
    }
  }
  return visited
}

describe("qualified Tree-sitter Swift fork route", () => {
  it("pins the immutable public HTTPS archive and install-safe native grammar", async () => {
    const [binding, grammar, manifest, lockfile, parserSource, scannerSource, bindingSource, declarations, nativeBinding] = await Promise.all([
      readFile(new URL("../node_modules/tree-sitter/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-swift/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-swift/src/parser.c", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-swift/src/scanner.c", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-swift/bindings/node/index.js", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-swift/bindings/node/index.d.ts", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-swift/build/Release/tree_sitter_swift_binding.node", import.meta.url))
    ])
    const locked = lockfile.packages["node_modules/tree-sitter-swift"]

    expect(process.versions.node.split(".")[0]).toEqual("24")
    expect(binding.version).toEqual("0.25.1")
    expect({license: grammar.license, version: grammar.version}).toEqual({license: "MIT", version: "0.7.1"})
    expect(grammar.peerDependencies["tree-sitter"]).toEqual("^0.25.1")
    expect(manifest.dependencies["tree-sitter-swift"]).toEqual(archive)
    expect(locked.resolved).toEqual(archive)
    expect(locked.integrity).toMatch(/^sha512-/u)
    expect(JSON.stringify(lockfile)).not.toMatch(/git\+ssh|tree-sitter-cli/u)
    expect(JSON.stringify(grammar.scripts)).not.toMatch(/https?:|curl|wget|fetch/u)
    expect(parserSource).toMatch(/#define LANGUAGE_VERSION 14/u)
    expect(scannerSource).toContain("tree_sitter/parser.h")
    expect(bindingSource).toContain("node-gyp-build")
    expect(declarations).toContain("nodeTypeInfo")
    expect(nativeBinding.byteLength > 0).toBeTrue()
  })

  it("loads on Node 24 and deterministically traverses every accepted profile child", async () => {
    const parser = new Parser()
    const kinds = new Set()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (SwiftLanguage)))
    for (const [fixture, expectedHash] of fixtures) {
      const source = await readFile(new URL(fixture, import.meta.url), "utf8")
      const first = parser.parse(source).rootNode
      const second = parser.parse(source).rootNode
      const visited = descendants(first)

      expect(first.type).toEqual("source_file")
      expect(first.hasError).toBeFalse()
      expect(first.toString()).toEqual(second.toString())
      expect(visited.some(({isNamed}) => isNamed)).toBeTrue()
      expect(visited.some(({isNamed}) => !isNamed)).toBeTrue()
      expect(visited.some(({childCount}) => childCount == 0)).toBeTrue()
      expect(createHash("sha256").update(source).digest("hex")).toEqual(expectedHash)
      for (const node of visited) kinds.add(node.type)
    }
    for (const kind of ["function_declaration", "parameter", "type_annotation", "property_declaration", "assignment",
      "if_statement", "control_transfer_statement", "call_expression", "additive_expression", "multiplicative_expression",
      "comparison_expression", "equality_expression", "infix_expression", "prefix_expression", "line_string_literal"]) {
      expect(kinds.has(kind)).toBeTrue()
    }
  })

  it("keeps recovery and conditional compilation visible with UTF-16 locations", () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (SwiftLanguage)))
    for (const source of [
      "func broken(_ left: Int64, _ right: Int64) -> Int64 { return left + }\n",
      "func broken(_ left: String, _ right: String) -> String { return \"missing }\n"
    ]) {
      const root = parser.parse(source).rootNode

      expect(root.hasError).toBeTrue()
      expect(descendants(root).some((node) => node.isError || node.isMissing)).toBeTrue()
    }
    const conditional = parser.parse("#if os(Linux)\nprint(1)\n#endif\n").rootNode

    expect(descendants(conditional).some((node) => node.type.includes("directive") || node.text.startsWith("#if"))).toBeTrue()
    const source = "// 😀\r\nfunc label(_ left: String, _ right: String) -> String { return \"😀\" }\r\nprint(label(\"a\", \"b\"))\r\n"
    const root = parser.parse(source).rootNode
    const literal = descendants(root).find((node) => node.isNamed && node.text == '"😀"')

    assert.ok(literal)
    const utf16Start = source.indexOf('"😀"')
    const utf8Start = new TextEncoder().encode(source.slice(0, utf16Start)).length

    expect(literal.startIndex).toEqual(utf16Start)
    expect(literal.startIndex == utf8Start).toBeFalse()
  })
})
