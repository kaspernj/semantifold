// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable Java `Main` program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateJava(module, writer) {
  writer.synthetic("public final class Main {\n", "Java class scaffolding", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.synthetic("  ", "indentation", [declaration])
    writer.mapped("private static", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "method spacing", [declaration])
    writer.mapped(emitScalarType("java", declaration.returnType), {
      mappingKind: "exact",
      node: declaration.returnType,
      path: `/functions/${functionIndex}/returnType`,
      role: "type"
    })
    writer.synthetic(" ", "method spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(emitScalarType("java", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `/functions/${functionIndex}/parameters/${index}/type`,
        role: "type"
      })
      writer.synthetic(" ", "parameter spacing", [parameter])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, role: "name"})
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "method spacing", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (declaration.body.at(-1))
    const branchPath = `/functions/${functionIndex}/body/${declaration.body.length - 1}`

    for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
      declaration.body.slice(0, -1)).entries()) {
      emitLocal(writer, statement, "    ", `/functions/${functionIndex}/body/${statementIndex}`)
    }

    writer.synthetic("    ", "indentation", [branch], [branchPath])
    writer.mapped("if", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("(", {mappingKind: "anchor", node: branch, path: branchPath})
    emitExpression(writer, branch.condition, `${branchPath}/condition`, "java", identity)
    writer.mapped(")", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("{", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic("\n", "line break", [branch], [branchPath])
    emitBranch(writer, branch.consequent, branch, "      ", branchPath, `${branchPath}/consequent`)
    writer.synthetic("    ", "indentation", [branch], [branchPath])
    writer.mapped("}", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("else", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("{", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic("\n", "line break", [branch], [branchPath])
    emitBranch(writer, branch.alternate, branch, "      ", branchPath, `${branchPath}/alternate`)
    writer.synthetic("    ", "indentation", [branch], [branchPath])
    writer.mapped("}", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic("\n", "line break", [branch], [branchPath])
    writer.synthetic("  ", "indentation", [declaration])
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  writer.synthetic("  ", "indentation", [module.entryPoint])
  writer.mapped("public static void main", {mappingKind: "anchor", node: module.entryPoint})
  writer.mapped("(", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic("String[] args", "Java entry-point signature", [module.entryPoint])
  writer.mapped(")", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic(" ", "method spacing", [module.entryPoint])
  writer.mapped("{", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic("\n", "line break", [module.entryPoint])

  const statements = module.entryPoint.body

  for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
    statements.slice(0, -1)).entries()) emitLocal(writer, statement, "    ", `/entryPoint/body/${statementIndex}`)

  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (statements.at(-1))
  const printPath = `/entryPoint/body/${statements.length - 1}`

  writer.synthetic("    ", "indentation", [print], [printPath])
  writer.mapped("System.out.println", {mappingKind: "anchor", node: print, path: printPath})
  writer.mapped("(", {mappingKind: "anchor", node: print, path: printPath})
  emitExpression(writer, print.expression, `${printPath}/expression`, "java", identity)
  writer.mapped(")", {mappingKind: "anchor", node: print, path: printPath})
  writer.mapped(";", {mappingKind: "anchor", node: print, path: printPath})
  writer.synthetic("\n  ", "line break and indentation", [module.entryPoint])
  writer.mapped("}", {mappingKind: "anchor", node: module.entryPoint})
  writer.synthetic("\n}\n", "Java class scaffolding", [module])
}

/**
 * Emits one Java return branch.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} statements - Branch statements.
 * @param {import("../semantic/types.js").IfStatement} branch - Owning branch.
 * @param {string} indent - Indentation.
 * @param {string} branchPath - Exact JSON Pointer for the owning branch occurrence.
 * @param {string} statementsPath - JSON Pointer for the branch statement sequence.
 * @returns {void}
 */
function emitBranch(writer, statements, branch, indent, branchPath, statementsPath) {
  for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
    statements.slice(0, -1)).entries()) emitLocal(writer, statement, indent, `${statementsPath}/${statementIndex}`)

  const returned = /** @type {import("../semantic/types.js").ReturnStatement} */ (statements.at(-1))
  const returnedPath = `${statementsPath}/${statements.length - 1}`

  writer.synthetic(indent, "indentation", [branch], [branchPath])
  writer.mapped("return", {mappingKind: "anchor", node: returned, path: returnedPath})
  writer.synthetic(" ", "return spacing", [returned], [returnedPath])
  emitExpression(writer, returned.expression, `${returnedPath}/expression`, "java", identity)
  writer.mapped(";", {mappingKind: "anchor", node: returned, path: returnedPath})
  writer.synthetic("\n", "line break", [returned], [returnedPath])
}

/**
 * Emits one Java local statement.
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
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "java", identity)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  if (!statement.mutable) {
    writer.mapped("final", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic(" ", "modifier spacing", [statement], [statementPath])
  }
  writer.mapped(emitScalarType("java", statement.type), {
    mappingKind: "exact",
    node: statement.type,
    path: `${statementPath}/type`,
    role: "type"
  })
  writer.synthetic(" ", "declaration spacing", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "java", identity)
  writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Returns an unchanged Java identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
