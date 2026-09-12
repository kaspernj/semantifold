// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, generate, parse, SemantifoldDiagnostic} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]
const authority = createCapabilityAuthority(task034AuthorityInput())

describe("effectful capability frontends", () => {
  it("normalizes the original-five parser-backed facades to the same owned effect graph", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/effectful-capabilities/${filename}`, import.meta.url), "utf8")
      modules.push(parse({capabilityAuthority: authority, filename, language, source}))
    }

    for (const module of modules) {
      const close = module.functions[0].body.statements[0].expression
      const acquire = module.entryPoint.body.statements[0].initializer
      const transfer = module.entryPoint.body.statements[1].expression.arguments[0]
      const trace = module.entryPoint.body.statements[2].expression

      expect(close.kind).toBe("EffectCallExpression")
      expect(close.arguments[0].kind).toBe("OwnedBorrowExpression")
      expect(acquire.kind).toBe("EffectCallExpression")
      expect(transfer.kind).toBe("OwnedMoveExpression")
      expect(trace.kind).toBe("EffectCallExpression")
      expect([close.effectSiteId, acquire.effectSiteId, module.entryPoint.body.statements[1].expression.effectSiteId,
        trace.effectSiteId]).toEqual(["effect:0", "effect:1", "effect:2", "effect:3"])
    }
  })

  it("rejects Task 034 authority on non-adopted source languages", () => {
    assert.throws(() => parse({
      capabilityAuthority: authority,
      filename: "unsupported.py",
      language: "python",
      source: "def run(value: int, other: int) -> int:\n    return value + other\nprint(run(1, 2))\n"
    }), (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
      error.location?.filename == "unsupported.py")
  })

  it("rejects same-shaped source tampering with protected target support", async () => {
    const source = await readFile(new URL("fixtures/effectful-capabilities/program.ts", import.meta.url), "utf8")
    const module = parse({capabilityAuthority: authority, filename: "program.ts", language: "typescript", source})
    const mutations = new Map([
      ["php", ["program.php", "return $value;", "return $value + 1;"]],
      ["ruby", ["program.rb", "  value\nend", "  value + 1\nend"]],
      ["javascript", ["program.js", "return value }", "return value + 1 }"]],
      ["typescript", ["program.ts", "return value }", "return value + 1 }"]],
      ["java", ["Main.java", "return value; }", "return value + 1; }"]]
    ])

    for (const [language, [filename, original, replacement]] of mutations) {
      const generated = generate({language, module})
      const tampered = generated.replace(original, replacement)

      expect(tampered == generated).toBe(false)
      assert.throws(() => parse({capabilityAuthority: authority, filename, language, source: tampered}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX")
    }
  })
})
