// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const cohort = ["ruby", "javascript", "typescript", "php", "java"]
const filenames = {java: "Main.java", javascript: "program.js", php: "program.php", ruby: "program.rb", typescript: "program.ts"}

describe("ordered map iteration backends", () => {
  it("emits genuinely ordered native maps and pair loops that semantically round trip", async () => {
    const source = await readFile(new URL("fixtures/ordered-map-iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const required = {
      java: ["new java.util.LinkedHashMap<>()", "java.util.Collections.unmodifiableSequencedMap", ".sequencedEntrySet()"],
      javascript: ["new Map([[\"b\", 2], [\"a\", 1], [\"c\", 3]])", "for (const [key, value] of values)"],
      php: ["[\"b\" => 2, \"a\" => 1, \"c\" => 3]", "foreach ($values as $key => $value)"],
      ruby: ["{\"b\" => 2, \"a\" => 1, \"c\" => 3}", ".each do |key, value|"],
      typescript: ["new Map([[\"b\", 2], [\"a\", 1], [\"c\", 3]])", "for (const [key, value] of values)"]
    }

    for (const language of cohort) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames[language], language, source: generated})

      for (const spelling of required[language]) expect(generated).toContain(spelling)
      const loopLine = generated.split("\n").find((line) => language == "java"
        ? line.includes(".sequencedEntrySet()")
        : language == "ruby" ? line.includes(".each do |key, value|")
          : language == "php" ? line.includes("foreach ($values")
            : line.includes("for (const [key, value]"))

      expect(loopLine.match(/values/gu).length).toEqual(1)
      expect(reparsed.entryPoint.body.statements.map(({kind}) => kind))
        .toEqual(["LocalDeclaration", "PrintStatement", "PrintStatement", "ForEachMapStatement"])
      if (language == "java") {
        expect(generated).not.toContain("java.util.Map.of")
        expect(generated).not.toContain("java.util.Map.copyOf")
        const backing = generated.match(/final java\.util\.LinkedHashMap<String,Integer> ([A-Za-z0-9_]+) =/u)?.[1]
        const boundary = generated.indexOf("java.util.Collections.unmodifiableSequencedMap")

        assert.ok(backing)
        assert.ok(boundary > 0)
        expect(generated.slice(boundary + "java.util.Collections.unmodifiableSequencedMap".length).split(backing).length - 1)
          .toEqual(1)
      }
    }
  })

  it("rejects ordered-map IR transactionally for every registered non-cohort target", async () => {
    const source = await readFile(new URL("fixtures/ordered-map-iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]) {
      const emit = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language, module})

      assert.throws(emit, (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language)
    }
  })

  it("keeps Java lowering hygienic and rejects ordered literals outside a safe local initializer", async () => {
    const source = await readFile(new URL("fixtures/ordered-map-iteration/program.ts", import.meta.url), "utf8")
    const hygienic = structuredClone(parse({filename: "program.ts", language: "typescript", source}))
    const loop = hygienic.entryPoint.body.statements[3]

    loop.keyBinding.name = "__semantifold_values_backing"
    loop.valueBinding.name = "__semantifold_entry"
    const rename = (value) => {
      if (!value || typeof value != "object") return
      if (value.kind == "IdentifierExpression" && value.name == "key") value.name = "__semantifold_values_backing"
      if (value.kind == "IdentifierExpression" && value.name == "value") value.name = "__semantifold_entry"
      for (const child of Array.isArray(value) ? value : Object.values(value)) rename(child)
    }

    rename(loop.body)
    const generated = generate({language: "java", module: hygienic})

    expect(generated).toContain("__semantifold_values_backing_2")
    expect(generated).toContain("__semantifold_entry_2")
    expect(parse({filename: "Main.java", language: "java", source: generated}).entryPoint.body.statements[3].kind)
      .toEqual("ForEachMapStatement")

    const unsafe = structuredClone(parse({filename: "program.ts", language: "typescript", source}))
    const literal = unsafe.entryPoint.body.statements[0].initializer

    literal.entries[0].value = {entries: [], kind: "OrderedMapLiteral", location: literal.entries[0].value.location}
    assert.throws(
      () => generate({language: "java", module: unsafe}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("unsafe Java ordered-map expression lowering")
    )
  })
})
