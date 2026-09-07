// @ts-check

import assert from "node:assert/strict"
import {access, readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {executeC, executeCArtifacts} from "./support/c-toolchain.js"

const cases = [
  ["checked arithmetic", "function calculate(left: number, right: number): number { const twice: number = right * 2; let result: number = -left + twice; result = result - 1; return result } console.log(calculate(3, 10))", "16\n"],
  ["immutable returned UTF-8 slices", 'function combine(left: string, right: string): string { const copy: string = left; let result: string = copy + right; result = result + copy; return result } console.log(combine("é\\u0000😀", "中"))', "é\0😀中é\0😀\n"],
  ["nested eager calls", "function mark(left: number, right: number): number { console.log(left); return right } function add(left: number, right: number): number { return left + right } console.log(add(mark(1, 10), mark(2, 20)) * mark(3, 2))", "1\n2\n3\n60\n"],
  ["short-circuit effects and fallthrough", 'function probe(flag: boolean, label: string): boolean { console.log(label); return flag } function choose(flag: boolean, fallback: string): string { if (flag && probe(true, "right")) { return "yes" } return fallback } console.log(choose(probe(false, "left"), "no")); if (probe(true, "or-left") || probe(false, "skipped")) { console.log("done") }', "left\nno\nor-left\ndone\n"]
]

describe("C native C17 execution", () => {
  for (const [label, source, stdout] of cases) it("executes " + label + " at O0/O2 with and without sanitizers", async () => {
    const module = parse({language: "typescript", filename: "native.ts", source})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeC(module, {optimization, sanitized})

      expect(result.stages).toEqual(["compile", "link", "execute"])
      expect(result.status).toEqual(0)
      expect(result.stderr).toEqual("")
      expect(result.stdout).toEqual(stdout)
      assert.deepEqual(result.bytes, Buffer.from(stdout, "utf8"))
    }
  })

  it("executes distinguishable nested effects in every statement consumer and both short-circuit paths", async () => {
    const source = await readFile(new URL("fixtures/ordered-program.ts", import.meta.url), "utf8")
    const module = parse({language: "typescript", filename: "ordered-program.ts", source})
    const expected = "arg-left\narg-right\ninitial-left\ninitial-right\nassign-left\nassign-right\ntest\nprint-left\nprint-right\n12\nand-left\nreturn-left\nreturn-right\n7\n" +
      "true-and-left\ntrue-and-right\ntrue\nfalse-or-left\nfalse-or-right\ntrue\ntrue-or-left\ntrue\nstring-left\nstring-right\né\0😀\n"
    const content = generateArtifactSet({language: "c", module}).artifacts[0].content
    const fixture = await readFile(new URL("fixtures/ordered-program.c", import.meta.url), "utf8")

    expect(content).toEqual(fixture)
    const reparsed = parse({language: "c", filename: "program.c", source: fixture})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeC(reparsed, {optimization, sanitized})

      expect(result.stdout).toEqual(expected)
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
      assert.deepEqual(result.bytes, Buffer.from(expected, "utf8"))
    }
  })

  it("compiles unused bindings, unused functions, forward calls and recursion without warning suppression", async () => {
    const source = `function first(left: number, right: number): number { if (left > 0) { return second(left - 1, right); } return right; }
function second(left: number, right: number): number { return first(left, right); }
function unused(left: string, right: string): string { let ignored: string = left; ignored = right; return right; }
console.log(first(2, 9));`
    const module = parse({language: "typescript", filename: "forward.ts", source})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeC(module, {optimization, sanitized})

      expect(result.stdout).toEqual("9\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("reports real compile, link and execution failures and removes each fresh directory", async () => {
    for (const [stage, content, status] of [
      ["compile", "#error intentional compile failure\n", 1],
      ["link", "extern void unavailable(void);\nint main(void) { unavailable(); return 0; }\n", 1],
      ["execute", "int main(void) { return 7; }\n", 7]
    ]) {
      let directory

      await assert.rejects(executeCArtifacts({artifacts: [{path: "program.c", content}]}), (error) => {
        expect(error.stage).toEqual(stage)
        expect(error.code).toEqual(status)
        expect(error.stdout).toEqual("")
        if (stage == "execute") expect(error.stderr).toEqual("")
        else assert.ok(error.stderr.length > 0)
        directory = error.directory
        return true
      })
      await assert.rejects(access(directory), (error) => error.code == "ENOENT")
    }
  })

  it("distinguishes valid native C outside the semantic profile from grammar recovery", async () => {
    const module = parse({language: "typescript", filename: "native.ts", source:
      "function first(left: number, right: number): number { return left; } console.log(first(4, 9));"})
    const header = generateArtifactSet({language: "c", module}).artifacts[1]
    const content = '#include "semantifold_runtime.h"\nstatic int64_t first(int64_t left, int64_t right) { int64_t values[2] = {left, right}; int64_t *pointer = values; return *pointer; }\n' +
      'int main(void) { semantifold_print_integer(first(INT64_C(4), INT64_C(9))); semantifold_cleanup(); return 0; }\n'

    assert.throws(() => parse({language: "c", filename: "native.c", source: content}), (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX")
    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCArtifacts({artifacts: [{path: "program.c", content}, header]}, {optimization, sanitized})

      expect(result.stdout).toEqual("4\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
    const broken = content.replace("return *pointer;", "return *;")

    assert.throws(() => parse({language: "c", filename: "broken.c", source: broken}), (error) => error instanceof SemantifoldDiagnostic && error.code == "PARSE_ERROR")
    await assert.rejects(executeCArtifacts({artifacts: [{path: "program.c", content: broken}, header]}), (error) => error.stage == "compile" && error.code == 1)
  })

  it("executes maximum C17 literals and larger runtime concatenations while Clang rejects oversized literal tokens", async () => {
    const literal = "a".repeat(4095)
    const module = parse({language: "typescript", filename: "literal.ts", source:
      `function join(left: string, right: string): string { return left + right; } console.log(join(${JSON.stringify(literal)}, "é"));`})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeC(module, {optimization, sanitized})

      expect(result.stdout).toEqual(literal + "é\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
      assert.deepEqual(result.bytes, Buffer.from(literal + "é\n"))
    }
    const header = generateArtifactSet({language: "c", module}).artifacts[1]
    const content = '#include "semantifold_runtime.h"\nint main(void) { semantifold_print_string(SEMANTIFOLD_STRING("' + literal + 'a")); semantifold_cleanup(); return 0; }\n'

    await assert.rejects(executeCArtifacts({artifacts: [{path: "program.c", content}, header]}), (error) =>
      error.stage == "compile" && error.code == 1 && error.stderr.includes("overlength-strings"))
  })

  it("executes deeply nested generated blocks with flat expression operands", async () => {
    const module = parse({language: "typescript", filename: "depth.ts", source:
      'function choose(left: boolean, right: boolean): boolean { return "é" === "é"; } console.log(choose(true, true));'})
    let expression = module.functions[0].body.statements[0].expression

    for (let depth = 0; depth < 40; depth++) expression = {kind: "BinaryExpression", operation: "BooleanAnd", type: "boolean", location: module.location,
      left: {kind: "BooleanLiteral", value: true, location: module.location}, right: expression}
    module.functions[0].body.statements[0].expression = expression
    const content = generateArtifactSet({language: "c", module}).artifacts[0].content
    const reparsed = parse({language: "c", filename: "deep.c", source: content})

    expect(generateArtifactSet({language: "c", module: reparsed}).artifacts[0].content).toEqual(content)
    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeC(reparsed, {optimization, sanitized})

      expect(result.stdout).toEqual("true\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("rejects lone-CR comments that hide a statement executed by real C", async () => {
    const module = parse({language: "typescript", filename: "comments.ts", source:
      "function value(left: number, right: number): number { return left + right; } console.log(value(4, 9));"})
    const set = generateArtifactSet({language: "c", module})
    const content = set.artifacts[0].content.replace("int main(void) {\n",
      "int main(void) {\n    // comment\r    semantifold_print_integer(INT64_C(99));\n")

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCArtifacts({artifacts: [{path: "program.c", content}, set.artifacts[1]]}, {optimization, sanitized})

      expect(result.stdout).toEqual("99\n13\n")
      assert.deepEqual(result.bytes, Buffer.from("99\n13\n"))
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
    assert.throws(() => parse({language: "c", filename: "comments.c", source: content}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
  })

  it("preserves ordinary line/block comments, ordered markers and CRLF through reparse and execution", async () => {
    const module = parse({language: "typescript", filename: "comments.ts", source:
      "function value(left: number, right: number): number { return left + right; } console.log(value(4, 9));"})
    const set = generateArtifactSet({language: "c", module})
    const content = set.artifacts[0].content.replaceAll(";\n", "; /* ordinary 😀 */ // ordinary line comment\n").replaceAll("\n", "\r\n")
    const reparsed = parse({language: "c", filename: "comments.c", source: content})

    expect(generateArtifactSet({language: "c", module: reparsed}).artifacts[0].content).toEqual(set.artifacts[0].content)
    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCArtifacts({artifacts: [{path: "program.c", content}, set.artifacts[1]]}, {optimization, sanitized})

      expect(result.stdout).toEqual("13\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("rejects split hex escapes whose native bytes differ from the parser's escape boundary", async () => {
    const module = parse({language: "typescript", filename: "hex.ts", source:
      'function value(left: string, right: string): string { return left + right; } console.log(value("A", ""));'})
    const header = generateArtifactSet({language: "c", module}).artifacts[1]
    const content = '#include "semantifold_runtime.h"\n' +
      'static SemantifoldString value(SemantifoldString left, SemantifoldString right) { return semantifold_string_concat(left, right); }\n' +
      'int main(void) { semantifold_print_string(value(SEMANTIFOLD_STRING("\\x000041"), SEMANTIFOLD_STRING(""))); semantifold_cleanup(); return 0; }\n'

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCArtifacts({artifacts: [{path: "program.c", content}, header]}, {optimization, sanitized})

      expect(result.stdout).toEqual("A\n")
      assert.deepEqual(result.bytes, Buffer.from([0x41, 0x0a]))
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
    assert.throws(() => parse({language: "c", filename: "hex.c", source: content}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
  })

  it("executes bounded hex, octal, NUL and Unicode literals identically before and after C generation", async () => {
    const content = '#include "semantifold_runtime.h"\n' +
      'static SemantifoldString value(SemantifoldString left, SemantifoldString right) { return semantifold_string_concat(left, right); }\n' +
      'int main(void) { semantifold_print_string(value(SEMANTIFOLD_STRING("\\x0\\x41\\x0042é\\000😀\\x43G\\x00c3\\x00a9"), SEMANTIFOLD_STRING(""))); semantifold_cleanup(); return 0; }\n'
    const module = parse({language: "c", filename: "hex.c", source: content})
    const set = generateArtifactSet({language: "c", module})
    const regenerated = parse({language: "c", filename: "program.c", source: set.artifacts[0].content})
    const expected = "\0ABé\0😀CGé\n"

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const original = await executeCArtifacts({artifacts: [{path: "program.c", content}, set.artifacts[1]]}, {optimization, sanitized})
      const generated = await executeC(regenerated, {optimization, sanitized})

      for (const result of [original, generated]) {
        expect(result.stdout).toEqual(expected)
        assert.deepEqual(result.bytes, Buffer.from(expected))
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
      }
    }
  })

  it("rejects uppercase Boolean spellings whose real C binding semantics differ from constants", async () => {
    const module = parse({language: "typescript", filename: "boolean.ts", source:
      "function value(left: boolean, right: boolean): boolean { return left && right; } console.log(value(false, true));"})
    const header = generateArtifactSet({language: "c", module}).artifacts[1]
    const sources = []

    for (const [name, argument, expected] of [["TRUE", "false", "false\n"], ["FALSE", "true", "true\n"]]) {
      const content = '#include "semantifold_runtime.h"\n' +
        `static bool value(bool ${name}, bool right) { return ${name} && right; }\n` +
        `int main(void) { semantifold_print_boolean(value(${argument}, true)); semantifold_cleanup(); return 0; }\n`

      sources.push(content)
      for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
        const result = await executeCArtifacts({artifacts: [{path: "program.c", content}, header]}, {optimization, sanitized})

        expect(result.stdout).toEqual(expected)
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
      }
      const undeclared = content.replace(`bool ${name}`, "bool left").replace(`return ${name}`, "return left").replace(`value(${argument}, true)`, `value(${name}, true)`)

      await assert.rejects(executeCArtifacts({artifacts: [{path: "program.c", content: undeclared}, header]}),
        (error) => error.stage == "compile" && error.code == 1 && error.stderr.includes(`undeclared identifier '${name}'`))
    }
    for (const content of sources) assert.throws(() => parse({language: "c", filename: "boolean.c", source: content}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
  })

  it("rejects MB_LEN_MAX before artifacts that real limits.h macro expansion makes uncompilable", async () => {
    const source = "function value(left: number, right: number): number { return left + right; } console.log(value(4, 9));"
    const module = parse({language: "typescript", filename: "collision.ts", source})
    const set = generateArtifactSet({language: "c", module})
    const content = set.artifacts[0].content.replaceAll("left", "MB_LEN_MAX")

    await assert.rejects(executeCArtifacts({artifacts: [{path: "program.c", content}, set.artifacts[1]]}),
      (error) => error.stage == "compile" && error.code == 1 && error.stderr.includes("MB_LEN_MAX"))
    const collision = parse({language: "typescript", filename: "collision.ts", source: source.replaceAll("left", "MB_LEN_MAX")})

    assert.throws(() => generateArtifactSet({language: "c", module: collision}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && Boolean(error.location))
  })
})
