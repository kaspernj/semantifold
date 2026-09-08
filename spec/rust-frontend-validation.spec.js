// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const read = source => parse({filename: "program.rs", language: "rust", source})
const meaning = value => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const printString = 'fn semantifold_print_string(value: String) { println!("{}", value); }\n'
const caller = (body = "return left;", signature = "fn choose(left: i64, right: i64) -> i64") =>
  `${signature} { ${body} }\nfn main() {}\n`
const rejected = error => error instanceof SemantifoldDiagnostic && error.language == "rust" &&
  ["UNSUPPORTED_SYNTAX", "PARSE_ERROR", "MISSING_TYPE", "TYPE_MISMATCH", "INVALID_OPERAND", "NON_BOOLEAN_CONDITION"].includes(error.code) &&
  error.location?.filename == "program.rs"

describe("Rust strict source profile", () => {
  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/"]) {
    it("adapts the complete " + (directory || "base") + " profile to the original semantics", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.rs`, import.meta.url), "utf8")
      const original = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")

      expect(meaning(read(source))).toEqual(meaning(parse({filename: "program.ts", language: "typescript", source: original})))
    })
  }

  it("preserves scalar strings, control escapes, NUL and Unicode with parser-owned locations", () => {
    const source = "/* 😀 */\r\n" + caller(String.raw`return String::from("é😀\0\n\r\t\\\"\'\x7f\u{1f600}");`, "fn choose(left: String, right: String) -> String")
    const module = read(source)

    expect(module.functions[0].location.start).toEqual({column: 1, line: 2, offset: 10})
    expect(module.functions[0].body.statements[0].expression.value).toEqual("é😀\0\n\r\t\\\"'\x7f😀")
  })

  it("rejects a crate with only the canonical empty main", () => {
    const source = "fn main() {}\n"

    assert.throws(() => read(source), error => rejected(error) && error.message.includes("semantic function required") &&
      error.location.start.offset == 0 && error.location.end.offset == source.length)
  })

  it("accepts explicit String clones, concat borrowing, comparisons and nested direct calls", () => {
    const source = printString + 'fn join(left: String, right: String) -> String {\n' +
      '  let saved: String = left.clone();\n  if left == right { return saved; }\n' +
      '  return (left.clone() + &String::from(":")) + &right;\n}\n' +
      'fn main() { semantifold_print_string(join(join(String::from("a"), String::from("b")), String::from("c"))); }\n'
    const module = read(source)

    expect(module.functions[0].body.statements[0].initializer.kind).toEqual("IdentifierExpression")
    expect(module.functions[0].body.statements[2].expression.operation).toEqual("StringConcat")
    expect(module.entryPoint.body.statements[0].expression.arguments[0].kind).toEqual("CallExpression")
  })

  it("rejects excluded items, patterns, references, dispatch, operators, macros and control flow", () => {
    for (const body of [
      "left", "let value = left; return value;", "let value: i64; return left;", "let (a, b): (i64, i64) = (left, right); return a;",
      "let value: &i64 = &left; return left;", "let value: *const i64 = &left; return left;", "return left / right;", "return left % right;",
      "return left << right;", "return left & right;", "return left as i64;", "return [left, right][0];", "return left.abs();",
      "return choose::<i64>(left, right);", "return if true { left } else { right };", "loop { return left; }", "while true { return left; }",
      "for value in 0..left {} return left;", "return match left { _ => right };", "let value: i64 = (|a| a)(left); return value;",
      "return Some(left).unwrap();", 'return Some(left).expect("bad");', "return Ok(left)?;", 'panic!("bad");', "assert!(true); return left;",
      'std::panic::catch_unwind(|| {}); return left;', "unsafe { return left; }", "println!(\"{}\", left); return left;",
      "left += right; return left;", "return &left;", "return *left;", "return 1;", "return 1u64;", "return 0xffi64;", "return 1_000i64;"
    ]) assert.throws(() => read(caller(body)), rejected, body)
    for (const signature of [
      "pub fn choose(left: i64, right: i64) -> i64", "async fn choose(left: i64, right: i64) -> i64",
      'extern "C" fn choose(left: i64, right: i64) -> i64', "unsafe fn choose(left: i64, right: i64) -> i64",
      "fn choose<T>(left: T, right: T) -> T", "fn choose<'a>(left: &'a i64, right: i64) -> i64",
      "fn choose(mut left: i64, right: i64) -> i64", "fn choose(left: i32, right: i64) -> i64",
      "fn choose(left: i64) -> i64", "fn choose(left: i64, right: i64)", "fn choose(left: i64, right: i64) -> Result<i64, String>"
    ]) assert.throws(() => read(caller("return left;", signature)), rejected, signature)
    for (const item of ["mod hidden {}", "use std::string::String;", "struct Value;", "enum Value { A }", "trait Value {}",
      "impl Value {}", "type Value = i64;", "const VALUE: i64 = 1;", "static VALUE: i64 = 1;", "#[inline]", "/// attribute doc\n",
      "macro_rules! hidden { () => {} }"]) assert.throws(() => read(item + "\n" + caller()), rejected, item)
    assert.throws(() => read(caller().replace("fn main() {}", "fn main() -> Result<(), String> { Ok(()) }")), rejected)
  })

  it("requires every exact print helper token and its matching scalar call", () => {
    const program = printString + caller('return String::from("ok");', "fn choose(left: String, right: String) -> String")
    const valid = program.replace("fn main() {}", 'fn main() { semantifold_print_string(choose(String::from("a"), String::from("b"))); }')

    expect(read(valid).entryPoint.body.statements[0].kind).toEqual("PrintStatement")
    for (const replacement of ['eprintln!("{}", value)', 'println!("{:?}", value)', 'println!("{}", value.clone())', 'println!("{}", value, value)',
      'println!("{}", "lookalike")', 'println!("{value}")']) {
      assert.throws(() => read(valid.replace('println!("{}", value)', replacement)), rejected, replacement)
    }
    assert.throws(() => read(valid.replace(printString, "// semantifold:runtime:rust:v1\n")), rejected)
    assert.throws(() => read(valid.replace('choose(String::from("a"), String::from("b"))', "1i64")), rejected)
    assert.throws(() => read(valid.replace(printString, printString + printString)), rejected)
  })

  it("rejects invalid string/scalar scaffolding and locates the original rejected literal", () => {
    for (const expression of ['String::from(r"raw")', 'String::from(b"bytes")', 'String::from("\\x80")', 'String::from("\\u{d800}")',
      'String::from("\\u{110000}")', 'String::from("\\\ncontinuation")', 'String::from("raw\rnewline")', 'String::new()',
      'left.to_owned()', 'left.to_string()', 'left.clone(right)', 'left + right']) {
      assert.throws(() => read(caller(`return ${expression};`, "fn choose(left: String, right: String) -> String")), rejected, expression)
    }
    for (const expression of ["left.clone()", "left + &right"]) assert.throws(() => read(caller(`return ${expression};`)), rejected)
    const source = "/* 😀 */\r\n" + caller("return 1u32;")

    assert.throws(() => read(source), error => rejected(error) && error.code == "UNSUPPORTED_SYNTAX" &&
      source.slice(error.location.start.offset, error.location.end.offset) == "1u32" && error.location.start.line == 2)
  })

  it("fails closed on recovery, oversized input, lone surrogates and deep CSTs", () => {
    for (const source of [caller("return left + ;"), caller().slice(0, -3), "\ud800", caller('return String::from("broken);')]) {
      assert.throws(() => read(source), error => rejected(error) && error.code == "PARSE_ERROR")
    }
    assert.throws(() => read(" ".repeat(32768)), rejected)
    for (const depth of [600, 6000]) assert.throws(() => read(caller("return " + "(".repeat(depth) + "left" + ")".repeat(depth) + ";")), rejected)
  })
})
