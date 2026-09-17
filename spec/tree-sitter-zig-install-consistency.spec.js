// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@velocious/testing"
import {verifyZigRuntime} from "../scripts/verify-legacy-runtime.js"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

describe("installed Zig parser runtime consistency", () => {
  it("matches every shipped source byte and exact isolated dependency identity", async () => {
    await verifyZigRuntime(repositoryRoot)
    const source = path.join(repositoryRoot, "packages/tree-sitter-zig/runtime")
    const installed = path.join(repositoryRoot, "node_modules/semantifold-tree-sitter-zig-internal")

    for (const filename of ["src/zig.js", "README.md", "LICENSE", "package.json"]) {
      assert.deepEqual(await readFile(path.join(installed, filename)), await readFile(path.join(source, filename)))
    }
    const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"))

    expect(manifest.dependencies).toEqual({"@tree-sitter-grammars/tree-sitter-zig": "1.1.2", "tree-sitter": "0.22.4"})
  })
})
