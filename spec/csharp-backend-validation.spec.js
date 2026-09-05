// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const expectedProgram = `#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static long Difference(long left, long right)
    {
        return checked(left - right);
    }

    private static void Main()
    {
        System.Console.WriteLine(Difference(4L, 9L));
    }
}
`
const expectedProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>14.0</LangVersion>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <WarningLevel>10</WarningLevel>
    <CheckForOverflowUnderflow>true</CheckForOverflowUnderflow>
    <AllowUnsafeBlocks>false</AllowUnsafeBlocks>
    <ImplicitUsings>disable</ImplicitUsings>
    <EnableNETAnalyzers>false</EnableNETAnalyzers>
    <InvariantGlobalization>true</InvariantGlobalization>
    <PredefinedCulturesOnly>true</PredefinedCulturesOnly>
    <Deterministic>true</Deterministic>
    <ContinuousIntegrationBuild>true</ContinuousIntegrationBuild>
    <DebugType>none</DebugType>
    <UseAppHost>false</UseAppHost>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <AssemblyName>Semantifold</AssemblyName>
    <RootNamespace>Semantifold.Generated</RootNamespace>
    <StartupObject>Semantifold.Generated.Program</StartupObject>
    <PathMap>$(MSBuildProjectDirectory)=/_/</PathMap>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.cs" />
  </ItemGroup>
</Project>
`

