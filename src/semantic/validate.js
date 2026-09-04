// @ts-check

import {semanticFailure, unsupportedCapability, unsupportedSyntax} from "../diagnostic.js"
import {hasOnlyUnicodeScalars, isScalarTypeName} from "./scalars.js"
import {adaptedOperationFor} from "./operators.js"

/**
 * @typedef Binding
 * @property {boolean} mutable - Whether assignment is allowed.
 * @property {import("./types.js").SemanticTypeName} type - Binding type.
 */

/**
 * @typedef Scope
 * @property {Map<string, Binding>} bindings - Bindings declared directly in this scope.
 * @property {Set<string>} pending - Names declared later in this scope.
 * @property {Scope | undefined} parent - Enclosing lexical scope.
 * @property {Set<string>} usedNames - All names used by the enclosing function or entry point.
 */

/**
 * @typedef SemanticFail
 * @type {(code: string, detail: string, location: import("./types.js").SourceLocation) => never}
 */

/**
 * Enforces the coherent release-candidate semantic subset after adaptation.
 * @param {import("./types.js").SemanticModule} module - Adapted semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Source language.
 * @returns {import("./types.js").SemanticModule} Validated module.
 */
export function validateParsedModule(module, language) {
  validateModuleShape(module, (detail, location) => unsupportedSyntax(language, detail, location))
  validateModuleTypes(module, (code, detail, location) => semanticFailure(language, code, detail, location), true)

  return module
}

/**
 * Validates scalar types and bindings for a caller-supplied semantic module before emission.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
export function validateBackendTypes(module, language) {
  validateModuleTypes(module, (_code, detail, location) => unsupportedCapability(language, detail, location), false)
}

/**
 * Checks the deliberately restricted task-002 statement layouts.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Shape failure.
 * @returns {void}
 */
function validateModuleShape(module, fail) {
  for (const functionDeclaration of module.functions) {
    if (functionDeclaration.parameters.length != 2) {
      fail("function parameter count other than two", functionDeclaration.location)
    }

    validateTerminalSequence(functionDeclaration.body, "IfStatement", "function body", fail)
    const branch = /** @type {import("./types.js").IfStatement} */ (functionDeclaration.body.at(-1))

    validateTerminalSequence(branch.consequent, "ReturnStatement", "if consequent", fail)
    validateTerminalSequence(branch.alternate, "ReturnStatement", "if alternate", fail)
  }

  validateTerminalSequence(module.entryPoint.body, "PrintStatement", "entry point", fail)
}

/**
 * Requires a declaration/assignment prefix followed by one exact terminal statement.
 * @param {import("./types.js").FunctionStatement[] | (import("./types.js").LocalStatement | import("./types.js").PrintStatement)[]} statements - Statements.
 * @param {"IfStatement" | "ReturnStatement" | "PrintStatement"} terminalKind - Required terminal kind.
 * @param {string} detail - Diagnostic detail.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Shape failure.
 * @returns {void}
 */
function validateTerminalSequence(statements, terminalKind, detail, fail) {
  const terminal = statements.at(-1)

  if (!terminal || terminal.kind != terminalKind) {
    fail(`${detail} without terminal ${terminalKind}`, terminal?.location ?? /** @type {never} */ (undefined))
  }

  for (const statement of statements.slice(0, -1)) {
    if (statement.kind != "LocalDeclaration" && statement.kind != "AssignmentStatement") {
      fail(`${detail} statement ${statement.kind}`, statement.location)
    }
  }
}

/**
 * Validates declarations and expression types within lexical scopes.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {void}
 */
