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
  ["java", "Main.java"],
  ["c", "program.c"],
  ["cpp", "program.cpp"],
  ["csharp", "Program.cs"],
  ["go", "program.go"],
  ["kotlin", "program.kt"],
  ["python", "program.py"],
  ["rust", "program.rs"],
  ["swift", "program.swift"]
]

describe("empty-record frontend compatibility", () => {
  it("omits the optional records member for every registered no-record source language", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/scalars/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})

      assert.equal(Object.hasOwn(module, "records"), false, language)
    }
  })
})
