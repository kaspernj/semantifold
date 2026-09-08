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
const internalLegacyPackage = "semantifold-tree-sitter-legacy-internal"
const retiredLegacyPackage = "@kaspernj/semantifold-tree-sitter-legacy"

describe("repository delivery contracts", () => {
  it("owns and bundles the private legacy Tree-sitter workspace in the root package", async () => {
    const [rootManifest, workspaceManifest, internalManifest, workspaceConfig, npmConfig, lockfile, tensorbuzz,
      instructions] = await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../packages/tree-sitter-legacy/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../packages/tree-sitter-legacy/runtime/package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../packages/tree-sitter-legacy/tsconfig.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../.npmrc", import.meta.url), "utf8"),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8").then(parseYaml),
      readFile(new URL("../AGENTS.md", import.meta.url), "utf8")
    ])
    const rootPack = "npm pack --dry-run --json"
    const buildCommands = Object.values(tensorbuzz.builds).flatMap((build) => build.script)

    expect(rootManifest.workspaces).toEqual(["packages/tree-sitter-legacy"])
    expect(rootManifest.version).toEqual("0.2.0")
    expect(rootManifest.dependencies[internalLegacyPackage]).toEqual("file:packages/tree-sitter-legacy/runtime")
    expect(rootManifest.acceptDependencies).toEqual({[internalLegacyPackage]: "0.1.0"})
    expect(rootManifest.devDependencies[workspaceManifest.name]).toEqual("0.1.0")
    expect(rootManifest.devDependencies[retiredLegacyPackage]).toEqual(undefined)
    expect(rootManifest.bundleDependencies).toEqual([internalLegacyPackage, "tree-sitter"])
    expect(rootManifest.files.includes("packages/**")).toBeFalse()
    expect(rootManifest.exports).toEqual({
      ".": {import: "./build/index.js", types: "./build/index.d.ts"}
    })
    expect({name: workspaceManifest.name, private: workspaceManifest.private, version: workspaceManifest.version}).toEqual({
      name: "semantifold-tree-sitter-legacy-workspace", private: true, version: "0.1.0"
    })
    expect({name: internalManifest.name, private: internalManifest.private, version: internalManifest.version}).toEqual({
      name: internalLegacyPackage, private: true, version: "0.1.0"
    })
    expect(workspaceManifest.exports).toEqual(undefined)
    expect(workspaceManifest.publishConfig).toEqual(undefined)
    expect(workspaceManifest.devDependencies).toEqual({
      "@types/node": "^24.3.0",
      "tree-sitter": "0.21.1",
      "tree-sitter-c": "0.23.2",
      "tree-sitter-cpp": "0.23.4",
      typescript: "^7.0.0"
    })
    expect(workspaceConfig.compilerOptions.rootDir).toEqual("runtime/src")
    expect(workspaceConfig.include).toEqual(["runtime/src/**/*"])
    expect(npmConfig).toEqual("install-links=true\n")
    expect(internalManifest.exports).toEqual(undefined)
    expect(internalManifest.main).toEqual("./src/c.js")
    expect(internalManifest.publishConfig).toEqual(undefined)
    expect(internalManifest.files).toEqual(["src/c.js", "LICENSE", "README.md"])
    expect(internalManifest.dependencies).toEqual({"tree-sitter": "0.21.1", "tree-sitter-c": "0.23.2", "tree-sitter-cpp": "0.23.4"})
    expect(internalManifest.bundleDependencies).toEqual(undefined)
    expect(lockfile.packages[`node_modules/${workspaceManifest.name}`]).toEqual({
      link: true, resolved: "packages/tree-sitter-legacy"
    })
    expect(lockfile.packages[`node_modules/${retiredLegacyPackage}`]).toEqual(undefined)
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}`].resolved)
      .toEqual("file:packages/tree-sitter-legacy/runtime")
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}`].inBundle).toBeTrue()
    expect(lockfile.packages[""].acceptDependencies).toEqual(rootManifest.acceptDependencies)
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}`].link).toEqual(undefined)
    expect(lockfile.packages["node_modules/tree-sitter"].version).toEqual("0.25.1")
    expect(lockfile.packages["node_modules/tree-sitter"].inBundle).toBeTrue()
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter`].version).toEqual("0.21.1")
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter-c`].version).toEqual("0.23.2")
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter-cpp`].version).toEqual("0.23.4")
    expect(buildCommands.includes("npm ls --all")).toBeTrue()
    expect(buildCommands.filter((command) => command == rootPack)).toEqual([rootPack])
    expect(buildCommands.some((command) => command.includes("--workspace") && command.includes("npm pack"))).toBeFalse()
    expect(instructions).toContain(rootPack)
    expect(instructions).not.toContain(`npm pack --workspace=${retiredLegacyPackage}`)
  })

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
    const goArchive = "/tmp/go1.26.7.linux-amd64.tar.gz"
    const goCommands = [
      "curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors " +
        `https://go.dev/dl/go1.26.7.linux-amd64.tar.gz --output ${goArchive}`,
      "printf '%s  %s\\n' 'ffb5f8de10c62550dfddab66b36b57030721e0a44a3218e9e1181d7b59f121ca' " +
        `'${goArchive}' | sha256sum --check -`,
      "sudo rm -rf /usr/local/go",
      `sudo tar -xzf ${goArchive} -C /usr/local`,
      "sudo ln --symbolic --force /usr/local/go/bin/go /usr/local/bin/go",
      "sudo ln --symbolic --force /usr/local/go/bin/gofmt /usr/local/bin/gofmt"
    ]

    assert.deepEqual(config.before_script, ["npm ci"])
    expect(config.environment.SEMANTIFOLD_NODE).toEqual("/usr/local/bin/node")
    expect(config.environment.SEMANTIFOLD_PYTHON).toEqual("/usr/bin/python3")
    expect(config.environment.SEMANTIFOLD_DOTNET).toEqual("/usr/bin/dotnet")
    expect(config.environment.SEMANTIFOLD_GO).toEqual("/usr/local/bin/go")
    expect(config.environment.SEMANTIFOLD_CLANG).toEqual("/usr/bin/clang-21")
    for (const pin of ["clang-21=1:21.1.8~++20251221032922+2078da43e25a-1~exp1~20251221153059.70", "libclang-rt-21-dev=1:21.1.8~++20251221032922+2078da43e25a-1~exp1~20251221153059.70"]) assert.ok(beforeInstall.includes(pin))
    for (const probe of ["clang-21 --version", "clang-21 -dumpmachine", "clang-21 -print-resource-dir",
      'test "$(clang-21 -dumpversion)" = "21.1.8"', 'test "$(clang-21 -dumpmachine)" = "x86_64-pc-linux-gnu"',
      'test -r "$(clang-21 -print-resource-dir)/lib/linux/libclang_rt.asan-x86_64.a"',
      'test -r "$(clang-21 -print-resource-dir)/lib/linux/libclang_rt.ubsan_standalone-x86_64.a"']) assert.ok(config.before_install.includes(probe), probe)
    assert.deepEqual(config.before_install.filter((command) => goCommands.includes(command)), goCommands)
    assert.match(beforeInstall, /php-cli python3 ruby default-jdk-headless/u)
    assert.match(beforeInstall, /dotnet-sdk-10\.0/u)
    assert.doesNotMatch(beforeInstall, /(?:^|\s)golang-go(?:\s|$)/u)
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
    assert.match(beforeInstall, /test "\$\(go env GOVERSION\)" = "go1\.26\.7"/u)
    assert.match(beforeInstall, /test "\$\(go env GOVERSION \| cut -d\. -f1,2\)" = "go1\.26"/u)
    assert.match(beforeInstall, /test "\$\(go env GOOS\)" = "linux"/u)
    assert.match(beforeInstall, /test "\$\(go env GOARCH\)" = "amd64"/u)
    assert.match(beforeInstall, /test -n "\$\(go env GOROOT\)"/u)
    assert.match(beforeInstall, /test -x "\$\(go env GOROOT\)\/bin\/gofmt"/u)
    assert.ok(beforeInstall.includes(matchingGofmtReadback))
    assert.ok(buildCommands.includes("npm run lint"))
    assert.ok(buildCommands.includes("npm run typecheck"))
    assert.ok(buildCommands.includes("npm run build"))
    assert.ok(buildCommands.includes("LANG=C.UTF-8 LC_ALL=C.UTF-8 npm test"))
    assert.ok(buildCommands.includes("npm audit --audit-level=high"))
    assert.ok(buildCommands.includes("npm ls --omit=dev --all"))
    assert.ok(buildCommands.includes("npm pack --dry-run --json"))
    expect(config.environment.SEMANTIFOLD_CLANGPP).toEqual("/usr/bin/clang++-21")
    assert.match(beforeInstall, /(?:^|\s)g\+\+-13(?:\s|$)/u)
    for (const probe of ["clang++-21 --version", 'test "$(clang++-21 -dumpversion)" = "21.1.8"',
      'test -r "$(clang++-21 -print-file-name=libstdc++.so)"', "dpkg-query -W libstdc++-13-dev"]) {
      assert.ok(config.before_install.includes(probe), probe)
    }
    expect(config.builds.end_to_end.name).toEqual("Ten-language end-to-end tests with C and CPP O0/O2 and sanitizers")
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
    for (const pin of ["clang=1:21.1.6-71", "clang-21=1:21.1.8-6ubuntu1", "libclang-rt-21-dev=1:21.1.8-6ubuntu1", "libstdc++-15-dev=15.2.0-16ubuntu1"]) assert.ok(runs.includes(pin))
    for (const probe of ["clang --version", "clang -dumpmachine", "clang -print-resource-dir"]) assert.ok(runs.includes(probe))
    for (const probe of ["clang++-21 --version", 'test "$(clang++-21 -dumpversion)" = "21.1.8"',
      'test -r "$(clang++-21 -print-file-name=libstdc++.so)"']) assert.ok(runs.includes(probe))
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

  it("installs and documents the four native provider CLIs before probing them as the development user", async () => {
    const [source, packageJson, packageLock, repositoryInstructions] = await Promise.all([
      readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../AGENTS.md", import.meta.url), "utf8")
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
    assert.match(repositoryInstructions, /image remains source-independent: do not add project `COPY`, project dependency installation, or orchestration coupling/u)
    assert.match(repositoryInstructions, /infrastructure tooling rather than project dependencies/u)
    assert.match(repositoryInstructions, /four native provider CLI baselines globally from the bare npm package specs/u)
    assert.match(repositoryInstructions, /Provider versions and authentication remain external/u)
    assert.doesNotMatch(repositoryInstructions, /do not add[^.\n]*provider CLIs/iu)
    const projectDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
      ...packageJson.peerDependencies
    }

    for (const packageName of providerPackages) {
      assert.ok(repositoryInstructions.includes(`\`${packageName}\``))
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
