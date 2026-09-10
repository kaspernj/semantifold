// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

function rejected(language, filename, source) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && [
      "DUPLICATE_MAP_KEY", "INVALID_MAP_KEY", "MISSING_MAP_KEY", "MISSING_TYPE", "TYPE_MISMATCH",
      "UNCHECKED_COLLECTION_ACCESS", "UNSUPPORTED_SYNTAX"
    ].includes(error.code)
  )
}

describe("immutable collection frontend validation", () => {
  it("rejects sparse, spread, object, mutable-type, mutation, and unchecked JavaScript-family profiles", () => {
    const prefix = "function identity(value: number): number { return value }\n"

    for (const source of [
      "const xs: readonly number[] = [1, , 2]\n",
      "const base: readonly number[] = [1]\nconst xs: readonly number[] = [...base]\n",
      "const m: ReadonlyMap<string, number> = {a: 1}\n",
      "const xs: number[] = [1]\n",
      "const xs: readonly number[] = [1]\nxs.push(2)\n",
      "function read(m: ReadonlyMap<string, number>, key: string): number { return m.get(key) }\n"
    ]) rejected("typescript", "invalid.ts", `${prefix}${source}`)

    const jsPrefix = "/**\n * @param {number} value\n * @returns {number}\n */\nfunction identity(value) { return value }\n"

    rejected("javascript", "invalid.js", `${jsPrefix}/** @type {ReadonlyMap<string, number>} */ const m = {a: 1}\n`)
    rejected("javascript", "invalid.js", `${jsPrefix}/** @type {ReadonlyArray<number>} */ const xs = [1]\nconsole.log(xs.size)\n`)
    rejected("javascript", "invalid.js", `${jsPrefix}/** @type {ReadonlyMap<string, number>} */ const m = new Map([["a", 1]])\nconsole.log(m.length)\n`)
  })

  it("rejects Ruby splats, non-string keys, mutation, missing metadata, and ambiguous map brackets", () => {
    const prefix = "# @param value [Integer]\n# @return [Integer]\ndef identity(value)\n  return value\nend\n"

    for (const source of [
      "# @type [Array[Integer]]\nxs = [1, *[2]]\n",
      "# @type [Hash[String,Integer]]\nm = {:answer => 1}\n",
      "# @type [Array[Integer]]\nxs = [1]\nxs << 2\n",
      "xs = [1]\n",
      "# @type [Hash[String,Integer]]\nm = {\"a\" => 1}\nputs m[\"a\"]\n"
    ]) rejected("ruby", "invalid.rb", `${prefix}${source}`)
  })

  it("rejects PHP mixed/coercive/duplicate/raw arrays, mutation, and unchecked absence", () => {
    const prefix = "<?php\ndeclare(strict_types=1);\nfunction identity(int $value): int { return $value; }\n"

    for (const source of [
      "/** @var array<string,int> $m */\n$m = [\"a\" => 1, 2];\n",
      "/** @var array<string,int> $m */\n$m = [\"12\" => 1];\n",
      "/** @var array<string,int> $m */\n$m = [\"a\" => 1, \"a\" => 2];\n",
      "/** @var array $m */\n$m = [];\n",
      "/** @var list<int> $xs */\n$xs = [1];\n$xs[] = 2;\n",
      "/** @var array<string,int> $m */\n$m = [\"a\" => 1];\necho $m[\"missing\"], PHP_EOL;\n"
    ]) rejected("php", "invalid.php", `${prefix}${source}`)
  })

  it("rejects Java arrays, raw collections, null factory members, mutation, duplicates, and unchecked map reads", () => {
    const wrap = (body) => `public final class Main {\n  private static int identity(int value) { return value; }\n  public static void main(String[] args) {\n${body}\n  }\n}\n`

    for (const body of [
      "    final int[] xs = new int[]{1};",
      "    final java.util.List xs = java.util.List.of(1);",
      "    final java.util.List<String> xs = java.util.List.of(null);",
      "    final java.util.List<Integer> xs = java.util.List.of(1);\n    xs.add(2);",
      "    final java.util.Map<String,Integer> m = java.util.Map.of(\"a\", 1, \"a\", 2);",
      `    final java.util.Map<String,Integer> m = java.util.Map.of(${
        Array.from({length: 11}, (_, index) => `"key${index}", ${index}`).join(", ")
      });`,
      "    final java.util.Map<String,Integer> m = java.util.Map.of(\"a\", 1);\n    System.out.println(m.get(\"missing\"));"
    ]) rejected("java", "Main.java", wrap(body))

    expect(wrap("")).toContain("public static void main")
  })
})
