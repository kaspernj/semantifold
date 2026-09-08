// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parseCppCst} from "../src/frontends/cpp-parser.js"

/** @param {import("../src/frontends/cpp-parser.js").CstNode} node */
function descendants(node) {
  return [node, ...node.children.flatMap(({node: child}) => descendants(child))]
}

describe("official CPP grammar reproducible qualification", () => {
  it("traverses every frozen named, anonymous, comment and field edge in the five qualified probes", async () => {
    const kinds = new Set()
    let total = 0

    for (let index = 1; index <= 5; index++) {
      const source = await readFile(new URL(`fixtures/cpp-qualification/corpus-${index}.cpp`, import.meta.url), "utf8")
      const snapshot = parseCppCst(source)

      expect(Object.isFrozen(snapshot)).toBeTrue()
      expect(snapshot.root.endIndex).toEqual(source.length)
      for (const node of descendants(snapshot.root)) {
        kinds.add(node.type)
        total++
        expect(Object.isFrozen(node)).toBeTrue()
        expect(Object.isFrozen(node.children)).toBeTrue()
        expect(node.hasError || node.error || node.missing).toBeFalse()
        for (const edge of node.children) {
          expect(Object.isFrozen(edge)).toBeTrue()
          assert.ok(edge.field === null || typeof edge.field == "string")
          assert.ok(edge.node.startIndex >= node.startIndex && edge.node.endIndex <= node.endIndex)
        }
      }
    }
    expect(total).toEqual(390)
    for (const kind of ["qualified_identifier", "namespace_identifier", "type_identifier", "condition_clause", "parameter_declaration",
      "init_declarator", "assignment_expression", "return_statement", "call_expression", "unary_expression", "binary_expression",
      "string_literal", "escape_sequence", "comment", "preproc_include", "{", "}", "::"]) expect(kinds.has(kind)).toBeTrue()
  })

  it("keeps precise UTF-16 CRLF/astral locations and explicit missing/error/recovery nodes", () => {
    const source = "/* 😀 */\r\nstd::string copy(std::string a, std::string b) { return a; }\r\n"
    const snapshot = parseCppCst(source)

    expect(snapshot.root.children[1].node.startIndex).toEqual(10)
    expect(Buffer.byteLength(source.slice(0, 10))).toEqual(12)
    for (const source of ["int main() { return 0;", "int main( { return 0; }", "bool f(bool a, bool b) { return a && ; }", 'std::string f(std::string a, std::string b) { return "broken; }']) {
      const root = parseCppCst(source).root

      expect(root.hasError).toBeTrue()
      expect(descendants(root).some(node => node.error || node.missing)).toBeTrue()
    }
  })
})
