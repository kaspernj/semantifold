// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {validateBackendTypes} from "../semantic/validate.js"
import {validateTargetBindingIdentifier, validateTargetIdentifier} from "./identifiers.js"
import {emitStringLiteral} from "./scalars.js"

/** @type {Readonly<Record<import("../semantic/types.js").SemanticUnaryOperation, string>>} */
const unaryOperationSyntax = Object.freeze({BooleanNot: "!", IntegerNegate: "-"})
/** @type {Readonly<Record<import("../semantic/types.js").SemanticBinaryOperation, Readonly<{default: string, php?: string, python?: string, strict?: string}>>>} */
const binaryOperationSyntax = Object.freeze({
  BooleanAnd: Object.freeze({default: "&&", python: "and"}),
  BooleanEqual: Object.freeze({default: "==", strict: "==="}),
  BooleanNotEqual: Object.freeze({default: "!=", strict: "!=="}),
  BooleanOr: Object.freeze({default: "||", python: "or"}),
  IntegerAdd: Object.freeze({default: "+"}),
  IntegerEqual: Object.freeze({default: "==", strict: "==="}),
  IntegerGreaterThan: Object.freeze({default: ">"}),
  IntegerGreaterThanOrEqual: Object.freeze({default: ">="}),
  IntegerLessThan: Object.freeze({default: "<"}),
  IntegerLessThanOrEqual: Object.freeze({default: "<="}),
  IntegerMultiply: Object.freeze({default: "*"}),
  IntegerNotEqual: Object.freeze({default: "!=", strict: "!=="}),
  IntegerSubtract: Object.freeze({default: "-"}),
  StringConcat: Object.freeze({default: "+", php: "."}),
  StringEqual: Object.freeze({default: "==", strict: "==="}),
  StringNotEqual: Object.freeze({default: "!=", strict: "!=="})
})
const task005Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])

/**
 * Checks the intentionally narrow backend contract.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @returns {void}
 */
export function validateBackendModule(module, language) {
  if (!module || typeof module != "object" || Array.isArray(module)) {
    return unsupportedCapability(language, "missing or invalid module", undefined)
  }
  if (module.kind != "Module") unsupportedCapability(language, module.kind, module.location)
  if (!Array.isArray(module.functions) || !module.entryPoint || typeof module.entryPoint != "object" ||
    module.entryPoint.kind != "EntryPoint") unsupportedCapability(language, "missing or invalid module members", module.location)
  if (module.functions.length == 0) unsupportedCapability(language, "module without functions", module.location)
  validateBlock(module.entryPoint.body, language, module.entryPoint.location)
  const declarationIds = new Set()
  const declarationNames = new Set()
  const targetDeclarationNames = new Set()

  for (const functionDeclaration of module.functions) {
    if (!functionDeclaration || typeof functionDeclaration != "object" || Array.isArray(functionDeclaration) ||
      functionDeclaration.kind != "FunctionDeclaration" || !Array.isArray(functionDeclaration.parameters)) {
      unsupportedCapability(language, "missing or invalid function declaration", module.location)
    }
    validateTargetBindingIdentifier(language, functionDeclaration.name, "function", functionDeclaration.location)
    if (declarationNames.has(functionDeclaration.name)) {
      unsupportedCapability(language, `duplicate function '${functionDeclaration.name}'`, functionDeclaration.location)
    }
    declarationNames.add(functionDeclaration.name)
    const targetDeclarationName = language == "php"
      ? functionDeclaration.name.replace(/[A-Z]/gu, (character) => character.toLowerCase())
      : functionDeclaration.name

    if (targetDeclarationNames.has(targetDeclarationName)) {
      unsupportedCapability(language, `target function-name collision '${functionDeclaration.name}'`, functionDeclaration.location)
    }
    targetDeclarationNames.add(targetDeclarationName)
    if (typeof functionDeclaration.id != "string" || !/^function:[0-9]+$/u.test(functionDeclaration.id) ||
      declarationIds.has(functionDeclaration.id)) {
      unsupportedCapability(language, "duplicate or invalid function declaration identity", functionDeclaration.location)
    }
    declarationIds.add(functionDeclaration.id)

    if (!task005Languages.has(language) && functionDeclaration.parameters.length != 2) {
      unsupportedCapability(language, "function parameter count other than two", functionDeclaration.location)
    }
    if (!task005Languages.has(language) && functionDeclaration.returnType?.name == "void") {
      unsupportedCapability(language, "Task 005 void function return", functionDeclaration.location)
    }
    validateBlock(functionDeclaration.body, language, functionDeclaration.location)

    for (const parameter of functionDeclaration.parameters) {
      if (!parameter || typeof parameter != "object" || Array.isArray(parameter) || parameter.kind != "Parameter") {
        unsupportedCapability(language, "missing or invalid parameter", functionDeclaration.location)
      }
      validateTargetBindingIdentifier(language, parameter.name, "parameter", parameter.location)
    }
  }
  validateScaffoldingNames(module, language)
  validateBackendTypes(module, language)
}

