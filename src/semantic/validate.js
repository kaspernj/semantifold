// @ts-check

import {unsupportedCapability, unsupportedSyntax} from "../diagnostic.js"
import {hasOnlyUnicodeScalars, isScalarTypeName} from "./scalars.js"

/**
 * Enforces the coherent release-candidate semantic subset after adaptation.
 * @param {import("./types.js").SemanticModule} module - Adapted semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Source language.
 * @returns {import("./types.js").SemanticModule} Validated module.
 */
export function validateParsedModule(module, language) {
  for (const functionDeclaration of module.functions) {
    if (functionDeclaration.parameters.length != 2) {
      unsupportedSyntax(language, "function parameter count other than two", functionDeclaration.location)
    }

    if (functionDeclaration.body.length != 1 || functionDeclaration.body[0].kind != "IfStatement") {
      unsupportedSyntax(language, "function body other than one if/else", functionDeclaration.location)
    }

    const branch = /** @type {import("./types.js").IfStatement} */ (functionDeclaration.body[0])

    if (branch.consequent.length != 1 || branch.alternate.length != 1) {
      unsupportedSyntax(language, "if/else branch without exactly one return", branch.location)
    }
  }

  if (module.entryPoint.body.length != 1) {
    unsupportedSyntax(language, "entry point without exactly one print", module.entryPoint.location)
  }

  validateModuleTypes(module, (detail, location) => unsupportedSyntax(language, detail, location))

  return module
}

/**
 * Validates scalar types for a caller-supplied semantic module before emission.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Backend language.
 * @returns {void}
 */
export function validateBackendTypes(module, language) {
  validateModuleTypes(module, (detail, location) => unsupportedCapability(language, detail, location))
}

/**
 * Validates declarations and infers expression types within the current shape.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Diagnostic callback.
 * @returns {void}
 */
function validateModuleTypes(module, fail) {
  const functions = new Map(module.functions.map((functionDeclaration) => [functionDeclaration.name, functionDeclaration]))

  for (const functionDeclaration of module.functions) {
    /** @type {Map<string, import("./types.js").SemanticTypeName>} */
    const parameters = new Map()

    for (const parameter of functionDeclaration.parameters) {
      parameters.set(parameter.name, validateTypeReference(parameter.type, parameter.location, fail))
    }

    const returnType = validateTypeReference(functionDeclaration.returnType, functionDeclaration.location, fail)
    const branch = /** @type {import("./types.js").IfStatement} */ (functionDeclaration.body[0])
    const conditionType = inferExpressionType(branch.condition, parameters, functions, fail)

    if (conditionType != "boolean") fail(`if condition type ${conditionType}; expected boolean`, branch.condition.location)

    for (const returnStatement of [...branch.consequent, ...branch.alternate]) {
      const actualType = inferExpressionType(returnStatement.expression, parameters, functions, fail)

      if (actualType != returnType) {
        fail(`return type ${actualType}; expected ${returnType}`, returnStatement.expression.location)
      }
    }
  }

  /** @type {Map<string, import("./types.js").SemanticTypeName>} */
  const noParameters = new Map()

  for (const statement of module.entryPoint.body) {
    inferExpressionType(statement.expression, noParameters, functions, fail)
  }
}

/**
 * Validates one semantic type reference.
 * @param {import("./types.js").TypeReference} type - Semantic type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticTypeName} Validated scalar name.
 */
function validateTypeReference(type, location, fail) {
  if (type.kind != "TypeReference" || !isScalarTypeName(type.name)) fail("unsupported scalar type", location)

  return type.name
}

/**
 * Infers and validates one expression in a function or entry-point scope.
 * @param {import("./types.js").Expression} expression - Semantic expression.
 * @param {Map<string, import("./types.js").SemanticTypeName>} parameters - Visible parameters.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {(detail: string, location: import("./types.js").SourceLocation) => never} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticTypeName} Expression type.
 */
function inferExpressionType(expression, parameters, functions, fail) {
  if (expression.kind == "IdentifierExpression") {
    const type = parameters.get(expression.name)

    if (!type) return fail(`unknown identifier '${expression.name}'`, expression.location)

    return type
  }

  if (expression.kind == "IntegerLiteral") {
    if (!Number.isSafeInteger(expression.value)) fail("non-safe integer literal", expression.location)

    return "integer"
  }

  if (expression.kind == "BooleanLiteral") {
    const value = Reflect.get(expression, "value")

    if (typeof value != "boolean") fail("invalid boolean literal value", expression.location)

    return "boolean"
  }

  if (expression.kind == "StringLiteral") {
    const value = Reflect.get(expression, "value")

    if (typeof value != "string" || !hasOnlyUnicodeScalars(value)) {
      fail("invalid Unicode string literal", expression.location)
    }

    return "string"
  }

  if (expression.kind == "CallExpression") {
    const functionDeclaration = functions.get(expression.callee)

    if (!functionDeclaration) return fail(`unknown function '${expression.callee}'`, expression.location)
    if (expression.arguments.length != functionDeclaration.parameters.length) {
      return fail(`call argument count for '${expression.callee}'`, expression.location)
    }

    for (let index = 0; index < expression.arguments.length; index++) {
      const argument = expression.arguments[index]
      const actualType = inferExpressionType(argument, parameters, functions, fail)
      const expectedType = validateTypeReference(functionDeclaration.parameters[index].type, functionDeclaration.parameters[index].location, fail)

      if (actualType != expectedType) {
        fail(`call argument type ${actualType}; expected ${expectedType}`, argument.location)
      }
    }

    return validateTypeReference(functionDeclaration.returnType, functionDeclaration.location, fail)
  }

  if (expression.kind == "BinaryExpression") {
    const leftType = inferExpressionType(expression.left, parameters, functions, fail)
    const rightType = inferExpressionType(expression.right, parameters, functions, fail)

    if (![">", "-", "+"].includes(expression.operator)) {
      return fail(`binary operator ${expression.operator}`, expression.location)
    }
    if (leftType != "integer" || rightType != "integer") {
      return fail(`binary ${expression.operator} requires integer operands`, expression.location)
    }

    return expression.operator == ">" ? "boolean" : "integer"
  }

  const unexpected = /** @type {{kind: string, location: import("./types.js").SourceLocation}} */ (expression)

  return fail(unexpected.kind, unexpected.location)
}
