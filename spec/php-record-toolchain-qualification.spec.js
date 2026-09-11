// @ts-check

import assert from "node:assert/strict"
import {chmod, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {canonicalToolchains, discoverCanonicalToolchain, languageCapabilities, SemantifoldDiagnostic} from "../index.js"

/**
 * Runs one assertion against a fake PHP executable with deterministic version output.
 * @param {string} version - First PHP version line.
 * @param {(executable: string) => Promise<void>} assertion - Qualification assertion.
 * @returns {Promise<void>}
 */
async function withPhpVersion(version, assertion) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-php-record-version-"))
  const executable = path.join(directory, "php")

  try {
    await writeFile(executable, `#!/bin/sh\nprintf '${version}\\n'\n`)
    await chmod(executable, 0o755)
    await assertion(executable)
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("PHP closed-record toolchain qualification", () => {
  it("rejects PHP 8.1 for the closed-record execution profile", async () => {
    await withPhpVersion("PHP 8.1.29 (cli)", async (executable) => {
      await assert.rejects(
        () => discoverCanonicalToolchain("php82", {override: executable}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_UNSUPPORTED_VERSION" &&
          error.language == "php82" && error.version == "PHP 8.1.29 (cli)"
      )
    })
  })

  it("accepts PHP 8.2 for the closed-record execution profile", async () => {
    await withPhpVersion("PHP 8.2.0 (cli)", async (executable) => {
      const tool = await discoverCanonicalToolchain("php82", {override: executable})

      expect(tool.version).toEqual("PHP 8.2.0 (cli)")
    })
  })

  it("accepts a later PHP major for the closed-record execution profile", async () => {
    await withPhpVersion("PHP 9.0.0 (cli)", async (executable) => {
      const tool = await discoverCanonicalToolchain("php82", {override: executable})

      expect(tool.version).toEqual("PHP 9.0.0 (cli)")
    })
  })

  it("retains generic PHP 8 qualification while the registry selects the closed-record profile", async () => {
    await withPhpVersion("PHP 8.1.29 (cli)", async (executable) => {
      expect((await discoverCanonicalToolchain("php", {override: executable})).version).toEqual("PHP 8.1.29 (cli)")
    })
    expect(canonicalToolchains.php.supportedVersion).toEqual(/^PHP 8\./u)
    expect(languageCapabilities.find(({id}) => id == "php")?.acceptance.toolchains).toEqual(["php82"])
  })
})
