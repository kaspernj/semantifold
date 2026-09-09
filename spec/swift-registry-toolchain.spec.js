// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdtemp, rm, symlink, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic, supportedLanguages} from "../index.js"

describe("Swift registration and exact compiler identity", () => {
  it("registers a mapped round-trip single-text lane with swiftc acceptance", () => {
    expect(supportedLanguages).toContain("swift")
    expect(languageCapabilities.find(({id}) => id == "swift")).toMatchObject({
      id: "swift", artifactMultiplicity: "single", roundTrip: true,
      acceptance: {stages: ["parse", "generate", "compile", "execute"], toolchains: ["swiftc"]},
      roles: {frontend: true, textBackend: true, binaryBackend: false, applicationBackend: false, interoperability: false},
      mapping: {richText: true, sourceMapV3: true, binaryRanges: false}
    })
    expect(canonicalToolchains.swiftc).toMatchObject({canonicalCommand: "swiftc", overrideEnvironmentVariable: "SEMANTIFOLD_SWIFTC",
      versionArguments: ["--driver-mode=swiftc", "--version"]})
  })

  it("preserves swiftc mode after resolving a multi-call compiler symlink", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-swift-driver-"))

    try {
      const driver = path.join(directory, "swift-driver")
      const compiler = path.join(directory, "swiftc")

      await writeFile(driver, `#!/bin/sh
if [ "$1" != "--driver-mode=swiftc" ] || [ "$2" != "--version" ] || [ "$#" -ne 2 ]; then
  printf 'invalid Swift driver invocation\n' >&2
  exit 64
fi
printf '%s\n' 'Swift version 6.3.3 (swift-6.3.3-RELEASE)' 'Target: x86_64-unknown-linux-gnu'
`)
      await chmod(driver, 0o755)
      await symlink(driver, compiler)
      const tool = await discoverCanonicalToolchain("swiftc", {override: compiler})

      expect(tool.executable).toEqual(driver)
      expect(tool.versionArguments).toEqual(["--driver-mode=swiftc", "--version"])
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })

  it("accepts only exact Swift 6.3.3 on the Linux x86-64 target and fails loudly when absent", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-swift-discovery-"))

    try {
      const executable = path.join(directory, "swiftc")
      const expected = "Swift version 6.3.3 (swift-6.3.3-RELEASE)\nTarget: x86_64-unknown-linux-gnu"

      await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '" + expected.replaceAll("\n", "' '") + "'\n")
      await chmod(executable, 0o755)
      const tool = await discoverCanonicalToolchain("swiftc", {override: executable})

      expect(tool.version).toEqual("Swift version 6.3.3 (swift-6.3.3-RELEASE)")
      expect(tool.versionOutput).toEqual(expected)
      for (const output of [expected.replaceAll("6.3.3", "6.3.2"), expected.replace("x86_64", "aarch64"),
        expected.replace("swift-6.3.3-RELEASE", "swift-6.3.3-DEVELOPMENT-SNAPSHOT")]) {
        await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '" + output.replaceAll("\n", "' '") + "'\n")
        await assert.rejects(discoverCanonicalToolchain("swiftc", {override: executable}), error =>
          error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION")
      }
      await assert.rejects(discoverCanonicalToolchain("swiftc", {environment: {PATH: ""}}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
      await assert.rejects(discoverCanonicalToolchain("swiftc", {override: "/missing/swiftc"}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "TOOL_NOT_FOUND")
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })
})
