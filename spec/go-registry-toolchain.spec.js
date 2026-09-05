// @ts-check

import path from "node:path"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
  discoverCanonicalToolchain,
  languageCapabilities,
  SemantifoldDiagnostic,
  supportedLanguages
} from "../index.js"

const execute = promisify(execFile)

describe("Go registry and toolchain", () => {
  it("registers Go last as a round-trip multi-artifact text language", () => {
    expect(supportedLanguages).toEqual(["php", "ruby", "javascript", "typescript", "java", "python", "csharp", "go"])
    expect(supportedLanguages.at(-1)).toEqual("go")
    expect(languageCapabilities.find(({id}) => id == "go")).toEqual({
      acceptance: {stages: ["parse", "generate", "compile", "validate", "execute"], toolchains: ["go"]},
      artifactMultiplicity: "multiple",
      id: "go",
      mapping: {binaryRanges: false, richText: true, sourceMapV3: true},
      roles: {applicationBackend: false, binaryBackend: false, frontend: true, interoperability: false, textBackend: true},
      roundTrip: true
    })
  })

  it("discovers the canonical Go 1.26 Linux amd64 executable", async () => {
    await withGoEnvironment(async (environment) => {
      const go = await discoverCanonicalToolchain(/** @type {any} */ ("go"), {environment})

      expect(canonicalToolchains[/** @type {keyof typeof canonicalToolchains} */ ("go")]).toEqual({
        canonicalCommand: "go",
        overrideEnvironmentVariable: "SEMANTIFOLD_GO",
        supportedVersion: /^go version go1\.26\.\d+ linux\/amd64$/u,
        versionArguments: ["version"]
      })
      expect(path.isAbsolute(go.executable)).toBeTrue()
      expect(go.version).toMatch(/^go version go1\.26\.\d+ linux\/amd64$/u)
    })
  })

  it("fails loudly for missing, wrong-minor, and wrong-architecture Go executables", async () => {
    await assert.rejects(
      () => discoverCanonicalToolchain(/** @type {any} */ ("go"), {environment: {PATH: ""}}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND" && error.language == "go"
    )
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-go-toolchain-"))

    try {
      for (const [name, version] of [["minor", "go version go1.25.9 linux/amd64"], ["arch", "go version go1.26.0 linux/arm64"]]) {
        const executable = path.join(directory, name)

        await writeFile(executable, "#!/bin/sh\nprintf '" + version + "\\n'\n")
        await chmod(executable, 0o755)
        await assert.rejects(
          () => discoverCanonicalToolchain(/** @type {any} */ ("go"), {override: executable}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION" &&
            error.language == "go" && error.version == version
        )
      }
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("binds gofmt to the discovered Go GOROOT and records the isolated environment contract", async () => {
    await withGoEnvironment(async (processEnvironment) => {
      const go = await discoverCanonicalToolchain(/** @type {any} */ ("go"), {environment: processEnvironment})
      const fields = ["GOVERSION", "GOOS", "GOARCH", "GOROOT", "GOTOOLCHAIN", "GOPROXY", "CGO_ENABLED", "GOENV",
        "GOWORK", "GOCACHE", "GOMODCACHE", "GOPATH", "GOTMPDIR"]
      const {stdout, stderr} = await execute(go.executable, ["env", "-json", ...fields], {
        encoding: "utf8", env: processEnvironment
      })
      const readback = JSON.parse(stdout)
      const expectedGoVersion = go.version.match(/^go version (go1\.26\.\d+) linux\/amd64$/u)?.[1]

      expect(stderr).toEqual("")
      expect(processEnvironment.GOENV).toEqual("off")
      assert.ok(expectedGoVersion)
      expect(readback).toMatchObject({CGO_ENABLED: "0", GOARCH: "amd64", GOENV: "", GOOS: "linux",
        GOPROXY: "off", GOTOOLCHAIN: "local", GOVERSION: expectedGoVersion, GOWORK: "off"})
      for (const field of ["GOCACHE", "GOMODCACHE", "GOPATH", "GOROOT", "GOTMPDIR"]) {
        expect(path.isAbsolute(readback[field])).toBeTrue()
      }
      const configuredGofmt = path.join(path.dirname(processEnvironment.SEMANTIFOLD_GO ?? go.executable), "gofmt")
      const fromRoot = path.join(readback.GOROOT, "bin", "gofmt")

      expect(await realpath(configuredGofmt)).toEqual(await realpath(fromRoot))
    })
  })
})

/**
 * Runs one check with isolated Go state.
 * @param {(environment: Record<string, string>) => Promise<void>} callback Isolated check.
 * @returns {Promise<void>} Completion.
 */
async function withGoEnvironment(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-go-environment-"))
  const paths = {
    GOCACHE: path.join(root, "cache"), GOMODCACHE: path.join(root, "modules"), GOPATH: path.join(root, "gopath"),
    GOTMPDIR: path.join(root, "tmp"), HOME: path.join(root, "home")
  }

  try {
    await Promise.all(Object.values(paths).map(async (directory) => await mkdir(directory, {recursive: true})))
    await callback({...paths, CGO_ENABLED: "0", GOARCH: "amd64", GOENV: "off", GOOS: "linux", GOPROXY: "off",
      GOSUMDB: "off", GOTOOLCHAIN: "local", GOVCS: "off", GOWORK: "off", PATH: process.env.PATH ?? "",
      ...(process.env.SEMANTIFOLD_GO === undefined ? {} : {SEMANTIFOLD_GO: process.env.SEMANTIFOLD_GO})})
  } finally {
    await rm(root, {force: true, recursive: true})
  }
}
