// @ts-check

import {emitExpression} from "./shared.js"

/**
 * Emits an independently executable JavaScript program with JSDoc types.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} JavaScript source.
 */
export function generateJavaScript(module) {
  const functions = module.functions.map((functionDeclaration) => {
    const parameters = functionDeclaration.parameters.map((parameter) => parameter.name).join(", ")
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])

    return [
      "/**",
      " * Generated semantic function.",
      ...functionDeclaration.parameters.map((parameter) => ` * @param {number} ${parameter.name} - Integer parameter.`),
      " * @returns {number} Integer result.",
      " */",
      `function ${functionDeclaration.name}(${parameters}) {`,
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
