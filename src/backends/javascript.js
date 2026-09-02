// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

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
      ...functionDeclaration.parameters.map((parameter) => {
        return ` * @param {${emitScalarType("javascript", parameter.type)}} ${parameter.name} - Semantic parameter.`
      }),
      ` * @returns {${emitScalarType("javascript", functionDeclaration.returnType)}} Semantic result.`,
      " */",
      `function ${functionDeclaration.name}(${parameters}) {`,
      `  if (${emitExpression(branch.condition, "javascript", (name) => name)}) {`,
      `    return ${emitExpression(branch.consequent[0].expression, "javascript", (name) => name)}`,
      "  } else {",
      `    return ${emitExpression(branch.alternate[0].expression, "javascript", (name) => name)}`,
      "  }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const prints = module.entryPoint.body.map((statement) => {
    return `console.log(${emitExpression(statement.expression, "javascript", (name) => name)})`
  }).join("\n")

  return `${functions}\n\n${prints}\n`
}
