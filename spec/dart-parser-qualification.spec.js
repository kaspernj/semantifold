// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import Parser from "tree-sitter"
import DartLanguage from "tree-sitter-dart-orchard/bindings/node/index.js"
import {utf8ByteOffsetToUtf16Offset} from "../src/semantic/location.js"
import {hasOnlyUnicodeScalars} from "../src/semantic/scalars.js"

const fixtures = [
  ["fixtures/program.dart", "e4e06faab4c539f16bdd712a8be40f53e3f1a4aef430ec021db3a4723762893b"],
  ["fixtures/scalars/program.dart", "96d02a48ebfc53362da4d963347909471428033164c0356a99fb866824441b5e"],
  ["fixtures/locals/program.dart", "738a1a8e41a51abc198ddc3978f77ddb784f2c3720e065d28a1d99073c49fc72"],
  ["fixtures/operators/program.dart", "ef0e6c233730b5776b2484d4abb6d3af6068a27e657933c646b30bba3dac0c04"],
  ["fixtures/statements/program.dart", "c5edc983553c50ce393563953927d1d18f0b0e33d10f4381f87f1e7645ee84e8"],
  ["fixtures/functions/program.dart", "64c7eaec72b624781c102a1a6740cbbbc653148f6778f4282e5b3c187ea4bd4c"]
]

/** @returns {Parser} A parser configured with the qualified grammar. */
function dartParser() {
  const parser = new Parser()

  parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (DartLanguage)))
  return parser
}

/**
 * Traverses every named and anonymous child through the indexed API.
 * @param {import("tree-sitter").SyntaxNode} root Root node.
 * @returns {{nodes: import("tree-sitter").SyntaxNode[], fields: Set<string>}} Traversal evidence.
 */
function descendants(root) {
  const pending = [root]
  const nodes = []
  const fields = new Set()

  while (pending.length > 0) {
    const node = pending.pop()

    assert.ok(node)
    nodes.push(node)
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index)

      assert.ok(child)
      const field = node.fieldNameForChild(index)

      if (field) fields.add(`${node.type}.${field}->${child.type}`)
      pending.push(child)
    }
  }
  return {fields, nodes}
}

