// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable PHP program.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} PHP source.
 */
export function generatePhp(module) {
  const functions = module.functions.map((functionDeclaration) => {
    const parameters = functionDeclaration.parameters.map((parameter) => {
      return `${emitScalarType("php", parameter.type)} $${parameter.name}`
    }).join(", ")
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])
    const consequent = emitExpression(branch.consequent[0].expression, "php", (name) => `$${name}`)
    const alternate = emitExpression(branch.alternate[0].expression, "php", (name) => `$${name}`)

    return [
      `function ${functionDeclaration.name}(${parameters}): ${emitScalarType("php", functionDeclaration.returnType)}`,
      "{",
      `    if (${emitExpression(branch.condition, "php", (name) => `$${name}`)}) {`,
      `        return ${consequent};`,
      "    } else {",
      `        return ${alternate};`,
      "    }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const prints = module.entryPoint.body.map((statement) => {
    return `echo ${emitExpression(statement.expression, "php", (name) => `$${name}`)}, PHP_EOL;`
  }).join("\n")

  return `<?php\ndeclare(strict_types=1);\n\n${functions}\n\n${prints}\n`
}
