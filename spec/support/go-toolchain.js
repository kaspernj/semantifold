// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {execFile} from "node:child_process"
import {access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {expect} from "@velocious/testing"
import {discoverCanonicalToolchain, generateArtifactSet, runAcceptanceStages} from "../../index.js"

const executeFile = promisify(execFile)

/**
 * Formats, builds, vets, and executes one generated Go module offline.
 * @param {import("../../src/semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {Promise<import("../../src/semantic/types.js").AcceptanceResult>} Staged acceptance result.
 */
export async function executeGo(module) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-go-state-"))

  try {
    const set = generateArtifactSet({language: "go", module})
    const environment = await goEnvironment(root)

    await validateGoFormat(set, path.join(root, "format"), environment)
    const go = await discoverCanonicalToolchain("go", {environment})

    return await runAcceptanceStages({
      artifacts: set,
      environment,
      stages: [
        {arguments: ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", "semantifold-go", "."], stage: "compile", tool: go},
        {arguments: ["vet", "-mod=readonly", "."], stage: "validate", tool: go},
        {arguments: ["run", "-mod=readonly", "-trimpath", "-buildvcs=false", "."], stage: "execute", tool: go}
      ],
      target: "go",
      timeoutMs: 30_000
    })
  } finally {
    await rm(root, {force: true, recursive: true})
  }
}

/**
 * Creates the exact offline Go environment beneath one temporary root.
 * @param {string} root - Temporary root.
 * @returns {Promise<Record<string, string>>} Child environment.
 */
export async function goEnvironment(root) {
  const directories = {
    GOCACHE: path.join(root, "cache"),
    GOMODCACHE: path.join(root, "modcache"),
    GOPATH: path.join(root, "gopath"),
    GOTMPDIR: path.join(root, "tmp"),
    HOME: path.join(root, "home")
  }

  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, {recursive: true})))
  return {
    ...directories,
    CGO_ENABLED: "0",
    GOARCH: "amd64",
    GOENV: "off",
    GOOS: "linux",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    GOVCS: "off",
    GOWORK: "off",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH ?? "",
    ...(process.env.SEMANTIFOLD_GO === undefined ? {} : {SEMANTIFOLD_GO: process.env.SEMANTIFOLD_GO}),
    TZ: "UTC"
  }
}

/**
 * Proves generated Go source is already canonical gofmt output.
 * @param {import("../../src/semantic/types.js").GeneratedArtifactSet} set - Generated module.
 * @param {string} directory - Formatting directory.
 * @param {Record<string, string>} environment - Isolated Go environment.
 * @returns {Promise<void>}
 */
export async function validateGoFormat(set, directory, environment) {
  await materialize(set, directory)
  const before = await sourceHashes(directory)
  const go = await discoverCanonicalToolchain("go", {environment})
  const goRoot = (await executeFile(go.executable, ["env", "GOROOT"], {encoding: "utf8", env: environment})).stdout.trim()
  const configuredGofmt = path.join(path.dirname(environment.SEMANTIFOLD_GO ?? go.executable), "gofmt")
  const gofmt = path.join(goRoot, "bin", "gofmt")

  expect((await stat(configuredGofmt)).isFile()).toBeTrue()
  expect((await stat(gofmt)).isFile()).toBeTrue()
  expect(await realpath(configuredGofmt)).toEqual(await realpath(gofmt))
  const formatted = await executeFile(configuredGofmt, ["-d", "main.go"], {
    cwd: directory, encoding: "utf8", env: environment, timeout: 30_000
  })

  expect(formatted).toMatchObject({stderr: "", stdout: ""})
  expect(await sourceHashes(directory)).toEqual(before)
  await assertAbsentProjectFiles(directory)
}

/** @param {import("../../src/semantic/types.js").GeneratedArtifactSet} set @param {string} directory */
export async function materialize(set, directory) {
  await mkdir(directory, {recursive: true})
  for (const artifact of set.artifacts) await writeFile(path.join(directory, artifact.path), artifact.content)
}

/** @param {string} directory */
export async function sourceHashes(directory) {
  return await Promise.all(["go.mod", "main.go"].map(async (filename) =>
    createHash("sha256").update(await readFile(path.join(directory, filename))).digest("hex")))
}

/** @param {string} directory */
export async function assertAbsentProjectFiles(directory) {
  for (const name of ["go.sum", "go.work", "vendor"]) {
    await assert.rejects(access(path.join(directory, name)), (error) =>
      error instanceof Error && "code" in error && error.code == "ENOENT")
  }
}
