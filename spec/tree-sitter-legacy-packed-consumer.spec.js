// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const internalPackageName = "semantifold-tree-sitter-legacy-internal"
const retiredPackageName = "@kaspernj/semantifold-tree-sitter-legacy"
const modernTreeSitterRoot = "node_modules/tree-sitter"
const internalPackageRoot = `node_modules/${internalPackageName}`
const legacyTreeSitterRoot = `${internalPackageRoot}/node_modules/tree-sitter`
const cGrammarRoot = `${internalPackageRoot}/node_modules/tree-sitter-c`
const requiredPackedFiles = [
  `${modernTreeSitterRoot}/LICENSE`,
  `${modernTreeSitterRoot}/binding.gyp`,
  `${modernTreeSitterRoot}/package.json`,
  `${modernTreeSitterRoot}/vendor/tree-sitter/lib/src/lib.c`,
  `${internalPackageRoot}/LICENSE`,
  `${internalPackageRoot}/README.md`,
  `${internalPackageRoot}/package.json`,
  `${internalPackageRoot}/src/c.js`,
  `${legacyTreeSitterRoot}/LICENSE`,
  `${legacyTreeSitterRoot}/binding.gyp`,
  `${legacyTreeSitterRoot}/package.json`,
  `${legacyTreeSitterRoot}/vendor/tree-sitter/lib/src/lib.c`,
  `${cGrammarRoot}/LICENSE`,
  `${cGrammarRoot}/binding.gyp`,
  `${cGrammarRoot}/package.json`,
  `${cGrammarRoot}/src/parser.c`
]
const requiredPrebuilds = [
  ...platformPrebuilds(modernTreeSitterRoot, "tree-sitter", [
    "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"
  ]),
  ...platformPrebuilds(legacyTreeSitterRoot, "tree-sitter", [
    "darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"
  ]),
  ...platformPrebuilds(cGrammarRoot, "tree-sitter-c", [
    "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"
  ])
]

