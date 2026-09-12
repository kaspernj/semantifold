// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForNode} from "../index.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]

describe("reference class provenance and mapping", () => {
  it("indexes declarations, private state, construction, receiver calls, and field mutations deterministically", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const first = parse({filename: "program.ts", language: "typescript", source})
    const second = parse({filename: "program.ts", language: "typescript", source})
    const counter = first.classes[0]
    const field = counter.fields[0]
    const method = counter.methods[0]
    const write = method.body.statements[0]
    const construction = first.entryPoint.body.statements[0].initializer
    const methodCall = first.entryPoint.body.statements[3].expression

    expect(first.provenance).toEqual(second.provenance)
    for (const node of [counter, field, counter.constructor, method, write, write.receiver, construction, methodCall]) {
      expect(getNodeProvenance(first, node).origin.kind).toEqual("source")
    }
    for (const id of [counter.id, field.id, method.id]) {
      const symbol = first.provenance.symbols.find((candidate) => candidate.semanticDeclarationId == id)

      assert.ok(symbol)
      expect(getSymbolProvenance(first, symbol.id).references.length > 0).toEqual(true)
    }

    for (const language of cohort) {
      const artifact = generateArtifact({language, module: first})

      for (const node of [counter, field, counter.constructor, method, write, construction, methodCall]) {
        assert.ok(spansForNode(artifact.mapping, getNodeProvenance(first, node).id).length > 0, `${language}:${node.kind}`)
      }
    }
  })
})
