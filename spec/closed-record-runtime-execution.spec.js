// @ts-check

import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, parse} from "../index.js"

const execFileAsync = promisify(execFile)
const targets = ["php", "ruby", "javascript", "typescript", "java"]

async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task009-${language}-`))

  try {
    if (language == "php" || language == "ruby") {
      const filename = path.join(directory, language == "php" ? "program.php" : "program.rb")
      const executable = language == "php" ? (await discoverCanonicalToolchain("php82")).executable : language

      await writeFile(filename, source)
      return (await execFileAsync(executable, [filename])).stdout
    }
    if (language == "javascript") {
      const filename = path.join(directory, "program.js")

      await writeFile(filename, source)
      return (await execFileAsync(process.execPath, [filename])).stdout
    }
    if (language == "typescript") {
      const filename = path.join(directory, "program.ts")
      const compiler = path.resolve("node_modules/.bin/tsc")

      await writeFile(filename, source)
      await execFileAsync(compiler, [filename, "--target", "ES2024", "--module", "nodenext", "--strict"], {cwd: directory})
      return (await execFileAsync(process.execPath, [path.join(directory, "program.js")])).stdout
    }
    const filename = path.join(directory, "Main.java")

    await writeFile(filename, source)
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("closed record runtime execution", () => {
  it("reparses, compiles, and runs nominal records through every required real toolchain", async () => {
    const source = await readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({
        language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language),
        module
      })
      const filename = language == "java" ? "Main.java" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"

      expect(parse({filename, language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), source: generated}).records).toHaveLength(2)
      expect(await execute(language, generated)).toEqual("Paris\n75000\n2\n1\nAda\n")
    }
  })

  it("compiles and runs optional- and container-mediated recursive records in every required target", async () => {
    const module = parse({
      filename: "recursive.ts",
      language: "typescript",
      source: `class Node {
  constructor(readonly value: string, readonly successor: Node | null, readonly children: ReadonlyArray<Node>) {}
}

function pass(node: Node): Node {
  return node
}

const leaf: Node = new Node("leaf", null, [])
const root: Node = new Node("root", null, [leaf])
for (const child of pass(root).children) {
  console.log(child.value)
  break
}
`
    })

    for (const language of targets) {
      const generated = generate({
        language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language),
        module
      })
      const filename = language == "java" ? "Main.java" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"

      expect(parse({filename, language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language), source: generated}).records).toHaveLength(1)
      expect(await execute(language, generated)).toEqual("leaf\n")
    }
  })

  it("preserves canonical semantic zero through record construction and member projection", async () => {
    const module = parse({
      filename: "zero.ts",
      language: "typescript",
      source: `class Box {
  constructor(readonly value: number) {}
}

function pass(box: Box): Box {
  return box
}

const box: Box = new Box(-0)
console.log(pass(box).value)
`
    })

    for (const language of targets) {
      const generated = generate({
        language: /** @type {import("../src/semantic/types.js").SemanticLanguage} */ (language),
        module
      })

      expect(await execute(language, generated)).toEqual("0\n")
    }
  })
})
