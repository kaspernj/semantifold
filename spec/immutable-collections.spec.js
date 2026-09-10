// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"

function withoutSource(value) {
  return JSON.parse(JSON.stringify(value, (key, item) =>
    ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : item))
}

describe("immutable collection semantics", () => {
  it("models recursive list/map types, literals, total access, size, nesting, and function passage", () => {
    const module = parse({
      filename: "collections.ts",
      language: "typescript",
      source: `function passList(values: readonly number[]): readonly number[] {
  return values
}
function passMap(values: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  return values
}
const numbers: readonly number[] = [4, 4, 7]
const values: ReadonlyMap<string, number> = new Map([["answer", 42]])
const nested: ReadonlyArray<ReadonlyArray<number>> = [[1, 2], [3]]
console.log(numbers[1])
console.log(values.get("answer"))
console.log(numbers.length)
console.log(values.size)
console.log(nested[1][0])
console.log(passList(numbers).length)
console.log(passMap(values).size)
`
    })

    expect(withoutSource(module.functions.map(({parameters, returnType}) => ({parameters, returnType})))).toEqual([
      {
        parameters: [{kind: "Parameter", name: "values", type: {
          elementType: {kind: "TypeReference", name: "integer"}, kind: "ListType"
        }}],
        returnType: {elementType: {kind: "TypeReference", name: "integer"}, kind: "ListType"}
      },
      {
        parameters: [{kind: "Parameter", name: "values", type: {
          keyType: {kind: "TypeReference", name: "string"},
          kind: "MapType",
          valueType: {kind: "TypeReference", name: "integer"}
        }}],
        returnType: {
          keyType: {kind: "TypeReference", name: "string"},
          kind: "MapType",
          valueType: {kind: "TypeReference", name: "integer"}
        }
      }
    ])
    expect(module.entryPoint.body.statements.map((statement) => statement.kind)).toEqual([
      "LocalDeclaration", "LocalDeclaration", "LocalDeclaration",
      "PrintStatement", "PrintStatement", "PrintStatement", "PrintStatement",
      "PrintStatement", "PrintStatement", "PrintStatement"
    ])
    expect(module.entryPoint.body.statements.slice(3).map((statement) =>
      /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression.kind)).toEqual([
      "ListIndexExpression", "MapLookupExpression", "CollectionSizeExpression", "CollectionSizeExpression",
      "ListIndexExpression", "CollectionSizeExpression", "CollectionSizeExpression"
    ])
    const nestedAccess = /** @type {import("../src/semantic/types.js").ListIndexExpression} */ (
      /** @type {import("../src/semantic/types.js").PrintStatement} */ (
        module.entryPoint.body.statements[7]
      ).expression
    )

    expect(nestedAccess.collection.kind).toEqual("ListIndexExpression")
  })
})
