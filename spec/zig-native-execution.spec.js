// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"
import {executeZig, meaning, zigModes} from "./support/zig-toolchain.js"

const moduleFrom = source => parse({language: "typescript", filename: "native.ts", source})
const check = (results, stdout, stderr = "", status = 0) => {
  expect(results.stable).toBeTrue()
  expect(results.modes.map(({mode}) => mode)).toEqual(zigModes)
  for (const result of results.modes) {
    expect(result.status).toEqual(status)
    expect(result.stderr).toEqual(stderr)
    assert.deepEqual(Buffer.from(result.stdout), Buffer.from(stdout))
  }
}

describe("Zig 0.15.2 real offline native execution", () => {
  for (const [directory, stdout] of [["", "5\n"], ["scalars/", "yes\n"], ["locals/", "yes\n"],
    ["operators/", "typed:operators\n"], ["statements/", "checking\nyes\nmatched\nfallback\n"]]) {
    it("formats, tests, reparses and executes the " + (directory || "base") + " profile in all modes", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")
      const module = parse({language: "typescript", filename: "program.ts", source})
      const set = generateArtifactSet({language: "zig", module})
      const entry = set.artifacts[1]

      expect(meaning(parse({language: "zig", filename: entry.path, source: entry.content}))).toEqual(meaning(module))
      check(await executeZig(module, {label: "profile-" + (directory || "base")}), stdout)
    })
  }

  it("preserves Task-005 call chains, UTF-8, embedded NUL, immutable slices and mutable copies", async () => {
    const text = "é\0😀中\r\n\t\\\"\u007f\u2028\u2029"
    const module = moduleFrom(`function pass(value: string): string { return value; }
function join(first: string, second: string, third: string): string { let value: string = first + second; value = value + third; return value; }
function announce(value: string): void { console.log(value); return; }
function noop(): void { return; }
announce(pass(${JSON.stringify(text)})); noop(); console.log(join("a", "\\u0000", "😀"));`)

    check(await executeZig(module, {label: "task005-strings"}), `${text}\na\0😀\n`)
  })

  it("keeps arbitrary required arity canonical under zig fmt and executes every argument", async () => {
    const parameters = Array.from({length: 20}, (_, index) => `value${index}: number`).join(", ")
    const arguments_ = Array.from({length: 20}, (_, index) => String(index + 1)).join(", ")
    const module = moduleFrom(`function select(${parameters}): number { return value19; }
console.log(select(${arguments_}));`)

    check(await executeZig(module, {label: "arbitrary-arity"}), "20\n")
  })

  it("keeps a mutable local that is assigned but never read compiler-clean", async () => {
    const module = moduleFrom(`function assigned(): void { let value: number = 1; value = 2; console.log("done"); return; }
assigned();`)

    check(await executeZig(module, {label: "assigned-only-local"}), "done\n")
  })

  it("executes all scalar operators with identical mode boundaries", async () => {
    const module = moduleFrom(`function numbers(left: number, right: number): number {
      console.log(left + right); console.log(left - right); console.log(left * right); console.log(-left);
      console.log(left === right); console.log(left !== right); console.log(left < right); console.log(left <= right);
      console.log(left > right); console.log(left >= right); return left;
    }
    function flags(left: boolean, right: boolean): boolean { console.log(!left); console.log(left && right); console.log(left || right); return left; }
    function strings(left: string, right: string): string { console.log(left === right); console.log(left !== right); return left + right; }
    console.log(numbers(2, 3)); console.log(flags(true, false)); console.log(strings("é", "😀"));`)

    check(await executeZig(module, {label: "operators"}),
      "5\n-1\n6\n-2\nfalse\ntrue\ntrue\ntrue\nfalse\nfalse\n2\nfalse\nfalse\ntrue\ntrue\nfalse\ntrue\né😀\n")
  })

  it("preserves eager operand and argument order plus Boolean short-circuiting in every mode", async () => {
    const module = moduleFrom(`function mark(label: string, value: number): number { console.log(label); return value; }
function flag(label: string, value: boolean): boolean { console.log(label); return value; }
function combine(first: number, second: number, third: number): number { return first + second * third; }
console.log(combine(mark("first", 1), mark("second", 2), mark("third", 3)));
console.log(mark("left", 4) + mark("right", 5));
console.log(flag("and-left", false) && flag("and-right", true));
console.log(flag("or-left", true) || flag("or-right", false));`)

    check(await executeZig(module, {label: "evaluation-order"}),
      "first\nsecond\nthird\n7\nleft\nright\n9\nand-left\nfalse\nor-left\ntrue\n")
  })

  it("stops at the first failing eager helper or call argument before later effects in every mode", {timeoutMs: 600_000}, async () => {
    const definitions = `function mark(label: string, value: number): number { console.log(label); return value; }
function sum(left: number, right: number): number { return left + right; }
function select(first: number, second: number): number { return first; }
const maximum: number = sum(9007199254740991 * 1024, 1023);`
    const expressions = [
      "sum(sum(mark(\"first\", maximum), 1), mark(\"late\", 0))",
      "select(sum(mark(\"first\", maximum), 1), mark(\"late\", 0))"
    ]

    for (const [index, expression] of expressions.entries()) {
      check(await executeZig(moduleFrom(`${definitions}\nconsole.log(${expression});`),
        {expectedStatus: 70, label: `first-failure-${index}`}), "first\n", "semantifold: integer overflow\n", 70)
    }
  })

  it("prints i64 extrema and exits 70 on every dynamic overflow in all modes", {timeoutMs: 600_000}, async () => {
    const definitions = `function product(left: number, right: number): number { return left * right; }
function sum(left: number, right: number): number { return left + right; }
function subtract(left: number, right: number): number { return left - right; }
function negate(value: number): number { return -value; }
const maximum: number = sum(product(9007199254740991, 1024), 1023);
const minimum: number = subtract(negate(maximum), 1);`

    check(await executeZig(moduleFrom(definitions + "console.log(maximum); console.log(minimum);"), {label: "extrema"}),
      "9223372036854775807\n-9223372036854775808\n")
    for (const expression of ["sum(maximum, 1)", "subtract(minimum, 1)", "product(9007199254740991, 2048)", "negate(minimum)"]) {
      check(await executeZig(moduleFrom(definitions + `console.log("before"); console.log(${expression}); console.log("after");`),
        {expectedStatus: 70, label: expression}), "before\n", "semantifold: integer overflow\n", 70)
    }
  })
})
