// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

describe("closed record frontends", () => {
  it("adapts the original-five canonical record profiles to equivalent nominal meaning", async () => {
    const meanings = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/records/${filename}`, import.meta.url), "utf8")
      const module = parse({
        filename,
        language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language),
        source
      })

      expect(module.records.map(({fields, name}) => [name, fields.map((field) => field.name)])).toEqual([
        ["Address", ["city", "zip"]],
        ["User", ["name", "address", "tags", "attributes", "nickname"]]
      ])
      meanings.push(semanticMeaning(module))
    }

    for (const meaning of meanings.slice(1)) expect(meaning).toEqual(meanings[0])
  })
})
