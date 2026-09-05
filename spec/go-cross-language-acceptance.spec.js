// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {execFile} from "node:child_process"
import {access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"

const executeFile = promisify(execFile)
const originalFive = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([
  ["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"],
  ["typescript", "program.ts"], ["java", "Main.java"]
])
const fixtureProfiles = [
  ["", "5\n"],
  ["scalars/", "yes\n"],
  ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"],
  ["statements/", "checking\nyes\nmatched\nfallback\n"]
]
const reverseProfiles = [
  ["", "php", "5\n"],
  ["scalars/", "ruby", "yes\n"],
  ["locals/", "javascript", "yes\n"],
  ["operators/", "typescript", "typed:operators\n"],
  ["statements/", "java", "checking\nyes\nmatched\nfallback\n"]
]
const withoutLocations = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("Go cross-language native acceptance", () => {
  it("generates, reparses, and executes every original target from each Go profile", async () => {
    for (const [directory, stdout] of fixtureProfiles) {
      const source = await readFile(new URL("fixtures/" + directory + "program.go", import.meta.url), "utf8")
      const module = parse({filename: "main.go", language: "go", source})

      for (const language of originalFive) {
        const filename = /** @type {string} */ (filenames.get(language))
        const generated = generate({language: /** @type {any} */ (language), module})
        const reparsed = parse({filename, language: /** @type {any} */ (language), source: generated})

        expect({directory, language, meaning: withoutLocations(reparsed)}).toEqual({
          directory, language, meaning: withoutLocations(module)
        })
        expect({directory, language, stdout: await executeGenerated(language, module)}).toEqual({directory, language, stdout})
      }
    }
  })

  it("round-trips and executes all five Go profiles through real staged Go acceptance", async () => {
    for (const [directory, stdout] of fixtureProfiles) {
      const source = await readFile(new URL("fixtures/" + directory + "program.go", import.meta.url), "utf8")
      const module = parse({filename: "main.go", language: "go", source})
      const set = generateArtifactSet({language: "go", module})
      const main = /** @type {string} */ (set.artifacts.find(({path}) => path == "main.go")?.content)
      const reparsed = parse({filename: "main.go", language: "go", source: main})
      const result = await executeGo(module)

      expect(withoutLocations(reparsed)).toEqual(withoutLocations(module))
      expect(result.stages.map(({stage}) => stage)).toEqual(["compile", "validate", "execute"])
      expect(result.stages[0]).toMatchObject({stderr: "", stdout: ""})
      expect(result.stages[1]).toMatchObject({stderr: "", stdout: ""})
      expect(result.stages[2]).toMatchObject({stderr: "", stdout})
    }
  })

  it("rotates one original-five source per profile through native Go format/build/vet/run", async () => {
    for (const [directory, language, stdout] of reverseProfiles) {
      const filename = /** @type {string} */ (filenames.get(language))
      let source = await readFile(new URL("fixtures/" + directory + filename, import.meta.url), "utf8")

      if (directory == "locals/" || directory == "statements/") source = source.replaceAll("select", "choose")
      const module = parse({filename, language: /** @type {any} */ (language), source})
      const set = generateArtifactSet({language: "go", module})
      const main = /** @type {string} */ (set.artifacts.find(({path}) => path == "main.go")?.content)
      const reparsed = parse({filename: "main.go", language: "go", source: main})
      const result = await executeGo(module)

      expect(withoutLocations(reparsed)).toEqual(withoutLocations(module))
      expect(result.stages.at(-1)?.stdout).toEqual(stdout)
    }
  })

  it("preserves eager call order, conditional order, short-circuiting, and signed-64-bit runtime wrap", async () => {
    const orderingSource = "function mark(left: number, right: number): number {\n" +
      "  console.log(left)\n  return right\n}\n\n" +
      "function add(left: number, right: number): number {\n  return left + right\n}\n\n" +
      "console.log(add(mark(1, 10), mark(2, 20)))\n"
    const ordering = parse({filename: "ordering.ts", language: "typescript", source: orderingSource})

    expect((await executeGo(ordering)).stages.at(-1)?.stdout).toEqual("1\n2\n30\n")
    const shortCircuitSource = "function probe(flag: boolean, label: string): boolean {\n" +
      "  console.log(label)\n  return flag\n}\n\n" +
      "function choose(flag: boolean, fallback: string): string {\n" +
      '  if (flag || probe(false, "skipped")) return "yes"\n  else return fallback\n}\n\n' +
      'console.log(choose(probe(true, "condition"), "no"))\n'
    const shortCircuit = parse({filename: "short-circuit.ts", language: "typescript", source: shortCircuitSource})

    expect((await executeGo(shortCircuit)).stages.at(-1)?.stdout).toEqual("condition\nyes\n")
    const overflowSource = "function product(left: number, right: number): number {\n  return left * right\n}\n\n" +
      "console.log(product(9007199254740991, 2048))\n"
    const overflow = parse({filename: "overflow.ts", language: "typescript", source: overflowSource})
    const expected = BigInt.asIntN(64, 9007199254740991n * 2048n).toString() + "\n"

    expect((await executeGo(overflow)).stages.at(-1)?.stdout).toEqual(expected)
  })

  it("produces byte-identical binaries and output in two fresh directories", async () => {
    const source = await readFile(new URL("fixtures/operators/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const set = generateArtifactSet({language: "go", module})
    const first = await buildGoOutput(set)
    const second = await buildGoOutput(set)

    expect(first.hash).toEqual(second.hash)
    expect(first.stdout).toEqual("typed:operators\n")
    expect(second.stdout).toEqual(first.stdout)
  })
})

/** @param {string} language @param {import("../src/semantic/types.js").SemanticModule} module */
async function executeGenerated(language, module) {
  const artifacts = generateArtifactSet({language, module})
  const stages = []

  if (language == "php") stages.push({arguments: ["program.php"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("php")})
  else if (language == "ruby") stages.push({arguments: ["program.rb"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("ruby")})
  else if (language == "javascript") stages.push({arguments: ["program.js"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("node")})
  else if (language == "typescript") stages.push(
    {arguments: ["program.ts", "--target", "ES2024", "--module", "nodenext"], stage: /** @type {const} */ ("compile"), tool: await discoverCanonicalToolchain("tsc")},
    {arguments: ["program.js"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("node")}
  )
  else stages.push(
    {arguments: ["Main.java"], stage: /** @type {const} */ ("compile"), tool: await discoverCanonicalToolchain("javac")},
    {arguments: ["-cp", ".", "Main"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("java")}
  )
  const result = await runAcceptanceStages({artifacts, environment: {PATH: process.env.PATH}, stages, target: language, timeoutMs: 20_000})

  return result.stages.at(-1)?.stdout ?? ""
}

/** @param {import("../src/semantic/types.js").SemanticModule} module */
async function executeGo(module) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-go-state-"))

  try {
    const set = generateArtifactSet({language: "go", module})
    const environment = await goEnvironment(root)

    await validateGoFormat(set, path.join(root, "format"), environment)
    const go = await discoverCanonicalToolchain("go", {environment})

    return await runAcceptanceStages({
      artifacts: set,
      environment,
      stages: [
        {arguments: ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", "semantifold-go", "."], stage: "compile", tool: go},
        {arguments: ["vet", "-mod=readonly", "."], stage: "validate", tool: go},
        {arguments: ["run", "-mod=readonly", "-trimpath", "-buildvcs=false", "."], stage: "execute", tool: go}
      ],
      target: "go",
      timeoutMs: 30_000
    })
  } finally {
    await rm(root, {force: true, recursive: true})
  }
}

/** @param {import("../src/semantic/types.js").GeneratedArtifactSet} set */
async function buildGoOutput(set) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-go-build-"))
  const directory = path.join(root, "project")

  try {
    await materialize(set, directory)
    const environment = await goEnvironment(root)
    const before = await sourceHashes(directory)

    await validateGoFormat(set, path.join(root, "format"), environment)
    const go = await discoverCanonicalToolchain("go", {environment})
    const build = await executeFile(go.executable,
      ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", "semantifold-go", "."],
      {cwd: directory, encoding: "utf8", env: environment, timeout: 30_000})
    const vet = await executeFile(go.executable, ["vet", "-mod=readonly", "."],
      {cwd: directory, encoding: "utf8", env: environment, timeout: 30_000})
    const executed = await executeFile(path.join(directory, "semantifold-go"), [],
      {cwd: directory, encoding: "utf8", env: environment, timeout: 30_000})

    expect(build).toMatchObject({stderr: "", stdout: ""})
    expect(vet).toMatchObject({stderr: "", stdout: ""})
    expect(executed.stderr).toEqual("")
    expect(await sourceHashes(directory)).toEqual(before)
    await assertAbsentProjectFiles(directory)
    return {
      hash: createHash("sha256").update(await readFile(path.join(directory, "semantifold-go"))).digest("hex"),
      stdout: executed.stdout
    }
  } finally {
    await rm(root, {force: true, recursive: true})
  }
}

/** @param {import("../src/semantic/types.js").GeneratedArtifactSet} set @param {string} directory @param {Record<string, string>} environment */
async function validateGoFormat(set, directory, environment) {
  await materialize(set, directory)
  const before = await sourceHashes(directory)
  const go = await discoverCanonicalToolchain("go", {environment})
  const goRoot = (await executeFile(go.executable, ["env", "GOROOT"], {encoding: "utf8", env: environment})).stdout.trim()
  const configuredGofmt = path.join(path.dirname(environment.SEMANTIFOLD_GO ?? go.executable), "gofmt")
  const gofmt = path.join(goRoot, "bin", "gofmt")

  expect((await stat(configuredGofmt)).isFile()).toBeTrue()
  expect((await stat(gofmt)).isFile()).toBeTrue()
  expect(await realpath(configuredGofmt)).toEqual(await realpath(gofmt))
  const formatted = await executeFile(configuredGofmt, ["-d", "main.go"], {
    cwd: directory, encoding: "utf8", env: environment, timeout: 30_000
  })

  expect(formatted).toMatchObject({stderr: "", stdout: ""})
  expect(await sourceHashes(directory)).toEqual(before)
  await assertAbsentProjectFiles(directory)
}

/** @param {string} root */
async function goEnvironment(root) {
  const directories = {
    GOCACHE: path.join(root, "cache"),
    GOMODCACHE: path.join(root, "modcache"),
    GOPATH: path.join(root, "gopath"),
    GOTMPDIR: path.join(root, "tmp"),
    HOME: path.join(root, "home")
  }

  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, {recursive: true})))
  return {
    ...directories,
    CGO_ENABLED: "0",
    GOARCH: "amd64",
    GOENV: "off",
    GOOS: "linux",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    GOVCS: "off",
    GOWORK: "off",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH ?? "",
    ...(process.env.SEMANTIFOLD_GO === undefined ? {} : {SEMANTIFOLD_GO: process.env.SEMANTIFOLD_GO}),
    TZ: "UTC"
  }
}

/** @param {import("../src/semantic/types.js").GeneratedArtifactSet} set @param {string} directory */
async function materialize(set, directory) {
  await mkdir(directory, {recursive: true})
  for (const artifact of set.artifacts) {
    await writeFile(path.join(directory, artifact.path), artifact.content)
  }
}

/** @param {string} directory */
async function sourceHashes(directory) {
  return Promise.all(["go.mod", "main.go"].map(async (filename) =>
    createHash("sha256").update(await readFile(path.join(directory, filename))).digest("hex")))
}

/** @param {string} directory */
async function assertAbsentProjectFiles(directory) {
  for (const name of ["go.sum", "go.work", "vendor"]) {
    await assert.rejects(access(path.join(directory, name)), (error) =>
      error instanceof Error && "code" in error && error.code == "ENOENT")
  }
}
