// @ts-check

import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {discoverCanonicalToolchain, generateArtifactSet} from "../../index.js"
import {deterministicEnvironment} from "../../src/toolchains.js"

export const swiftProfiles = [["", "5\n"], ["scalars/", "yes\n"], ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"], ["statements/", "checking\nyes\nmatched\nfallback\n"]]

/**
 * Wraps one original Swift fixture in the artifact shape accepted by the compiler runner.
 * @param {string} content - Original Swift source.
 * @returns {{artifacts: Array<{path: string, content: string}>}} Single-file artifact set.
 */
export function swiftSourceArtifacts(content) {
  return {artifacts: [{path: "program.swift", content}]}
}

export async function executeSwift(module, options = {}) {
  const swiftc = await discoverCanonicalToolchain("swiftc")

  return executeSwiftArtifacts(generateArtifactSet({language: "swift", module}), {...options, swiftc})
}

export async function executeSwiftArtifacts(set, {label = "program", swiftc} = {}) {
  const compiler = swiftc ?? await discoverCanonicalToolchain("swiftc")
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-swift-"))
  const compilerPath = [path.dirname(compiler.executable), "/usr/bin", ...(process.env.PATH ?? "").split(path.delimiter)]
  const environment = deterministicEnvironment({PATH: [...new Set(compilerPath.filter((entry) => entry.length > 0))].join(path.delimiter)})
  const commands = []
  const invoke = (stage, arguments_) => {
    const compilerArguments = ["--driver-mode=swiftc", ...arguments_]
    const output = spawnSync(compiler.executable, compilerArguments, {cwd: directory, env: environment, encoding: "utf8",
      maxBuffer: 1024 * 1024, timeout: 30_000, killSignal: "SIGKILL"})
    const result = {stage, executable: compiler.executable, arguments: compilerArguments, stdout: output.stdout, stderr: output.stderr,
      status: output.status, signal: output.signal}

    commands.push(result)
    if (output.error) throw output.error
    assert.equal(output.signal, null, JSON.stringify(result))
    assert.equal(output.status, 0, JSON.stringify(result))
    return result
  }

  try {
    assert.equal(set.artifacts.length, 1)
    assert.equal(set.artifacts[0].path, "program.swift")
    await writeFile(path.join(directory, "program.swift"), set.artifacts[0].content)
    const original = await readFile(path.join(directory, "program.swift"))

    invoke("typecheck", ["-warnings-as-errors", "-typecheck", "program.swift"])
    const modes = []

    for (const [mode, flags] of [["debug", []], ["optimized", ["-O"]]]) {
      const executable = `program-${mode}`

      invoke(mode + "-compile", ["-warnings-as-errors", ...flags, "program.swift", "-o", executable])
      const output = spawnSync(path.join(directory, executable), [], {cwd: directory, env: environment, encoding: "buffer",
        maxBuffer: 1024 * 1024, timeout: 20_000, killSignal: "SIGKILL"})

      if (output.error) throw output.error
      assert.equal(output.signal, null)
      assert.equal(output.status, 0)
      modes.push({mode, status: output.status, stderr: output.stderr.toString("utf8"), stdout: output.stdout.toString("utf8"), bytes: output.stdout})
    }
    assert.deepEqual(await readFile(path.join(directory, "program.swift")), original)
    return {commands, directory, label, modes, tool: compiler}
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}
