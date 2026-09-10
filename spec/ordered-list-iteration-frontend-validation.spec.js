// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

function rejected(language, filename, source, token) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && [
      "IMMUTABLE_ASSIGNMENT", "MISSING_TYPE", "TYPE_MISMATCH", "UNSUPPORTED_SYNTAX"
    ].includes(error.code) && (!token || source.slice(error.location.start.offset, error.location.end.offset) == token)
  )
}

describe("ordered list iteration frontend validation", () => {
  it("rejects every excluded JavaScript and TypeScript loop profile at parser-owned locations", () => {
    const prefix = "function identity(value: number): number { return value }\nconst values: readonly number[] = [1]\n"
    const accepted = `${prefix}for (const value of values) {}\n`
    const cases = [
      ["for (let value of values) {}", "let"],
      ["for (var value of values) {}", "var"],
      ["for (const [value] of [[1]]) {}", "[value]"],
      ["for (const value: string of values) {}", "string"],
      ["for (const value in values) {}", "for (const value in values) {}"],
      ["for (let index = 0; index < 1; index = index + 1) {}", "for (let index = 0; index < 1; index = index + 1) {}"],
      ["label: for (const value of values) {}", "label: for (const value of values) {}"],
      ["for (const value of values) console.log(value)", "console.log(value)"],
      ["values.push(2)", "values.push(2)"],
      ["function* valuesGenerator() { return 1 }", "function* valuesGenerator() { return 1 }"]
    ]

    expect(parse({filename: "accepted.ts", language: "typescript", source: accepted}).entryPoint.body.statements.at(-1)?.kind)
      .toEqual("ForEachStatement")
    for (const [body, token] of cases) rejected("typescript", "invalid.ts", `${prefix}${body}\n`, token)
    rejected("typescript", "invalid.ts", `${prefix}for await (const value of values) {}\n`,
      "for await (const value of values) {}")

    const jsPrefix = "/**\n * @param {number} value\n * @returns {number}\n */\nfunction identity(value) { return value }\n/** @type {ReadonlyArray<number>} */ const values = [1]\n"

    rejected("javascript", "invalid.js", `${jsPrefix}for (const {value} of values) {}\n`, "{value}")
    rejected("javascript", "invalid.js", `${jsPrefix}/** @type {ReadonlyMap<string, number>} */ const map = new Map([["a", 1]])\nfor (const value of map) {}\n`, "map")
    rejected("javascript", "invalid.js", `${jsPrefix}for (const value of values.values()) {}\n`, "values.values()")
    expect(cases).toHaveLength(10)
  })

  it("rejects Ruby for/arbitrary-block/hash/arity/control/mutation profiles", () => {
    const prefix = "# @param value [Integer]\n# @return [Integer]\ndef identity(value)\n  return value\nend\n# @type [Array[Integer]]\n# @semantifold-immutable\nvalues = [1]\n"

    for (const source of [
      "for value in values\nend\n",
      "identity(1) do |value|\nend\n",
      "# @type [Hash[String,Integer]]\nmap = {\"a\" => 1}\nmap.each do |value|\nend\n",
      "values.each do |first, second|\nend\n",
      "values.each do |value|\n  return value\nend\n",
      "values.each do |value|\n  redo\nend\n",
      "values.each do |value|\n  begin\n    identity(value)\n  rescue\n    retry\n  end\nend\n",
      "values.each do |value|\n  values << 2\nend\n"
    ]) rejected("ruby", "invalid.rb", `${prefix}${source}`)
  })

  it("rejects PHP key/reference/destructuring/alternate/map/mutation profiles", () => {
    const prefix = "<?php\ndeclare(strict_types=1);\nfunction identity(int $value): int { return $value; }\n/** @var list<int> $values */\n$values = [1];\n"

    for (const source of [
      "foreach ($values as $key => $value) {}\n",
      "foreach ($values as &$value) {}\n",
      "foreach ($values as [$value]) {}\n",
      "foreach ($values as $value): endforeach;\n",
      "/** @var array<string,int> $map */\n$map = [\"a\" => 1];\nforeach ($map as $value) {}\n",
      "foreach ($values as $value) { $values[] = 2; }\n"
    ]) rejected("php", "invalid.php", `${prefix}${source}`)
  })

  it("rejects Java map/array/basic/stream/raw/type/label/mutation profiles", () => {
    const wrap = (declaration, loop) => `public final class Main {\n  private static int identity(int value) { return value; }\n  public static void main(String[] args) {\n    ${declaration}\n    ${loop}\n  }\n}\n`

    for (const [declaration, loop] of [
      ["final java.util.Map<String,Integer> values = java.util.Map.of(\"a\", 1);", "for (java.util.Map.Entry<String,Integer> value : values.entrySet()) {}"],
      ["final int[] values = new int[]{1};", "for (int value : values) {}"],
      ["final java.util.List<Integer> values = java.util.List.of(1);", "for (int index = 0; index < 1; index = index + 1) {}"],
      ["final java.util.List<Integer> values = java.util.List.of(1);", "values.stream().forEach(value -> System.out.println(value));"],
      ["final java.util.List values = java.util.List.of(1);", "for (Integer value : values) {}"],
      ["final java.util.List<Integer> values = java.util.List.of(1);", "for (String value : values) {}"],
      ["final java.util.List<Integer> values = java.util.List.of(1);", "label: for (Integer value : values) {}"],
      ["final java.util.List<Integer> values = java.util.List.of(1);", "for (Integer value : values) { values.add(2); }"]
    ]) rejected("java", "Main.java", wrap(declaration, loop))
  })
})
