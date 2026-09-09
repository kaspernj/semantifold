// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, languageCapabilities, parse, supportedLanguages} from "../index.js"
import {executeC} from "./support/c-toolchain.js"
import {executeCpp} from "./support/cpp-toolchain.js"
import {executeCSharp} from "./support/csharp-toolchain.js"
import {executeGo} from "./support/go-toolchain.js"
import {executeKotlin} from "./support/kotlin-toolchain.js"
import {executePython} from "./support/python-toolchain.js"
import {executeRust} from "./support/rust-toolchain.js"
import {executeSwift} from "./support/swift-toolchain.js"

const expandedLanguages = [
  {artifactPaths: ["program.py"], filename: "program.py", id: "python"},
  {artifactPaths: ["Program.cs", "Semantifold.csproj"], filename: "Program.cs", id: "csharp"},
  {artifactPaths: ["program.c", "semantifold_runtime.h"], filename: "program.c", id: "c"},
  {artifactPaths: ["program.cpp"], filename: "program.cpp", id: "cpp"},
  {artifactPaths: ["Cargo.toml", "Cargo.lock", "src/main.rs"], filename: "program.rs", generatedFilename: "src/main.rs", id: "rust"},
  {artifactPaths: ["program.swift"], filename: "program.swift", id: "swift"},
  {artifactPaths: ["Program.kt"], filename: "program.kt", generatedFilename: "Program.kt", id: "kotlin"},
  {artifactPaths: ["go.mod", "main.go"], filename: "program.go", generatedFilename: "main.go", id: "go"}
]
const fixtureProfiles = [
  ["", "5\n"],
  ["scalars/", "yes\n"],
  ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"],
  ["statements/", "checking\nyes\nmatched\nfallback\n"]
]
const originalFilenames = new Map([
  ["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"],
  ["typescript", "program.ts"], ["java", "Main.java"]
])
const spanningPaths = [
  {family: "dynamic-to-native", profile: "statements/", source: "python", stdout: "checking\nyes\nmatched\nfallback\n", target: "rust"},
  {family: "managed-to-native", profile: "operators/", source: "csharp", stdout: "typed:operators\n", target: "cpp"},
  {family: "native-to-managed", profile: "locals/", source: "c", stdout: "yes\n", target: "kotlin"},
  {family: "original-five-to-expanded", profile: "", source: "php", stdout: "5\n", target: "python"},
  {family: "original-five-to-expanded", profile: "", source: "ruby", stdout: "5\n", target: "csharp"},
  {family: "original-five-to-expanded", profile: "", source: "javascript", stdout: "5\n", target: "c"},
  {family: "original-five-to-expanded", profile: "", source: "typescript", stdout: "5\n", target: "cpp"},
  {family: "original-five-to-expanded", profile: "", source: "java", stdout: "5\n", target: "rust"},
  {family: "original-five-to-expanded", profile: "", source: "php", stdout: "5\n", target: "swift"},
  {family: "original-five-to-expanded", profile: "", source: "ruby", stdout: "5\n", target: "kotlin"},
  {family: "original-five-to-expanded", profile: "", source: "javascript", stdout: "5\n", target: "go"}
]
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const canonicalMeaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) => {
  if (["location", "provenance", "sourceProvenance"].includes(key)) return undefined
  if (["callee", "name"].includes(key) && nested == "select") return "choose"
  return nested
}))

