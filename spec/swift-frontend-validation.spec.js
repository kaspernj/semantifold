// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, languageCapabilities, parse, SemantifoldDiagnostic, supportedLanguages} from "../index.js"
import {parseSwift} from "../src/frontends/swift.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const read = (source) => parseSwift({filename: "program.swift", source})
const functionProgram = (body = "return left", signature = "func choose(_ left: Int64, _ right: Int64) -> Int64") =>
  `${signature} {\n  ${body}\n}\n\nprint(choose(1, 2))\n`
const rejected = (error) => error instanceof SemantifoldDiagnostic && error.language == "swift" &&
  ["MISSING_TYPE", "PARSE_ERROR", "UNSUPPORTED_SYNTAX"].includes(error.code) && error.location?.filename == "program.swift"

describe("Swift strict source profile", () => {
  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/"]) {
    it("adapts the complete " + (directory || "base") + " profile to the original semantics", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.swift`, import.meta.url), "utf8")
      const original = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")

      expect(meaning(parse({filename: "program.swift", language: "swift", source})))
        .toEqual(meaning(parse({filename: "program.ts", language: "typescript", source: original})))
    })
  }

  it("registers the truthful mapped round-trip source and text-backend roles", async () => {
    const source = await readFile(new URL("fixtures/program.swift", import.meta.url), "utf8")
    const module = parse({filename: "program.swift", language: "swift", source})
    const descriptor = languageCapabilities.find(({id}) => id == "swift")

    expect(supportedLanguages.includes("swift")).toBeTrue()
    expect(descriptor).toMatchObject({
      acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["swiftc"]},
      artifactMultiplicity: "single",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
      roundTrip: true
    })
    expect(typeof generate({language: "swift", module})).toEqual("string")
  })

  it("preserves Unicode identifiers, scalar escapes, and parser-owned UTF-16 ranges", () => {
    const source = "// 😀\r\nfunc auswählen(_ links: String, _ rechts: String) -> String {\r\n" +
      String.raw`  return "é😀\0\n\r\t\\\"\u{1f600}"` + "\r\n}\r\n\r\nprint(auswählen(\"a\", \"b\"))\r\n"
    const module = read(source)
    const returned = module.functions[0].body.statements[0]

    expect(module.functions[0].name).toEqual("auswählen")
    expect(module.functions[0].location.start).toEqual({column: 1, line: 2, offset: 7})
    assert.equal(returned.kind, "ReturnStatement")
    if (returned.kind == "ReturnStatement") expect(returned.expression.value).toEqual("é😀\0\n\r\t\\\"😀")
  })

  it("accepts only Swift backend-representable caller identifiers", () => {
    const ordinary = functionProgram().replaceAll("choose", "ordinary")
    const generated = generate({language: "swift", module: read(ordinary)})

    expect(meaning(read(generated))).toEqual(meaning(read(ordinary)))
    for (const name of ["semantifold_owned", "e\u0301", "actor", "async", "some", "any", "borrowing"]) {
      const source = functionProgram().replaceAll("choose", name)

      assert.throws(() => read(source), (error) => rejected(error) && error.code == "UNSUPPORTED_SYNTAX", name)
    }
  })

  it("normalizes the qualified grammar's trailing direct-call additive shape", () => {
    const swift = String.raw`func piece(_ left: String, _ right: String) -> String {
  return left + right
}

print(piece("left", "é\0") + piece("right", "😀"))
`
    const typescript = String.raw`function piece(left: string, right: string): string {
  return left + right
}

console.log(piece("left", "é\u0000") + piece("right", "😀"))
`

    expect(meaning(read(swift))).toEqual(meaning(parse({filename: "program.ts", language: "typescript", source: typescript})))
  })

  it("rejects ordinary Swift String equality while retaining integer and Boolean equality", () => {
    for (const operator of ["==", "!="]) {
      const source = `func same(_ left: String, _ right: String) -> Bool {\n  return left ${operator} right\n}\n\nprint(same("é", "e\\u{301}"))\n`

      assert.throws(() => read(source), (error) => rejected(error) && error.code == "UNSUPPORTED_SYNTAX" &&
        source.slice(error.location.start.offset, error.location.end.offset) == operator, operator)
    }
    read(functionProgram("return left == right", "func choose(_ left: Int64, _ right: Int64) -> Bool"))
    read(functionProgram("return left != right", "func choose(_ left: Bool, _ right: Bool) -> Bool").replace("choose(1, 2)", "choose(true, false)"))
  })

  it("requires explicit Int64, Bool, and String annotations", () => {
    for (const [source, code] of [
      [functionProgram("return left", "func choose(_ left: Int64, _ right: Int64)"), "MISSING_TYPE"],
      [functionProgram("return left", "func choose(_ left, _ right: Int64) -> Int64"), "PARSE_ERROR"],
      [functionProgram("let value = left\n  return value"), "MISSING_TYPE"]
    ]) {
      assert.throws(() => read(source), (error) => rejected(error) && error.code == code, source)
    }
    for (const type of ["Int", "UInt64", "Int64?", "Int64!", "(Int64, Int64)", "[Int64]", "UnsafePointer<Int64>", "Any"]) {
      assert.throws(() => read(functionProgram("return left", `func choose(_ left: ${type}, _ right: Int64) -> Int64`)), rejected, type)
    }
  })

  it("preserves let/var intent, assignment, nested branches, one-armed branches, and fallthrough", async () => {
    const source = await readFile(new URL("fixtures/statements/program.swift", import.meta.url), "utf8")
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
    assert.throws(() => read(functionProgram("let value: Int64 = left\n  value = right\n  return value")),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "IMMUTABLE_ASSIGNMENT")
  })

  it("rejects excluded declarations, effects, type features, APIs, and operators", () => {
    const declarations = [
      "import Foundation", "import UIKit", "import SwiftUI", "struct Value {}", "enum Value {}", "class Value {}", "actor Value {}",
      "protocol Value {}", "extension Int64 {}",
      "typealias Value = Int64", "let global: Int64 = 1", "@available(*, deprecated)", "#if os(Linux)\n#endif",
      "#sourceLocation(file: \"other.swift\", line: 10)", "prefix operator +++",
      "macro value() = #externalMacro(module: \"M\", type: \"T\")"
    ]

    for (const declaration of declarations) {
      assert.throws(() => read(declaration + "\n" + functionProgram()), rejected, declaration)
    }
    for (const signature of [
      "func choose<T>(_ left: T, _ right: T) -> T", "func choose(_ left: Int64, _ right: Int64) async -> Int64",
      "func choose(_ left: Int64, _ right: Int64) throws -> Int64", "@MainActor func choose(_ left: Int64, _ right: Int64) -> Int64",
      "@objc func choose(_ left: Int64, _ right: Int64) -> Int64",
      "@resultBuilder func choose(_ left: Int64, _ right: Int64) -> Int64"
    ]) assert.throws(() => read(functionProgram("return left", signature)), rejected, signature)
    for (const body of [
      "return left &+ right", "return left &- right", "return left &* right", "return left / right", "return left % right",
      "return left << right", "return Int64(left)", "return unsafeBitCast(left, to: Int64.self)", "return left == nil ? right : left",
      "let pair: (Int64, Int64) = (left, right)\n  return pair.0", "let values: [Int64] = [left, right]\n  return values[0]",
      "let closure: (Int64) -> Int64 = { value in value }\n  return closure(left)", "for value in [left] { print(value) }\n  return right",
      "while true { return left }\n  return right", "switch left { case right: return left; default: return right }",
      "do { return left } catch { return right }", "defer { print(left) }\n  return right", "return left +++ right",
      "@Wrapper var value: Int64 = left\n  return value", "let mirror: Mirror = Mirror(reflecting: left)\n  return right"
    ]) assert.throws(() => read(functionProgram(body)), rejected, body)
    assert.throws(() => read(functionProgram('return "value \\(left)"',
      "func choose(_ left: Int64, _ right: Int64) -> String")), rejected)
  })

  it("rejects noncanonical calls, labels, scaffolding, and top-level declarations after entry code", () => {
    const valid = functionProgram()

    for (const source of [
      valid.replace("choose(1, 2)", "choose(left: 1, right: 2)"),
      valid.replace("print(choose(1, 2))", "Swift.print(choose(1, 2))"),
      valid.replace("print(choose(1, 2))", "debugPrint(choose(1, 2))"),
      valid.replace("print(choose(1, 2))", "print(choose(1, 2), terminator: \"\")"),
      valid.replace("func choose", "private func choose"),
      valid + "func later(_ left: Int64, _ right: Int64) -> Int64 { return left }\n"
    ]) assert.throws(() => read(source), rejected, source)
  })

  it("fails closed on parser recovery, lone surrogates, comments used as directives, and unsafe literals", () => {
    for (const source of [
      functionProgram("return left +"), functionProgram().slice(0, -2), "\ud800", functionProgram('return "missing'),
      "#!/usr/bin/swift\n" + functionProgram(), "// swift-tools-version: 6.3\n" + functionProgram()
    ]) assert.throws(() => read(source), rejected, source)
    for (const literal of ["01", "0x1", "1_000", "9007199254740992", "1.0"]) {
      assert.throws(() => read(functionProgram(`return ${literal}`)), rejected, literal)
    }
  })

  it("locates recovery and unmodeled operator children at parser-converted spans", () => {
    const overflow = functionProgram("return left &+ right")

    assert.throws(() => read(overflow), (error) => rejected(error) && error.code == "UNSUPPORTED_SYNTAX" &&
      overflow.slice(error.location.start.offset, error.location.end.offset) == "&+")
    const recovered = functionProgram("return left +")

    assert.throws(() => read(recovered), (error) => rejected(error) && error.code == "PARSE_ERROR" &&
      recovered.slice(error.location.start.offset, error.location.end.offset) == "+")
  })
})
