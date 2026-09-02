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
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])

    return [
      `  private static ${emitScalarType("java", functionDeclaration.returnType)} ${functionDeclaration.name}(${parameters}) {`,
      `    if (${emitExpression(branch.condition, "java", (name) => name)}) {`,
      `      return ${emitExpression(branch.consequent[0].expression, "java", (name) => name)};`,
      "    } else {",
      `      return ${emitExpression(branch.alternate[0].expression, "java", (name) => name)};`,
      "    }",
      "  }"
    ].join("\n")
  }).join("\n\n")
  const prints = module.entryPoint.body.map((statement) => {
    return `    System.out.println(${emitExpression(statement.expression, "java", (name) => name)});`
  }).join("\n")

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
