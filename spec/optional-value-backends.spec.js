// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse} from "../index.js"

const targets = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = {
  java: "Main.java",
  javascript: "program.js",
  php: "program.php",
  ruby: "program.rb",
  typescript: "program.ts"
}

describe("optional value backends", () => {
  it("emits and reparses native optional types and operations for the original five", async () => {
    const source = await readFile(new URL("fixtures/optionals/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames[language], language, source: generated})

      expect(reparsed.functions[0].returnType.kind).toEqual("OptionalType")
      expect(reparsed.functions[1].parameters[0].type.kind).toEqual("OptionalType")
      expect(generated).toContain(language == "java" ? "java.util.Optional<String>" : language == "ruby" ? "String?" : "null")
    }
  })

  it("preserves a recursive collection constituent inside an optional", () => {
    const module = parse({
      filename: "recursive.ts",
      language: "typescript",
      source: `function maybe(values: readonly string[], present: boolean): readonly string[] | null {
  if (present) return values
  else return null
}
function lengthOf(value: readonly string[] | null): number {
  if (value !== null) return value.length
  else return 0
}
console.log(lengthOf(maybe(["ready"], true)))
`
    })

    for (const language of targets) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames[language], language, source: generated})
      const returnType = /** @type {import("../src/semantic/types.js").OptionalType} */ (reparsed.functions[0].returnType)

      expect(returnType.kind).toEqual("OptionalType")
      expect(returnType.valueType.kind).toEqual("ListType")
    }
  })
})
