// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

describe("reference class backends", () => {
  it("emits reparsable native reference classes for every adopted target", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const expected = semanticMeaning(module)

    for (const language of cohort) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "javascript" ? "program.js" :
        language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"
      const reparsed = parse({filename, language, source: generated})

      expect(semanticMeaning(reparsed)).toEqual(expected)
      expect(generated).toContain(language == "php" ? "private int $value" :
        language == "ruby" ? "@value = value" : language == "javascript" ? "#value" :
          language == "typescript" ? "private value" : "private int value")
    }
  })

  it("returns deterministic source and complete artifact sets", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of cohort) {
      expect(generate({language, module})).toEqual(generate({language, module}))
      assert.deepEqual(generateArtifactSet({language, module}), generateArtifactSet({language, module}))
    }
  })

  it("rejects reference-class IR transactionally for every registered non-cohort target", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of deferred) {
      const emit = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : () => generateArtifactSet({language, module})

      assert.throws(emit, (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language &&
        error.detail.includes("reference class") && error.location != undefined)
    }
  })
})
