// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

function rejected(language, filename, source) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
      error.language == language && error.location?.filename == filename
  )
}

describe("type parameter frontends", () => {
  it("normalizes native and exactly documented original-five generic profiles to equivalent meaning", async () => {
    const meanings = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/generics/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})

      expect(module.records[0].typeParameters).toHaveLength(1)
      expect(module.functions.map(({typeParameters}) => typeParameters?.length)).toEqual([1, 1, 2, 1])
      meanings.push(semanticMeaning(module))
    }

    for (const meaning of meanings.slice(1)) expect(meaning).toEqual(meanings[0])
  })

  it("rejects bounds, defaults, variance, wildcards, casts, and unsupported generic operators at parser-owned locations", () => {
    rejected("typescript", "invalid.ts", "function value<T extends string>(item: T): T { return item }\nconsole.log(value(\"x\"))\n")
    rejected("typescript", "invalid.ts", "class Box<out T> { constructor(readonly value: T) {} }\nconsole.log(1)\n")
    rejected("typescript", "invalid.ts", "function value<T>(item: T): T { return item }\nconsole.log(value(\"x\" as string))\n")
    rejected("java", "Main.java", "public final class Main { private static <T extends String> T value(T item) { return item; } public static void main(String[] args) { System.out.println(value(\"x\")); } }\n")
    rejected("java", "Main.java", "final class Box<T> { private final T value; Box(T value) { this.value = value; } T value() { return this.value; } } public final class Main { private static String value(Box<?> box) { return \"x\"; } public static void main(String[] args) { System.out.println(1); } }\n")
    rejected("javascript", "invalid.js", "/** @template T extends string\n * @param {T} value\n * @returns {T}\n */\nfunction value(value) { return value }\nconsole.log(value(\"x\"))\n")
    rejected("php", "invalid.php", "<?php\n/** @template-covariant T\n * @param T $value\n * @return T\n */\nfunction value($value) { return $value; }\necho value(\"x\"), PHP_EOL;\n")
    rejected("ruby", "invalid.rb", "# @template T = String\n# @param value [T]\n# @return [T]\ndef value(value)\n  return value\nend\nputs value(\"x\")\n")
    rejected("typescript", "invalid.ts", "function keys<T>(value: T): keyof T { return value }\nconsole.log(keys(\"x\"))\n")
    rejected("typescript", "invalid.ts", "function field<T>(value: T): T[\"field\"] { return value }\nconsole.log(field(\"x\"))\n")
    rejected("typescript", "invalid.ts", "function reflect<T>(value: T): string { return typeof value }\nconsole.log(reflect(\"x\"))\n")
  })

  it("rejects missing dynamic-language template declarations and raw Java applications", () => {
    const missing = [
      ["javascript", "invalid.js", "/** @param {T} value\n * @returns {T}\n */\nfunction value(value) { return value }\nconsole.log(value(\"x\"))\n"],
      ["php", "invalid.php", "<?php\n/** @param T $value\n * @return T\n */\nfunction value($value) { return $value; }\necho value(\"x\"), PHP_EOL;\n"],
      ["ruby", "invalid.rb", "# @param value [T]\n# @return [T]\ndef value(value)\n  return value\nend\nputs value(\"x\")\n"]
    ]

    for (const [language, filename, source] of missing) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "MISSING_TYPE" &&
          error.language == language && error.location?.filename == filename
      )
    }
    const rawJava = "final class Box<T> { private final T value; Box(T value) { this.value = value; } T value() { return this.value; } } public final class Main { private static String keep(String value) { return value; } public static void main(String[] args) { final Box box = new Box(\"x\"); System.out.println(keep(\"x\")); } }\n"

    assert.throws(
      () => parse({filename: "Main.java", language: "java", source: rawJava}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "RAW_GENERIC_APPLICATION" &&
        error.language == "java" && error.location?.filename == "Main.java"
    )
  })
})