describe("qualified Tree-sitter Dart Orchard route", () => {
  it("pins exact registry provenance, ABI 14, typed metadata, and local native source", async () => {
    const [binding, grammar, manifest, lockfile, parserSource, scannerSource, declarations, loader, license] =
      await Promise.all([
        readFile(new URL("../node_modules/tree-sitter/package.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("../node_modules/tree-sitter-dart-orchard/package.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
        readFile(new URL("../node_modules/tree-sitter-dart-orchard/src/parser.c", import.meta.url), "utf8"),
        readFile(new URL("../node_modules/tree-sitter-dart-orchard/src/scanner.c", import.meta.url), "utf8"),
        readFile(new URL("../node_modules/tree-sitter-dart-orchard/bindings/node/index.d.ts", import.meta.url), "utf8"),
        readFile(new URL("../node_modules/tree-sitter-dart-orchard/bindings/node/index.js", import.meta.url), "utf8"),
        readFile(new URL("../node_modules/tree-sitter-dart-orchard/LICENSE", import.meta.url), "utf8")
      ])
    const locked = lockfile.packages["node_modules/tree-sitter-dart-orchard"]

    expect(process.versions.node.split(".")[0]).toEqual("24")
    expect(binding.version).toEqual("0.25.1")
    expect({engines: grammar.engines, license: grammar.license, repository: grammar.repository, version: grammar.version})
      .toEqual({
        engines: undefined,
        license: "MIT",
        repository: {type: "git", url: "git+https://codeberg.org/grammar-orchard/tree-sitter-dart-orchard.git"},
        version: "0.7.0"
      })
    expect(grammar.dependencies).toEqual({"node-addon-api": "^8.5.0", "node-gyp-build": "^4.8.4"})
    expect(grammar.peerDependencies).toEqual({"tree-sitter": "^0.25.0"})
    expect(grammar.scripts.install).toEqual("node-gyp-build")
    expect(JSON.stringify(grammar.scripts)).not.toMatch(/https?:|curl|wget|fetch/u)
    expect(manifest.dependencies["tree-sitter-dart-orchard"]).toEqual("0.7.0")
    expect(locked.resolved).toEqual("https://registry.npmjs.org/tree-sitter-dart-orchard/-/tree-sitter-dart-orchard-0.7.0.tgz")
    expect(locked.integrity).toEqual("sha512-dO4hyC6eCz7tnXNWk7ZZ/CVzorvWQKRhxRYUT/uwAnA50m+4Jbogd1Oh33lPcj1/bP9wG1pS3TWQEfs1W3LFbg==")
    expect(parserSource).toMatch(/#define LANGUAGE_VERSION 14/u)
    expect(scannerSource).toContain("tree_sitter/parser.h")
    expect(declarations).toContain("nodeTypeInfo: NodeInfo[]")
    expect(loader).toContain("node-gyp-build")
    expect(loader).not.toMatch(/https?:|curl|wget|fetch/u)
    expect(createHash("sha256").update(license).digest("hex"))
      .toEqual("d270cb3a4985d75033bd77d875ccebff1d66e32788a3f727891e28d76132dd46")
    expect(license).toContain("Permission is hereby granted, free of charge")
    expect(DartLanguage.nodeTypeInfo.length).toEqual(359)
  })

  it("loads beside Tree-sitter 0.25.1 and traverses the complete Tasks 001-005 corpus", async () => {
    const parser = dartParser()
    const kinds = new Set()
    const fields = new Set()
    let anonymous = 0
    let named = 0

    for (const [fixture, expectedHash] of fixtures) {
      const source = await readFile(new URL(fixture, import.meta.url), "utf8")
      const first = parser.parse(source).rootNode
      const second = parser.parse(source).rootNode
      const traversal = descendants(first)

      expect(first.type).toEqual("program")
      expect(first.hasError).toBeFalse()
      expect(first.toString()).toEqual(second.toString())
      expect(createHash("sha256").update(source).digest("hex")).toEqual(expectedHash)
      for (const node of traversal.nodes) {
        kinds.add(node.type)
        if (node.isNamed) named += 1
        else anonymous += 1
      }
      for (const field of traversal.fields) fields.add(field)
    }
    expect(named > 0).toBeTrue()
    expect(anonymous > 0).toBeTrue()
    for (const kind of [
      "function_signature", "function_body", "formal_parameter_list", "formal_parameter", "type_identifier",
      "void_type", "block", "local_variable_declaration", "initialized_variable_definition",
      "assignment_expression", "if_statement", "return_statement", "expression_statement", "method_invocation", "arguments",
      "decimal_integer_literal", "string_literal", "true", "false", "parenthesized_expression", "unary_expression",
      "additive_expression", "multiplicative_expression", "relational_expression", "equality_expression",
      "logical_and_expression", "logical_or_expression"
    ]) expect(kinds.has(kind)).toBeTrue()
    expect(fields.has("function_signature.name->identifier")).toBeTrue()
    expect(fields.has("initialized_variable_definition.value->method_invocation")).toBeTrue()
    expect(fields.has("if_statement.alternative->if_statement")).toBeTrue()
  })

  it("keeps comments and excluded valid Dart syntax visible as rejectable CST nodes", () => {
    const parser = dartParser()
    const source = "// ordinary\nimport 'dart:async';\n@deprecated\n" +
      "Future<int> bad(int? value, {required String name = 'x'}) async {\n" +
      "  var result = value ?? 0;\n  return await Future.value(result as int);\n}\n" +
      "class Box<T> { T value; Box(this.value); }\n"
    const root = parser.parse(source).rootNode
    const nodes = descendants(root).nodes
    const kinds = new Set(nodes.map(({type}) => type))

    expect(root.hasError).toBeFalse()
    for (const kind of [
      "comment", "import_or_export", "library_import", "annotation", "type_arguments", "nullable_type",
      "optional_formal_parameters", "inferred_type", "if_null_expression", "await_expression", "type_cast_expression",
      "class_definition", "type_parameters", "constructor_signature"
    ]) expect(kinds.has(kind)).toBeTrue()
    for (const literal of ["r\"raw\"", "\"\"\"multi\nline\"\"\""]) {
      const literalRoot = parser.parse(`String value() { return ${literal}; }`).rootNode
      const string = descendants(literalRoot).nodes.find(({type}) => type == "string_literal")

      assert.ok(string)
      expect(literalRoot.hasError).toBeFalse()
      expect(string.text).toEqual(literal)
    }
    const interpolation = parser.parse('String value(String name) { return "hello $name"; }').rootNode

    expect(descendants(interpolation).nodes.some(({type}) => type == "template_substitution")).toBeTrue()
  })

  it("propagates malformed recovery and exposes exact UTF-16/UTF-8 boundaries", () => {
    const parser = dartParser()

    for (const source of [
      "void main() {",
      "void main( { }",
      "int broken(int left, int right) { return left + ; }",
      "void main() { print(\"unterminated); }",
      "void main() { print(1) }"
    ]) {
      const root = parser.parse(source).rootNode
      const nodes = descendants(root).nodes

      expect(root.hasError).toBeTrue()
      expect(nodes.some((node) => node.hasError || node.isError || node.isMissing)).toBeTrue()
    }
    const source = "// 😀\r\n\rString label(String value) { return \"😀\"; }\r\n"
    const root = parser.parse(source).rootNode
    const literal = descendants(root).nodes.find((node) => node.type == "string_literal" && node.text == '"😀"')

    assert.ok(literal)
    const utf16Start = source.indexOf('"😀"')
    const utf8Start = new TextEncoder().encode(source.slice(0, utf16Start)).length

    expect(root.hasError).toBeFalse()
    expect(literal.startIndex).toEqual(utf16Start)
    expect(literal.startIndex == utf8Start).toBeFalse()
    expect(utf8ByteOffsetToUtf16Offset(source, utf8Start)).toEqual(utf16Start)
    assert.throws(() => utf8ByteOffsetToUtf16Offset(source, utf8Start + 2))
    expect(hasOnlyUnicodeScalars(source)).toBeTrue()
    expect(hasOnlyUnicodeScalars("\uD800")).toBeFalse()
    expect(hasOnlyUnicodeScalars("\uDC00")).toBeFalse()
  })
})
