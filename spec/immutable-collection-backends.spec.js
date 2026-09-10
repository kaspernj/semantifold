// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const cohort = ["ruby", "javascript", "typescript", "php", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

describe("immutable collection backends", () => {
  it("emits recursive types, construction, total access, and size for every cohort target", async () => {
    const source = await readFile(new URL("fixtures/collections/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of cohort) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : `program.${language == "javascript" ? "js" : language == "typescript" ? "ts" : language == "ruby" ? "rb" : "php"}`
      const reparsed = parse({filename, language, source: generated})

      expect(reparsed.entryPoint.body.statements.slice(0, 5).map((statement) =>
        /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (statement).type.kind)).toEqual([
        "ListType", "MapType", "ListType", "MapType", "ListType"
      ])
      expect(generated).toContain(language == "java" ? "java.util.List.of" : language == "javascript" || language == "typescript" ? "new Map" : "[")
    }
  })

  it("rejects collection IR transactionally for registered non-cohort text targets", async () => {
    const source = await readFile(new URL("fixtures/collections/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of deferred) {
      const generateDeferred = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), module})

      assert.throws(
        generateDeferred,
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == language
      )
    }
  })
})
