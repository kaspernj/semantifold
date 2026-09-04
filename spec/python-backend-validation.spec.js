// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const withoutLocations = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : nested))

describe("Python text backend", () => {
  it("emits deterministic annotated program.py source that reparses to equivalent meaning", async () => {
    const source = await readFile(new URL("fixtures/statements/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const first = generate({language: "python", module})
    const second = generate({language: "python", module})
    const reparsed = parse({filename: "program.py", language: "python", source: first})

    expect(first).toEqual(second)
    expect(first).toContain("def select(flag: bool, fallback: str) -> str:\n")
    expect(first).toContain("        elif (fallback == \"no\"):\n")
    expect(first).toContain("print(output)\n")
    expect(withoutLocations(reparsed)).toEqual(withoutLocations(module))
  })

  it("preserves immutable local intent and emits explicit parentheses for every operator", async () => {
    const [localsSource, operatorsSource] = await Promise.all([
      readFile(new URL("fixtures/locals/program.ts", import.meta.url), "utf8"),
      readFile(new URL("fixtures/operators/program.ts", import.meta.url), "utf8")
    ])
    const locals = generate({language: "python", module: parse({filename: "locals.ts", language: "typescript", source: localsSource})})
    const operators = generate({language: "python", module: parse({filename: "operators.ts", language: "typescript", source: operatorsSource})})

    expect(locals).toContain("    # @semantifold-immutable\n    preferred: str = \"yes\"\n")
    expect(operators).toContain("if ((left < right) and (not (left == right))):\n")
    expect(operators).toContain("return ((-left) + (right * 2))\n")
  })

  it("produces one program.py artifact with rich and Source Map v3 provenance", async () => {
    const source = await readFile(new URL("fixtures/program.py", import.meta.url), "utf8")
    const module = parse({filename: "source.py", language: "python", source})
    const artifact = generateArtifact({language: "python", module})
    const set = generateArtifactSet({language: "python", module})

    expect(artifact.filename).toEqual("program.py")
    expect(artifact.mapping.generated.language).toEqual("python")
    expect(artifact.mapping.spans.length > 0).toBeTrue()
    expect(artifact.sourceMap.version).toEqual(3)
    expect(set.entry).toEqual("program.py")
    expect(set.artifacts.map(({path}) => path)).toEqual(["program.py"])
    expect(set.artifacts[0].mediaType).toEqual("text/x-python")
    assert.throws(() => generateArtifact({filename: "other.py", language: "python", module}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "python")
  })

  it("uses pass only when a caller-owned semantic block is genuinely empty", async () => {
    const source = await readFile(new URL("fixtures/statements/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.entryPoint.body.statements[2])

    branch.consequent.statements = []
    expect(generate({language: "python", module})).toContain("    pass\n")

    const emptyEntry = structuredClone(module)

    emptyEntry.entryPoint.body.statements = []
    const generated = generate({language: "python", module: emptyEntry})

    expect(generated).toContain("\n\npass\n")
    expect(withoutLocations(parse({filename: "program.py", language: "python", source: generated}))).toEqual(withoutLocations(emptyEntry))
  })

  it("rejects Python spelling/capture hazards and malformed IR before emission", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const base = parse({filename: "program.ts", language: "typescript", source})

    for (const name of ["match", "case", "type", "_", "print", "int", "bool", "str", "not-ascii-é", "K"]) {
      const module = structuredClone(base)
      module.functions[0].name = name
      const printStatement = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (printStatement.expression)

      call.callee = name
      assert.throws(() => generate({language: "python", module}), (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "python")
    }

    const malformed = structuredClone(base)
    malformed.functions[0].body = /** @type {never} */ ({kind: "Block", statements: [
      {kind: "WhileStatement", location: malformed.functions[0].location}
    ]})
    assert.throws(() => generate({language: "python", module: malformed}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "python")
  })
})
