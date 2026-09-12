// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const fixtures = [
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["php", "program.php"],
  ["java", "Main.java"]
]

function rejects(language, filename, source, token) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic &&
      ["DUPLICATE_MAP_KEY", "INVALID_MAP_KEY", "IMMUTABLE_ASSIGNMENT", "TYPE_MISMATCH", "UNSUPPORTED_SYNTAX"].includes(error.code) &&
      (!token || source.slice(error.location.start.offset, error.location.end.offset) == token)
  )
}

function rejectsAt(language, filename, source, token, offset) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
      error.location.start.offset == offset && error.location.end.offset == offset + token.length &&
      source.slice(error.location.start.offset, error.location.end.offset) == token
  )
}

function expectLexicallyScopedOrderedMap(language, filename, source) {
  const module = parse({filename, language, source})
  const ordinary = module.functions.find(({name}) => name == "ordinary")
  const visit = module.functions.find(({name}) => name == "visit")

  assert(ordinary)
  assert(visit)
  expect(ordinary.body.statements[0]).toMatchObject({
    initializer: {kind: "MapLiteral"}, kind: "LocalDeclaration", type: {kind: "MapType"}
  })
  expect(visit.body.statements[0]).toMatchObject({
    initializer: {kind: "OrderedMapLiteral"}, kind: "LocalDeclaration", type: {kind: "OrderedMapType"}
  })
  expect(visit.body.statements[1]).toMatchObject({kind: "ForEachMapStatement"})
}

