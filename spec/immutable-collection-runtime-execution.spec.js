// @ts-check

import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse} from "../index.js"

const execFileAsync = promisify(execFile)
const targets = ["php", "ruby", "javascript", "typescript", "java"]

async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task006-${language}-`))

  try {
    if (language == "php" || language == "ruby") {
      const filename = path.join(directory, language == "php" ? "program.php" : "program.rb")

      await writeFile(filename, source)
      return (await execFileAsync(language, [filename])).stdout
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

describe("immutable collection runtime execution", () => {
  it("generates, reparses, and executes order, index, lookup, size, nesting, and passage through every real toolchain", async () => {
    const source = await readFile(new URL("fixtures/collections/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "javascript" ? "program.js" :
        language == "typescript" ? "program.ts" : language == "ruby" ? "program.rb" : "program.php"

      expect(parse({filename, language, source: generated}).functions).toHaveLength(2)
      expect(await execute(language, generated)).toEqual("4\n4\n7\n42\n3\n1\n3\n3\n1\n")
    }
  })
})
