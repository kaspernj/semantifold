// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"],
  ["typescript", "program.ts"], ["java", "Main.java"]])
const profiles = [["", "5\n"], ["scalars/", "yes\n"], ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"], ["statements/", "checking\nyes\nmatched\nfallback\n"]]
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("Swift original-five bidirectional routes", () => {
  it("generates, reparses, and really executes every original target from all Swift profiles", async () => {
    for (const [directory, stdout] of profiles) {
      const source = await readFile(new URL(`fixtures/${directory}program.swift`, import.meta.url), "utf8")
      const module = parse({language: "swift", filename: "program.swift", source})

      for (const language of originalFive) {
        const content = generate({language, module})

        expect(meaning(parse({language, filename: filenames.get(language), source: content}))).toEqual(meaning(module))
        expect(await executeOriginal(language, module)).toEqual(stdout)
      }
    }
  })

  it("rotates one original-five source per profile through deterministic Swift generation and reparse", async () => {
    for (const [index, [directory]] of profiles.entries()) {
      const language = originalFive[index]
      const filename = filenames.get(language)
      const source = await readFile(new URL(`fixtures/${directory}${filename}`, import.meta.url), "utf8")
      const module = parse({language, filename, source})
      const first = generateArtifactSet({language: "swift", module})
      const second = generateArtifactSet({language: "swift", module})

      expect(second).toEqual(first)
      expect(meaning(parse({language: "swift", filename: "program.swift", source: first.artifacts[0].content}))).toEqual(meaning(module))
    }
  })
})

async function executeOriginal(language, module) {
  const artifacts = generateArtifactSet({language, module})
  const stages = []

  if (["php", "ruby", "javascript"].includes(language)) stages.push({arguments: [filenames.get(language)], stage: "execute",
    tool: await discoverCanonicalToolchain(language == "javascript" ? "node" : language)})
  else if (language == "typescript") stages.push(
    {arguments: ["program.ts", "--target", "ES2024", "--module", "nodenext"], stage: "compile", tool: await discoverCanonicalToolchain("tsc")},
    {arguments: ["program.js"], stage: "execute", tool: await discoverCanonicalToolchain("node")})
  else stages.push(
    {arguments: ["Main.java"], stage: "compile", tool: await discoverCanonicalToolchain("javac")},
    {arguments: ["-cp", ".", "Main"], stage: "execute", tool: await discoverCanonicalToolchain("java")})
  const result = await runAcceptanceStages({artifacts, environment: {PATH: process.env.PATH}, stages, target: language, timeoutMs: 20_000})

  for (const stage of result.stages) expect(stage.stderr).toEqual("")
  return result.stages.at(-1).stdout
}