function validateModuleTypes(module, fail, normalizeOperations) {
  /** @type {Map<string, import("./types.js").FunctionDeclaration>} */
  const functions = new Map()

  for (const functionDeclaration of module.functions) {
    if (functions.has(functionDeclaration.name)) {
      fail("DUPLICATE_BINDING", `duplicate function '${functionDeclaration.name}'.`, functionDeclaration.location)
    }
    functions.set(functionDeclaration.name, functionDeclaration)
  }

  for (const functionDeclaration of module.functions) validateFunction(functionDeclaration, functions, fail, normalizeOperations)

  const callableNames = new Set(functions.keys())

  const entryScope = createScope(undefined, module.entryPoint.body, callableNames)
  const terminal = validateLocalPrefix(module.entryPoint.body, entryScope, functions, fail, normalizeOperations)

  if (terminal.kind != "PrintStatement") fail("UNSUPPORTED_STATEMENT", terminal.kind, terminal.location)
  inferExpressionType(terminal.expression, entryScope, functions, fail, normalizeOperations)
}

/**
 * Validates one function and its two existing return branches.
 * @param {import("./types.js").FunctionDeclaration} declaration - Function declaration.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {void}
 */
function validateFunction(declaration, functions, fail, normalizeOperations) {
  const scope = createScope(undefined, declaration.body, new Set(functions.keys()))

  for (const parameter of declaration.parameters) {
    const type = validateTypeReference(parameter.type, parameter.location, fail)

    declareBinding(parameter.name, {mutable: false, type}, parameter.location, scope, fail)
  }

  const returnType = validateTypeReference(declaration.returnType, declaration.location, fail)
  const terminal = validateLocalPrefix(declaration.body, scope, functions, fail, normalizeOperations)

  if (terminal.kind != "IfStatement") fail("UNSUPPORTED_STATEMENT", terminal.kind, terminal.location)

  const conditionType = inferExpressionType(terminal.condition, scope, functions, fail, normalizeOperations)

  if (conditionType != "boolean") {
    fail("NON_BOOLEAN_CONDITION", `If condition type ${conditionType}; expected boolean.`, terminal.condition.location)
  }

  validateReturnBranch(terminal.consequent, scope, returnType, functions, fail, normalizeOperations)
  validateReturnBranch(terminal.alternate, scope, returnType, functions, fail, normalizeOperations)
}

/**
 * Validates one restricted branch prefix and terminal return.
 * @param {(import("./types.js").LocalStatement | import("./types.js").ReturnStatement)[]} statements - Branch statements.
 * @param {Scope} parent - Enclosing scope.
 * @param {import("./types.js").SemanticTypeName} returnType - Function return type.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {void}
 */
function validateReturnBranch(statements, parent, returnType, functions, fail, normalizeOperations) {
  const scope = createScope(parent, statements)
  const terminal = validateLocalPrefix(statements, scope, functions, fail, normalizeOperations)

  if (terminal.kind != "ReturnStatement") fail("UNSUPPORTED_STATEMENT", terminal.kind, terminal.location)

  const actualType = inferExpressionType(terminal.expression, scope, functions, fail, normalizeOperations)

  if (actualType != returnType) {
    fail("TYPE_MISMATCH", `Return type ${actualType}; expected ${returnType}.`, terminal.expression.location)
  }
}

/**
 * Creates a lexical scope with declarations marked pending until visited.
 * @param {Scope | undefined} parent - Enclosing scope.
 * @param {{kind: string, name?: string}[]} statements - Scope statements.
 * @param {Set<string>} [reservedNames] - Names unavailable to root bindings.
 * @returns {Scope} Scope.
 */
function createScope(parent, statements, reservedNames = new Set()) {
  const pending = new Set(statements.filter((statement) => statement.kind == "LocalDeclaration")
    .map((statement) => /** @type {{name: string}} */ (statement).name))

  return {bindings: new Map(), parent, pending, usedNames: parent?.usedNames ?? new Set(reservedNames)}
}

/**
 * Validates local declarations and assignments, returning the terminal statement.
 * @template {{kind: string, location: import("./types.js").SourceLocation}} Statement
 * @param {Statement[]} statements - Restricted statement sequence.
 * @param {Scope} scope - Current scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {Statement} Terminal statement.
 */
