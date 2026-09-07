// @ts-check

import {mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {discoverCanonicalToolchain, generateArtifactSet} from "../../index.js"
import {executeFileWithDeadline} from "../../src/subprocess.js"
import {deterministicEnvironment} from "../../src/toolchains.js"

const executeFile = promisify(execFile)

export const cFlags = Object.freeze([
  "--no-default-config", "-std=c17", "-Wall", "-Wextra", "-Werror", "-pedantic-errors",
  "-Wconversion", "-Wsign-conversion", "-Wshadow", "-Wstrict-prototypes", "-Wmissing-prototypes", "-Wformat=2",
  "-ftrapv", "-finput-charset=UTF-8", "-fexec-charset=UTF-8", "-fno-color-diagnostics"
])
export const sanitizerFlags = Object.freeze(["-g", "-fsanitize=address,undefined", "-fno-sanitize-recover=all", "-fno-omit-frame-pointer"])

export async function executeC(module, {optimization = "-O0", sanitized = false, extraSource, linkFlags = []} = {}) {
  const set = generateArtifactSet({language: "c", module})

  return await executeCArtifacts(set, {optimization, sanitized, extraSource, linkFlags})
}

export async function executeCArtifacts(set, {optimization = "-O0", sanitized = false, extraSource, linkFlags = []} = {}) {
  const clang = await discoverCanonicalToolchain("clang")
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-c-"))
  const environment = deterministicEnvironment({PATH: process.env.PATH,
    ...(sanitized ? {ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1:allocator_may_return_null=1", UBSAN_OPTIONS: "halt_on_error=1"} : {})})
  const instrumentation = sanitized ? [...sanitizerFlags] : []
  let stage = "compile"
  const invoke = (executable, args) => executeFileWithDeadline({executable, arguments: args,
    cwd: directory, environment, maxBuffer: 1024 * 1024, timeoutMs: 20_000})

  try {
    for (const artifact of set.artifacts) await writeFile(path.join(directory, artifact.path), artifact.content)
    const compile = await invoke(clang.executable, [...cFlags, optimization, ...instrumentation, "-c", "program.c", "-o", "program.o"])

    assert.deepEqual(compile, {stdout: "", stderr: ""})
    const objects = ["program.o"]

    if (extraSource !== undefined) {
      await writeFile(path.join(directory, "harness.c"), extraSource)
      const harness = await invoke(clang.executable, [...cFlags, optimization, ...instrumentation, "-c", "harness.c", "-o", "harness.o"])

      assert.deepEqual(harness, {stdout: "", stderr: ""})
      objects.push("harness.o")
    }
    stage = "link"
    const link = await invoke(clang.executable, ["--no-default-config", optimization, ...instrumentation, ...objects, ...linkFlags, "-o", "program"])

    assert.deepEqual(link, {stdout: "", stderr: ""})
    stage = "execute"
    const execution = await executeFile(path.join(directory, "program"), [], {
      cwd: directory, env: environment, encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 20_000, killSignal: "SIGKILL"
    })

    return {stdout: execution.stdout.toString("utf8"), stderr: execution.stderr.toString("utf8"), bytes: execution.stdout, status: 0,
      stages: ["compile", "link", "execute"], version: clang.version, directory}
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (Buffer.isBuffer(error.stdout)) error.stdout = error.stdout.toString("utf8")
    if (Buffer.isBuffer(error.stderr)) error.stderr = error.stderr.toString("utf8")
    throw Object.assign(error, {directory, stage})
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}
