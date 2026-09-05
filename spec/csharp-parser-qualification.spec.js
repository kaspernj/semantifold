// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import Parser from "tree-sitter"
import CSharpLanguage from "tree-sitter-c-sharp/bindings/node/index.js"

const fixtures = [
  ["fixtures/Program.cs", "5ca661d09dff2d775094df99b40e5c5604796c9bff4c32c1da11fa1b4c564a00"],
  ["fixtures/scalars/Program.cs", "9cefd6d01c5855480629829489945f2f43338b84879c7a26043963151a8439da"],
  ["fixtures/locals/Program.cs", "ee775fea59ee812212ce325152e4e4cb79c20e699aba081bf39cc698b324444d"],
  ["fixtures/operators/Program.cs", "7137f4acc88dbdc1d0bafd6bb8eb57bed9386daf3e6b11c6fbae3831abceae18"],
  ["fixtures/statements/Program.cs", "ba63cb72490605437e1efaa7d69ce0abdbfbb07c076aec787bc025e7a277468f"]
]

describe("qualified Tree-sitter C# route", () => {
  it("pins the official typed registry binding with the qualified release contract", async () => {
    const [binding, grammar, manifest, lockfile, parserSource, apiHeader, declarations] = await Promise.all([
      readFile(new URL("../node_modules/tree-sitter/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-c-sharp/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-c-sharp/src/parser.c", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter/vendor/tree-sitter/lib/include/tree_sitter/api.h", import.meta.url), "utf8"),
      readFile(new URL("../node_modules/tree-sitter-c-sharp/bindings/node/index.d.ts", import.meta.url), "utf8")
    ])

    expect({license: grammar.license, repository: grammar.repository, version: grammar.version}).toEqual({
      license: "MIT", repository: "https://github.com/tree-sitter/tree-sitter-c-sharp", version: "0.23.5"
    })
    expect(grammar.engines).toEqual(undefined)
    expect(grammar.peerDependencies["tree-sitter"]).toEqual("^0.25.0")
    expect(binding.version).toEqual("0.25.1")
    expect(grammar.scripts.install).toEqual("node-gyp-build")
    expect(JSON.stringify(grammar.scripts)).not.toMatch(/https?:|curl|wget|fetch/u)
    expect(manifest.dependencies["tree-sitter-c-sharp"]).toEqual("0.23.5")
    expect(lockfile.packages["node_modules/tree-sitter-c-sharp"].resolved)
      .toEqual("https://registry.npmjs.org/tree-sitter-c-sharp/-/tree-sitter-c-sharp-0.23.5.tgz")
    expect(lockfile.packages["node_modules/tree-sitter-c-sharp"].integrity)
      .toEqual("sha512-xJGOeXPMmld0nES5+080N/06yY6LQi+KWGWV4LfZaZe6srJPtUtfhIbRSN7EZN6IaauzW28v6W4QHFwmeUW6HQ==")
    expect(parserSource).toMatch(/#define LANGUAGE_VERSION 15/u)
    expect(apiHeader).toMatch(/TREE_SITTER_LANGUAGE_VERSION 15/u)
    expect(apiHeader).toMatch(/TREE_SITTER_MIN_COMPATIBLE_LANGUAGE_VERSION 13/u)
    expect(declarations).toContain("declare const binding")
  })

  it("loads on Node 24 and traverses every named, anonymous, comment, and directive node", async () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (CSharpLanguage)))
    for (const [fixture, expectedHash] of fixtures) {
      const source = await readFile(new URL(fixture, import.meta.url), "utf8")
      const root = parser.parse(source).rootNode
      const visited = {anonymous: 0, comments: 0, directives: 0, named: 0}
      const fields = new Set()
      const traverse = (node) => {
        if (node.isNamed) visited.named += 1
        else visited.anonymous += 1
        if (node.type == "comment") visited.comments += 1
        if (node.type.startsWith("preproc_")) visited.directives += 1
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
      expect(visited.directives).toEqual(1)
      expect(fields.has("method_declaration.body->block")).toBeTrue()
      expect(createHash("sha256").update(source).digest("hex")).toEqual(expectedHash)
    }
  })

  it("exposes explicit and propagated recovery while retaining UTF-16LE indexes across astral CRLF text", () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (CSharpLanguage)))
    for (const source of [
      "#nullable enable\nnamespace Semantifold.Generated; internal static class Program {",
      "#nullable enable\nnamespace Semantifold.Generated; internal static class Program { private static long Broken(long left, long right) { return checked(left - ); } }",
      "#nullable enable\nnamespace Semantifold.Generated; internal static class Program { private static void Main() { System.Console.WriteLine(1L) } }"
    ]) {
      const root = parser.parse(source).rootNode
      let recoveryNodes = 0
      const traverse = (node) => {
        if (node.hasError || node.isError || node.isMissing) recoveryNodes += 1
        for (let index = 0; index < node.childCount; index += 1) {
          const child = node.child(index)

          assert.ok(child)
          traverse(child)
        }
      }

      traverse(root)
      expect(root.hasError).toBeTrue()
      expect(recoveryNodes > 0).toBeTrue()
    }

    const source = "// 😀\r\n#nullable enable\r\nnamespace Semantifold.Generated;\r\ninternal static class Program { private static string Café(string left, string right) { return \"😀\"; } private static void Main() { System.Console.WriteLine(Café(\"é\", \"x\")); } }\r\n"
    const root = parser.parse(source).rootNode
    const identifier = root.descendantsOfType("identifier").find((node) => node.text == "Café")
    const literal = root.descendantsOfType("string_literal").find((node) => node.text.includes("😀"))

    assert.ok(identifier)
    assert.ok(literal)
    const utf16Start = source.indexOf("Café")
    const utf8Start = new TextEncoder().encode(source.slice(0, utf16Start)).length

    expect(identifier.startIndex).toEqual(utf16Start)
    expect(identifier.startIndex == utf8Start).toBeFalse()
    expect(source.slice(literal.startIndex, literal.endIndex)).toEqual("\"😀\"")
  })
})
