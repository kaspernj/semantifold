// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {rustManifest, rustRuntime} from "../src/backends/rust-runtime.js"
import {executeRust, executeRustArtifacts, meaning, rustProfiles, rustSourceArtifacts} from "./support/rust-toolchain.js"

const moduleFrom = source => parse({language: "typescript", filename: "native.ts", source})
const numbers = `function product(left: number, right: number): number { return left * right; }
function sum(left: number, right: number): number { return left + right; }
function subtract(left: number, right: number): number { return left - right; }
function negate(left: number, right: number): number { return -left; }
const maximum: number = sum(product(9007199254740991, 1024), 1023);
const minimum: number = subtract(negate(maximum, 0), 1);
`
const checkOutput = (results, stdout, stderr = "", status = 0) => {
  expect(results.stable).toEqual(true)
  expect(results.modes.map(({mode}) => mode)).toEqual(["debug", "release"])
  for (const result of results.modes) {
    expect(result.status).toEqual(status)
    expect(result.stderr).toEqual(stderr)
    assert.deepEqual(Buffer.from(result.stdout), Buffer.from(stdout))
  }
}

describe("Rust real offline locked native execution", () => {
  for (const [directory, stdout] of rustProfiles) it("executes and reparses the " + (directory || "base") + " profile in both modes", async () => {
    const source = await readFile(new URL("fixtures/" + directory + "program.rs", import.meta.url), "utf8")
    const module = parse({language: "rust", filename: "program.rs", source})
    const set = generateArtifactSet({language: "rust", module})
    const reparsed = parse({language: "rust", filename: "src/main.rs", source: set.artifacts[2].content})

    expect(meaning(reparsed)).toEqual(meaning(module))
    checkOutput(await executeRustArtifacts(set, {label: "profile-" + (directory || "base")}), stdout)
  })

  it("preserves long owned strings, repeated reads, mutation, Unicode and every control escape", async () => {
    const text = "é\0😀中\r\n\t\b\f\\\"\u007f\u2028\u2029".repeat(8)
    const module = moduleFrom(`function join(left: string, right: string): string {
      const original: string = left; let changed: string = left + right;
      changed = changed + original; console.log(original); return changed;
    }
    const first: string = ${JSON.stringify(text)}; let second: string = first;
    const result: string = join(second, "尾"); second = "changed";
    console.log(first); console.log(second); console.log(result); console.log(first === result); console.log(first !== result);`)
    const source = generateArtifactSet({language: "rust", module}).artifacts[2].content
    const reparsed = parse({language: "rust", filename: "strings.rs", source})

    expect(meaning(reparsed)).toEqual(meaning(module))
    checkOutput(await executeRust(reparsed, {label: "unicode-copy"}), `${text}\n${text}\nchanged\n${text}尾${text}\nfalse\ntrue\n`)
  })

  it("executes original Rust scalar escapes and raw NUL identically after source reparse", async () => {
    const content = rustRuntime + '\nfn join(left: String, right: String) -> String { return left + &right; }\n' +
      'fn main() { semantifold_print_string(join(String::from("é\0😀\t"), String::from("\\0\\x7f\\u{1f600}\\r\\n"))); }\n'
    const expected = "é\0😀\t\0\x7f😀\r\n\n"

    for (const source of [content, content.replaceAll("\n", "\r\n")]) {
      const module = parse({language: "rust", filename: "escaped.rs", source})

      checkOutput(await executeRustArtifacts(rustSourceArtifacts(source), {label: "original-scalar-escapes"}), expected)
      checkOutput(await executeRust(module, {label: "reparsed-scalar-escapes"}), expected)
    }
  })

  it("preserves every ordered statement consumer, exactly-once calls and both short-circuit paths", async () => {
    const source = await readFile(new URL("fixtures/ordered-program.ts", import.meta.url), "utf8")
    const expected = "arg-left\narg-right\ninitial-left\ninitial-right\nassign-left\nassign-right\ntest\nprint-left\nprint-right\n12\nand-left\nreturn-left\nreturn-right\n7\n" +
      "true-and-left\ntrue-and-right\ntrue\nfalse-or-left\nfalse-or-right\ntrue\ntrue-or-left\ntrue\nstring-left\nstring-right\né\0😀\n"

    checkOutput(await executeRust(moduleFrom(source), {label: "ordered"}), expected)
  })

  it("executes all arithmetic, comparison, equality, boolean and string operators", async () => {
    const source = `function numbers(left: number, right: number): number {
      console.log(left + right); console.log(left - right); console.log(left * right); console.log(-left);
      console.log(left === right); console.log(left !== right); console.log(left < right); console.log(left <= right);
      console.log(left > right); console.log(left >= right); return left;
    }
    function flags(left: boolean, right: boolean): boolean {
      console.log(!left); console.log(left === right); console.log(left !== right); console.log(left && right); console.log(left || right); return left;
    }
    function strings(left: string, right: string): string { console.log(left === right); console.log(left !== right); return left + right; }
    console.log(numbers(2, 3)); console.log(flags(true, false)); console.log(strings("é", "😀"));`

    checkOutput(await executeRust(moduleFrom(source), {label: "all-operators"}),
      "5\n-1\n6\n-2\nfalse\ntrue\ntrue\ntrue\nfalse\nfalse\n2\nfalse\nfalse\ntrue\nfalse\ntrue\ntrue\nfalse\ntrue\né😀\n")
  })

  it("prints signed i64 extrema and stops each dynamic overflow identically in both modes", async () => {
    checkOutput(await executeRust(moduleFrom(numbers + "console.log(maximum); console.log(minimum);"), {label: "extrema"}),
      "9223372036854775807\n-9223372036854775808\n")
    for (const expression of ["sum(maximum, 1)", "subtract(minimum, 1)", "product(9007199254740991, 2048)", "negate(minimum, 0)"]) {
      const module = moduleFrom(numbers + `console.log("before"); console.log(${expression}); console.log("after");`)

      checkOutput(await executeRust(module, {expectedStatus: 70, label: expression}), "before\n", "semantifold: integer overflow\n", 70)
    }
  })

  it("skips divergent branches and allows forward recursion, unused bindings and fallthrough", async () => {
    const source = `function recurse(left: number, right: number): boolean { return recurse(left, right); }
function first(left: number, right: number): number { if (left > 0) { return second(left - 1, right); } return right; }
function second(left: number, right: number): number { return first(left, right); }
function choose(left: boolean, right: string): string { if (left) { if (false) { return "bad"; } } else { return right; } return "yes"; }
function unused(left: string, right: string): string { let ignored: string = left; ignored = right; return right; }
console.log(false && recurse(0, 0)); console.log(true || recurse(0, 0)); console.log(first(2, 9)); console.log(choose(true, "no")); console.log(choose(false, "no"));`

    checkOutput(await executeRust(moduleFrom(source), {label: "short-circuit-divergence"}), "false\ntrue\n9\nyes\nno\n")
  })

  it("compiles and reparses the deepest supported generated String borrow expansion", async () => {
    const module = moduleFrom('function join(left: string, right: string): string { return left + right; } console.log(join("a", "z"));')
    const original = module.functions[0].body.statements[0].expression
    let expression = original.right

    for (let index = 0; index < 126; index++) expression = {...original, left: original.left, right: expression}
    module.functions[0].body.statements[0].expression = expression
    const source = generateArtifactSet({language: "rust", module}).artifacts[2].content

    expect(meaning(parse({language: "rust", filename: "depth.rs", source}))).toEqual(meaning(module))
    checkOutput(await executeRust(module, {label: "borrow-expansion-boundary"}), "a".repeat(126) + "z\n")
  })

  it("preserves accepted mixed-case function and binding names without Cargo warning output", async () => {
    const module = moduleFrom("function ChooseValue(Left: number, Right: number): number { const SavedValue: number = Left + Right; return SavedValue; } console.log(ChooseValue(2, 3));")

    checkOutput(await executeRust(module, {label: "mixed-case-identifiers"}), "5\n")
  })

  it("preserves edition-2021 identifiers that are keywords only in other contexts or editions", async () => {
    const module = moduleFrom("function macro_rules(left: number, right: number): number { const gen: number = left + right; return gen; } console.log(macro_rules(2, 3));")
    const source = generateArtifactSet({language: "rust", module}).artifacts[2].content

    expect(meaning(parse({language: "rust", filename: "names.rs", source}))).toEqual(meaning(module))
    checkOutput(await executeRust(module, {label: "edition-2021-names"}), "5\n")
  })

  it("proves original illegal moves and overlapping borrows with rustc before frontend rejection", async () => {
    for (const [body, code] of [
      ['let copy: String = left; return left;', "E0382"],
      ['return take(left, right) + &left;', "E0382"]
    ]) {
      const content = rustRuntime + '\nfn take(left: String, right: String) -> String { return left; }\n' +
        `fn moved(left: String, right: String) -> String { ${body} }\nfn main() {}\n`
      const result = await executeRustArtifacts(rustSourceArtifacts(content), {expectedCheckStatus: 101, label: "source-" + code})

      expect(result.commands[0].stderr).toContain(code)
      assert.throws(() => parse({language: "rust", filename: "illegal.rs", source: content}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.location?.filename == "illegal.rs")
    }
    const content = rustRuntime + '\nfn take(left: String, right: String) -> String { return left; }\n' +
      'fn borrowed(left: String, right: String) -> bool { return left == take(left, right); }\nfn main() {}\n'
    const result = await executeRustArtifacts(rustSourceArtifacts(content), {expectedCheckStatus: 101, label: "source-E0505"})

    expect(result.commands[0].stderr).toContain("E0505")
    assert.throws(() => parse({language: "rust", filename: "borrow.rs", source: content}), error =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.location?.filename == "borrow.rs")
  })

  it("fails on network demand in a fresh Cargo home without changing manifest or lock bytes", async () => {
    const result = await executeRustArtifacts(rustSourceArtifacts("fn main() {}\n",
      rustManifest + '\n[dependencies]\ntask020-does-not-exist = "=0.0.0"\n'), {expectedCheckStatus: 101, label: "offline-demand"})

    expect(result.commands[0].stderr).toContain("offline")
    expect(result.commands[0].stderr).toContain("no matching package named")
    expect(result.stable).toEqual(true)
  })
})
