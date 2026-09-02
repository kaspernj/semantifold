// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {validateTargetIdentifier} from "./identifiers.js"

/**
 * Checks the intentionally narrow backend contract.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
export function validateBackendModule(module, language) {
  if (module.kind != "Module") unsupportedCapability(language, module.kind, module.location)
  if (module.functions.length == 0) unsupportedCapability(language, "module without functions", module.location)
  if (module.entryPoint.body.length != 1) {
    unsupportedCapability(language, "entry point without exactly one print", module.entryPoint.location)
  }
  if (module.entryPoint.body[0].kind != "PrintStatement") {
    unsupportedCapability(language, "entry point statement other than print", module.entryPoint.body[0].location)
  }

  for (const functionDeclaration of module.functions) {
    validateTargetIdentifier(language, functionDeclaration.name, "function", functionDeclaration.location)

    if (functionDeclaration.parameters.length != 2) {
      unsupportedCapability(language, "function parameter count other than two", functionDeclaration.location)
    }
    if (functionDeclaration.returnType.name != "integer") {
      unsupportedCapability(language, `return type ${functionDeclaration.returnType.name}`, functionDeclaration.location)
    }
    if (functionDeclaration.body.length != 1 || functionDeclaration.body[0].kind != "IfStatement") {
      unsupportedCapability(language, "function body other than one if/else", functionDeclaration.location)
    }

    for (const parameter of functionDeclaration.parameters) {
      validateTargetIdentifier(language, parameter.name, "parameter", parameter.location)

      if (parameter.type.name != "integer") {
        unsupportedCapability(language, `parameter type ${parameter.type.name}`, parameter.location)
      }
    }

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body[0])

    if (branch.consequent.length != 1 || branch.alternate.length != 1 ||
      branch.consequent[0].kind != "ReturnStatement" || branch.alternate[0].kind != "ReturnStatement") {
      unsupportedCapability(language, "if/else branch without exactly one return", branch.location)
    }

    validateExpression(branch.condition, language)
    validateExpression(branch.consequent[0].expression, language)
    validateExpression(branch.alternate[0].expression, language)
  }

  for (const statement of module.entryPoint.body) validateExpression(statement.expression, language)
}

/**
 * Checks expression backend capabilities recursively.
 * @param {import("../semantic/types.js").Expression} expression - Semantic expression.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
function validateExpression(expression, language) {
  if (expression.kind == "IdentifierExpression") {
    validateTargetIdentifier(language, expression.name, "reference", expression.location)
    return
  }
  if (expression.kind == "IntegerLiteral") {
    if (!Number.isSafeInteger(expression.value)) {
      unsupportedCapability(language, "non-safe integer literal", expression.location)
    }
    if (language == "java" && (expression.value < -2147483648 || expression.value > 2147483647)) {
      unsupportedCapability(language, "integer literal outside signed 32-bit int range", expression.location)
    }
    return
  }
  if (expression.kind == "CallExpression") {
    validateTargetIdentifier(language, expression.callee, "callee", expression.location)
    if (expression.arguments.length != 2) {
      unsupportedCapability(language, "call argument count other than two", expression.location)
    }
    for (const argument of expression.arguments) validateExpression(argument, language)
    return
  }
  if (expression.kind == "BinaryExpression") {
    if (![">", "-", "+"].includes(expression.operator)) {
      unsupportedCapability(language, `binary operator ${expression.operator}`, expression.location)
    }
    validateExpression(expression.left, language)
    validateExpression(expression.right, language)
    return
  }

  const unexpected = /** @type {{kind: string, location: import("../semantic/types.js").SourceLocation}} */ (expression)

  unsupportedCapability(language, unexpected.kind, unexpected.location)
}

/**
 * Emits a supported expression.
 * @param {import("../semantic/types.js").Expression} expression - Semantic expression.
 * @param {(name: string) => string} emitIdentifier - Identifier formatter.
 * @returns {string} Source expression.
 */
export function emitExpression(expression, emitIdentifier) {
  if (expression.kind == "IdentifierExpression") return emitIdentifier(expression.name)
  if (expression.kind == "IntegerLiteral") return String(expression.value)
  if (expression.kind == "CallExpression") {
    return `${expression.callee}(${expression.arguments.map((argument) => emitExpression(argument, emitIdentifier)).join(", ")})`
  }

  return `(${emitExpression(expression.left, emitIdentifier)} ${expression.operator} ${emitExpression(expression.right, emitIdentifier)})`
}
