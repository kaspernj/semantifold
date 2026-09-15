// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parseDart} from "../src/frontends/dart.js"
import {parseJavaScriptTypeScript} from "../src/frontends/javascript-typescript.js"
import {validateParsedModule} from "../src/semantic/validate.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "resolution", "sourceProvenance"].includes(key) ? undefined : nested))

describe("Dart strict source profile", () => {
  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/", "functions/"]) {
    it("adapts the complete " + (directory || "base") + " profile to the existing semantics", async () => {
      const dart = await readFile(new URL(`fixtures/${directory}program.dart`, import.meta.url), "utf8")
      const typescript = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")

      const expected = parseJavaScriptTypeScript({filename: "program.ts", language: "typescript", source: typescript})

      expect(meaning(parseDart({filename: "program.dart", source: dart})))
        .toEqual(meaning(validateParsedModule(expected, "typescript")))
    })
  }
})
