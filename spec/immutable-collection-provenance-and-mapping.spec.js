// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, parse, spansForNode} from "../index.js"

const fixtures = [
  ["ruby", "program.rb"], ["javascript", "program.js"], ["typescript", "program.ts"],
  ["php", "program.php"], ["java", "Main.java"]
]
const operatorSpellings = {
  java: {entry: ",", index: "get", lookup: "get", size: "size"},
  javascript: {entry: ",", index: "[", lookup: "get", size: "length"},
  php: {entry: "=>", index: "[", lookup: "[", size: "count"},
  ruby: {entry: "=>", index: "[", lookup: "fetch", size: "size"},
  typescript: {entry: ",", index: "[", lookup: "get", size: "length"}
}
const typeSpellings = {
  java: {key: "String", leaf: "Integer", list: "java.util.List<java.util.List<Integer>>", map: "java.util.Map<String,Integer>"},
  javascript: {key: "string", leaf: "number", list: "ReadonlyArray<ReadonlyArray<number>>", map: "ReadonlyMap<string, number>"},
  php: {key: "string", leaf: "int", list: "list<list<int>>", map: "array<string,int>"},
  ruby: {key: "String", leaf: "Integer", list: "Array[Array[Integer]]", map: "Hash[String,Integer]"},
  typescript: {key: "string", leaf: "number", list: "ReadonlyArray<ReadonlyArray<number>>", map: "ReadonlyMap<string, number>"}
}

describe("immutable collection provenance and mapping", () => {
  it("preserves deterministic recursive type, element, entry, access, and size identities", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/collections/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const repeated = parse({filename, language, source})
      const nested = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[4])
      const outerType = /** @type {import("../src/semantic/types.js").ListType} */ (nested.type)
      const innerType = /** @type {import("../src/semantic/types.js").ListType} */ (outerType.elementType)
      const mapType = /** @type {import("../src/semantic/types.js").MapType} */ (
        /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[1]).type
      )
      const literal = /** @type {import("../src/semantic/types.js").ListLiteral} */ (nested.initializer)
      const map = /** @type {import("../src/semantic/types.js").MapLiteral} */ (
        /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[1]).initializer
      )
      const index = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[5]).expression
      const lookup = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[8]).expression
      const size = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[9]).expression
      const spellings = operatorSpellings[language]
      const expectedTypes = typeSpellings[language]
      const typeSource = (type) => {
        const range = getNodeProvenance(module, type).ranges.type

        assert.ok(range)
        return source.slice(range.start.offset, range.end.offset)
      }

      expect(module.provenance).toEqual(repeated.provenance)
      for (const node of [outerType, innerType, innerType.elementType, literal, literal.elements[0], map, map.entries[0],
        map.entries[0].key, map.entries[0].value]) {
        assert.ok(getNodeProvenance(module, node).origin.location.filename == filename)
      }
      expect(typeSource(outerType)).toEqual(expectedTypes.list)
      expect(typeSource(innerType.elementType)).toEqual(expectedTypes.leaf)
      expect(typeSource(mapType)).toEqual(expectedTypes.map)
      expect(typeSource(mapType.keyType)).toEqual(expectedTypes.key)
      expect(typeSource(mapType.valueType)).toEqual(expectedTypes.leaf)
      for (const [node, spelling] of [[map.entries[0], spellings.entry], [index, spellings.index],
        [lookup, spellings.lookup], [size, spellings.size]]) {
        const operator = getNodeProvenance(module, node).ranges.operator

        assert.ok(operator)
        expect(source.slice(operator.start.offset, operator.end.offset)).toEqual(spelling)
      }
    }
  })

  it("maps every nested type and collection expression occurrence in every cohort backend", async () => {
    const source = await readFile(new URL("fixtures/collections/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const nested = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[4])
    const outerType = /** @type {import("../src/semantic/types.js").ListType} */ (nested.type)
    const innerType = /** @type {import("../src/semantic/types.js").ListType} */ (outerType.elementType)
    const access = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[11]).expression
    const size = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[9]).expression

    for (const language of ["ruby", "javascript", "typescript", "php", "java"]) {
      const artifact = generateArtifact({language, module})

      for (const node of [outerType, innerType, innerType.elementType, nested.initializer, access, size]) {
        assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, node).id).length > 0, `${language}:${node.kind}`)
      }
    }
  })
})
