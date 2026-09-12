// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

describe("reference class frontends", () => {
  it("normalizes the original-five canonical private reference-class profiles", async () => {
    const meanings = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/reference-classes/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})

      expect(module.classes.map(({fields, methods, name}) => ({
        fields: fields.map((field) => field.name),
        methods: methods.map((method) => method.name),
        name
      }))).toEqual([
        {fields: ["value"], methods: ["add", "next", "current", "combine"], name: "Counter"},
        {fields: ["left", "right"], methods: ["code"], name: "Pair"}
      ])
      meanings.push(semanticMeaning(module))
    }

    for (const meaning of meanings.slice(1)) expect(meaning).toEqual(meanings[0])
  })

  it("rejects inheritance, static methods, host construction, dynamic dispatch, reflection, and reopening", async () => {
    const typescript = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const javascript = await readFile(new URL("fixtures/reference-classes/program.js", import.meta.url), "utf8")
    const php = await readFile(new URL("fixtures/reference-classes/program.php", import.meta.url), "utf8")
    const ruby = await readFile(new URL("fixtures/reference-classes/program.rb", import.meta.url), "utf8")
    const java = await readFile(new URL("fixtures/reference-classes/Main.java", import.meta.url), "utf8")
    const invalid = [
      ["typescript", "program.ts", typescript.replace("class Counter {", "class Counter extends Pair {")],
      ["javascript", "program.js", javascript.replace("  add(delta) {", "  static add(delta) {")],
      ["php", "program.php", php.replace("echo $first->current(), PHP_EOL;", "echo new DateTime(), PHP_EOL;")],
      ["ruby", "program.rb", ruby.replace("alias_value.add(2)", "alias_value.send(:add, 2)")],
      ["java", "Main.java", java.replace("marker.add(10);", "marker.getClass();")],
      ["javascript", "program.js", javascript.replaceAll("this.#value", "this.value")],
      ["javascript", "program.js", javascript.replace("current() {", "toString() {")],
      ["php", "program.php", php.replace("function current(): int", "function __invoke(): int")],
      ["ruby", "program.rb", ruby.replace("def current", "def method_missing")],
      ["java", "Main.java", java.replace("int current()", "int toString()")],
      ["ruby", "program.rb", `${ruby}\nclass Counter\n  # @param value [Integer]\n  def initialize(value)\n    @value = value\n  end\nend\n`]
    ]

    for (const [language, filename, source] of invalid) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
          error.language == language && error.location?.filename == filename
      )
    }
  })

  it("keeps Task 033 outside the Task 010 project import/export profile", () => {
    assert.throws(
      () => parseProgram({
        entryModule: "main",
        sources: [{
          filename: "main.ts",
          id: "main",
          language: "typescript",
          source: `${classSourceForProgram()}\nfunction keep(): number { return 0 }\nconsole.log(keep())\n`
        }]
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
        error.language == "typescript" && error.location?.filename == "main.ts"
    )
  })
})

function classSourceForProgram() {
  return `class Box {
  private value: number
  constructor(value: number) { this.value = value }
  get(): number { return this.value }
}`
}
