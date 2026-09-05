// @ts-check

import {readFile} from "node:fs/promises"
import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {parseGo} from "../src/frontends/go.js"

const withoutMetadata = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

/** @param {string} source @param {string} code */
function expectDiagnostic(source, code) {
  assert.throws(() => parseGo({filename: "main.go", source}), (error) =>
    Boolean(error instanceof SemantifoldDiagnostic && error.code == code && error.language == "go" && error.location), source)
}

/** @param {string} member @param {string} [main] */
function program(member, main = "fmt.Println(value(1, 2))") {
  return "package main\n\n" + (main.includes("fmt.Println") ? 'import "fmt"\n\n' : "") + member +
    "\n\nfunc main() {\n\t" + main + "\n}\n"
}

describe("Go frontend validation", () => {
  it("normalizes the canonical Go fixture to the shared Tasks 001-004 meaning", async () => {
    const [go, typescript] = await Promise.all([
      readFile(new URL("fixtures/program.go", import.meta.url), "utf8"),
      readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    ])
    const actual = parseGo({filename: "main.go", source: go})
    const expected = parse({filename: "program.ts", language: "typescript", source: typescript})

    expect(withoutMetadata(actual)).toEqual(withoutMetadata(expected))
  })

  it("requires the exact package/import/final-main compilation-unit scaffold", () => {
    const valid = `package main

import "fmt"

func value(left int64, right int64) int64 {
	return left
}

func main() {
	fmt.Println(value(1, 2))
}
`

    expect(parseGo({filename: "main.go", source: valid}).functions[0].name).toEqual("value")
    for (const source of [
      valid.replace("package main", "package other"),
      valid.replace('import "fmt"\n\n', ""),
      valid.replace('import "fmt"', 'import "os"'),
      valid.replace('import "fmt"', 'import (\n\t"fmt"\n)'),
      valid.replace("func main()", "func main(value int64)"),
      valid.replace("func main()", "func main() int64"),
      valid.replace("func main() {", "func init() {"),
      valid.replace("func main() {", "func main() {\n}\n\nfunc later() {")
    ]) {
      assert.throws(() => parseGo({filename: "main.go", source}), (error) =>
        Boolean(error instanceof SemantifoldDiagnostic && error.language == "go" && error.location))
    }
  })

  it("reports parser recovery, lone surrogates, and absent explicit types", () => {
    const sources = [
      ["package main\nfunc main( {\n", "PARSE_ERROR"],
      ["package main\n// \uD800\nfunc main() {}\n", "PARSE_ERROR"],
      ["package main\nfunc value(left int64, right int64) {\n\treturn left\n}\nfunc main() {}\n", "MISSING_TYPE"],
      ["package main\nfunc value(left int64, right int64) int64 {\n\tvar result = left\n\treturn result\n}\nfunc main() {}\n", "MISSING_TYPE"]
    ]

    for (const [source, code] of sources) {
      assert.throws(() => parseGo({filename: "main.go", source}), (error) =>
        Boolean(error instanceof SemantifoldDiagnostic && error.code == code && error.language == "go" && error.location))
    }
  })

  it("normalizes all five Tasks 001-004 profiles with parser-owned ranges", async () => {
    let sawOperatorRange = false

    for (const fixture of ["program.go", "scalars/program.go", "locals/program.go", "operators/program.go", "statements/program.go"]) {
      const [go, rawTypeScript] = await Promise.all([
        readFile(new URL("fixtures/" + fixture, import.meta.url), "utf8"),
        readFile(new URL("fixtures/" + fixture.replace(/program\.go$/u, "program.ts"), import.meta.url), "utf8")
      ])
      const typescript = ["locals/program.go", "statements/program.go"].includes(fixture)
        ? rawTypeScript.replaceAll("select", "choose")
        : rawTypeScript
      const actual = parseGo({filename: "main.go", source: go})
      const expected = parse({filename: "program.ts", language: "typescript", source: typescript})

      expect(withoutMetadata(actual)).toEqual(withoutMetadata(expected))
      sawOperatorRange ||= JSON.stringify(actual).includes('"operation"')
    }
    expect(sawOperatorRange).toBeTrue()
  })

  it("decodes strings and derives local mutability from assignments and the immutable carrier", async () => {
    const nulEscape = "\\" + "x00"
    const emojiEscape = ["xF0", "x9F", "x98", "x80"].map((value) => "\\" + value).join("")
    const escaped = program("func value(left int64, right int64) string {\n" +
      '\tvar nul string = "' + nulEscape + '"\n\tif left == right {\n\t\treturn nul\n\t} else {\n' +
      '\t\treturn "' + emojiEscape + '"\n\t}\n}')
    const module = parseGo({filename: "main.go", source: escaped})

    expect(module.functions[0].body.statements[0]).toMatchObject({mutable: false, name: "nul"})
    expect(module.functions[0].body.statements[1].alternate?.statements[0].expression.value).toEqual("😀")
    const locals = parseGo({
      filename: "main.go",
      source: await readFile(new URL("fixtures/locals/program.go", import.meta.url), "utf8")
    })

    expect(locals.functions[0].body.statements.slice(0, 2).map(({mutable}) => mutable)).toEqual([false, true])
    expect(locals.entryPoint.body.statements[0].mutable).toBeTrue()
    const immutableWrite = program("func value(left int64, right int64) int64 {\n" +
      "\t// @semantifold-immutable\n\tvar result int64 = left\n\tresult = right\n\treturn result\n}")

    expectDiagnostic(immutableWrite, "IMMUTABLE_ASSIGNMENT")
    expectDiagnostic(program("func value(left int64, right int64) int64 {\n\tleft = right\n\treturn left\n}"),
      "IMMUTABLE_ASSIGNMENT")
    for (const source of [
      immutableWrite.replace("// @semantifold-immutable", "// @semantifold-immutable "),
      immutableWrite.replace("\t// @semantifold-immutable", "// @semantifold-immutable"),
      immutableWrite.replace("// @semantifold-immutable", "/* @semantifold-immutable */"),
      immutableWrite.replace("// @semantifold-immutable\n", "// @semantifold-immutable\n\t// @semantifold-immutable\n")
    ]) expectDiagnostic(source, "UNSUPPORTED_SYNTAX")
  })

  it("accepts typed operators and rejects excluded expression and declaration families", async () => {
    const operators = await readFile(new URL("fixtures/operators/program.go", import.meta.url), "utf8")
    const statements = await readFile(new URL("fixtures/statements/program.go", import.meta.url), "utf8")

    expect(parseGo({filename: "main.go", source: operators}).functions.length).toEqual(5)
    expect(parseGo({filename: "main.go", source: statements}).entryPoint.body.statements.length).toEqual(5)
    const base = program("func value(left int64, right int64) int64 {\n\tvar result int64 = left\n\treturn result\n}")
    const blockLineDirective = "/*line remapped.go:10*/\n" + base

    assert.throws(() => parse({filename: "main.go", language: "go", source: blockLineDirective}), (error) =>
      Boolean(error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
        error.language == "go" && error.location))

    for (const source of [
      "//go:build linux\n" + base,
      "// +build linux\n" + base,
      "//line remapped.go:10\n" + base,
      base.replace("left int64", "left int"),
      base.replace("left int64", "left []int64"),
      base.replace("return result", "return 01"),
      base.replace("return result", "return 0x1"),
      base.replace("return result", "return 9007199254740992"),
      base.replace("return result", "return 1.0"),
      base.replace("return result", "return +left"),
      base.replace("return result", "return left / right"),
      base.replace("return result", "return []int64{left}[0]"),
      base.replace("return result", "return int64(left)"),
      base.replace("return result", "return other.value(left, right)"),
      base.replace("return result", "panic(\"bad\")\n\treturn result"),
      base.replace("return result", "go value(left, right)\n\treturn result"),
      base.replace("return result", "defer value(left, right)\n\treturn result"),
      base.replace("return result", "for left < right { result = right }\n\treturn result"),
      base.replace("return result", "switch left { case right: return left }\n\treturn result"),
      base.replace("var result int64 = left", "result := left"),
      base.replace("var result int64 = left", "var (\n\t\tresult int64 = left\n\t)"),
      base.replace("value(left int64, right int64)", "value(left, right int64)"),
      base.replace("func value", "func init"),
      base.replace("func value", "func fmt"),
      base.replace("left int64", "fmt int64"),
      base.replace("var result", "var string"),
      base.replace('import "fmt"', 'import alias "fmt"'),
      base.replace('import "fmt"', 'import "C"'),
      base.replace("fmt.Println", "fmt.Print"),
      base.replace("fmt.Println(value(1, 2))", "fmt.Println()")
    ]) expectDiagnostic(source, "UNSUPPORTED_SYNTAX")
    expectDiagnostic(base.replace("var result int64 = left", "var result = left"), "MISSING_TYPE")
    expectDiagnostic(program("func value(left string, right string) string {\n\treturn `raw`\n}",
      'fmt.Println(value("a", "b"))'), "UNSUPPORTED_SYNTAX")
    const invalidByte = "\\" + "x80"

    expectDiagnostic(program('func value(left string, right string) string {\n\treturn "' + invalidByte + '"\n}',
      'fmt.Println(value("a", "b"))'), "UNSUPPORTED_SYNTAX")
  })
})
