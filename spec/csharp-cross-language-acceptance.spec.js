// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
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
  ["", "-5\n"],
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

describe("C# cross-language native acceptance", () => {
  it("generates, reparses, compiles where applicable, and executes every original target from each C# profile", async () => {
    for (const [directory, stdout] of fixtureProfiles) {
      const source = await readFile(new URL(`fixtures/${directory}Program.cs`, import.meta.url), "utf8")
      const module = parse({filename: "Program.cs", language: "csharp", source})

      for (const language of originalFive) {
        const filename = /** @type {string} */ (filenames.get(language))
        const generated = generate({language, module})
        const reparsed = parse({filename, language, source: generated})

        expect({directory, language, meaning: withoutLocations(reparsed)}).toEqual({
          directory, language, meaning: withoutLocations(module)
        })
        expect({directory, language, stdout: await executeGenerated(language, module)}).toEqual({directory, language, stdout})
      }
    }
  })

  it("rotates one original-five source per profile through real C# restore, compile, and execute stages", async () => {
    for (const [directory, language, stdout] of reverseProfiles) {
      const filename = /** @type {string} */ (filenames.get(language))
      let source = await readFile(new URL(`fixtures/${directory}${filename}`, import.meta.url), "utf8")

      if (directory == "locals/" || directory == "statements/") source = source.replaceAll("select", "choose")
      const module = parse({filename, language, source})
      const generated = generateArtifactSet({language: "csharp", module})
      const program = /** @type {string} */ (generated.artifacts[0].content)
      const reparsed = parse({filename: "Program.cs", language: "csharp", source: program})
      const result = await executeCSharp(module)

      expect(withoutLocations(reparsed)).toEqual(withoutLocations(module))
      expect(result.stages.map(({stage}) => stage)).toEqual(["restore", "compile", "execute"])
      expect(result.stages[0].stderr).toEqual("")
      expect(result.stages[1].stderr).toEqual("")
      expect(result.stages[1].stdout).toContain("0 Warning(s)")
      expect(result.stages[2].stdout).toEqual(stdout)
    }
  })

  it("produces byte-identical deterministic managed outputs in two fresh project directories", async () => {
    const source = await readFile(new URL("fixtures/operators/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const set = generateArtifactSet({language: "csharp", module})
    const first = await buildManagedOutputs(set)
    const second = await buildManagedOutputs(set)

    for (const filename of ["Semantifold.dll", "Semantifold.deps.json", "Semantifold.runtimeconfig.json"]) {
      assert.deepEqual(first.get(filename), second.get(filename), filename)
    }
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
async function executeCSharp(module) {
  const dotnet = await discoverCanonicalToolchain("dotnet")
  const packages = await mkdtemp(path.join(os.tmpdir(), "semantifold-nuget-"))

  try {
    return await runAcceptanceStages({
      artifacts: generateArtifactSet({language: "csharp", module}),
      environment: dotnetEnvironment(packages),
      stages: [
        {arguments: ["restore", "Semantifold.csproj", "--source", ".", "--no-cache", "--force", "--disable-parallel", "--nologo"], stage: "restore", tool: dotnet},
        {arguments: ["build", "Semantifold.csproj", "--configuration", "Release", "--no-restore", "--nologo", "--warnaserror"], stage: "compile", tool: dotnet},
        {arguments: ["exec", "bin/Release/net10.0/Semantifold.dll"], stage: "execute", tool: dotnet}
      ],
      target: "csharp",
      timeoutMs: 30_000
    })
  } finally {
    await rm(packages, {force: true, recursive: true})
  }
}

/** @param {import("../src/semantic/types.js").GeneratedArtifactSet} set */
async function buildManagedOutputs(set) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-csharp-build-"))
  const dotnet = await discoverCanonicalToolchain("dotnet")

  try {
    for (const artifact of set.artifacts) {
      await mkdir(path.dirname(path.join(directory, artifact.path)), {recursive: true})
      await writeFile(path.join(directory, artifact.path), artifact.content)
    }
    const environment = dotnetEnvironment(path.join(directory, ".nuget", "packages"))

    await executeFile(dotnet.executable,
      ["restore", "Semantifold.csproj", "--source", ".", "--no-cache", "--force", "--disable-parallel", "--nologo"],
      {cwd: directory, env: environment, timeout: 30_000})
    const build = await executeFile(dotnet.executable,
      ["build", "Semantifold.csproj", "--configuration", "Release", "--no-restore", "--nologo", "--warnaserror"],
      {cwd: directory, env: environment, timeout: 30_000})

    expect(build.stderr).toEqual("")
    expect(build.stdout).toContain("0 Warning(s)")
    const outputs = new Map()

    for (const filename of ["Semantifold.dll", "Semantifold.deps.json", "Semantifold.runtimeconfig.json"]) {
      outputs.set(filename, await readFile(path.join(directory, "bin", "Release", "net10.0", filename)))
    }
    return outputs
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

/** @param {string} packages */
function dotnetEnvironment(packages) {
  return {
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
    LC_ALL: "C.UTF-8",
    NUGET_PACKAGES: packages,
    PATH: process.env.PATH,
    TZ: "UTC"
  }
}
