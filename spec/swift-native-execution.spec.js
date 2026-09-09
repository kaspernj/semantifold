// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generate, parse, SemantifoldDiagnostic} from "../index.js"
import {executeSwift, executeSwiftArtifacts, swiftProfiles, swiftSourceArtifacts} from "./support/swift-toolchain.js"

describe("Swift real debug and optimized native execution", () => {
  for (const [directory, stdout] of swiftProfiles) {
    it("typechecks, compiles, and executes the " + (directory || "base") + " profile in both modes", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.swift`, import.meta.url), "utf8")
      const module = parse({language: "swift", filename: "program.swift", source})
      const results = [await executeSwiftArtifacts(swiftSourceArtifacts(source), {label: "original-" + (directory || "base")}),
        await executeSwift(module, {label: "generated-" + (directory || "base")})]

      for (const result of results) {
        expect(result.modes.map(({mode}) => mode)).toEqual(["debug", "optimized"])
        for (const mode of result.modes) {
          expect(mode.status).toEqual(0)
          expect(mode.stderr).toEqual("")
          expect(mode.stdout).toEqual(stdout)
          assert.deepEqual(mode.bytes, Buffer.from(stdout, "utf8"))
        }
      }
    })
  }

  it("preserves exact scalar-sequence string equality instead of Swift canonical equivalence", async () => {
    const source = 'function same(left: string, right: string): boolean { return left === right; } ' +
      'console.log(same("é", "é")); console.log(same("😀", "😀"));'
    const module = parse({language: "typescript", filename: "equality.ts", source})
    const result = await executeSwift(module, {label: "scalar-equality"})

    for (const mode of result.modes) expect(mode.stdout).toEqual("false\ntrue\n")
  })

  it("proves native String equality canonicalizes before the source adapter rejects it", async () => {
    const source = 'func same(_ left: String, _ right: String) -> Bool { return left == right }\nprint(same("é", "e\\u{301}"))\n'
    const native = await executeSwiftArtifacts(swiftSourceArtifacts(source), {label: "native-string-equality"})

    for (const mode of native.modes) expect(mode.stdout).toEqual("true\n")
    assert.throws(() => parse({language: "swift", filename: "native-equality.swift", source}), error =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == "swift")
  })

  it("executes with an absolute selected compiler when ambient PATH omits its companion-tool directory", async () => {
    const compiler = await discoverCanonicalToolchain("swiftc")
    const originalPath = process.env.PATH
    const compilerDirectory = path.dirname(compiler.executable)
    const ambientPath = "/nonexistent"

    process.env.PATH = ambientPath
    try {
      expect(process.env.PATH.split(path.delimiter)).not.toContain(compilerDirectory)
      const result = await executeSwiftArtifacts(swiftSourceArtifacts("print(5)\n"), {label: "absolute-compiler-companion-path", swiftc: compiler})

      for (const command of result.commands) expect(command.arguments[0]).toEqual("--driver-mode=swiftc")
      for (const mode of result.modes) expect(mode.stdout).toEqual("5\n")
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })

  it("keeps an unassigned mutable TypeScript local mutable and warning-clean in Swift", async () => {
    const module = parse({language: "typescript", filename: "mutable.ts", source:
      "function choose(left: number, right: number): number { let value: number = left; return value; } console.log(choose(5, 9));"})
    const local = module.functions[0].body.statements[0]
    const generated = generate({language: "swift", module})
    const reparsed = parse({language: "swift", filename: "generated.swift", source: generated})

    assert.equal(local.kind, "LocalDeclaration")
    if (local.kind == "LocalDeclaration") expect(local.mutable).toBeTrue()
    const reparsedLocal = reparsed.functions[0].body.statements[0]
    assert.equal(reparsedLocal.kind, "LocalDeclaration")
    if (reparsedLocal.kind == "LocalDeclaration") expect(reparsedLocal.mutable).toBeTrue()
    const result = await executeSwift(module, {label: "mutable-unassigned"})

    for (const mode of result.modes) expect(mode.stdout).toEqual("5\n")
  })
})
