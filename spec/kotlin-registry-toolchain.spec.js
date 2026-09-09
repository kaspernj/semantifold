// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("Kotlin registration and exact compiler identity", () => {
  it("registers a mapped round-trip single-text JVM lane", () => {
    expect(supportedLanguages).toContain("kotlin")
    expect(languageCapabilities.find(({id}) => id == "kotlin")).toMatchObject({
      id: "kotlin", artifactMultiplicity: "single", roundTrip: true,
      acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["kotlinc", "java25"]},
      roles: {frontend: true, textBackend: true, binaryBackend: false, applicationBackend: false, interoperability: false},
      mapping: {richText: true, sourceMapV3: true, binaryRanges: false}
    })
    expect(canonicalToolchains.kotlinc).toMatchObject({canonicalCommand: "kotlinc", overrideEnvironmentVariable: "SEMANTIFOLD_KOTLINC",
      versionArguments: ["-version"]})
    expect(canonicalToolchains.java25).toMatchObject({canonicalCommand: "java", overrideEnvironmentVariable: "SEMANTIFOLD_JAVA",
      versionArguments: ["-version"]})
  })

  it("accepts only exact Kotlin/JVM 2.4.20 and OpenJDK 25.0.4 identities and fails loudly when absent", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-kotlin-discovery-"))

    try {
      const executable = path.join(directory, "kotlinc")
      const expected = "info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-26.04-Ubuntu)"
      const noble = expected.replace("26.04", "24.04")

      await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '" + expected + "' >&2\n")
      await chmod(executable, 0o755)
      const tool = await discoverCanonicalToolchain("kotlinc", {override: executable})

      expect(tool.version).toEqual(expected)
      expect(tool.versionOutput).toEqual(expected)
      await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '" + noble + "' >&2\n")
      expect((await discoverCanonicalToolchain("kotlinc", {override: executable})).version).toEqual(noble)
      for (const output of [expected.replace("2.4.20", "2.4.10"), expected.replace("25.0.4", "24.0.2"),
        expected.replace("26.04", "25.04"), expected.replace("kotlinc-jvm", "kotlinc-js")]) {
        await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '" + output + "' >&2\n")
        await assert.rejects(discoverCanonicalToolchain("kotlinc", {override: executable}), error =>
          error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION")
      }
      await assert.rejects(discoverCanonicalToolchain("kotlinc", {environment: {PATH: ""}}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
      await assert.rejects(discoverCanonicalToolchain("kotlinc", {override: "/missing/kotlinc"}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
      const java = path.join(directory, "java")
      const javaVersion = 'openjdk version "25.0.4" 2026-07-21'
      const javaOutput = javaVersion + "\nOpenJDK Runtime Environment (build 25.0.4+7-1-26.04-Ubuntu)\n" +
        "OpenJDK 64-Bit Server VM (build 25.0.4+7-1-26.04-Ubuntu, mixed mode, sharing)"

      await writeFile(java, "#!/bin/sh\nprintf '%s\\n' '" + javaOutput + "' >&2\n")
      await chmod(java, 0o755)
      expect((await discoverCanonicalToolchain("java25", {override: java})).version).toEqual(javaVersion)
      await writeFile(java, "#!/bin/sh\nprintf '%s\\n' '" + javaOutput.replace("25.0.4", "24.0.2") + "' >&2\n")
      await assert.rejects(discoverCanonicalToolchain("java25", {override: java}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION")
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })
})
