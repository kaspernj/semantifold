// @ts-check

import {semanticFailure, unsupportedCapability, unsupportedSyntax} from "../diagnostic.js"
import {hasOnlyUnicodeScalars, isFunctionReturnTypeName, isScalarTypeName} from "./scalars.js"
import {adaptedOperationFor} from "./operators.js"
import {parserRangeFor} from "./provenance.js"

const task005Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])

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
  validateModuleShape(module, language, (detail, location) => unsupportedSyntax(language, detail, location))
  validateModuleTypes(module, (code, detail, location) => semanticFailure(language, code, detail, location), true)

  return module
}

/**
 * Validates scalar types and bindings for a caller-supplied semantic module before emission.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").BackendLanguage} language - Backend language or binary target.
 * @returns {void}
 */
export function validateBackendTypes(module, language) {
  validateModuleTypes(module, (_code, detail, location) => unsupportedCapability(language, detail, location), false)
}

/**
 * Checks parser-authored block and statement layouts before semantic validation.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Source language.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Shape failure.
 * @returns {void}
 */
function validateModuleShape(module, language, fail) {
  for (const functionDeclaration of module.functions) {
    if (!task005Languages.has(language) && functionDeclaration.parameters.length != 2) {
      fail("function parameter count other than two", functionDeclaration.location)
    }

    validateBlockShape(functionDeclaration.body, "function body", fail)
  }

  validateBlockShape(module.entryPoint.body, "entry point", fail)
}

/**
 * Checks one recursively nested semantic block produced by a frontend.
 * @param {import("./types.js").Block} block - Semantic block.
 * @param {string} detail - Diagnostic detail.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Shape failure.
 * @returns {void}
 */