/**
 * Rejects semantic names that would capture syntax owned by one backend emitter.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @returns {void}
 */
function validateScaffoldingNames(module, language) {
  const ownedEntryNames = language == "go" ? new Set(["fmt", "int64", "bool", "string", "true", "false"]) :
    language == "csharp" ? new Set(["System"]) : language == "java" ? new Set(["args", "System"]) :
    ["javascript", "typescript"].includes(language) ? new Set(["console"]) : new Set()
  const ownedPrintReceiverNames = language == "go" ? new Set(["fmt", "int64", "bool", "string", "true", "false"]) :
    language == "csharp" || language == "java" ? new Set(["System"]) :
    ["javascript", "typescript"].includes(language) ? new Set(["console"]) : new Set()
  const ownedCallableNames = language == "go" ? new Set(["main", "init", "fmt", "int64", "bool", "string", "true", "false"]) :
    language == "csharp" ? new Set([
    "Equals", "Finalize", "GetHashCode", "GetType", "Main", "MemberwiseClone", "Program", "ReferenceEquals", "System", "ToString"
  ]) :
    language == "java" ? new Set(["main"]) :
    ["javascript", "typescript"].includes(language) ? new Set(["console"]) :
    language == "ruby" ? new Set(["puts", "send", "public_send", "__send__"]) : new Set()

  for (const statement of allStatements(module.entryPoint.body)) {
    if (statement.kind == "LocalDeclaration" && ownedEntryNames.has(statement.name)) {
      unsupportedCapability(language, `entry local '${statement.name}' captures backend scaffolding`, statement.location)
    }
  }
  for (const declaration of module.functions) {
    if (ownedCallableNames.has(declaration.name)) {
      unsupportedCapability(language, `function '${declaration.name}' captures backend scaffolding`, declaration.location)
    }
    for (const parameter of declaration.parameters) {
      if (ownedPrintReceiverNames.has(parameter.name)) {
        unsupportedCapability(language, `function parameter '${parameter.name}' captures backend scaffolding`, parameter.location)
      }
    }
    for (const statement of allStatements(declaration.body)) {
      if (statement.kind == "LocalDeclaration" && ownedPrintReceiverNames.has(statement.name)) {
        unsupportedCapability(language, `function local '${statement.name}' captures backend scaffolding`, statement.location)
      }
    }
  }
}

/**
 * Returns every statement nested beneath a block in semantic order.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @returns {import("../semantic/types.js").Statement[]} Statements including nested branches.
 */
function allStatements(block) {
  return block.statements.flatMap((statement) => statement.kind == "IfStatement"
    ? [statement, ...allStatements(statement.consequent), ...(statement.alternate ? allStatements(statement.alternate) : [])]
    : [statement])
}

/**
 * Validates one complete semantic block before emission.
 * @param {unknown} block - Candidate block.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Enclosing location.
 * @returns {void}
 */
function validateBlock(block, language, ownerLocation) {
  if (!block || typeof block != "object" || Array.isArray(block)) {
    return unsupportedCapability(language, "missing or invalid block", ownerLocation)
  }

  const candidate = /** @type {import("../semantic/types.js").Block} */ (block)
  const location = candidate.location ?? ownerLocation

  if (candidate.kind != "Block") unsupportedCapability(language, `block ${String(Reflect.get(block, "kind"))}`, location)
  if (!Array.isArray(candidate.statements)) unsupportedCapability(language, "missing or invalid block statements", location)

  for (const statement of candidate.statements) validateStatement(statement, language, location)
}

/**
 * Validates one supported statement recursively.
 * @param {unknown} statement - Candidate statement.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Enclosing body location.
 * @returns {void}
 */
