// @ts-check

import {emitExpression} from "./shared.js"

/**
 * Emits an independently executable TypeScript program.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} TypeScript source.
 */
export function generateTypeScript(module) {
  const functions = module.functions.map((functionDeclaration) => {
    const parameters = functionDeclaration.parameters.map((parameter) => `${parameter.name}: number`).join(", ")
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])

    return [
      `function ${functionDeclaration.name}(${parameters}): number {`,
      `  if (${emitExpression(branch.condition, (name) => name)}) {`,
      `    return ${emitExpression(branch.consequent[0].expression, (name) => name)}`,
      "  } else {",
      `    return ${emitExpression(branch.alternate[0].expression, (name) => name)}`,
      "  }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const prints = module.entryPoint.body.map((statement) => {
    return `console.log(${emitExpression(statement.expression, (name) => name)})`
  }).join("\n")

  return `${functions}\n\n${prints}\n`
}
