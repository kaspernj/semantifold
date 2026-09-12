// @ts-check

import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, parse} from "../index.js"

const execFileAsync = promisify(execFile)

async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task012-${language}-`))

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

describe("type parameter runtime execution", () => {
  it("reparses, compiles, and executes inferred generic functions and records with every required real tool", async () => {
    const source = await readFile(new URL("fixtures/generics/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "ruby" ? "program.rb" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : "program.php"

      expect(parse({filename, language, source: generated}).functions).toHaveLength(4)
      expect(await execute(language, generated)).toEqual("ready\n2\nleft\n2\n")
    }
  })
})
