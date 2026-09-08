// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const moduleFrom = () => parse({language: "typescript", filename: "source.ts", source:
  "function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));"})
const meaning = value => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const failure = error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "rust"

describe("Rust transactional Cargo backend", () => {
  it("returns the actual qualified manifest and Cargo lock before the mapped Rust entry", () => {
    const module = moduleFrom()
    const before = structuredClone(module)
    const set = generateArtifactSet({language: "rust", module})

    expect(set.artifacts.map(({path, role}) => ({path, role}))).toEqual([
      {path: "Cargo.toml", role: "manifest"}, {path: "Cargo.lock", role: "support"}, {path: "src/main.rs", role: "entry"}
    ])
    expect(set.artifacts.slice(0, 2).map(({content}) => createHash("sha256").update(content).digest("hex"))).toEqual([
      "1355468ebe077f03f1de9f990f243721c0e426a4448d6205ab3540cb2d2f7265", "185a41f6648ef49c8e7721f3321604abf05fae11c7007f823121c17fe48eec64"
    ])
    for (const artifact of set.artifacts.slice(0, 2)) {
      expect(artifact.provenance.kind).toEqual("synthetic")
      expect(artifact.provenance.relatedOrigins.length > 0).toBeTrue()
    }
    expect(set.artifacts[2].provenance.kind).toEqual("text")
    expect(set.artifacts[2].provenance.sourceMap.version).toEqual(3)
    expect(generateArtifactSet({language: "rust", module})).toEqual(set)
    expect(module).toEqual(before)
    expect(meaning(parse({language: "rust", filename: "src/main.rs", source: set.artifacts[2].content}))).toEqual(meaning(module))
    for (const api of [generate, generateArtifact]) assert.throws(() => api({language: "rust", module}),
      error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "rust")
  })

  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/"]) {
    it("preserves all semantic occurrences and mutability through " + (directory || "base") + " reparse", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")
      const module = parse({language: "typescript", filename: "program.ts", source})
      const set = generateArtifactSet({language: "rust", module})

      expect(meaning(parse({language: "rust", filename: "src/main.rs", source: set.artifacts[2].content}))).toEqual(meaning(module))
    })
  }

  it("rejects complete malformed graphs, types, scalar bounds and every protected identifier before returning artifacts", () => {
    for (const change of [
      module => { module.location = undefined },
      module => { module.functions[0].body.statements[0].expression.left = null },
      module => { module.functions[0].body.statements[0].expression.operation = "Divide" },
      module => { module.functions[0].body.statements[0].expression.type = "boolean" },
      module => { module.functions[0].parameters[0].type.name = "reference" },
      ...["String", "std", "i64", "bool", "main", "fn", "move", "self", "Self", "crate", "async", "await", "dyn", "trait", "impl", "type", "semantifold_print_string", "semantifold_integer_add", "r#name", "_", "bad-name"].map(name => module => { module.functions[0].name = name }),
      ...[-0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"].map(value => module => { module.entryPoint.body.statements[0].expression.arguments[0].value = value }),
      module => { module.functions[0].body.statements[0].expression = {kind: "BinaryExpression", operation: "IntegerMultiply", type: "integer", location: module.location,
        left: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}, right: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}} }
    ]) {
      const module = moduleFrom()

      change(module)
      assert.throws(() => generateArtifactSet({language: "rust", module}), failure)
    }
  })

  it("rejects late malformed nodes, cycles, expansion, oversized strings and source before partial artifacts", () => {
    for (const kind of ["late", "cycle", "expansion", "source"]) {
      const module = moduleFrom()
      let expression = module.functions[0].body.statements[0].expression

      if (kind == "late") module.entryPoint.body.statements.push({kind: "LoopStatement", location: module.location})
      else if (kind == "cycle") expression.left = expression
      else if (kind == "source") module.entryPoint.body.statements[0].expression = {
        kind: "StringLiteral", value: "a".repeat(32768), location: module.location
      }
      else {
        for (let index = 0; index < 20; index++) expression = {
          kind: "BinaryExpression", operation: "IntegerAdd", type: "integer", location: module.location, left: expression,
          right: expression
        }
        module.functions[0].body.statements[0].expression = expression
      }
      assert.throws(() => generateArtifactSet({language: "rust", module}), failure, kind)
    }
    let body = 'const value0: string = "é";'

    for (let index = 1; index <= 63; index++) body += `const value${index}: string = value${index - 1} + value${index - 1};`
    const module = parse({language: "typescript", filename: "oversize.ts", source:
      `function join(left: string, right: string): string { ${body} return value63; } console.log(join("", ""));`})

    assert.throws(() => generateArtifactSet({language: "rust", module}), failure)
  })

  it("bounds generated CST expansion as well as input IR depth before exposing artifacts", () => {
    const module = parse({language: "typescript", filename: "nested.ts", source:
      'function join(left: string, right: string): string { return left + right; } console.log(join("", ""));'})
    const original = module.functions[0].body.statements[0].expression
    let expression = original.right

    for (let index = 0; index < 140; index++) expression = {...original, left: original.left, right: expression}
    module.functions[0].body.statements[0].expression = expression
    assert.throws(() => generateArtifactSet({language: "rust", module}), failure)
  })

  it("rejects alternate artifact paths and source-map directives transactionally", () => {
    for (const options of [{filename: "main.rs"}, {filename: "../main.rs"}, {filename: "Cargo.toml"},
      {mapDirective: "none"}, {mapDirective: "inline"}, {mapDirective: "external"}, {sourceMapFilename: "other.map"}]) {
      assert.throws(() => generateArtifactSet({language: "rust", module: moduleFrom(), ...options}), failure)
    }
    expect(generateArtifactSet({language: "rust", filename: "src/main.rs", module: moduleFrom()}).artifacts.length).toEqual(3)
  })
})
