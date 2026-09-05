// @ts-check

import assert from "node:assert/strict"
import {access, readFile, readdir} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import DockerfileAst from "dockerfile-ast"
import {parse as parseYaml} from "yaml"

const {DockerfileParser} = DockerfileAst
const matchingGofmtReadback = 'test "$(readlink -f "$(command -v gofmt)")" = ' +
  '"$(readlink -f "$(go env GOROOT)/bin/gofmt")"'
const providerPackages = Object.freeze([
  "opencode-ai", "@openai/codex", "@anthropic-ai/claude-code", "@moonshot-ai/kimi-code"
])
const providerExecutables = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
  "@anthropic-ai/claude-code": "claude",
  "@moonshot-ai/kimi-code": "kimi",
  "@openai/codex": "codex",
  "opencode-ai": "opencode"
}))

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
    expect(config.environment.SEMANTIFOLD_PYTHON).toEqual("/usr/bin/python3")
    expect(config.environment.SEMANTIFOLD_DOTNET).toEqual("/usr/bin/dotnet")
    expect(config.environment.SEMANTIFOLD_GO).toEqual("/usr/bin/go")
    assert.match(beforeInstall, /php-cli python3 ruby default-jdk-headless/u)
    assert.match(beforeInstall, /dotnet-sdk-10\.0/u)
    assert.match(beforeInstall, /golang-go/u)
    assert.match(beforeInstall, /tar .* -C \/usr\/local/u)
    assert.match(beforeInstall, /node --version/u)
    assert.match(beforeInstall, /php --version/u)
    assert.match(beforeInstall, /python3 --version/u)
    assert.match(beforeInstall, /ruby --version/u)
    assert.match(beforeInstall, /javac -version/u)
    assert.match(beforeInstall, /java -version/u)
    assert.match(beforeInstall, /dotnet --info/u)
    assert.match(beforeInstall, /test "\$\(dotnet --version \| cut -d\. -f1\)" = "10"/u)
    assert.match(beforeInstall, /go version/u)
    assert.match(beforeInstall, /go env GOVERSION GOOS GOARCH GOROOT/u)
    assert.match(beforeInstall, /test "\$\(go env GOVERSION \| cut -d\. -f1,2\)" = "go1\.26"/u)
    assert.match(beforeInstall, /test "\$\(go env GOOS\)" = "linux"/u)
    assert.match(beforeInstall, /test "\$\(go env GOARCH\)" = "amd64"/u)
    assert.match(beforeInstall, /test -n "\$\(go env GOROOT\)"/u)
    assert.match(beforeInstall, /test -x "\$\(go env GOROOT\)\/bin\/gofmt"/u)
    assert.ok(beforeInstall.includes(matchingGofmtReadback))
    assert.ok(buildCommands.includes("npm run lint"))
    assert.ok(buildCommands.includes("npm run typecheck"))
    assert.ok(buildCommands.includes("npm run build"))
    assert.ok(buildCommands.includes("npm test"))
    assert.ok(buildCommands.includes("npm audit --audit-level=high"))
    assert.ok(buildCommands.includes("npm ls --omit=dev --all"))
    assert.ok(buildCommands.includes("npm pack --dry-run --json"))
    expect(config.builds.end_to_end.name).toEqual("Eight-language end-to-end tests")
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
    assert.match(runs, /python3/u)
    assert.match(runs, /ruby/u)
    assert.match(runs, /default-jdk-headless/u)
    assert.match(runs, /dotnet-sdk-10\.0/u)
    assert.match(runs, /golang-go/u)
    assert.match(runs, /node_24\.x/u)
    assert.match(runs, /dotnet --info/u)
    assert.match(runs, /test "\$\(dotnet --version \| cut -d\. -f1\)" = "10"/u)
    assert.match(runs, /go version/u)
    assert.match(runs, /go env GOVERSION GOOS GOARCH GOROOT/u)
    assert.match(runs, /test "\$\(go env GOVERSION \| cut -d\. -f1,2\)" = "go1\.26"/u)
    assert.match(runs, /test "\$\(go env GOOS\)" = "linux"/u)
    assert.match(runs, /test "\$\(go env GOARCH\)" = "amd64"/u)
    assert.match(runs, /test -n "\$\(go env GOROOT\)"/u)
    assert.match(runs, /test -x "\$\(go env GOROOT\)\/bin\/gofmt"/u)
    assert.ok(runs.includes(matchingGofmtReadback))
    assert.ok(instructions.some((instruction) => instruction.getKeyword() == "USER" && instruction.getArgumentsContent() == "dev"))
    assert.ok(instructions.some((instruction) => instruction.getKeyword() == "WORKDIR" && instruction.getArgumentsContent() == "/home/dev/semantifold"))
  })

  it("installs the four native provider CLIs globally before probing them as the development user", async () => {
    const [source, packageJson, packageLock] = await Promise.all([
      readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse)
    ])
    const instructions = DockerfileParser.parse(source).getInstructions()
    const runs = instructions.map((instruction, index) => ({
      arguments: instruction.getArgumentsContent(),
      index,
      keyword: instruction.getKeyword()
    })).filter(({keyword}) => keyword == "RUN")
    const providerInstalls = runs.filter(({arguments: command}) => command.includes("npm install --global"))

    assert.equal(providerInstalls.length, 1)
    const providerInstall = providerInstalls[0]
    const normalizedInstall = providerInstall.arguments.replace(/\s+/gu, " ")
    const installCommand = normalizedInstall.match(/npm install --global [^&]+/u)?.[0].trim()
    const expectedInstall = [
      "npm install --global", "--cache", '"${PROVIDER_NPM_CACHE}"', ...providerPackages
    ].join(" ")

    expect(installCommand).toEqual(expectedInstall)
    assert.match(providerInstall.arguments, /PROVIDER_NPM_CACHE="\$\(mktemp -d\)"/u)
    assert.match(providerInstall.arguments, /rm -rf "\$\{PROVIDER_NPM_CACHE\}"/u)
    assert.doesNotMatch(providerInstall.arguments, /@latest/u)
    for (const packageName of providerPackages) assert.equal(providerInstall.arguments.includes(`${packageName}@`), false)

    const identity = runs.find(({arguments: command}) => command.includes("usermod --login dev --home /home/dev --move-home ubuntu"))
    const userIndex = instructions.findIndex((instruction) =>
      instruction.getKeyword() == "USER" && instruction.getArgumentsContent() == "dev")
    const homeIndex = instructions.findIndex((instruction) =>
      instruction.getKeyword() == "ENV" && instruction.getArgumentsContent() == "HOME=/home/dev")
    const probe = runs.find(({arguments: command}) => providerPackages.every((packageName) => {
      const executable = providerExecutables[packageName]

      return command.includes(`command -v ${executable}`) && command.includes(`${executable} --version`)
    }))

    assert.ok(identity)
    for (const command of [
      'test "$(id -u ubuntu)" = "1000"', 'test "$(id -g ubuntu)" = "1000"',
      "groupmod --new-name dev ubuntu", 'test "$(id -u dev)" = "1000"', 'test "$(id -g dev)" = "1000"'
    ]) assert.ok(identity.arguments.includes(command))
    assert.ok(identity.index < providerInstall.index)
    assert.equal(instructions.slice(0, providerInstall.index).some((instruction) => instruction.getKeyword() == "USER"), false)
    assert.ok(userIndex > providerInstall.index)
    assert.ok(homeIndex > userIndex)
    assert.ok(probe && probe.index > homeIndex)
    assert.equal(instructions.slice(0, probe.index + 1)
      .filter((instruction) => instruction.getKeyword() == "USER").at(-1)?.getArgumentsContent(), "dev")

    assert.doesNotMatch(source, /@latest/u)
    assert.doesNotMatch(source, /^ARG\s+.*(?:OPENCODE|CODEX|CLAUDE|KIMI|PROVIDER).*VERSION/imu)
    assert.doesNotMatch(source, /NODE_AUTH_TOKEN|NPM_TOKEN|npm_config_(?:_auth|token)|npm (?:adduser|login)|_authToken/u)
    const projectDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
      ...packageJson.peerDependencies
    }

    for (const packageName of providerPackages) {
      assert.equal(Object.hasOwn(projectDependencies, packageName), false)
      assert.equal(Object.hasOwn(packageLock.packages, `node_modules/${packageName}`), false)
    }
    assert.doesNotMatch(JSON.stringify([source, packageJson, packageLock]), /threadwire/iu)
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
