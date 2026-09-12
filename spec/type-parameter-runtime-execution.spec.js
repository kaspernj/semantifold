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

  it("reparses, compiles, and executes substituted optional constructors plus order-independent generic calls", async () => {
    const source = `class Box<T> { constructor(readonly value: T) {} }
function optionalIdentity<T>(value: T | null): T | null { return value }
function leadingEvidence<T>(value: T, values: ReadonlyArray<T>): T { return value }
function trailingEvidence<T>(values: ReadonlyArray<T>, value: T): T { return value }
function pickList<T>(values: ReadonlyArray<T | null>, fallback: T): T { return fallback }
function pickMap<T>(values: ReadonlyMap<string, ReadonlyArray<T | null>>, fallback: T): T { return fallback }
function pickRecords<T>(values: ReadonlyMap<string, Box<T> | null>, fallback: T): T { return fallback }
const box: Box<string | null> = new Box<string | null>(null)
const present: string | null = optionalIdentity("present")
if (present !== null) { console.log(present) }
console.log(leadingEvidence("leading", []))
console.log(trailingEvidence([], "trailing"))
console.log(pickList([null], "list"))
console.log(pickMap(new Map([["missing", [null]]]), "map"))
console.log(pickRecords(new Map([["missing", null]]), "record"))
const boxed: string | null = box.value
if (boxed !== null) { console.log(boxed) }
`
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "ruby" ? "program.rb" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : "program.php"

      expect(parse({filename, language, source: generated}).functions).toHaveLength(6)
      expect(await execute(language, generated)).toEqual("present\nleading\ntrailing\nlist\nmap\nrecord\n")
    }
  })

  it("reparses and executes optional generic records plus instantiated call results in every required toolchain", async () => {
    const source = `class Box<T> { constructor(readonly size: T) {} }
class MaybeBox<T> { constructor(readonly value: T | null) {} }
function identity<T>(value: T): T { return value }
const box: Box<string> = new Box<string>("sized")
console.log(identity(box).size)
const maybe: MaybeBox<string> = new MaybeBox<string>("maybe")
const maybeValue: string | null = maybe.value
if (maybeValue !== null) { console.log(maybeValue) }
const optionalBox: Box<string> | null = new Box<string>("present")
if (optionalBox !== null) { console.log(optionalBox.size) }
const optionalText: string | null = "optional"
const result: string | null = identity(optionalText)
if (result !== null) { console.log(result) }
const boxes: ReadonlyArray<Box<string> | null> = [box, null]
console.log(boxes.length)
`
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const generated = generate({language, module})
      const filename = language == "java" ? "Main.java" : language == "ruby" ? "program.rb" :
        language == "javascript" ? "program.js" : language == "typescript" ? "program.ts" : "program.php"

      expect(parse({filename, language, source: generated}).functions).toHaveLength(1)
      expect(await execute(language, generated)).toEqual("sized\nmaybe\npresent\noptional\n2\n")
    }
  })
})
