// @ts-check

import {emitExpression, requiresCanonicalZeroRendering} from "./shared.js"
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
      const parameterPath = `/functions/${functionIndex}/parameters/${parameterIndex}`

      writer.synthetic(" * @param {", "JavaScript type scaffolding", [parameter], [parameterPath])
      writer.mapped(emitScalarType("javascript", parameter.type), {
        mappingKind: "exact",
        node: parameter.type,
        path: `${parameterPath}/type`,
        role: "type"
      })
      writer.synthetic("} ", "JavaScript type scaffolding", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(" - Semantic parameter.\n", "JavaScript type scaffolding", [parameter], [parameterPath])
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
      writer.mapped(parameter.name, {
        mappingKind: "exact",
        node: parameter,
        path: `/functions/${functionIndex}/parameters/${index}`,
        role: "name"
      })
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (declaration.body.at(-1))
    const branchPath = `/functions/${functionIndex}/body/${declaration.body.length - 1}`

    for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
      declaration.body.slice(0, -1)).entries()) {
      emitLocal(writer, statement, "  ", `/functions/${functionIndex}/body/${statementIndex}`)
    }

    writer.synthetic("  ", "indentation", [branch], [branchPath])
    writer.mapped("if", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("(", {mappingKind: "anchor", node: branch, path: branchPath})
    emitExpression(writer, branch.condition, `${branchPath}/condition`, "javascript", identity)
    writer.mapped(")", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("{", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic("\n", "line break", [branch], [branchPath])
    emitBranch(writer, branch.consequent, branch, "    ", branchPath, `${branchPath}/consequent`)
    writer.synthetic("  ", "indentation", [branch], [branchPath])
    writer.mapped("}", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("else", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic(" ", "conditional spacing", [branch], [branchPath])
    writer.mapped("{", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic("\n", "line break", [branch], [branchPath])
    emitBranch(writer, branch.alternate, branch, "    ", branchPath, `${branchPath}/alternate`)
    writer.synthetic("  ", "indentation", [branch], [branchPath])
    writer.mapped("}", {mappingKind: "anchor", node: branch, path: branchPath})
    writer.synthetic("\n", "line break", [branch], [branchPath])
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
  const statements = module.entryPoint.body

  for (const [statementIndex, statement] of /** @type {import("../semantic/types.js").LocalStatement[]} */ (
    statements.slice(0, -1)).entries()) emitLocal(writer, statement, "", `/entryPoint/body/${statementIndex}`)

  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (statements.at(-1))
  const printPath = `/entryPoint/body/${statements.length - 1}`

  writer.mapped("console.log", {mappingKind: "anchor", node: print, path: printPath})
  writer.mapped("(", {mappingKind: "anchor", node: print, path: printPath})
  const canonicalizeZero = requiresCanonicalZeroRendering(module)

  if (canonicalizeZero) writer.synthetic("(", "canonical integer output", [print], [printPath])
  emitExpression(writer, print.expression, `${printPath}/expression`, "javascript", identity)
  if (canonicalizeZero) writer.synthetic(").toString()", "canonical integer output", [print], [printPath])
  writer.mapped(")", {mappingKind: "anchor", node: print, path: printPath})
  writer.synthetic("\n", "final line break", [module.entryPoint])
}

/**
 * Emits one JavaScript branch.
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
  emitExpression(writer, returned.expression, `${returnedPath}/expression`, "javascript", identity)
  writer.synthetic("\n", "line break", [returned], [returnedPath])
}

/**
 * Emits one JavaScript local statement and its JSDoc type carrier.
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
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "javascript", identity)
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  writer.synthetic("/** @type {", "JavaScript local type scaffolding", [statement], [statementPath])
  writer.mapped(emitScalarType("javascript", statement.type), {
    mappingKind: "exact",
    node: statement.type,
    path: `${statementPath}/type`,
    role: "type"
  })
  writer.synthetic("} */\n", "JavaScript local type scaffolding", [statement], [statementPath])
  writer.synthetic(indent, "indentation", [statement], [statementPath])
  writer.mapped(statement.mutable ? "let" : "const", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic(" ", "declaration spacing", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "javascript", identity)
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Returns an unchanged JavaScript identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
