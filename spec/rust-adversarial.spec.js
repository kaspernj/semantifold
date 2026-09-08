// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {rustRuntime} from "../src/backends/rust-runtime.js"

const body = '\nfn join(left: String, right: String) -> String { return left + &right; }\n' +
  'fn main() { semantifold_print_string(join(String::from("é😀"), String::from("tail"))); }\n'
const read = source => parse({language: "rust", filename: "adversarial.rs", source})
const located = error => error instanceof SemantifoldDiagnostic && error.language == "rust" &&
  error.location?.filename == "adversarial.rs" && error.location.start.offset >= 0 && error.location.end.offset >= error.location.start.offset

describe("Rust exact all-child scaffolding and adversarial boundaries", () => {
  it("rejects every changed overflow primitive, flag, exit, diagnostic, type and print token", () => {
    const source = rustRuntime + body

    for (const [from, to] of [
      ["overflowing_add", "wrapping_add"], ["overflowing_sub", "overflowing_add"], ["overflowing_mul", "overflowing_sub"],
      ["overflowing_neg()", "overflowing_neg(value)"], ["if overflow", "if !overflow"], ["exit(70)", "exit(0)"],
      ["integer overflow", "overflow"], ["eprintln!", "println!"], ["return result;", "return left;"],
      ["(i64, bool)", "(i64, i64)"], ['println!("{}", value)', 'println!("{}", value + 1i64)'],
      ['println!("{}", value)', 'println!["{}", value]'], ['println!("{}", value)', 'println!("{}", value,)'],
      ["let (result, overflow)", "let (overflow, result)"], ["unused_parens", "unused_parens, unsafe_code"]
    ]) assert.throws(() => read(source.replace(from, to)), located, `${from} => ${to}`)
  })

  it("never authorizes generated helpers from marker comments, attributes or shadowed names", () => {
    for (const source of [
      "// semantifold:runtime:rust:v1\n" + body,
      "/* semantifold generated */\n" + body,
      rustRuntime.replace('println!("{}", value)', 'println!("changed", value)') + body,
      rustRuntime + '#[inline]\n' + body,
      rustRuntime + body.replace("fn join", "#[allow(dead_code)] fn join"),
      rustRuntime + body.replace("fn main() {", "fn main() { #[allow(unused)]"),
      rustRuntime + body.replace("fn main() {", "fn main() { let semantifold_print_string: i64 = 1i64;"),
      rustRuntime + body.replace("fn join(left", "fn join(semantifold_integer_add"),
      rustRuntime + body.replace("return left + &right;", 'fn hidden() {} return left + &right;')
    ]) assert.throws(() => read(source), located)
  })

  it("accepts only inert ordinary comments including nested blocks and accounts for documentation extras", () => {
    const source = rustRuntime + body
    const commented = source.replace('println!("{}", value)', 'println!(/* ordinary /* nested */ checked */ "{}", value)')

    expect(read(commented).functions[0].name).toEqual("join")
    for (const comment of ["/// documented\n", "//! inner\n", "/** documented */", "/*! documented */"]) {
      assert.throws(() => read(source.replace('println!("{}", value)', 'println!(' + comment + '"{}", value)')), located)
    }
  })

  it("rejects all namespace collisions before emitting any artifact even at the final binding", () => {
    for (const name of ["main", "String", "std", "i64", "bool", "_", "self", "Self", "super", "crate", "async", "await", "dyn",
      "try", "yield", "semantifold_print_string", "semantifold_integer_add", "r#type", "é", "bad-name"]) {
      const module = parse({language: "typescript", filename: "names.ts", source:
        'function choose(left: string, right: string): string { return left; } const value: string = "safe"; console.log(value);'})

      module.entryPoint.body.statements[0].name = name
      module.entryPoint.body.statements[1].expression.name = name
      assert.throws(() => generateArtifactSet({language: "rust", module}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.location?.filename == "names.ts", name)
    }
  })

  it("checks both unreachable and uncalled source regions and rejects hidden macros or items", () => {
    for (const extra of ['println!("hidden");', 'let hidden = 1i64;', 'unsafe {}', 'const HIDDEN: i64 = 1i64;', 'let hidden: i64 = 1i64 as i64;']) {
      assert.throws(() => read(rustRuntime + body.replace("return left + &right;", "return left + &right; " + extra)), located)
      assert.throws(() => read(rustRuntime + body + `fn hidden(left: i64, right: i64) -> i64 { ${extra} return left; }`), located)
    }
  })
})
