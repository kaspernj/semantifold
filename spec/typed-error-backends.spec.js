// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, generateProgramArtifactSet, parse, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

describe("typed error backends", () => {
  it("emits and reparses exact typed handlers for every original-five target", async () => {
    const source = await readFile(new URL("fixtures/errors/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const expected = semanticMeaning(module)

    for (const language of cohort) {
      const generated = generate({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module})
      const filename = language == "java" ? "Main.java" : language == "javascript" ? "program.js" :
        language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"
      const reparsed = parse({filename, language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), source: generated})

      expect(semanticMeaning(reparsed)).toEqual(expected)
      if (language == "javascript" || language == "typescript") expect(generated).toContain("instanceof ValidationError")
    }
  })

  it("rejects typed-error IR transactionally for every non-cohort target", async () => {
    const source = await readFile(new URL("fixtures/errors/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of deferred) {
      const generateDeferred = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module})

      assert.throws(generateDeferred, (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language && error.location != undefined &&
        error.message.includes("Task 011 typed errors and handling"))
    }
  })

  it("rejects malformed handlers and target error-name collisions before emitting an artifact", async () => {
    const source = await readFile(new URL("fixtures/errors/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of cohort) {
      const malformed = structuredClone(module)
      const outerHandler = /** @type {import("../src/semantic/types.js").TryStatement} */ (malformed.functions[0].body.statements[0])

      outerHandler.catchBinding.mutable = true
      assert.throws(
        () => generate({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module: malformed}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.location?.filename == "program.ts" && error.message.includes("malformed catch binding")
      )

      const collision = structuredClone(module)

      collision.errors[0].name = language == "ruby" ? "StandardError" : language == "javascript" || language == "typescript"
        ? "Error" : "RuntimeException"
      assert.throws(
        () => generate({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module: collision}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.location?.filename == "program.ts"
      )
    }
  })

  it("preserves a private Ruby program error declaration as a private constant", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "hidden.ts",
        id: "hidden",
        language: "typescript",
        source: "class SecretIssue extends Error {}\n"
      }, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "console.log(1)\n"
      }]
    })
    const artifacts = generateProgramArtifactSet({language: "ruby", program})
    const hidden = artifacts.artifacts.find(({path}) => path == "hidden.rb")

    expect(String(hidden?.content)).toContain("private_constant :SecretIssue")
    const reparsed = parseProgram({
      entryModule: "main",
      sources: artifacts.artifacts.map((artifact) => ({
        filename: artifact.path,
        id: artifact.path.replace(/\.rb$/u, "").replaceAll("/", "."),
        language: /** @type {const} */ ("ruby"),
        source: String(artifact.content)
      }))
    })
    const hiddenModule = reparsed.modules.find(({id}) => id == "hidden")

    expect({errors: hiddenModule?.errors?.map(({name}) => name), exports: hiddenModule?.exports}).toEqual({
      errors: ["SecretIssue"],
      exports: []
    })
  })
})
