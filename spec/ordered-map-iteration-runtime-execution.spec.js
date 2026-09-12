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
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task014-${language}-`))

  try {
    const filename = path.join(directory, filenames[language])

    await writeFile(filename, source)
    if (language == "php" || language == "ruby") return (await execFileAsync(language, [filename])).stdout
    if (language == "javascript") return (await execFileAsync("node", [filename])).stdout
    if (language == "typescript") {
      await execFileAsync(path.resolve("node_modules/.bin/tsc"), [filename, "--target", "ES2024", "--module", "nodenext", "--strict"], {cwd: directory})
      return (await execFileAsync("node", [path.join(directory, "program.js")])).stdout
    }
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("ordered map iteration runtime execution", () => {
  it("proves non-lexical insertion order, pair bindings, continue, and break with every required toolchain", async () => {
    const source = await readFile(new URL("fixtures/ordered-map-iteration/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames[language], language, source: generated})

      expect(reparsed.entryPoint.body.statements[3].kind).toEqual("ForEachMapStatement")
      expect(await execute(language, generated)).toEqual("3\n2\nb\n2\nc\n3\n")
    }
  })
})
