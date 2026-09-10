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
describe("optional value frontends", () => {
  it("adapts exact original-five optional types and operations equivalently", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/optionals/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const maybe = module.functions[0]
      const label = module.functions[1]
      const maybeBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (maybe.body.statements[0])
      const labelBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (label.body.statements[0])
      const maybeAlternate = /** @type {import("../src/semantic/types.js").Block} */ (maybeBranch.alternate)

      expect(maybe.returnType.kind).toEqual("OptionalType")
      expect(label.parameters[0].type.kind).toEqual("OptionalType")
      expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
        maybeBranch.consequent.statements[0]
      ).expression?.kind).toEqual("OptionalSome")
      expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
        maybeAlternate.statements[0]
      ).expression?.kind).toEqual("OptionalNone")
      expect(labelBranch.condition.kind).toEqual("OptionalIsPresent")
      expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
        labelBranch.consequent.statements[0]
      ).expression?.kind).toEqual("OptionalUnwrap")
    }
  })

  it("normalizes Ruby and Java negated guards so only the alternate branch unwraps", () => {
    const ruby = parse({
      filename: "alternate.rb",
      language: "ruby",
      source: `# @param value [String?]
# @return [String]
def label(value)
  if value.nil?
    return "absent"
  else
    return value
  end
end
puts label(nil)
`
    })
    const java = parse({
      filename: "Main.java",
      language: "java",
      source: `public final class Main {
  private static String label(java.util.Optional<String> value) {
    if (!value.isPresent()) {
      return "absent";
    } else {
      return value.get();
    }
  }
  public static void main(String[] args) {
    System.out.println(label(java.util.Optional.empty()));
  }
}
`
    })

    for (const module of [ruby, java]) {
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements[0])
      const alternate = /** @type {import("../src/semantic/types.js").Block} */ (branch.alternate)

      expect(branch.condition.kind).toEqual("UnaryExpression")
      expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
        alternate.statements[0]
      ).expression?.kind).toEqual("OptionalUnwrap")
    }
  })

  it("accepts the exact unqualified Java Optional symbol profile structurally", async () => {
    const source = (await readFile(new URL("fixtures/optionals/Main.java", import.meta.url), "utf8"))
      .replaceAll("java.util.Optional", "Optional")
    const module = parse({filename: "Main.java", language: "java", source})

    expect(module.functions[0].returnType.kind).toEqual("OptionalType")
    expect(module.functions[1].parameters[0].type.kind).toEqual("OptionalType")
  })

  it("adapts optional list elements and map values without rewrapping collection access", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/optionals-recursive/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const list = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])
      const map = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[1])
      const listType = /** @type {import("../src/semantic/types.js").ListType} */ (list.type)
      const mapType = /** @type {import("../src/semantic/types.js").MapType} */ (map.type)
      const listLiteral = /** @type {import("../src/semantic/types.js").ListLiteral} */ (list.initializer)
      const mapLiteral = /** @type {import("../src/semantic/types.js").MapLiteral} */ (map.initializer)
      const accesses = module.entryPoint.body.statements.slice(2).map((statement) =>
        /** @type {import("../src/semantic/types.js").CallExpression} */ (
          /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression
        ).arguments[0].kind)

      expect(listType.elementType.kind).toEqual("OptionalType")
      expect(mapType.valueType.kind).toEqual("OptionalType")
      expect(listLiteral.elements.map(({kind}) => kind)).toEqual(["OptionalSome", "OptionalNone"])
      expect(mapLiteral.entries.map(({value}) => value.kind)).toEqual(["OptionalSome", "OptionalNone"])
      expect(accesses).toEqual(["ListIndexExpression", "ListIndexExpression", "MapLookupExpression", "MapLookupExpression"])
    }
  })
})
