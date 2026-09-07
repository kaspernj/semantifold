// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {parseCst} from "../src/frontends/c-parser.js"

const program = (body, entry = "semantifold_print_integer(value(INT64_C(4), INT64_C(9)));") =>
  '#include "semantifold_runtime.h"\nstatic int64_t value(int64_t left, int64_t right) {\n' + body +
  '\n}\nint main(void) {\n' + entry + '\nsemantifold_cleanup();\nreturn 0;\n}\n'
const read = (source) => parse({language: "c", filename: "program.c", source})
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("C frontend validation", () => {
  it("normalizes exact fixed-width functions, branches and calls", () => {
    const c = program("if (left > right) { return left - right; } else { return right - left; }")
    const ts = "function value(left: number, right: number): number { if (left > right) { return left - right } else { return right - left } } console.log(value(4, 9))"

    expect(meaning(read(c))).toEqual(meaning(parse({language: "typescript", filename: "program.ts", source: ts})))
  })

  it("preserves initialized local mutability, assignment and fallthrough", () => {
    const module = read(program("const int64_t first = left; int64_t result = first; if (left < right) { result = right; } return result;"))

    expect(module.functions[0].body.statements.map(({kind}) => kind))
      .toEqual(["LocalDeclaration", "LocalDeclaration", "IfStatement", "ReturnStatement"])
    expect(module.functions[0].body.statements.slice(0, 2).map(({mutable}) => mutable)).toEqual([false, true])
  })

  it("decodes UTF-8 literal byte slices including embedded NUL with parser-owned ranges", () => {
    const source = '// 😀\r\n#include "semantifold_runtime.h"\r\n' +
      'static SemantifoldString value(bool flag, SemantifoldString fallback) { if (flag) { return SEMANTIFOLD_STRING("é\\000😀"); } else { return fallback; } }\r\n' +
      'int main(void) { semantifold_print_string(value(true, SEMANTIFOLD_STRING(""))); semantifold_cleanup(); return 0; }\r\n'
    const module = read(source)
    const literal = module.functions[0].body.statements[0].consequent.statements[0].expression

    expect(literal.value).toEqual("é\0😀")
    expect(module.provenance.sources[0].content).toEqual(source)
    expect(source.slice(literal.location.start.offset, literal.location.end.offset)).toEqual('SEMANTIFOLD_STRING("é\\000😀")')
  })

  it("rejects excluded preprocessing, declarators, pointers and ownership forms", () => {
    const valid = program("int64_t result = left; return result;")
    const invalid = [
      '#define value hacked\n' + valid, '#if 1\n' + valid + '#endif\n',
      valid.replace('"semantifold_runtime.h"', '<stdio.h>'),
      valid.replace('static int64_t value', 'int64_t value'),
      valid.replace('int64_t left', 'int left'), valid.replace('int64_t left', 'int64_t *left'),
      valid.replace('int64_t result = left;', 'int64_t result;'),
      valid.replace('int64_t result = left;', 'int64_t result = left, other = right;'),
      valid.replace('int64_t result = left;', 'static int64_t result = 0;'),
      valid.replace('return result;', 'return (int64_t)left;'),
      valid.replace('return result;', 'return sizeof(left);'),
      valid.replace('return result;', 'return left ? right : result;'),
      valid.replace('return result;', 'return (left, right);'),
      valid.replace('return result;', 'free(result); return left;'),
      valid.replace('return result;', 'while (true) { result = right; } return result;'),
      valid.replace('return result;', 'return value(left, right) + left;'),
      valid.replace('return result;', 'return value(value(left, right), right);'),
      valid.replace('result = left', 'semantifold_ordered_000001 = left')
    ]

    for (const source of invalid) assert.throws(() => read(source), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == "c" && Boolean(error.location), source)
  })

  it("reports grammar recovery and existing semantic failures without dropping syntax", () => {
    for (const [source, code] of [
      [program("return left - ;"), "PARSE_ERROR"],
      [program("return left;").slice(0, -2), "PARSE_ERROR"],
      [program("left = right; return left;"), "IMMUTABLE_ASSIGNMENT"],
      [program("if (left) { return left; } return right;"), "NON_BOOLEAN_CONDITION"],
      [program("if (left < right) { return left; }"), "MISSING_RETURN"],
      [program("return left; return right;"), "UNREACHABLE_STATEMENT"],
      [program("return missing;"), "UNRESOLVED_BINDING"]
    ]) assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic && error.code == code && Boolean(error.location), source)
  })

  it("rejects mismatched print helpers and imported header identifier collisions", () => {
    for (const source of [
      program("return left;", "semantifold_print_boolean(value(4, 9));"),
      program("return left;", 'semantifold_print_integer(SEMANTIFOLD_STRING("text"));'),
      ...["malloc", "printf", "FILE", "EOF", "INT32_MAX", "int32_t", "atomic_flag", "strerror"].map((name) =>
        program("return left;").replaceAll("left", name))
    ]) assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location), source)
  })

  it("rejects complete preprocessing, declarator, conversion and ownership boundaries", () => {
    const valid = program("int64_t result = left; return result;")
    const statements = [
      "typedef int64_t Other;", "int64_t values[2] = {left, right};", "struct Value { int64_t data; };",
      "union Value { int64_t data; };", "enum Value { One };", "volatile int64_t result = left;",
      "int64_t (*result)(int64_t, int64_t) = value;", "int64_t result = *left;", "int64_t result = &left;",
      "int64_t result = left++;", "int64_t result = ++left;", "int64_t result = left / right;",
      "int64_t result = left % right;", "int64_t result = left << right;", "int64_t result = left & right;",
      "goto done;", "switch (left) { case 1: break; }", "for (;;) {}", "do {} while (true);",
      "int64_t result = malloc(4);", "int64_t result = realloc(left, right);", "int64_t result = left.data;",
      "int64_t result = left->data;", "int64_t result = value;", "int64_t result = (left = right);"
    ]
    const invalid = [
      ...statements.map((statement) => valid.replace("int64_t result = left;", statement)),
      ...["#pragma once", "#undef value", "#error rejected", "#include <stdint.h>", "int64_t global = 0;"].map((prefix) => prefix + "\n" + valid),
      valid.replace("int64_t left, int64_t right", "int64_t left, ..."),
      valid.replace("int64_t left, int64_t right", "const int64_t left, int64_t right"),
      valid.replace("int64_t left, int64_t right", "int64_t left[2], int64_t right"),
      valid.replace("int main(void)", "int main(int argc, char **argv)"),
      valid.replace("semantifold_cleanup();", ""), valid.replace("return 0;", "return 1;"),
      valid.replace("return result;", "return;"),
      valid.replace("return result;", "if (true) return left; return right;")
    ]

    for (const source of invalid) assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
      ["UNSUPPORTED_SYNTAX", "PARSE_ERROR", "UNRESOLVED_BINDING"].includes(error.code) && Boolean(error.location), source)
  })

  it("locates invalid Unicode and rejects malformed UTF-8 string bytes", () => {
    for (const source of [program("return left;") + "// \ud800", ...["\\377", "\\300\\200", "\\355\\240\\200", "\\x100", "\\400"].map((bytes) =>
      program("return left;", `semantifold_print_string(SEMANTIFOLD_STRING("${bytes}"));`))]) {
      assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
        ["PARSE_ERROR", "UNSUPPORTED_SYNTAX"].includes(error.code) && Boolean(error.location))
    }
  })

  it("rejects caller-authored forward calls that require an implicit C declaration", () => {
    const source = program("return later(left, right);").replace("int main(void)",
      "static int64_t later(int64_t left, int64_t right) { return left; }\nint main(void)")

    assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
  })

  it("rejects trigraph preprocessing inside parser-backed strings and comments", () => {
    for (const source of [program("return left;", 'semantifold_print_string(SEMANTIFOLD_STRING("??/n"));'),
      '// ??/\n' + program("return left;")]) {
      assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX")
    }
  })

  it("normalizes the unchanged legacy parser's measured 32767-code-unit input boundary", () => {
    const valid = program("return left;")
    const remaining = 32767 - valid.length - 4
    const source = valid + "/*" + "😀".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2) + "*/"

    expect(source.length).toEqual(32767)
    expect(read(source).kind).toEqual("Module")
    assert.throws(() => parseCst(source + " "), {message: "Invalid argument"})
    assert.throws(() => read(source + " "), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
  })

  it("rejects parser-backed comments with lone-CR content or preprocessing line splices", () => {
    for (const comment of [
      "// comment\rsemantifold_print_integer(INT64_C(99));\n",
      "/* hidden *\\\n/ semantifold_print_integer(INT64_C(99)); /* still hidden */\n",
      "/* hidden *\\\r\n/ semantifold_print_integer(INT64_C(99)); /* still hidden */\n",
      "// hidden \\\nsemantifold_print_integer(INT64_C(99));\n",
      "// hidden \\\r\nsemantifold_print_integer(INT64_C(99));\n"
    ]) {
      const source = program("return left + right;", comment + "semantifold_print_integer(value(4, 9));")

      assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_SYNTAX" && error.location.start.offset == source.indexOf(comment), JSON.stringify(comment))
    }
    assert.throws(() => read(program("return left + right;", "/\\\n/ hidden\n")),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "PARSE_ERROR")
  })

  it("rejects hexadecimal escapes split into escape and content nodes by the frozen parser", () => {
    for (const escape of ["\\x000041", "\\x0000f", "\\x0000A", "\\x00000041"]) {
      const source = program("return left + right;", `semantifold_print_string(SEMANTIFOLD_STRING("${escape}"));`)

      assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_SYNTAX" && source.slice(error.location.start.offset, error.location.end.offset) == "\\x0000", escape)
    }
  })

  it("retains bounded hex escapes, nonhex following content, NUL and Unicode bytes", () => {
    const module = read(program("return left + right;",
      'semantifold_print_string(SEMANTIFOLD_STRING("\\x0\\x41\\x0042é\\000😀\\x43G\\x00c3\\x00a9"));'))

    expect(module.entryPoint.body.statements[0].expression.value).toEqual("\0ABé\0😀CGé")
  })

  it("rejects uppercase TRUE and FALSE expressions instead of inventing Boolean constants", () => {
    for (const name of ["TRUE", "FALSE"]) {
      const source = program("return left + right;", `semantifold_print_boolean(${name});`)

      assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_SYNTAX" && source.slice(error.location.start.offset, error.location.end.offset) == name)
    }
  })

  it("rejects uppercase Boolean binding names consistently with target generation", () => {
    for (const name of ["TRUE", "FALSE"]) for (const source of [
      '#include "semantifold_runtime.h"\n' +
        `static bool value(bool ${name}, bool right) { return ${name} && right; }\n` +
        'int main(void) { semantifold_print_boolean(value(false, true)); semantifold_cleanup(); return 0; }\n',
      program(`bool ${name} = left < right; return left + right;`),
      program("return left + right;").replaceAll("value", name)
    ]) assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_SYNTAX" && source.slice(error.location.start.offset, error.location.end.offset) == name)
  })

  it("rejects the included limits.h MB_LEN_MAX macro in caller declarations", () => {
    for (const source of [
      program("return MB_LEN_MAX + right;").replace("int64_t left", "int64_t MB_LEN_MAX"),
      program("int64_t MB_LEN_MAX = left; return MB_LEN_MAX + right;"),
      program("return left + right;").replaceAll("value", "MB_LEN_MAX")
    ]) assert.throws(() => read(source), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_SYNTAX" && source.slice(error.location.start.offset, error.location.end.offset) == "MB_LEN_MAX")
  })
})
