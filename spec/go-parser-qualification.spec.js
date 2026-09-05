// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"

describe("qualified Tree-sitter Go route", () => {
  it("pins the official typed registry grammar and compatible parser peer", async () => {
    const grammar = JSON.parse(await readFile(new URL("../node_modules/tree-sitter-go/package.json", import.meta.url), "utf8"))

    expect({
      license: grammar.license,
      peer: grammar.peerDependencies["tree-sitter"],
      repository: grammar.repository,
      version: grammar.version
    }).toEqual({
      license: "MIT",
      peer: "^0.25.0",
      repository: "https://github.com/tree-sitter/tree-sitter-go",
      version: "0.25.0"
    })
  })
})