function validateStatement(statement, language, ownerLocation) {
  if (!statement || typeof statement != "object" || Array.isArray(statement)) {
    return unsupportedCapability(language, "missing or invalid statement", ownerLocation)
  }

  const kind = Reflect.get(statement, "kind")
  const location = /** @type {import("../semantic/types.js").SourceLocation | undefined} */ (
    Reflect.get(statement, "location") ?? ownerLocation
  )

  if (typeof kind != "string") return unsupportedCapability(language, "missing or invalid statement", location)
  if (kind == "LocalDeclaration") {
    const declaration = /** @type {import("../semantic/types.js").LocalDeclaration} */ (statement)

    if (typeof declaration.mutable != "boolean") {
      unsupportedCapability(language, "local declaration with invalid mutability", location)
    }
    validateTargetBindingIdentifier(language, declaration.name, "local", location)
    validateExpression(declaration.initializer, language, location)
    return
  }
  if (kind == "AssignmentStatement") {
    const assignment = /** @type {import("../semantic/types.js").AssignmentStatement} */ (statement)

    validateAssignmentTarget(assignment.target, language, location)
    validateExpression(assignment.expression, language, location)
    return
  }
  if (kind == "ReturnStatement") {
    const expression = Reflect.get(statement, "expression")

    if (expression !== undefined) validateExpression(expression, language, location)
    return
  }
  if (kind == "ExpressionStatement") {
    if (!task005Languages.has(language)) {
      unsupportedCapability(language, "Task 005 void call expression statement", location)
    }
    const expression = Reflect.get(statement, "expression")

    if (!expression || typeof expression != "object" || Reflect.get(expression, "kind") != "CallExpression") {
      unsupportedCapability(language, "expression statement other than a direct call", location)
    }
    validateExpression(expression, language, location)
    return
  }
  if (kind == "PrintStatement") {
    validateExpression(Reflect.get(statement, "expression"), language, location)
    return
  }
  if (kind == "IfStatement") {
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (statement)

    validateExpression(branch.condition, language, location)
    validateBlock(branch.consequent, language, location)
    if (Object.hasOwn(branch, "alternate")) validateBlock(branch.alternate, language, location)
    return
  }

  unsupportedCapability(language, `statement ${kind}`, location)
}

/**
 * Validates the simple identifier target introduced by task 002.
 * @param {unknown} target - Candidate assignment target.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
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
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Nearest owning node location.
 * @param {boolean} [allowJavaNegatedMinimumOperand] - Whether Java may use 2147483648 only beneath integer negation.
 * @returns {void}
 */
function validateExpression(expression, language, ownerLocation, allowJavaNegatedMinimumOperand = false) {
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
    const validNegatedMinimumOperand = allowJavaNegatedMinimumOperand && candidate.value == 2147483648

    if (language == "java" && !validNegatedMinimumOperand && (candidate.value < -2147483648 || candidate.value > 2147483647)) {
      unsupportedCapability(language, "integer literal outside signed 32-bit int range", location)
    }
    if ((language == "csharp" || language == "go" || language == "c" || language == "cpp" || language == "kotlin" || language == "rust" || language == "swift") && candidate.value < 0 ||
      (language == "c" || language == "cpp" || language == "kotlin" || language == "rust" || language == "swift") && Object.is(candidate.value, -0)) {
      unsupportedCapability(language, "negative integer literal without semantic negation", location)
    }
    return
  }
  if (candidate.kind == "BooleanLiteral" || candidate.kind == "StringLiteral") return
  if (candidate.kind == "CallExpression") {
    validateTargetIdentifier(language, candidate.callee, "callee", location)
    if (!candidate.resolution || typeof candidate.resolution != "object" || Array.isArray(candidate.resolution)) {
      unsupportedCapability(language, "missing or invalid resolved call signature", location)
    }
    if (!Array.isArray(candidate.arguments)) {
      unsupportedCapability(language, "missing or invalid call arguments", location)
    }
    if (!task005Languages.has(language) && candidate.arguments.length != 2) {
      unsupportedCapability(language, "call argument count other than two", location)
    }
    for (const argument of candidate.arguments) validateExpression(argument, language, location)
    return
  }
  if (candidate.kind == "UnaryExpression") {
    if (!Object.hasOwn(unaryOperationSyntax, String(candidate.operation))) {
      unsupportedCapability(language, `unary operation ${String(candidate.operation)}`, location)
    }
    validateExpression(candidate.operand, language, location, candidate.operation == "IntegerNegate")
    validateKnownTargetInteger(candidate, language, location)
    return
  }
  if (candidate.kind == "BinaryExpression") {
    if (!Object.hasOwn(binaryOperationSyntax, String(candidate.operation))) {
      unsupportedCapability(language, `binary operation ${String(candidate.operation)}`, location)
    }
    validateExpression(candidate.left, language, location)
    validateExpression(candidate.right, language, location)
    validateKnownTargetInteger(candidate, language, location)
    return
  }

  unsupportedCapability(language, String(Reflect.get(expression, "kind")), location)
}

