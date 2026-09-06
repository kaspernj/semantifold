// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const packageName = "@kaspernj/semantifold-tree-sitter-legacy"
const expectedFiles = [
  "LICENSE", "README.md", "build/c.d.ts", "build/c.d.ts.map", "build/c.js", "package.json"
]

describe("packed legacy Tree-sitter adapter", () => {
  it("installs an exact isolated legacy runtime beside modern Go and exposes only frozen data", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-legacy-consumer-"))
    const packDirectory = path.join(temporaryRoot, "pack")
    const consumerDirectory = path.join(temporaryRoot, "consumer")

    try {
      await Promise.all([mkdir(packDirectory), mkdir(consumerDirectory)])
      const packed = await executeFile("npm", [
        "pack", `--workspace=${packageName}`, "--pack-destination", packDirectory, "--json"
      ], {cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024})
      const packResult = parsePackResult(packed.stdout)

      expect(packResult.files.map(({path: filename}) => filename)).toEqual(expectedFiles)
      expect(packResult.entryCount).toEqual(expectedFiles.length)
      expect(packResult.bundled).toEqual([])
      const tarball = path.join(packDirectory, packResult.filename)

      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {
          [packageName]: `file:${tarball}`,
          "tree-sitter": "0.25.1",
          "tree-sitter-go": "0.25.0"
        },
        name: "semantifold-legacy-packed-consumer",
        private: true,
        type: "module",
        version: "1.0.0"
      }, null, 2)}\n`)
      await writeFile(path.join(consumerDirectory, "consumer.mjs"), consumerSource)
      const installed = await executeFile("npm", ["install"], {
        cwd: consumerDirectory, env: registryEnvironment(), maxBuffer: 10 * 1024 * 1024
      })

      expect(installed.stderr).not.toMatch(/ERESOLVE|peer dep|overrid/iu)
      const listed = await executeFile("npm", ["ls", "--all", "--json"], {
        cwd: consumerDirectory, env: registryEnvironment(), maxBuffer: 10 * 1024 * 1024
      })
      const dependencyTree = JSON.parse(listed.stdout)
      const adapter = dependencyTree.dependencies[packageName]

      expect(dependencyTree.problems).toEqual(undefined)
      expect(dependencyTree.dependencies["tree-sitter"].version).toEqual("0.25.1")
      expect(dependencyTree.dependencies["tree-sitter-go"].version).toEqual("0.25.0")
      expect(adapter.version).toEqual("0.1.0")
      expect(adapter.dependencies["tree-sitter"].version).toEqual("0.21.1")
      expect(adapter.dependencies["tree-sitter-c"].version).toEqual("0.23.2")
      const executed = await executeFile(process.execPath, ["consumer.mjs"], {
        cwd: consumerDirectory, maxBuffer: 10 * 1024 * 1024
      })
      const proof = JSON.parse(executed.stdout)

      expect(proof).toEqual({
        cGrammarVersion: "0.23.2",
        cRoot: "translation_unit",
        grammarIsAdapterLocal: true,
        goRoot: "source_file",
        legacyRuntimeIsAdapterLocal: true,
        legacyRuntimeVersion: "0.21.1",
        modernRuntimeVersion: "0.25.1",
        pathsAreDistinct: true,
        snapshotIsPlainFrozenData: true
      })
      expect((await readdir(repositoryRoot)).some((filename) => filename.endsWith(".tgz"))).toBeFalse()
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true})
    }
  })
})

/** @param {string} output */
function parsePackResult(output) {
  const arrayStart = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1)

  assert.notEqual(arrayStart, -1, output)
  const parsed = JSON.parse(output.slice(arrayStart == 0 ? 0 : arrayStart + 1))

  assert.equal(parsed.length, 1)
  return parsed[0]
}

function registryEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    return !/^(?:NODE_AUTH_TOKEN|NPM_TOKEN)$/iu.test(name) && !/^npm_config_.*(?:auth|token)/iu.test(name)
  }))
}

const consumerSource = `
import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {createRequire} from "node:module"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {parseCst} from "@kaspernj/semantifold-tree-sitter-legacy/c"
import Parser from "tree-sitter"
import GoLanguage from "tree-sitter-go/bindings/node/index.js"

const require = createRequire(import.meta.url)
const adapterEntry = fileURLToPath(import.meta.resolve("@kaspernj/semantifold-tree-sitter-legacy/c"))
const adapterDirectory = path.dirname(path.dirname(adapterEntry))
const adapterRequire = createRequire(adapterEntry)
const modernRuntimePath = require.resolve("tree-sitter")
const legacyRuntimePath = adapterRequire.resolve("tree-sitter")
const cGrammarPath = adapterRequire.resolve("tree-sitter-c")
const modernRuntime = JSON.parse(await readFile(require.resolve("tree-sitter/package.json"), "utf8"))
const legacyRuntime = JSON.parse(await readFile(adapterRequire.resolve("tree-sitter/package.json"), "utf8"))
const cGrammar = JSON.parse(await readFile(adapterRequire.resolve("tree-sitter-c/package.json"), "utf8"))
const goParser = new Parser()

goParser.setLanguage(GoLanguage)
const goTree = goParser.parse("package main\\nfunc main() {}\\n")
const cSnapshot = parseCst("/* 😀 */\\r\\nint main(void) { return 0; }\\r\\n")

function isPlainFrozenData(value) {
  if (value == null || ["boolean", "number", "string"].includes(typeof value)) return true
  if (typeof value != "object" || !Object.isFrozen(value)) return false
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false
  return Reflect.ownKeys(value).every((key) => typeof key == "string" && isPlainFrozenData(value[key]))
}

assert.equal(goTree.rootNode.hasError, false)
assert.equal(cSnapshot.root.hasError, false)
assert.equal(cSnapshot.root.endIndex, "/* 😀 */\\r\\nint main(void) { return 0; }\\r\\n".length)
assert.deepEqual(JSON.parse(JSON.stringify(cSnapshot)), cSnapshot)
process.stdout.write(JSON.stringify({
  cGrammarVersion: cGrammar.version,
  cRoot: cSnapshot.root.type,
  grammarIsAdapterLocal: cGrammarPath.startsWith(adapterDirectory + path.sep),
  goRoot: goTree.rootNode.type,
  legacyRuntimeIsAdapterLocal: legacyRuntimePath.startsWith(adapterDirectory + path.sep),
  legacyRuntimeVersion: legacyRuntime.version,
  modernRuntimeVersion: modernRuntime.version,
  pathsAreDistinct: modernRuntimePath !== legacyRuntimePath,
  snapshotIsPlainFrozenData: isPlainFrozenData(cSnapshot)
}))
`
