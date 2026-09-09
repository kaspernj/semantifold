// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, languageCapabilities, parse, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const read = (source) => parse({filename: "Program.kt", language: "kotlin", source})
const functionProgram = (body = "return left", signature = "fun choose(left: Long, right: Long): Long") =>
  `${signature} {\n  ${body}\n}\n\nfun main() {\n  println(choose(1, 2))\n}\n`
const rejected = (error) => error instanceof SemantifoldDiagnostic && error.language == "kotlin" &&
  ["MISSING_TYPE", "PARSE_ERROR", "UNSUPPORTED_SYNTAX"].includes(error.code) && error.location?.filename == "Program.kt"

describe("Kotlin strict source profile", () => {
  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/"]) {
    it("adapts the complete " + (directory || "base") + " profile to the original semantics", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.kt`, import.meta.url), "utf8")
      const original = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")

      expect(meaning(parse({filename: "Program.kt", language: "kotlin", source})))
        .toEqual(meaning(parse({filename: "program.ts", language: "typescript", source: original})))
    })
  }

  it("registers the truthful mapped round-trip source and text-backend roles", async () => {
    const source = await readFile(new URL("fixtures/program.kt", import.meta.url), "utf8")
    const module = parse({filename: "Program.kt", language: "kotlin", source})
    const descriptor = languageCapabilities.find(({id}) => id == "kotlin")

    expect(supportedLanguages.includes("kotlin")).toBeTrue()
    expect(descriptor).toMatchObject({
      acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["kotlinc", "java25"]},
      artifactMultiplicity: "single",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
      roundTrip: true
    })
    expect(typeof generate({language: "kotlin", module})).toEqual("string")
  })

  it("preserves Unicode identifiers, escapes, and parser-owned UTF-16 ranges", () => {
    const source = "// 😀\r\nfun auswählen(links: String, rechts: String): String {\r\n" +
      String.raw`  return "é😀\u0000\n\r\t\\\""` + "\r\n}\r\n\r\nfun main() {\r\n  println(auswählen(\"a\", \"b\"))\r\n}\r\n"
    const module = read(source)
    const returned = module.functions[0].body.statements[0]

    expect(module.functions[0].name).toEqual("auswählen")
    expect(module.functions[0].location.start).toEqual({column: 1, line: 2, offset: 7})
    assert.equal(returned.kind, "ReturnStatement")
    if (returned.kind == "ReturnStatement") expect(returned.expression.value).toEqual("é😀\0\n\r\t\\\"")
  })

  it("requires explicit Long, Boolean, and String annotations", () => {
    for (const [source, code] of [
      [functionProgram("return left", "fun choose(left: Long, right: Long)"), "MISSING_TYPE"],
      [functionProgram("return left", "fun choose(left, right: Long): Long"), "PARSE_ERROR"],
      [functionProgram("val value = left\n  return value"), "MISSING_TYPE"]
    ]) assert.throws(() => read(source), (error) => rejected(error) && error.code == code, source)
    for (const type of ["Int", "ULong", "Long?", "Long!", "Pair<Long, Long>", "Array<Long>", "Any"]) {
      assert.throws(() => read(functionProgram("return left", `fun choose(left: ${type}, right: Long): Long`)), rejected, type)
    }
  })

  it("preserves val/var intent, assignment, nested branches, one-armed branches, and fallthrough", async () => {
    const source = await readFile(new URL("fixtures/statements/program.kt", import.meta.url), "utf8")
    const module = read(source)
    const local = module.functions[0].body.statements[0]
    const entryLocal = module.entryPoint.body.statements[0]

    assert.equal(local.kind, "LocalDeclaration")
    assert.equal(entryLocal.kind, "LocalDeclaration")
    if (local.kind == "LocalDeclaration" && entryLocal.kind == "LocalDeclaration") {
      expect(local.mutable).toBeTrue()
      expect(entryLocal.mutable).toBeTrue()
    }
    expect(module.entryPoint.body.statements[2].kind).toEqual("IfStatement")
    assert.throws(() => read(functionProgram("val value: Long = left\n  value = right\n  return value")),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "IMMUTABLE_ASSIGNMENT")
  })

  it("rejects excluded declarations, effects, type features, APIs, and operators", () => {
    const declarations = [
      "package sample", "import java.io.File", "class Value", "interface Value", "object Value", "data class Value(val item: Long)",
      "typealias Value = Long", "val global: Long = 1", "@file:JvmName(\"Other\")", "enum class Value { ONE }"
    ]

    for (const declaration of declarations) assert.throws(() => read(declaration + "\n" + functionProgram()), rejected, declaration)
    for (const signature of [
      "fun <T> choose(left: T, right: T): T", "suspend fun choose(left: Long, right: Long): Long",
      "inline fun choose(left: Long, right: Long): Long", "operator fun choose(left: Long, right: Long): Long",
      "fun Long.choose(left: Long, right: Long): Long"
    ]) assert.throws(() => read(functionProgram("return left", signature)), rejected, signature)
    for (const body of [
      "return left / right", "return left % right", "return left shl right.toInt()", "return left ?: right", "return left!!",
      "return left as Long", "return left is Long", "return if (left == right) left else right",
      "val pair: Pair<Long, Long> = Pair(left, right)\n  return pair.first", "val values: Array<Long> = arrayOf(left)\n  return values[0]",
      "val closure: (Long) -> Long = { it }\n  return closure(left)", "for (value in listOf(left)) { println(value) }\n  return right",
      "while (true) { return left }\n  return right", "when (left) { right -> return left; else -> return right }",
      "try { return left } catch (error: Exception) { return right }", "throw IllegalStateException()", "return left?.plus(right)"
    ]) assert.throws(() => read(functionProgram(body)), rejected, body)
    assert.throws(() => read(functionProgram('return "value $left"',
      "fun choose(left: Long, right: Long): String")), rejected)
  })

  it("rejects noncanonical calls, modifiers, scaffolding, and declarations after main", () => {
    const valid = functionProgram()

    for (const source of [
      valid.replace("choose(1, 2)", "choose(left = 1, right = 2)"),
      valid.replace("println(choose(1, 2))", "kotlin.io.println(choose(1, 2))"),
      valid.replace("println(choose(1, 2))", "print(choose(1, 2))"),
      valid.replace("fun choose", "private fun choose"),
      valid + "fun later(left: Long, right: Long): Long { return left }\n"
    ]) assert.throws(() => read(source), rejected, source)
  })

  it("authorizes checked helpers only through the complete canonical runtime CST", () => {
    const generated = generate({language: "kotlin", module: read(functionProgram("return left + right"))})

    for (const source of [
      generated.replace("9007199254740991L", "9007199254740990L"),
      generated.slice(generated.indexOf("private fun semantifold_integer_add"))
    ]) assert.throws(() => read(source), rejected, source)
  })

  it("fails closed on parser recovery, lone surrogates, comments used as directives, and unsafe literals", () => {
    for (const source of [
      functionProgram("return left +"), functionProgram().slice(0, -2), "\ud800", functionProgram('return "missing'),
      "#!/usr/bin/env kotlin\n" + functionProgram(), "// language-version: 2.4\n" + functionProgram()
    ]) assert.throws(() => read(source), rejected, source)
    for (const literal of ["01", "0x1", "1_000", "9007199254740992", "1.0", "1u", "1UL"]) {
      assert.throws(() => read(functionProgram(`return ${literal}`)), rejected, literal)
    }
  })

  it("locates recovery and unmodeled operator children at parser-converted spans", () => {
    const division = functionProgram("return left / right")

    assert.throws(() => read(division), (error) => rejected(error) && error.code == "UNSUPPORTED_SYNTAX" &&
      division.slice(error.location.start.offset, error.location.end.offset) == "/")
    const recovered = functionProgram("return left +")

    assert.throws(() => read(recovered), (error) => rejected(error) && error.code == "PARSE_ERROR")
  })
})
