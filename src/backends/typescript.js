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
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])

    return [
      `function ${functionDeclaration.name}(${parameters}): ${emitScalarType("typescript", functionDeclaration.returnType)} {`,
      `  if (${emitExpression(branch.condition, "typescript", (name) => name)}) {`,
      `    return ${emitExpression(branch.consequent[0].expression, "typescript", (name) => name)}`,
      "  } else {",
      `    return ${emitExpression(branch.alternate[0].expression, "typescript", (name) => name)}`,
      "  }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const prints = module.entryPoint.body.map((statement) => {
    return `console.log(${emitExpression(statement.expression, "typescript", (name) => name)})`
  }).join("\n")

  return `${functions}\n\n${prints}\n`
}
