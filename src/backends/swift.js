// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"
import {swiftRuntime} from "./swift-runtime.js"

/**
 * Emits one deterministic dependency-free Swift program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateSwift(module, writer) {
  writer.synthetic(swiftRuntime, "Exact Swift Unicode-scalar string equality support", [module], [""])

  module.functions.forEach((declaration, functionIndex) => {
    const path = `/functions/${functionIndex}`

    writer.synthetic("\n", "declaration separator", [declaration], [path])
    writer.mapped("func", {mappingKind: "anchor", node: declaration, path})
    writer.synthetic(" ", "declaration spacing", [declaration], [path])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
    writer.synthetic("(", "function parameter scaffold", [declaration], [path])
    declaration.parameters.forEach((parameter, parameterIndex) => {
      const parameterPath = `${path}/parameters/${parameterIndex}`

      if (parameterIndex) writer.synthetic(", ", "parameter separator", [parameter], [parameterPath])
      writer.synthetic("_ ", "unlabeled Swift parameter scaffold", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(": ", "parameter annotation scaffold", [parameter], [parameterPath])
      writer.mapped(emitScalarType("swift", parameter.type), {mappingKind: "exact", node: parameter.type,
        path: `${parameterPath}/type`, role: "type"})
    })
    writer.synthetic(") -> ", "function return scaffold", [declaration], [path])
    writer.mapped(emitScalarType("swift", declaration.returnType), {mappingKind: "exact", node: declaration.returnType,
      path: `${path}/returnType`, role: "type"})
    writer.synthetic(" {\n", "Swift function body scaffold", [declaration], [path])
    emitBlock(writer, declaration.body, "  ", `${path}/body`)
    writer.synthetic("}\n", "Swift function body scaffold", [declaration], [path])
  })

  writer.synthetic("\n", "Swift top-level entry scaffold", [module.entryPoint], ["/entryPoint"])
  emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body")
}

/**
 * Emits one ordered Swift block.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Current indentation.
 * @param {string} path - Exact block path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`))
}

/**
 * Emits one validated Swift statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Current indentation.
 * @param {string} path - Statement occurrence path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "LocalDeclaration") {
    writer.mapped(statement.mutable ? "var" : "let", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "declaration spacing", [statement], [path])
    writer.mapped(statement.name, {mappingKind: "exact", node: statement, path, role: "name"})
    writer.synthetic(": ", "local annotation scaffold", [statement], [path])
    writer.mapped(emitScalarType("swift", statement.type), {mappingKind: "exact", node: statement.type,
      path: `${path}/type`, role: "type"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.initializer, `${path}/initializer`, "swift", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    if (statement.mutable) {
      writer.synthetic(`${indent}semantifold_keep_mutable(&${statement.name})\n`, "Swift mutable-local warning marker", [statement], [path])
    }
    return
  }
  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${path}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "swift", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "swift", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.synthetic("print(", "Swift print plumbing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "swift", identity)
    writer.synthetic(")\n", "Swift print plumbing", [statement], [path])
    return
  }

  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  emitExpression(writer, statement.condition, `${path}/condition`, "swift", identity)
  writer.synthetic(" {\n", "Swift conditional scaffold", [statement.consequent], [`${path}/consequent`])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`)
  writer.synthetic(`${indent}}`, "Swift conditional scaffold", [statement.consequent], [`${path}/consequent`])
  if (statement.alternate) {
    writer.synthetic(" else {\n", "Swift alternate scaffold", [statement.alternate], [`${path}/alternate`])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`)
    writer.synthetic(`${indent}}`, "Swift alternate scaffold", [statement.alternate], [`${path}/alternate`])
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Returns an unchanged Swift identifier.
 * @param {string} name - Validated identifier.
 * @returns {string} Unchanged identifier.
 */
function identity(name) {
  return name
}
