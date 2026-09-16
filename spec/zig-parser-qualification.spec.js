// @ts-check

import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises"
import {createRequire} from "node:module"
import os from "node:os"
import path, {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain} from "../index.js"
import {deterministicEnvironment} from "../src/toolchains.js"

const require = createRequire(import.meta.url)
/** @type {{parseCst: (source: string) => import("../packages/tree-sitter-zig/runtime/src/zig.js").CstSnapshot}} */
const boundary = require("semantifold-tree-sitter-zig-internal")
const internalRequire = createRequire(require.resolve("semantifold-tree-sitter-zig-internal"))
const fixtureNames = ["base", "scalars", "locals", "operators", "statements", "scaffolds", "coordinates"]

/** @param {import("../packages/tree-sitter-zig/runtime/src/zig.js").CstNode} node */
function descendants(node) {
  return [node, ...node.children.flatMap(({node: child}) => descendants(child))]
}

describe("qualified Zig grammar frozen boundary", () => {
  it("pins the MIT ABI-14 grammar, compatible private binding and typed metadata", async () => {
    const grammarEntry = internalRequire.resolve("@tree-sitter-grammars/tree-sitter-zig")
    const grammarRoot = resolve(dirname(grammarEntry), "../..")
    const bindingEntry = internalRequire.resolve("tree-sitter")
    const [grammarManifest, bindingManifest, lockfile, declarations, parserSource] = await Promise.all([
      readFile(resolve(grammarRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(resolve(dirname(bindingEntry), "package.json"), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(resolve(grammarRoot, "bindings/node/index.d.ts"), "utf8"),
      readFile(resolve(grammarRoot, "src/parser.c"), "utf8")
    ])
    const grammar = internalRequire("@tree-sitter-grammars/tree-sitter-zig")
    const locked = lockfile.packages["node_modules/semantifold-tree-sitter-zig-internal/node_modules/@tree-sitter-grammars/tree-sitter-zig"]

    expect({license: grammarManifest.license, repository: grammarManifest.repository, version: grammarManifest.version}).toEqual({
      license: "MIT", repository: "https://github.com/tree-sitter-grammars/tree-sitter-zig", version: "1.1.2"
    })
    expect(grammarManifest.peerDependencies).toEqual({"tree-sitter": "^0.22.1"})
    expect(bindingManifest.version).toEqual("0.22.4")
    expect({integrity: locked.integrity, license: locked.license, version: locked.version}).toEqual({
      integrity: "sha512-J0L31HZ2isy3F5zb2g5QWQOv2r/pbruQNL9ADhuQv2pn5BQOzxt80WcEJaYXBeuJ8GHxVT42slpCna8k1c8LOw==",
      license: "MIT", version: "1.1.2"
    })
    expect(declarations).toContain("nodeTypeInfo: NodeInfo[]")
    expect(grammar.name).toEqual("zig")
    expect(grammar.nodeTypeInfo.length).toEqual(242)
    expect(parserSource).toContain("#define LANGUAGE_VERSION 14")
  })

  it("retains every named, anonymous, extra, builtin and field edge as frozen plain data", async () => {
    const kinds = new Set()

    for (const name of fixtureNames) {
      const source = await readFile(new URL(`fixtures/zig-qualification/${name}.zig`, import.meta.url), "utf8")
      const snapshot = boundary.parseCst(source)

      expect(snapshot).toMatchObject({schema: "semantifold.parser-cst", version: 1, language: "zig"})
      expect(Object.isFrozen(snapshot)).toBeTrue()
      expect(snapshot.root.endIndex).toEqual(source.length)
      for (const node of descendants(snapshot.root)) {
        kinds.add(node.type)
        expect(Object.getPrototypeOf(node)).toEqual(Object.prototype)
        expect(Object.isFrozen(node)).toBeTrue()
        expect(Object.isFrozen(node.children)).toBeTrue()
        expect(Object.isFrozen(node.startPosition)).toBeTrue()
        expect(Object.isFrozen(node.endPosition)).toBeTrue()
        expect(node.error || node.missing || node.hasError).toBeFalse()
        assert.deepEqual(Object.keys(node).sort(), ["children", "endIndex", "endPosition", "error", "extra", "hasError", "missing", "named", "startIndex", "startPosition", "type"])
        for (const edge of node.children) {
          expect(Object.isFrozen(edge)).toBeTrue()
          assert.ok(edge.field === null || typeof edge.field == "string")
          assert.ok(edge.node.startIndex >= node.startIndex && edge.node.endIndex <= node.endIndex)
        }
      }
    }
    for (const kind of ["source_file", "function_declaration", "parameters", "parameter", "builtin_type", "slice_type",
      "variable_declaration", "return_expression", "if_statement", "else_clause", "call_expression",
      "binary_expression", "!", "builtin_function", "field_expression", "index_expression", "string",
      "string_content", "escape_sequence", "comment", "(", ")", "{", "}", ":", ";"]) {
      expect(kinds.has(kind)).toBeTrue()
    }
  })

  it("preserves exact astral/CRLF UTF-16 offsets and explicit recovery nodes", () => {
    const source = "// 😀\r\nfn copy(value: i64) i64 { return value; }\r\n"
    const root = boundary.parseCst(source).root
    const declaration = root.children.find(({node}) => node.type == "function_declaration")?.node

    expect(declaration?.startIndex).toEqual(7)
    expect(declaration?.startPosition).toEqual({column: 0, row: 1})
    expect(Buffer.byteLength(source.slice(0, 7))).toEqual(9)
    for (const broken of ["fn main() void {", "fn main( void {}", "fn main() void { @import(\"x\"; }"]) {
      const recovered = boundary.parseCst(broken).root

      expect(recovered.hasError).toBeTrue()
      expect(descendants(recovered).some(node => node.error || node.missing)).toBeTrue()
    }
  })

  it("passes the complete retained corpus through the exact formatter and compiler", {timeoutMs: 120_000}, async () => {
    const zig = await discoverCanonicalToolchain("zig")
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-zig-parser-differential-"))
    const fixtures = fixtureNames.map(name => fileURLToPath(new URL(`fixtures/zig-qualification/${name}.zig`, import.meta.url)))
    const before = await Promise.all(fixtures.map(filename => readFile(filename)))

    try {
      const environment = deterministicEnvironment({
        HOME: path.join(directory, "home"),
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "",
        PATH: process.env.PATH ?? "",
        TMPDIR: path.join(directory, "tmp"),
        ZIG_GLOBAL_CACHE_DIR: path.join(directory, "global-cache"),
        ZIG_LOCAL_CACHE_DIR: path.join(directory, "local-cache")
      })

      await Promise.all([environment.HOME, environment.TMPDIR].map(value => mkdir(value, {recursive: true})))
      const run = (arguments_) => {
        const result = spawnSync(zig.executable, arguments_, {
          cwd: directory, encoding: "utf8", env: environment, maxBuffer: 1024 * 1024, timeout: 30_000, killSignal: "SIGKILL"
        })

        if (result.error) throw result.error
        assert.equal(result.signal, null, JSON.stringify(result))
        assert.equal(result.status, 0, JSON.stringify(result))
      }

      run(["fmt", "--check", ...fixtures])
      for (const fixture of fixtures) run(["test", fixture])
      for (const [index, fixture] of fixtures.entries()) assert.deepEqual(await readFile(fixture), before[index])
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })
})
