// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const internalName = "semantifold-tree-sitter-legacy-internal"
const runtimePath = "packages/tree-sitter-legacy/runtime"

describe("installed legacy runtime consistency", () => {
  for (const command of [["run", "pretest"], ["pack", "--json"]]) {
    it(`rejects stale shipped files during npm ${command.join(" ")} and recovers with npm ci`, async () => {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-stale-runtime-"))
      const fixtureRoot = path.join(temporaryRoot, "fixture")
      const userConfig = path.join(temporaryRoot, "user.npmrc")
      const globalConfig = path.join(temporaryRoot, "global.npmrc")
      const environment = {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
          !/^(?:npm_config_|NODE_AUTH_TOKEN$|NPM_TOKEN$|NODE_PATH$)/iu.test(name))),
        npm_config_cache: path.join(temporaryRoot, "cache"),
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
        npm_config_registry: "https://registry.npmjs.org/"
      }
      const options = {cwd: fixtureRoot, env: environment, maxBuffer: 20 * 1024 * 1024}

      try {
        await mkdir(fixtureRoot)
        await writeFile(userConfig, "")
        await writeFile(globalConfig, "")
        const rootManifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"))

        await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
          name: "semantifold-stale-runtime-fixture",
          version: "1.0.0",
          private: true,
          type: "module",
          files: ["build/**"],
          scripts: rootManifest.scripts,
          workspaces: rootManifest.workspaces,
          bundleDependencies: rootManifest.bundleDependencies,
          acceptDependencies: rootManifest.acceptDependencies,
          dependencies: {
            [internalName]: rootManifest.dependencies[internalName],
            "tree-sitter": rootManifest.dependencies["tree-sitter"]
          },
          devDependencies: {
            "semantifold-tree-sitter-legacy-workspace": "0.1.0",
            "@types/node": rootManifest.devDependencies["@types/node"],
            typescript: rootManifest.devDependencies.typescript
          }
        }))
        await cp(path.join(repositoryRoot, "scripts"), path.join(fixtureRoot, "scripts"), {recursive: true})
        await cp(path.join(repositoryRoot, "tsconfig.json"), path.join(fixtureRoot, "tsconfig.json"))
        await cp(path.join(repositoryRoot, ".npmrc"), path.join(fixtureRoot, ".npmrc"))
        await cp(path.join(repositoryRoot, "packages/tree-sitter-legacy"),
          path.join(fixtureRoot, "packages/tree-sitter-legacy"), {
            recursive: true,
            filter: (filename) => !["build", "node_modules"].includes(path.basename(filename))
          })
        await writeFile(path.join(fixtureRoot, "index.js"), "export {}\n")
        await executeFile("npm", ["install", "--package-lock-only", "--ignore-scripts"], options)
        await executeFile("npm", ["ci"], options)
        await executeFile("npm", command, options)

        for (const filename of ["src/c.js", "README.md", "LICENSE", "package.json"]) {
          const sourcePath = path.join(fixtureRoot, runtimePath, filename)
          const installedPath = path.join(fixtureRoot, "node_modules", internalName, filename)
          const source = await readFile(sourcePath, "utf8")
          const changed = filename == "src/c.js"
            ? source.replace("const parser = new Parser()",
              'if (source === "int stale_probe;") throw new Error("source edit reached parser")\n  const parser = new Parser()')
            : `${source}\n`

          assert.notEqual(changed, source)
          await writeFile(sourcePath, changed)
          expect(await readFile(installedPath, "utf8")).toEqual(source)
          if (filename == "src/c.js") {
            const parsed = await executeFile(process.execPath, ["--input-type=module", "--eval",
              `import {parseCst} from "${internalName}"; console.log(parseCst("int stale_probe;").root.type)`], options)

            expect(parsed.stdout.trim()).toEqual("translation_unit")
          }
          await assert.rejects(executeFile("npm", command, options), (error) => {
            assert.match(error.stderr, /Legacy runtime payload differs/u)
            assert.ok(error.stderr.includes(filename))
            assert.match(error.stderr, /npm ci/u)
            return true
          }, `npm ${command.join(" ")} accepted stale ${filename}`)
          await executeFile("npm", ["ci"], options)
          expect(await readFile(installedPath, "utf8")).toEqual(changed)
          if (filename == "src/c.js") {
            await assert.rejects(executeFile(process.execPath, ["--input-type=module", "--eval",
              `import {parseCst} from "${internalName}"; parseCst("int stale_probe;")`], options),
            (error) => {
              assert.match(error.stderr, /source edit reached parser/u)
              return true
            })
          }
          await executeFile("npm", command, options)

          if (command[0] == "pack") {
            const archive = (await readdir(fixtureRoot)).find((filename) => filename.endsWith(".tgz"))

            assert.ok(archive)
            const extracted = await executeFile("tar", [
              "-xOf", archive, `package/node_modules/${internalName}/${filename}`
            ], options)

            expect(extracted.stdout).toEqual(changed)
          }
        }
      } finally {
        await rm(temporaryRoot, {force: true, recursive: true})
      }
    })
  }
})