/**
 * Rejects compile-time-known Java integer operation results outside primitive int.
 * @param {import("../semantic/types.js").UnaryExpression | import("../semantic/types.js").BinaryExpression} expression - Validated operation shape.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {import("../semantic/types.js").SourceLocation | undefined} location - Operation location.
 * @returns {void}
 */
function validateKnownTargetInteger(expression, language, location) {
  const value = knownIntegerValue(expression)

  if (language == "java" && value !== undefined && (value < -2147483648n || value > 2147483647n)) {
    unsupportedCapability(language, "compile-time-known integer operation outside signed 32-bit int range", location)
  }
  if ((language == "csharp" || language == "go" || language == "c" || language == "cpp" || language == "rust" || language == "swift" || language == "wasm") && value !== undefined &&
    (value < -9223372036854775808n || value > 9223372036854775807n)) {
    const scalar = language == "wasm" ? "i64" : language == "swift" ? "Int64" : "long"

    unsupportedCapability(language, `compile-time-known integer operation outside signed 64-bit ${scalar} range`, location)
  }
  if (language == "kotlin" && value !== undefined &&
    (value < -BigInt(Number.MAX_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER))) {
    unsupportedCapability(language, "compile-time-known integer operation outside the Semantifold safe-integer range", location)
  }
}

/**
 * Evaluates only literal integer-operation trees for bounds validation, never IR folding.
 * @param {import("../semantic/types.js").Expression} expression - Semantic expression.
 * @returns {bigint | undefined} Known mathematical integer.
 */
function knownIntegerValue(expression) {
  if (expression.kind == "IntegerLiteral" && Number.isSafeInteger(expression.value)) return BigInt(expression.value)
  if (expression.kind == "UnaryExpression" && expression.operation == "IntegerNegate") {
    const operand = knownIntegerValue(expression.operand)

    return operand === undefined ? undefined : -operand
  }
  if (expression.kind != "BinaryExpression") return undefined

  const left = knownIntegerValue(expression.left)
  const right = knownIntegerValue(expression.right)

  if (left === undefined || right === undefined) return undefined
  if (expression.operation == "IntegerAdd") return left + right
  if (expression.operation == "IntegerSubtract") return left - right
  if (expression.operation == "IntegerMultiply") return left * right

  return undefined
}

/**
 * Emits a supported expression.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Expression} expression - Semantic expression.
 * @param {string} path - Exact JSON Pointer for this expression occurrence.
 * @param {import("../semantic/types.js").TextBackendLanguage} language - Target language.
 * @param {(name: string) => string} emitIdentifier - Identifier formatter.
 * @returns {void}
 */
