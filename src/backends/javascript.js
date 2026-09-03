// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable JavaScript program with JSDoc types.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateJavaScript(module, writer) {
  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.synthetic("/**\n * Generated semantic function.\n", "JavaScript type scaffolding", [declaration])
    for (const [parameterIndex, parameter] of declaration.parameters.entries()) {
      writer.synthetic(" * @param {", "JavaScript type scaffolding", [parameter])
      writer.mapped(emitScalarType("javascript", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `/functions/${functionIndex}/parameters/${parameterIndex}/type`,
        role: "type"
      })
      writer.synthetic("} ", "JavaScript type scaffolding", [parameter])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, role: "name"})
      writer.synthetic(" - Semantic parameter.\n", "JavaScript type scaffolding", [parameter])
    }
    writer.synthetic(" * @returns {", "JavaScript type scaffolding", [declaration])
    writer.mapped(emitScalarType("javascript", declaration.returnType), {
      mappingKind: "exact",
      node: declaration.returnType,
      path: `/functions/${functionIndex}/returnType`,
      role: "type"
    })
    writer.synthetic("} Semantic result.\n */\n", "JavaScript type scaffolding", [declaration])
    writer.mapped("function", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, role: "name"})
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (declaration.body.at(-1))

    for (const statement of /** @type {import("../semantic/types.js").LocalStatement[]} */ (declaration.body.slice(0, -1))) {
      emitLocal(writer, statement, "  ")
    }

    writer.synthetic("  ", "indentation", [branch])
    writer.mapped("if", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("(", {mappingKind: "anchor", node: branch})
    emitExpression(writer, branch.condition, "javascript", identity)
    writer.mapped(")", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("{", {mappingKind: "anchor", node: branch})
    writer.synthetic("\n", "line break", [branch])
    emitBranch(writer, branch.consequent, branch, "    ")
    writer.synthetic("  ", "indentation", [branch])
    writer.mapped("}", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("else", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("{", {mappingKind: "anchor", node: branch})
    writer.synthetic("\n", "line break", [branch])
    emitBranch(writer, branch.alternate, branch, "    ")
    writer.synthetic("  ", "indentation", [branch])
    writer.mapped("}", {mappingKind: "anchor", node: branch})
    writer.synthetic("\n", "line break", [branch])
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  const statements = module.entryPoint.body

  for (const statement of /** @type {import("../semantic/types.js").LocalStatement[]} */ (statements.slice(0, -1))) emitLocal(writer, statement, "")

  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (statements.at(-1))

  writer.mapped("console.log", {mappingKind: "anchor", node: print})
  writer.mapped("(", {mappingKind: "anchor", node: print})
  emitExpression(writer, print.expression, "javascript", identity)
  writer.mapped(")", {mappingKind: "anchor", node: print})
  writer.synthetic("\n", "final line break", [module.entryPoint])
}

/**
 * Emits one JavaScript branch.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} statements - Branch statements.
 * @param {import("../semantic/types.js").IfStatement} branch - Owning branch.
 * @param {string} indent - Indentation.
 * @returns {void}
 */
function emitBranch(writer, statements, branch, indent) {
  for (const statement of /** @type {import("../semantic/types.js").LocalStatement[]} */ (statements.slice(0, -1))) emitLocal(writer, statement, indent)

  const returned = /** @type {import("../semantic/types.js").ReturnStatement} */ (statements.at(-1))

  writer.synthetic(indent, "indentation", [branch])
  writer.mapped("return", {mappingKind: "anchor", node: returned})
  writer.synthetic(" ", "return spacing", [returned])
  emitExpression(writer, returned.expression, "javascript", identity)
  writer.synthetic("\n", "line break", [returned])
}

/**
 * Emits one JavaScript local statement and its JSDoc type carrier.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @returns {void}
 */
function emitLocal(writer, statement, indent) {
  writer.synthetic(indent, "indentation", [statement])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement])
    writer.mapped("=", {mappingKind: "exact", node: statement, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement])
    emitExpression(writer, statement.expression, "javascript", identity)
    writer.synthetic("\n", "line break", [statement])
    return
  }

  writer.synthetic("/** @type {", "JavaScript local type scaffolding", [statement])
  writer.mapped(emitScalarType("javascript", statement.type), {mappingKind: "exact", node: statement.type, role: "type"})
  writer.synthetic("} */\n", "JavaScript local type scaffolding", [statement])
  writer.synthetic(indent, "indentation", [statement])
  writer.mapped(statement.mutable ? "let" : "const", {mappingKind: "anchor", node: statement})
  writer.synthetic(" ", "declaration spacing", [statement])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement])
  writer.mapped("=", {mappingKind: "exact", node: statement, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement])
  emitExpression(writer, statement.initializer, "javascript", identity)
  writer.synthetic("\n", "line break", [statement])
}

/**
 * Returns an unchanged JavaScript identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
