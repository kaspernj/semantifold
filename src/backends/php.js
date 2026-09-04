// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable PHP program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generatePhp(module, writer) {
  writer.synthetic("<?php\ndeclare(strict_types=1);\n\n", "PHP program scaffolding", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.mapped("function", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      const parameterPath = `/functions/${functionIndex}/parameters/${index}`

      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(emitScalarType("php", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `${parameterPath}/type`,
        role: "type"
      })
      writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
      writer.mapped(`$${parameter.name}`, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(": ", "return type separator", [declaration])
    writer.mapped(emitScalarType("php", declaration.returnType), {
      mappingKind: "exact",
      node: declaration.returnType,
      path: `/functions/${functionIndex}/returnType`,
      role: "type"
    })
    writer.synthetic("\n", "line break", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    emitBlock(writer, declaration.body, "    ", `/functions/${functionIndex}/body`)
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body")
}

/**
 * Emits one ordered PHP block body.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact block path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`))
}

/**
 * Emits one PHP statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact statement path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") return emitLocal(writer, statement, indent, path)
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "php", phpIdentifier)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("echo", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "print spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "php", phpIdentifier)
    writer.synthetic(", ", "PHP print separator", [statement], [path])
    writer.mapped("PHP_EOL", {mappingKind: "anchor", node: statement, path})
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.condition, `${path}/condition`, "php", phpIdentifier)
  writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("{", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}    `, `${path}/consequent`)
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("}", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  if (statement.alternate) {
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}    `, `${path}/alternate`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one PHP local statement with its exact Semantifold profile metadata.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} statementPath - Exact JSON Pointer for this statement occurrence.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, statementPath) {
  writer.synthetic(indent, "indentation", [statement], [statementPath])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(`$${statement.target.name}`, {mappingKind: "exact", node: statement.target, path: `${statementPath}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "php", phpIdentifier)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  if (statement.mutable) {
    writer.synthetic("/** @var ", "PHP local type scaffolding", [statement], [statementPath])
    writer.mapped(emitScalarType("php", statement.type), {
      mappingKind: "exact",
      node: statement.type,
      path: `${statementPath}/type`,
      role: "type"
    })
    writer.synthetic(" ", "PHP local type scaffolding", [statement], [statementPath])
    writer.mapped(`$${statement.name}`, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
    writer.synthetic(" */\n", "PHP local type scaffolding", [statement], [statementPath])
  } else {
    writer.synthetic("/**\n", "PHP local type scaffolding", [statement], [statementPath])
    writer.synthetic(`${indent} * @var `, "PHP local type scaffolding", [statement], [statementPath])
    writer.mapped(emitScalarType("php", statement.type), {
      mappingKind: "exact",
      node: statement.type,
      path: `${statementPath}/type`,
      role: "type"
    })
    writer.synthetic(" ", "PHP local type scaffolding", [statement], [statementPath])
    writer.mapped(`$${statement.name}`, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
    writer.synthetic(`\n${indent} * @semantifold-immutable\n${indent} */\n`, "PHP local type scaffolding", [statement], [statementPath])
  }

  writer.synthetic(indent, "indentation", [statement], [statementPath])
  writer.mapped(`$${statement.name}`, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "php", phpIdentifier)
  writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Formats one PHP variable identifier.
 * @param {string} name - Semantic identifier.
 * @returns {string} PHP identifier.
 */
function phpIdentifier(name) {
  return `$${name}`
}