function validateBlockShape(block, detail, fail) {
  if (!block || block.kind != "Block" || !Array.isArray(block.statements)) {
    fail(`${detail} without Block`, block?.location ?? /** @type {never} */ (undefined))
  }

  for (const statement of block.statements) {
    if (!["AssignmentStatement", "ExpressionStatement", "IfStatement", "LocalDeclaration", "PrintStatement", "ReturnStatement"].includes(statement.kind)) {
      fail(`${detail} statement ${statement.kind}`, statement.location)
    }
    if (statement.kind == "IfStatement") {
      validateBlockShape(statement.consequent, "if consequent", fail)
      if (statement.alternate) validateBlockShape(statement.alternate, "if alternate", fail)
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
  const declarationIds = new Set()

  for (const [index, functionDeclaration] of module.functions.entries()) {
    if (normalizeOperations) functionDeclaration.id = `function:${index}`
    if (typeof functionDeclaration.id != "string" || !/^function:[0-9]+$/u.test(functionDeclaration.id) ||
      declarationIds.has(functionDeclaration.id)) {
      fail("DUPLICATE_BINDING", "Duplicate or invalid function declaration identity.", functionDeclaration.location)
    }
    if (functions.has(functionDeclaration.name)) {
      fail("DUPLICATE_BINDING", `duplicate function '${functionDeclaration.name}'.`, roleLocation(functionDeclaration, "name"))
    }
    declarationIds.add(functionDeclaration.id)
    functions.set(functionDeclaration.name, functionDeclaration)
  }

  for (const functionDeclaration of module.functions) validateFunction(functionDeclaration, functions, fail, normalizeOperations)

  const callableNames = new Set(functions.keys())

  const entryScope = createScope(undefined, module.entryPoint.body.statements, callableNames)

  validateBlock(module.entryPoint.body, entryScope, undefined, functions, fail, normalizeOperations)
}

/**
 * Validates one non-void function and its complete control flow.
 * @param {import("./types.js").FunctionDeclaration} declaration - Function declaration.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {void}
 */
function validateFunction(declaration, functions, fail, normalizeOperations) {
  const scope = createScope(undefined, declaration.body.statements, new Set(functions.keys()))

  for (const parameter of declaration.parameters) {
    const type = validateValueTypeReference(parameter.type, parameter.location, fail)

    declareBinding(parameter.name, {mutable: false, type}, parameter.location, scope, fail)
  }

  const returnType = validateReturnTypeReference(declaration.returnType, declaration.location, fail)
  const returns = validateBlock(declaration.body, scope, returnType, functions, fail, normalizeOperations)

  if (returnType != "void" && !returns) {
    fail("MISSING_RETURN", `Function '${declaration.name}' does not return on every reachable path.`, declaration.location)
  }
}

/**
 * Validates one ordered block and reports whether every path returns.
 * @param {import("./types.js").Block} block - Semantic block.
 * @param {Scope} scope - Scope belonging to this block.
 * @param {import("./types.js").FunctionReturnTypeName | undefined} returnType - Function return type, absent for entry points.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {boolean} Whether every path through the block returns.
 */
function validateBlock(block, scope, returnType, functions, fail, normalizeOperations) {
  let alwaysReturns = false

  for (const statement of block.statements) {
    if (alwaysReturns) fail("UNREACHABLE_STATEMENT", "Statement is unreachable.", statement.location)

    if (statement.kind == "LocalDeclaration") {
      const declaredType = validateValueTypeReference(statement.type, statement.location, fail)
      const initializerType = inferValueExpressionType(statement.initializer, scope, functions, fail, normalizeOperations, "an initializer")

      scope.pending.delete(statement.name)
      if (initializerType != declaredType) {
        fail("TYPE_MISMATCH", `Initializer type ${initializerType}; expected ${declaredType}.`, statement.initializer.location)
      }
      declareBinding(statement.name, {mutable: statement.mutable, type: declaredType}, statement.location, scope, fail)
      continue
    }
    if (statement.kind == "AssignmentStatement") {
      const expressionType = inferValueExpressionType(statement.expression, scope, functions, fail, normalizeOperations, "an assignment")
      const binding = resolveBinding(statement.target.name, statement.target.location, scope, fail)

      if (!binding.mutable) {
        fail("IMMUTABLE_ASSIGNMENT", `Cannot assign to immutable binding '${statement.target.name}'.`, statement.target.location)
      }
      if (expressionType != binding.type) {
        fail("TYPE_MISMATCH", `Assignment type ${expressionType}; expected ${binding.type}.`, statement.expression.location)
      }
      continue
    }
    if (statement.kind == "PrintStatement") {
      inferValueExpressionType(statement.expression, scope, functions, fail, normalizeOperations, "a print value")
      continue
    }
    if (statement.kind == "ExpressionStatement") {
      if (!statement.expression || statement.expression.kind != "CallExpression") {
        fail("TYPE_MISMATCH", "Expression statement must contain a direct call.", statement.location)
      }
      const expressionType = inferExpressionType(statement.expression, scope, functions, fail, normalizeOperations)

      if (expressionType != "void") {
        fail("TYPE_MISMATCH", "Expression statements may contain only void calls.", statement.expression.location)
      }
      continue
    }
    if (statement.kind == "ReturnStatement") {
      if (!returnType) fail("ILLEGAL_RETURN_CONTEXT", "Return statement outside a function.", statement.location)
      if (returnType == "void") {
        if (statement.expression) {
          fail("VOID_RETURN_VALUE", "Void function cannot return a value.", statement.expression.location)
        }
      } else {
        if (!statement.expression) fail("MISSING_RETURN_VALUE", `Function return requires a ${returnType} value.`, statement.location)
        const actualType = inferValueExpressionType(
          statement.expression,
          scope,
          functions,
          fail,
          normalizeOperations,
          "a returned value"
        )

        if (actualType != returnType) {
          fail("TYPE_MISMATCH", `Return type ${actualType}; expected ${returnType}.`, statement.expression.location)
        }
      }
      alwaysReturns = true
      continue
    }
    if (statement.kind == "IfStatement") {
      const conditionType = inferValueExpressionType(statement.condition, scope, functions, fail, normalizeOperations, "a condition")

      if (conditionType != "boolean") {
        fail("NON_BOOLEAN_CONDITION", `If condition type ${conditionType}; expected boolean.`, statement.condition.location)
      }
      const consequentScope = createScope(scope, statement.consequent.statements)
      const consequentReturns = validateBlock(statement.consequent, consequentScope, returnType, functions, fail, normalizeOperations)
      let alternateReturns = false

      if (statement.alternate) {
        const alternateScope = createScope(scope, statement.alternate.statements)

        alternateReturns = validateBlock(statement.alternate, alternateScope, returnType, functions, fail, normalizeOperations)
      }
      alwaysReturns = consequentReturns && alternateReturns
      continue
    }

    const unexpected = /** @type {{kind: string, location: import("./types.js").SourceLocation}} */ (statement)

    fail("UNSUPPORTED_STATEMENT", unexpected.kind, unexpected.location)
  }

  return alwaysReturns
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
 * Validates one semantic value type reference.
 * @param {unknown} type - Candidate semantic type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticTypeName} Validated scalar name.
 */
function validateValueTypeReference(type, location, fail) {
  const name = validateTypeReference(type, location, fail)

  if (name == "void") return fail("VOID_AS_VALUE", "Void is valid only as a function return type.", typeLocation(type, location))

  return name
}

/**
 * Validates one function return type reference.
 * @param {unknown} type - Candidate semantic return type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").FunctionReturnTypeName} Validated return name.
 */
function validateReturnTypeReference(type, location, fail) {
  return validateTypeReference(type, location, fail)
}

/**
 * Validates one semantic type-reference shape.
 * @param {unknown} type - Candidate semantic type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").FunctionReturnTypeName} Validated type name.
 */
function validateTypeReference(type, location, fail) {
  if (!type || typeof type != "object" || Array.isArray(type)) {
    return fail("TYPE_MISMATCH", "Unsupported scalar type.", location)
  }

  const candidate = /** @type {import("./types.js").TypeReference} */ (type)

  if (candidate.kind != "TypeReference" || !isFunctionReturnTypeName(candidate.name)) {
    fail("TYPE_MISMATCH", "Unsupported scalar or void return type.", typeLocation(candidate, location))
  }

  return candidate.name
}

/**
 * Infers a value expression and rejects the non-value result of a void call.
 * @param {import("./types.js").Expression} expression - Semantic expression.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to normalize frontend intent and call resolution.
 * @param {string} context - Value context for diagnostics.
 * @returns {import("./types.js").SemanticTypeName} Expression value type.
 */
function inferValueExpressionType(expression, scope, functions, fail, normalizeOperations, context) {
  const type = inferExpressionType(expression, scope, functions, fail, normalizeOperations)

  if (type == "void") fail("VOID_AS_VALUE", `Void call cannot be used as ${context}.`, expression.location)

  return type
}

/**
 * Infers and validates one expression.
 * @param {import("./types.js").Expression} expression - Semantic expression.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {import("./types.js").FunctionReturnTypeName} Expression type.
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

    if (!functionDeclaration) {
      return fail("UNRESOLVED_BINDING", `Unknown function '${expression.callee}'.`, roleLocation(expression, "callee"))
    }
    const resolution = signatureFor(functionDeclaration)

    if (normalizeOperations) expression.resolution = resolution
    else validateResolution(expression.resolution, resolution, expression.location, fail)
    if (expression.arguments.length != functionDeclaration.parameters.length) {
      return fail("TYPE_MISMATCH", `Call argument count for '${expression.callee}'.`, expression.location)
    }
    for (let index = 0; index < expression.arguments.length; index++) {
      const argument = expression.arguments[index]
      const actualType = inferValueExpressionType(argument, scope, functions, fail, normalizeOperations, "a call argument")
      const expectedType = validateValueTypeReference(functionDeclaration.parameters[index].type, functionDeclaration.parameters[index].location, fail)

      if (actualType != expectedType) {
        fail("TYPE_MISMATCH", `Call argument type ${actualType}; expected ${expectedType}.`, argument.location)
      }
    }
    return validateReturnTypeReference(functionDeclaration.returnType, functionDeclaration.location, fail)
  }
  if (expression.kind == "UnaryExpression") {
    const operandType = inferValueExpressionType(expression.operand, scope, functions, fail, normalizeOperations, "a unary operand")
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
    const leftType = inferValueExpressionType(expression.left, scope, functions, fail, normalizeOperations, "a binary operand")
    const rightType = inferValueExpressionType(expression.right, scope, functions, fail, normalizeOperations, "a binary operand")
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

/**
 * Builds the exact semantic signature bound to one declaration.
 * @param {import("./types.js").FunctionDeclaration} declaration - Resolved declaration.
 * @returns {import("./types.js").ResolvedFunctionSignature} Detached signature binding.
 */
function signatureFor(declaration) {
  return {
    declarationId: /** @type {string} */ (declaration.id),
    kind: "ResolvedFunctionSignature",
    parameterTypes: declaration.parameters.map((parameter) => /** @type {import("./types.js").SemanticTypeName} */ (parameter.type.name)),
    returnType: declaration.returnType.name
  }
}

/**
 * Validates an externally supplied call binding against the declaration collected for this module.
 * @param {unknown} actual - Candidate call resolution.
 * @param {import("./types.js").ResolvedFunctionSignature} expected - Exact declaration signature.
 * @param {import("./types.js").SourceLocation} location - Call location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {void}
 */
function validateResolution(actual, expected, location, fail) {
  if (!actual || typeof actual != "object" || Array.isArray(actual) ||
    Object.keys(actual).sort().join(",") != "declarationId,kind,parameterTypes,returnType") {
    fail("TYPE_MISMATCH", "Call is missing an exact resolved function signature.", location)
  }
  const candidate = /** @type {import("./types.js").ResolvedFunctionSignature} */ (actual)

  if (candidate.kind != "ResolvedFunctionSignature" || typeof candidate.declarationId != "string" ||
    !Array.isArray(candidate.parameterTypes) ||
    candidate.parameterTypes.some((type) => !isScalarTypeName(type)) ||
    !isFunctionReturnTypeName(candidate.returnType) ||
    candidate.declarationId != expected.declarationId ||
    candidate.returnType != expected.returnType || candidate.parameterTypes.length != expected.parameterTypes.length ||
    candidate.parameterTypes.some((type, index) => type != expected.parameterTypes[index])) {
    fail("TYPE_MISMATCH", "Call resolution does not match its declaration signature.", location)
  }
}

/**
 * Selects an exact semantic token location when parser provenance is available.
 * @param {{location: import("./types.js").SourceLocation, sourceProvenance?: import("./types.js").SemanticNodeSourceProvenance}} node - Located semantic node.
 * @param {string} role - Token role.
 * @returns {import("./types.js").SourceLocation} Exact or owning location.
 */
function roleLocation(node, role) {
  return node.sourceProvenance?.ranges[role] ?? parserRangeFor(node, role) ?? node.location
}

/**
 * Selects the exact type token or the owning declaration location.
 * @param {unknown} type - Candidate type reference.
 * @param {import("./types.js").SourceLocation} ownerLocation - Owning declaration location.
 * @returns {import("./types.js").SourceLocation} Exact type location when known.
 */
function typeLocation(type, ownerLocation) {
  if (!type || typeof type != "object" || Array.isArray(type)) return ownerLocation
  const candidate = /** @type {import("./types.js").TypeReference} */ (type)

  return candidate.sourceProvenance?.ranges.type ?? parserRangeFor(candidate, "type") ?? ownerLocation
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
