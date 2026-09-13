// @ts-check

import assert from "node:assert/strict"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {spawnSync} from "node:child_process"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, generateProgramArtifactSet, parseProgram} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const source = `export function consume(resource: ProbeResource): string {
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
export function acquisitionFailure(): string {
  try {
    const resource: ProbeResource = probeAcquire(true)
    probeClose(resource, false)
    return "bad-acquire"
  } catch (error) {
    if (!(error instanceof ProbeAcquireFailure)) { throw error }
    return error.message
  }
}
export function readFailure(): string {
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
export function branchClose(left: boolean): string {
  const resource: ProbeResource = probeAcquire(false)
  if (left) {
    probeClose(resource, false)
    return "left-closed"
  }
  probeClose(resource, false)
  return "right-closed"
}
export function loopRead(): string {
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
export function closeFailure(): string {
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
export function closedRead(): string {
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
console.log(probeEffect("left", 1, false) * 10 + probeEffect("right", 2, false))
console.log(probeEffect("receiver", 3, false) + probeEffect("argument", 4, false))
const resource: ProbeResource = probeAcquire(false)
console.log(consume(resource))
const owned: ProbeResource = probeAcquire(false)
probeClose(owned, false)
console.log("owned-reference")
console.log(acquisitionFailure())
console.log(readFailure())
console.log(branchClose(true))
console.log(branchClose(false))
console.log(loopRead())
console.log(closeFailure())
console.log(closedRead())
console.log(probeTrace())
`

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

describe("stdlib provider real runtime execution", () => {
  it("executes deterministic probe semantics on every adopted real toolchain through linked providers", async () => {
    const program = parseProgram({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript", source}]
    })
    const directory = await mkdtemp(join(tmpdir(), "semantifold-task035-"))
    const probePath = join(directory, "probe.txt")
    const environment = {...process.env, SEMANTIFOLD_TASK034_PROBE_PATH: probePath}

    try {
      await writeFile(probePath, "alpha\n", "utf8")
      const outputs = []

      for (const target of ["php", "ruby", "javascript", "typescript", "java"]) {
        outputs.push(await execute(target, generateProgramArtifactSet({language: target, program}), directory, environment))
      }
      expect(outputs).toEqual([expected, expected, expected, expected, expected])
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("keeps provider native lookup protected under a same-language compatibility-name collision", async () => {
    const program = parseProgram({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      entryModule: "main",
      sources: [{
        filename: "main.php",
        id: "main",
        language: "php",
        source: `<?php
namespace App\\Main;

function probeRead(): string {
    return "shadowed";
}

$first = probeAcquire(false);
try {
    echo probeRead(), PHP_EOL;
    echo probeEffect("marked", 1, false), PHP_EOL;
    echo probeTrace(), PHP_EOL;
    probeClose($first, false);
} catch (ProbeOperationFailure $error) {
    probeClose($first, false);
}
`
      }]
    })
    const set = generateProgramArtifactSet({language: "php", program})
    const provider = set.artifacts.find(({path}) => path == "providers/php/semantifold/task034/resource-probe.php")

    expect(provider.content).toContain("__semantifold_provider_php_probeAcquire")
    expect(provider.content).toContain("__semantifold_provider_php_probeEffect")
    expect(provider.content).toContain("__semantifold_provider_php_probeTrace")
    expect(provider.content).toContain("__semantifold_provider_php_probeClose")
    expect(provider.content).not.toContain("__semantifold_provider_php_probeRead")
    expect(provider.content).not.toContain("function probeRead")

    const directory = await mkdtemp(join(tmpdir(), "semantifold-task035-collision-"))

    try {
      await write(set, directory)
      await writeFile(join(directory, "probe.txt"), "alpha\n", "utf8")
      const output = run("php", [set.entry], directory, {...process.env, SEMANTIFOLD_TASK034_PROBE_PATH: join(directory, "probe.txt")})

      expect(output).toEqual("shadowed\n1\nacquire,effect:marked")
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("shares one Java owner support block across multi-module capability programs", async () => {
    const program = parseProgram({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      entryModule: "main",
      sources: [{
        filename: "lib.ts",
        id: "lib",
        language: "typescript",
        source: `export function consume(resource: ProbeResource): string {
  try {
    const line: string | null = probeRead(resource, false)
    probeClose(resource, false)
    if (line !== null) { return line }
    return "eof"
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    probeClose(resource, false)
    return error.message
  }
}
`
      }, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import {consume} from "./lib.js"
const resource: ProbeResource = probeAcquire(false)
console.log(consume(resource))
console.log(probeTrace())
`
      }]
    })
    const set = generateProgramArtifactSet({language: "java", program})
    const owner = set.artifacts.find(({path}) => path == "semantifold/generated/lib/Lib.java")
    const entry = set.artifacts.find(({path}) => path == "semantifold/generated/main/Main.java")

    expect(owner?.content).toContain("public static final class ProbeResource")
    expect(owner?.content).toContain("__semantifold_provider_java_probeAcquire")
    expect(entry?.content).toContain("import semantifold.generated.lib.Lib.ProbeResource;")
    expect(entry?.content).toContain("import static semantifold.generated.lib.Lib.*;")
    expect(entry?.content).not.toContain("final class ProbeResource")

    const directory = await mkdtemp(join(tmpdir(), "semantifold-task035-java-"))
    const environment = {...process.env, SEMANTIFOLD_TASK034_PROBE_PATH: join(directory, "probe.txt")}

    try {
      await writeFile(join(directory, "probe.txt"), "alpha\n", "utf8")
      expect(await execute("java", set, directory, environment)).toEqual("alpha\nacquire,read,close")
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })
})

async function write(set, directory) {
  for (const artifact of set.artifacts) {
    const path = join(directory, artifact.path)

    await mkdir(dirname(path), {recursive: true})
    await writeFile(path, artifact.content, "utf8")
  }
}

async function execute(target, set, directory, environment) {
  await write(set, directory)

  if (target == "php") return run("php", [set.entry], directory, environment)
  if (target == "ruby") return run("ruby", [set.entry], directory, environment)
  if (target == "javascript") return run("node", [set.entry], directory, environment)
  if (target == "typescript") {
    const files = set.artifacts.filter(({path}) => path.endsWith(".ts")).map(({path}) => path)
    const output = join(directory, "out")

    run("tsc", ["--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node",
      "--typeRoots", join(process.cwd(), "node_modules", "@types"), "--skipLibCheck", "--outDir", output, ...files], directory, environment)
    return run("node", [join(output, set.entry.replace(/\.ts$/u, ".js"))], directory, environment)
  }
  const files = set.artifacts.filter(({path}) => path.endsWith(".java")).map(({path}) => path)
  const entryClass = set.entry.replace(/\.java$/u, "").replaceAll("/", ".")

  run("javac", files, directory, environment)
  return run("java", ["-cp", directory, entryClass], directory, environment)
}

function run(command, arguments_, cwd, env) {
  const result = spawnSync(command, arguments_, {cwd, encoding: "utf8", env})

  assert.equal(result.error, undefined, `Required real tool '${command}' is unavailable: ${result.error?.message}`)
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout.trimEnd()
}
