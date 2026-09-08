// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const source = `function mark(label: string, value: number): number { console.log(label); return value }
function flag(label: string, value: boolean): boolean { console.log(label); return value }
function compute(left: number, right: number): number {
  let result: number = mark("initial-left", left) + mark("initial-right", right);
  result = mark("assign-left", result) - mark("assign-right", right);
  if (flag("test", true)) { console.log(mark("print-left", left) * mark("print-right", right)); }
  if (flag("and-left", false) && (flag("or-left", true) || flag("skipped", false))) { return right; }
  return mark("return-left", result) + mark("return-right", right);
}
console.log(compute(mark("arg-left", 3), mark("arg-right", 4)));`
const moduleFrom = () => parse({language: "typescript", filename: "ordered.ts", source})
const generated = () => generateArtifactSet({language: "cpp", module: moduleFrom()}).artifacts[0].content
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const read = (content) => parse({language: "cpp", filename: "program.cpp", source: content})

describe("C++ exact ordered-expression regions", () => {
  it("reconstructs all consumers and nested eager/short-circuit expressions from complete CSTs", () => {
    expect(meaning(read(generated()))).toEqual(meaning(moduleFrom()))
  })

  it("reconstructs nested checked and string operations only through the generated temporary plan", () => {
    const module = parse({language: "typescript", filename: "helpers.ts", source:
      'function calculate(left: number, right: number): number { return -(left + right) * (left - right); } ' +
      'function compare(left: string, right: string): boolean { return (left + right) === (right + left) && (left + right) !== left; } ' +
      'console.log(calculate(4 + 1, -(2 * 3))); console.log(compare("é\\u0000", "😀"));'})
    const content = generateArtifactSet({language: "cpp", module}).artifacts[0].content
    const reparsed = read(content)

    expect(meaning(reparsed)).toEqual(meaning(module))
    expect(generateArtifactSet({language: "cpp", module: reparsed}).artifacts[0].content).toEqual(content)
    for (const helper of ["integer_add", "integer_subtract", "integer_multiply", "integer_negate", "string_concat", "string_equal", "string_not_equal"]) {
      assert.ok(content.includes(`semantifold_${helper}(`))
    }
  })

  it("accepts ordinary comments and whitespace without weakening scaffold structure", () => {
    const content = generated().replaceAll(";\n", "; /* ordinary 😀 comment */ // ordinary line comment\n").replaceAll("\n", "\r\n")

    expect(meaning(read(content))).toEqual(meaning(moduleFrom()))
  })

  it("rejects unsafe comments before canonical ordered-region comparison can discard them", () => {
    const content = generated()

    for (const comment of ["// comment\rsemantifold_print_integer(std::int64_t(99));\n",
      "/* hidden *\\\n/ semantifold_print_integer(std::int64_t(99)); /* still hidden */\n"]) {
      for (const anchor of ["int main() {\n", "    return 0;\n"]) {
        const changed = content.replace(anchor, anchor + comment)

        assert.notEqual(changed, content)
        assert.throws(() => read(changed), (error) => error instanceof SemantifoldDiagnostic &&
          error.code == "UNSUPPORTED_SYNTAX" && error.location.start.offset == changed.indexOf(comment))
      }
    }
  })

  it("keeps original short-circuit operator mappings and synthetic control/temporary names", () => {
    const entry = generateArtifactSet({language: "cpp", module: moduleFrom()}).artifacts[0]
    const mapping = entry.provenance.mapping

    for (const operator of ["&&", "||"]) {
      assert.ok(entry.content.includes(operator), `original operator ${operator} has a target token`)
      assert.ok(JSON.stringify(mapping).includes("operator"))
    }
  })

  it("rejects malformed, forged, escaping and reordered regions as located syntax failures", () => {
    const content = generated()
    const firstDeclaration = / {4}std::int64_t semantifold_ordered_[0-9]{6} = [^\n]+\n/u.exec(content)?.[0]
    const marker = /\/\* semantifold:ordered-expression:cpp:v1 begin [^\n]+/u.exec(content)?.[0]
    const eagerPair = / {4}std::int64_t semantifold_ordered_[0-9]{6} = mark\([^\n]+\n {4}std::int64_t semantifold_ordered_[0-9]{6} = mark\([^\n]+\n/u.exec(content)?.[0]

    assert.ok(firstDeclaration)
    assert.ok(marker)
    assert.ok(eagerPair)
    const corruptions = [
      content.replace("semantifold:program:cpp:v1", "semantifold:program:cpp:v2"),
      content.replace("ordered-expression:cpp:v1", "ordered-expression:c:v1"),
      content.replace("ordered-expression:cpp:v1", "ordered-expression:cpp:v2"),
      content.replace(marker, ""), content.replace(marker, marker + "\n" + marker),
      content.replace(eagerPair, eagerPair.trimEnd().split("\n").reverse().join("\n") + "\n"),
      content.replace(" end 000001 ", " end 000002 "),
      content.replace(/\/\* semantifold:ordered-expression:cpp:v1 end [^\n]+/u, ""),
      content.replace(firstDeclaration, ""), content.replace(firstDeclaration, firstDeclaration + firstDeclaration),
      content.replace(firstDeclaration, firstDeclaration.replace("std::int64_t", "const std::int64_t")),
      content.replaceAll("semantifold_ordered_000001", "semantifold_ordered_000002"),
      content.replace(firstDeclaration, firstDeclaration.replace("std::int64_t", "bool")),
      content.replace(firstDeclaration, firstDeclaration.replace(/= .+;/u, "= true;")),
      content.replace(firstDeclaration, firstDeclaration.replace(/= .+;/u, "= unknownName;")),
      content.replace("semantifold_integer_add", "semantifold_integer_subtract"),
      content.replace("semantifold_print_integer", "semantifold_print_boolean"),
      content.replace("    return 0;", "    semantifold_print_integer(semantifold_ordered_000001);\n    return 0;"),
      content.replace(firstDeclaration, firstDeclaration + "    semantifold_ordered_000001 = std::int64_t(4);\n"),
      content.replace("(void)left;", "(void)right;"),
      content.replace("(void)left;", "(void)mark(std::string(\"side-effect\", 11), std::int64_t(1));"),
      content.replace("int main()", "static std::int64_t injected = std::int64_t(0);\nint main()"),
      content.replace("    return 0;", "    semantifold_print_boolean(true);\n    return 0;"),
      content.replace("std::int64_t mark(std::string label, std::int64_t value);", "bool mark(std::string label, std::int64_t value);"),
      content.replace("if (semantifold_ordered_", "if (!semantifold_ordered_"),
      content.replace(/begin 000001 [0-9a-f]{64}/u, "begin 000001 " + "0".repeat(64))
    ]

    for (const invalid of corruptions) {
      assert.notEqual(invalid, content, "each corruption changes the generated tree")
      assert.throws(() => read(invalid), (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_SYNTAX" && error.language == "cpp" && Boolean(error.location))
    }
  })
})
