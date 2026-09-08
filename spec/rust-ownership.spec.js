// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const helpers = 'fn semantifold_print_string(value: String) { println!("{}", value); }\n' +
  'fn take(first: String, second: String) -> String { return first; }\n' +
  'fn probe(first: String, second: String) -> bool { return true; }\n'
const caller = (body, signature = "fn choose(left: String, right: String) -> String") =>
  helpers + `${signature} {\n${body}\n}\nfn main() {}\n`
const read = source => parse({language: "rust", filename: "ownership.rs", source})
const ownershipFailure = error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
  error.language == "rust" && error.location?.filename == "ownership.rs" && /moved|borrowed/u.test(error.message)

describe("Rust source ownership preserves source meaning", () => {
  for (const [name, body] of [
    ["local initializer", "let saved: String = left; return left;"],
    ["call argument", "let saved: String = take(left, right); return left;"],
    ["print argument", "semantifold_print_string(left); return left;"],
    ["concatenation receiver", "let saved: String = left + &right; return left;"],
    ["second argument", "return take(left, left);"],
    ["clone after move", "let saved: String = left; return left.clone();"],
    ["comparison after move", 'let saved: String = left; if left == right { return saved; } return String::from("no");'],
    ["conditional fallthrough", "if true { let saved: String = left; } return left;"],
    ["one branch restores", 'let mut value: String = left; let saved: String = value; if true { value = right; } return value;'],
    ["short-circuit consumption", 'if false && probe(left, right.clone()) {} return left;'],
    ["short-circuit later argument", 'if probe(left, right.clone()) || probe(left.clone(), right) {} return String::from("done");']
  ]) {
    it("rejects a use invalidated by " + name + " at the original use", () => {
      const source = caller(body)

      assert.throws(() => read(source), error => ownershipFailure(error) &&
        ["left", "value"].includes(source.slice(error.location.start.offset, error.location.end.offset)))
    })
  }

  it("rejects moving the left comparison operand while its implicit borrow remains live", () => {
    const source = caller("return left == take(left, right);", "fn choose(left: String, right: String) -> bool")

    assert.throws(() => read(source), error => ownershipFailure(error) && /borrowed/u.test(error.message) &&
      source.slice(error.location.start.offset, error.location.end.offset) == "left")
  })

  it("accepts owned terminal transfers, explicit copies, borrowing and complete reinitialization", () => {
    for (const body of [
      "let saved: String = left; return saved;",
      "semantifold_print_string(left.clone()); return left;",
      "let saved: String = left.clone() + &right; semantifold_print_string(right.clone()); return saved;",
      'if left == right { return left; } return right;',
      'let saved: String = take(left.clone(), right.clone()); if saved == left { return right; } return left;',
      "let mut value: String = left; let saved: String = value; value = right; return value;",
      'let mut value: String = left; let saved: String = value; if true { value = right; } else { value = String::from("new"); } return value;'
    ]) expect(read(caller(body)).functions.at(-1).name).toEqual("choose")
    expect(read(caller("return left == take(left.clone(), right);", "fn choose(left: String, right: String) -> bool")).functions.at(-1).returnType.name).toEqual("boolean")
  })

  it("merges only continuing branch paths after terminal moves", () => {
    for (const body of [
      'if flag { return fallback; } return fallback;',
      'if flag { let moved: String = fallback; return moved; } else { semantifold_print_string(fallback.clone()); } return fallback;',
      'if flag { if flag { return fallback; } else { return fallback; } } return fallback;'
    ]) {
      const module = read(caller(body, "fn choose(flag: bool, fallback: String) -> String"))
      const set = generateArtifactSet({language: "rust", module})

      expect(read(set.artifacts[2].content).functions.at(-1).name).toEqual("choose")
    }
  })

  it("permits repeated Copy scalars and generated copies without adding ownership IR", () => {
    const source = 'function duplicate(left: string, right: string): string {\n' +
      ' const saved: string = left; console.log(left); return left + saved + right;\n}\nconsole.log(duplicate("a", "b"));'
    const module = parse({filename: "copies.ts", language: "typescript", source})
    const code = generateArtifactSet({language: "rust", module}).artifacts[2].content

    expect(code).toContain(".clone()")
    expect(read(code).functions[0].body.statements[0].initializer.kind).toEqual("IdentifierExpression")
    expect(read(caller("let saved: i64 = left; return left + saved + right;", "fn choose(left: i64, right: i64) -> i64")).functions.at(-1).returnType.name).toEqual("integer")
  })
})
