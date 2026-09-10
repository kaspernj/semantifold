// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

const fixtures = [
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["php", "program.php"],
  ["java", "Main.java"]
]

const optionalListSources = [
  ["ruby", "program.rb", `# @param values [Array[Integer]?]
# @return [void]
def visit(values)
  unless values.nil?
    values.each do |value|
      puts value
    end
  end
end
`],
  ["javascript", "program.js", `/**
 * @param {ReadonlyArray<number>|null} values
 * @returns {void}
 */
function visit(values) {
  if (values !== null) {
    for (const value of values) {
      console.log(value)
    }
  }
}
`],
  ["typescript", "program.ts", `function visit(values: ReadonlyArray<number> | null): void {
  if (values !== null) {
    for (const value of values) {
      console.log(value)
    }
  }
}
`],
  ["php", "program.php", `<?php
declare(strict_types=1);
/** @param ?list<int> $values */
function visit(?array $values): void
{
    if ($values !== null) {
        foreach ($values as $value) {
            echo $value, PHP_EOL;
        }
    }
}
`],
  ["java", "Main.java", `public final class Main {
  private static void visit(java.util.Optional<java.util.List<Integer>> values) {
    if (values.isPresent()) {
      for (Integer value : values.get()) {
        System.out.println(value);
      }
    }
  }
  public static void main(String[] args) {}
}
`]
]

describe("ordered list iteration frontends", () => {
  it("normalizes every original-five canonical loop and nearest control node equivalently", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/iteration/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (module.functions[1].body.statements[1])
      const outer = /** @type {import("../src/semantic/types.js").IfStatement} */ (loop.body.statements[0])
      const innerContinue = /** @type {import("../src/semantic/types.js").IfStatement} */ (outer.consequent.statements[0])
      const innerBreak = /** @type {import("../src/semantic/types.js").IfStatement} */ (outer.alternate?.statements[0])

      expect(loop.kind).toEqual("ForEachStatement")
      expect(loop.list.kind).toEqual("CallExpression")
      expect(loop.valueBinding).toMatchObject({kind: "ValueBinding", mutable: false, name: "value"})
      expect(loop.valueBinding.type).toMatchObject({kind: "TypeReference", name: "integer"})
      expect(loop.body.kind).toEqual("Block")
      expect(innerContinue.consequent.statements[0].kind).toEqual("ContinueStatement")
      expect(innerBreak.consequent.statements[0].kind).toEqual("BreakStatement")
    }
  })

  for (const [language, filename, source] of optionalListSources) {
    it(`unwraps a presence-narrowed optional list before ${language} iteration and round trips it`, () => {
      const module = parse({filename, language, source})
      const reparsed = parse({filename, language, source: generate({language, module})})

      for (const candidate of [module, reparsed]) {
        const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (candidate.functions[0].body.statements[0])
        const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (branch.consequent.statements[0])

        expect(loop.list.kind).toEqual("OptionalUnwrap")
        expect(/** @type {import("../src/semantic/types.js").OptionalUnwrap} */ (loop.list).operand)
          .toMatchObject({kind: "IdentifierExpression", name: "values"})
        expect(loop.valueBinding.type).toMatchObject({kind: "TypeReference", name: "integer"})
      }
    })
  }

  it("still requires a presence proof before iterating an optional list", () => {
    const source = `function visit(values: ReadonlyArray<number> | null): void {
  for (const value of values) { console.log(value) }
}
`

    assert.throws(
      () => parse({filename: "unguarded.ts", language: "typescript", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNCHECKED_OPTIONAL_UNWRAP" &&
        source.slice(error.location.start.offset, error.location.end.offset) == "values"
    )
  })

  it("recursively types a parenthesized Java enhanced-for collection and round trips it", async () => {
    const source = (await readFile(new URL("fixtures/iteration/Main.java", import.meta.url), "utf8"))
      .replace(" : passList(values))", " : (passList(values)))")
    const module = parse({filename: "Main.java", language: "java", source})
    const reparsed = parse({filename: "Main.java", language: "java", source: generate({language: "java", module})})

    for (const candidate of [module, reparsed]) {
      const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (candidate.functions[1].body.statements[1])

      expect(loop.list.kind).toEqual("CallExpression")
    }
  })
})
