// @ts-check

import {promisify} from "node:util"
import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse} from "../index.js"

const execFileAsync = promisify(execFile)

/**
 * Executes generated source through the real target toolchain.
 * @param {string} language - Target language.
 * @param {string} source - Generated source.
 * @returns {Promise<string>} Standard output.
 */
async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-statements-${language}-`))

  try {
    if (language == "php" || language == "ruby") {
      const filename = path.join(directory, language == "php" ? "program.php" : "program.rb")

      await writeFile(filename, source)
      return (await execFileAsync(language, [filename])).stdout
    }
    if (language == "javascript") {
      const filename = path.join(directory, "program.js")

      await writeFile(filename, source)
      return (await execFileAsync("node", [filename])).stdout
    }
    if (language == "typescript") {
      const filename = path.join(directory, "program.ts")

      await writeFile(filename, source)
      await execFileAsync(path.resolve("node_modules/.bin/tsc"), [filename, "--target", "ES2024", "--module", "nodenext"], {cwd: directory})
      return (await execFileAsync("node", [path.join(directory, "program.js")])).stdout
    }

    const filename = path.join(directory, "Main.java")

    await writeFile(filename, source)
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("sequenced block native target acceptance", () => {
  it("runs nested and fallthrough branches with exact ordered output in every real runtime", async () => {
    const source = await readFile(new URL("fixtures/statements/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      expect({language, output: await execute(language, generate({language, module}))})
        .toEqual({language, output: "checking\nyes\nmatched\nfallback\n"})
    }
  })
})
