// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"
import {task036FacadeProgram} from "./support/task036-facade-programs.js"

const languages = ["php", "ruby", "javascript", "typescript", "java"]

describe("parser-proved stdlib facade resolution", () => {
  it("substitutes exact native identities and compiles only the transitive facade closure", () => {
    for (const language of languages) {
      const program = parseProgram(task036FacadeProgram(language))

      expect(program.modules.map(({id}) => id)).toEqual([
        `semantifold.facade.${language}.probe_runner`,
        `semantifold.facade.${language}.probe`,
        "main"
      ])
      expect(program.sources).toHaveLength(3)
      expect(program.sources.map(({ownership}) => ownership)).toEqual(["application", "facade", "facade"])
      expect(program.stdlibContract).toEqual({contractVersion: "1", identity: "semantifold.task034.resource-probe"})
      expect(program.stdlibFacades).toMatchObject({
        language,
        modules: [
          {identity: `semantifold.task036.${language}.probe-runner`, version: "1.0.0"},
          {identity: `semantifold.task036.${language}.probe`, version: "1.0.0"}
        ],
        schema: "SemantifoldStdlibFacades",
        version: 1
      })
      expect(program.stdlibFacades.modules.some(({identity}) => identity.endsWith(".unused"))).toBe(false)

      const runner = program.modules[0]
      const facade = program.modules[1]
      const application = program.modules[2]

      expect(runner.capabilities).toHaveLength(1)
      expect(facade.capabilities).toBe(undefined)
      expect(application.capabilities).toBe(undefined)
      expect(facade.exports).toMatchObject([{symbolKind: "function"}])
      expect(application.imports).toHaveLength(1)
      expect(application.imports[0].stdlibFacade).toMatchObject({
        facadeIdentity: `semantifold.task036.${language}.probe`,
        facadeVersion: "1.0.0",
        nativeSymbol: language == "php" || language == "ruby" ? "compatibility_probe" : "compatibilityProbe",
        schema: "SemantifoldStdlibFacadeResolution",
        version: 1
      })
      expect(application.imports[0].sourceProvenance?.ranges.path.filename).toBe(application.sourceFilename)
      expect(application.imports[0].sourceProvenance?.ranges.importedName.filename).toBe(application.sourceFilename)
    }
  })

  it("does not substitute user-defined declarations that merely share the facade spelling", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `function compatibilityProbe(label: string): string { return label }
console.log(compatibilityProbe("ordinary"))
`
      }]
    })

    expect(program.modules).toHaveLength(1)
    expect(program.stdlibFacades).toBe(undefined)
    expect(program.stdlibContract).toBe(undefined)
  })

  it("rejects unproved, unsupported, shadowed, dynamic, reflective, native-extension, and forged-authority forms with locations", () => {
    const cases = [
      {
        code: "STDLIB_FACADE_IDENTITY_UNPROVED",
        input: {entryModule: "main", sources: [{filename: "unknown.ts", id: "main", language: "typescript",
          source: "import {compatibilityProbe} from \"node:unknown\"\nconsole.log(compatibilityProbe(\"x\"))\n"}]}
      },
      {
        code: "STDLIB_FACADE_MEMBER_UNSUPPORTED",
        input: {entryModule: "main", sources: [{filename: "member.ts", id: "main", language: "typescript",
          source: "import {unsupported} from \"semantifold:task036/probe\"\nconsole.log(unsupported(\"x\"))\n"}]}
      },
      {
        code: "STDLIB_FACADE_SHADOWED",
        input: {entryModule: "main", sources: [{filename: "shadow.php", id: "main", language: "php", source: `<?php
namespace App\\Main;
use function Semantifold\\Task036\\Probe\\compatibility_probe;
function compatibility_probe(string $label): string { return $label; }
echo compatibility_probe("x"), PHP_EOL;
`}]}
      },
      {
        code: "STDLIB_FACADE_DYNAMIC_REFERENCE",
        input: {entryModule: "main", sources: [{filename: "dynamic.ts", id: "main", language: "typescript",
          source: "import(\"semantifold:task036/probe\")\nconsole.log(\"x\")\n"}]}
      },
      {
        code: "STDLIB_FACADE_REFLECTION_UNSUPPORTED",
        input: {entryModule: "main", sources: [{filename: "reflect.ts", id: "main", language: "typescript",
          source: "import {compatibilityProbe} from \"semantifold:task036/probe\"\nconsole.log(eval(\"compatibilityProbe\"))\n"}]}
      },
      {
        code: "STDLIB_FACADE_SHADOWED",
        input: {entryModule: "main", sources: [{filename: "mutation.ts", id: "main", language: "typescript",
          source: "import {compatibilityProbe} from \"semantifold:task036/probe\"\ncompatibilityProbe = (label: string): string => label\nconsole.log(\"x\")\n"}]}
      },
      {
        code: "STDLIB_FACADE_REOPENED",
        input: {entryModule: "main", sources: [{filename: "reopened.rb", id: "main", language: "ruby", source: `require "semantifold/task036/probe"
module SemantifoldTask036Probe
  module_function
  # @param label [String]
  # @return [String]
  def compatibility_probe(label)
    return label
  end
end
`}]}
      },
      {
        code: "STDLIB_FACADE_NATIVE_EXTENSION_UNSUPPORTED",
        input: {entryModule: "main", sources: [{filename: "extension.rb", id: "main", language: "ruby", source: `require "semantifold/task036/probe.so"
module Main
  puts "x"
end
`}]}
      },
      {
        code: "STDLIB_FACADE_DYNAMIC_REFERENCE",
        input: {entryModule: "main", sources: [{filename: "dynamic.rb", id: "main", language: "ruby", source: `name = "probe"
require "semantifold/task036/#{name}"
module Main
  puts "x"
end
`}]}
      },
      {
        code: "STDLIB_FACADE_AUTHORITY_FORGED",
        input: {...task036FacadeProgram("typescript"), capabilityAuthority: createCapabilityAuthority(task034AuthorityInput())}
      }
    ]

    for (const {code, input} of cases) {
      assert.throws(
        () => parseProgram(input),
        (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
          typeof error.location?.filename == "string" && error.location.start.offset >= 0,
        code
      )
    }
  })

  it("rejects caller module collisions with compiler-owned facade identities before assembly", () => {
    const input = task036FacadeProgram("typescript")

    input.sources.push({
      filename: "collision.ts",
      id: "semantifold.facade.typescript.probe",
      language: "typescript",
      source: "export function collision(): string { return \"x\" }\n"
    })
    assert.throws(
      () => parseProgram(input),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_NAME_COLLISION" &&
        error.location?.filename == "collision.ts"
    )
  })
})
