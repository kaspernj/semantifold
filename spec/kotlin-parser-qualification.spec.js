// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import Parser from "tree-sitter"
import KotlinLanguage from "tree-sitter-kotlin"

const commit = "57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0"
const dependency = `https://github.com/kaspernj/tree-sitter-kotlin/archive/${commit}.tar.gz`
const fixtures = [
  ["fixtures/program.kt", "b843c4672a3175fe75297f3692003cec0131eaee39e65ba1867f61e6184b0f05"],
  ["fixtures/scalars/program.kt", "42fd2c427a31d3d0b9427faf7781a7e7604399c370701203d06d2d54ceaea7f5"],
  ["fixtures/locals/program.kt", "52b74e0e8dcca0f2baff9cddf1b035b0e31afa85edd5b7bf1e2dfb220967d615"],
  ["fixtures/operators/program.kt", "90def0da9e20025e079d72b50722533d1f7223b1ba3cdbffa630b41c5fc9bc72"],
  ["fixtures/statements/program.kt", "bf4b05a00eafb1dbeaaabf7c2e7fea0cd8e034f4d3ff3b6e9fea177c31162aeb"]
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

describe("qualified Tree-sitter Kotlin fork route", () => {
  it("pins the immutable public HTTPS source archive and install-safe native grammar", async () => {
    const [binding, grammar, manifest, lockfile, parserSource, scannerSource, bindingSource, declarations, nativeBinding] = await Promise.all([
      readFile(new URL("../node_modules/tree-sitter/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-kotlin/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-kotlin/src/parser.c", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-kotlin/src/scanner.c", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-kotlin/bindings/node/index.js", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-kotlin/bindings/node/index.d.ts", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-kotlin/build/Release/tree_sitter_kotlin_binding.node", import.meta.url))
    ])
    const locked = lockfile.packages["node_modules/tree-sitter-kotlin"]

    expect(process.versions.node.split(".")[0]).toEqual("24")
    expect(binding.version).toEqual("0.25.1")
    expect({license: grammar.license, version: grammar.version}).toEqual({license: "MIT", version: "0.4.0"})
    expect(grammar.peerDependencies["tree-sitter"]).toEqual("^0.25.1")
    expect(manifest.dependencies["tree-sitter-kotlin"]).toEqual(dependency)
    expect(locked.resolved).toEqual(dependency)
    expect(locked.integrity).toMatch(/^sha512-/u)
    expect(locked.inBundle).toEqual(undefined)
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

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (KotlinLanguage)))
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
    for (const kind of ["function_declaration", "function_value_parameters", "parameter", "variable_declaration", "assignment",
      "if_expression", "jump_expression", "call_expression", "additive_expression", "multiplicative_expression",
      "comparison_expression", "equality_expression", "conjunction_expression", "disjunction_expression", "prefix_expression",
      "string_literal"]) expect(kinds.has(kind)).toBeTrue()
  })

  it("keeps recovery, annotations, and package syntax visible with UTF-16 locations", () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (KotlinLanguage)))
    for (const source of [
      "fun broken(left: Long, right: Long): Long { return left + }\n",
      "fun broken(left: String, right: String): String { return \"missing }\n"
    ]) {
      const root = parser.parse(source).rootNode

      expect(root.hasError).toBeTrue()
      expect(descendants(root).some((node) => node.isError || node.isMissing)).toBeTrue()
    }
    const excluded = parser.parse("@file:JvmName(\"Other\")\npackage sample\nfun main() {}\n").rootNode

    expect(descendants(excluded).some((node) => ["file_annotation", "package_header"].includes(node.type))).toBeTrue()
    const source = "// 😀\r\nfun label(left: String, right: String): String { return \"😀\" }\r\nfun main() { println(label(\"a\", \"b\")) }\r\n"
    const root = parser.parse(source).rootNode
    const literal = descendants(root).find((node) => node.isNamed && node.text == '"😀"')

    assert.ok(literal)
    const utf16Start = source.indexOf('"😀"')
    const utf8Start = new TextEncoder().encode(source.slice(0, utf16Start)).length

    expect(literal.startIndex).toEqual(utf16Start)
    expect(literal.startIndex == utf8Start).toBeFalse()
  })
})
