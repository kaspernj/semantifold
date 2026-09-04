// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits one deterministic standalone Python program.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generatePython(module, writer) {
  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.mapped("def", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, parameterIndex) => {
      const parameterPath = `/functions/${functionIndex}/parameters/${parameterIndex}`

      if (parameterIndex > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(": ", "Python annotation separator", [parameter], [parameterPath])
      writer.mapped(emitScalarType("python", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `${parameterPath}/type`,
        role: "type"
      })
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" -> ", "Python return annotation separator", [declaration])
    writer.mapped(emitScalarType("python", declaration.returnType), {
      mappingKind: "exact",
      node: declaration.returnType,
      path: `/functions/${functionIndex}/returnType`,
      role: "type"
    })
    writer.mapped(":", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])
    emitBlock(writer, declaration.body, "    ", `/functions/${functionIndex}/body`)
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body")
}

/**
 * Emits one Python indentation block, using pass only for an empty semantic block.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Leading indentation.
 * @param {string} path - Exact block path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  if (block.statements.length == 0) {
    writer.synthetic(`${indent}pass\n`, "Python empty block", [block], [path])
    return
  }

  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`))
}

/**
 * Emits one supported Python statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Leading indentation.
 * @param {string} path - Exact statement path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") {
    emitLocal(writer, statement, indent, path)
    return
  }
  if (statement.kind == "IfStatement") {
    emitIf(writer, statement, indent, path, "if")
    return
  }

  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "python", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }

  writer.mapped("print", {mappingKind: "anchor", node: statement, path})
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.expression, `${path}/expression`, "python", identity)
  writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits a Python if or elif and its optional alternative.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").IfStatement} statement - Branch.
 * @param {string} indent - Leading indentation.
 * @param {string} path - Exact branch path.
 * @param {"if" | "elif"} keyword - Branch keyword.
 * @returns {void}
 */
function emitIf(writer, statement, indent, path, keyword) {
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped(keyword, {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  emitExpression(writer, statement.condition, `${path}/condition`, "python", identity)
  writer.mapped(":", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}    `, `${path}/consequent`)

  if (!statement.alternate) return
  if (statement.alternate.statements.length == 1 && statement.alternate.statements[0].kind == "IfStatement") {
    emitIf(writer, statement.alternate.statements[0], indent, `${path}/alternate/statements/0`, "elif")
    return
  }

  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("else", {mappingKind: "anchor", node: statement, path})
  writer.mapped(":", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.alternate, `${indent}    `, `${path}/alternate`)
}

/**
 * Emits one annotated local declaration or plain assignment.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} path - Exact statement path.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" && !statement.mutable) {
    writer.synthetic(`${indent}# @semantifold-immutable\n`, "Python immutable local carrier", [statement], [path])
  }
  writer.synthetic(indent, "indentation", [statement], [path])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${path}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "python", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }

  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path, role: "name"})
  writer.synthetic(": ", "Python annotation separator", [statement], [path])
  writer.mapped(emitScalarType("python", statement.type), {
    mappingKind: "exact", node: statement.type, path: `${path}/type`, role: "type"
  })
  writer.synthetic(" ", "assignment spacing", [statement], [path])
  writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [path])
  emitExpression(writer, statement.initializer, `${path}/initializer`, "python", identity)
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Returns one unchanged Python identifier.
 * @param {string} name - Semantic identifier.
 * @returns {string} Unchanged Python identifier.
 */
function identity(name) {
  return name
}
