// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable Ruby program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateRuby(module, writer) {
  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    for (const [parameterIndex, parameter] of declaration.parameters.entries()) {
      const parameterPath = `/functions/${functionIndex}/parameters/${parameterIndex}`

      writer.synthetic("# @param ", "Ruby type scaffolding", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(" [", "Ruby type scaffolding", [parameter], [parameterPath])
      writer.mapped(emitScalarType("ruby", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `${parameterPath}/type`,
        role: "type"
      })
      writer.synthetic("]\n", "Ruby type scaffolding", [parameter], [parameterPath])
    }
    writer.synthetic("# @return [", "Ruby type scaffolding", [declaration])
    writer.mapped(emitScalarType("ruby", declaration.returnType), {
      mappingKind: "exact",
      node: declaration.returnType,
      path: `/functions/${functionIndex}/returnType`,
      role: "type"
    })
    writer.synthetic("]\n", "Ruby type scaffolding", [declaration])
    writer.mapped("def", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(parameter.name, {
        mappingKind: "exact",
        node: parameter,
        path: `/functions/${functionIndex}/parameters/${index}`,
        role: "name"
      })
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    emitBlock(writer, declaration.body, "  ", `/functions/${functionIndex}/body`)
    writer.mapped("end", {mappingKind: "anchor", node: declaration})
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body")
}

/**
 * Emits one ordered Ruby block body.
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
 * Emits one Ruby statement.
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
    emitExpression(writer, statement.expression, `${path}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("puts", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "print spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  emitExpression(writer, statement.condition, `${path}/condition`, "ruby", identity)
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`)
  if (statement.alternate) {
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`)
  }
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("end", {mappingKind: "anchor", node: statement, path})
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one Ruby local statement with exact Semantifold profile metadata.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} statementPath - Exact JSON Pointer for this statement occurrence.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, statementPath) {
  writer.synthetic(indent, "indentation", [statement], [statementPath])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${statementPath}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  writer.synthetic("# @type [", "Ruby local type scaffolding", [statement], [statementPath])
  writer.mapped(emitScalarType("ruby", statement.type), {
    mappingKind: "exact",
    node: statement.type,
    path: `${statementPath}/type`,
    role: "type"
  })
  writer.synthetic("]\n", "Ruby local type scaffolding", [statement], [statementPath])
  if (!statement.mutable) {
    writer.synthetic(`${indent}# @semantifold-immutable\n`, "Ruby immutability scaffolding", [statement], [statementPath])
  }
  writer.synthetic(indent, "indentation", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "ruby", identity)
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Returns an unchanged Ruby identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
