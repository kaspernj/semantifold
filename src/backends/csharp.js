// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {validateBackendModule, emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"
import {SourceWriter} from "./writer.js"

const project = `<Project Sdk="Microsoft.NET.Sdk">
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

/**
 * Emits one deterministic two-file C# project candidate.
 * @param {{filename?: string, mapDirective?: unknown, module: import("../semantic/types.js").SemanticModule, sourceMapFilename?: unknown, sources?: {filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} input - Backend request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], target: string}} Candidate artifact set.
 */
export function generateCSharpProject({filename, mapDirective, module, sourceMapFilename, sources}) {
  validateBackendModule(module, "csharp")
  if (filename !== undefined && filename != "Program.cs") {
    unsupportedCapability("csharp", "artifact filename other than Program.cs", module.location)
  }
  if (mapDirective !== undefined || sourceMapFilename !== undefined) {
    unsupportedCapability("csharp", "source-map filename or directive option", module.location)
  }
  const writer = new SourceWriter({filename: "Program.cs", language: "csharp", module, sources})

  emitProgram(module, writer)
  const mapping = finalizeMapping(writer.finish())
  const root = mapping.nodes.find(({path}) => path == "")

  if (!root) throw new Error("Validated C# module omitted its canonical root provenance.")
  return {
    artifacts: [{
      content: mapping.generated.content,
      contentKind: "text",
      mediaType: "text/x-csharp",
      ownership: "generated",
      path: "Program.cs",
      provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping)},
      role: "entry"
    }, {
      content: project,
      contentKind: "text",
      mediaType: "application/xml",
      ownership: "generated",
      path: "Semantifold.csproj",
      provenance: {kind: "synthetic", reason: "Deterministic .NET 10 project manifest for the generated C# module.",
        relatedOrigins: relatedRootOrigins(root)},
      role: "manifest"
    }],
    target: "csharp"
  }
}

/**
 * Emits the fixed C# file scaffold and semantic bodies.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated module.
 * @param {SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
function emitProgram(module, writer) {
  writer.synthetic("#nullable enable\n\nnamespace Semantifold.Generated;\n\ninternal static class Program\n{\n",
    "C# nullable, namespace, and Program scaffolding", [module])
  module.functions.forEach((declaration, index) => {
    if (index > 0) writer.synthetic("\n", "declaration separator", [declaration])
    emitFunction(writer, declaration, index)
  })
  writer.synthetic("\n", "entry-point separator", [module.entryPoint])
  writer.synthetic("    ", "indentation", [module.entryPoint])
  writer.mapped("private static void Main", {mappingKind: "anchor", node: module.entryPoint})
  writer.mapped("()", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic("\n    ", "line break and indentation", [module.entryPoint])
  writer.mapped("{", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic("\n", "line break", [module.entryPoint])
  emitBlock(writer, module.entryPoint.body, "        ", "/entryPoint/body")
  writer.synthetic("    ", "indentation", [module.entryPoint])
  writer.mapped("}", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic("\n}\n", "C# Program scaffolding", [module])
}

/**
 * Emits one private static semantic method.
 * @param {SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").FunctionDeclaration} declaration - Function declaration.
 * @param {number} index - Function index.
 * @returns {void}
 */
function emitFunction(writer, declaration, index) {
  const path = `/functions/${index}`

  writer.synthetic("    ", "indentation", [declaration], [path])
  writer.mapped("private static", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic(" ", "method spacing", [declaration], [path])
  writer.mapped(emitScalarType("csharp", declaration.returnType), {
    mappingKind: "exact", node: declaration.returnType, path: `${path}/returnType`, role: "type"
  })
  writer.synthetic(" ", "method spacing", [declaration], [path])
  writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
  writer.mapped("(", {mappingKind: "anchor", node: declaration, path})
  declaration.parameters.forEach((parameter, parameterIndex) => {
    const parameterPath = `${path}/parameters/${parameterIndex}`

    if (parameterIndex > 0) writer.synthetic(", ", "parameter separator", [declaration], [path])
    writer.mapped(emitScalarType("csharp", parameter.type), {
      mappingKind: "exact", node: parameter.type, path: `${parameterPath}/type`, role: "type"
    })
    writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
  })
  writer.mapped(")", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic("\n    ", "line break and indentation", [declaration], [path])
  writer.mapped("{", {mappingKind: "anchor", node: declaration.body, path: `${path}/body`})
  writer.synthetic("\n", "line break", [declaration], [path])
  emitBlock(writer, declaration.body, "        ", `${path}/body`)
  writer.synthetic("    ", "indentation", [declaration], [path])
  writer.mapped("}", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic("\n", "line break", [declaration], [path])
}

/**
 * Emits one ordered semantic block.
 * @param {SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Current indentation.
 * @param {string} path - Exact semantic path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`))
}

/**
 * Emits one supported C# statement.
 * @param {SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Current indentation.
 * @param {string} path - Exact semantic path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") {
    return emitLocal(writer, statement, indent, path)
  }
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "csharp", identity)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("System.Console.WriteLine", {mappingKind: "anchor", node: statement, path})
    writer.mapped("(", {mappingKind: "anchor", node: statement, path})
    emitExpression(writer, statement.expression, `${path}/expression`, "csharp", identity)
    writer.mapped(");", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.condition, `${path}/condition`, "csharp", identity)
  writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  writer.synthetic("\n", "line break", [statement], [path])
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("{", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}    `, `${path}/consequent`)
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("}", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  if (statement.alternate) {
    writer.synthetic("\n", "line break", [statement], [path])
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}    `, `${path}/alternate`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one local declaration or assignment.
 * @param {SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Current indentation.
 * @param {string} path - Exact semantic path.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" && !statement.mutable) {
    writer.synthetic(`${indent}// @semantifold-immutable\n`, "C# immutable-local carrier", [statement], [path])
  }
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${path}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "csharp", identity)
  } else {
    writer.mapped(emitScalarType("csharp", statement.type), {
      mappingKind: "exact", node: statement.type, path: `${path}/type`, role: "type"
    })
    writer.synthetic(" ", "declaration spacing", [statement], [path])
    writer.mapped(statement.name, {mappingKind: "exact", node: statement, path, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.initializer, `${path}/initializer`, "csharp", identity)
  }
  writer.mapped(";", {mappingKind: "anchor", node: statement, path})
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Converts canonical module-root provenance to artifact-level related origins.
 * @param {import("../semantic/types.js").SemanticNodeProvenance} root - Canonical root provenance.
 * @returns {import("../semantic/types.js").RelatedOrigin[]} Related module origins.
 */
function relatedRootOrigins(root) {
  if (root.origin.kind == "source") {
    return [{location: root.origin.location, nodeId: root.id, role: "module", sourceId: root.origin.sourceId}]
  }
  const origins = root.origin.kind == "derived" ? root.origin.origins : root.origin.relatedOrigins

  return origins.map((origin) => ({...origin, nodeId: origin.nodeId ?? root.id, role: origin.role ?? "module"}))
}

/**
 * Preserves an already validated C# identifier spelling.
 * @param {string} name - Identifier.
 * @returns {string} Unchanged identifier.
 */
function identity(name) {
  return name
}
