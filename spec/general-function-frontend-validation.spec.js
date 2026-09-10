// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

function expectDiagnostic(language, source, codes = ["UNSUPPORTED_SYNTAX"]) {
  assert.throws(
    () => parse({filename: `excluded.${language}`, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && codes.includes(error.code) &&
      error.language == language && Boolean(error.location)
  )
}

const rubyFunction = (parameters, comments = "# @param value [Integer]") => `${comments}
# @return [Integer]
def choose(${parameters})
  return 1
end
puts choose(1)
`

const jsFunction = (parameter, replacement = "return value", prefix = "") => `/**
 * @param {number} value
 * @returns {number}
 */
${prefix}function choose(${parameter}) {
  ${replacement}
}
console.log(choose(1))
`

const tsProgram = (declaration, call = "console.log(choose(1))") => `${declaration}
${call}
`

const phpProgram = (declaration, call = "echo choose(1), PHP_EOL;") => `<?php
declare(strict_types=1);
${declaration}
${call}
`

const javaProgram = (members, entry = "System.out.println(choose(1));") => `public final class Main {
${members}
  public static void main(String[] args) {
    ${entry}
  }
}
`

describe("general function frontend exclusions", () => {
  it("rejects a block attached to Ruby puts at the unmodeled call subtree", () => {
    const source = `# @return [void]
def ping()
  return
end
puts("x") { ping() }
`

    assert.throws(
      () => parse({filename: "blocked.rb", language: "ruby", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
        error.language == "ruby" && error.location?.filename == "blocked.rb" &&
        error.location.start.offset >= source.indexOf("{")
    )
  })

  it("rejects every excluded Ruby parameter, receiver, dispatch, block, and return form", () => {
    const cases = [
      rubyFunction("value = 1"),
      rubyFunction("*value"),
      rubyFunction("*values, value", "# @param values [Integer]\n# @param value [Integer]"),
      rubyFunction("value:"),
      rubyFunction("**value"),
      rubyFunction("&value"),
      `# @param value [Integer]\n# @return [Integer]\ndef choose(value)\n  return value\nend\nobject.choose(1)\n`,
      `# @param value [Integer]\n# @return [Integer]\ndef choose(value)\n  return value\nend\nsend(:choose, 1)\n`,
      `# @param value [Integer]\n# @return [Integer]\ndef choose(value)\n  value\nend\nputs choose(1)\n`,
      `# @param value [Integer]\n# @return [Integer]\ndef choose(value)\n  return value\nend\nchoose(1) {}\n`,
      `# @param value [Integer]\n# @return [Integer]\ndef self.choose(value)\n  return value\nend\nputs choose(1)\n`
    ]

    for (const source of cases) expectDiagnostic("ruby", source)
  })

  it("rejects every excluded JavaScript/JSDoc function and call form and missing annotations", () => {
    const cases = [
      `const choose = (value) => value\nconsole.log(choose(1))\n`,
      `const choose = function (value) { return value }\nconsole.log(choose(1))\n`,
      jsFunction("value = 1"),
      jsFunction("...value"),
      jsFunction("{value}"),
      jsFunction("value", "return value", "async "),
      jsFunction("value", "return value", "function* ignored() {}\n"),
      jsFunction("value", "return value").replace("choose(1)", "choose?.(1)"),
      jsFunction("value", "return value").replace("choose(1)", "holder.choose(1)"),
      jsFunction("value", "return value").replace("choose(1)", "choose(...[1])"),
      jsFunction("value", "return value").replace("console.log(choose(1))", "new choose(1)"),
      `const holder = { choose(value) { return value } }\nconsole.log(holder.choose(1))\n`,
      jsFunction("value", "return value").replace("choose(1)", "factory()(1)"),
      `/** @returns {number} */\nfunction choose(value) { return value }\nconsole.log(choose(1))\n`,
      `/** @param {number} value */\nfunction choose(value) { return value }\nconsole.log(choose(1))\n`
    ]

    for (const source of cases) expectDiagnostic("javascript", source, ["UNSUPPORTED_SYNTAX", "MISSING_TYPE"])
  })

  it("rejects every excluded TypeScript signature and call form", () => {
    const cases = [
      tsProgram("function choose(value?: number): number { return 1 }"),
      tsProgram("function choose(value: number = 1): number { return value }"),
      tsProgram("function choose(...value: number[]): number { return 1 }"),
      tsProgram("function choose(value: number): number;\nfunction choose(value: number): number { return value }"),
      tsProgram("function choose<T>(value: number): number { return value }"),
      tsProgram("class Holder { choose(value: number): number { return value } }", ""),
      tsProgram("function choose(callback: (value: number) => number): number { return callback(1) }", "console.log(choose((value) => value))"),
      tsProgram("function choose(value: number) { return value }"),
      tsProgram("function choose(value: number): number { return value }", "console.log(choose(...[1]))"),
      tsProgram("function choose(value: number): number { return value }", "console.log(choose(1 as number))"),
      tsProgram("function choose(value: number | void): number { return 1 }"),
      tsProgram("function choose(value: void[]): number { return 1 }"),
      tsProgram("function choose(value: number): number { return value }", "console.log(holder.choose(1))"),
      tsProgram("function choose(value: number): number { return value }", "console.log(factory()(1))")
    ]

    for (const source of cases) expectDiagnostic("typescript", source, ["UNSUPPORTED_SYNTAX", "MISSING_TYPE"])
  })

  it("rejects every excluded PHP parameter, argument, return, method, call, and missing-type form", () => {
    const cases = [
      phpProgram("function choose(int $value = 1): int { return $value; }"),
      phpProgram("function choose(int ...$value): int { return 1; }"),
      phpProgram("function choose(int $value): int { return $value; }", "echo choose(value: 1), PHP_EOL;"),
      phpProgram("function choose(int $value): int { return $value; }", "echo choose(...[1]), PHP_EOL;"),
      phpProgram("function choose(int &$value): int { return $value; }"),
      phpProgram("function choose(int $value): int { return $value; }", "/** @var int $value */\n$value = 1;\necho choose(&$value), PHP_EOL;"),
      phpProgram("function &choose(int $value): int { return $value; }"),
      phpProgram("class Holder { public static function choose(int $value): int { return $value; } }", ""),
      phpProgram("function choose(int $value): int { return $value; }", "$callable = 'choose'; echo $callable(1), PHP_EOL;"),
      phpProgram("function choose(int $value): int { return $value; }", "echo \\choose(1), PHP_EOL;"),
      phpProgram("function choose($value): int { return $value; }"),
      phpProgram("function choose(int $value) { return $value; }")
    ]

    for (const source of cases) expectDiagnostic("php", source, ["UNSUPPORTED_SYNTAX", "MISSING_TYPE", "PARSE_ERROR"])
  })

  it("rejects every excluded Java overload, instance, receiver, qualification, varargs, generic, constructor, and throws form", () => {
    const method = "  private static int choose(int value) { return value; }"
    const cases = [
      javaProgram(`${method}\n  private static int choose(String value) { return 1; }`),
      javaProgram("  private int choose(int value) { return value; }"),
      javaProgram(method, "System.out.println(new Main().choose(1));"),
      javaProgram(method, "System.out.println(Main.choose(1));"),
      `import static java.lang.Math.abs;\n${javaProgram(method)}`,
      javaProgram("  private static int choose(int... value) { return 1; }"),
      javaProgram("  private static <T> int choose(int value) { return value; }"),
      javaProgram("  private Main() {}\n" + method),
      javaProgram("  private static int choose(int value) throws Exception { return value; }")
    ]

    for (const source of cases) expectDiagnostic("java", source, ["UNSUPPORTED_SYNTAX", "DUPLICATE_BINDING"])
  })
})
