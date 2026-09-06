// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"

/** @param {unknown} value */
function assertDeeplyFrozen(value) {
  if (value == null || typeof value != "object") return

  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertDeeplyFrozen(child)
}

describe("legacy Tree-sitter adapter", () => {
  it("returns a frozen parser-neutral C CST with ordered field-bearing edges", async () => {
    const {parseCst} = await import("@kaspernj/semantifold-tree-sitter-legacy/c")
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

  it("emits declarations containing only the parser-neutral public contract", async () => {
    const declarations = await readFile(new URL(
      "../packages/tree-sitter-legacy/build/c.d.ts", import.meta.url
    ), "utf8")
    const declarationsWithoutComments = declarations.replace(/\/\*[\s\S]*?\*\//gu, "")

    expect(declarations).toContain("export declare function parseCst(source: string): CstSnapshot")
    expect(declarationsWithoutComments).not.toMatch(
      /(?:from|import\()["']tree-sitter|SyntaxNode|\bParser\b|\bTree\b|\bLanguage\b/u
    )
  })

  it("preserves recovery, extras, and UTF-16 positions without native values", async () => {
    const {parseCst} = await import("@kaspernj/semantifold-tree-sitter-legacy/c")
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

/** @param {import("@kaspernj/semantifold-tree-sitter-legacy/c").CstNode} root */
function descendants(root) {
  return [root, ...root.children.flatMap(({node}) => descendants(node))]
}
