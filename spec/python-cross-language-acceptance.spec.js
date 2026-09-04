// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"],
  ["python", "program.py"]
])
const fixtureProfiles = [
  ["", "5\n"],
  ["scalars/", "yes\n"],
  ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"],
  ["statements/", "checking\nyes\nmatched\nfallback\n"]
]

const withoutLocations = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : nested))

describe("Python cross-language native acceptance", () => {
  it("generates, reparses, compiles, and executes Python from every original-five Tasks 001-004 fixture", async () => {
    for (const [directory, stdout] of fixtureProfiles) {
      for (const language of originalFive) {
        const filename = /** @type {string} */ (filenames.get(language))
        const source = await readFile(new URL(`fixtures/${directory}${filename}`, import.meta.url), "utf8")
        const module = parse({filename, language, source})
        const generated = generate({language: "python", module})
        const reparsed = parse({filename: "program.py", language: "python", source: generated})
        const result = await executeGenerated("python", module)

        expect({directory, language, meaning: withoutLocations(reparsed)}).toEqual({
          directory,
          language,
          meaning: withoutLocations(module)
        })
        expect({directory, language, stdout: result}).toEqual({directory, language, stdout})
      }
    }
  })

  it("generates, reparses, compiles where applicable, and executes every original target from Python-derived IR", async () => {
    for (const [directory, stdout] of fixtureProfiles) {
      const source = await readFile(new URL(`fixtures/${directory}program.py`, import.meta.url), "utf8")
      const module = parse({filename: "program.py", language: "python", source})

      for (const language of originalFive) {
        const filename = /** @type {string} */ (filenames.get(language))
        const generated = generate({language, module})
        const reparsed = parse({filename, language, source: generated})
        const result = await executeGenerated(language, module)

        expect({directory, language, meaning: withoutLocations(reparsed)}).toEqual({
          directory,
          language,
          meaning: withoutLocations(module)
        })
        expect({directory, language, stdout: result}).toEqual({directory, language, stdout})
      }
    }
  })

  it("round-trips and executes a valid Python function named object", async () => {
    const source = "def object(left: int, right: int) -> int:\n    return left + right\n\nprint(object(3, 4))\n"
    const module = parse({filename: "object.py", language: "python", source})
    const generated = generate({language: "python", module})
    const reparsed = parse({filename: "program.py", language: "python", source: generated})

    expect(generated).toContain("def object(left: int, right: int) -> int:\n")
    expect(withoutLocations(reparsed)).toEqual(withoutLocations(module))
    expect(await executeGenerated("python", module)).toEqual("7\n")
  })
})

/**
 * Executes a generated artifact through configured real toolchains.
 * @param {string} language - Target language.
 * @param {import("../src/semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {Promise<string>} Exact stdout.
 */
async function executeGenerated(language, module) {
  const artifacts = generateArtifactSet({language, module})
  const environment = {PATH: process.env.PATH}
  const stages = []

  if (language == "php") {
    stages.push({arguments: ["program.php"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("php")})
  } else if (language == "ruby") {
    stages.push({arguments: ["program.rb"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("ruby")})
  } else if (language == "javascript") {
    stages.push({arguments: ["program.js"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("node")})
  } else if (language == "typescript") {
    stages.push(
      {arguments: ["program.ts", "--target", "ES2024", "--module", "nodenext"], stage: /** @type {const} */ ("compile"), tool: await discoverCanonicalToolchain("tsc")},
      {arguments: ["program.js"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("node")}
    )
  } else if (language == "java") {
    stages.push(
      {arguments: ["Main.java"], stage: /** @type {const} */ ("compile"), tool: await discoverCanonicalToolchain("javac")},
      {arguments: ["-cp", ".", "Main"], stage: /** @type {const} */ ("execute"), tool: await discoverCanonicalToolchain("java")}
    )
  } else {
    const python = await discoverCanonicalToolchain("python")

    environment.PYTHONUTF8 = "1"
    environment.PYTHONIOENCODING = "utf-8"
    stages.push(
      {arguments: ["-m", "py_compile", "program.py"], stage: /** @type {const} */ ("compile"), tool: python},
      {arguments: ["program.py"], stage: /** @type {const} */ ("execute"), tool: python}
    )
  }
  const result = await runAcceptanceStages({artifacts, environment, stages, target: language, timeoutMs: 20_000})

  return result.stages.at(-1)?.stdout ?? ""
}
