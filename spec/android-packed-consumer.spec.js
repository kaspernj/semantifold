// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {alternateNpmEnvironment, registryEnvironment} from "./support/ios-packed-consumer.js"
import {packRootPackage} from "./support/root-package-pack.js"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const consumerSource = `import * as semantifold from "semantifold"

const module = semantifold.parse({
  filename: "program.kt",
  language: "kotlin",
  source: \`fun choose(value: String, suffix: String): String {
  return value + suffix
}
fun main() {
  println(choose("packed", "!"))
}
\`
})
const set = semantifold.generateArtifactSet({language: "android", module, role: "application"})
let rejected = false
try {
  semantifold.generateArtifactSet({language: "android", module, outputDirectory: "/tmp/output", role: "application"})
} catch (error) {
  rejected = error.code === "INVALID_APPLICATION_INPUT"
}
console.log(JSON.stringify({
  artifactCount: set.artifacts.length,
  entry: set.entry,
  hasMaterializer: "materializeAndroidAcceptanceProject" in semantifold,
  rejected,
  target: set.target
}))
`
const typeConsumerSource = `import {generateArtifactSet, parse} from "semantifold"

const module = parse({filename: "program.kt", language: "kotlin", source: \`fun choose(left: String, right: String): String {
  return left + right
}
fun main() {
  println(choose("a", "b"))
}
\`})
const set = generateArtifactSet({
  configuration: {applicationId: "dev.example.application", minimumSdk: 23, targetSdk: 35, compileSdk: 35},
  language: "android",
  module,
  role: "application"
})
void set
`

describe("packed Android application consumer", () => {
  it("generates through the credential-free packed API after install and clean ci without a public materializer", {timeoutMs: 300_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-packed-"))
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
      await writeFile(alternateConfig, "registry=https://global.invalid/\n")
      await writeFile(`${alternateConfig}.user`, "registry=https://user.invalid/\n")
      const inherited = alternateNpmEnvironment(alternateConfig)
      const packEnvironment = registryEnvironment(path.join(root, "pack-cache"), userConfig, globalConfig, inherited)
      const packed = await packRootPackage(
        (executable, arguments_, options) => executeFile(executable, arguments_, {...options, env: packEnvironment}),
        repositoryRoot,
        packDirectory
      )
      const result = parsePackResult(packed.stdout)
      const packedFiles = result.files.map(({path: filename}) => filename)
      const tarball = path.join(packDirectory, result.filename)

      expect(packedFiles).toContain("src/backends/android.js")
      expect(packedFiles.filter(filename => filename.includes("android-materialization"))).toEqual([])
      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {semantifold: `file:${tarball}`},
        devDependencies: {"@types/node": "^24.3.0", typescript: "^7.0.0"},
        name: "semantifold-android-packed-consumer",
        private: true,
        type: "module",
        version: "1.0.0"
      }, null, 2)}\n`)
      await writeFile(path.join(consumerDirectory, "consumer.mjs"), consumerSource)
      await writeFile(path.join(consumerDirectory, "type-consumer.mts"), typeConsumerSource)
      const environment = registryEnvironment(path.join(root, "install-cache"), userConfig, globalConfig, inherited)

      for (const command of ["install", "ci"]) {
        if (command == "ci") environment.npm_config_cache = path.join(root, "ci-cache")
        await executeFile("npm", [command], {cwd: consumerDirectory, env: environment, maxBuffer: 20 * 1024 * 1024})
        const executed = await executeFile(process.execPath, ["consumer.mjs"], {cwd: consumerDirectory, env: environment})

        expect(JSON.parse(executed.stdout)).toEqual({
          artifactCount: 15,
          entry: "generated/android-app/app/src/main/kotlin/dev/semantifold/generated/MainActivity.kt",
          hasMaterializer: false,
          rejected: true,
          target: "android"
        })
        await executeFile(path.join(consumerDirectory, "node_modules/.bin/tsc"), [
          "--module", "nodenext", "--moduleResolution", "nodenext", "--noEmit", "--strict", "--target", "ES2024",
          "--types", "node", "type-consumer.mts"
        ], {cwd: consumerDirectory, env: environment})
      }
      expect((await readdir(repositoryRoot)).some(filename => filename.endsWith(".tgz"))).toBeFalse()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

/** @param {string} output @returns {Record<string, any>} */
function parsePackResult(output) {
  const start = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1)

  assert.notEqual(start, -1, output)
  const parsed = JSON.parse(output.slice(start == 0 ? 0 : start + 1))

  assert.equal(parsed.length, 1)

  return parsed[0]
}
