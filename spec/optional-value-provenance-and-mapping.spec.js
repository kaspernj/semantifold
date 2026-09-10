// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, parse, spansForNode} from "../index.js"

const fixtures = [
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["php", "program.php"],
  ["java", "Main.java"]
]
const spellings = {
  java: {absence: "empty", optional: "java.util.Optional<String>", present: "isPresent", some: "of", unwrap: "get", value: "String"},
  javascript: {absence: "null", optional: "string|null", present: "!==", some: "value", unwrap: "value", value: "string"},
  php: {absence: "null", optional: "?string", present: "!==", some: "$value", unwrap: "$value", value: "string"},
  ruby: {absence: "nil", optional: "String?", present: "nil?", some: "value", unwrap: "value", value: "String"},
  typescript: {absence: "null", optional: "string | null", present: "!==", some: "value", unwrap: "value", value: "string"}
}

function textAt(source, location) {
  return source.slice(location.start.offset, location.end.offset)
}

function optionalNodes(module) {
  const maybeBranch = module.functions[0].body.statements[0]
  const labelBranch = module.functions[1].body.statements[0]

  return {
    absence: maybeBranch.alternate.statements[0].expression,
    optional: module.functions[0].returnType,
    present: labelBranch.condition,
    some: maybeBranch.consequent.statements[0].expression,
    unwrap: labelBranch.consequent.statements[0].expression,
    value: module.functions[0].returnType.valueType
  }
}

describe("optional value provenance and mapping", () => {
  it("retains deterministic exact optional constituent and operation source ranges", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/optionals/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const repeated = parse({filename, language, source})
      const nodes = optionalNodes(module)
      const expected = spellings[language]

      expect(module.provenance).toEqual(repeated.provenance)
      expect(textAt(source, getNodeProvenance(module, nodes.optional).ranges.type)).toEqual(expected.optional)
      expect(textAt(source, getNodeProvenance(module, nodes.optional).ranges.valueType)).toEqual(expected.value)
      expect(textAt(source, getNodeProvenance(module, nodes.value).ranges.type)).toEqual(expected.value)
      expect(textAt(source, getNodeProvenance(module, nodes.some).ranges.some)).toEqual(expected.some)
      expect(textAt(source, getNodeProvenance(module, nodes.absence).ranges.absence)).toEqual(expected.absence)
      expect(textAt(source, getNodeProvenance(module, nodes.present).ranges.operator)).toEqual(expected.present)
      expect(textAt(source, getNodeProvenance(module, nodes.unwrap).ranges.unwrap)).toEqual(expected.unwrap)
    }
  })

  it("maps every optional type and operation identity in every cohort backend", async () => {
    const source = await readFile(new URL("fixtures/optionals/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const nodes = optionalNodes(module)

    for (const language of ["ruby", "javascript", "typescript", "php", "java"]) {
      const artifact = generateArtifact({language, module})

      for (const [role, node] of Object.entries(nodes)) {
        assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, node).id).length > 0, `${language}:${role}`)
      }
    }
  })
})
