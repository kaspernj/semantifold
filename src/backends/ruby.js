// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable Ruby program.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} Ruby source.
 */
export function generateRuby(module) {
  const functions = module.functions.map((functionDeclaration) => {
    const parameters = functionDeclaration.parameters.map((parameter) => parameter.name).join(", ")
    const typeComments = [
      ...functionDeclaration.parameters.map((parameter) => `# @param ${parameter.name} [${emitScalarType("ruby", parameter.type)}]`),
      `# @return [${emitScalarType("ruby", functionDeclaration.returnType)}]`
    ]
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))
    const prefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (functionDeclaration.body.slice(0, -1)).flatMap((statement) => emitLocal(statement, "  "))
    const consequent = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.consequent.slice(0, -1)).flatMap((statement) => emitLocal(statement, "    "))
    const alternate = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.alternate.slice(0, -1)).flatMap((statement) => emitLocal(statement, "    "))
    const consequentReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const alternateReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1))

    return [
      ...typeComments,
      `def ${functionDeclaration.name}(${parameters})`,
      ...prefix,
      `  if ${emitExpression(branch.condition, "ruby", (name) => name)}`,
      ...consequent,
      `    return ${emitExpression(consequentReturn.expression, "ruby", (name) => name)}`,
      "  else",
      ...alternate,
      `    return ${emitExpression(alternateReturn.expression, "ruby", (name) => name)}`,
      "  end",
      "end"
    ].join("\n")
  }).join("\n\n")
  const entryPrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (module.entryPoint.body.slice(0, -1)).flatMap((statement) => emitLocal(statement, ""))
  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1))
  const prints = [...entryPrefix, `puts ${emitExpression(print.expression, "ruby", (name) => name)}`].join("\n")

  return `${functions}\n\n${prints}\n`
}

/**
 * Emits one Ruby local statement with its exact Semantifold profile metadata.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @returns {string[]} Source lines.
 */
function emitLocal(statement, indent) {
  if (statement.kind == "AssignmentStatement") {
    return [`${indent}${statement.target.name} = ${emitExpression(statement.expression, "ruby", (name) => name)}`]
  }

  return [
    `${indent}# @type [${emitScalarType("ruby", statement.type)}]`,
    ...statement.mutable ? [] : [`${indent}# @semantifold-immutable`],
    `${indent}${statement.name} = ${emitExpression(statement.initializer, "ruby", (name) => name)}`
  ]
}
