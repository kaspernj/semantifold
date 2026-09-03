// @ts-check

import {emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"

/**
 * Emits an independently executable Java `Main` program.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} Java source.
 */
export function generateJava(module) {
  const functions = module.functions.map((functionDeclaration) => {
    const parameters = functionDeclaration.parameters.map((parameter) => {
      return `${emitScalarType("java", parameter.type)} ${parameter.name}`
    }).join(", ")
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))
    const prefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (functionDeclaration.body.slice(0, -1)).map((statement) => emitLocal(statement, "    "))
    const consequent = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.consequent.slice(0, -1)).map((statement) => emitLocal(statement, "      "))
    const alternate = /** @type {import("../semantic/types.js").LocalStatement[]} */ (branch.alternate.slice(0, -1)).map((statement) => emitLocal(statement, "      "))
    const consequentReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const alternateReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1))

    return [
      `  private static ${emitScalarType("java", functionDeclaration.returnType)} ${functionDeclaration.name}(${parameters}) {`,
      ...prefix,
      `    if (${emitExpression(branch.condition, "java", (name) => name)}) {`,
      ...consequent,
      `      return ${emitExpression(consequentReturn.expression, "java", (name) => name)};`,
      "    } else {",
      ...alternate,
      `      return ${emitExpression(alternateReturn.expression, "java", (name) => name)};`,
      "    }",
      "  }"
    ].join("\n")
  }).join("\n\n")
  const entryPrefix = /** @type {import("../semantic/types.js").LocalStatement[]} */ (module.entryPoint.body.slice(0, -1)).map((statement) => emitLocal(statement, "    "))
  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1))
  const prints = [...entryPrefix, `    System.out.println(${emitExpression(print.expression, "java", (name) => name)});`].join("\n")

  return [
    "public final class Main {",
    functions,
    "",
    "  public static void main(String[] args) {",
    prints,
    "  }",
    "}",
    ""
  ].join("\n")
}

/**
 * Emits one Java local statement.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @returns {string} Source line.
 */
function emitLocal(statement, indent) {
  if (statement.kind == "AssignmentStatement") {
    return `${indent}${statement.target.name} = ${emitExpression(statement.expression, "java", (name) => name)};`
  }

  const final = statement.mutable ? "" : "final "

  return `${indent}${final}${emitScalarType("java", statement.type)} ${statement.name} = ${emitExpression(statement.initializer, "java", (name) => name)};`
}