function validateLocalPrefix(statements, scope, functions, fail, normalizeOperations) {
  for (const statement of statements.slice(0, -1)) {
    if (statement.kind == "LocalDeclaration") {
      const declaration = /** @type {import("./types.js").LocalDeclaration} */ (/** @type {unknown} */ (statement))
      const declaredType = validateTypeReference(declaration.type, declaration.location, fail)
      const initializerType = inferExpressionType(declaration.initializer, scope, functions, fail, normalizeOperations)

      scope.pending.delete(declaration.name)
      if (initializerType != declaredType) {
        fail("TYPE_MISMATCH", `Initializer type ${initializerType}; expected ${declaredType}.`, declaration.initializer.location)
      }
      declareBinding(declaration.name, {mutable: declaration.mutable, type: declaredType}, declaration.location, scope, fail)
      continue
    }

    const assignment = /** @type {import("./types.js").AssignmentStatement} */ (/** @type {unknown} */ (statement))
    const expressionType = inferExpressionType(assignment.expression, scope, functions, fail, normalizeOperations)
    const binding = resolveBinding(assignment.target.name, assignment.target.location, scope, fail)

    if (!binding.mutable) {
      fail("IMMUTABLE_ASSIGNMENT", `Cannot assign to immutable binding '${assignment.target.name}'.`, assignment.target.location)
    }
    if (expressionType != binding.type) {
      fail("TYPE_MISMATCH", `Assignment type ${expressionType}; expected ${binding.type}.`, assignment.expression.location)
    }
  }

  return statements.at(-1) ?? fail("UNSUPPORTED_STATEMENT", "Empty statement sequence.", /** @type {never} */ (undefined))
}

/**
 * Adds one binding while rejecting duplicates and shadowing.
 * @param {string} name - Binding name.
 * @param {Binding} binding - Binding metadata.
 * @param {import("./types.js").SourceLocation} location - Declaration location.
 * @param {Scope} scope - Current scope.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {void}
 */
function declareBinding(name, binding, location, scope, fail) {
  if (scope.usedNames.has(name)) fail("DUPLICATE_BINDING", `Duplicate or shadowed binding '${name}'.`, location)

  scope.bindings.set(name, binding)
  scope.usedNames.add(name)
}

/**
 * Resolves one identifier and distinguishes use-before-declaration.
 * @param {string} name - Binding name.
 * @param {import("./types.js").SourceLocation} location - Reference location.
 * @param {Scope} scope - Current scope.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {Binding} Binding.
 */
function resolveBinding(name, location, scope, fail) {
  for (let current = /** @type {Scope | undefined} */ (scope); current; current = current.parent) {
    const binding = current.bindings.get(name)

    if (binding) return binding
    if (current.pending.has(name)) {
      return fail("USE_BEFORE_DECLARATION", `Binding '${name}' is used before its declaration.`, location)
    }
  }

  return fail("UNRESOLVED_BINDING", `Unknown binding '${name}'.`, location)
}

/**
 * Validates one semantic type reference.
 * @param {unknown} type - Candidate semantic type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticTypeName} Validated scalar name.
 */
function validateTypeReference(type, location, fail) {
  if (!type || typeof type != "object" || Array.isArray(type)) {
    return fail("TYPE_MISMATCH", "Unsupported scalar type.", location)
  }

  const candidate = /** @type {import("./types.js").TypeReference} */ (type)

  if (candidate.kind != "TypeReference" || !isScalarTypeName(candidate.name)) {
    fail("TYPE_MISMATCH", "Unsupported scalar type.", location)
  }

  return candidate.name
}

/**
 * Infers and validates one expression.
 * @param {import("./types.js").Expression} expression - Semantic expression.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {import("./types.js").SemanticTypeName} Expression type.
 */