export function emitExpression(writer, expression, path, language, emitIdentifier) {
  if (expression.kind == "IdentifierExpression") {
    writer.mapped(emitIdentifier(expression.name), {mappingKind: "exact", node: expression, path, role: "name"})
    return
  }
  if (expression.kind == "IntegerLiteral") {
    const spelling = language == "csharp" || language == "kotlin" ? `${expression.value}L` : String(expression.value)

    writer.mapped(spelling, {mappingKind: "exact", node: expression, path, role: "literal"})
    return
  }
  if (expression.kind == "BooleanLiteral") {
    const spelling = language == "python" ? expression.value ? "True" : "False" : expression.value ? "true" : "false"

    writer.mapped(spelling, {mappingKind: "exact", node: expression, path, role: "literal"})
    return
  }
  if (expression.kind == "StringLiteral") {
    writer.mapped(emitStringLiteral(language, expression.value), {mappingKind: "exact", node: expression, path, role: "literal"})
    return
  }
  if (expression.kind == "CallExpression") {
    writer.mapped(expression.callee, {mappingKind: "exact", node: expression, path, role: "callee"})
    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    expression.arguments.forEach((argument, index) => {
      if (index > 0) writer.synthetic(", ", "argument separator", [expression], [path])
      emitExpression(writer, argument, `${path}/arguments/${index}`, language, emitIdentifier)
    })
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }

  if (expression.kind == "UnaryExpression") {
    if (language == "kotlin" && expression.operation == "IntegerNegate") {
      emitKotlinIntegerHelper(writer, expression, path, "semantifold_integer_negate", [
        [expression.operand, `${path}/operand`]
      ])
      return
    }
    if (language == "csharp" && expression.operation == "IntegerNegate") {
      writer.mapped("checked(", {mappingKind: "anchor", node: expression, path})
      writer.mapped("-", {mappingKind: "exact", node: expression, path, role: "operator"})
      emitExpression(writer, expression.operand, `${path}/operand`, language, emitIdentifier)
      writer.mapped(")", {mappingKind: "anchor", node: expression, path})
      return
    }
    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    writer.mapped(language == "python" && expression.operation == "BooleanNot" ? "not " : unaryOperationSyntax[expression.operation], {
      mappingKind: "exact", node: expression, path, role: "operator"
    })
    emitExpression(writer, expression.operand, `${path}/operand`, language, emitIdentifier)
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }

  if (language == "kotlin" && ["IntegerAdd", "IntegerSubtract", "IntegerMultiply"].includes(expression.operation)) {
    const helper = expression.operation == "IntegerAdd" ? "semantifold_integer_add" :
      expression.operation == "IntegerSubtract" ? "semantifold_integer_subtract" : "semantifold_integer_multiply"

    emitKotlinIntegerHelper(writer, expression, path, helper, [
      [expression.left, `${path}/left`], [expression.right, `${path}/right`]
    ])
    return
  }

  if (language == "csharp" && ["IntegerAdd", "IntegerSubtract", "IntegerMultiply"].includes(expression.operation)) {
    writer.mapped("checked(", {mappingKind: "anchor", node: expression, path})
    emitExpression(writer, expression.left, `${path}/left`, language, emitIdentifier)
    writer.synthetic(" ", "operator spacing", [expression], [path])
    writer.mapped(binaryOperationSpelling(expression.operation, language), {
      mappingKind: "exact", node: expression, path, role: "operator"
    })
    writer.synthetic(" ", "operator spacing", [expression], [path])
    emitExpression(writer, expression.right, `${path}/right`, language, emitIdentifier)
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }

  if (language == "java" && (expression.operation == "StringEqual" || expression.operation == "StringNotEqual")) {
    const compositeOperator = expression.operation == "StringNotEqual" && writer.hasRange(expression, path, "equalityOperator")

    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    if (expression.operation == "StringNotEqual") {
      writer.mapped("!", {mappingKind: "exact", node: expression, path, role: "operator"})
    }
    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    emitExpression(writer, expression.left, `${path}/left`, language, emitIdentifier)
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    writer.mapped(".equals", {
      mappingKind: "exact", node: expression, path, role: compositeOperator ? "equalityOperator" : "operator"
    })
    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    emitExpression(writer, expression.right, `${path}/right`, language, emitIdentifier)
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }

  if (language == "swift" && (expression.operation == "StringEqual" || expression.operation == "StringNotEqual")) {
    writer.mapped(expression.operation == "StringEqual" ? "semantifold_string_equal" : "semantifold_string_not_equal", {
      mappingKind: "exact", node: expression, path, role: "operator"
    })
    writer.synthetic("(", "Swift scalar-equality helper call", [expression], [path])
    emitExpression(writer, expression.left, `${path}/left`, language, emitIdentifier)
    writer.synthetic(", ", "Swift scalar-equality argument separator", [expression], [path])
    emitExpression(writer, expression.right, `${path}/right`, language, emitIdentifier)
    writer.synthetic(")", "Swift scalar-equality helper call", [expression], [path])
    return
  }

  writer.mapped("(", {mappingKind: "anchor", node: expression, path})
  emitExpression(writer, expression.left, `${path}/left`, language, emitIdentifier)
  writer.synthetic(" ", "operator spacing", [expression], [path])
  const spelling = binaryOperationSpelling(expression.operation, language)

  if (expression.operation == "StringNotEqual" && writer.hasRange(expression, path, "equalityOperator")) {
    writer.mapped(spelling.slice(0, 1), {mappingKind: "exact", node: expression, path, role: "operator"})
    writer.mapped(spelling.slice(1), {mappingKind: "exact", node: expression, path, role: "equalityOperator"})
  } else writer.mapped(spelling, {mappingKind: "exact", node: expression, path, role: "operator"})
  writer.synthetic(" ", "operator spacing", [expression], [path])
  emitExpression(writer, expression.right, `${path}/right`, language, emitIdentifier)
  writer.mapped(")", {mappingKind: "anchor", node: expression, path})
}

