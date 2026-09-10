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
const filenames = {java: "Main.java", javascript: "program.js", php: "program.php", ruby: "program.rb", typescript: "program.ts"}

async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task007-${language}-`))

  try {
    const filename = path.join(directory, filenames[language])

    await writeFile(filename, source)
    if (language == "php" || language == "ruby") return (await execFileAsync(language, [filename])).stdout
    if (language == "javascript") return (await execFileAsync(process.execPath, [filename])).stdout
    if (language == "typescript") {
      const compiler = path.resolve("node_modules/.bin/tsc")

      await execFileAsync(compiler, [filename, "--target", "ES2024", "--module", "nodenext", "--strict"], {cwd: directory})
      return (await execFileAsync(process.execPath, [path.join(directory, "program.js")])).stdout
    }
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("optional value runtime execution", () => {
  it("generates, reparses, compiles, and executes present and absent values through every real original-five toolchain", async () => {
    const source = await readFile(new URL("fixtures/optionals/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})

      expect(parse({filename: filenames[language], language, source: generated}).functions).toHaveLength(2)
      expect(await execute(language, generated)).toEqual("present\nabsent\n")
    }
  })

  it("executes present and absent optional list elements and map values through every real toolchain", async () => {
    const source = await readFile(new URL("fixtures/optionals-recursive/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})

      expect(parse({filename: filenames[language], language, source: generated}).functions).toHaveLength(1)
      expect(await execute(language, generated)).toEqual("list-present\nabsent\nmap-present\nabsent\n")
    }
  })
})
