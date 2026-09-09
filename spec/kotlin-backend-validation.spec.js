// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const meaning = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const moduleFrom = () => parse({language: "typescript", filename: "source.ts", source:
  "function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));"})
const failure = (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "kotlin"

describe("Kotlin transactional single-file backend", () => {
  it("emits one deterministic mapped Program.kt with an explicit runnable-JAR recipe", () => {
    const module = moduleFrom()
    const before = structuredClone(module)
    const set = generateArtifactSet({language: "kotlin", module})
    const artifact = generateArtifact({language: "kotlin", module})

    expect(set.artifacts.map(({path, role}) => ({path, role}))).toEqual([{path: "Program.kt", role: "entry"}])
    expect(generate({language: "kotlin", module})).toEqual(artifact.code)
    expect(artifact.code).toEqual(set.artifacts[0].content)
    expect(generateArtifactSet({language: "kotlin", module})).toEqual(set)
    expect(module).toEqual(before)
    expect(meaning(parse({language: "kotlin", filename: "Program.kt", source: artifact.code}))).toEqual(meaning(module))
    expect(set.artifacts[0].provenance.kind).toEqual("text")
    expect(set.artifacts[0].provenance.sourceMap.version).toEqual(3)
    expect(set.metadata).toEqual({
      compiler: {
        apiVersion: "2.4",
        arguments: ["-language-version", "2.4", "-api-version", "2.4", "-jvm-target", "25", "-Werror", "-include-runtime",
          "Program.kt", "-d", "Program.jar"],
        jvmTarget: "25",
        languageVersion: "2.4",
        output: "Program.jar",
        toolchain: "kotlinc",
        version: "2.4.20"
      },
      run: {arguments: ["-jar", "Program.jar"], toolchain: "java25", version: "25.0.4+7"}
    })
  })

  it("retains Kotlin source identity, content, and parser-token ranges in generated mappings", async () => {
    const source = await readFile(new URL("fixtures/program.kt", import.meta.url), "utf8")
    const module = parse({language: "kotlin", filename: "Program.kt", source})
    const artifact = generateArtifact({language: "kotlin", module})

    expect(artifact.mapping.sources.map(({content, filename, language}) => ({content, filename, language}))).toEqual([
      {content: source, filename: "Program.kt", language: "kotlin"}
    ])
    expect(artifact.sourceMap.sourcesContent).toEqual([source])
    expect(artifact.mapping.spans.some((span) => span.mappingKind == "exact" && span.origin.kind == "source" &&
      span.origin.location.filename == "Program.kt")).toBeTrue()
    expect(generateArtifact({language: "java", module, sources: [{content: source, filename: "Program.kt", language: "kotlin"}]}).sourceMap.sourcesContent)
      .toEqual([source])
  })

  for (const directory of ["", "scalars/", "locals/", "operators/", "statements/"]) {
    it("preserves every " + (directory || "base") + " semantic occurrence through Kotlin reparse", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.ts`, import.meta.url), "utf8")
      const module = parse({language: "typescript", filename: "program.ts", source})
      const artifact = generateArtifact({language: "kotlin", module})

      expect(meaning(parse({language: "kotlin", filename: "Program.kt", source: artifact.code}))).toEqual(meaning(module))
    })
  }

  it("uses explicit scalar spellings, Long literals, exact string equality, and checked integer helpers", () => {
    const source = 'function compare(left: string, right: string): boolean { return left === right; } ' +
      'function add(left: number, right: number): number { return left + right; } ' +
      'console.log(compare("é\\u0000😀\\n", "é\\u0000😀\\n") || add(4, 5) === 9);'
    const module = parse({language: "typescript", filename: "unicode.ts", source})
    const artifact = generateArtifact({language: "kotlin", module})

    expect(artifact.code).toContain("left: String")
    expect(artifact.code).toContain(": Boolean")
    expect(artifact.code).toContain("4L")
    expect(artifact.code).toContain("semantifold_integer_add(left, right)")
    expect(artifact.code).toContain("Math.addExact")
    expect(artifact.code).toContain("left == right")
    expect(meaning(parse({language: "kotlin", filename: "Program.kt", source: artifact.code}))).toEqual(meaning(module))
    const support = artifact.mapping.spans.find((span) => artifact.code.slice(span.generated.start.offset, span.generated.end.offset)
      .includes("Math.addExact"))

    assert.ok(support)
    expect(support.mappingKind).toEqual("synthetic")
  })

  it("rejects malformed graphs, target collisions, invalid scalars, and known Long overflow before output", () => {
    for (const change of [
      module => { module.location = undefined },
      module => { module.functions[0].body.statements[0].expression.left = null },
      module => { module.functions[0].body.statements[0].expression.operation = "Divide" },
      module => { module.functions[0].body.statements[0].expression.type = "boolean" },
      module => { module.functions[0].parameters[0].type.name = "reference" },
      ...["Long", "Boolean", "String", "println", "main", "Math", "ArithmeticException", "semantifold_integer_add", "bad-name", "Ⅳ", "a‌b"]
        .map(name => module => {
          module.functions[0].name = name
          module.entryPoint.body.statements[0].expression.callee = name
        }),
      ...[-0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"].map(value => module => {
        module.entryPoint.body.statements[0].expression.arguments[0].value = value
      }),
      module => { module.functions[0].body.statements[0].expression = {kind: "BinaryExpression", operation: "IntegerMultiply", type: "integer",
        location: module.location, left: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location},
        right: {kind: "IntegerLiteral", value: Number.MAX_SAFE_INTEGER, location: module.location}} }
    ]) {
      const module = moduleFrom()

      change(module)
      for (const api of [generate, generateArtifact, generateArtifactSet]) assert.throws(() => api({language: "kotlin", module}), failure)
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
      assert.throws(() => generateArtifactSet({language: "kotlin", module}), failure)
    }
    for (const options of [{filename: "main.kt"}, {filename: "dir/Program.kt"}, {mapDirective: "external"},
      {mapDirective: "inline"}, {sourceMapFilename: "other.map"}]) {
      assert.throws(() => generateArtifact({language: "kotlin", module: moduleFrom(), ...options}), failure)
    }
  })
})