function inferExpressionType(expression, scope, functions, fail, normalizeOperations) {
  if (expression.kind == "IdentifierExpression") return resolveBinding(expression.name, expression.location, scope, fail).type

  if (expression.kind == "IntegerLiteral") {
    if (!Number.isSafeInteger(expression.value)) fail("TYPE_MISMATCH", "Non-safe integer literal.", expression.location)
    return "integer"
  }
  if (expression.kind == "BooleanLiteral") {
    if (typeof Reflect.get(expression, "value") != "boolean") {
      fail("TYPE_MISMATCH", "Invalid boolean literal value.", expression.location)
    }
    return "boolean"
  }
  if (expression.kind == "StringLiteral") {
    const value = Reflect.get(expression, "value")

    if (typeof value != "string" || !hasOnlyUnicodeScalars(value)) {
      fail("TYPE_MISMATCH", "Invalid Unicode string literal.", expression.location)
    }
    return "string"
  }
  if (expression.kind == "CallExpression") {
    const functionDeclaration = functions.get(expression.callee)

    if (!functionDeclaration) return fail("UNRESOLVED_BINDING", `Unknown function '${expression.callee}'.`, expression.location)
    if (expression.arguments.length != functionDeclaration.parameters.length) {
      return fail("TYPE_MISMATCH", `Call argument count for '${expression.callee}'.`, expression.location)
    }
    for (let index = 0; index < expression.arguments.length; index++) {
      const argument = expression.arguments[index]
      const actualType = inferExpressionType(argument, scope, functions, fail, normalizeOperations)
      const expectedType = validateTypeReference(functionDeclaration.parameters[index].type, functionDeclaration.parameters[index].location, fail)

      if (actualType != expectedType) {
        fail("TYPE_MISMATCH", `Call argument type ${actualType}; expected ${expectedType}.`, argument.location)
      }
    }
    return validateTypeReference(functionDeclaration.returnType, functionDeclaration.location, fail)
  }
  if (expression.kind == "UnaryExpression") {
    const operandType = inferExpressionType(expression.operand, scope, functions, fail, normalizeOperations)
    const operation = normalizeOperations
      ? normalizeUnaryOperation(adaptedOperationFor(expression), operandType, expression.operand.location, fail)
      : expression.operation

    if (normalizeOperations) setNormalizedOperation(expression, operation, unaryOperationSignatures[operation].result)

    const signature = unaryOperationSignatures[operation]

    if (!signature) return fail("TYPE_MISMATCH", `Unknown unary operation ${String(operation)}.`, expression.location)
    if (operandType != signature.operand) {
      return fail("INVALID_OPERAND_TYPE", `${operation} requires ${signature.operand}; received ${operandType}.`, expression.operand.location)
    }
    if (expression.type != signature.result) {
      return fail("TYPE_MISMATCH", `${operation} result type ${String(expression.type)}; expected ${signature.result}.`, expression.location)
    }
    return signature.result
  }
  if (expression.kind == "BinaryExpression") {
    const leftType = inferExpressionType(expression.left, scope, functions, fail, normalizeOperations)
    const rightType = inferExpressionType(expression.right, scope, functions, fail, normalizeOperations)
    const operation = normalizeOperations
      ? normalizeBinaryOperation(adaptedOperationFor(expression), leftType, rightType, expression.left.location, expression.right.location, expression.location, fail)
      : expression.operation

    if (normalizeOperations) setNormalizedOperation(expression, operation, binaryOperationSignatures[operation].result)

    const signature = binaryOperationSignatures[operation]

    if (!signature) return fail("TYPE_MISMATCH", `Unknown binary operation ${String(operation)}.`, expression.location)
    if (leftType != signature.left) {
      return fail("INVALID_OPERAND_TYPE", `${operation} requires ${signature.left} left operand; received ${leftType}.`, expression.left.location)
    }
    if (rightType != signature.right) {
      return fail("INVALID_OPERAND_TYPE", `${operation} requires ${signature.right} right operand; received ${rightType}.`, expression.right.location)
    }
    if (expression.type != signature.result) {
      return fail("TYPE_MISMATCH", `${operation} result type ${String(expression.type)}; expected ${signature.result}.`, expression.location)
    }
    return signature.result
  }

  const unexpected = /** @type {{kind: string, location: import("./types.js").SourceLocation}} */ (expression)

  return fail("TYPE_MISMATCH", unexpected.kind, unexpected.location)
}

