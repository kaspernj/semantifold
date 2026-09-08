// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {createRequire} from "node:module"
import {describe, expect, it} from "@velocious/testing"
import {parseCppCst} from "../src/frontends/cpp-parser.js"
import {parseCst} from "../src/frontends/c-parser.js"

const require = createRequire(import.meta.url)
/** @type {{parseCst: (source: string, language: string) => import("../packages/tree-sitter-legacy/runtime/src/c.js").CstSnapshot}} */
const boundary = require("semantifold-tree-sitter-legacy-internal")

/** @param {import("../packages/tree-sitter-legacy/runtime/src/c.js").CstNode} node */
function descendants(node) {
  return [node, ...node.children.flatMap(({node: child}) => descendants(child))]
}

describe("official Rust grammar frozen boundary qualification", () => {
  it("retains every named, anonymous, extra, macro and field edge as frozen plain data", async () => {
    const kinds = new Set()

    for (const name of ["base", "scalars", "locals", "operators", "statements", "scaffolds", "coordinates"]) {
      const source = await readFile(new URL(`fixtures/rust-qualification/${name}.rs`, import.meta.url), "utf8")
      const snapshot = boundary.parseCst(source, "rust")

      expect(snapshot.schema).toEqual("semantifold.parser-cst")
      expect(snapshot.version).toEqual(1)
      expect(snapshot.language).toEqual("rust")
      expect(Object.isFrozen(snapshot)).toBeTrue()
      expect(snapshot.root.endIndex).toEqual(source.length)
      for (const node of descendants(snapshot.root)) {
        kinds.add(node.type)
        expect(Object.getPrototypeOf(node)).toEqual(Object.prototype)
        expect(Object.isFrozen(node)).toBeTrue()
        expect(Object.isFrozen(node.children)).toBeTrue()
        expect(Object.isFrozen(node.startPosition)).toBeTrue()
        expect(Object.isFrozen(node.endPosition)).toBeTrue()
        expect(node.error || node.missing || node.hasError).toBeFalse()
        assert.deepEqual(Object.keys(node).sort(), ["children", "endIndex", "endPosition", "error", "extra", "hasError", "missing", "named", "startIndex", "startPosition", "type"])
        for (const [offset, point] of [[node.startIndex, node.startPosition], [node.endIndex, node.endPosition]]) {
          const lines = source.slice(0, Number(offset)).split("\n")

          expect(point).toEqual({column: lines.at(-1).length, row: lines.length - 1})
        }
        for (const edge of node.children) {
          expect(Object.isFrozen(edge)).toBeTrue()
          assert.ok(edge.field === null || typeof edge.field == "string")
          assert.ok(edge.node.startIndex >= node.startIndex && edge.node.endIndex <= node.endIndex)
        }
      }
    }
    for (const kind of ["function_item", "parameter", "primitive_type", "type_identifier", "let_declaration", "mutable_specifier",
      "assignment_expression", "return_expression", "if_expression", "else_clause", "call_expression", "binary_expression",
      "unary_expression", "scoped_identifier", "field_expression", "reference_expression", "macro_invocation", "token_tree",
      "string_literal", "escape_sequence", "line_comment", "block_comment", "inner_attribute_item", "(", ")", "{", "}", ":", "::", ";"]) {
      expect(kinds.has(kind)).toBeTrue()
    }
  })

  it("preserves exact astral/CRLF offsets, recovery and the qualified input limit", () => {
    const source = '/* 😀 */\r\nfn copy(a: String, b: String) -> String { return a; }\r\n'
    const root = boundary.parseCst(source, "rust").root

    expect(root.children[1].node.startIndex).toEqual(10)
    expect(root.children[1].node.startPosition).toEqual({column: 0, row: 1})
    expect(Buffer.byteLength(source.slice(0, 10))).toEqual(12)
    for (const broken of ["fn main() {", "fn main() { let value: i64 = 1i64 }", "fn main() { println!(\"{}\", 1i64; }"]) {
      const recovered = boundary.parseCst(broken, "rust").root

      expect(recovered.hasError).toBeTrue()
      expect(descendants(recovered).some(node => node.error || node.missing)).toBeTrue()
    }
    const bounded = "fn main() {}".padEnd(32767, " ")

    expect(boundary.parseCst(bounded, "rust").root.endIndex).toEqual(32767)
    assert.throws(() => boundary.parseCst(bounded + " ", "rust"), /Invalid argument/u)
  })

  it("keeps existing C/CPP parsing and rejects unqualified discriminator values", () => {
    expect(boundary.parseCst("fn main() {}", "rust").root.hasError).toBeFalse()
    expect(parseCst("int main(void) { return 0; }").root.hasError).toBeFalse()
    expect(parseCppCst("bool same(bool a, bool b) { return a == b; }").root.hasError).toBeFalse()
    assert.throws(() => boundary.parseCst("fn main() {}", "rust-next"), /Unsupported private parser language/u)
  })
})
