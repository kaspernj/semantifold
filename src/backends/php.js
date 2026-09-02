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
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))
    const prefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (functionDeclaration.body.slice(0, -1)).flatMap((statement) => emitLocal(statement, "    "))
    const consequentPrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.consequent.slice(0, -1)).flatMap((statement) => emitLocal(statement, "        "))
    const alternatePrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.alternate.slice(0, -1)).flatMap((statement) => emitLocal(statement, "        "))
    const consequentReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const alternateReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1))
    const consequent = emitExpression(consequentReturn.expression, "php", (name) => `$${name}`)
    const alternate = emitExpression(alternateReturn.expression, "php", (name) => `$${name}`)

    return [
      `function ${functionDeclaration.name}(${parameters}): ${emitScalarType("php", functionDeclaration.returnType)}`,
      "{",
      ...prefix,
      `    if (${emitExpression(branch.condition, "php", (name) => `$${name}`)}) {`,
      ...consequentPrefix,
      `        return ${consequent};`,
      "    } else {",
      ...alternatePrefix,
      `        return ${alternate};`,
      "    }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const entryPrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (module.entryPoint.body.slice(0, -1)).flatMap((statement) => emitLocal(statement, ""))
  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1))
  const prints = [...entryPrefix, `echo ${emitExpression(print.expression, "php", (name) => `$${name}`)}, PHP_EOL;`].join("\n")

  return `<?php\ndeclare(strict_types=1);\n\n${functions}\n\n${prints}\n`
}

/**
 * Emits one PHP local statement with its exact Semantifold profile metadata.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @returns {string[]} Source lines.
 */
function emitLocal(statement, indent) {
  if (statement.kind == "AssignmentStatement") {
    return [`${indent}$${statement.target.name} = ${emitExpression(statement.expression, "php", (name) => `$${name}`)};`]
  }

  if (statement.mutable) {
    return [
      `${indent}/** @var ${emitScalarType("php", statement.type)} $${statement.name} */`,
      `${indent}$${statement.name} = ${emitExpression(statement.initializer, "php", (name) => `$${name}`)};`
    ]
  }

  return [
    `${indent}/**`,
    `${indent} * @var ${emitScalarType("php", statement.type)} $${statement.name}`,
    `${indent} * @semantifold-immutable`,
    `${indent} */`,
    `${indent}$${statement.name} = ${emitExpression(statement.initializer, "php", (name) => `$${name}`)};`
  ]
}
