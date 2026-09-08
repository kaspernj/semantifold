// @ts-check

import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {discoverCanonicalToolchain, generateArtifactSet} from "../../index.js"
import {deterministicEnvironment} from "../../src/toolchains.js"
import {rustLockfile, rustManifest} from "../../src/backends/rust-runtime.js"

export const rustProfiles = [["", "5\n"], ["scalars/", "yes\n"], ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"], ["statements/", "checking\nyes\nmatched\nfallback\n"]]
export const meaning = value => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const hash = content => createHash("sha256").update(content).digest("hex")

export function rustSourceArtifacts(content, manifest = rustManifest) {
  return {artifacts: [{path: "Cargo.toml", content: manifest}, {path: "Cargo.lock", content: rustLockfile}, {path: "src/main.rs", content}]}
}

export async function executeRust(module, options = {}) {
  return executeRustArtifacts(generateArtifactSet({language: "rust", module}), options)
}

// Each invocation owns a fresh crate and empty Cargo home. Explicit optional evidence preserves
// the actual inputs, commands and outputs without retaining temporary build products.
export async function executeRustArtifacts(set, {expectedStatus = 0, expectedCheckStatus = 0, label = "crate"} = {}) {
  const rustc = await discoverCanonicalToolchain("rustc")
  const cargo = await discoverCanonicalToolchain("cargo")
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-rust-"))
  const environment = deterministicEnvironment({PATH: process.env.PATH, HOME: directory, CARGO_HOME: path.join(directory, "cargo-home"),
    RUSTC: rustc.executable, CARGO_NET_OFFLINE: "true", CARGO_TERM_COLOR: "never", CARGO_INCREMENTAL: "0"})
  const commands = []
  const inputs = set.artifacts.map(artifact => ({path: artifact.path, content: artifact.content, sha256: hash(artifact.content)}))
  const results = {label, expected: {checkStatus: expectedCheckStatus, runtimeStatus: expectedStatus}, tools: {rustc, cargo}, inputs, commands, modes: [], stable: false}
  const invoke = (stage, executable, args) => {
    const output = spawnSync(executable, args, {cwd: directory, env: environment, encoding: "utf8", maxBuffer: 1024 * 1024,
      timeout: 30_000, killSignal: "SIGKILL"})
    const result = {stage, executable, arguments: args, stdout: output.stdout, stderr: output.stderr, status: output.status, signal: output.signal}

    commands.push(result)
    if (output.error) throw output.error
    assert.equal(output.signal, null, JSON.stringify(result))
    return result
  }

  try {
    for (const artifact of set.artifacts) {
      const filename = path.join(directory, artifact.path)

      await mkdir(path.dirname(filename), {recursive: true})
      await writeFile(filename, artifact.content)
    }
    const check = invoke("check", cargo.executable, ["check", "--offline", "--locked"])

    assert.equal(check.status, expectedCheckStatus, JSON.stringify(check))
    if (expectedCheckStatus == 0) for (const mode of ["debug", "release"]) {
      const flags = mode == "release" ? ["--release"] : []
      const build = invoke(mode + "-build", cargo.executable, ["build", "--offline", "--locked", ...flags])

      assert.equal(build.status, 0, JSON.stringify(build))
      assert.equal(build.stdout, "")
      assert.doesNotMatch(build.stderr, /warning:|error:/u)
      const direct = invoke(mode + "-execute", path.join(directory, "target", mode, "semantifold-generated"), [])
      const run = invoke(mode + "-cargo-run", cargo.executable, ["run", "--offline", "--locked", "--quiet", ...flags])

      assert.equal(direct.status, expectedStatus, JSON.stringify(direct))
      assert.equal(run.status, expectedStatus, JSON.stringify(run))
      assert.deepEqual([run.stdout, run.stderr], [direct.stdout, direct.stderr])
      results.modes.push({mode, stdout: run.stdout, stderr: run.stderr, status: run.status})
    }
    for (const artifact of inputs) assert.equal(hash(await readFile(path.join(directory, artifact.path))), artifact.sha256, artifact.path + " changed")
    results.stable = true
    return results
  } finally {
    try {
      if (process.env.SEMANTIFOLD_RUST_EVIDENCE) {
        await mkdir(process.env.SEMANTIFOLD_RUST_EVIDENCE, {recursive: true})
        const evidence = path.join(process.env.SEMANTIFOLD_RUST_EVIDENCE, path.basename(directory) + ".json")

        await writeFile(evidence, JSON.stringify(results, null, 2) + "\n")
      }
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  }
}