describe("Task 025 expanded-language core baseline acceptance", () => {
  it("normalizes every expanded-language Tasks 001-004 fixture to one canonical corpus", async () => {
    for (const [profile] of fixtureProfiles) {
      let canonical

      for (const {filename, id} of expandedLanguages) {
        const source = await readFile(new URL(`fixtures/${profile}${filename}`, import.meta.url), "utf8")
        const normalized = canonicalMeaning(parse({filename, language: id, source}))

        canonical ??= normalized
        expect({language: id, normalized, profile}).toEqual({language: id, normalized: canonical, profile})
      }
    }
  })

  it("round-trips and really executes one same-language all-operator fixture per expanded language", async () => {
    for (const language of expandedLanguages) {
      const module = await readFixture(language.id, "operators/")
      const set = generateArtifactSet({language: language.id, module})
      const entry = set.artifacts.find(({role}) => role == "entry")

      assert.equal(typeof entry?.content, "string")
      const reparsed = parse({
        filename: language.generatedFilename ?? language.filename,
        language: language.id,
        source: entry.content
      })

      expect({id: language.id, reparsed: meaning(reparsed)}).toEqual({id: language.id, reparsed: meaning(module)})
      assertOutputs(await executeExpanded(language.id, module), "typed:operators\n", language.id)
    }
  })

  it("executes nested eager calls and short circuits on every backend with exact C and CPP ordered regions", async () => {
    const source = (await readFile(new URL("fixtures/ordered-program.ts", import.meta.url), "utf8")).replaceAll("value", "payload")
    const module = parse({filename: "ordered-program.ts", language: "typescript", source})

    for (const language of expandedLanguages) {
      const set = generateArtifactSet({language: language.id, module})
      const entry = set.artifacts.find(({role}) => role == "entry")

      assert.equal(typeof entry?.content, "string")
      if (language.id == "c" || language.id == "cpp") {
        expect(entry.content).toContain(`semantifold:ordered-expression:${language.id}:v1`)
      }
      expect(meaning(parse({
        filename: language.generatedFilename ?? language.filename,
        language: language.id,
        source: entry.content
      }))).toEqual(meaning(module))
      assertOutputs(await executeExpanded(language.id, module, {completeNative: true}), orderedOutput(language.id), language.id)
    }
  })

  it("proves the explicit spanning cross-family registry matrix without an all-pairs expansion", async () => {
    expect(spanningPaths.length).toEqual(11)

    for (const path of spanningPaths) {
      const module = await readFixture(path.source, path.profile)
      const target = /** @type {typeof expandedLanguages[number]} */ (expandedLanguages.find(({id}) => id == path.target))
      const set = generateArtifactSet({language: path.target, module})
      const entry = set.artifacts.find(({role}) => role == "entry")

      assert.equal(typeof entry?.content, "string")
      expect({family: path.family, meaning: meaning(parse({
        filename: target.generatedFilename ?? target.filename,
        language: path.target,
        source: entry.content
      })), source: path.source, target: path.target}).toEqual({
        family: path.family, meaning: meaning(module), source: path.source, target: path.target
      })
      assertOutputs(await executeExpanded(path.target, module), path.stdout, `${path.source}->${path.target}`)
    }
  })

  it("keeps every artifact set, rich mapping, V3 map, and provenance deterministic across source filenames", () => {
    const source = "function edge(left: number, right: number): number { if (left > right) return left; else return right } " +
      "function combine(left: string, right: string): string { return left + right } " +
      "console.log(edge(9007199254740991, -9007199254740991)); console.log(combine(\"é😀\", \"\\u0000中\"))"
    const firstFilename = "sources/é😀-first.ts"
    const secondFilename = "sources/é😀-second.ts"
    const firstModule = parse({filename: firstFilename, language: "typescript", source})
    const secondModule = parse({filename: secondFilename, language: "typescript", source})

    for (const language of expandedLanguages) {
      const first = generateArtifactSet({language: language.id, module: firstModule})
      const repeated = generateArtifactSet({language: language.id, module: firstModule})
      const renamed = generateArtifactSet({language: language.id, module: secondModule})
      const entry = first.artifacts.find(({role}) => role == "entry")
      const renamedEntry = renamed.artifacts.find(({role}) => role == "entry")

      expect(repeated).toEqual(first)
      expect(first.artifacts.map(({path}) => path)).toEqual(language.artifactPaths)
      expect(renamed.artifacts.map(({content}) => content)).toEqual(first.artifacts.map(({content}) => content))
      assert.equal(entry?.provenance.kind, "text")
      assert.equal(renamedEntry?.provenance.kind, "text")
      if (entry?.provenance.kind == "text" && renamedEntry?.provenance.kind == "text") {
        const spans = entry.provenance.mapping.spans
        const roles = new Set(spans.map(({role}) => role).filter(Boolean))

        expect(entry.provenance.sourceMap.sources).toEqual([firstFilename])
        expect(entry.provenance.sourceMap.sourcesContent).toEqual([source])
        expect(renamedEntry.provenance.sourceMap.sources).toEqual([secondFilename])
        expect(spans[0].generated.start.offset).toEqual(0)
        expect(spans.at(-1)?.generated.end.offset).toEqual(entry.content.length)
        expect([...roles].sort()).toEqual(["callee", "literal", "name", "operator", "type"])
        expect(spans.some(({mappingKind, origin}) => mappingKind == "synthetic" && origin.kind == "synthetic")).toBeTrue()
        expect(spans.some(({mappingKind}) => mappingKind == "exact")).toBeTrue()
      }
      for (const artifact of first.artifacts.filter(({role}) => role != "entry")) {
        expect(artifact.provenance.kind).toEqual("synthetic")
      }
    }
  })

  it("retains non-ASCII identifiers in each expanded profile that explicitly permits them", () => {
    const cases = [
      {
        filename: "unicode.py",
        id: "python",
        name: "café",
        source: "def café(left: str, right: str) -> str:\n    return left + right\n\nprint(café(\"é😀\", \"中\"))\n"
      },
      {
        filename: "unicode.swift",
        id: "swift",
        name: "auswählen",
        source: "func auswählen(_ left: String, _ right: String) -> String {\n  return left + right\n}\n\nprint(auswählen(\"é😀\", \"中\"))\n"
      },
      {
        filename: "unicode.kt",
        id: "kotlin",
        name: "auswählen",
        source: "fun auswählen(left: String, right: String): String {\n  return left + right\n}\n\nfun main() {\n  println(auswählen(\"é😀\", \"中\"))\n}\n"
      }
    ]

    for (const {filename, id, name, source} of cases) {
      const module = parse({filename, language: id, source})
      const set = generateArtifactSet({language: id, module})
      const entry = set.artifacts.find(({role}) => role == "entry")

      assert.equal(typeof entry?.content, "string")
      expect(entry.content).toContain(name)
      expect(meaning(parse({
        filename: expandedLanguages.find(({id: candidate}) => candidate == id)?.generatedFilename ?? filename,
        language: id,
        source: entry.content
      }))).toEqual(meaning(module))
    }
  })

  it("discovers exactly the truthful roles, artifacts, mappings, round trips, stages, and toolchains it accepts", () => {
    const acceptance = new Map([
      ["python", {artifactMultiplicity: "single", stages: ["parse", "generate", "compile", "execute"], toolchains: ["python"]}],
      ["csharp", {artifactMultiplicity: "multiple", stages: ["parse", "generate", "restore", "compile", "execute"], toolchains: ["dotnet"]}],
      ["c", {artifactMultiplicity: "multiple", stages: ["parse", "generate", "compile", "link", "execute"], toolchains: ["clang"]}],
      ["cpp", {artifactMultiplicity: "single", stages: ["parse", "generate", "compile", "link", "execute"], toolchains: ["clangpp"]}],
      ["rust", {artifactMultiplicity: "multiple", stages: ["parse", "generate", "compile", "validate", "execute"], toolchains: ["rustc", "cargo"]}],
      ["swift", {artifactMultiplicity: "single", stages: ["parse", "generate", "compile", "execute"], toolchains: ["swiftc"]}],
      ["kotlin", {artifactMultiplicity: "single", stages: ["parse", "generate", "compile", "execute"], toolchains: ["kotlinc", "java25"]}],
      ["go", {artifactMultiplicity: "multiple", stages: ["parse", "generate", "compile", "validate", "execute"], toolchains: ["go"]}]
    ])

    expect(expandedLanguages.every(({id}) => supportedLanguages.includes(id))).toBeTrue()
    for (const {id} of expandedLanguages) {
      const descriptor = languageCapabilities.find((candidate) => candidate.id == id)
      const expected = acceptance.get(id)

      expect(descriptor).toMatchObject({
        acceptance: {stages: expected?.stages, toolchains: expected?.toolchains},
        artifactMultiplicity: expected?.artifactMultiplicity,
        mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
        roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
        roundTrip: true
      })
    }
  })
})

