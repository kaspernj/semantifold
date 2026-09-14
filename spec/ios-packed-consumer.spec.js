// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {
  alternateNpmEnvironment,
  iosPackedConsumerSource,
  iosTypeConsumerSource,
  registryEnvironment
} from "./support/ios-packed-consumer.js"
import {packRootPackage} from "./support/root-package-pack.js"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

describe("packed iOS application consumer", () => {
  it("generates through the packed public API after install and clean ci without a materializer surface", {timeoutMs: 300_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-ios-packed-"))
    const packDirectory = path.join(root, "pack")
    const consumerDirectory = path.join(root, "consumer")
    const userConfig = path.join(root, "empty-user.npmrc")
    const globalConfig = path.join(root, "empty-global.npmrc")
    const alternateConfig = path.join(root, "alternate.npmrc")

    try {
      await mkdir(packDirectory)
      await mkdir(consumerDirectory)
      await writeFile(userConfig, "")
      await writeFile(globalConfig, "")
      await writeFile(alternateConfig, "registry=https://global.invalid/\n@types:registry=https://scoped.invalid/\n")
      await writeFile(`${alternateConfig}.user`, "registry=https://user.invalid/\n")
      const sourceManifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"))
      const inherited = alternateNpmEnvironment(alternateConfig)
      const packEnvironment = registryEnvironment(path.join(root, "pack-cache"), userConfig, globalConfig, inherited)
      const packed = await packRootPackage(
        (executable, arguments_, options) => executeFile(executable, arguments_, {...options, env: packEnvironment}),
        repositoryRoot,
        packDirectory
      )
      const packResult = parsePackResult(packed.stdout)
      const packedFiles = packResult.files.map(({path: filename}) => filename)
      const tarball = path.join(packDirectory, packResult.filename)

      expect({name: packResult.name, version: packResult.version}).toEqual({name: "semantifold", version: sourceManifest.version})
      for (const filename of ["build/index.js", "build/index.d.ts"]) expect(packedFiles).toContain(filename)
      expect(packedFiles.filter(filename => /materialization/iu.test(filename))).toEqual([])
      expect(packedFiles.includes(".npmrc")).toBeFalse()
      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {semantifold: `file:${tarball}`},
        devDependencies: {"@types/node": "^24.3.0", typescript: "^7.0.0"},
        name: "semantifold-ios-packed-consumer",
        private: true,
        type: "module",
        version: "1.0.0"
      }, null, 2)}\n`)
      await writeFile(path.join(consumerDirectory, "consumer.mjs"), iosPackedConsumerSource)
      await writeFile(path.join(consumerDirectory, "type-consumer.mts"), iosTypeConsumerSource)
      const firstCache = path.join(root, "install-cache")
      const environment = registryEnvironment(firstCache, userConfig, globalConfig, inherited)
      const configured = JSON.parse((await executeFile("npm", ["config", "list", "--json"], {
        cwd: consumerDirectory,
        env: environment
      })).stdout)

      expect(configured.registry).toEqual("https://registry.npmjs.org/")
      expect(configured.userconfig).toEqual(userConfig)
      expect(configured.globalconfig).toEqual(globalConfig)
      expect(configured.cache).toEqual(firstCache)
      expect(configured["install-links"]).toBeFalse()
      expect(Object.keys(configured).some(name => name.endsWith(":registry"))).toBeFalse()
      for (const command of ["install", "ci"]) {
        if (command == "ci") environment.npm_config_cache = path.join(root, "ci-cache")
        await executeFile("npm", [command], {cwd: consumerDirectory, env: environment, maxBuffer: 20 * 1024 * 1024})
        for (const arguments_ of [["ls", "--omit=dev", "--all", "--json"], ["ls", "--all", "--json"]]) {
          const tree = JSON.parse((await executeFile("npm", arguments_, {
            cwd: consumerDirectory,
            env: environment,
            maxBuffer: 20 * 1024 * 1024
          })).stdout)

          expect(tree.problems).toEqual(undefined)
          expect(tree.dependencies.semantifold.version).toEqual(sourceManifest.version)
        }
        const executed = await executeFile(process.execPath, ["consumer.mjs"], {
          cwd: consumerDirectory,
          env: environment,
          maxBuffer: 10 * 1024 * 1024
        })

        expect(JSON.parse(executed.stdout)).toEqual({
          artifactCount: 14,
          entryModule: "main",
          manifestTarget: "ios",
          target: "ios"
        })
        const typed = await executeFile(path.join(consumerDirectory, "node_modules/.bin/tsc"), [
          "--module", "nodenext", "--moduleResolution", "nodenext", "--noEmit", "--strict",
          "--target", "ES2024", "--types", "node", "type-consumer.mts"
        ], {cwd: consumerDirectory, env: environment, maxBuffer: 10 * 1024 * 1024})

        expect(typed.stderr).toEqual("")
      }
      expect((await readdir(firstCache)).length > 0).toBeTrue()
      expect((await readdir(environment.npm_config_cache)).length > 0).toBeTrue()
      expect((await readdir(repositoryRoot)).some(filename => filename.endsWith(".tgz"))).toBeFalse()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

/** @param {string} output - npm pack JSON output. @returns {Record<string, any>} Sole pack result. */
function parsePackResult(output) {
  const start = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1)

  assert.notEqual(start, -1, output)
  const parsed = JSON.parse(output.slice(start == 0 ? 0 : start + 1))

  assert.equal(parsed.length, 1)

  return parsed[0]
}
