// @ts-check

import assert from "node:assert/strict"
import {access, readFile, readdir} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import DockerfileAst from "dockerfile-ast"
import {parse as parseYaml} from "yaml"

const {DockerfileParser} = DockerfileAst
const matchingGofmtReadback = 'test "$(readlink -f "$(command -v gofmt)")" = ' +
  '"$(readlink -f "$(go env GOROOT)/bin/gofmt")"'
const chromiumVersionProbe = `test "$(chromium --version | sed 's/ $//')" = "Google Chrome 152.0.7977.82"`
const swiftKeyUrl = "https://swift.org/keys/release-key-swift-6.x.asc"
const swiftArchiveUrl = "https://download.swift.org/swift-6.3.3-release/ubuntu2404/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE-ubuntu24.04.tar.gz"
const swiftExecutable = "/opt/swift-6.3.3-RELEASE-ubuntu24.04/usr/bin/swiftc"
const swiftToolchainPath = "/opt/swift-6.3.3-RELEASE-ubuntu24.04/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
const providerPackages = Object.freeze([
  "opencode-ai", "@openai/codex", "@anthropic-ai/claude-code", "@moonshot-ai/kimi-code"
])
const activeProviderExecutables = Object.freeze(["codex", "opencode"])
const internalLegacyPackage = "semantifold-tree-sitter-legacy-internal"
const retiredLegacyPackage = "@kaspernj/semantifold-tree-sitter-legacy"
const kotlinGrammarCommit = "57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0"
const kotlinGrammarSource = `https://github.com/kaspernj/tree-sitter-kotlin/archive/${kotlinGrammarCommit}.tar.gz`

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
    assert.match(rootManifest.version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u)
    expect(lockfile.version).toEqual(rootManifest.version)
    expect(lockfile.packages[""].version).toEqual(rootManifest.version)
    expect(rootManifest.dependencies[internalLegacyPackage]).toEqual("file:packages/tree-sitter-legacy/runtime")
    expect(rootManifest.acceptDependencies).toEqual({[internalLegacyPackage]: "0.1.0"})
    expect(rootManifest.devDependencies[workspaceManifest.name]).toEqual("0.1.0")
    expect(rootManifest.devDependencies[retiredLegacyPackage]).toEqual(undefined)
    expect(rootManifest.bundleDependencies).toEqual([internalLegacyPackage, "tree-sitter"])
    expect(rootManifest.dependencies["tree-sitter-kotlin"]).toEqual(kotlinGrammarSource)
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
      "tree-sitter-rust": "0.23.1",
      typescript: "^7.0.0"
    })
    expect(workspaceConfig.compilerOptions.rootDir).toEqual("runtime/src")
    expect(workspaceConfig.include).toEqual(["runtime/src/**/*"])
    expect(npmConfig).toEqual("install-links=true\n")
    expect(internalManifest.exports).toEqual(undefined)
    expect(internalManifest.main).toEqual("./src/c.js")
    expect(internalManifest.publishConfig).toEqual(undefined)
    expect(internalManifest.files).toEqual(["src/c.js", "LICENSE", "README.md"])
    expect(internalManifest.dependencies).toEqual({"tree-sitter": "0.21.1", "tree-sitter-c": "0.23.2", "tree-sitter-cpp": "0.23.4", "tree-sitter-rust": "0.23.1"})
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
    expect(lockfile.packages["node_modules/tree-sitter-kotlin"].resolved).toEqual(kotlinGrammarSource)
    expect(lockfile.packages["node_modules/tree-sitter-kotlin"].integrity).toMatch(/^sha512-/u)
    expect(lockfile.packages["node_modules/tree-sitter-kotlin"].inBundle).toEqual(undefined)
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter`].version).toEqual("0.21.1")
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter-c`].version).toEqual("0.23.2")
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter-cpp`].version).toEqual("0.23.4")
    expect(lockfile.packages[`node_modules/${internalLegacyPackage}/node_modules/tree-sitter-rust`].version).toEqual("0.23.1")
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

  it("keeps Task 013 focused checks additive to the mandatory local aggregate gate", async () => {
    const [instructions, testing] = await Promise.all([
      readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/testing.md", import.meta.url), "utf8")
    ])
    const aggregateCommand = "LANG=C.UTF-8 LC_ALL=C.UTF-8 npm test"
    const taskSection = testing.match(/^## Task 013\b[\s\S]*?(?=^## )/mu)?.[0]

    assert.ok(taskSection)
    expect(instructions).toContain(aggregateCommand)
    expect(taskSection).toContain(aggregateCommand)
    assert.doesNotMatch(taskSection, /Do not run local suite|TensorBuzz-owned/u)
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
    expect(config.environment.SEMANTIFOLD_KOTLINC).toEqual("/opt/kotlinc/bin/kotlinc")
    expect(config.environment.SEMANTIFOLD_SWIFTC).toEqual(swiftExecutable)
    expect(config.environment.PATH).toEqual(undefined)
    expect(config.environment.SEMANTIFOLD_CLANG).toEqual("/usr/bin/clang-21")
    for (const pin of ["clang-21=1:21.1.8~++20251221032922+2078da43e25a-1~exp1~20251221153059.70", "libclang-rt-21-dev=1:21.1.8~++20251221032922+2078da43e25a-1~exp1~20251221153059.70"]) assert.ok(beforeInstall.includes(pin))
    for (const probe of ["clang-21 --version", "clang-21 -dumpmachine", "clang-21 -print-resource-dir",
      'test "$(clang-21 -dumpversion)" = "21.1.8"', 'test "$(clang-21 -dumpmachine)" = "x86_64-pc-linux-gnu"',
      'test -r "$(clang-21 -print-resource-dir)/lib/linux/libclang_rt.asan-x86_64.a"',
      'test -r "$(clang-21 -print-resource-dir)/lib/linux/libclang_rt.ubsan_standalone-x86_64.a"']) assert.ok(config.before_install.includes(probe), probe)
    assert.deepEqual(config.before_install.filter((command) => goCommands.includes(command)), goCommands)
    assert.match(beforeInstall, /php-cli python3 ruby openjdk-25-jdk-headless=25\.0\.4\+7-1~24\.04/u)
    assert.match(beforeInstall, /dotnet-sdk-10\.0/u)
    assert.match(beforeInstall, /libncurses6/u)
    assert.match(beforeInstall, /libxml2-dev/u)
    assert.ok(beforeInstall.includes(swiftKeyUrl))
    assert.ok(beforeInstall.includes(swiftArchiveUrl))
    assert.ok(beforeInstall.includes(swiftArchiveUrl + ".sig"))
    for (const value of ["e8090b06c98b598e968193749db403c06f40c4186771ed87d916081c43de2f5b",
      "52BB7E3DE28A71BE22EC05FFEF80A866B47A981F", "da8272a5fddccd65b1529ed0e52e04526e2eadd4237d58d6220efeb973c6cd19"]) {
      assert.ok(beforeInstall.includes(value), value)
    }
    assert.match(beforeInstall, /curl .*--compressed.*release-key-swift-6\.x\.asc/u)
    assert.match(beforeInstall, /GNUPGHOME=.*mktemp -d/u)
    assert.match(beforeInstall, /gpg .*--verify .*SWIFT_SIGNATURE/u)
    assert.match(beforeInstall, /tar -xzf .*SWIFT_ARCHIVE/u)
    assert.ok(beforeInstall.includes(`export PATH="${swiftToolchainPath}"`))
    assert.ok(beforeInstall.includes('test "$(command -v clang)" = "/opt/swift-6.3.3-RELEASE-ubuntu24.04/usr/bin/clang"'))
    for (const probe of [`${swiftExecutable} --version`,
      `test "$(${swiftExecutable} --version | sed -n '1p')" = 'Swift version 6.3.3 (swift-6.3.3-RELEASE)'`,
      `test "$(${swiftExecutable} --version | sed -n '2p')" = 'Target: x86_64-unknown-linux-gnu'`]) {
      assert.ok(beforeInstall.includes(probe), probe)
    }
    for (const command of [
      `${swiftExecutable} -warnings-as-errors "$SWIFT_PROBE" -o "$SWIFT_DEBUG"`,
      'test "$("$SWIFT_DEBUG")" = 5',
      `${swiftExecutable} -warnings-as-errors -O "$SWIFT_PROBE" -o "$SWIFT_OPTIMIZED"`,
      'test "$("$SWIFT_OPTIMIZED")" = 5'
    ]) assert.ok(beforeInstall.includes(command), command)
    assert.doesNotMatch(beforeInstall, /ln --symbolic .*swiftc \/usr\/bin\/swiftc/u)
    assert.match(beforeInstall, /Swift version 6\.3\.3 \(swift-6\.3\.3-RELEASE\)/u)
    assert.match(beforeInstall, /x86_64-unknown-linux-gnu/u)
    assert.match(beforeInstall, /rm -rf .*GNUPGHOME/u)
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
    assert.match(beforeInstall, /wabt(?:=|_)1\.0\.36\+dfsg\+~cs1\.0\.36-2ubuntu1/u)
    assert.match(beforeInstall, /google-chrome-stable_152\.0\.7977\.82-1_amd64\.deb/u)
    assert.match(beforeInstall, /4d25e4a028c78a7ae910683551c2f234792cc5595e7e3e34939f599342ada446/u)
    expect(config.environment.SEMANTIFOLD_WASM_VALIDATE).toEqual("/usr/bin/wasm-validate")
    expect(config.environment.SEMANTIFOLD_CHROMIUM).toEqual("/usr/local/bin/chromium")
    for (const probe of ["wasm-validate --version", chromiumVersionProbe]) assert.ok(config.before_install.includes(probe), probe)
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
    expect(config.builds.end_to_end.name).toEqual("Thirteen-language tests with Kotlin/JVM, Rust debug/release and C/CPP O0/O2 sanitizers")
    await assert.rejects(access(new URL("../.github/workflows", import.meta.url)))
  })

  it("keeps the development image source-independent and owns all execution runtimes", async () => {
    const source = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const dockerfile = DockerfileParser.parse(source)
    const instructions = dockerfile.getInstructions()
    const keywords = instructions.map((instruction) => instruction.getKeyword())
    const from = instructions.filter((instruction) => instruction.getKeyword() == "FROM")
    const copies = instructions.filter((instruction) => instruction.getKeyword() == "COPY")
    const runs = instructions.filter((instruction) => instruction.getKeyword() == "RUN")
      .map((instruction) => instruction.getArgumentsContent()).join("\n")

    assert.equal(from.at(-1)?.getArgumentsContent(), "ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb")
    assert.deepEqual(from.slice(0, -1).map((instruction) => instruction.getArgumentsContent()), [
      "swift:6.3.3-noble@sha256:56ef1be2c1ca36f4c52440357dc1fcdfdb5e113587134fcadeef57c225c71b54 AS swift-toolchain"
    ])
    assert.ok(copies.length > 0)
    for (const copy of copies) expect(copy.getFlags().map((flag) => [flag.getName(), flag.getValue()]))
      .toEqual([["from", "swift-toolchain"]])
    assert.equal(keywords.includes("ADD"), false)
    assert.match(runs, /php-cli/u)
    assert.match(runs, /python3/u)
    assert.match(runs, /ruby/u)
    assert.match(runs, /openjdk-25-jdk-headless=25\.0\.4\+7-1~26\.04/u)
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
    assert.match(runs, /wabt=1\.0\.36\+dfsg\+~cs1\.0\.36-2ubuntu1(?:\s|\\)/u)
    assert.match(runs, /google-chrome-stable_152\.0\.7977\.82-1_amd64\.deb/u)
    assert.match(runs, /4d25e4a028c78a7ae910683551c2f234792cc5595e7e3e34939f599342ada446/u)
    for (const probe of ["wasm-validate --version", chromiumVersionProbe]) assert.ok(runs.includes(probe), probe)
    assert.match(runs, /Swift version 6\.3\.3 \(swift-6\.3\.3-RELEASE\)/u)
    assert.match(runs, /x86_64-unknown-linux-gnu/u)
    assert.ok(instructions.some((instruction) => instruction.getKeyword() == "USER" && instruction.getArgumentsContent() == "dev"))
    assert.ok(instructions.some((instruction) => instruction.getKeyword() == "WORKDIR" && instruction.getArgumentsContent() == "/home/dev/semantifold"))
  })

  it("installs four native provider CLIs and probes only active routes as the development user", async () => {
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
    const probe = runs.find(({arguments: command}) => activeProviderExecutables.every((executable) =>
      command.includes(`command -v ${executable}`) && command.includes(`${executable} --version`)))

    assert.doesNotMatch(runs.map(({arguments: command}) => command).join("\n"),
      /command -v (?:claude|kimi)|\b(?:claude|kimi) --version/u)

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
