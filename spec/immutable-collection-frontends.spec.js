// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"

const fixtures = [
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["php", "program.php"],
  ["java", "Main.java"]
]

describe("immutable collection frontends", () => {
  it("adapts the exact original-five list and map profiles equivalently", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/collections/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})

      expect(module.functions.map(({parameters, returnType}) => [parameters[0].type.kind, returnType.kind])).toEqual([
        ["ListType", "ListType"], ["MapType", "MapType"]
      ])
      expect(module.entryPoint.body.statements.slice(0, 5).map((statement) =>
        /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (statement).initializer.kind)).toEqual([
        "ListLiteral", "MapLiteral", "ListLiteral", "MapLiteral", "ListLiteral"
      ])
      expect(module.entryPoint.body.statements.slice(5).map((statement) =>
        /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression.kind)).toEqual([
        "ListIndexExpression", "ListIndexExpression", "ListIndexExpression", "MapLookupExpression",
        "CollectionSizeExpression", "CollectionSizeExpression", "ListIndexExpression", "CollectionSizeExpression",
        "CollectionSizeExpression"
      ])
    }
  })

  it("accepts bounded whitespace inside Ruby recursive type comments", () => {
    const module = parse({
      filename: "spaced.rb",
      language: "ruby",
      source: `# @param values [Hash[String, Array[Integer]]]
# @return [Hash[String, Array[Integer]]]
def pass(values)
  return values
end
# @type [Hash[String, Array[Integer]]]
values = {"items" => [1]}
puts values.fetch("items").size
`
    })

    expect(module.functions[0].returnType.kind).toEqual("MapType")
  })
})
