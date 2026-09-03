// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {validateBackendTypes} from "../semantic/validate.js"
import {validateTargetBindingIdentifier, validateTargetIdentifier} from "./identifiers.js"
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
    validateTargetBindingIdentifier(language, functionDeclaration.name, "function", functionDeclaration.location)

    if (functionDeclaration.parameters.length != 2) {
      unsupportedCapability(language, "function parameter count other than two", functionDeclaration.location)
    }
    validateRestrictedSequence(functionDeclaration.body, "IfStatement", language)

    for (const parameter of functionDeclaration.parameters) {
      validateTargetBindingIdentifier(language, parameter.name, "parameter", parameter.location)

    }

    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (functionDeclaration.body.at(-1))

    validateRestrictedSequence(branch.consequent, "ReturnStatement", language)
    validateRestrictedSequence(branch.alternate, "ReturnStatement", language)

    validateExpression(branch.condition, language, branch.location)
    const consequentReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.consequent.at(-1))
    const alternateReturn = /** @type {import("../semantic/types.js").ReturnStatement} */ (branch.alternate.at(-1))

    validateExpression(consequentReturn.expression, language, consequentReturn.location)
    validateExpression(alternateReturn.expression, language, alternateReturn.location)
  }

  const print = /** @type {import("../semantic/types.js").PrintStatement} */ (module.entryPoint.body.at(-1))

  validateExpression(print.expression, language, print.location)
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
      validateTargetBindingIdentifier(language, declaration.name, "local", declaration.location)
      validateExpression(declaration.initializer, language, declaration.location)
      continue
    }
    if (statement.kind == "AssignmentStatement") {
      const assignment = /** @type {import("../semantic/types.js").AssignmentStatement} */ (statement)

      validateAssignmentTarget(assignment.target, language, assignment.location)
      validateExpression(assignment.expression, language, assignment.location)
      continue
    }

    unsupportedCapability(language, `statement ${statement.kind}`, statement.location)
  }
}

/**
 * Validates the simple identifier target introduced by task 002.
 * @param {unknown} target - Candidate assignment target.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Assignment location.
 * @returns {void}
 */
function validateAssignmentTarget(target, language, ownerLocation) {
  if (!target || typeof target != "object" || Array.isArray(target)) {
    return unsupportedCapability(language, "missing or invalid assignment target", ownerLocation)
  }

  const candidate = /** @type {import("../semantic/types.js").IdentifierExpression} */ (target)
  const location = candidate.location ?? ownerLocation

  if (candidate.kind != "IdentifierExpression") {
    return unsupportedCapability(language, `assignment target ${String(Reflect.get(target, "kind"))}`, location)
  }

  validateTargetBindingIdentifier(language, candidate.name, "assignment target", location)
}

/**
 * Checks expression backend capabilities recursively.
 * @param {unknown} expression - Candidate semantic expression.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Backend language.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Nearest owning node location.
 * @returns {void}
 */
function validateExpression(expression, language, ownerLocation) {
  if (!expression || typeof expression != "object" || Array.isArray(expression)) {
    return unsupportedCapability(language, "missing or invalid expression", ownerLocation)
  }

  const candidate = /** @type {import("../semantic/types.js").Expression} */ (expression)
  const location = candidate.location ?? ownerLocation

  if (typeof candidate.kind != "string") {
    return unsupportedCapability(language, "missing or invalid expression", location)
  }
  if (candidate.kind == "IdentifierExpression") {
    validateTargetIdentifier(language, candidate.name, "reference", location)
    return
  }
  if (candidate.kind == "IntegerLiteral") {
    if (!Number.isSafeInteger(candidate.value)) {
      unsupportedCapability(language, "non-safe integer literal", location)
    }
    if (language == "java" && (candidate.value < -2147483648 || candidate.value > 2147483647)) {
      unsupportedCapability(language, "integer literal outside signed 32-bit int range", location)
    }
    return
  }
  if (candidate.kind == "BooleanLiteral" || candidate.kind == "StringLiteral") return
  if (candidate.kind == "CallExpression") {
    validateTargetIdentifier(language, candidate.callee, "callee", location)
    if (!Array.isArray(candidate.arguments)) {
      unsupportedCapability(language, "missing or invalid call arguments", location)
    }
    if (candidate.arguments.length != 2) {
      unsupportedCapability(language, "call argument count other than two", location)
    }
    for (const argument of candidate.arguments) validateExpression(argument, language, location)
    return
  }
  if (candidate.kind == "BinaryExpression") {
    if (![">", "-", "+"].includes(candidate.operator)) {
      unsupportedCapability(language, `binary operator ${candidate.operator}`, location)
    }
    validateExpression(candidate.left, language, location)
    validateExpression(candidate.right, language, location)
    return
  }

  unsupportedCapability(language, String(Reflect.get(expression, "kind")), location)
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
