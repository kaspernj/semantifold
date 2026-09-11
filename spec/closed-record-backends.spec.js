// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

describe("closed record backends", () => {
  it("emits reparsable native closed immutable records for every cohort target", async () => {
    const source = await readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const expected = semanticMeaning(module)

    for (const language of cohort) {
      const generated = generate({
        language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language),
        module
      })
      const filename = language == "java" ? "Main.java" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"
      const reparsed = parse({
        filename,
        language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language),
        source: generated
      })

      expect(semanticMeaning(reparsed)).toEqual(expected)
      expect(generated).toContain(language == "php" ? "final readonly class User" :
        language == "ruby" ? "class User" : language == "java" ? "private final Address address;" : "class User")
    }
  })

  it("rejects record IR transactionally for every registered non-cohort target", async () => {
    const source = await readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of deferred) {
      const generateDeferred = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module})

      assert.throws(generateDeferred, (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language && error.location != undefined)
    }
  })
})
