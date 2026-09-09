// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"
import {executeKotlin, kotlinProfiles} from "./support/kotlin-toolchain.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"],
  ["typescript", "program.ts"], ["java", "Main.java"]])
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("Kotlin original-five bidirectional routes", () => {
  it("generates, reparses, and really executes every original target from all Kotlin profiles", async () => {
    for (const [directory, stdout] of kotlinProfiles) {
      const source = await readFile(new URL(`fixtures/${directory}program.kt`, import.meta.url), "utf8")
      const module = parse({language: "kotlin", filename: "Program.kt", source})

      for (const language of originalFive) {
        const content = generate({language, module})

        expect(meaning(parse({language, filename: filenames.get(language), source: content}))).toEqual(meaning(module))
        expect(await executeOriginal(language, module)).toEqual(stdout)
      }
    }
  })

  it("rotates one original-five source per profile through stable Kotlin generation, reparse, and JVM execution", async () => {
    for (const [index, [directory, stdout]] of kotlinProfiles.entries()) {
      const language = originalFive[index]
      const filename = filenames.get(language)
      const source = await readFile(new URL(`fixtures/${directory}${filename}`, import.meta.url), "utf8")
      const module = parse({language, filename, source})
      const first = generateArtifactSet({language: "kotlin", module})
      const second = generateArtifactSet({language: "kotlin", module})

      expect(second).toEqual(first)
      expect(meaning(parse({language: "kotlin", filename: "Program.kt", source: first.artifacts[0].content}))).toEqual(meaning(module))
      expect((await executeKotlin(module, {label: "from-" + language})).execute.stdout).toEqual(stdout)
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
