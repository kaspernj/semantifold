// @ts-check

import {createHash} from "node:crypto"
import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"
import {executeRust, meaning, rustProfiles} from "./support/rust-toolchain.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"], ["typescript", "program.ts"], ["java", "Main.java"]])

describe("Rust original-five bidirectional native acceptance", () => {
  it("generates, reparses and executes every original target from all five Rust fixture profiles", async () => {
    for (const [directory, stdout] of rustProfiles) {
      const source = await readFile(new URL("fixtures/" + directory + "program.rs", import.meta.url), "utf8")
      const module = parse({language: "rust", filename: "program.rs", source})

      for (const language of originalFive) {
        const content = generate({language, module})

        expect(meaning(parse({language, filename: filenames.get(language), source: content}))).toEqual(meaning(module))
        expect(await executeOriginal(language, module)).toEqual(stdout)
      }
    }
  })

  it("rotates all original-five sources through Rust reparse and real offline debug/release execution", async () => {
    for (const [index, [directory, stdout]] of rustProfiles.entries()) {
      const language = originalFive[index]
      const filename = filenames.get(language)
      const source = await readFile(new URL("fixtures/" + directory + filename, import.meta.url), "utf8")
      const module = parse({language, filename, source})
      const content = generateArtifactSet({language: "rust", module}).artifacts[2].content

      expect(meaning(parse({language: "rust", filename: "src/main.rs", source: content}))).toEqual(meaning(module))
      const results = await executeRust(module, {label: language + "-to-rust"})

      for (const result of results.modes) {
        expect(result.stdout).toEqual(stdout)
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
      }
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
  if (process.env.SEMANTIFOLD_RUST_EVIDENCE) {
    await mkdir(process.env.SEMANTIFOLD_RUST_EVIDENCE, {recursive: true})
    const identity = createHash("sha256").update(JSON.stringify(meaning(module))).digest("hex")

    await writeFile(path.join(process.env.SEMANTIFOLD_RUST_EVIDENCE, language + "-" + identity + ".json"),
      JSON.stringify({direction: "rust-to-original", language, artifacts, result}, null, 2) + "\n")
  }
  return result.stages.at(-1).stdout
}
