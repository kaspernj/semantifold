// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"

const withoutMetadata = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("Go frontend validation", () => {
  it("normalizes the canonical Go fixture to the shared Tasks 001-004 meaning", async () => {
    const [go, typescript] = await Promise.all([
      readFile(new URL("fixtures/program.go", import.meta.url), "utf8"),
      readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    ])
    const actual = parse({filename: "main.go", language: /** @type {any} */ ("go"), source: go})
    const expected = parse({filename: "program.ts", language: "typescript", source: typescript})

    expect(withoutMetadata(actual)).toEqual(withoutMetadata(expected))
  })
})
