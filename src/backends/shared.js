// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {validateBackendTypes} from "../semantic/validate.js"
import {validateTargetIdentifier} from "./identifiers.js"
import {emitStringLiteral} from "./scalars.js"

/**
 * Checks the intentionally narrow backend contract.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
export function validateBackendModule(module, language) {
  if (module.kind != "Module") unsupportedCapability(language, module.kind, module.location)
  if (module.functions.length == 0) unsupportedCapability(language, "module without functions", module.location)
  validateRestrictedSequence(module.entryPoint.body, "PrintStatement", language)
  validateScaffoldingNames(module, language)

  for (const functionDeclaration of module.functions) {
    validateTargetIdentifier(language, functionDeclaration.name, "function", functionDeclaration.location)

    if (functionDeclaration.parameters.length != 2) {
      unsupportedCapability(language, "function parameter count other than two", functionDeclaration.location)
    }
    validateRestrictedSequence(functionDeclaration.body, "IfStatement", language)

    for (const parameter of functionDeclaration.parameters) {
      validateTargetIdentifier(language, parameter.name, "parameter", parameter.location)

    }

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))

    validateRestrictedSequence(branch.consequent, "ReturnStatement", language)
    validateRestrictedSequence(branch.alternate, "ReturnStatement", language)

    validateExpression(branch.condition, language)
    validateExpression(/** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1)).expression, language)
    validateExpression(/** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1)).expression, language)
  }

  validateExpression(/** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1)).expression, language)
  validateBackendTypes(module, language)
}

/**
 * Rejects semantic names that would capture syntax owned by one backend emitter.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
function validateScaffoldingNames(module, language) {
  const ownedEntryNames = language == "java" ? new Set(["args", "System"]) :
    ["javascript", "typescript"].includes(language) ? new Set(["console"]) : new Set()
  const ownedCallableNames = ["javascript", "typescript"].includes(language) ? new Set(["console"]) :
    language == "ruby" ? new Set(["puts"]) : new Set()

  for (const statement of module.entryPoint.body.slice(0, -1)) {
    if (statement.kind == "LocalDeclaration" && ownedEntryNames.has(statement.name)) {
      unsupportedCapability(language, `entry local '${statement.name}' captures backend scaffolding`, statement.location)
    }
  }
  for (const declaration of module.functions) {
    if (ownedCallableNames.has(declaration.name)) {
      unsupportedCapability(language, `function '${declaration.name}' captures backend scaffolding`, declaration.location)
    }
  }
}

/**
 * Validates a task-002 local prefix and exact terminal statement.
 * @param {{kind: string, location: import("../semantic/types.js").SourceLocation}[]} statements - Statements.
 * @param {"IfStatement" | "ReturnStatement" | "PrintStatement"} terminalKind - Required terminal kind.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
function validateRestrictedSequence(statements, terminalKind, language) {
  const terminal = statements.at(-1)

  if (!terminal || terminal.kind != terminalKind) {
    unsupportedCapability(language, `statement sequence without terminal ${terminalKind}`, terminal?.location)
  }

  for (const statement of statements.slice(0, -1)) {
    if (statement.kind == "LocalDeclaration") {
      const declaration = /** @type {import("../semantic/types.js").LocalDeclaration} */ (statement)

      if (typeof declaration.mutable != "boolean") {
        unsupportedCapability(language, "local declaration with invalid mutability", declaration.location)
      }
      validateTargetIdentifier(language, declaration.name, "local", declaration.location)
      validateExpression(declaration.initializer, language)
      continue
    }
    if (statement.kind == "AssignmentStatement") {
      const assignment = /** @type {import("../semantic/types.js").AssignmentStatement} */ (statement)

      if (assignment.target.kind != "IdentifierExpression") {
        unsupportedCapability(language, `assignment target ${assignment.target.kind}`, assignment.target.location)
      }
      validateTargetIdentifier(language, assignment.target.name, "assignment target", assignment.target.location)
      validateExpression(assignment.expression, language)
      continue
    }

    unsupportedCapability(language, `statement ${statement.kind}`, statement.location)
  }
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
  if (expression.kind == "BooleanLiteral" || expression.kind == "StringLiteral") return
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
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {(name: string) => string} emitIdentifier - Identifier formatter.
 * @returns {string} Source expression.
 */
export function emitExpression(expression, language, emitIdentifier) {
  if (expression.kind == "IdentifierExpression") return emitIdentifier(expression.name)
  if (expression.kind == "IntegerLiteral") return String(expression.value)
  if (expression.kind == "BooleanLiteral") return expression.value ? "true" : "false"
  if (expression.kind == "StringLiteral") return emitStringLiteral(language, expression.value)
  if (expression.kind == "CallExpression") {
    return `${expression.callee}(${expression.arguments.map((argument) => emitExpression(argument, language, emitIdentifier)).join(", ")})`
  }

  return `(${emitExpression(expression.left, language, emitIdentifier)} ${expression.operator} ${emitExpression(expression.right, language, emitIdentifier)})`
}
