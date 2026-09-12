// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {
  generate,
  generateArtifact,
  generateArtifactSet,
  getNodeProvenance,
  parse,
  SemantifoldDiagnostic,
  spansForNode
} from "../index.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]
const deferred = ["kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"]

describe("condition-controlled loop backends", () => {
  it("emits direct pre-condition loops, reparses resolved controls, and maps every loop-owned node", async () => {
    const source = await readFile(new URL("fixtures/condition-controlled-loops/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const loop = /** @type {import("../src/semantic/types.js").WhileStatement} */ (module.functions[1].body.statements[1])
    const outer = /** @type {import("../src/semantic/types.js").WhileStatement} */ (module.functions[2].body.statements[2])
    const inner = /** @type {import("../src/semantic/types.js").WhileStatement} */ (outer.body.statements[2])
    const continueBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (inner.body.statements[1])
    const breakBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (inner.body.statements[3])
    const controls = [continueBranch.consequent.statements[0], breakBranch.consequent.statements[0]]
    const spellings = {php: "while (probe($value, $limit))", ruby: "while probe(value, limit)",
      javascript: "while (probe(value, limit))", typescript: "while (probe(value, limit))",
      java: "while (probe(value, limit))"}

    for (const language of cohort) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "javascript" ? "program.js" :
        language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"
      const reparsed = parse({filename, language, source: generated})
      const reparsedLoop = /** @type {import("../src/semantic/types.js").WhileStatement} */ (reparsed.functions[1].body.statements[1])
      const reparsedOuter = /** @type {import("../src/semantic/types.js").WhileStatement} */ (reparsed.functions[2].body.statements[2])
      const reparsedInner = /** @type {import("../src/semantic/types.js").WhileStatement} */ (reparsedOuter.body.statements[2])
      const reparsedContinue = /** @type {import("../src/semantic/types.js").ContinueStatement} */ (
        /** @type {import("../src/semantic/types.js").IfStatement} */ (reparsedInner.body.statements[1])
          .consequent.statements[0]
      )
      const reparsedBreak = /** @type {import("../src/semantic/types.js").BreakStatement} */ (
        /** @type {import("../src/semantic/types.js").IfStatement} */ (reparsedInner.body.statements[3])
          .consequent.statements[0]
      )
      const artifact = generateArtifact({language, module})

      expect(generated).toContain(spellings[language])
      expect(reparsedLoop.kind).toEqual("WhileStatement")
      expect(reparsedLoop.condition.kind).toEqual("CallExpression")
      expect(reparsedLoop.id).toEqual(loop.id)
      expect([reparsedContinue.targetLoopId, reparsedBreak.targetLoopId]).toEqual([reparsedInner.id, reparsedInner.id])
      assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, loop).id).length > 0, language)
      assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, loop.condition).id).length > 0, language)
      assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, loop.body).id).length > 0, language)
      for (const control of controls) {
        assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, control).id).length > 0, language)
      }
    }
  })

  it("returns deterministic source, artifact sets, provenance, and mappings", async () => {
    const source = await readFile(new URL("fixtures/condition-controlled-loops/program.ts", import.meta.url), "utf8")
    const firstModule = parse({filename: "program.ts", language: "typescript", source})
    const secondModule = parse({filename: "program.ts", language: "typescript", source})

    expect(firstModule.provenance).toEqual(secondModule.provenance)
    for (const language of cohort) {
      expect(generate({language, module: firstModule})).toEqual(generate({language, module: firstModule}))
      assert.deepEqual(
        generateArtifactSet({language, module: firstModule}),
        generateArtifactSet({language, module: firstModule})
      )
    }
  })

  it("rejects condition-controlled loop IR transactionally for every non-cohort target", async () => {
    const source = await readFile(new URL("fixtures/condition-controlled-loops/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of deferred) {
      const emit = language == "wasm"
        ? () => generateArtifactSet({language, module, role: "binary"})
        : ["csharp", "go", "c", "rust"].includes(language)
          ? () => generateArtifactSet({language, module})
          : () => generate({language, module})

      assert.throws(emit, (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language &&
        error.detail.includes("condition-controlled loop"))
    }
  })
})
