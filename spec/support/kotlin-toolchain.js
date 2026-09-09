// @ts-check

import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {discoverCanonicalToolchain, generateArtifactSet} from "../../index.js"
import {deterministicEnvironment} from "../../src/toolchains.js"

export const kotlinProfiles = [["", "5\n"], ["scalars/", "yes\n"], ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"], ["statements/", "checking\nyes\nmatched\nfallback\n"]]

/** @param {string} content */
export function kotlinSourceArtifacts(content) {
  return {artifacts: [{path: "Program.kt", content}]}
}

/** @param {import("../../src/semantic/types.js").SemanticModule} module @param {{label?: string}} [options] */
export async function executeKotlin(module, options = {}) {
  const kotlinc = await discoverCanonicalToolchain("kotlinc")
  const java = await discoverCanonicalToolchain("java25")

  return executeKotlinArtifacts(generateArtifactSet({language: "kotlin", module}), {...options, java, kotlinc})
}

/**
 * Compiles one exact Program.kt to a runnable JAR and executes it without a shell.
 * @param {{artifacts: Array<{path: string, content: string}>}} set - Single-source artifact set.
 * @param {{expectedStatus?: number, java?: import("../../src/semantic/types.js").DiscoveredToolchain,
 *   kotlinc?: import("../../src/semantic/types.js").DiscoveredToolchain, label?: string}} [options] - Execution options.
 */
export async function executeKotlinArtifacts(set, {expectedStatus = 0, java, kotlinc, label = "program"} = {}) {
  const compiler = kotlinc ?? await discoverCanonicalToolchain("kotlinc")
  const runtime = java ?? await discoverCanonicalToolchain("java25")
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-kotlin-"))
  const executablePath = [path.dirname(compiler.executable), path.dirname(runtime.executable), "/usr/bin",
    ...(process.env.PATH ?? "").split(path.delimiter)]
  const environment = deterministicEnvironment({LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    PATH: [...new Set(executablePath.filter((entry) => entry.length > 0))].join(path.delimiter)})
  const commands = []
  const invoke = (stage, executable, arguments_, acceptedStatus = 0) => {
    const output = spawnSync(executable, arguments_, {cwd: directory, env: environment, encoding: "buffer",
      maxBuffer: 1024 * 1024, timeout: 30_000, killSignal: "SIGKILL"})
    const result = {stage, executable, arguments: arguments_, stdout: output.stdout?.toString("utf8") ?? "",
      stderr: output.stderr?.toString("utf8") ?? "", status: output.status, signal: output.signal}

    commands.push(result)
    if (output.error) throw output.error
    assert.equal(output.signal, null, JSON.stringify(result))
    assert.equal(output.status, acceptedStatus, JSON.stringify(result))
    return {...result, bytes: output.stdout}
  }

  try {
    assert.equal(set.artifacts.length, 1)
    assert.equal(set.artifacts[0].path, "Program.kt")
    await writeFile(path.join(directory, "Program.kt"), set.artifacts[0].content)
    const original = await readFile(path.join(directory, "Program.kt"))
    const compile = invoke("compile", compiler.executable,
      ["-language-version", "2.4", "-api-version", "2.4", "-jvm-target", "25", "-Werror", "-include-runtime",
        "Program.kt", "-d", "Program.jar"])
    const execute = invoke("execute", runtime.executable, ["-jar", "Program.jar"], expectedStatus)

    assert.deepEqual(await readFile(path.join(directory, "Program.kt")), original)
    return {commands, compile, directory, execute, label, tools: {java: runtime, kotlinc: compiler}}
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}
