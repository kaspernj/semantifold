// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"
import {executeC} from "./support/c-toolchain.js"
import {executeRust} from "./support/rust-toolchain.js"
import {executeZig, meaning} from "./support/zig-toolchain.js"

const originalFive = new Map([
  ["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"],
  ["typescript", "program.ts"], ["java", "Main.java"]
])
const program = `function choose(flag: boolean, value: string): string {
  if (flag) { return "Zig " + value; } return value;
} console.log(choose(true, "crossing"));`

describe("Zig bidirectional native and managed crossings", () => {
  it("rotates every original-five Task-005 source through Zig reparse and all native modes", {timeoutMs: 600_000}, async () => {
    for (const [language, filename] of originalFive) {
      const source = await readFile(new URL(`fixtures/functions/${filename}`, import.meta.url), "utf8")
      const module = parse({language, filename, source})
      const entry = generateArtifactSet({language: "zig", module}).artifacts.find(({role}) => role == "entry")
      const reparsed = parse({language: "zig", filename: "src/main.zig", source: String(entry?.content)})

      expect(meaning(reparsed)).toEqual(meaning(module))
      const result = await executeZig(reparsed, {label: `${language}-to-zig`})

      for (const mode of result.modes) expect({status: mode.status, stderr: mode.stderr, stdout: mode.stdout})
        .toEqual({status: 0, stderr: "", stdout: "ready\n6\n"})
    }
  })

  it("executes one Zig-derived Task-005 module through every original-five target", {timeoutMs: 180_000}, async () => {
    const source = await readFile(new URL("fixtures/functions/program.ts", import.meta.url), "utf8")
    const original = parse({language: "typescript", filename: "program.ts", source})
    const entry = generateArtifactSet({language: "zig", module: original}).artifacts.find(({role}) => role == "entry")
    const module = parse({language: "zig", filename: "src/main.zig", source: String(entry?.content)})

    for (const language of originalFive.keys()) expect(await executeOriginal(language, module)).toEqual("ready\n6\n")
  })

  it("rotates managed semantics through Zig reparse and all native optimization modes", {timeoutMs: 180_000}, async () => {
    const module = parse({language: "typescript", filename: "program.ts", source: program})
    const set = generateArtifactSet({language: "zig", module})
    const reparsed = parse({language: "zig", filename: "src/main.zig", source: set.artifacts[1].content})

    expect(meaning(reparsed)).toEqual(meaning(module))
    const result = await executeZig(reparsed, {label: "managed-zig-managed"})

    for (const mode of result.modes) expect({status: mode.status, stderr: mode.stderr, stdout: mode.stdout})
      .toEqual({status: 0, stderr: "", stdout: "Zig crossing\n"})
  })

  it("executes Zig-derived semantics through representative C, Rust and Java targets", {timeoutMs: 180_000}, async () => {
    const original = parse({language: "typescript", filename: "program.ts", source: program})
    const zig = generateArtifactSet({language: "zig", module: original}).artifacts[1].content
    const module = parse({language: "zig", filename: "program.zig", source: zig})
    const c = await executeC(module, {optimization: "-O2", sanitized: true})

    expect(c.stdout).toEqual("Zig crossing\n")
    expect(c.stderr).toEqual("")
    const rust = await executeRust(module, {label: "zig-to-rust"})

    for (const mode of rust.modes) expect({status: mode.status, stderr: mode.stderr, stdout: mode.stdout})
      .toEqual({status: 0, stderr: "", stdout: "Zig crossing\n"})
    const java = generateArtifactSet({language: "java", module})
    const result = await runAcceptanceStages({artifacts: java, environment: {PATH: process.env.PATH}, target: "java", timeoutMs: 30_000,
      stages: [
        {arguments: ["Main.java"], stage: "compile", tool: await discoverCanonicalToolchain("javac")},
        {arguments: ["-cp", ".", "Main"], stage: "execute", tool: await discoverCanonicalToolchain("java")}
      ]})

    expect(result.stages.at(-1)?.stdout).toEqual("Zig crossing\n")
    expect(result.stages.every(stage => stage.stderr == "")).toBeTrue()
  })
})

async function executeOriginal(language, module) {
  const artifacts = generateArtifactSet({language, module})
  const filename = originalFive.get(language)
  const stages = []

  if (["php", "ruby", "javascript"].includes(language)) stages.push({arguments: [filename], stage: "execute",
    tool: await discoverCanonicalToolchain(language == "javascript" ? "node" : language)})
  else if (language == "typescript") stages.push(
    {arguments: [filename, "--target", "ES2024", "--module", "nodenext"], stage: "compile", tool: await discoverCanonicalToolchain("tsc")},
    {arguments: ["program.js"], stage: "execute", tool: await discoverCanonicalToolchain("node")})
  else stages.push(
    {arguments: [filename], stage: "compile", tool: await discoverCanonicalToolchain("javac")},
    {arguments: ["-cp", ".", "Main"], stage: "execute", tool: await discoverCanonicalToolchain("java")})
  const result = await runAcceptanceStages({artifacts, environment: {PATH: process.env.PATH}, target: language, timeoutMs: 30_000, stages})

  for (const stage of result.stages) expect(stage.stderr).toEqual("")
  return result.stages.at(-1)?.stdout
}
