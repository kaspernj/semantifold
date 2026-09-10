// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const cohort = ["ruby", "javascript", "typescript", "php", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

describe("ordered list iteration backends", () => {
  it("emits native loops with one collection evaluation and reparses control nodes", async () => {
    const source = await readFile(new URL("fixtures/iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const spellings = {ruby: ".each do |value|", javascript: "for (const value of passList(values))",
      typescript: "for (const value of passList(values))", php: "foreach (passList($values) as $value)",
      java: "for (Integer value : passList(values))"}
    const collectionSpellings = {ruby: "passList(values).each", javascript: "of passList(values)",
      typescript: "of passList(values)", php: "foreach (passList($values) as", java: ": passList(values)"}

    for (const language of cohort) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "javascript" ? "program.js" :
        language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"
      const reparsed = parse({filename, language, source: generated})
      const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (reparsed.functions[1].body.statements[1])

      expect(generated).toContain(spellings[language])
      expect(generated.split(collectionSpellings[language])).toHaveLength(2)
      expect(loop.kind).toEqual("ForEachStatement")
      expect(loop.body.statements[0].kind).toEqual("IfStatement")
    }
  })

  it("rejects iteration IR transactionally for every registered non-cohort target", async () => {
    const source = await readFile(new URL("fixtures/iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of deferred) {
      const emit = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language, module})

      assert.throws(emit, (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language)
    }
  })

  it("reparses Java iteration over a canonically generated nested-list access", () => {
    const module = parse({
      filename: "program.ts",
      language: "typescript",
      source: `function sumNested(): number {
  const nested: ReadonlyArray<ReadonlyArray<number>> = [[1, 2]]
  let total: number = 0
  for (const value of nested[0]) { total = total + value }
  return total
}
console.log(sumNested())
`
    })
    const generated = generate({language: "java", module})
    const reparsed = parse({filename: "Main.java", language: "java", source: generated})
    const loop = reparsed.functions[0].body.statements[2]

    expect(generated).toContain("for (Integer value : nested.get(0))")
    expect(loop.kind).toEqual("ForEachStatement")
    expect(loop.list.kind).toEqual("ListIndexExpression")
  })
})
