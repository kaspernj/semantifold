// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {discoverCanonicalToolchain, generateArtifactSet, runAcceptanceStages} from "../../index.js"
import {deterministicEnvironment} from "../../src/toolchains.js"

const executeFile = promisify(execFile)
const artifactPaths = ["pubspec.yaml", "pubspec.lock", "bin/program.dart"]

/**
 * Runs exact offline formatter, pub, analyzer, VM, compiler, and native acceptance.
 * @param {import("../../src/semantic/types.js").SemanticModule} module Semantic module.
 * @returns {Promise<{acceptance: import("../../src/semantic/types.js").AcceptanceResult, native: {stderr: string, stdout: string}, sourceHashes: string[]}>} Results.
 */
export async function executeDart(module) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-dart-state-"))

  try {
    const set = generateArtifactSet({language: "dart", module})
    const environment = await dartEnvironment(root)
    const dart = await discoverCanonicalToolchain("dart", {environment})
    const hashes = await validateDartFormat(set, path.join(root, "format"), environment, dart)
    const binaryDirectory = path.join(root, "native")
    const binary = path.join(binaryDirectory, "semantifold-dart")

    await mkdir(binaryDirectory, {recursive: true})
    const acceptance = await runAcceptanceStages({
      artifacts: set,
      environment,
      stages: [
        {arguments: ["pub", "get", "--offline", "--no-precompile"], stage: "restore", tool: dart},
        {arguments: ["compile", "exe", "bin/program.dart", "-o", binary], stage: "compile", tool: dart},
        {arguments: ["analyze", "--fatal-infos", "--fatal-warnings"], stage: "validate", tool: dart},
        {arguments: ["run", "bin/program.dart"], stage: "execute", tool: dart}
      ],
      target: "dart",
      timeoutMs: 60_000
    })
    const native = await executeFile(binary, [], {encoding: "utf8", env: environment, timeout: 30_000})

    assert.equal(native.stderr, "")
    assert.equal(native.stdout, acceptance.stages.at(-1)?.stdout)
    return {acceptance, native: {stderr: native.stderr, stdout: native.stdout}, sourceHashes: hashes}
  } finally {
    await rm(root, {force: true, recursive: true})
  }
}

/**
 * Constructs isolated Dart and pub state beneath one owned root.
 * @param {string} root Temporary state root.
 * @returns {Promise<Record<string, string>>} Exact child environment.
 */
export async function dartEnvironment(root) {
  const directories = {
    HOME: path.join(root, "home"),
    PUB_CACHE: path.join(root, "pub-cache"),
    TMPDIR: path.join(root, "tmp")
  }

  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, {recursive: true})))
  return deterministicEnvironment({
    ...directories,
    CI: "true",
    DART_SUPPRESS_ANALYTICS: "true",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH ?? "",
    PUB_HOSTED_URL: "http://127.0.0.1:9",
    TZ: "UTC",
    ...(process.env.SEMANTIFOLD_DART === undefined ? {} : {SEMANTIFOLD_DART: process.env.SEMANTIFOLD_DART})
  })
}

/**
 * Proves generated Dart source is already canonical formatter output without changing package artifacts.
 * @param {import("../../src/semantic/types.js").GeneratedArtifactSet} set Generated Dart package.
 * @param {string} directory Isolated package directory.
 * @param {Record<string, string>} environment Isolated environment.
 * @param {import("../../src/semantic/types.js").DiscoveredToolchain} dart Exact Dart tool.
 * @returns {Promise<string[]>} Artifact hashes.
 */
export async function validateDartFormat(set, directory, environment, dart) {
  await materializeDart(set, directory)
  const before = await dartSourceHashes(directory)
  const formatted = await executeFile(dart.executable, [
    "format", "--output=none", "--set-exit-if-changed", "bin/program.dart"
  ], {cwd: directory, encoding: "utf8", env: environment, timeout: 30_000})

  assert.equal(formatted.stderr, "")
  assert.deepEqual(await dartSourceHashes(directory), before)
  return before
}

/** Materializes only the three validated generated artifacts. */
export async function materializeDart(set, directory) {
  await mkdir(directory, {recursive: true})
  for (const artifact of set.artifacts) {
    const filename = path.join(directory, ...artifact.path.split("/"))

    await mkdir(path.dirname(filename), {recursive: true})
    await writeFile(filename, artifact.content)
  }
}

/** Hashes the exact immutable package artifacts in canonical order. */
export async function dartSourceHashes(directory) {
  return await Promise.all(artifactPaths.map(async (filename) =>
    createHash("sha256").update(await readFile(path.join(directory, filename))).digest("hex")))
}