describe("C# project backend", () => {
  it("emits the deterministic ordered two-file C# project artifact set", () => {
    const source = `function Difference(left: number, right: number): number {
  return left - right
}

console.log(Difference(4, 9))
`
    const module = parse({filename: "program.ts", language: "typescript", source})
    const set = generateArtifactSet({language: "csharp", module})

    expect(set.entry).toEqual("Program.cs")
    expect(set.artifacts.map(({path}) => path)).toEqual(["Program.cs", "Semantifold.csproj"])
    expect(set.artifacts.map(({role}) => role)).toEqual(["entry", "manifest"])
    expect(set.artifacts.map(({mediaType}) => mediaType)).toEqual(["text/x-csharp", "application/xml"])
    expect(set.artifacts[0].content).toEqual(expectedProgram)
    expect(set.artifacts[1].content).toEqual(expectedProject)
    expect(set.artifacts[0].provenance.kind).toEqual("text")
    expect(set.artifacts[1].provenance.kind).toEqual("synthetic")
    expect(set.artifacts[1].provenance.relatedOrigins.length > 0).toBeTrue()
    assert.deepEqual(set, generateArtifactSet({language: "csharp", module}))
  })

  it("escapes the C# NEL source line terminator in string literals", () => {
    const source = `function Combine(left: string, right: string): string {
  return left + right
}

console.log(Combine("\\u0085", ""))
`
    const module = parse({filename: "program.ts", language: "typescript", source})
    const program = /** @type {string} */ (generateArtifactSet({language: "csharp", module}).artifacts[0].content)

    expect(program).toContain("System.Console.WriteLine(Combine(\"\\u0085\", \"\"));")
  })

  it("rejects intrinsic C# keyword identifiers from cross-language semantic modules", () => {
    const source = `function Difference(left: number, right: number): number {
  return left - right
}

console.log(Difference(4, 9))
`
    const base = parse({filename: "program.ts", language: "typescript", source})

    for (const name of ["__arglist", "__makeref", "__reftype", "__refvalue"]) {
      const module = structuredClone(base)
      const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)

      module.functions[0].name = name
      call.callee = name
      assert.throws(() => generateArtifactSet({language: "csharp", module}), (error) => Boolean(
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp"))
    }
  })

  it("rejects inherited object member function names without reserving binding names", () => {
    const source = `function Difference(left: number, right: number): number {
  let result: number = left - right
  return result
}

console.log(Difference(4, 9))
`
    const base = parse({filename: "program.ts", language: "typescript", source})

    for (const name of ["Equals", "Finalize", "GetHashCode", "GetType", "MemberwiseClone", "ReferenceEquals", "ToString"]) {
      const module = structuredClone(base)
      const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)

      module.functions[0].name = name
      call.callee = name
      assert.throws(() => generateArtifactSet({language: "csharp", module}), (error) => Boolean(
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp"))
    }

    const bindings = structuredClone(base)

    bindings.functions[0].parameters[0].name = "ToString"
    bindings.functions[0].body.statements[0].name = "GetHashCode"
    const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (bindings.functions[0].body.statements[0])
    const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (bindings.functions[0].body.statements[1])
    const subtraction = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (declaration.initializer)
    const returnedIdentifier = /** @type {import("../src/semantic/types.js").IdentifierExpression} */ (returned.expression)

    subtraction.left.name = "ToString"
    returnedIdentifier.name = "GetHashCode"
    expect(generateArtifactSet({language: "csharp", module: bindings}).entry).toEqual("Program.cs")
  })

  it("rejects legacy single-artifact generation for the multi-artifact target", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const operation of [
      () => generate({language: /** @type {any} */ ("csharp"), module}),
      () => generateArtifact({language: /** @type {any} */ ("csharp"), module})
    ]) {
      assert.throws(operation, (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "csharp")
    }
  })

  it("round-trips all five profiles and rejects filename and mapping options explicitly", async () => {
    for (const fixture of ["Program.cs", "scalars/Program.cs", "locals/Program.cs", "operators/Program.cs", "statements/Program.cs"]) {
      const source = await readFile(new URL(`fixtures/${fixture}`, import.meta.url), "utf8")
      const module = parse({filename: "Program.cs", language: /** @type {any} */ ("csharp"), source})
      const set = generateArtifactSet({language: "csharp", module})
      const generated = /** @type {string} */ (set.artifacts[0].content)
      const reparsed = parse({filename: "Program.cs", language: /** @type {any} */ ("csharp"), source: generated})
      const withoutMetadata = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
        ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))

      expect(withoutMetadata(reparsed)).toEqual(withoutMetadata(module))
    }

    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const options of [
      {filename: "Other.cs"},
      {mapDirective: "none"},
      {mapDirective: "external"},
      {sourceMapFilename: "Program.cs.map"}
    ]) {
      assert.throws(() => generateArtifactSet({language: "csharp", module, ...options}), (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp")
    }
  })

  it("rejects identifier collisions, overflowing operation trees, and malformed nested IR transactionally", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const base = parse({filename: "program.ts", language: "typescript", source})

    for (const name of ["class", "record", "required", "file", "allows", "extension", "Program", "Main", "System", "not-ascii-é", "K", "@value"]) {
      const module = structuredClone(base)

      module.functions[0].name = name
      const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[0])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)

      call.callee = name
      assert.throws(() => generateArtifactSet({language: "csharp", module}), (error) => Boolean(
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp" && error.location))
    }

    const overflow = structuredClone(base)
    const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      /** @type {import("../src/semantic/types.js").IfStatement} */ (overflow.functions[0].body.statements[0]).consequent.statements[0])

    returned.expression = /** @type {any} */ ({
      kind: "BinaryExpression",
      left: {kind: "IntegerLiteral", location: returned.location, value: Number.MAX_SAFE_INTEGER},
      location: returned.location,
      operation: "IntegerMultiply",
      right: {kind: "IntegerLiteral", location: returned.location, value: Number.MAX_SAFE_INTEGER},
      type: "integer"
    })
    assert.throws(() => generateArtifactSet({language: "csharp", module: overflow}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp")

    const negativeLiteral = structuredClone(base)
    const negativeReturn = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      /** @type {import("../src/semantic/types.js").IfStatement} */ (negativeLiteral.functions[0].body.statements[0]).consequent.statements[0])

    negativeReturn.expression = /** @type {any} */ ({kind: "IntegerLiteral", location: negativeReturn.location, value: -1})
    assert.throws(() => generateArtifactSet({language: "csharp", module: negativeLiteral}), (error) =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp")

    const malformedParameter = structuredClone(base)

    malformedParameter.functions[0].parameters[0] = /** @type {any} */ (null)
    assert.throws(() => generateArtifactSet({language: "csharp", module: malformedParameter}), (error) => Boolean(
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp" && error.location))

    /** @type {((module: any) => void)[]} */
    const corruptions = [
      (module) => { module.functions[0].parameters[0].type = null },
      (module) => { module.functions[0].returnType = null },
      (module) => { module.functions[0].body.statements[0] = null },
      (module) => { module.functions[0].body.statements[0].condition = null },
      (module) => { module.functions[0].body.statements[0].consequent = null },
      (module) => { module.functions[0].body.statements[0].alternate = null },
      (module) => { module.functions[0].body.statements[0].consequent.statements[0].expression = null },
      (module) => { module.functions[0].body.statements[0].consequent.statements[0].expression.left = null },
      (module) => { module.functions[0].body.statements[0].consequent.statements[0].expression.right = null },
      (module) => { module.functions[0].body.statements[0].consequent.statements[0].expression.operation = "IntegerDivide" },
      (module) => { module.entryPoint.body.statements[0].expression.callee = null },
      (module) => { module.entryPoint.body.statements[0].expression.arguments = [null, null] },
      (module) => { module.entryPoint.body.statements[0].expression.arguments = new Array(2) },
      (module) => {
        module.entryPoint.body.statements.unshift({initializer: null, kind: "LocalDeclaration", location: base.location,
          mutable: true, name: "value", type: {kind: "ScalarType", location: base.location, name: "integer"}})
      },
      (module) => {
        module.entryPoint.body.statements.unshift({initializer: {kind: "IntegerLiteral", location: base.location, value: 1},
          kind: "LocalDeclaration", location: base.location, mutable: true, name: null, type: null})
      }
    ]

    for (const corrupt of corruptions) {
      const module = /** @type {any} */ (structuredClone(base))

      corrupt(module)
      assert.throws(() => generateArtifactSet({language: "csharp", module}), (error) => Boolean(
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp" && error.location))
    }

    for (const malformedBody of [
      null,
      {kind: "Block", statements: null},
      {kind: "Block", statements: [{kind: "WhileStatement", location: base.location}]},
      {kind: "Block", statements: [{kind: "AssignmentStatement", expression: null, location: base.location, target: null}]},
      {kind: "Block", statements: [{expression: {kind: "CallExpression", arguments: null, callee: "difference", location: base.location}, kind: "PrintStatement", location: base.location}]}
    ]) {
      const module = structuredClone(base)

      module.entryPoint.body = /** @type {any} */ (malformedBody)
      assert.throws(() => generateArtifactSet({language: "csharp", module}), (error) =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "csharp")
    }
  })
})
