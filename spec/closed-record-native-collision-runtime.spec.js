// @ts-check

import {execFile} from "node:child_process"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const execFileAsync = promisify(execFile)

/**
 * Executes one focused generated record program through its real runtime.
 * @param {"javascript" | "ruby" | "java"} language - Runtime language.
 * @param {string} source - Complete generated source.
 * @returns {Promise<string>} Standard output.
 */
async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task009-collision-${language}-`))

  try {
    if (language == "javascript") {
      const filename = path.join(directory, "program.js")

      await writeFile(filename, source)
      return (await execFileAsync(process.execPath, [filename])).stdout
    }
    if (language == "ruby") {
      const filename = path.join(directory, "program.rb")

      await writeFile(filename, source)
      return (await execFileAsync("ruby", [filename])).stdout
    }
    const filename = path.join(directory, "Main.java")

    await writeFile(filename, source)
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("closed record native collision runtime", () => {
  it("keeps JavaScript record freezing independent from a field named Object", async () => {
    const module = parse({
      filename: "object-field.ts",
      language: "typescript",
      source: `class Box {
  constructor(readonly Object: string) {}
}

function pass(box: Box): Box {
  return box
}

const box: Box = new Box("safe")
console.log(pass(box).Object)
`
    })
    const generated = generate({language: "javascript", module})

    expect(await execute("javascript", `${generated}\nconsole.log(Object.isFrozen(box))\n`)).toEqual("safe\ntrue\n")
  })

  it("keeps Ruby record freezing independent from a parameterized function named freeze", async () => {
    const module = parse({
      filename: "parameterized-freeze.ts",
      language: "typescript",
      source: `class Box {
  constructor(readonly value: string) {}
}

function freeze(value: string): string {
  return value
}

const box: Box = new Box("safe")
console.log(freeze(box.value))
`
    })
    const generated = generate({language: "ruby", module})

    expect(await execute("ruby", `${generated}\nputs box.frozen?\n`)).toEqual("safe\ntrue\n")
  })

  it("keeps Ruby records frozen when a zero-argument function is named freeze", async () => {
    const module = parse({
      filename: "zero-freeze.ts",
      language: "typescript",
      source: `class Box {
  constructor(readonly value: string) {}
}

function freeze(): string {
  return "hijacked"
}

const box: Box = new Box("safe")
console.log(box.value)
`
    })
    const generated = generate({language: "ruby", module})

    expect(await execute("ruby", `${generated}\nputs box.frozen?\n`)).toEqual("safe\ntrue\n")
  })

  it("resolves, round-trips, and executes a Java record field accessor named equals", async () => {
    const source = `final class Box {
  private final String equals;

  Box(String equals) {
    this.equals = equals;
  }

  String equals() {
    return this.equals;
  }
}

public final class Main {
  private static Box pass(Box box) {
    return box;
  }

  public static void main(String[] args) {
    final Box box = new Box("safe");
    System.out.println(pass(box).equals());
  }
}
`
    const module = parse({filename: "Main.java", language: "java", source})
    const printed = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[1])

    expect(printed.expression).toMatchObject({field: "record:0:field:0", kind: "MemberRead"})
    const generated = generate({language: "java", module})
    const reparsed = parse({filename: "Main.java", language: "java", source: generated})

    expect(semanticMeaning(reparsed)).toEqual(semanticMeaning(module))
    expect(await execute("java", generated)).toEqual("safe\n")
  })
})