describe("ordered map iteration frontends", () => {
  it("normalizes all five parser-proven ordered-map and pair-loop profiles equivalently", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/ordered-map-iteration/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])
      const loop = /** @type {import("../src/semantic/types.js").ForEachMapStatement} */ (module.entryPoint.body.statements[3])

      expect(declaration.type).toMatchObject({kind: "OrderedMapType", order: "insertion"})
      expect(declaration.initializer.kind).toEqual("OrderedMapLiteral")
      expect(loop.kind).toEqual("ForEachMapStatement")
      expect(loop.map).toMatchObject({kind: "IdentifierExpression", name: "values"})
      expect(loop.keyBinding).toMatchObject({kind: "ValueBinding", mutable: false, name: "key", type: {kind: "TypeReference", name: "string"}})
      expect(loop.valueBinding).toMatchObject({kind: "ValueBinding", mutable: false, name: "value", type: {kind: "TypeReference", name: "integer"}})
      expect(loop.body.statements[0].kind).toEqual("IfStatement")
      expect(module.entryPoint.body.statements.slice(1, 3).map(({kind}) => kind))
        .toEqual(["PrintStatement", "PrintStatement"])
      modules.push(module)
    }

    const canonical = semanticMeaning(modules[0])
    for (const module of modules) expect(semanticMeaning(module)).toEqual(canonical)
  })

  it("keeps JavaScript ordered-map evidence inside its declaring lexical owner", () => {
    expectLexicallyScopedOrderedMap("javascript", "scoped.js", `/**
 * @returns {ReadonlyMap<string, number>}
 */
function ordinary() {
  /** @type {ReadonlyMap<string, number>} */ const values = new Map([["plain", 1]])
  return values
}
/** @returns {void} */
function visit() {
  /** @type {ReadonlyMap<string, number>} */ const values = new Map([["b", 2], ["a", 1]])
  for (const [key, value] of values) {}
}
`)
  })

  it("keeps TypeScript ordered-map evidence inside its declaring lexical owner", () => {
    expectLexicallyScopedOrderedMap("typescript", "scoped.ts", `function ordinary(): ReadonlyMap<string, number> {
  const values: ReadonlyMap<string, number> = new Map([["plain", 1]])
  return values
}
function visit(): void {
  const values: ReadonlyMap<string, number> = new Map([["b", 2], ["a", 1]])
  for (const [key, value] of values) {}
}
`)
  })

  it("keeps PHP ordered-map evidence inside its declaring lexical owner", () => {
    expectLexicallyScopedOrderedMap("php", "scoped.php", `<?php
declare(strict_types=1);
/** @return array<string,int> */
function ordinary(): array {
    /** @var array<string,int> $values */
    $values = ["plain" => 1];
    return $values;
}
function visit(): void {
    /** @var array<string,int> $values */
    $values = ["b" => 2, "a" => 1];
    foreach ($values as $key => $value) {}
}
`)
  })

  it("keeps Ruby ordered-map evidence inside its declaring lexical owner", () => {
    expectLexicallyScopedOrderedMap("ruby", "scoped.rb", `# @return [Hash[String,Integer]]
def ordinary()
  # @type [Hash[String,Integer]]
  # @semantifold-immutable
  values = {"plain" => 1}
  return values
end
# @return [void]
def visit()
  # @type [Hash[String,Integer]]
  # @semantifold-immutable
  values = {"b" => 2, "a" => 1}
  values.each do |key, value|
  end
end
`)
  })

  it("treats unproven Java SequencedMap annotations as ordinary maps", () => {
    const module = parse({filename: "Main.java", language: "java", source: `final class Holder {
  private final java.util.SequencedMap<String,Integer> values;
  Holder(java.util.SequencedMap<String,Integer> values) { this.values = values; }
  java.util.SequencedMap<String,Integer> values() { return this.values; }
}
public final class Main {
  private static java.util.SequencedMap<String,Integer> pass(java.util.SequencedMap<String,Integer> values) {
    final java.util.SequencedMap<String,Integer> alias = values;
    return alias;
  }
  public static void main(String[] args) {}
}
`})
    const holder = module.records?.find(({name}) => name == "Holder")
    const pass = module.functions.find(({name}) => name == "pass")

    assert(holder)
    assert(pass)
    expect(holder.fields[0].type.kind).toEqual("MapType")
    expect(pass.parameters[0].type.kind).toEqual("MapType")
    expect(pass.returnType.kind).toEqual("MapType")
    expect(pass.body.statements[0]).toMatchObject({kind: "LocalDeclaration", type: {kind: "MapType"}})
  })

  it("rejects pair iteration whose Java SequencedMap has no protected insertion-order construction", () => {
    rejects("java", "Main.java", `public final class Main {
  private static void visit(java.util.SequencedMap<String,Integer> values) {
    for (java.util.Map.Entry<String,Integer> entry : values.sequencedEntrySet()) {
      final String key = entry.getKey();
      final int value = entry.getValue();
    }
  }
  public static void main(String[] args) {}
}
`, "values.sequencedEntrySet()")
  })

  it("rejects JavaScript ordered-map construction when Map is a supported lexical binding", () => {
    const orderedBody = `  /** @type {ReadonlyMap<string, number>} */ const values = new Map([["b", 2], ["a", 1]])
  for (const [key, value] of values) {}
`
    for (const source of [
      `/**
 * @param {number} value
 * @returns {number}
 */
function Map(value) { return value }
/** @returns {void} */ function visit() {
${orderedBody}}
`,
      `/**
 * @param {number} Map
 * @returns {void}
 */
function visit(Map) {
${orderedBody}}
`,
      `/** @returns {void} */ function visit() {
  /** @type {number} */ const Map = 1
${orderedBody}}
`,
      `class Map {
  /** @param {number} value */
  constructor(value) {
    /** @readonly */ this.value = value
    Object.freeze(this)
  }
}
/** @returns {void} */ function visit() {
${orderedBody}}
`
    ]) rejects("javascript", "shadowed.js", source, "Map")
  })

  it("rejects TypeScript ordered-map construction when Map is a supported lexical binding", () => {
    const orderedBody = `  const values: ReadonlyMap<string, number> = new Map([["b", 2], ["a", 1]])
  for (const [key, value] of values) {}
`
    for (const source of [
      `function Map(value: number): number { return value }
function visit(): void {
${orderedBody}}
`,
      `function visit(Map: number): void {
${orderedBody}}
`,
      `function visit(): void {
  const Map: number = 1
${orderedBody}}
`,
      `class Map { constructor(readonly value: number) {} }
function visit(): void {
${orderedBody}}
`
    ]) rejects("typescript", "shadowed.ts", source, "Map")
  })

  it("rejects a Java pair local that collides with its consumed entry binding", () => {
    const source = `public final class Main {
  private static int identity(int value) { return value; }
  public static void main(String[] args) {
    final java.util.LinkedHashMap<String,Integer> backing = new java.util.LinkedHashMap<>();
    backing.put("b", 2);
    final java.util.SequencedMap<String,Integer> values = java.util.Collections.unmodifiableSequencedMap(backing);
    for (java.util.Map.Entry<String,Integer> entry : values.sequencedEntrySet()) {
      final String entry = entry.getKey();
      final int value = entry.getValue();
    }
  }
}
`
    const offset = source.indexOf("entry = entry.getKey")

    rejectsAt("java", "Main.java", source, "entry", offset)
  })

  it("rejects a Java sealed-map local that collides with its consumed backing binding", () => {
    const source = `public final class Main {
  private static int identity(int value) { return value; }
  public static void main(String[] args) {
    final java.util.LinkedHashMap<String,Integer> values = new java.util.LinkedHashMap<>();
    values.put("b", 2);
    final java.util.SequencedMap<String,Integer> values = java.util.Collections.unmodifiableSequencedMap(values);
  }
}
`
    const offset = source.indexOf("values = java.util.Collections")

    rejectsAt("java", "Main.java", source, "values", offset)
  })

  it("preserves empty, singleton, and multi-entry construction cardinality in every source facade", async () => {
    const replacements = {
      java: [
        [/ {4}valuesBacking\.put\("b", 2\);\n {4}valuesBacking\.put\("a", 1\);\n {4}valuesBacking\.put\("c", 3\);\n/u, ""],
        [/ {4}valuesBacking\.put\("b", 2\);\n {4}valuesBacking\.put\("a", 1\);\n {4}valuesBacking\.put\("c", 3\);\n/u, "    valuesBacking.put(\"b\", 2);\n"]
      ],
      javascript: [
        [/new Map\(\[\["b", 2\], \["a", 1\], \["c", 3\]\]\)/u, "new Map([])"],
        [/new Map\(\[\["b", 2\], \["a", 1\], \["c", 3\]\]\)/u, "new Map([[\"b\", 2]])"]
      ],
      php: [
        [/\["b" => 2, "a" => 1, "c" => 3\]/u, "[]"],
        [/\["b" => 2, "a" => 1, "c" => 3\]/u, "[\"b\" => 2]"]
      ],
      ruby: [
        [/\{"b" => 2, "a" => 1, "c" => 3\}/u, "{}"],
        [/\{"b" => 2, "a" => 1, "c" => 3\}/u, "{\"b\" => 2}"]
      ],
      typescript: [
        [/new Map\(\[\["b", 2\], \["a", 1\], \["c", 3\]\]\)/u, "new Map([])"],
        [/new Map\(\[\["b", 2\], \["a", 1\], \["c", 3\]\]\)/u, "new Map([[\"b\", 2]])"]
      ]
    }
    const lookupStatements = {
      java: "    System.out.println(values.get(\"b\"));\n",
      javascript: "console.log(values.get(\"b\"))\n",
      php: "echo $values[\"b\"], PHP_EOL;\n",
      ruby: "puts values.fetch(\"b\")\n",
      typescript: "console.log(values.get(\"b\"))\n"
    }

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/ordered-map-iteration/${filename}`, import.meta.url), "utf8")

      for (const [index, [pattern, replacement]] of replacements[language].entries()) {
        const variant = source.replace(pattern, replacement).replace(index == 0 ? lookupStatements[language] : "", "")
        const module = parse({filename, language, source: variant})
        const literal = module.entryPoint.body.statements[0].initializer

        expect(literal.kind).toEqual("OrderedMapLiteral")
        expect(literal.entries.length).toEqual(index)
      }
      const module = parse({filename, language, source})

      expect(module.entryPoint.body.statements[0].initializer.entries.length).toEqual(3)
    }
  })

  it("rejects unordered, duplicate, coercible, mutable, aliased, and malformed pair profiles", () => {
    rejects("typescript", "invalid.ts", `function identity(value: number): number { return value }
function visit(values: ReadonlyMap<string, number>): void {
  for (const [key, value] of values) { console.log(key) }
}
`, "values")
    rejects("typescript", "invalid.ts", `function identity(value: number): number { return value }
const values: ReadonlyMap<string, number> = new Map([["a", 1], ["a", 2]])
for (const [key, value] of values) {}
`, "\"a\"")
    rejects("javascript", "invalid.js", `/**
 * @param {number} value
 * @returns {number}
 */
function identity(value) { return value }
/** @type {ReadonlyMap<string, number>} */ const values = new Map([["1", 1]])
for (const [key, value] of values) {}
`, "\"1\"")
    rejects("typescript", "invalid.ts", `function identity(value: number): number { return value }
const values: ReadonlyMap<string, number> = new Map([["a", 1]])
values.set("b", 2)
`, "values.set(\"b\", 2)")
    rejects("php", "invalid.php", `<?php
declare(strict_types=1);
function identity(int $value): int { return $value; }
/** @var array<string,int> $values */
$values = ["1" => 1];
foreach ($values as $key => $value) {}
`, "\"1\"")
    rejects("ruby", "invalid.rb", `# @param value [Integer]
# @return [Integer]
def identity(value)
  return value
end
# @type [Hash[String,Integer]]
# @semantifold-immutable
values = {"a" => 1}
alias_values = values
values.each do |key, value|
end
`)
    rejects("java", "Main.java", `public final class Main {
  private static int identity(int value) { return value; }
  public static void main(String[] args) {
    final java.util.Map<String,Integer> values = java.util.Map.of("a", 1);
    for (java.util.Map.Entry<String,Integer> entry : values.entrySet()) {}
  }
}
`, "values.entrySet()")
  })

  it("rejects ordinary-map iteration in every source language", () => {
    rejects("javascript", "invalid.js", `/**
 * @param {ReadonlyMap<string, number>} values
 * @returns {ReadonlyMap<string, number>}
 */
function passMap(values) { return values }
/** @type {ReadonlyMap<string, number>} */ const values = passMap(new Map([["a", 1]]))
for (const [key, value] of values) {}
`, "values")
    rejects("ruby", "invalid.rb", `# @param values [Hash[String,Integer]]
# @return [Hash[String,Integer]]
def pass_map(values)
  return values
end
# @type [Hash[String,Integer]]
# @semantifold-immutable
values = pass_map({"a" => 1})
values.each do |key, value|
end
`, "values")
    rejects("php", "invalid.php", `<?php
declare(strict_types=1);
/**
 * @param array<string,int> $values
 * @return array<string,int>
 */
function pass_map(array $values): array { return $values; }
/** @var array<string,int> $values */
$values = pass_map(["a" => 1]);
foreach ($values as $key => $value) {}
`, "$values")
    rejects("typescript", "invalid.ts", `function passMap(values: ReadonlyMap<string, number>): ReadonlyMap<string, number> { return values }
const values: ReadonlyMap<string, number> = passMap(new Map([["a", 1]]))
for (const [key, value] of values) {}
`, "values")
    rejects("java", "Main.java", `public final class Main {
  private static int identity(int value) { return value; }
  public static void main(String[] args) {
    final java.util.Map<String,Integer> values = java.util.Map.of("a", 1);
    for (java.util.Map.Entry<String,Integer> entry : values.entrySet()) {}
  }
}
`, "values.entrySet()")
  })

  it("rejects duplicate, coercible, and heterogeneous entries through every parser-owned profile", async () => {
    const entryReplacements = {
      java: [
        [/valuesBacking\.put\("a", 1\)/u, "valuesBacking.put(\"b\", 1)"],
        [/valuesBacking\.put\("a", 1\)/u, "valuesBacking.put(\"1\", 1)"],
        [/valuesBacking\.put\("a", 1\)/u, "valuesBacking.put(\"a\", \"one\")"]
      ],
      javascript: [
        [/\["a", 1\]/u, "[\"b\", 1]"],
        [/\["a", 1\]/u, "[\"1\", 1]"],
        [/\["a", 1\]/u, "[\"a\", \"one\"]"]
      ],
      php: [
        [/"a" => 1/u, "\"b\" => 1"],
        [/"a" => 1/u, "\"1\" => 1"],
        [/"a" => 1/u, "\"a\" => \"one\""]
      ],
      ruby: [
        [/"a" => 1/u, "\"b\" => 1"],
        [/"a" => 1/u, "\"1\" => 1"],
        [/"a" => 1/u, "\"a\" => \"one\""]
      ],
      typescript: [
        [/\["a", 1\]/u, "[\"b\", 1]"],
        [/\["a", 1\]/u, "[\"1\", 1]"],
        [/\["a", 1\]/u, "[\"a\", \"one\"]"]
      ]
    }

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/ordered-map-iteration/${filename}`, import.meta.url), "utf8")

      for (const [pattern, replacement] of entryReplacements[language]) {
        rejects(language, filename, source.replace(pattern, replacement))
      }
    }
  })

  it("rejects every unordered or escaping Java construction family", () => {
    const main = (body) => `public final class Main {
  private static int identity(int value) { return value; }
  public static void main(String[] args) {
    ${body}
  }
}
`
    for (const body of [
      `final java.util.Map<String,Integer> values = java.util.Map.ofEntries(java.util.Map.entry("a", 1));`,
      `final java.util.Map<String,Integer> source = java.util.Map.of("a", 1);
    final java.util.Map<String,Integer> values = java.util.Map.copyOf(source);`,
      `final java.util.HashMap<String,Integer> values = new java.util.HashMap<>();`,
      `final java.util.TreeMap<String,Integer> values = new java.util.TreeMap<>();`,
      `final java.util.concurrent.ConcurrentHashMap<String,Integer> values = new java.util.concurrent.ConcurrentHashMap<>();`,
      `final java.util.LinkedHashMap<String,Integer> backing = new java.util.LinkedHashMap<>(16, 0.75f, true);
    final java.util.SequencedMap<String,Integer> values = java.util.Collections.unmodifiableSequencedMap(backing);`,
      `final java.util.LinkedHashMap<String,Integer> backing = new java.util.LinkedHashMap<>();
    final java.util.LinkedHashMap<String,Integer> alias = backing;
    final java.util.SequencedMap<String,Integer> values = java.util.Collections.unmodifiableSequencedMap(backing);`,
      `final java.util.LinkedHashMap<String,Integer> backing = new java.util.LinkedHashMap<>();
    final java.util.SequencedMap<String,Integer> values = java.util.Collections.unmodifiableSequencedMap(backing);
    backing.put("b", 2);`
    ]) rejects("java", "Main.java", main(body))
  })
})
