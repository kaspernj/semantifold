// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {task036FacadeProgram} from "./support/task036-facade-programs.js"

describe("stdlib facade artifact linking", () => {
  it("emits collision-safe compiled facade modules, complete provenance, and only reachable support", () => {
    const program = parseProgram(task036FacadeProgram("typescript", "linked"))
    const set = generateProgramArtifactSet({language: "php", program})
    const paths = set.artifacts.map(({path}) => path)

    expect(paths).toEqual([
      "providers/php/semantifold/task034/resource-probe.php",
      "semantifold/facade/typescript/probe_runner.php",
      "semantifold/facade/typescript/probe.php",
      "main.php"
    ])
    expect(paths.some((path) => path.includes("unused"))).toBe(false)
    const runner = set.artifacts[1]
    const facade = set.artifacts[2]
    const entry = set.artifacts[3]

    expect(runner.role).toBe("support")
    expect(facade.role).toBe("support")
    expect(runner.provenance.kind).toBe("text")
    expect(runner.provenance.mapping.sources.map(({filename}) => filename)).toContain(
      "__semantifold_facades__/typescript/probe-runner.ts")
    expect(facade.content).toContain("function compatibilityProbe")
    expect(facade.content).not.toContain("__semantifold_provider_php_probeEffect")
    expect(runner.content).toContain("__semantifold_provider_php_probeEffect")
    expect(entry.content).toContain("compatibilityProbe")
    expect(set.artifacts[0].content).not.toContain("compatibilityProbe")
    expect(set.metadata).toMatchObject({
      facades: {
        language: "typescript",
        modules: [
          {identity: "semantifold.task036.typescript.probe-runner", version: "1.0.0"},
          {identity: "semantifold.task036.typescript.probe", version: "1.0.0"}
        ],
        schema: "SemantifoldStdlibFacades",
        version: 1
      },
      schema: "SemantifoldStdlibLink",
      version: 1
    })
  })

  it("converts the facade through every target backend and remains byte-for-byte deterministic", () => {
    const program = parseProgram(task036FacadeProgram("javascript", "stable"))

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const first = generateProgramArtifactSet({language, program})
      const second = generateProgramArtifactSet({language, program})

      assert.deepEqual(second, first)
      expect(first.artifacts.filter(({role}) => role == "support").length >= 2).toBe(true)
      expect(first.artifacts.some(({path}) => path.includes("semantifold/facade/javascript/probe"))).toBe(true)
    }
  })

  it("rejects forged facade descriptors transactionally before artifact exposure", () => {
    const program = parseProgram(task036FacadeProgram("typescript"))

    program.stdlibFacades.modules[1].version = "2.0.0"
    assert.throws(
      () => generateProgramArtifactSet({language: "php", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_VERSION_INCOMPATIBLE"
    )
  })

  it("rejects a facade semantic body detached from its declared canonical requirements", () => {
    const program = parseProgram(task036FacadeProgram("typescript"))
    const runner = program.modules[0].functions[0].body.statements[0]

    assert.equal(runner.kind, "TryStatement")
    if (runner.kind != "TryStatement") throw new Error("Expected qualification runner try statement.")
    runner.body.statements.shift()
    assert.throws(
      () => generateProgramArtifactSet({language: "php", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_AUTHORITY_FORGED"
    )
  })
})