/**
 * Reads one existing fixture through its registered frontend.
 * @param {string} language - Source language.
 * @param {string} profile - Fixture directory.
 * @returns {Promise<import("../src/semantic/types.js").SemanticModule>} Parsed semantic module.
 */
async function readFixture(language, profile) {
  const expanded = expandedLanguages.find(({id}) => id == language)
  const filename = expanded?.filename ?? originalFilenames.get(language)

  assert.equal(typeof filename, "string")
  const source = await readFile(new URL(`fixtures/${profile}${filename}`, import.meta.url), "utf8")

  return parse({filename, language, source})
}

/**
 * Runs the target's exact configured real toolchain profiles.
 * @param {string} language - Target language.
 * @param {import("../src/semantic/types.js").SemanticModule} module - Semantic module.
 * @param {{completeNative?: boolean}} [options] - Whether C/CPP require all sanitizer profiles.
 * @returns {Promise<Array<{status: number, stderr: string, stdout: string}>>} Runtime observations.
 */
async function executeExpanded(language, module, {completeNative = false} = {}) {
  if (language == "python") {
    const result = await executePython(module)

    return [successfulStage(result.stages.at(-1))]
  }
  if (language == "csharp") {
    const result = await executeCSharp(module)

    return [successfulStage(result.stages.at(-1))]
  }
  if (language == "go") {
    const result = await executeGo(module)

    return [successfulStage(result.stages.at(-1))]
  }
  if (language == "kotlin") {
    const result = await executeKotlin(module, {label: "task025"})

    return [{status: result.execute.status, stderr: result.execute.stderr, stdout: result.execute.stdout}]
  }
  if (language == "rust") {
    const result = await executeRust(module, {label: "task025"})

    return result.modes.map(({status, stderr, stdout}) => ({status, stderr, stdout}))
  }
  if (language == "swift") {
    const result = await executeSwift(module, {label: "task025"})

    return result.modes.map(({status, stderr, stdout}) => ({status, stderr, stdout}))
  }
  if (language == "c" || language == "cpp") {
    const modes = completeNative
      ? [["-O0", false], ["-O2", false], ["-O0", true], ["-O2", true]]
      : [["-O0", false]]
    const results = []

    for (const [optimization, sanitized] of modes) {
      const result = language == "c"
        ? await executeC(module, {optimization, sanitized})
        : await executeCpp(module, {optimization, sanitized})

      results.push({status: result.status, stderr: result.stderr, stdout: result.stdout})
    }
    return results
  }

  throw new Error(`Unknown Task 025 target '${language}'.`)
}

