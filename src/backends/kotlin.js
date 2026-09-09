// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"
import {kotlinRuntime} from "./kotlin-runtime.js"

export const kotlinArtifactMetadata = Object.freeze({
  compiler: Object.freeze({
    apiVersion: "2.4",
    arguments: Object.freeze(["-language-version", "2.4", "-api-version", "2.4", "-jvm-target", "25", "-Werror",
      "-include-runtime", "Program.kt", "-d", "Program.jar"]),
    jvmTarget: "25",
    languageVersion: "2.4",
    output: "Program.jar",
    toolchain: "kotlinc",
    version: "2.4.20"
  }),
  run: Object.freeze({arguments: Object.freeze(["-jar", "Program.jar"]), toolchain: "java25", version: "25.0.4+7"})
})

/**
 * Emits one deterministic Kotlin/JVM program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 */
export function generateKotlin(module, writer) {
  writer.synthetic(kotlinRuntime, "Checked Kotlin/JVM safe-integer support", [module], [""])

  module.functions.forEach((declaration, functionIndex) => {
    const path = `/functions/${functionIndex}`

    writer.synthetic("\n", "declaration separator", [declaration], [path])
    writer.mapped("fun", {mappingKind: "anchor", node: declaration, path})
    writer.synthetic(" ", "declaration spacing", [declaration], [path])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
    writer.synthetic("(", "function parameter scaffold", [declaration], [path])
    declaration.parameters.forEach((parameter, parameterIndex) => {
      const parameterPath = `${path}/parameters/${parameterIndex}`

      if (parameterIndex) writer.synthetic(", ", "parameter separator", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(": ", "parameter annotation scaffold", [parameter], [parameterPath])
      writer.mapped(emitScalarType("kotlin", parameter.type), {mappingKind: "exact", node: parameter.type,
        path: `${parameterPath}/type`, role: "type"})
    })
    writer.synthetic("): ", "function return scaffold", [declaration], [path])
    writer.mapped(emitScalarType("kotlin", declaration.returnType), {mappingKind: "exact", node: declaration.returnType,
      path: `${path}/returnType`, role: "type"})
    writer.synthetic(" {\n", "Kotlin function body scaffold", [declaration], [path])
    emitBlock(writer, declaration.body, "  ", `${path}/body`)
    writer.synthetic("}\n", "Kotlin function body scaffold", [declaration], [path])
  })

  writer.synthetic("\nfun main() {\n", "Kotlin generated main scaffold", [module.entryPoint], ["/entryPoint"])
  emitBlock(writer, module.entryPoint.body, "  ", "/entryPoint/body")
  writer.synthetic("}\n", "Kotlin generated main scaffold", [module.entryPoint], ["/entryPoint"])
}

/**
 * Emits one Kotlin statement block.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Current indentation.
 * @param {string} path - Semantic block path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`))
}

/**
 * Emits one Kotlin statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Current indentation.
 * @param {string} path - Semantic statement path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "LocalDeclaration") {
    writer.mapped(statement.mutable ? "var" : "val", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "declaration spacing", [statement], [path])
    writer.mapped(statement.name, {mappingKind: "exact", node: statement, path, role: "name"})
    writer.synthetic(": ", "local annotation scaffold", [statement], [path])
    writer.mapped(emitScalarType("kotlin", statement.type), {mappingKind: "exact", node: statement.type,
      path: `${path}/type`, role: "type"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.initializer, `${path}/initializer`, "kotlin", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${path}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "kotlin", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "kotlin", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.synthetic("println(", "Kotlin println plumbing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "kotlin", identity)
    writer.synthetic(")\n", "Kotlin println plumbing", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" (", "Kotlin conditional scaffold", [statement], [path])
  emitExpression(writer, statement.condition, `${path}/condition`, "kotlin", identity)
  writer.synthetic(") {\n", "Kotlin conditional scaffold", [statement.consequent], [`${path}/consequent`])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`)
  writer.synthetic(`${indent}}`, "Kotlin conditional scaffold", [statement.consequent], [`${path}/consequent`])
  if (statement.alternate) {
    writer.synthetic(" else {\n", "Kotlin alternate scaffold", [statement.alternate], [`${path}/alternate`])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`)
    writer.synthetic(`${indent}}`, "Kotlin alternate scaffold", [statement.alternate], [`${path}/alternate`])
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Preserves an emitted Kotlin identifier.
 * @param {string} name - Identifier spelling.
 * @returns {string} Unchanged spelling.
 */
function identity(name) {
  return name
}
