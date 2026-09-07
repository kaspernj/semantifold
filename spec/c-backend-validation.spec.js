// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const source = "function value(left: number, right: number): number { return left + right } console.log(value(4, 9))"
const moduleFrom = () => parse({language: "typescript", filename: "program.ts", source})
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

describe("C backend validation", () => {
  it("returns deterministic program/header artifacts without changing the semantic module", () => {
    const module = moduleFrom()
    const before = structuredClone(module)
    const first = generateArtifactSet({language: "c", module})

    expect(first).toEqual(generateArtifactSet({language: "c", module}))
    expect(module).toEqual(before)
    expect(first.artifacts.map(({path, role}) => ({path, role}))).toEqual([
      {path: "program.c", role: "entry"}, {path: "semantifold_runtime.h", role: "support"}
    ])
    expect(first.artifacts[0].provenance.kind).toEqual("text")
    expect(first.artifacts[1].provenance.kind).toEqual("synthetic")
  })

  it("reconstructs the original nested expressions from exact generated ordered regions", () => {
    const module = moduleFrom()
    const generated = generateArtifactSet({language: "c", module})
    const reparsed = parse({language: "c", filename: "program.c", source: generated.artifacts[0].content})

    expect(meaning(reparsed)).toEqual(meaning(module))
  })

  it("rejects unsupported artifact options and legacy single-artifact requests", () => {
    for (const api of [generate, generateArtifact]) assert.throws(() => api({language: "c", module: moduleFrom()}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE")
    for (const options of [{filename: "other.c"}, {filename: "dir/program.c"}, {mapDirective: "none"}, {sourceMapFilename: "program.c.map"}]) {
      assert.throws(() => generateArtifactSet({language: "c", module: moduleFrom(), ...options}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY")
    }
  })

  it("rejects known signed overflow, helper collisions and malformed IR before exposing artifacts", () => {
    for (const change of [
      (module) => { module.functions[0].name = "semantifold_ordered_000001" },
      (module) => { module.functions[0].parameters[0].name = "malloc" },
      (module) => { module.entryPoint.body.statements = [null] },
      (module) => { module.functions[0].body.statements[0].expression = {kind: "BinaryExpression", operation: "IntegerMultiply", type: "integer", location: module.location,
        left: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}, right: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}} }
    ]) {
      const module = moduleFrom()

      change(module)
      assert.throws(() => generateArtifactSet({language: "c", module}), (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "c")
    }
  })

  for (const name of ["TRUE", "FALSE", "MB_LEN_MAX"]) it("rejects C identifier collision " + name + " before returning artifacts", () => {
    for (const source of [
      `function value(${name}: number, right: number): number { return ${name} + right; } console.log(value(4, 9));`,
      `function value(left: number, right: number): number { const ${name}: number = left; return ${name} + right; } console.log(value(4, 9));`,
      `function ${name}(left: number, right: number): number { return left + right; } console.log(${name}(4, 9));`
    ]) {
      const module = parse({language: "typescript", filename: "collision.ts", source})

      assert.throws(() => generateArtifactSet({language: "c", module}), (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == "c" && error.location.filename == "collision.ts" &&
        source.slice(error.location.start.offset, error.location.end.offset).includes(name))
    }
  })

  it("rejects statically oversized strings carried through immutable local copies before returning either artifact", () => {
    let body = 'const slice0: string = "é";'

    for (let index = 1; index <= 63; index++) body += `const slice${index}: string = slice${index - 1} + slice${index - 1};`
    const module = parse({language: "typescript", filename: "size.ts",
      source: `function combine(left: string, right: string): string { ${body} return slice63; } console.log(combine("", ""));`})

    assert.throws(() => generateArtifactSet({language: "c", module}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "c" && /size|arena/u.test(error.message))
  })

  it("rejects a literal beyond the strict C17 4095-byte translation limit before returning artifacts", () => {
    const module = parse({language: "typescript", filename: "literal.ts", source:
      `function echo(left: string, right: string): string { return left; } console.log(echo(${JSON.stringify("é".repeat(2048))}, ""));`})

    assert.throws(() => generateArtifactSet({language: "c", module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && /literal/u.test(error.message))
  })

  it("rejects cyclic semantic expressions as capabilities without native stack failures", () => {
    const module = moduleFrom()
    const expression = module.functions[0].body.statements[0].expression

    expression.left = expression
    assert.throws(() => generateArtifactSet({language: "c", module}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "c")
  })

  it("rejects semantic graphs beyond the bounded C traversal depth before recursive validation", () => {
    const module = parse({language: "typescript", filename: "depth.ts", source:
      "function choose(left: boolean, right: boolean): boolean { return right; } console.log(choose(true, true));"})
    let expression = module.functions[0].body.statements[0].expression

    for (let depth = 0; depth < 600; depth++) expression = {kind: "BinaryExpression", operation: "BooleanAnd", type: "boolean", location: module.location,
      left: {kind: "BooleanLiteral", value: true, location: module.location}, right: expression}
    module.functions[0].body.statements[0].expression = expression
    assert.throws(() => generateArtifactSet({language: "c", module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && /nested/u.test(error.message))
  })

  it("rejects exponentially shared occurrence plans before six-digit numbering can exhaust", () => {
    const module = moduleFrom()
    let expression = module.functions[0].body.statements[0].expression

    for (let depth = 0; depth < 20; depth++) expression = {kind: "BinaryExpression", operation: "IntegerAdd", type: "integer", location: module.location,
      left: expression, right: expression}
    module.functions[0].body.statements[0].expression = expression
    assert.throws(() => generateArtifactSet({language: "c", module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && /six-digit/u.test(error.message))
  })

  it("rejects generated text beyond the frozen parser input limit before exposing either artifact", () => {
    const module = parse({language: "typescript", filename: "size.ts", source:
      "function choose(left: boolean, right: boolean): boolean { return right; } console.log(choose(true, true));"})
    let expression = module.functions[0].body.statements[0].expression

    for (let depth = 0; depth < 500; depth++) expression = {kind: "BinaryExpression", operation: "BooleanAnd", type: "boolean", location: module.location,
      left: {kind: "BooleanLiteral", value: true, location: module.location}, right: expression}
    module.functions[0].body.statements[0].expression = expression
    assert.throws(() => generateArtifactSet({language: "c", module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && /32767/u.test(error.message))
  })

  it("rejects malformed recursive IR, literal payloads, types, bindings and locations with C capability diagnostics", () => {
    const mutations = [
      (module) => { module.location = undefined },
      (module) => { module.functions[0].body.location = {filename: "a", start: null, end: null} },
      (module) => { module.functions[0].parameters[0].type.name = "pointer" },
      (module) => { module.functions[0].parameters[0].type.location = null },
      (module) => { module.functions[0].body.statements[0].expression.left = null },
      (module) => { module.functions[0].body.statements[0].expression.operation = "Divide" },
      (module) => { module.functions[0].body.statements[0].expression.type = "boolean" },
      (module) => { module.entryPoint.body.statements[0].expression.arguments = [null, null] },
      (module) => { delete module.functions[0].body.statements[0] },
      (module) => { module.functions[0].parameters[0].name = "_reserved" },
      (module) => { module.functions[0].body.statements[0].expression = {kind: "StringLiteral", value: "\ud800", location: module.location} },
      ...[-1, -0, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "4", 4n].map((value) => (module) => {
        module.entryPoint.body.statements[0].expression.arguments[0] = {kind: "IntegerLiteral", value, location: module.location}
      })
    ]

    for (const [index, mutation] of mutations.entries()) {
      const module = moduleFrom()

      mutation(module)
      assert.throws(() => generateArtifactSet({language: "c", module}), (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "c", `mutation ${index}`)
    }
  })
})
