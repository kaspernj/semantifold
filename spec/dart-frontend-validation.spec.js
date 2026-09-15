// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parseDart} from "../src/frontends/dart.js"
import {parseJavaScriptTypeScript} from "../src/frontends/javascript-typescript.js"
import {validateParsedModule} from "../src/semantic/validate.js"
import {SemantifoldDiagnostic} from "../src/diagnostic.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "resolution", "sourceProvenance"].includes(key) ? undefined : nested))
const baseFunction = (body, signature = "int choose(int value)", call = "print(choose(1));") =>
  `${signature} {\n  ${body}\n}\n\nvoid main() {\n  ${call}\n}\n`
const withDeclaration = (declaration) => `${declaration}\n${baseFunction("return value;")} `

/**
 * @param {{code: "MISSING_TYPE" | "PARSE_ERROR" | "UNSUPPORTED_SYNTAX", range?: string, source: string}} input Case.
 * @returns {void}
 */
function expectRejected({code, range, source}) {
  assert.throws(() => parseDart({filename: "excluded.dart", source}), (error) => {
    if (!(error instanceof SemantifoldDiagnostic) || error.code != code || error.language != "dart" ||
      error.location?.filename != "excluded.dart") return false
    const {end, start} = error.location

    if (source.slice(start.offset, end.offset) != (range ?? source.slice(start.offset, end.offset))) return false
    if (range !== undefined && source.slice(start.offset, end.offset) != range) return false
    return start.line >= 1 && start.column >= 1 && end.line >= start.line && end.offset >= start.offset
  }, source)
}

describe("Dart strict source profile", () => {
  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/", "functions/"]) {
    it("adapts the complete " + (directory || "base") + " profile to the existing semantics", async () => {
      const dart = await readFile(new URL(`fixtures/${directory}program.dart`, import.meta.url), "utf8")
      const typescript = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")

      const expected = parseJavaScriptTypeScript({filename: "program.ts", language: "typescript", source: typescript})

      expect(meaning(parseDart({filename: "program.dart", source: dart})))
        .toEqual(meaning(validateParsedModule(expected, "typescript")))
    })
  }

  it("rejects directives, metadata, declarations, members, and unavailable type systems", () => {
    const cases = [
      {source: withDeclaration("import 'dart:async';"), code: "UNSUPPORTED_SYNTAX", range: "import 'dart:async';"},
      {source: withDeclaration("@deprecated"), code: "UNSUPPORTED_SYNTAX", range: "@deprecated"},
      {source: withDeclaration("library sample;"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("part 'other.dart';"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("class Box<T> { T value; Box(this.value); }"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("mixin Named { String name = 'x'; }"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("extension Text on String { String copy() => this; }"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("enum Value { one }"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("typedef Pair = (int, int);"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("int get value => 1;"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("set value(int next) {}"), code: "UNSUPPORTED_SYNTAX"},
      {source: withDeclaration("int operator +(int other) => other;"), code: "PARSE_ERROR"},
      {source: withDeclaration("external int nativeValue();"), code: "UNSUPPORTED_SYNTAX", range: "external"}
    ]

    for (const input of cases) expectRejected(/** @type {Parameters<typeof expectRejected>[0]} */ (input))
  })

  it("rejects inference, unsupported scalar types, nullability, and parameter/argument variation", () => {
    const cases = [
      {source: baseFunction("return value;", "choose(int value)"), code: "MISSING_TYPE", range: "choose(int value)"},
      {source: baseFunction("return value;", "int choose(value)"), code: "MISSING_TYPE", range: "value"},
      {source: baseFunction("final value = 1;\n  return value;"), code: "MISSING_TYPE", range: "final value = 1"},
      {source: baseFunction("var result = value;\n  return result;"), code: "MISSING_TYPE", range: "var result = value"},
      {source: baseFunction("const int result = value;\n  return result;"), code: "UNSUPPORTED_SYNTAX"},
      {source: baseFunction("late int result = value;\n  return result;"), code: "UNSUPPORTED_SYNTAX", range: "late"},
      ...["dynamic", "Object", "num", "double", "BigInt"].map((type) => ({
        source: baseFunction("return value;", `int choose(${type} value)`), code: "UNSUPPORTED_SYNTAX", range: type
      })),
      {source: baseFunction("return value;", "int choose(int? value)"), code: "UNSUPPORTED_SYNTAX"},
      {source: baseFunction("return value;", "int choose({required int value})"), code: "UNSUPPORTED_SYNTAX"},
      {source: baseFunction("return value;", "int choose([int value = 1])"), code: "UNSUPPORTED_SYNTAX"},
      {source: baseFunction("return value;", "int choose(int value = 1)"), code: "PARSE_ERROR"},
      {source: baseFunction("return value;", "T choose<T>(T value)"), code: "UNSUPPORTED_SYNTAX"},
      {source: baseFunction("return value;", "int choose(int value)", "print(choose(value: 1));"), code: "UNSUPPORTED_SYNTAX"}
    ]

    for (const input of cases) expectRejected(/** @type {Parameters<typeof expectRejected>[0]} */ (input))
  })

  it("rejects closures, tear-offs, casts, interpolation, collections, control flow, failures, and concurrency", () => {
    const bodies = [
      "return choose;",
      "final int Function(int) callback = (int next) => next;\n  return callback(value);",
      "return value as int;",
      "if (value is int) { return value; }\n  return 0;",
      'return "value $value";',
      "return <int>[value].first;",
      "return <String, int>{'value': value}['value']!;",
      "for (final int item in <int>[value]) { print(item); }\n  return value;",
      "while (value > 0) { return value; }\n  return 0;",
      "do { return value; } while (false);",
      "switch (value) { case 1: return value; default: return 0; }",
      "assert(value > 0);\n  return value;",
      "try { return value; } catch (error) { return 0; }",
      "throw RangeError('bad');",
      "return value ?? 0;",
      "return holder?.value ?? 0;",
      "holder..value = value;\n  return value;"
    ]

    for (const body of bodies) expectRejected({source: baseFunction(body), code: "UNSUPPORTED_SYNTAX"})
    for (const signature of ["Future<int> choose(int value)", "Stream<int> choose(int value)"]) {
      expectRejected({source: baseFunction("return value;", signature), code: "UNSUPPORTED_SYNTAX"})
    }
    expectRejected({source: baseFunction("return await Future.value(value);", "Future<int> choose(int value) async"),
      code: "UNSUPPORTED_SYNTAX"})
    expectRejected({source: baseFunction("Isolate.spawn(choose, value);\n  return value;"), code: "UNSUPPORTED_SYNTAX"})
    expectRejected({source: baseFunction("return value;", "int choose(int value)", "print(r\"raw\");"), code: "UNSUPPORTED_SYNTAX"})
    expectRejected({source: baseFunction("return value;", "int choose(int value)", 'print("""multi\nline""");'),
      code: "UNSUPPORTED_SYNTAX"})
  })

  it("rejects every parser recovery shape with PARSE_ERROR", () => {
    for (const source of [
      "void main() {",
      "void main( { }",
      "int broken(int left, int right) { return left + ; }\nvoid main() {}",
      'void main() { print("unterminated); }',
      "void main() { print(1) }"
    ]) expectRejected({source, code: "PARSE_ERROR"})
  })
})
