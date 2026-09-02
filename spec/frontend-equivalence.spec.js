// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {parse} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

/**
 * Removes source locations to compare language-neutral meaning.
 * @param {import("../src/semantic/types.js").SemanticNode} node - Semantic node.
 * @returns {import("../src/semantic/types.js").SemanticNodeWithoutLocations} Location-free semantic value.
 */
function withoutLocations(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => key == "location" ? undefined : value))
}

describe("language frontends", () => {
  it("normalizes all five typed source fixtures to equivalent semantic meaning", async () => {
    const modules = await Promise.all(fixtures.map(async ([language, filename]) => {
      const source = await readFile(new URL(`fixtures/${filename}`, import.meta.url), "utf8")

      return parse({filename, language, source})
    }))
    const normalized = modules.map(withoutLocations)

    for (const module of modules) {
      assert.equal(module.kind, "Module")
      assert.equal(module.functions[0].parameters[0].type.name, "integer")
      assert.equal(module.functions[0].returnType.name, "integer")
      assert.equal(module.location.start.line, 1)
      assert.ok(module.functions[0].location.start.line >= 1)
    }

    for (const semanticModule of normalized.slice(1)) {
      assert.deepEqual(semanticModule, normalized[0])
    }
  })

  it("reads JavaScript JSDoc and TypeScript annotations as semantic integer types", async () => {
    for (const [language, filename] of fixtures.filter(([name]) => ["javascript", "typescript"].includes(name))) {
      const source = await readFile(new URL(`fixtures/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const functionDeclaration = module.functions[0]

      assert.deepEqual(functionDeclaration.parameters.map((parameter) => parameter.type.name), ["integer", "integer"])
      assert.equal(functionDeclaration.returnType.name, "integer")
    }
  })
})
