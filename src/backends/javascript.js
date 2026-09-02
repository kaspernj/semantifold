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
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))
    const prefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (functionDeclaration.body.slice(0, -1)).flatMap((statement) => emitLocal(statement, "  "))
    const consequent = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.consequent.slice(0, -1)).flatMap((statement) => emitLocal(statement, "    "))
    const alternate = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.alternate.slice(0, -1)).flatMap((statement) => emitLocal(statement, "    "))
    const consequentReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const alternateReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1))

    return [
      "/**",
      " * Generated semantic function.",
      ...functionDeclaration.parameters.map((parameter) => {
        return ` * @param {${emitScalarType("javascript", parameter.type)}} ${parameter.name} - Semantic parameter.`
      }),
      ` * @returns {${emitScalarType("javascript", functionDeclaration.returnType)}} Semantic result.`,
      " */",
      `function ${functionDeclaration.name}(${parameters}) {`,
      ...prefix,
      `  if (${emitExpression(branch.condition, "javascript", (name) => name)}) {`,
      ...consequent,
      `    return ${emitExpression(consequentReturn.expression, "javascript", (name) => name)}`,
      "  } else {",
      ...alternate,
      `    return ${emitExpression(alternateReturn.expression, "javascript", (name) => name)}`,
      "  }",
      "}"
    ].join("\n")
  }).join("\n\n")
  const entryPrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (module.entryPoint.body.slice(0, -1)).flatMap((statement) => emitLocal(statement, ""))
  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1))
  const prints = [...entryPrefix, `console.log(${emitExpression(print.expression, "javascript", (name) => name)})`].join("\n")

  return `${functions}\n\n${prints}\n`
}

/**
 * Emits one JavaScript local statement.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @returns {string[]} Source lines.
 */
function emitLocal(statement, indent) {
  if (statement.kind == "AssignmentStatement") {
    return [`${indent}${statement.target.name} = ${emitExpression(statement.expression, "javascript", (name) => name)}`]
  }

  return [
    `${indent}/** @type {${emitScalarType("javascript", statement.type)}} */`,
    `${indent}${statement.mutable ? "let" : "const"} ${statement.name} = ${emitExpression(statement.initializer, "javascript", (name) => name)}`
  ]
}
