// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {executeZigArtifacts} from "./support/zig-toolchain.js"

const meaning = value => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const generated = source => {
  const module = parse({language: "typescript", filename: "source.ts", source})
  return {module, source: generateArtifactSet({language: "zig", module}).artifacts[1].content}
}
const rejected = error => error instanceof SemantifoldDiagnostic && error.language == "zig" &&
  ["UNSUPPORTED_SYNTAX", "PARSE_ERROR", "MISSING_TYPE", "TYPE_MISMATCH", "INVALID_OPERAND", "NON_BOOLEAN_CONDITION"].includes(error.code) &&
  error.location?.filename == "program.zig"

describe("Zig strict source profile", () => {
  it("round-trips scalars, typed const/var locals, current operators, conditionals and direct calls", () => {
    const {module, source} = generated(`function choose(flag: boolean, left: string, right: string): string {
      const saved: string = left; let changed: string = saved + right; changed = changed + "é\\u0000😀";
      if (flag && left !== right) { return changed; } else { return right; }
    } console.log(choose(true, "a", "b"));`)

    expect(meaning(parse({language: "zig", filename: "program.zig", source}))).toEqual(meaning(module))
  })

  it("round-trips zero/one/many parameters, void returns, bare returns and void expression statements", () => {
    const {module, source} = generated(`function zero(): number { return 0; }
function announce(value: string): void { console.log(value); }
function noop(): void { return; }
function sum3(a: number, b: number, c: number): number { announce("call"); noop(); return a + b + c + zero(); }
console.log(sum3(1, 2, 3));`)

    expect(meaning(parse({language: "zig", filename: "program.zig", source}))).toEqual(meaning(module))
  })

  it("rejects compiler-invalid native slice operators and cross-family helpers at their source occurrence", {timeoutMs: 180_000}, async () => {
    const cases = [
      {
        source: "function join(left: string, right: string): string { return left + right; } console.log(join(\"a\", \"b\"));",
        from: "semantifold_string_concat(left, right)", to: "left + right", token: "+"
      },
      {
        source: "function join(left: string, right: string): string { return left + right; } console.log(join(\"a\", \"b\"));",
        from: "semantifold_string_concat(left, right)", to: "semantifold_integer_add(left, right)", token: "semantifold_integer_add"
      },
      {
        source: "function add(left: number, right: number): number { return left + right; } console.log(add(1, 2));",
        from: "semantifold_integer_add(left, right)", to: "semantifold_string_concat(left, right)", token: "semantifold_string_concat"
      },
      {
        source: "function equal(left: string, right: string): boolean { return left === right; } console.log(equal(\"a\", \"b\"));",
        from: "semantifold_string_equal(left, right)", to: "left == right", token: "=="
      },
      {
        source: "function equal(left: number, right: number): boolean { return left === right; } console.log(equal(1, 2));",
        from: "left == right", to: "semantifold_string_equal(left, right)", token: "semantifold_string_equal"
      }
    ]

    for (const [index, testCase] of cases.entries()) {
      const module = parse({language: "typescript", filename: "source.ts", source: testCase.source})
      const set = structuredClone(generateArtifactSet({language: "zig", module}))
      const entry = set.artifacts[1]

      entry.content = String(entry.content).replace(testCase.from, testCase.to)
      assert.notEqual(entry.content, generateArtifactSet({language: "zig", module}).artifacts[1].content)
      await assert.rejects(() => executeZigArtifacts(set, {label: `invalid-source-operation-${index}`}),
        error => error instanceof Error && /"stage":"Debug-(?:test|build)"/u.test(error.message))
      assert.throws(() => parse({language: "zig", filename: "program.zig", source: String(entry.content)}),
        error => rejected(error) && error.code == "UNSUPPORTED_SYNTAX" &&
          String(entry.content).slice(error.location.start.offset, error.location.end.offset) == testCase.token,
        testCase.to)
    }
  })

  it("rejects recovery, inferred locals and every excluded low-level feature with a location", () => {
    const baseline = generated("function keep(left: number, right: number): number { return left + right; } console.log(keep(1, 2));").source
    const replacements = [
      ["const probe_value: i64 = 1;", "const probe_value = 1;"],
      ["const probe_value: i64 = 1;", "comptime var probe_value: i64 = 1;"],
      ["const probe_value: i64 = 1;", "const probe_value: ?i64 = 1;"],
      ["const probe_value: i64 = 1;", "const probe_value: anyerror!i64 = 1;"],
      ["const probe_value: i64 = 1;", "const probe_value: error{Failure} = error.Failure;"],
      ["const probe_value: i64 = 1;", "const probe_value: [1]i64 = .{1};"],
      ["const probe_value: i64 = 1;", "const probe_value: []const i64 = &.{1};"],
      ["const probe_value: i64 = 1;", "const probe_value: *const i64 = undefined;"],
      ["const probe_value: i64 = 1;", "defer _ = 1;"],
      ["const probe_value: i64 = 1;", "errdefer _ = 1;"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = try keep(1, 2);"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = keep(1, 2) catch 0;"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = 1 +% 2;"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = 1 +| 2;"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = @intCast(1);"],
      ["const probe_value: i64 = 1;", "const probe_value: type = @TypeOf(1);"],
      ["const probe_value: i64 = 1;", "const probe_value: type = @cImport({});"],
      ["const probe_value: i64 = 1;", "const probe_value: std.mem.Allocator = std.heap.page_allocator;"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = async keep(1, 2);"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = undefined;"],
      ["const probe_value: i64 = 1;", "const probe_value: i64 = unreachable;"],
      ["const probe_value: i64 = 1;", "asm volatile (\"\");"]
    ]
    const marker = "fn keep(left: i64, right: i64) i64 {\n"
    const withProbe = baseline.replace(marker, marker + "    const probe_value: i64 = 1;\n")

    for (const [from, to] of replacements) {
      assert.throws(() => parse({language: "zig", filename: "program.zig", source: withProbe.replace(from, to)}), rejected, to)
    }
    for (const source of [baseline.slice(0, -2), baseline.replace("semantifold_integer_add(left, right)", "left +"), "\ud800"]) {
      assert.throws(() => parse({language: "zig", filename: "program.zig", source}),
        error => rejected(error) && error.code == "PARSE_ERROR")
    }
  })

  it("rejects modified generated support, doc comments, top-level containers and noncanonical literals", () => {
    const baseline = generated("function keep(left: number, right: number): number { return left + right; } console.log(keep(1, 2));").source

    for (const source of [baseline.replace("@addWithOverflow", "@subWithOverflow"), baseline.replace("const std", "/// docs\nconst std"),
      baseline.replace("const std", "// zig fmt: off\nconst std"),
      ...["struct", "union", "enum"].map(kind => `const User = ${kind} { value: i64 };\n` + baseline),
      baseline.replace("fn keep(left: i64", "fn keep(left: anytype"),
      baseline.replace("fn keep(left: i64", "fn keep(comptime left: i64"),
      baseline.replace("semantifold_integer_add(left, right)", "0xff")]) {
      assert.throws(() => parse({language: "zig", filename: "program.zig", source}), rejected)
    }
  })

  it("rejects the owned UTF-16 source and CST depth boundaries before adaptation", () => {
    const baseline = generated("function keep(left: number, right: number): number { return left + right; } console.log(keep(1, 2));").source
    const deep = "(".repeat(520) + "keep(1, 2)" + ")".repeat(520)

    assert.throws(() => parse({language: "zig", filename: "program.zig", source: baseline + "//" + "x".repeat(1_000_001)}), rejected)
    assert.throws(() => parse({language: "zig", filename: "program.zig",
      source: baseline.replace("keep(1, 2)", deep)}), rejected)
  })
})
