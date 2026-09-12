// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, languageCapabilities, parse, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

async function moduleFromFixture() {
  const source = await readFile(new URL("fixtures/generics/program.ts", import.meta.url), "utf8")

  return parse({filename: "program.ts", language: "typescript", source})
}

const rejected = (language) => (error) => error instanceof SemantifoldDiagnostic &&
  error.code == "UNSUPPORTED_CAPABILITY" && error.language == language && error.location?.filename == "program.ts"

describe("type parameter backends", () => {
  it("emits target-native or exact documented generics that reparse without semantic loss", async () => {
    const module = await moduleFromFixture()
    const expected = semanticMeaning(module)

    for (const language of cohort) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "ruby" ? "program.rb" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : "program.php"

      expect(semanticMeaning(parse({filename, language, source: generated}))).toEqual(expected)
      expect(generated).toContain(language == "typescript" || language == "java" ? "<T>" : "@template T")
      assert.doesNotMatch(generated, /\b(?:any|mixed|untyped)\b/u)
      if (language == "java") {
        expect(generated).toContain("class Batch<T>")
        expect(generated).toContain("class Box<T>")
        expect(generated).toContain("Batch<String>")
        assert.doesNotMatch(generated, /\bObject\b|\bBatch\s+[A-Za-z_$]/u)
      }
      if (language == "php") {
        expect(generated).toContain("final class Box")
        expect(generated).toContain("private $value")
        expect(generated).toContain("function value()")
        assert.doesNotMatch(generated, /final readonly class Box|\bobject\b/u)
      }
    }
  })

  it("advertises exactly the original-five cohort and rejects generic IR transactionally elsewhere", async () => {
    const module = await moduleFromFixture()

    expect(languageCapabilities.filter(({features}) => features.typeParametersAndGenerics).map(({id}) => id)).toEqual(cohort)
    for (const language of deferred) {
      const action = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language, module})

      assert.throws(action, rejected(language), language)
    }
  })

  it("validates type-parameter identifiers, collisions, and application shape before emission", async () => {
    const mutations = [
      (module) => { module.functions[0].typeParameters[0].name = "string" },
      (module) => {
        module.functions[0].typeParameters[0].name = "Value"
        module.functions[0].parameters[0].name = "Value"
      },
      (module) => { module.records[0].typeParameters[0].id = "record:0:type:9" },
      (module) => { module.records[0].fields[0].type.elementType.parameterId = "record:9:type:0" },
      (module) => { module.entryPoint.body.statements[0].type.arguments = [] }
    ]

    for (const mutate of mutations) {
      const module = await moduleFromFixture()

      mutate(module)
      assert.throws(() => generate({language: "typescript", module}), rejected("typescript"))
    }
  })

  it("emits valid faithful optional type-variable documentation that reparses recursively", () => {
    const source = `function preserve<T>(value: T | null, values: ReadonlyArray<T | null>): T | null { return value }
console.log("ok")
`
    const module = parse({filename: "program.ts", language: "typescript", source})
    const expected = semanticMeaning(module)

    for (const language of ["php", "ruby", "javascript"]) {
      const generated = generate({language, module})
      const filename = language == "php" ? "program.php" : language == "ruby" ? "program.rb" : "program.js"

      expect(semanticMeaning(parse({filename, language, source: generated}))).toEqual(expected)
      if (language == "php") {
        expect(generated).toContain("@param ?T $value")
        expect(generated).toContain("function preserve($value, array $values)")
        assert.doesNotMatch(generated, /\?array\$value/u)
      }
      if (language == "ruby") expect(generated).toContain("# @param values [Array[T?]]")
      if (language == "javascript") expect(generated).toContain("@param {ReadonlyArray<T|null>} values")
    }
  })

  it("rejects explicit empty generic arguments on non-generic records before any backend emits them", () => {
    const module = parse({
      filename: "plain.ts",
      language: "typescript",
      source: `class Plain { constructor(readonly value: string) {} }
function keep(value: string): string { return value }
const plain: Plain = new Plain("value")
console.log(keep(plain.value))
`
    })
    const local = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])
    const recordType = /** @type {import("../src/semantic/types.js").RecordType} */ (local.type)

    recordType.arguments = []
    for (const language of cohort) {
      assert.throws(
        () => generate({language, module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.location?.filename == "plain.ts"
      )
    }
  })

  it("reparses PHP generic getters whose documented optional wraps a type variable", () => {
    const module = parse({
      filename: "program.ts",
      language: "typescript",
      source: `class MaybeBox<T> { constructor(readonly value: T | null) {} }
function keep(value: string): string { return value }
const box: MaybeBox<string> = new MaybeBox<string>("ok")
const value: string | null = box.value
if (value !== null) { console.log(keep(value)) }
`
    })
    const generated = generate({language: "php", module})

    expect(generated).toContain("* @return ?T")
    expect(generated).toContain("public function value()")
    assert.doesNotMatch(generated, /public function value\(\):/u)
    expect(semanticMeaning(parse({filename: "program.php", language: "php", source: generated})))
      .toEqual(semanticMeaning(module))
    for (const invalid of [
      generated.replace("* @return ?T", "* @return T"),
      generated.replace("public function value()", "public function value(): ?string")
    ]) {
      assert.throws(
        () => parse({filename: "invalid.php", language: "php", source: invalid}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
          error.language == "php" && error.location?.filename == "invalid.php"
      )
    }
  })

  it("emits optional generic-record applications as exact recursively reparsable dynamic documentation", () => {
    const module = parse({
      filename: "program.ts",
      language: "typescript",
      source: `class Box<T> { constructor(readonly value: T) {} }
function preserve<T>(value: Box<T> | null, values: ReadonlyArray<Box<T> | null>, by_name: ReadonlyMap<string, Box<T> | null>): Box<T> | null { return value }
console.log("ok")
`
    })
    const expected = semanticMeaning(module)

    for (const language of ["javascript", "ruby", "php"]) {
      const generated = generate({language, module})
      const filename = language == "javascript" ? "program.js" : language == "ruby" ? "program.rb" : "program.php"

      expect(semanticMeaning(parse({filename, language, source: generated}))).toEqual(expected)
      if (language == "javascript") expect(generated).toContain("ReadonlyMap<string, Box<T>|null>")
      if (language == "ruby") expect(generated).toContain("Hash[String,Box[T]?]")
      if (language == "php") expect(generated).toContain("array<string,?Box<T>>")
    }
  })
})
