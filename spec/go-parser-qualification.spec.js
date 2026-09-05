// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import Parser from "tree-sitter"
import GoLanguage from "tree-sitter-go/bindings/node/index.js"

const fixtures = [
  ["fixtures/program.go", "5f4ad40a233d8728c90ca885d4bfe6f018f1d7a5e6f2e2cfb97b4b9db4887f1c"],
  ["fixtures/scalars/program.go", "6d4251def8b1bccdff177df901bf9fe109a8a01ae1514cb8d5aaf364298669b9"],
  ["fixtures/locals/program.go", "a7b6eb2f5eae0a20d7cd4982e4d26cc6653760ad03e8b21ff5c360239861dd6f"],
  ["fixtures/operators/program.go", "4a263413830a41a59b6d8326a78067826853e3491e65d52559e5acea0d9cf56c"],
  ["fixtures/statements/program.go", "d64f083d70697d25d2ea7f5c7a44cada0ab13a878640fd10bc547df185fa7bba"]
]

describe("qualified Tree-sitter Go route", () => {
  it("pins the official typed registry grammar and compatible parser peer", async () => {
    const [binding, grammar, manifest, lockfile, parserSource, apiHeader, declarations] = await Promise.all([
      readFile(new URL("../node_modules/tree-sitter/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-go/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-go/src/parser.c", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter/vendor/tree-sitter/lib/include/tree_sitter/api.h", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-go/bindings/node/index.d.ts", import.meta.url), "utf8")
    ])

    expect({license: grammar.license, repository: grammar.repository, version: grammar.version}).toEqual({
      license: "MIT", repository: "https://github.com/tree-sitter/tree-sitter-go", version: "0.25.0"
    })
    expect(grammar.engines).toEqual(undefined)
    expect(grammar.peerDependencies["tree-sitter"]).toEqual("^0.25.0")
    expect(binding.version).toEqual("0.25.1")
    expect(grammar.scripts.install).toEqual("node-gyp-build")
    expect(JSON.stringify(grammar.scripts)).not.toMatch(/https?:|curl|wget|fetch/u)
    expect(manifest.dependencies["tree-sitter-go"]).toEqual("0.25.0")
    expect(lockfile.packages["node_modules/tree-sitter-go"].resolved)
      .toEqual("https://registry.npmjs.org/tree-sitter-go/-/tree-sitter-go-0.25.0.tgz")
    expect(lockfile.packages["node_modules/tree-sitter-go"].integrity)
      .toEqual("sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw==")
    expect(parserSource).toMatch(/#define LANGUAGE_VERSION 15/u)
    expect(apiHeader).toMatch(/TREE_SITTER_LANGUAGE_VERSION 15/u)
    expect(apiHeader).toMatch(/TREE_SITTER_MIN_COMPATIBLE_LANGUAGE_VERSION 13/u)
    expect(declarations).toContain("nodeTypeInfo: NodeInfo[]")
  })

  it("loads on Node 24 and exhaustively traverses the five accepted CSTs", async () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (GoLanguage)))
    for (const [fixture, expectedHash] of fixtures) {
      const source = await readFile(new URL(fixture, import.meta.url), "utf8")
      const root = parser.parse(source).rootNode
      const visited = {anonymous: 0, comments: 0, leaves: 0, named: 0}
      const fields = new Set()
      const traverse = (node) => {
        visited[node.isNamed ? "named" : "anonymous"] += 1
        if (node.type == "comment") visited.comments += 1
        if (node.childCount == 0) visited.leaves += 1
        for (let index = 0; index < node.childCount; index += 1) {
          const child = node.child(index)

          assert.ok(child)
          const field = node.fieldNameForChild(index)

          if (field) fields.add(`${node.type}.${field}->${child.type}`)
          traverse(child)
        }
      }

      traverse(root)
      expect(root.hasError).toBeFalse()
      expect(visited.named > 0).toBeTrue()
      expect(visited.anonymous > 0).toBeTrue()
      expect(visited.leaves > 0).toBeTrue()
      expect(fields.has("function_declaration.body->block")).toBeTrue()
      expect(createHash("sha256").update(source).digest("hex")).toEqual(expectedHash)
    }
    expect(GoLanguage.nodeTypeInfo.length).toEqual(188)
  })

  it("keeps directives and recovery visible and exposes UTF-16 indexes across astral CRLF text", () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (GoLanguage)))
    for (const source of [
      "package\nfunc main() {}\n",
      "package main\nfunc broken(left int64, right int64) int64 { return left + }\n",
      "package main\nfunc main() { var value string = \"missing }\n"
    ]) {
      const root = parser.parse(source).rootNode
      let recovery = 0
      const traverse = (node) => {
        if (node.hasError || node.isError || node.isMissing) recovery += 1
        for (let index = 0; index < node.childCount; index += 1) {
          const child = node.child(index)

          assert.ok(child)
          traverse(child)
        }
      }

      traverse(root)
      expect(root.hasError).toBeTrue()
      expect(recovery > 0).toBeTrue()
    }
    const directives = parser.parse("//go:build linux\n// +build linux\n//line remapped.go:10\npackage main\nfunc main() {}\n").rootNode

    expect(directives.descendantsOfType("comment").length).toEqual(3)
    const source = "package main\r\n// 😀\r\nfunc main() { var value string = \"😀\" }\r\n"
    const literal = parser.parse(source).rootNode.descendantsOfType("interpreted_string_literal")[0]

    assert.ok(literal)
    const utf16Start = source.indexOf("\"😀\"")
    const utf8Start = new TextEncoder().encode(source.slice(0, utf16Start)).length

    expect(literal.startIndex).toEqual(utf16Start)
    expect(literal.startIndex == utf8Start).toBeFalse()
    expect(source.slice(literal.startIndex, literal.endIndex)).toEqual("\"😀\"")
  })
})
