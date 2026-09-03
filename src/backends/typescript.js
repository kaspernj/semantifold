// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable TypeScript program.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} TypeScript source.
 */
export function generateTypeScript(module) {
  const functions = module.functions.map((functionDeclaration) => {
    const parameters = functionDeclaration.parameters.map((parameter) => {
      return `${parameter.name}: ${emitScalarType("typescript", parameter.type)}`
    }).join(", ")
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))
    const prefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (functionDeclaration.body.slice(0, -1)).map((statement) => emitLocal(statement, "  "))
    const consequent = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.consequent.slice(0, -1)).map((statement) => emitLocal(statement, "    "))
    const alternate = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.alternate.slice(0, -1)).map((statement) => emitLocal(statement, "    "))
    const consequentReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const alternateReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1))

    return [
      `function ${functionDeclaration.name}(${parameters}): ${emitScalarType("typescript", functionDeclaration.returnType)} {`,
      ...prefix,
      `  if (${emitExpression(branch.condition, "typescript", (name) => name)}) {`,
      ...consequent,
      `    return ${emitExpression(consequentReturn.expression, "typescript", (name) => name)}`,
      "  } else {",
      ...alternate,
      `    return ${emitExpression(alternateReturn.expression, "typescript", (name) => name)}`,
      "  }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const entryPrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (module.entryPoint.body.slice(0, -1)).map((statement) => emitLocal(statement, ""))
  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1))
  const prints = [...entryPrefix, `console.log(${emitExpression(print.expression, "typescript", (name) => name)})`].join("\n")

  return `${functions}\n\n${prints}\n`
}

/**
 * Emits one TypeScript local statement.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @returns {string} Source line.
 */
function emitLocal(statement, indent) {
  if (statement.kind == "AssignmentStatement") {
    return `${indent}${statement.target.name} = ${emitExpression(statement.expression, "typescript", (name) => name)}`
  }

  return `${indent}${statement.mutable ? "let" : "const"} ${statement.name}: ${emitScalarType("typescript", statement.type)} = ${emitExpression(statement.initializer, "typescript", (name) => name)}`
}
