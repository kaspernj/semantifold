// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable TypeScript program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateTypeScript(module, writer) {
  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.mapped("function", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, role: "name"})
      writer.synthetic(": ", "type separator", [parameter])
      writer.mapped(emitScalarType("typescript", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `/functions/${functionIndex}/parameters/${index}/type`,
        role: "type"
      })
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(": ", "return type separator", [declaration])
    writer.mapped(emitScalarType("typescript", declaration.returnType), {
      mappingKind: "exact",
      node: declaration.returnType,
      path: `/functions/${functionIndex}/returnType`,
      role: "type"
    })
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (declaration.body.at(-1))
    const branchPath = `/functions/${functionIndex}/body/${declaration.body.length - 1}`

    for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
      declaration.body.slice(0, -1)).entries()) {
      emitLocal(writer, statement, "  ", `/functions/${functionIndex}/body/${statementIndex}`)
      writer.synthetic("\n", "line break", [statement])
    }

    writer.synthetic("  ", "indentation", [branch])
    writer.mapped("if", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("(", {mappingKind: "anchor", node: branch})
    emitExpression(writer, branch.condition, `${branchPath}/condition`, "typescript", identity)
    writer.mapped(")", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("{", {mappingKind: "anchor", node: branch})
    writer.synthetic("\n", "line break", [branch])
    emitBranch(writer, branch.consequent, branch, "    ", `${branchPath}/consequent`)
    writer.synthetic("  ", "indentation", [branch])
    writer.mapped("}", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("else", {mappingKind: "anchor", node: branch})
    writer.synthetic(" ", "conditional spacing", [branch])
    writer.mapped("{", {mappingKind: "anchor", node: branch})
    writer.synthetic("\n", "line break", [branch])
    emitBranch(writer, branch.alternate, branch, "    ", `${branchPath}/alternate`)
    writer.synthetic("  ", "indentation", [branch])
    writer.mapped("}", {mappingKind: "anchor", node: branch})
    writer.synthetic("\n", "line break", [branch])
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  const statements = module.entryPoint.body

  for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
    statements.slice(0, -1)).entries()) {
    emitLocal(writer, statement, "", `/entryPoint/body/${statementIndex}`)
    writer.synthetic("\n", "line break", [statement])
  }

  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (statements.at(-1))

  writer.mapped("console.log", {mappingKind: "anchor", node: print})
  writer.mapped("(", {mappingKind: "anchor", node: print})
  emitExpression(writer, print.expression, `/entryPoint/body/${statements.length - 1}/expression`, "typescript", identity)
  writer.mapped(")", {mappingKind: "anchor", node: print})
  writer.synthetic("\n", "final line break", [module.entryPoint])
}

/**
 * Emits one branch ending in a return.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} statements - Branch statements.
 * @param {import("../semantic/types.js").IfStatement} branch - Owning branch.
 * @param {string} indent - Indentation.
 * @param {string} statementsPath - JSON Pointer for the branch statement sequence.
 * @returns {void}
 */
function emitBranch(writer, statements, branch, indent, statementsPath) {
  for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
    statements.slice(0, -1)).entries()) {
    emitLocal(writer, statement, indent, `${statementsPath}/${statementIndex}`)
    writer.synthetic("\n", "line break", [statement])
  }

  const returned = /** @type {import("../semantic/types.js").ReturnStatement} */ (statements.at(-1))

  writer.synthetic(indent, "indentation", [branch])
  writer.mapped("return", {mappingKind: "anchor", node: returned})
  writer.synthetic(" ", "return spacing", [returned])
  emitExpression(writer, returned.expression, `${statementsPath}/${statements.length - 1}/expression`, "typescript", identity)
  writer.synthetic("\n", "line break", [returned])
}

/**
 * Emits one TypeScript local statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} statementPath - Exact JSON Pointer for this statement occurrence.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, statementPath) {
  writer.synthetic(indent, "indentation", [statement])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement])
    writer.mapped("=", {mappingKind: "exact", node: statement, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement])
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "typescript", identity)
    return
  }

  writer.mapped(statement.mutable ? "let" : "const", {mappingKind: "anchor", node: statement})
  writer.synthetic(" ", "declaration spacing", [statement])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, role: "name"})
  writer.synthetic(": ", "type separator", [statement])
  writer.mapped(emitScalarType("typescript", statement.type), {
    mappingKind: "exact",
    node: statement.type,
    path: `${statementPath}/type`,
    role: "type"
  })
  writer.synthetic(" ", "assignment spacing", [statement])
  writer.mapped("=", {mappingKind: "exact", node: statement, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "typescript", identity)
}

/**
 * Returns an unchanged TypeScript identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
