// @ts-check

import {readFile} from "node:fs/promises"
import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, parse, SemantifoldDiagnostic} from "../index.js"
import {generateGoModule} from "../src/backends/go.js"
import {parseGo} from "../src/frontends/go.js"

async function moduleFrom(fixture = "program.ts") {
  const source = await readFile(new URL("fixtures/" + fixture, import.meta.url), "utf8")

  return parse({filename: fixture, language: "typescript", source})
}

async function goModuleFrom(fixture) {
  const source = await readFile(new URL("fixtures/" + fixture, import.meta.url), "utf8")

  return parseGo({filename: "main.go", source})
}

describe("Go backend validation", () => {
  it("returns the deterministic manifest-first Go module artifact shape", async () => {
    const module = await moduleFrom()
    const generated = generateGoModule({module})

    expect({
      paths: generated.artifacts.map(({path}) => path),
      roles: generated.artifacts.map(({role}) => role),
      target: generated.target
    }).toEqual({paths: ["go.mod", "main.go"], roles: ["manifest", "entry"], target: "go"})
    expect(generated.artifacts[0]).toMatchObject({
      content: "module example.com/semantifold/generated\n\ngo 1.26.0\n",
      contentKind: "text",
      mediaType: "text/plain",
      ownership: "generated",
      provenance: {kind: "synthetic"},
      role: "manifest"
    })
    expect(generated.artifacts[1]).toMatchObject({
      contentKind: "text",
      mediaType: "text/x-go",
      ownership: "generated",
      provenance: {kind: "text"},
      role: "entry"
    })
  })

  it("emits deterministic gofmt-form source and complete rich/v3 provenance", async () => {
    const module = await moduleFrom()
    const first = generateGoModule({module})
    const second = generateGoModule({module})
    const main = first.artifacts[1]

    expect(first).toEqual(second)
    expect(main.content).toEqual('package main\n\nimport "fmt"\n\nfunc difference(left int64, right int64) int64 {\n' +
      '\tif left > right {\n\t\treturn (left - right)\n\t} else {\n\t\treturn (right - left)\n\t}\n' +
      '}\n\nfunc main() {\n\tfmt.Println(difference(4, 9))\n}\n')
    assert.equal(main.provenance.kind, "text")
    if (main.provenance.kind == "text") {
      expect(main.provenance.mapping.spans.length > 0).toBeTrue()
      expect(main.provenance.mapping.spans.some(({mappingKind}) => mappingKind == "synthetic")).toBeTrue()
      expect(main.provenance.sourceMap.version).toEqual(3)
    }
  })

  it("rejects all non-fixed filenames/options and the legacy single-artifact API", async () => {
    for (const request of [
      {filename: "other.go"},
      {filename: "nested/main.go"},
      {mapDirective: "none"},
      {mapDirective: "external"},
      {sourceMapFilename: "main.go.map"}
    ]) {
      const module = await moduleFrom()

      assert.throws(() => generateGoModule({...request, module}), (error) =>
        Boolean(error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "go"))
    }
    for (const api of [generate, generateArtifact]) {
      const module = await moduleFrom()

      assert.throws(() => api({language: /** @type {any} */ ("go"), module}), (error) =>
        Boolean(error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "go"))
    }
  })

  it("preserves immutable carriers, omits unused fmt, and rejects unrepresentable mutability", async () => {
    const localModule = await goModuleFrom("locals/program.go")
    const generated = generateGoModule({module: localModule})
    const main = generated.artifacts[1].content

    assert.equal(typeof main, "string")
    expect(main).toContain("\t// @semantifold-immutable\n\tvar preferred string = \"yes\"")
    const noPrint = await moduleFrom()

    noPrint.entryPoint.body.statements = []
    expect(generateGoModule({module: noPrint}).artifacts[1].content).not.toContain('import "fmt"')
    const invalid = await goModuleFrom("locals/program.go")
    const declaration = invalid.functions[0].body.statements[1]

    assert.equal(declaration.kind, "LocalDeclaration")
    if (declaration.kind == "LocalDeclaration") declaration.mutable = true
    invalid.functions[0].body.statements = invalid.functions[0].body.statements.filter(({kind}) => kind != "IfStatement")
    assert.throws(() => generateGoModule({module: invalid}), (error) =>
      Boolean(error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "go"))
  })

  it("rejects Go identifier captures, negative literal payloads, and known int64 overflow transactionally", async () => {
    for (const invalid of ["identifier", "negative", "overflow", "malformed"]) {
      const module = await moduleFrom("operators/program.ts")

      if (invalid == "identifier") module.functions[0].name = "main"
      else if (invalid == "negative") {
        const branch = module.functions[0].body.statements[0]

        assert.equal(branch.kind, "IfStatement")
        if (branch.kind == "IfStatement") {
          const result = branch.alternate?.statements[0]

          assert.equal(result?.kind, "ReturnStatement")
          if (result?.kind == "ReturnStatement") result.expression = {kind: "IntegerLiteral", location: result.location, value: -1}
        }
      } else if (invalid == "overflow") {
        const branch = module.functions[0].body.statements[0]

        assert.equal(branch.kind, "IfStatement")
        if (branch.kind == "IfStatement") {
          const result = branch.alternate?.statements[0]

          assert.equal(result?.kind, "ReturnStatement")
          if (result?.kind == "ReturnStatement") result.expression = {
            kind: "BinaryExpression",
            left: {kind: "IntegerLiteral", location: result.location, value: Number.MAX_SAFE_INTEGER},
            location: result.location,
            operation: "IntegerMultiply",
            right: {kind: "IntegerLiteral", location: result.location, value: Number.MAX_SAFE_INTEGER},
            type: "integer"
          }
        }
      } else Reflect.set(module.functions[0].body, "statements", [null])

      assert.throws(() => generateGoModule({module}), (error) =>
        Boolean(error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "go"), invalid)
    }
  })
})
