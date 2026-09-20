// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {lstat, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {alternateNpmEnvironment, registryEnvironment} from "./support/ios-packed-consumer.js"
import {packRootPackage} from "./support/root-package-pack.js"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

describe("packed Semantifold project CLI consumer", () => {
  it("installs, typechecks, and executes the credential-free package bin after install and clean ci", {timeoutMs: 300_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-packed-"))
    const packDirectory = path.join(root, "pack")
    const consumerDirectory = path.join(root, "consumer")
    const userConfig = path.join(root, "empty-user.npmrc")
    const globalConfig = path.join(root, "empty-global.npmrc")
    const alternateConfig = path.join(root, "alternate.npmrc")

    try {
      await Promise.all([mkdir(packDirectory), mkdir(consumerDirectory)])
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
      const packResult = parsePackResult(packed.stdout)
      const packedBin = packResult.files.find(({path: filename}) => filename == "bin/semantifold.js")
      const tarball = path.join(packDirectory, packResult.filename)

      expect(packedBin).toMatchObject({mode: 0o755})
      const packedPackage = JSON.parse((await executeFile("tar", ["-xOf", tarball, "package/package.json"])).stdout)

      expect(packedPackage.bin).toEqual({semantifold: "bin/semantifold.js"})
      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {semantifold: `file:${tarball}`},
        devDependencies: {"@types/node": "^24.3.0", typescript: "^7.0.0"},
        name: "semantifold-task039-consumer",
        private: true,
        type: "module",
        version: "1.0.0"
      }, null, 2)}\n`)
      await mkdir(path.join(consumerDirectory, "src"))
      await writeFile(path.join(consumerDirectory, "src/main.js"), "console.log(\"packed\")\n")
      await writeFile(path.join(consumerDirectory, "semantifold.json"), `${JSON.stringify({
        id: "packed-project",
        publicationRoot: ".semantifold",
        schema: "SemantifoldProject",
        sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}],
        targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}],
        version: 1
      }, null, 2)}\n`)
      await writeFile(path.join(consumerDirectory, "type-consumer.mts"), `import {createTargetCheckPlan, ProjectBuilder, SemantifoldCli, TargetCheckRunner} from "semantifold"
void new ProjectBuilder()
void new SemantifoldCli()
void new TargetCheckRunner()
void createTargetCheckPlan
`)
      const environment = registryEnvironment(path.join(root, "install-cache"), userConfig, globalConfig, inherited)

      for (const command of ["install", "ci"]) {
        if (command == "ci") environment.npm_config_cache = path.join(root, "ci-cache")
        expect((await executeFile("npm", ["config", "get", "install-links"], {
          cwd: consumerDirectory,
          env: environment
        })).stdout.trim()).toEqual("false")
        await executeFile("npm", [command], {cwd: consumerDirectory, env: environment, maxBuffer: 20 * 1024 * 1024})
        const listed = JSON.parse((await executeFile("npm", ["ls", "--all", "--json"], {
          cwd: consumerDirectory,
          env: environment,
          maxBuffer: 20 * 1024 * 1024
        })).stdout)

        expect(listed.problems).toEqual(undefined)
        const packageManifest = JSON.parse(await readFile(path.join(consumerDirectory, "node_modules/semantifold/package.json"), "utf8"))
        const installedBin = path.join(consumerDirectory, "node_modules/semantifold/bin/semantifold.js")

        expect(packageManifest.bin).toEqual({semantifold: "bin/semantifold.js"})
        expect((await lstat(installedBin)).mode & 0o111).toEqual(0o111)
        expect(await readFile(installedBin, "utf8")).toMatch(/^#!\/usr\/bin\/env node\n/u)
        await executeFile(path.join(consumerDirectory, "node_modules/.bin/tsc"), [
          "--module", "nodenext", "--moduleResolution", "nodenext", "--noEmit", "--strict", "--target", "ES2024",
          "--types", "node", "type-consumer.mts"
        ], {cwd: consumerDirectory, env: environment})
        await rm(path.join(consumerDirectory, ".semantifold"), {force: true, recursive: true})
        const executed = await executeFile(path.join(consumerDirectory, "node_modules/.bin/semantifold"), ["build", "--check", "--ndjson"], {
          cwd: consumerDirectory,
          env: environment
        })
        const records = executed.stdout.trim().split("\n").map(line => JSON.parse(line))
        const pointer = JSON.parse(await readFile(path.join(consumerDirectory, ".semantifold/active-generation.json"), "utf8"))
        const generation = path.join(consumerDirectory, ".semantifold/generations", pointer.generationId)
        const generatedSource = path.join(generation, "targets/java/source/semantifold/generated/main/Main.java")
        const generatedClass = path.join(generation, "targets/java-main/build/semantifold/generated/main/Main.class")

        expect(executed.stderr.replace(/^\(node:\d+\) ExperimentalWarning: WASI is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n?$/u, "")).toEqual("")
        expect(records.filter(({terminal}) => terminal === true)).toHaveLength(1)
        expect(records.find(({state}) => state == "target-checked")).toMatchObject({
          exitCode: 0,
          stage: "compile",
          target: "java-main",
          tool: {id: "javac"}
        })
        expect(records.at(-1)).toMatchObject({checked: true, exitCode: 0, project: "packed-project", state: "succeeded", terminal: true})
        expect(await readFile(generatedSource, "utf8")).toContain("System.out.println(\"packed\")")
        expect((await lstat(generatedClass)).isFile()).toBeTrue()
        const ran = await executeFile("java", ["-cp", path.dirname(path.dirname(path.dirname(path.dirname(generatedClass)))), "semantifold.generated.main.Main"], {
          cwd: consumerDirectory,
          env: environment
        })

        expect(ran.stdout).toEqual("packed\n")
        expect(ran.stderr).toEqual("")
      }
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