/**
 * Emits a Kotlin checked-integer helper while preserving the semantic operator range.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").UnaryExpression | import("../semantic/types.js").BinaryExpression} expression - Operation.
 * @param {string} path - Operation path.
 * @param {string} helper - Exact target helper.
 * @param {[import("../semantic/types.js").Expression, string][]} operands - Ordered operands and paths.
 */
function emitKotlinIntegerHelper(writer, expression, path, helper, operands) {
  writer.mapped(helper, {mappingKind: "exact", node: expression, path, role: "operator"})
  writer.synthetic("(", "Kotlin checked-integer helper call", [expression], [path])
  operands.forEach(([operand, operandPath], index) => {
    if (index) writer.synthetic(", ", "Kotlin checked-integer argument separator", [expression], [path])
    emitExpression(writer, operand, operandPath, "kotlin", identityIdentifier)
  })
  writer.synthetic(")", "Kotlin checked-integer helper call", [expression], [path])
}

/**
 * Preserves a Kotlin identifier spelling.
 * @param {string} name - Identifier spelling.
 * @returns {string} Unchanged spelling.
 */
function identityIdentifier(name) {
  return name
}

/**
 * Reports whether JavaScript-family execution can create IEEE-754 signed zero.
 * Semantifold integers have one mathematical zero, so those targets canonicalize
 * their observable scalar output without changing the operation tree.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated semantic module.
 * @returns {boolean} Whether canonical output rendering is required.
 */
export function requiresCanonicalZeroRendering(module) {
  return module.functions.some((declaration) => blockContainsSignProducingOperation(declaration.body)) ||
    blockContainsSignProducingOperation(module.entryPoint.body)
}

/**
 * Checks one block for sign-producing integer operations.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @returns {boolean} Whether a nested expression can produce signed zero in JavaScript.
 */
function blockContainsSignProducingOperation(block) {
  return block.statements.some((statement) => {
    if (statement.kind == "IfStatement") {
      return expressionContainsSignProducingOperation(statement.condition) ||
        blockContainsSignProducingOperation(statement.consequent) ||
        Boolean(statement.alternate && blockContainsSignProducingOperation(statement.alternate))
    }
    if (statement.kind == "LocalDeclaration") return expressionContainsSignProducingOperation(statement.initializer)
    if (statement.kind == "AssignmentStatement" || statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") {
      return expressionContainsSignProducingOperation(statement.expression)
    }
    if (statement.kind == "ReturnStatement") {
      return Boolean(statement.expression && expressionContainsSignProducingOperation(statement.expression))
    }

    return false
  })
}

/**
 * Checks one expression tree for sign-producing integer operations.
 * @param {import("../semantic/types.js").Expression} expression - Semantic expression.
 * @returns {boolean} Whether this tree contains integer negation or multiplication.
 */
function expressionContainsSignProducingOperation(expression) {
  if (expression.kind == "UnaryExpression") {
    return expression.operation == "IntegerNegate" || expressionContainsSignProducingOperation(expression.operand)
  }
  if (expression.kind == "BinaryExpression") {
    return expression.operation == "IntegerMultiply" || expressionContainsSignProducingOperation(expression.left) ||
      expressionContainsSignProducingOperation(expression.right)
  }
  if (expression.kind == "CallExpression") {
    return expression.arguments.some((argument) => expressionContainsSignProducingOperation(argument))
  }

  return false
}

/**
 * Maps one already validated semantic operation to target syntax.
 * @param {import("../semantic/types.js").SemanticBinaryOperation} operation - Closed semantic operation.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @returns {string} Target operator spelling.
 */
function binaryOperationSpelling(operation, language) {
  const syntax = binaryOperationSyntax[operation]

  if (language == "php" && syntax.php) return syntax.php
  if (language == "python" && syntax.python) return syntax.python
  if ((language == "php" || language == "javascript" || language == "typescript") && syntax.strict) return syntax.strict

  return syntax.default
}
