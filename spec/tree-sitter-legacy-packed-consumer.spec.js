// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {consumerSource, typeConsumerSource} from "./support/packed-consumer.js"

const rawExecuteFile = promisify(execFile)
const executeFile = async (executable, args, options = {}) => {
  const record = async (result, status) => {
    if (!process.env.SEMANTIFOLD_PACK_EVIDENCE) return
    await mkdir(process.env.SEMANTIFOLD_PACK_EVIDENCE, {recursive: true})
    await appendFile(path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, "commands.jsonl"), JSON.stringify({executable, arguments: args,
      cwd: options.cwd, status, stdout: Buffer.isBuffer(result.stdout) ? {bytes: result.stdout.length} : result.stdout,
      stderr: Buffer.isBuffer(result.stderr) ? {bytes: result.stderr.length} : result.stderr}) + "\n")
  }
  let result

  try {
    result = await rawExecuteFile(executable, args, options)
  } catch (error) {
    await record(error, error.code)
    throw error
  }
  await record(result, 0)
  return result
}
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const internalPackageName = "semantifold-tree-sitter-legacy-internal"
const retiredPackageName = "@kaspernj/semantifold-tree-sitter-legacy"
const modernTreeSitterRoot = "node_modules/tree-sitter"
const kotlinGrammarRoot = "node_modules/tree-sitter-kotlin"
const kotlinGrammarCommit = "57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0"
const kotlinGrammarSource = `https://github.com/kaspernj/tree-sitter-kotlin/archive/${kotlinGrammarCommit}.tar.gz`
const internalPackageRoot = `node_modules/${internalPackageName}`
const legacyTreeSitterRoot = `${internalPackageRoot}/node_modules/tree-sitter`
const cGrammarRoot = `${internalPackageRoot}/node_modules/tree-sitter-c`
const rustGrammarRoot = `${internalPackageRoot}/node_modules/tree-sitter-rust`
const cppGrammarRoot = `${internalPackageRoot}/node_modules/tree-sitter-cpp`
const requiredPackedFiles = [
  `${rustGrammarRoot}/LICENSE`, `${rustGrammarRoot}/package.json`, `${rustGrammarRoot}/binding.gyp`,
  `${rustGrammarRoot}/bindings/node/index.d.ts`, `${rustGrammarRoot}/src/parser.c`, `${rustGrammarRoot}/src/scanner.c`,
  `${cppGrammarRoot}/LICENSE`,
  `${cppGrammarRoot}/binding.gyp`,
  `${cppGrammarRoot}/package.json`,
  `${cppGrammarRoot}/bindings/node/index.d.ts`,
  `${cppGrammarRoot}/src/parser.c`,
  `${cppGrammarRoot}/src/scanner.c`,
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
  ...platformPrebuilds(rustGrammarRoot, "tree-sitter-rust", [
    "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"
  ]),
  ...platformPrebuilds(cppGrammarRoot, "tree-sitter-cpp", [
    "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"
  ]),
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

  it("installs both bundled runtimes and the HTTPS Kotlin grammar with only frozen legacy data", async () => {
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
      const sourceManifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"))
      const packed = await executeFile("npm", [
        "pack", "--pack-destination", packDirectory, "--json"
      ], {cwd: repositoryRoot, maxBuffer: 20 * 1024 * 1024})
      const packResult = parsePackResult(packed.stdout)
      const packedFiles = packResult.files.map(({path: filename}) => filename)
      const bundledPackages = new Set(packResult.bundled)

      expect({name: packResult.name, version: packResult.version}).toEqual({name: "semantifold", version: sourceManifest.version})
      for (const packageName of [internalPackageName, "node-addon-api", "node-gyp-build", "tree-sitter"]) {
        expect(bundledPackages.has(packageName)).toBeTrue()
      }
      expect(bundledPackages.has("tree-sitter-kotlin")).toBeFalse()
      for (const filename of [...requiredPackedFiles, ...requiredPrebuilds]) {
        expect(packedFiles.includes(filename)).toBeTrue()
      }
      expect(packedFiles.some((filename) => filename.startsWith("packages/tree-sitter-legacy/"))).toBeFalse()
      expect(packedFiles.some((filename) => filename.startsWith(`${kotlinGrammarRoot}/`))).toBeFalse()
      expect(packedFiles.includes(".npmrc")).toBeFalse()
      expect(packedFiles.some((filename) => /node_modules\/[^/]+\/build\/(?:Debug|Release)\//u.test(filename))).toBeFalse()
      const tarball = path.join(packDirectory, packResult.filename)

      if (process.env.SEMANTIFOLD_PACK_EVIDENCE) {
        await mkdir(process.env.SEMANTIFOLD_PACK_EVIDENCE, {recursive: true})
        await copyFile(tarball, path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, packResult.filename))
        await writeFile(path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, "pack-result.json"), JSON.stringify(packResult, null, 2) + "\n")
        await writeFile(path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, "consumer.mjs"), consumerSource)
        await writeFile(path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, "type-consumer.mts"), typeConsumerSource)
      }

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
        if (command == "ci") {
          const cleanCache = path.join(temporaryRoot, "npm-ci-cache")

          await mkdir(cleanCache)
          consumerEnvironment.npm_config_cache = cleanCache
        }
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
        expect(semantifold.version).toEqual(sourceManifest.version)
        expect(semantifold.dependencies["tree-sitter"].version).toEqual("0.25.1")
        expect(semantifold.dependencies["tree-sitter-kotlin"].version).toEqual("0.4.0")
        expect(internalPackage.version).toEqual("0.1.0")
        expect(internalPackage.dependencies["tree-sitter"].version).toEqual("0.21.1")
        expect(internalPackage.dependencies["tree-sitter-c"].version).toEqual("0.23.2")
        expect(internalPackage.dependencies["tree-sitter-cpp"].version).toEqual("0.23.4")
        expect(internalPackage.dependencies["tree-sitter-rust"].version).toEqual("0.23.1")
        expect(semantifold.dependencies[retiredPackageName]).toEqual(undefined)
        const installedLock = JSON.parse(await readFile(path.join(consumerDirectory, "package-lock.json"), "utf8"))
        const installedPackagePaths = Object.keys(installedLock.packages)

        for (const packageRoot of [modernTreeSitterRoot, internalPackageRoot, legacyTreeSitterRoot, cGrammarRoot, cppGrammarRoot,
          rustGrammarRoot]) {
          const entry = installedLock.packages[`node_modules/semantifold/${packageRoot}`]

          expect(entry.inBundle).toBeTrue()
          expect(entry.link).toEqual(undefined)
          expect(entry.resolved).toEqual(undefined)
        }
        const kotlinEntries = Object.entries(installedLock.packages).filter(([filename]) =>
          filename == kotlinGrammarRoot || filename.endsWith(`/${kotlinGrammarRoot}`))

        expect(kotlinEntries.length).toEqual(1)
        const kotlinEntry = kotlinEntries[0][1]

        expect(kotlinEntry.inBundle).toEqual(undefined)
        expect(kotlinEntry.resolved).toEqual(kotlinGrammarSource)
        expect(kotlinEntry.integrity).toMatch(/^sha512-/u)
        expect(installedPackagePaths.some((filename) => filename.includes(retiredPackageName))).toBeFalse()
        expect(JSON.stringify(installedLock)).not.toMatch(/git\+ssh/u)
        expect(installedPackagePaths.some((filename) => filename.includes("packages/tree-sitter-legacy"))).toBeFalse()
        const executed = await executeFile(process.execPath, ["consumer.mjs"], {
          cwd: consumerDirectory, env: consumerEnvironment, maxBuffer: 10 * 1024 * 1024
        })
        const proof = JSON.parse(executed.stdout)

        if (process.env.SEMANTIFOLD_PACK_EVIDENCE) {
          await copyFile(path.join(consumerDirectory, "rust-command-results.json"),
            path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, command + "-rust-command-results.json"))
          await copyFile(path.join(consumerDirectory, "kotlin-command-results.json"),
            path.join(process.env.SEMANTIFOLD_PACK_EVIDENCE, command + "-kotlin-command-results.json"))
        }

        expect(proof.kotlinCompilerVersion).toMatch(/^info: kotlinc-jvm 2\.4\.20 \(JRE 25\.0\.4\+7-1-(?:24|26)\.04-Ubuntu\)$/u)
        delete proof.kotlinCompilerVersion
        expect(proof).toEqual({
          rustGrammarVersion: "0.23.1",
          rustGrammarIsInternal: true,
          rustSnapshotIsPlainFrozenData: true,
          rustRoundTrip: true,
          rustNativeModes: ["debug", "release"],
          rustArtifactsStable: true,
          cppGrammarVersion: "0.23.4",
          cppGrammarIsInternal: true,
          cppSnapshotIsPlainFrozenData: true,
          cppRoundTrip: true,
          cGrammarVersion: "0.23.2",
          cRoot: "translation_unit",
          grammarIsInternal: true,
          goRoot: "source_file",
          kotlinGrammarVersion: "0.4.0",
          kotlinGrammarIsInstalled: true,
          kotlinJavaVersion: 'openjdk version "25.0.4" 2026-07-21',
          kotlinRoundTrip: true,
          kotlinRuntimeOutput: "3\n",
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
