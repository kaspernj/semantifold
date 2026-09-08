// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@velocious/testing"
import {verifyLegacyRuntime} from "../scripts/verify-legacy-runtime.js"

await verifyLegacyRuntime(fileURLToPath(new URL("../", import.meta.url)))

/** @param {unknown} value */
function assertDeeplyFrozen(value) {
  if (value == null || typeof value != "object") return

  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertDeeplyFrozen(child)
}

describe("legacy Tree-sitter adapter", () => {
  it("parses C++ through its official grammar while retaining frozen parser-neutral isolation", async () => {
    const {parseCst} = await import("semantifold-tree-sitter-legacy-internal")
    const source = "/* 😀 */\r\nstd::string copy(std::string a, std::string b) { return a; }\n"
    const snapshot = parseCst(source, "cpp")

    expect(snapshot.language).toEqual("cpp")
    expect(snapshot.root.hasError).toBeFalse()
    expect(snapshot.root.children[1].node.startIndex).toEqual(10)
    expect(descendants(snapshot.root).some(({type}) => type == "qualified_identifier")).toBeTrue()
    assertDeeplyFrozen(snapshot)
    assert.equal(containsFunction(snapshot), false)
    expect(parseCst(source).root.hasError).toBeTrue()
    const broken = parseCst("int main() { return 0;", "cpp")

    expect(broken.root.hasError).toBeTrue()
    expect(descendants(broken.root).some(({missing}) => missing)).toBeTrue()
  })

  it("returns a frozen parser-neutral C CST with ordered field-bearing edges", async () => {
    const {parseCst} = await import("semantifold-tree-sitter-legacy-internal")
    const source = "int main(void) { return 0; }\n"
    const snapshot = parseCst(source)

    expect({language: snapshot.language, schema: snapshot.schema, version: snapshot.version}).toEqual({
      language: "c", schema: "semantifold.parser-cst", version: 1
    })
    expect(Object.keys(snapshot).sort()).toEqual(["language", "root", "schema", "version"])
    expect(snapshot.root.type).toEqual("translation_unit")
    expect(snapshot.root.children.map(({field, node}) => [field, node.type])).toEqual([
      [null, "function_definition"]
    ])
    expect(snapshot.root.children[0]?.node.children.map(({field, node}) => [field, node.type])).toEqual([
      ["type", "primitive_type"],
      ["declarator", "function_declarator"],
      ["body", "compound_statement"]
    ])
    expect(source.slice(snapshot.root.startIndex, snapshot.root.endIndex)).toEqual(source)
    assertDeeplyFrozen(snapshot)
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot)
  })

  it("emits declarations containing only the parser-neutral internal contract", async () => {
    const declarations = await readFile(new URL(
      "../packages/tree-sitter-legacy/build/c.d.ts", import.meta.url
    ), "utf8")
    const declarationsWithoutComments = declarations.replace(/\/\*[\s\S]*?\*\//gu, "")

    expect(declarations).toContain('export declare function parseCst(source: string, language?: "c" | "cpp"): CstSnapshot')
    expect(declarationsWithoutComments).not.toMatch(
      /(?:from|import\()["']tree-sitter|SyntaxNode|\bParser\b|\bTree\b|\bLanguage\b/u
    )
  })

  it("preserves recovery, extras, and UTF-16 positions without native values", async () => {
    const {parseCst} = await import("semantifold-tree-sitter-legacy-internal")
    const prefix = "/* 😀 */\r\n"
    const source = `${prefix}int main(void) { return 0;\r\n`
    const snapshot = parseCst(source)
    const nodes = descendants(snapshot.root)
    const comment = nodes.find(({type}) => type == "comment")
    const functionDefinition = nodes.find(({type}) => type == "function_definition")

    assert.ok(comment)
    assert.ok(functionDefinition)
    expect(comment.extra).toBeTrue()
    expect(functionDefinition.startIndex).toEqual(prefix.length)
    expect(functionDefinition.startPosition).toEqual({column: 0, row: 1})
    expect(snapshot.root.hasError).toBeTrue()
    expect(nodes.some(({missing}) => missing)).toBeTrue()
    for (const node of nodes) {
      expect(Object.keys(node).sort()).toEqual([
        "children", "endIndex", "endPosition", "error", "extra", "hasError", "missing", "named",
        "startIndex", "startPosition", "type"
      ])
      for (const edge of node.children) expect(Object.keys(edge).sort()).toEqual(["field", "node"])
    }
    assertDeeplyFrozen(snapshot)
    assert.equal(containsFunction(snapshot), false)
  })
})

/** @param {unknown} value */
function containsFunction(value) {
  if (typeof value == "function") return true
  if (value == null || typeof value != "object") return false
  for (const child of Object.values(value)) {
    if (containsFunction(child)) return true
  }
  return false
}

/** @param {import("semantifold-tree-sitter-legacy-internal").CstNode} root */
function descendants(root) {
  return [root, ...root.children.flatMap(({node}) => descendants(node))]
}
