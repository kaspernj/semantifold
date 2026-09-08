// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const moduleFrom = () => parse({language: "typescript", filename: "source.ts", source:
  "function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));"})
const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const failure = (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "cpp"

describe("C++ backend validation", () => {
  for (const name of ["WEOF", "wint_t"]) it("rejects included-header collision " + name + " before exposing any artifact", () => {
    for (const source of [
      `function ${name}(left: number, right: number): number { return left + right; } console.log(${name}(4, 9));`,
      `function sum(${name}: number, right: number): number { return ${name} + right; } console.log(sum(4, 9));`,
      `function sum(left: number, right: number): number { const ${name}: number = left + right; return ${name}; } console.log(sum(4, 9));`
    ]) {
      const module = parse({language: "typescript", filename: "collision.ts", source})

      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        assert.throws(() => api({language: "cpp", module}), error => failure(error) && Boolean(error.location) && error.message.includes(name))
      }
    }
  })

  it("generates only deterministic program.cpp with equivalent reparsing and unchanged IR", () => {
    const module = moduleFrom()
    const before = structuredClone(module)
    const set = generateArtifactSet({language: "cpp", module})
    const artifact = generateArtifact({language: "cpp", module})

    expect(set.artifacts.map(({path, role}) => ({path, role}))).toEqual([{path: "program.cpp", role: "entry"}])
    expect(generate({language: "cpp", module})).toEqual(artifact.code)
    expect(artifact.code).toEqual(set.artifacts[0].content)
    expect(generateArtifactSet({language: "cpp", module})).toEqual(set)
    expect(module).toEqual(before)
    expect(meaning(parse({language: "cpp", filename: "program.cpp", source: artifact.code}))).toEqual(meaning(module))
  })

  it("rejects malformed IR, unsafe names, implicit types and known overflow before any artifact", () => {
    for (const change of [
      module => { module.location = undefined },
      module => { module.functions[0].body.statements[0].expression.left = null },
      module => { module.functions[0].body.statements[0].expression.operation = "Divide" },
      module => { module.functions[0].body.statements[0].expression.type = "boolean" },
      module => { module.functions[0].parameters[0].type.name = "reference" },
      ...["std", "operator", "new", "main", "semantifold_ordered_000001", "semantifold_print_string", "under__score", "EOF", "MB_LEN_MAX"].map(name => module => { module.functions[0].name = name }),
      ...[-0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"].map(value => module => { module.entryPoint.body.statements[0].expression.arguments[0].value = value }),
      module => { module.functions[0].body.statements[0].expression = {kind: "BinaryExpression", operation: "IntegerMultiply", type: "integer", location: module.location,
        left: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}, right: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}} }
    ]) {
      const module = moduleFrom()

      change(module)
      for (const api of [generate, generateArtifact, generateArtifactSet]) assert.throws(() => api({language: "cpp", module}), failure)
    }
  })

  it("bounds cycles, expansion and generated source before recursive provenance and output", () => {
    for (const kind of ["cycle", "expansion", "source"]) {
      const module = moduleFrom()
      let expression = module.functions[0].body.statements[0].expression

      if (kind == "cycle") expression.left = expression
      else for (let index = 0; index < (kind == "expansion" ? 20 : 500); index++) {
        expression = {kind: "BinaryExpression", operation: "IntegerAdd", type: "integer", location: module.location,
          left: expression, right: kind == "expansion" ? expression : {kind: "IntegerLiteral", value: 1, location: module.location}}
      }
      module.functions[0].body.statements[0].expression = expression
      assert.throws(() => generateArtifactSet({language: "cpp", module}), failure)
    }
  })

  it("rejects statically unrepresentable copies and unsupported artifact filenames", () => {
    let body = 'const value0: string = "é";'

    for (let index = 1; index <= 63; index++) body += `const value${index}: string = value${index - 1} + value${index - 1};`
    const module = parse({language: "typescript", filename: "oversize.ts", source:
      `function join(left: string, right: string): string { ${body} return value63; } console.log(join("", ""));`})

    assert.throws(() => generateArtifactSet({language: "cpp", module}), failure)
    for (const filename of ["other.cpp", "dir/program.cpp", "program.c"]) {
      assert.throws(() => generateArtifact({language: "cpp", filename, module: moduleFrom()}), failure)
    }
  })

  it("reports unsupported CPP map-artifact options as capability failures before writing", () => {
    for (const options of [{mapDirective: "external"}, {mapDirective: "inline"}, {sourceMapFilename: "other.map"}]) {
      assert.throws(() => generateArtifact({language: "cpp", module: moduleFrom(), ...options}), failure)
    }
    expect(generateArtifact({language: "cpp", module: moduleFrom(), mapDirective: "none"}).filename).toEqual("program.cpp")
  })
})