describe("packed Semantifold legacy Tree-sitter boundary", () => {
  it("isolates npm's effective configuration from inherited alternate registries and credentials", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-npm-config-"))
    const userConfig = path.join(temporaryRoot, "user.npmrc")
    const globalConfig = path.join(temporaryRoot, "global.npmrc")
    const alternateConfig = path.join(temporaryRoot, "alternate.npmrc")
    const cacheDirectory = path.join(temporaryRoot, "cache")

    try {
      await writeFile(userConfig, "")
      await writeFile(globalConfig, "")
      await writeFile(alternateConfig, "registry=https://global.invalid/\n@types:registry=https://scoped.invalid/\n")
      await writeFile(`${alternateConfig}.user`, "registry=https://user.invalid/\n")
      const inherited = alternateNpmEnvironment(alternateConfig)
      const before = await executeFile("npm", ["config", "get", "registry"], {
        cwd: temporaryRoot, env: inherited
      })

      expect(before.stdout.trim()).toEqual("https://environment.invalid/")
      const environment = registryEnvironment(cacheDirectory, userConfig, globalConfig, inherited)
      const configured = await executeFile("npm", ["config", "list", "--json"], {
        cwd: temporaryRoot, env: environment
      })
      const effective = JSON.parse(configured.stdout)

      expect(effective.registry).toEqual("https://registry.npmjs.org/")
      expect(effective.userconfig).toEqual(userConfig)
      expect(effective.globalconfig).toEqual(globalConfig)
      expect(effective.cache).toEqual(cacheDirectory)
      expect(effective["install-links"]).toBeFalse()
      expect(Object.keys(effective).some((name) => name.endsWith(":registry"))).toBeFalse()
      for (const name of Object.keys(inherited)) {
        if (/^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NODE_PATH)$/iu.test(name) ||
          /^npm_config_/iu.test(name)) expect(Object.hasOwn(environment, name)).toBeFalse()
      }
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true})
    }
  })

  it("installs both bundled runtimes from one root tarball and exposes only frozen data", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-packed-consumer-"))
    const packDirectory = path.join(temporaryRoot, "pack")
    const consumerDirectory = path.join(temporaryRoot, "consumer")
    const cacheDirectory = path.join(temporaryRoot, "npm-cache")
    const userConfig = path.join(temporaryRoot, "empty-npmrc")
    const globalConfig = path.join(temporaryRoot, "empty-global-npmrc")
    const alternateConfig = path.join(temporaryRoot, "alternate.npmrc")

    try {
      await Promise.all([mkdir(packDirectory), mkdir(consumerDirectory), mkdir(cacheDirectory)])
      await writeFile(userConfig, "")
      await writeFile(globalConfig, "")
      await writeFile(alternateConfig, "registry=https://global.invalid/\n@types:registry=https://scoped.invalid/\n")
      await writeFile(`${alternateConfig}.user`, "registry=https://user.invalid/\n")
      const packed = await executeFile("npm", [
        "pack", "--pack-destination", packDirectory, "--json"
      ], {cwd: repositoryRoot, maxBuffer: 20 * 1024 * 1024})
      const packResult = parsePackResult(packed.stdout)
      const packedFiles = packResult.files.map(({path: filename}) => filename)
      const bundledPackages = new Set(packResult.bundled)

      expect({name: packResult.name, version: packResult.version}).toEqual({name: "semantifold", version: "0.2.0"})
      for (const packageName of [internalPackageName, "node-addon-api", "node-gyp-build", "tree-sitter"]) {
        expect(bundledPackages.has(packageName)).toBeTrue()
      }
      for (const filename of [...requiredPackedFiles, ...requiredPrebuilds]) {
        expect(packedFiles.includes(filename)).toBeTrue()
      }
      expect(packedFiles.some((filename) => filename.startsWith("packages/tree-sitter-legacy/"))).toBeFalse()
      expect(packedFiles.includes(".npmrc")).toBeFalse()
      expect(packedFiles.some((filename) => /node_modules\/[^/]+\/build\/(?:Debug|Release)\//u.test(filename))).toBeFalse()
      const tarball = path.join(packDirectory, packResult.filename)

      for (const filename of packedFiles.filter((filename) => filename.startsWith(`${internalPackageRoot}/`) &&
        !filename.startsWith(`${internalPackageRoot}/node_modules/`))) {
        const relative = filename.slice(internalPackageRoot.length + 1)
        const source = await readFile(path.join(repositoryRoot, "packages/tree-sitter-legacy/runtime", relative))
        const extracted = await executeFile("tar", ["-xOf", tarball, `package/${filename}`], {
          encoding: "buffer", maxBuffer: 10 * 1024 * 1024
        })

        assert.deepEqual(extracted.stdout, source, `Bundled runtime payload differs: ${relative}`)
      }

      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {semantifold: `file:${tarball}`},
        devDependencies: {"@types/node": "^24.3.0", typescript: "^7.0.0"},
        name: "semantifold-packed-consumer",
        private: true,
        type: "module",
        version: "1.0.0"
      }, null, 2)}\n`)
      await writeFile(path.join(consumerDirectory, "consumer.mjs"), consumerSource)
      await writeFile(path.join(consumerDirectory, "type-consumer.mts"), typeConsumerSource)
      const consumerEnvironment = registryEnvironment(
        cacheDirectory, userConfig, globalConfig, alternateNpmEnvironment(alternateConfig)
      )
      const configured = await executeFile("npm", ["config", "list", "--json"], {
        cwd: consumerDirectory, env: consumerEnvironment
      })
      const effective = JSON.parse(configured.stdout)

      expect(effective.registry).toEqual("https://registry.npmjs.org/")
      expect(effective.userconfig).toEqual(userConfig)
      expect(effective.globalconfig).toEqual(globalConfig)
      expect(effective.cache).toEqual(cacheDirectory)
      expect(effective["install-links"]).toBeFalse()
      expect(Object.keys(effective).some((name) => name.endsWith(":registry"))).toBeFalse()
      for (const command of ["install", "ci"]) {
        const installed = await executeFile("npm", [command], {
          cwd: consumerDirectory, env: consumerEnvironment, maxBuffer: 20 * 1024 * 1024
        })

        expect(installed.stderr).not.toMatch(/ERESOLVE|legacy-peer-deps|overrid/iu)
        const listed = await executeFile("npm", ["ls", "--all", "--json"], {
          cwd: consumerDirectory, env: consumerEnvironment, maxBuffer: 20 * 1024 * 1024
        })
        const dependencyTree = JSON.parse(listed.stdout)
        const semantifold = dependencyTree.dependencies.semantifold
        const internalPackage = semantifold.dependencies[internalPackageName]

        expect(dependencyTree.problems).toEqual(undefined)
        expect(semantifold.version).toEqual("0.2.0")
        expect(semantifold.dependencies["tree-sitter"].version).toEqual("0.25.1")
        expect(internalPackage.version).toEqual("0.1.0")
        expect(internalPackage.dependencies["tree-sitter"].version).toEqual("0.21.1")
        expect(internalPackage.dependencies["tree-sitter-c"].version).toEqual("0.23.2")
        expect(semantifold.dependencies[retiredPackageName]).toEqual(undefined)
        const installedLock = JSON.parse(await readFile(path.join(consumerDirectory, "package-lock.json"), "utf8"))
        const installedPackagePaths = Object.keys(installedLock.packages)

        for (const packageRoot of [modernTreeSitterRoot, internalPackageRoot, legacyTreeSitterRoot, cGrammarRoot]) {
          const entry = installedLock.packages[`node_modules/semantifold/${packageRoot}`]

          expect(entry.inBundle).toBeTrue()
          expect(entry.link).toEqual(undefined)
          expect(entry.resolved).toEqual(undefined)
        }
        expect(installedPackagePaths.some((filename) => filename.includes(retiredPackageName))).toBeFalse()
        expect(installedPackagePaths.some((filename) => filename.includes("packages/tree-sitter-legacy"))).toBeFalse()
        const executed = await executeFile(process.execPath, ["consumer.mjs"], {
          cwd: consumerDirectory, env: consumerEnvironment, maxBuffer: 10 * 1024 * 1024
        })
        const proof = JSON.parse(executed.stdout)

        expect(proof).toEqual({
          cGrammarVersion: "0.23.2",
          cRoot: "translation_unit",
          grammarIsInternal: true,
          goRoot: "source_file",
          internalPackageIsNotConsumerDependency: true,
          internalPackageIsPrivate: true,
          legacyRuntimeIsInternal: true,
          legacyRuntimeVersion: "0.21.1",
          modernRuntimeIsBundled: true,
          modernRuntimeVersion: "0.25.1",
          pathsAreDistinct: true,
          retiredPackageIsAbsent: true,
          rootApiIsPrivate: true,
          snapshotIsPlainFrozenData: true
        })
        const typed = await executeFile(path.join(consumerDirectory, "node_modules/.bin/tsc"), [
          "--module", "nodenext", "--moduleResolution", "nodenext", "--noEmit", "--strict",
          "--target", "ES2024", "--types", "node", "type-consumer.mts"
        ], {cwd: consumerDirectory, env: consumerEnvironment, maxBuffer: 10 * 1024 * 1024})

        expect(typed.stderr).toEqual("")
      }
      const cache = await executeFile("npm", ["cache", "ls"], {
        cwd: consumerDirectory, env: consumerEnvironment, maxBuffer: 10 * 1024 * 1024
      })
      const requests = decodeURIComponent(cache.stdout).split("\n").filter((line) => line.includes("request-cache:"))

      expect(requests.some((line) => line.includes("https://registry.npmjs.org/"))).toBeTrue()
      expect(requests.some((line) => line.includes(internalPackageName) || line.includes(retiredPackageName))).toBeFalse()
      expect((await readdir(cacheDirectory)).length > 0).toBeTrue()
      expect((await readdir(repositoryRoot)).some((filename) => filename.endsWith(".tgz"))).toBeFalse()
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true})
    }
  })
})

/**
 * @param {string} packageRoot
 * @param {string} binaryName
 * @param {readonly string[]} platforms
 */
function platformPrebuilds(packageRoot, binaryName, platforms) {
  return platforms.map((platform) => `${packageRoot}/prebuilds/${platform}/${binaryName}.node`)
}

/** @param {string} output */
function parsePackResult(output) {
  const arrayStart = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1)

  assert.notEqual(arrayStart, -1, output)
  const parsed = JSON.parse(output.slice(arrayStart == 0 ? 0 : arrayStart + 1))

  assert.equal(parsed.length, 1)
  return parsed[0]
}

/**
 * @param {string} cacheDirectory
 * @param {string} userConfig
 * @param {string} globalConfig
 * @param {NodeJS.ProcessEnv} inheritedEnvironment
 */
function registryEnvironment(cacheDirectory, userConfig, globalConfig, inheritedEnvironment) {
  const environment = Object.fromEntries(Object.entries(inheritedEnvironment).filter(([name]) => {
    return !/^(?:npm_config_|NODE_AUTH_TOKEN$|NPM_TOKEN$|NODE_PATH$)/iu.test(name)
  }))

  return {
    ...environment,
    npm_config_audit: "false",
    npm_config_cache: cacheDirectory,
    npm_config_fund: "false",
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_registry: "https://registry.npmjs.org/"
  }
}

/** @param {string} alternateConfig */
function alternateNpmEnvironment(alternateConfig) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(?:npm_config_|NODE_AUTH_TOKEN$|NPM_TOKEN$|NODE_PATH$)/iu.test(name)))

  return {
    ...environment,
    NPM_CONFIG_USERCONFIG: `${alternateConfig}.user`,
    NPM_CONFIG_GLOBALCONFIG: alternateConfig,
    NPM_CONFIG_REGISTRY: "https://environment.invalid/",
    NPM_CONFIG_INSTALL_LINKS: "false",
    "NpM_CoNfIg_@types:registry": "https://environment-scoped.invalid/",
    "NpM_CoNfIg_//registry.npmjs.org/:_authToken": "synthetic-token",
    NpM_CoNfIg_username: "synthetic-user",
    NpM_CoNfIg__password: "c3ludGhldGlj",
    NpM_CoNfIg_proxy: "http://synthetic-user:synthetic-password@proxy.invalid/",
    NoDe_AuTh_ToKeN: "synthetic-node-token",
    NpM_ToKeN: "synthetic-npm-token",
    NoDe_PaTh: "/synthetic/unused/modules"
  }
}

const typeConsumerSource = `
import {generateArtifactSet, parse, supportedLanguages} from "semantifold"

const parser: typeof parse = parse
const languages: readonly string[] = supportedLanguages
const cModule = parse({language: "c", filename: "program.c", source: ""})
const cArtifacts = generateArtifactSet({language: "c", module: cModule})

void parser
void languages
void cArtifacts
`

const consumerSource = `
import assert from "node:assert/strict"
import {readFile, realpath} from "node:fs/promises"
import {createRequire} from "node:module"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import * as semantifold from "semantifold"

const internalPackageName = "${internalPackageName}"
const retiredPackageName = "${retiredPackageName}"
const consumerRequire = createRequire(import.meta.url)
const semantifoldEntry = fileURLToPath(import.meta.resolve("semantifold"))
const semantifoldDirectory = path.dirname(path.dirname(semantifoldEntry))
const semantifoldRequire = createRequire(semantifoldEntry)
const internalEntry = semantifoldRequire.resolve(internalPackageName)
const internalDirectory = path.dirname(path.dirname(internalEntry))
const internalRequire = createRequire(internalEntry)
const modernRuntimePath = semantifoldRequire.resolve("tree-sitter")
const legacyRuntimePath = internalRequire.resolve("tree-sitter")
const cGrammarPath = internalRequire.resolve("tree-sitter-c")
const goGrammarPath = semantifoldRequire.resolve("tree-sitter-go/bindings/node/index.js")
const modernRuntime = JSON.parse(await readFile(semantifoldRequire.resolve("tree-sitter/package.json"), "utf8"))
const legacyRuntime = JSON.parse(await readFile(internalRequire.resolve("tree-sitter/package.json"), "utf8"))
const cGrammar = JSON.parse(await readFile(internalRequire.resolve("tree-sitter-c/package.json"), "utf8"))
const internalManifest = JSON.parse(await readFile(path.join(internalDirectory, "package.json"), "utf8"))

for (const filename of [semantifoldEntry, internalEntry, modernRuntimePath, legacyRuntimePath, cGrammarPath]) {
  assert.ok((await realpath(filename)).startsWith(path.join(process.cwd(), "node_modules") + path.sep))
}
const {parseCst} = await import(pathToFileURL(internalEntry).href)
const {default: Parser} = await import(pathToFileURL(modernRuntimePath).href)
const {default: GoLanguage} = await import(pathToFileURL(goGrammarPath).href)
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
const semanticC = semantifold.parse({language: "c", filename: "program.c", source:
  '#include "semantifold_runtime.h"\\nstatic int64_t add(int64_t left, int64_t right) { return left + right; }\\n' +
  'int main(void) { semantifold_print_integer(add(1, 2)); semantifold_cleanup(); return 0; }\\n'})
const cArtifacts = semantifold.generateArtifactSet({language: "c", module: semanticC})
assert.deepEqual(cArtifacts.artifacts.map(({path: artifactPath}) => artifactPath), ["program.c", "semantifold_runtime.h"])
assert.equal(semantifold.parse({language: "c", filename: "program.c", source: cArtifacts.artifacts[0].content}).functions[0].name, "add")
assert.throws(() => consumerRequire.resolve(internalPackageName), {code: "MODULE_NOT_FOUND"})
assert.throws(() => semantifoldRequire.resolve(retiredPackageName), {code: "MODULE_NOT_FOUND"})
process.stdout.write(JSON.stringify({
  cGrammarVersion: cGrammar.version,
  cRoot: cSnapshot.root.type,
  grammarIsInternal: cGrammarPath.startsWith(internalDirectory + path.sep),
  goRoot: goTree.rootNode.type,
  internalPackageIsNotConsumerDependency: true,
  internalPackageIsPrivate: internalManifest.private === true && internalManifest.exports === undefined,
  legacyRuntimeIsInternal: legacyRuntimePath.startsWith(internalDirectory + path.sep),
  legacyRuntimeVersion: legacyRuntime.version,
  modernRuntimeIsBundled: modernRuntimePath.startsWith(semantifoldDirectory + path.sep),
  modernRuntimeVersion: modernRuntime.version,
  pathsAreDistinct: modernRuntimePath !== legacyRuntimePath,
  retiredPackageIsAbsent: true,
  rootApiIsPrivate: !("parseCst" in semantifold),
  snapshotIsPlainFrozenData: isPlainFrozenData(cSnapshot)
}))
`
