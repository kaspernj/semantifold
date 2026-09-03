// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  generateArtifact,
  generatedPositionFor,
  mappingFromSourceMap,
  parse,
  SemantifoldDiagnostic
} from "../index.js"

const source = `function difference(left: number, right: number): number {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(difference(4, 9))
`

describe("PR 6 automatic review findings", () => {
  it("requires exact content before importing mapped Source Map positions", () => {
    const sourceMap = {
      file: "generated.js",
      mappings: "AACE",
      names: [],
      sources: ["original.js"],
      version: 3
    }
    const generated = {content: "y", filename: "generated.js", language: /** @type {const} */ ("javascript")}

    assert.throws(() => mappingFromSourceMap(sourceMap, generated), /source content.*original\.js/iu)

    const mapping = mappingFromSourceMap(sourceMap, {
      ...generated,
      sources: [{content: "x\n  y", filename: "original.js", language: "javascript"}]
    })
    const reverse = generatedPositionFor(mapping, {filename: "original.js", line: 2, column: 3})

    expect(reverse.map((result) => result.generatedLocation.start.offset)).toEqual([0])
  })

  it("reports a Java artifact basename limitation as a located backend diagnostic", () => {
    const module = parse({filename: "program.ts", language: "typescript", source})
    /** @type {unknown} */
    let error

    try {
      generateArtifact({filename: "Program.java", language: "java", module})
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(SemantifoldDiagnostic)
    const diagnostic = /** @type {SemantifoldDiagnostic} */ (error)

    expect({code: diagnostic.code, detail: diagnostic.detail, language: diagnostic.language, location: diagnostic.location}).toEqual({
      code: "UNSUPPORTED_CAPABILITY",
      detail: "Backend cannot emit semantic capability 'artifact filename basename other than Main.java'.",
      language: "java",
      location: module.location
    })
  })

  it("maps a shared call-argument expression by its distinct occurrence paths in every backend", () => {
    const module = parse({filename: "program.ts", language: "typescript", source})
    const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body[0])
    const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)
    const sharedLiteral = call.arguments[0]
    const expectedPaths = [
      "/entryPoint/body/0/expression/arguments/0",
      "/entryPoint/body/0/expression/arguments/1"
    ]

    call.arguments[1] = sharedLiteral

    for (const language of /** @type {const} */ (["php", "ruby", "javascript", "typescript", "java"])) {
      const artifact = generateArtifact({language, module})
      const records = artifact.mapping.nodes.filter((record) => expectedPaths.includes(record.path))
      const recordIds = new Set(records.map((record) => record.id))
      const literalSpans = artifact.mapping.spans.filter((span) => span.role == "literal" && recordIds.has(span.nodeId ?? ""))

      expect(records.map((record) => record.path)).toEqual(expectedPaths)
      expect(new Set(records.map((record) => record.id)).size).toEqual(2)
      expect(literalSpans.map((span) => span.nodeId)).toEqual(records.map((record) => record.id))
      assert.ok(artifact.code.length > 0)
    }
  })
})
