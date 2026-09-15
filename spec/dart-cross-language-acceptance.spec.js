// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"
import {executeDart} from "./support/dart-toolchain.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const profiles = ["", "scalars/", "locals/", "operators/", "statements/", "functions/"]
const existingTargets = ["php", "ruby", "javascript", "typescript", "java"]
const extensions = {java: "java", javascript: "js", php: "php", ruby: "rb", typescript: "ts"}

describe("Dart cross-language acceptance", () => {
  for (const directory of profiles) {
    it(`preserves the ${directory || "base"} Dart fixture through every Task-005 text target`, async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.dart`, import.meta.url), "utf8")
      const dart = parse({filename: `${directory}program.dart`, language: "dart", source})

      for (const language of existingTargets) {
        const set = generateArtifactSet({language, module: dart})
        const entry = set.artifacts.find(({role}) => role == "entry")
        const filename = language == "java" ? "Main.java" : `program.${extensions[language]}`

        expect(entry?.contentKind).toEqual("text")
        const reparsed = parse({filename, language, source: String(entry?.content)})

        expect(semanticMeaning(reparsed)).toEqual(semanticMeaning(dart))
      }
    })
  }

  for (const [language, filename] of [
    ["php", "program.php"],
    ["ruby", "program.rb"],
    ["javascript", "program.js"],
    ["typescript", "program.ts"],
    ["java", "Main.java"]
  ]) {
    it(`executes the representative ${language} Task-005 fixture through Dart VM and native compilation`, async () => {
      const source = await readFile(new URL(`fixtures/functions/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const result = await executeDart(module)

      expect(result.acceptance.stages.at(-1)?.stdout).toEqual("ready\n6\n")
      expect(result.native.stdout).toEqual("ready\n6\n")
    })
  }
})
