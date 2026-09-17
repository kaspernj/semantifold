// @ts-check

import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {discoverCanonicalToolchain, generateArtifactSet} from "../../index.js"
import {deterministicEnvironment} from "../../src/toolchains.js"

export const zigModes = ["Debug", "ReleaseSafe", "ReleaseFast"]
export const meaning = value => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const hash = content => createHash("sha256").update(content).digest("hex")

/** @param {import("../../src/semantic/types.js").SemanticModule} module @param {{expectedStatus?: number, label?: string}} [options] */
export async function executeZig(module, options = {}) {
  return executeZigArtifacts(generateArtifactSet({language: "zig", module}), options)
}

/**
 * Runs formatter, tests, native builds, and direct execution with fresh owned state and isolated mode caches.
 * @param {import("../../src/semantic/types.js").GeneratedArtifactSet} set - Exact generated project.
 * @param {{expectedStatus?: number, label?: string}} [options] - Runtime expectation.
 * @returns {Promise<{commands: object[], inputs: object[], label: string, modes: {mode: string, status: number, stderr: string, stdout: string}[], stable: boolean, tool: import("../../src/semantic/types.js").DiscoveredToolchain}>}
 */
export async function executeZigArtifacts(set, {expectedStatus = 0, label = "project"} = {}) {
  const zig = await discoverCanonicalToolchain("zig")
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-zig-"))
  const inputs = set.artifacts.map(artifact => ({path: artifact.path, content: artifact.content, sha256: hash(artifact.content)}))
  const results = {commands: [], inputs, label, modes: [], stable: false, tool: zig}

  try {
    for (const artifact of set.artifacts) {
      const filename = path.join(directory, artifact.path)

      await mkdir(path.dirname(filename), {recursive: true})
      await writeFile(filename, artifact.content)
    }
    const baseEnvironment = deterministicEnvironment({
      HOME: path.join(directory, "home"),
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NO_PROXY: "",
      PATH: process.env.PATH ?? "",
      TMPDIR: path.join(directory, "tmp"),
      TZ: "UTC"
    })
    await Promise.all([baseEnvironment.HOME, baseEnvironment.TMPDIR].map(value => mkdir(value, {recursive: true})))
    const invoke = (stage, arguments_, environment = baseEnvironment) => {
      const output = spawnSync(zig.executable, arguments_, {cwd: directory, env: environment, encoding: "utf8", maxBuffer: 1024 * 1024,
        timeout: 60_000, killSignal: "SIGKILL"})
      const result = {stage, executable: zig.executable, arguments: arguments_, stdout: output.stdout, stderr: output.stderr, status: output.status, signal: output.signal}

      results.commands.push(result)
      if (output.error) throw output.error
      assert.equal(output.signal, null, JSON.stringify(result))
      return result
    }
    const format = invoke("format", ["fmt", "--check", "build.zig", "src/main.zig"])

    assert.equal(format.status, 0, JSON.stringify(format))
    assert.equal(format.stdout, "")
    assert.equal(format.stderr, "")
    for (const mode of zigModes) {
      const key = mode.toLowerCase()
      const cache = path.join(directory, "cache", key)
      const environment = deterministicEnvironment({...baseEnvironment, ZIG_GLOBAL_CACHE_DIR: path.join(cache, "global"), ZIG_LOCAL_CACHE_DIR: path.join(cache, "local")})
      const prefix = path.join(directory, "output", key)
      const tests = invoke(`${mode}-test`, ["build", "test", `-Doptimize=${mode}`, "--prefix", prefix], environment)
      const build = invoke(`${mode}-build`, ["build", `-Doptimize=${mode}`, "--prefix", prefix], environment)

      assert.equal(tests.status, 0, JSON.stringify(tests))
      assert.equal(build.status, 0, JSON.stringify(build))
      assert.equal(tests.stdout, "")
      assert.equal(tests.stderr, "")
      assert.equal(build.stdout, "")
      assert.equal(build.stderr, "")
      const output = spawnSync(path.join(prefix, "bin", "semantifold-generated"), [], {cwd: directory, env: environment, encoding: "utf8",
        maxBuffer: 1024 * 1024, timeout: 30_000, killSignal: "SIGKILL"})
      const execution = {stage: `${mode}-execute`, executable: path.join(prefix, "bin", "semantifold-generated"), arguments: [],
        stdout: output.stdout, stderr: output.stderr, status: output.status, signal: output.signal}

      results.commands.push(execution)
      if (output.error) throw output.error
      assert.equal(output.signal, null, JSON.stringify(execution))
      assert.equal(output.status, expectedStatus, JSON.stringify(execution))
      results.modes.push({mode, stdout: output.stdout, stderr: output.stderr, status: output.status})
    }
    for (const artifact of inputs) assert.equal(hash(await readFile(path.join(directory, artifact.path))), artifact.sha256, artifact.path + " changed")
    results.stable = true
    return results
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}
