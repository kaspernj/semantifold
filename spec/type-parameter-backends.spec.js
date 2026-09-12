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
})
