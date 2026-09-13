// @ts-check

import assert from "node:assert/strict"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {spawnSync} from "node:child_process"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, generate, parse} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const source = `function combine(first: number, second: number): number {
  return first * 10 + second
}
function consume(resource: ProbeResource): string {
  try {
    const first: string | null = probeRead(resource, false)
    const second: string | null = probeRead(resource, false)
    probeClose(resource, false)
    if (first !== null) {
      if (second !== null) { return "bad-present" }
      return first
    }
    return "bad-eof"
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    probeClose(resource, false)
    return error.message
  }
}
class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  close(): void { probeClose(this.resource, false) }
}
class Accumulator {
  private base: number
  constructor(base: number) { this.base = base }
  add(value: number): number { return this.base + value }
}
function createAccumulator(): Accumulator {
  const base: number = probeEffect("receiver", 3, false)
  return new Accumulator(base)
}
function createReader(): Reader {
  const resource: ProbeResource = probeAcquire(false)
  return new Reader(resource)
}
function consumeReader(reader: Reader): string {
  reader.close()
  return "owned-reference"
}
function acquisitionFailure(): string {
  try {
    const resource: ProbeResource = probeAcquire(true)
    probeClose(resource, false)
    return "bad-acquire"
  } catch (error) {
    if (!(error instanceof ProbeAcquireFailure)) { throw error }
    return error.message
  }
}
function readFailure(): string {
  const resource: ProbeResource = probeAcquire(false)
  try {
    const value: string | null = probeRead(resource, true)
    probeClose(resource, false)
    return "bad-read"
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    probeClose(resource, false)
    return error.message
  }
}
function branchClose(left: boolean): string {
  const resource: ProbeResource = probeAcquire(false)
  if (left) {
    probeClose(resource, false)
    return "left-closed"
  }
  probeClose(resource, false)
  return "right-closed"
}
function loopRead(): string {
  const resource: ProbeResource = probeAcquire(false)
  let reading: boolean = true
  let result: string = "bad-loop"
  try {
    while (reading) {
      const value: string | null = probeRead(resource, false)
      if (value !== null) { result = value }
      else { reading = false }
    }
    probeClose(resource, false)
    return result
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    probeClose(resource, false)
    return error.message
  }
}
function closeFailure(): string {
  const resource: ProbeResource = probeAcquire(false)
  try {
    probeClose(resource, true)
    return "bad-close"
  } catch (error) {
    if (!(error instanceof ProbeCloseFailure)) { throw error }
    try {
      probeClose(resource, false)
      return "bad-double-close"
    } catch (closedError) {
      if (!(closedError instanceof ProbeResourceClosed)) { throw closedError }
      return closedError.message
    }
  }
}
function closedRead(): string {
  const resource: ProbeResource = probeAcquire(false)
  probeClose(resource, false)
  try {
    const value: string | null = probeRead(resource, false)
    return "bad-closed-read"
  } catch (error) {
    if (!(error instanceof ProbeResourceClosed)) { throw error }
    return error.message
  }
}
console.log(combine(probeEffect("left", 1, false), probeEffect("right", 2, false)))
console.log(createAccumulator().add(probeEffect("argument", 4, false)))
const resource: ProbeResource = probeAcquire(false)
console.log(consume(resource))
const reader: Reader = createReader()
console.log(consumeReader(reader))
console.log(acquisitionFailure())
console.log(readFailure())
console.log(branchClose(true))
console.log(branchClose(false))
console.log(loopRead())
console.log(closeFailure())
console.log(closedRead())
console.log(probeTrace())`

describe("effectful capability real runtime execution", () => {
  it("compiles and executes deterministic semantics on every adopted real toolchain", async () => {
    const authority = createCapabilityAuthority(task034AuthorityInput())
    const module = parse({capabilityAuthority: authority, filename: "runtime.ts", language: "typescript", source})
    const directory = await mkdtemp(join(tmpdir(), "semantifold-task034-"))
    const probePath = join(directory, "probe.txt")
    const environment = {...process.env, SEMANTIFOLD_TASK034_PROBE_PATH: probePath}

    try {
      await writeFile(probePath, "alpha\n", "utf8")
      const outputs = []

      for (const target of ["php", "ruby", "javascript", "typescript", "java"]) {
        const code = generate({language: target, module})
        const reparsed = parse({capabilityAuthority: authority, filename: generatedFilename(target), language: target, source: code})

        expect(reparsed.functions).toHaveLength(module.functions.length)
        expect(reparsed.classes).toHaveLength(module.classes.length)
        expect(reparsed.capabilities).toEqual(module.capabilities)
        outputs.push(await execute(target, code, directory, environment))
      }
      const expected = [
        "12",
        "7",
        "alpha",
        "owned-reference",
        "ProbeAcquireFailure",
        "ProbeReadFailure",
        "left-closed",
        "right-closed",
        "alpha",
        "ProbeResourceClosed",
        "ProbeResourceClosed",
        "effect:left,effect:right,effect:receiver,effect:argument,acquire,read,read,close,acquire,close,acquire,acquire,read,close,acquire,close,acquire,close,acquire,read,read,close,acquire,close,acquire,close"
      ].join("\n")

      expect(outputs).toEqual([expected, expected, expected, expected, expected])
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })
})

function generatedFilename(target) {
  return target == "php" ? "program.php" : target == "ruby" ? "program.rb" : target == "javascript" ? "program.js" :
    target == "typescript" ? "program.ts" : "Main.java"
}

async function execute(target, code, directory, environment) {
  if (target == "php") {
    const path = join(directory, "program.php")
    await writeFile(path, code, "utf8")
    return run("php", [path], directory, environment)
  }
  if (target == "ruby") {
    const path = join(directory, "program.rb")
    await writeFile(path, code, "utf8")
    return run("ruby", [path], directory, environment)
  }
  if (target == "javascript") {
    const path = join(directory, "program.mjs")
    await writeFile(path, code, "utf8")
    return run("node", [path], directory, environment)
  }
  if (target == "typescript") {
    const path = join(directory, "program.ts")
    const output = join(directory, "typescript")
    await mkdir(output)
    await writeFile(path, code, "utf8")
    run("tsc", ["--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node",
      "--typeRoots", join(process.cwd(), "node_modules", "@types"), "--skipLibCheck", "--outDir", output, path],
    directory, environment)
    return run("node", [join(output, "program.js")], directory, environment)
  }
  const path = join(directory, "Main.java")
  await writeFile(path, code, "utf8")
  run("javac", [path], directory, environment)
  return run("java", ["-cp", directory, "Main"], directory, environment)
}

function run(command, arguments_, cwd, env) {
  const result = spawnSync(command, arguments_, {cwd, encoding: "utf8", env})

  assert.equal(result.error, undefined, `Required real tool '${command}' is unavailable: ${result.error?.message}`)
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout.trimEnd()
}
