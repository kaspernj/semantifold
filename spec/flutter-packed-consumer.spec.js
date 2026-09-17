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
  filename: "program.dart",
  language: "dart",
  source: "void main() {\\n  print('packed!');\\n}\\n"
})
const set = semantifold.generateArtifactSet({language: "flutter", module, role: "application"})
const manifest = JSON.parse(set.artifacts.at(-1).content)
console.log(JSON.stringify({
  hasFlutterFrontend: semantifold.supportedLanguages.includes("flutter"),
  hasMaterializer: "materializeFlutterAcceptanceProject" in semantifold,
  iosArtifacts: set.artifacts.filter(({path}) => path.includes("/ios/")).length,
  locked: set.artifacts.find(({path}) => path.endsWith("pubspec.lock")).content.includes("flutter_test:"),
  platformQualification: set.metadata.platformQualification,
  schema: manifest.schema,
  target: set.target
}))
`
const typeConsumerSource = `import {generateArtifactSet, parse} from "semantifold"

const module = parse({
  filename: "program.dart",
  language: "dart",
  source: "void main() {\\n  print('typed');\\n}\\n"
})
const set = generateArtifactSet({
  assets: [],
  configuration: {
    applicationId: "dev.example.application",
    compileSdk: 35,
    minimumSdk: 23,
    organization: "dev.example",
    packageName: "example_application",
    targetSdk: 35
  },
  language: "flutter",
  module,
  role: "application"
})
void set
`

describe("packed Flutter application consumer", () => {
  it("generates through the credential-free packed API after install and clean ci without private acceptance helpers", {timeoutMs: 300_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-flutter-packed-"))
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

      expect(packedFiles).toContain("src/backends/flutter.js")
      expect(packedFiles.filter(filename => filename.includes("flutter-materialization") ||
        filename.includes("flutter-acceptance"))).toEqual([])
      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {semantifold: `file:${tarball}`},
        devDependencies: {"@types/node": "^24.3.0", typescript: "^7.0.0"},
        name: "semantifold-flutter-packed-consumer",
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
          hasFlutterFrontend: false,
          hasMaterializer: false,
          iosArtifacts: 0,
          locked: true,
          platformQualification: {android: "tensorbuzz-kvm", ios: "deferred-owner-direction"},
          schema: "SemantifoldFlutterProject",
          target: "flutter"
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

/**
 * Parses one npm pack JSON result.
 * @param {string} output - Complete npm output.
 * @returns {{filename: string, files: {path: string}[]}} Parsed pack result.
 */
function parsePackResult(output) {
  const start = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1)

  assert.notEqual(start, -1, output)
  const parsed = JSON.parse(output.slice(start == 0 ? 0 : start + 1))

  assert.equal(parsed.length, 1)

  return /** @type {{filename: string, files: {path: string}[]}} */ (parsed[0])
}
