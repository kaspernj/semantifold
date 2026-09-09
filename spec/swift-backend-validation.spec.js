// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const moduleFrom = () => parse({language: "typescript", filename: "source.ts", source:
  "function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));"})
const failure = (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "swift"

describe("Swift transactional single-file backend", () => {
  it("emits one deterministic mapped program.swift that reparses without changing IR", () => {
    const module = moduleFrom()
    const before = structuredClone(module)
    const set = generateArtifactSet({language: "swift", module})
    const artifact = generateArtifact({language: "swift", module})

    expect(set.artifacts.map(({path, role}) => ({path, role}))).toEqual([{path: "program.swift", role: "entry"}])
    expect(generate({language: "swift", module})).toEqual(artifact.code)
    expect(artifact.code).toEqual(set.artifacts[0].content)
    expect(generateArtifactSet({language: "swift", module})).toEqual(set)
    expect(module).toEqual(before)
    expect(meaning(parse({language: "swift", filename: "program.swift", source: artifact.code}))).toEqual(meaning(module))
    expect(set.artifacts[0].provenance.kind).toEqual("text")
    expect(set.artifacts[0].provenance.sourceMap.version).toEqual(3)
  })

  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/"]) {
    it("preserves every " + (directory || "base") + " semantic occurrence through Swift reparse", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")
      const module = parse({language: "typescript", filename: "program.ts", source})
      const artifact = generateArtifact({language: "swift", module})

      expect(meaning(parse({language: "swift", filename: "program.swift", source: artifact.code}))).toEqual(meaning(module))
    })
  }

  it("uses explicit scalar spellings, canonical literals, and exact Unicode-scalar string equality", () => {
    const source = 'function compare(left: string, right: string): boolean { return left === right; } ' +
      'function different(left: string, right: string): boolean { return left !== right; } ' +
      'console.log(compare("é\\u0000😀\\n", "é\\u0000😀\\n") || different("a", "b"));'
    const module = parse({language: "typescript", filename: "unicode.ts", source})
    const artifact = generateArtifact({language: "swift", module})

    expect(artifact.code).toContain("_ left: String")
    expect(artifact.code).toContain("-> Bool")
    expect(artifact.code).toContain('"é\\u{0}😀\\n"')
    expect(artifact.code).toContain("semantifold_string_equal(left, right)")
    expect(artifact.code).toContain("semantifold_string_not_equal(left, right)")
    expect(artifact.code).toContain("unicodeScalars.elementsEqual")
    expect(meaning(parse({language: "swift", filename: "program.swift", source: artifact.code}))).toEqual(meaning(module))
    const support = artifact.mapping.spans.find((span) => artifact.code.slice(span.generated.start.offset, span.generated.end.offset)
      .includes("unicodeScalars.elementsEqual"))

    assert.ok(support)
    expect(support.mappingKind).toEqual("synthetic")
  })

  it("collapses only both complete canonical equality helpers", () => {
    const module = parse({language: "typescript", filename: "source.ts", source:
      "function same(left: string, right: string): boolean { return left === right; } console.log(same(\"a\", \"b\"));"})
    const source = generate({language: "swift", module})

    for (const changed of [
      source.replace("left.unicodeScalars.elementsEqual", "left.utf8.elementsEqual"),
      source.replace(/func semantifold_string_not_equal[\s\S]+?\n\}\n/u, ""),
      source.replace("semantifold_string_equal(left, right)", "semantifold_string_equal(left, right, right)")
    ]) {
      assert.throws(() => parse({language: "swift", filename: "modified.swift", source: changed}), error =>
        error instanceof SemantifoldDiagnostic && ["TYPE_MISMATCH", "UNSUPPORTED_SYNTAX"].includes(error.code) && error.language == "swift")
    }
  })

  it("emits and collapses only the exact mutable-local warning marker", () => {
    const module = parse({language: "typescript", filename: "mutable.ts", source:
      "function choose(left: number, right: number): number { let value: number = left; return value; } console.log(choose(4, 9));"})
    const source = generate({language: "swift", module})

    expect(source).toContain("semantifold_keep_mutable(&value)")
    expect(meaning(parse({language: "swift", filename: "program.swift", source}))).toEqual(meaning(module))
    const marker = generateArtifact({language: "swift", module}).mapping.spans.find((span) =>
      span.generated && source.slice(span.generated.start.offset, span.generated.end.offset).includes("semantifold_keep_mutable"))

    assert.ok(marker)
    expect(marker.mappingKind).toEqual("synthetic")
    for (const changed of [
      source.replace("semantifold_keep_mutable(&value)", "semantifold_keep_mutable(value)"),
      source.replace("semantifold_keep_mutable(&value)", "semantifold_keep_mutable(&left)"),
      source.replace("func semantifold_keep_mutable", "func semantifold_keep_mutable_changed")
    ]) {
      assert.throws(() => parse({language: "swift", filename: "modified.swift", source: changed}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == "swift")
    }
  })

  it("rejects malformed graphs, target collisions, invalid scalars, and known Int64 overflow before output", () => {
    for (const change of [
      module => { module.location = undefined },
      module => { module.functions[0].body.statements[0].expression.left = null },
      module => { module.functions[0].body.statements[0].expression.operation = "Divide" },
      module => { module.functions[0].body.statements[0].expression.type = "boolean" },
      module => { module.functions[0].parameters[0].type.name = "reference" },
      ...["Int64", "Bool", "String", "print", "Swift", "actor", "async", "await", "some", "any", "main",
        "semantifold_string_equal", "semantifold_owned", "bad-name"].map(name => module => { module.functions[0].name = name }),
      ...[-0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"].map(value => module => {
        module.entryPoint.body.statements[0].expression.arguments[0].value = value
      }),
      module => { module.functions[0].body.statements[0].expression = {kind: "BinaryExpression", operation: "IntegerMultiply", type: "integer",
        location: module.location, left: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location},
        right: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}} }
    ]) {
      const module = moduleFrom()

      change(module)
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        assert.throws(() => api({language: "swift", module}), failure)
      }
    }
  })

  it("rejects cycles, excessive expansion, alternate filenames, and source-map directives transactionally", () => {
    for (const kind of ["cycle", "expansion"]) {
      const module = moduleFrom()
      let expression = module.functions[0].body.statements[0].expression

      if (kind == "cycle") expression.left = expression
      else {
        for (let index = 0; index < 20; index++) expression = {...expression, left: expression, right: expression}
        module.functions[0].body.statements[0].expression = expression
      }
      assert.throws(() => generateArtifactSet({language: "swift", module}), failure)
    }
    for (const options of [{filename: "main.swift"}, {filename: "dir/program.swift"}, {mapDirective: "external"},
      {mapDirective: "inline"}, {sourceMapFilename: "other.map"}]) {
      assert.throws(() => generateArtifact({language: "swift", module: moduleFrom(), ...options}), failure)
    }
  })

  it("rejects an emitted Swift CST that exceeds the frontend traversal limit before returning an artifact", () => {
    const module = moduleFrom()
    let expression = {kind: "IntegerLiteral", location: module.location, value: 1}

    for (let index = 0; index < 300; index += 1) {
      expression = {kind: "BinaryExpression", left: expression, location: module.location, operation: "IntegerAdd", right: {
        kind: "IntegerLiteral", location: module.location, value: 1}, type: "integer"}
    }
    module.functions[0].body.statements[0].expression = expression
    assert.throws(() => generateArtifactSet({language: "swift", module}), error =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == "swift" &&
      error.message.includes("CST exceeds the 512-level traversal limit"))
  })
})
