// @ts-check

import assert from "node:assert/strict"
import {access, readFile, readdir} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import DockerfileAst from "dockerfile-ast"
import {parse as parseYaml} from "yaml"

const {DockerfileParser} = DockerfileAst

describe("repository delivery contracts", () => {
  it("uses the released Velocious framework and standalone runner for every spec", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
    const specDirectory = new URL("./", import.meta.url)
    const specFiles = (await readdir(specDirectory)).filter((filename) => filename.endsWith(".js"))

    expect(packageJson.devDependencies["@velocious/testing"]).toEqual("0.0.0")
    expect(packageJson.scripts.test).toEqual("velocious-test spec")
    for (const filename of specFiles) {
      const source = await readFile(new URL(filename, specDirectory), "utf8")

      expect(filename).toMatch(/\.spec\.js$/u)
      assert.doesNotMatch(source, /from ["']node:test["']/u, filename)
    }
  })

  it("pins the custom ESLint plugin to one immutable Git commit", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
    const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"))
    const dependency = packageJson.devDependencies["eslint-plugin-jsdoc-inline-type-casts"]
    const locked = packageLock.packages["node_modules/eslint-plugin-jsdoc-inline-type-casts"]

    assert.match(dependency, /\/archive\/[0-9a-f]{40}\.tar\.gz$/u)
    assert.equal(locked.resolved, dependency)
    assert.match(locked.integrity, /^sha512-/u)
  })

  it("uses TensorBuzz alone and assigns lockfile, quality, package, and runtime proof commands", async () => {
    const source = await readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8")
    const config = parseYaml(source)
    const beforeInstall = config.before_install.join("\n")
    const buildCommands = Object.values(config.builds).flatMap((build) => build.script)

    assert.deepEqual(config.before_script, ["npm ci"])
    expect(config.environment.SEMANTIFOLD_NODE).toEqual("/usr/local/bin/node")
    assert.match(beforeInstall, /php-cli ruby default-jdk-headless/u)
    assert.match(beforeInstall, /tar .* -C \/usr\/local/u)
    assert.match(beforeInstall, /node --version/u)
    assert.match(beforeInstall, /php --version/u)
    assert.match(beforeInstall, /ruby --version/u)
    assert.match(beforeInstall, /javac -version/u)
    assert.match(beforeInstall, /java -version/u)
    assert.ok(buildCommands.includes("npm run lint"))
    assert.ok(buildCommands.includes("npm run typecheck"))
    assert.ok(buildCommands.includes("npm run build"))
    assert.ok(buildCommands.includes("npm test"))
    assert.ok(buildCommands.includes("npm audit --audit-level=high"))
    assert.ok(buildCommands.includes("npm ls --omit=dev --all"))
    assert.ok(buildCommands.includes("npm pack --dry-run --json"))
    await assert.rejects(access(new URL("../.github/workflows", import.meta.url)))
  })

  it("keeps the development image source-independent and owns all execution runtimes", async () => {
    const source = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const dockerfile = DockerfileParser.parse(source)
    const instructions = dockerfile.getInstructions()
    const keywords = instructions.map((instruction) => instruction.getKeyword())
    const from = instructions.find((instruction) => instruction.getKeyword() == "FROM")
    const runs = instructions.filter((instruction) => instruction.getKeyword() == "RUN")
      .map((instruction) => instruction.getArgumentsContent()).join("\n")

    assert.equal(from?.getArgumentsContent(), "ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb")
    assert.equal(keywords.includes("COPY"), false)
    assert.equal(keywords.includes("ADD"), false)
    assert.match(runs, /php-cli/u)
    assert.match(runs, /ruby/u)
    assert.match(runs, /default-jdk-headless/u)
    assert.match(runs, /node_24\.x/u)
    assert.ok(instructions.some((instruction) => instruction.getKeyword() == "USER" && instruction.getArgumentsContent() == "dev"))
    assert.ok(instructions.some((instruction) => instruction.getKeyword() == "WORKDIR" && instruction.getArgumentsContent() == "/home/dev/semantifold"))
  })

  it("defines one canonical dev service with only the home and read-only GitHub binds", async () => {
    const source = await readFile(new URL("../compose.yml", import.meta.url), "utf8")
    const compose = parseYaml(source)
    const serviceNames = Object.keys(compose.services)
    const dev = compose.services.dev

    assert.deepEqual(serviceNames, ["dev"])
    assert.equal(dev.user, "1000:1000")
    assert.equal(dev.working_dir, "/home/dev/semantifold")
    assert.equal(dev.volumes.length, 2)
    assert.deepEqual(dev.volumes.map((volume) => volume.target), ["/home/dev", "/home/dev/.config/gh"])
    assert.equal(dev.volumes[0].bind.create_host_path, false)
    assert.equal(dev.volumes[1].bind.create_host_path, false)
    assert.equal(dev.volumes[1].read_only, true)
  })
})
