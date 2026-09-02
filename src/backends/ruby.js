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
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])

    return [
      ...typeComments,
      `def ${functionDeclaration.name}(${parameters})`,
      `  if ${emitExpression(branch.condition, "ruby", (name) => name)}`,
      `    return ${emitExpression(branch.consequent[0].expression, "ruby", (name) => name)}`,
      "  else",
      `    return ${emitExpression(branch.alternate[0].expression, "ruby", (name) => name)}`,
      "  end",
      "end"
    ].join("\n")
  }).join("\n\n")
  const prints = module.entryPoint.body.map((statement) => {
    return `puts ${emitExpression(statement.expression, "ruby", (name) => name)}`
  }).join("\n")

  return `${functions}\n\n${prints}\n`
}
