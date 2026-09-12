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
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task033-${language}-`))

  try {
    if (language == "php" || language == "ruby") {
      const filename = path.join(directory, language == "php" ? "program.php" : "program.rb")
      const executable = language == "php" ? (await discoverCanonicalToolchain("php82")).executable : "ruby"

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

describe("reference class runtime execution", () => {
  it("proves fresh state, aliasing, reference passing, and left-to-right receiver and argument evaluation", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "javascript" ? "program.js" :
        language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"

      expect(parse({filename, language, source: generated}).classes).toHaveLength(2)
      expect(await execute(language, generated)).toEqual("3\n5\n222\n1314\n")
    }
  })

  it("keeps direct function calls from Java reference methods executable", async () => {
    const module = parse({
      filename: "program.ts",
      language: "typescript",
      source: `class Box {
  private value: number
  constructor(value: number) { this.value = value }
  show(): void { printValue(this.value) }
}
function printValue(value: number): void { console.log(value) }
const box: Box = new Box(7)
box.show()
`
    })
    const generated = generate({language: "java", module})

    expect(parse({filename: "Main.java", language: "java", source: generated}).classes).toHaveLength(1)
    expect(await execute("java", generated)).toEqual("7\n")
  })
})