/**
 * Normalizes a successful staged result.
 * @param {import("../src/semantic/types.js").AcceptanceStageResult | undefined} stage - Final acceptance stage.
 * @returns {{status: number, stderr: string, stdout: string}} Runtime observation.
 */
function successfulStage(stage) {
  assert.ok(stage)

  return {status: 0, stderr: stage.stderr, stdout: stage.stdout}
}

/**
 * Checks exact output and successful exit for every required target mode.
 * @param {Array<{status: number, stderr: string, stdout: string}>} results - Runtime observations.
 * @param {string} stdout - Expected exact standard output.
 * @param {string} label - Route label.
 */
function assertOutputs(results, stdout, label) {
  assert.ok(results.length > 0, label)
  for (const result of results) expect({label, ...result}).toEqual({label, status: 0, stderr: "", stdout})
}

/** @param {string} language */
function orderedOutput(language) {
  const boolean = language == "python" || language == "csharp" ? "True" : "true"

  return "arg-left\narg-right\ninitial-left\ninitial-right\nassign-left\nassign-right\ntest\nprint-left\nprint-right\n12\n" +
    `and-left\nreturn-left\nreturn-right\n7\ntrue-and-left\ntrue-and-right\n${boolean}\n` +
    `false-or-left\nfalse-or-right\n${boolean}\ntrue-or-left\n${boolean}\nstring-left\nstring-right\né\0😀\n`
}