/** @type {Readonly<Record<import("./types.js").SemanticUnaryOperation, {operand: import("./types.js").SemanticTypeName, result: import("./types.js").SemanticTypeName}>>} */
const unaryOperationSignatures = Object.freeze({
  BooleanNot: Object.freeze({operand: "boolean", result: "boolean"}),
  IntegerNegate: Object.freeze({operand: "integer", result: "integer"})
})

/** @type {Readonly<Record<import("./types.js").SemanticBinaryOperation, {left: import("./types.js").SemanticTypeName, right: import("./types.js").SemanticTypeName, result: import("./types.js").SemanticTypeName}>>} */
const binaryOperationSignatures = Object.freeze({
  BooleanAnd: Object.freeze({left: "boolean", result: "boolean", right: "boolean"}),
  BooleanEqual: Object.freeze({left: "boolean", result: "boolean", right: "boolean"}),
  BooleanNotEqual: Object.freeze({left: "boolean", result: "boolean", right: "boolean"}),
  BooleanOr: Object.freeze({left: "boolean", result: "boolean", right: "boolean"}),
  IntegerAdd: Object.freeze({left: "integer", result: "integer", right: "integer"}),
  IntegerEqual: Object.freeze({left: "integer", result: "boolean", right: "integer"}),
  IntegerGreaterThan: Object.freeze({left: "integer", result: "boolean", right: "integer"}),
  IntegerGreaterThanOrEqual: Object.freeze({left: "integer", result: "boolean", right: "integer"}),
  IntegerLessThan: Object.freeze({left: "integer", result: "boolean", right: "integer"}),
  IntegerLessThanOrEqual: Object.freeze({left: "integer", result: "boolean", right: "integer"}),
  IntegerMultiply: Object.freeze({left: "integer", result: "integer", right: "integer"}),
  IntegerNotEqual: Object.freeze({left: "integer", result: "boolean", right: "integer"}),
  IntegerSubtract: Object.freeze({left: "integer", result: "integer", right: "integer"}),
  StringConcat: Object.freeze({left: "string", result: "string", right: "string"}),
  StringEqual: Object.freeze({left: "string", result: "boolean", right: "string"}),
  StringNotEqual: Object.freeze({left: "string", result: "boolean", right: "string"})
})

/**
 * Selects one typed unary meaning from parser-normalized source intent.
 * @param {unknown} sourceOperation - Transient frontend operation.
 * @param {import("./types.js").SemanticTypeName} operandType - Resolved operand type.
 * @param {import("./types.js").SourceLocation} location - Operand location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticUnaryOperation} Semantic operation.
 */
function normalizeUnaryOperation(sourceOperation, operandType, location, fail) {
  if (sourceOperation == "Negate") {
    if (operandType != "integer") fail("INVALID_OPERAND_TYPE", `Integer negation requires integer; received ${operandType}.`, location)
    return "IntegerNegate"
  }
  if (sourceOperation == "Not") {
    if (operandType != "boolean") fail("INVALID_OPERAND_TYPE", `Boolean not requires boolean; received ${operandType}.`, location)
    return "BooleanNot"
  }

  return fail("TYPE_MISMATCH", `Unknown unary source operation ${String(sourceOperation)}.`, location)
}

/**
 * Selects one typed binary meaning from parser-normalized source intent.
 * @param {unknown} sourceOperation - Transient frontend operation.
 * @param {import("./types.js").SemanticTypeName} leftType - Resolved left type.
 * @param {import("./types.js").SemanticTypeName} rightType - Resolved right type.
 * @param {import("./types.js").SourceLocation} leftLocation - Left operand location.
 * @param {import("./types.js").SourceLocation} rightLocation - Right operand location.
 * @param {import("./types.js").SourceLocation} expressionLocation - Whole operation location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticBinaryOperation} Semantic operation.
 */
