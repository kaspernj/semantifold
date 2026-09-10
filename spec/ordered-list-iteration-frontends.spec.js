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
})
