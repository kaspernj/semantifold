// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"
import {executeC} from "./support/c-toolchain.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"], ["typescript", "program.ts"], ["java", "Main.java"]])
const profiles = [["", "5\n"], ["scalars/", "yes\n"], ["locals/", "yes\n"], ["operators/", "typed:operators\n"], ["statements/", "checking\nyes\nmatched\nfallback\n"]]
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("C original-five bidirectional native acceptance", () => {
  it("generates, reparses and executes all original targets from every C fixture profile", async () => {
    for (const [directory, stdout] of profiles) {
      const source = await readFile(new URL("fixtures/" + directory + "program.c", import.meta.url), "utf8")
      const module = parse({language: "c", filename: "program.c", source})

      for (const language of originalFive) {
        const filename = filenames.get(language)
        const content = generate({language, module})

        expect(meaning(parse({language, filename, source: content}))).toEqual(meaning(module))
        expect(await executeOriginal(language, module)).toEqual(stdout)
      }
    }
  })

  it("round-trips and executes each C fixture at O0/O2 in ordinary and sanitizer profiles", async () => {
    for (const [directory, stdout] of profiles) {
      const source = await readFile(new URL("fixtures/" + directory + "program.c", import.meta.url), "utf8")
      const module = parse({language: "c", filename: "program.c", source})
      const generated = generateArtifactSet({language: "c", module}).artifacts[0].content

      expect(generated).toEqual(source)
      expect(meaning(parse({language: "c", filename: "program.c", source: generated}))).toEqual(meaning(module))
      for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
        const result = await executeC(module, {optimization, sanitized})

        expect(result.stdout).toEqual(stdout)
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
        assert.deepEqual(result.bytes, Buffer.from(stdout, "utf8"))
      }
    }
  })

  it("rotates all original-five sources through generated C reparse and real native execution", async () => {
    for (const [index, [directory, stdout]] of profiles.entries()) {
      const language = originalFive[index]
      const filename = filenames.get(language)
      const source = await readFile(new URL("fixtures/" + directory + filename, import.meta.url), "utf8")
      const module = parse({language, filename, source})
      const content = generateArtifactSet({language: "c", module}).artifacts[0].content

      expect(meaning(parse({language: "c", filename: "program.c", source: content}))).toEqual(meaning(module))
      const result = await executeC(module)

      expect(result.stdout).toEqual(stdout)
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
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
