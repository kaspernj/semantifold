// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import Parser from "tree-sitter"
import PythonLanguage from "tree-sitter-python"

describe("qualified Tree-sitter Python route", () => {
  it("pins the official typed binding and grammar releases with local-only install lifecycles", async () => {
    const [binding, grammar, manifest, lockfile] = await Promise.all([
      readFile(new URL("../node_modules/tree-sitter/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../node_modules/tree-sitter-python/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse)
    ])

    expect({license: binding.license, version: binding.version}).toEqual({license: "MIT", version: "0.25.1"})
    expect({license: grammar.license, repository: grammar.repository, version: grammar.version}).toEqual({
      license: "MIT",
      repository: "https://github.com/tree-sitter/tree-sitter-python",
      version: "0.25.0"
    })
    expect(binding.scripts.install).toEqual("node-gyp-build")
    expect(grammar.scripts.install).toEqual("node-gyp-build")
    expect(JSON.stringify([binding.scripts, grammar.scripts])).not.toMatch(/https?:|curl|wget|fetch/u)
    expect({binding: manifest.dependencies["tree-sitter"], grammar: manifest.dependencies["tree-sitter-python"]}).toEqual({
      binding: "0.25.1",
      grammar: "0.25.0"
    })
    expect(lockfile.packages["node_modules/tree-sitter"].integrity)
      .toEqual("sha512-mrcEdkYtHfrK1A6fs3O6FxkBo0Qig5XUXqHhxUOQu0bmPo00QF4XaSx4edpazdHwxnSCjlGKGgIqWdaN4dvTLA==")
    expect(lockfile.packages["node_modules/tree-sitter-python"].integrity)
      .toEqual("sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==")
    expect(lockfile.packages["node_modules/tree-sitter"].resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//u)
    expect(lockfile.packages["node_modules/tree-sitter-python"].resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//u)
  })

  it("loads CommonJS packages through ESM, sets ABI-compatible language, and visits named, anonymous, and extra nodes", async () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (PythonLanguage)))
    const source = await readFile(new URL("fixtures/operators/program.py", import.meta.url), "utf8")
    const root = parser.parse(source).rootNode
    const visited = {anonymous: 0, comments: 0, named: 0}

    const traverse = (node) => {
      if (node.isNamed) visited.named += 1
      else visited.anonymous += 1
      if (node.type == "comment") visited.comments += 1
      for (let index = 0; index < node.childCount; index += 1) {
        const child = node.child(index)

        assert.ok(child)
        traverse(child)
      }
    }

    traverse(root)
    expect(root.hasError).toBeFalse()
    expect(visited.named > 0).toBeTrue()
    expect(visited.anonymous > 0).toBeTrue()

    const commentRoot = parser.parse("# visible extra\ndef choose(left: int, right: int) -> int:\n    return left\n").rootNode
    traverse(commentRoot)
    expect(visited.comments).toEqual(1)
  })

  it("exposes malformed recovery nodes and UTF-16LE binding coordinates without hiding parser failures", () => {
    const parser = new Parser()

    parser.setLanguage(/** @type {import("tree-sitter").Language} */ (/** @type {unknown} */ (PythonLanguage)))
    const malformed = parser.parse("def broken(left: int, right: int -> int:\n    return left\n").rootNode
    const errors = malformed.descendantsOfType("ERROR")

    expect(malformed.hasError).toBeTrue()
    expect(errors.length > 0).toBeTrue()
    expect(errors[0].isError).toBeTrue()

    const source = "# 😀\r\ndef café(left: int, right: int) -> int:\r\n    return left\r\n"
    const identifier = parser.parse(source).rootNode.descendantsOfType("identifier")[0]
    const utf16Start = source.indexOf("café")
    const utf8Start = new TextEncoder().encode(source.slice(0, utf16Start)).length

    expect(identifier.startIndex).toEqual(utf16Start)
    expect(identifier.startIndex == utf8Start).toBeFalse()
  })
})