function normalizeBinaryOperation(sourceOperation, leftType, rightType, leftLocation, rightLocation, expressionLocation, fail) {
  if (sourceOperation == "PhpAdd") {
    if (leftType == "string" && rightType == "string") {
      return fail("UNSUPPORTED_SYNTAX", "PHP binary + does not concatenate strings; use . instead.", expressionLocation)
    }

    sourceOperation = "Add"
  }

  if (sourceOperation == "StringConcat") {
    if (leftType != "string") fail("INVALID_OPERAND_TYPE", `String concatenation requires string; received ${leftType}.`, leftLocation)
    if (rightType != "string") fail("INVALID_OPERAND_TYPE", `String concatenation requires string; received ${rightType}.`, rightLocation)
    return "StringConcat"
  }

  if (sourceOperation == "Add") {
    if (leftType == "integer" && rightType == "integer") return "IntegerAdd"
    if (leftType == "string" && rightType == "string") return "StringConcat"

    const location = leftType == "integer" || leftType == "string" ? rightLocation : leftLocation

    return fail("INVALID_OPERAND_TYPE", `Addition requires two integers or two strings; received ${leftType} and ${rightType}.`, location)
  }

  const fixedOperations = /** @type {const} */ ({
    And: ["boolean", "BooleanAnd"],
    GreaterThan: ["integer", "IntegerGreaterThan"],
    GreaterThanOrEqual: ["integer", "IntegerGreaterThanOrEqual"],
    LessThan: ["integer", "IntegerLessThan"],
    LessThanOrEqual: ["integer", "IntegerLessThanOrEqual"],
    Multiply: ["integer", "IntegerMultiply"],
    Or: ["boolean", "BooleanOr"],
    Subtract: ["integer", "IntegerSubtract"]
  })
  const fixed = Reflect.get(fixedOperations, String(sourceOperation))

  if (fixed) {
    const [requiredType, operation] = fixed

    if (leftType != requiredType) fail("INVALID_OPERAND_TYPE", `${String(sourceOperation)} requires ${requiredType}; received ${leftType}.`, leftLocation)
    if (rightType != requiredType) fail("INVALID_OPERAND_TYPE", `${String(sourceOperation)} requires ${requiredType}; received ${rightType}.`, rightLocation)

    return /** @type {import("./types.js").SemanticBinaryOperation} */ (operation)
  }

  if (sourceOperation == "JavaEqual" || sourceOperation == "JavaNotEqual") {
    if (leftType == "string" || rightType == "string") {
      return fail("UNSUPPORTED_SYNTAX", "Java reference equality is outside the implemented semantic subset.", expressionLocation)
    }

    sourceOperation = sourceOperation == "JavaEqual" ? "Equal" : "NotEqual"
  }

  if (sourceOperation == "StringEqual" || sourceOperation == "StringNotEqual") {
    if (leftType != "string") fail("INVALID_OPERAND_TYPE", `String equality requires string; received ${leftType}.`, leftLocation)
    if (rightType != "string") fail("INVALID_OPERAND_TYPE", `String equality requires string; received ${rightType}.`, rightLocation)

    return /** @type {"StringEqual" | "StringNotEqual"} */ (sourceOperation)
  }

  if (sourceOperation == "Equal" || sourceOperation == "NotEqual") {
    if (leftType != rightType) {
      return fail("MISMATCHED_EQUALITY_TYPES", `Equality requires matching scalar types; received ${leftType} and ${rightType}.`, rightLocation)
    }

    const prefix = leftType == "integer" ? "Integer" : leftType == "boolean" ? "Boolean" : "String"

    return /** @type {import("./types.js").SemanticBinaryOperation} */ (`${prefix}${sourceOperation}`)
  }

  return fail("TYPE_MISMATCH", `Unknown binary source operation ${String(sourceOperation)}.`, leftLocation)
}

/**
 * Replaces transient frontend intent with the public typed operation fields.
 * @param {object} expression - Mutable adapted expression.
 * @param {import("./types.js").SemanticUnaryOperation | import("./types.js").SemanticBinaryOperation} operation - Typed operation.
 * @param {import("./types.js").SemanticTypeName} type - Explicit result type.
 * @returns {void}
 */
function setNormalizedOperation(expression, operation, type) {
  Reflect.set(expression, "operation", operation)
  Reflect.set(expression, "type", type)
}
