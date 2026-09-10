// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {isDenseArray} from "../array.js"
import {validateBackendTypes} from "../semantic/validate.js"
import {validateTargetBindingIdentifier, validateTargetIdentifier} from "./identifiers.js"
import {emitScalarType, emitStringLiteral} from "./scalars.js"

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
const task006Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const javaObjectInstanceMethodSignatures = new Set([
  "clone()", "equals(Object)", "finalize()", "getClass()", "hashCode()", "notify()", "notifyAll()", "toString()",
  "wait()", "wait(long)", "wait(long,int)"
])

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
  if (!task006Languages.has(language)) rejectCollectionTypes(module, language)
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
    if (!task005Languages.has(language) && functionDeclaration.returnType?.kind == "TypeReference" &&
      functionDeclaration.returnType.name == "void") {
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
 * Rejects Task 006 types before a registered non-cohort emitter can allocate an artifact.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target identity.
 * @returns {void}
 */
function rejectCollectionTypes(module, language) {
  for (const declaration of module.functions) {
    if (!declaration || typeof declaration != "object" || Array.isArray(declaration)) continue
    const location = Reflect.get(declaration, "location") ?? module.location
    const returnType = Reflect.get(declaration, "returnType")

    if (isCollectionType(returnType)) {
      unsupportedCapability(language, "Task 006 immutable collection return type", location)
    }
    const parameters = Reflect.get(declaration, "parameters")

    for (const parameter of Array.isArray(parameters) ? parameters : []) {
      if (isCollectionType(parameter?.type)) unsupportedCapability(language, "Task 006 immutable collection parameter type", parameter.location ?? location)
    }
    rejectBlockCollectionTypes(Reflect.get(declaration, "body"), language)
  }
  rejectBlockCollectionTypes(module.entryPoint.body, language)
}

/**
 * Rejects collection local types recursively in one block.
 * @param {unknown} block - Candidate semantic block.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target identity.
 * @returns {void}
 */
function rejectBlockCollectionTypes(block, language) {
  if (!block || typeof block != "object" || Array.isArray(block) || !Array.isArray(Reflect.get(block, "statements"))) return
  for (const statement of Reflect.get(block, "statements")) {
    if (!statement || typeof statement != "object" || Array.isArray(statement)) continue
    if (statement.kind == "LocalDeclaration" && isCollectionType(statement.type)) {
      unsupportedCapability(language, "Task 006 immutable collection local type", statement.location)
    }
    if (statement.kind == "IfStatement") {
      rejectBlockCollectionTypes(statement.consequent, language)
      if (statement.alternate) rejectBlockCollectionTypes(statement.alternate, language)
    }
  }
}

/**
 * Checks a possible recursive collection type without traversing malformed children.
 * @param {unknown} type - Candidate type.
 * @returns {boolean} Whether the outer type is a collection.
 */
function isCollectionType(type) {
  return Boolean(type && typeof type == "object" && !Array.isArray(type) &&
    (Reflect.get(type, "kind") == "ListType" || Reflect.get(type, "kind") == "MapType"))
}

/**
 * Rejects semantic names that would capture syntax owned by one backend emitter.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @returns {void}
 */
function validateScaffoldingNames(module, language) {
  const needsNativeMap = ["javascript", "typescript"].includes(language) && moduleContainsExpressionKind(module, "MapLiteral")
  const needsPhpCount = language == "php" && moduleContainsExpressionKind(module, "CollectionSizeExpression")
  const javascriptOwnedNames = new Set(["console", ...(needsNativeMap ? ["Map"] : [])])
  const ownedEntryNames = language == "go" ? new Set(["fmt", "int64", "bool", "string", "true", "false"]) :
    language == "csharp" ? new Set(["System"]) : language == "java" ? new Set(["args", "System"]) :
    ["javascript", "typescript"].includes(language) ? javascriptOwnedNames : new Set()
  const ownedPrintReceiverNames = language == "go" ? new Set(["fmt", "int64", "bool", "string", "true", "false"]) :
    language == "csharp" || language == "java" ? new Set(["System"]) :
    ["javascript", "typescript"].includes(language) ? javascriptOwnedNames : new Set()
  const ownedCallableNames = language == "go" ? new Set(["main", "init", "fmt", "int64", "bool", "string", "true", "false"]) :
    language == "csharp" ? new Set([
    "Equals", "Finalize", "GetHashCode", "GetType", "Main", "MemberwiseClone", "Program", "ReferenceEquals", "System", "ToString"
  ]) :
    language == "java" ? new Set(["main"]) :
    ["javascript", "typescript"].includes(language) ? javascriptOwnedNames :
    needsPhpCount ? new Set(["count"]) :
    language == "ruby" ? new Set(["puts", "send", "public_send", "__send__"]) : new Set()

  for (const statement of allStatements(module.entryPoint.body)) {
    if (statement.kind == "LocalDeclaration" && ownedEntryNames.has(statement.name)) {
      unsupportedCapability(language, `entry local '${statement.name}' captures backend scaffolding`, statement.location)
    }
  }
  for (const declaration of module.functions) {
    const targetName = language == "php" ? declaration.name.toLowerCase() : declaration.name

    if (ownedCallableNames.has(targetName)) {
      unsupportedCapability(language, `function '${declaration.name}' captures backend scaffolding`, declarationNameLocation(declaration))
    }
    if (language == "java") {
      const signature = emittedJavaFunctionSignature(declaration)

      if (signature && javaObjectInstanceMethodSignatures.has(signature)) {
        unsupportedCapability(
          language,
          `function '${signature}' conflicts with an inherited java.lang.Object instance method`,
          declarationNameLocation(declaration)
        )
      }
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
  if (language == "java") validateJavaUtilFactoryNames(module)
}

/**
 * Rejects lexical bindings that would capture Java's package qualifier in emitted collection factories.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated semantic module.
 * @returns {void}
 */
function validateJavaUtilFactoryNames(module) {
  /**
   * Walks one lexical block while retaining only a currently visible capture.
   * @param {import("../semantic/types.js").Block} block - Block to inspect in semantic order.
   * @param {{detail: string, location: import("../semantic/types.js").SourceLocation} | undefined} inherited - Visible capture.
   * @param {"entry" | "function"} owner - Owning scope kind.
   * @returns {void}
   */
  const validateBlockNames = (block, inherited, owner) => {
    let capture = inherited

    for (const statement of block.statements) {
      if (statement.kind == "LocalDeclaration" && statement.name == "java") {
        capture = {
          detail: `${owner} local 'java' captures java.util factory syntax`,
          location: statement.location
        }
      }
      const expression = statement.kind == "IfStatement" ? statement.condition :
        statement.kind == "LocalDeclaration" ? statement.initializer :
          statement.kind == "AssignmentStatement" ? statement.expression :
            statement.kind == "ReturnStatement" ? statement.expression : statement.expression

      if (capture && expression && (expressionContainsKind(expression, "ListLiteral") ||
        expressionContainsKind(expression, "MapLiteral"))) {
        unsupportedCapability("java", capture.detail, capture.location)
      }
      if (statement.kind == "IfStatement") {
        validateBlockNames(statement.consequent, capture, owner)
        if (statement.alternate) validateBlockNames(statement.alternate, capture, owner)
      }
    }
  }

  validateBlockNames(module.entryPoint.body, undefined, "entry")
  for (const declaration of module.functions) {
    const parameter = declaration.parameters.find(({name}) => name == "java")
    const capture = parameter ? {
      detail: "function parameter 'java' captures java.util factory syntax",
      location: parameter.location
    } : undefined

    validateBlockNames(declaration.body, capture, "function")
  }
}

/**
 * Reports whether a module contains an expression kind that requires target runtime scaffolding.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated-shape semantic module.
 * @param {import("../semantic/types.js").Expression["kind"]} kind - Sought expression kind.
 * @returns {boolean} Whether the kind occurs.
 */
function moduleContainsExpressionKind(module, kind) {
  return [module.entryPoint.body, ...module.functions.map((declaration) => declaration.body)].some((block) =>
    allStatements(block).some((statement) => {
      const expression = statement.kind == "IfStatement" ? statement.condition :
        statement.kind == "LocalDeclaration" ? statement.initializer :
          statement.kind == "AssignmentStatement" ? statement.expression :
            statement.kind == "ReturnStatement" ? statement.expression : statement.expression

      return expression ? expressionContainsKind(expression, kind) : false
    }))
}

/**
 * Searches one validated expression tree for a semantic kind.
 * @param {import("../semantic/types.js").Expression} expression - Expression root.
 * @param {import("../semantic/types.js").Expression["kind"]} kind - Sought kind.
 * @returns {boolean} Whether the kind occurs.
 */
function expressionContainsKind(expression, kind) {
  if (expression.kind == kind) return true
  if (expression.kind == "UnaryExpression") return expressionContainsKind(expression.operand, kind)
  if (expression.kind == "BinaryExpression") {
    return expressionContainsKind(expression.left, kind) || expressionContainsKind(expression.right, kind)
  }
  if (expression.kind == "CallExpression") return expression.arguments.some((argument) => expressionContainsKind(argument, kind))
  if (expression.kind == "ListLiteral") return expression.elements.some((element) => expressionContainsKind(element, kind))
  if (expression.kind == "MapLiteral") {
    return expression.entries.some((entry) => expressionContainsKind(entry.key, kind) || expressionContainsKind(entry.value, kind))
  }
  if (expression.kind == "ListIndexExpression") {
    return expressionContainsKind(expression.collection, kind) || expressionContainsKind(expression.index, kind)
  }
  if (expression.kind == "MapLookupExpression") {
    return expressionContainsKind(expression.collection, kind) || expressionContainsKind(expression.key, kind)
  }
  if (expression.kind == "CollectionSizeExpression") return expressionContainsKind(expression.collection, kind)

  return false
}

/**
 * Returns a parser-backed function-name location when one survived semantic adaptation.
 * @param {import("../semantic/types.js").FunctionDeclaration} declaration - Semantic function declaration.
 * @returns {import("../semantic/types.js").SourceLocation} Exact name or declaration location.
 */
function declarationNameLocation(declaration) {
  return declaration.sourceProvenance?.ranges.name ?? declaration.location
}

/**
 * Builds the Java method signature used for inherited-instance collision checks.
 * @param {import("../semantic/types.js").FunctionDeclaration} declaration - Candidate Java target function.
 * @returns {string | undefined} Emitted name and parameter types when all types are supported.
 */
function emittedJavaFunctionSignature(declaration) {
  const parameterTypes = []

  for (const parameter of declaration.parameters) {
    const type = parameter.type

    if (!type || typeof type != "object" || Array.isArray(type)) return undefined
    const emitted = type.kind == "ListType" ? "java.util.List" : type.kind == "MapType" ? "java.util.Map" :
      type.kind == "TypeReference" ? emitScalarType("java", type) : undefined

    if (!emitted) return undefined
    parameterTypes.push(emitted)
  }

  return `${declaration.name}(${parameterTypes.join(",")})`
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
  if (["ListLiteral", "MapLiteral", "ListIndexExpression", "MapLookupExpression", "CollectionSizeExpression"].includes(candidate.kind)) {
    if (!task006Languages.has(language)) unsupportedCapability(language, "Task 006 immutable collections", location)
    if (candidate.kind == "ListLiteral") {
      if (!isDenseArray(candidate.elements)) unsupportedCapability(language, "missing or sparse list elements", location)
      for (const element of candidate.elements) validateExpression(element, language, location)
      return
    }
    if (candidate.kind == "MapLiteral") {
      if (!isDenseArray(candidate.entries)) unsupportedCapability(language, "missing or sparse map entries", location)
      if (language == "java" && candidate.entries.length > 10) {
        unsupportedCapability(language, "java.util.Map.of supports at most ten entries", location)
      }
      for (const entry of candidate.entries) {
        if (!entry || entry.kind != "MapEntry" || !entry.key || entry.key.kind != "StringLiteral") {
          unsupportedCapability(language, "missing or invalid map entry", entry?.location ?? location)
        }
        validateExpression(entry.key, language, entry.location)
        validateExpression(entry.value, language, entry.location)
      }
      return
    }
    if (candidate.kind == "ListIndexExpression") {
      if (candidate.totality == "fail-on-absence" && language != "java") {
        unsupportedCapability(language, "list access depends on Java-specific bounds failure", location)
      }
      validateExpression(candidate.collection, language, location)
      validateExpression(candidate.index, language, location)
      return
    }
    if (candidate.kind == "MapLookupExpression") {
      if (candidate.totality == "fail-on-absence" && language != "ruby") {
        unsupportedCapability(language, "map lookup depends on Ruby fetch absence failure", location)
      }
      validateExpression(candidate.collection, language, location)
      validateExpression(candidate.key, language, location)
      return
    }
    if (candidate.kind == "CollectionSizeExpression") {
      if (candidate.collectionKind != "list" && candidate.collectionKind != "map") {
        unsupportedCapability(language, "collection size without a validated receiver kind", location)
      }
      validateExpression(candidate.collection, language, location)
      return
    }
  }
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
 * Emits one recursive semantic type while mapping every constituent identity.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @param {string} path - Exact type occurrence path.
 * @param {import("../semantic/types.js").TextBackendLanguage} language - Target language.
 * @param {boolean} [javaBoxed] - Whether a Java scalar is a generic argument.
 * @returns {void}
 */
export function emitType(writer, type, path, language, javaBoxed = false) {
  if (type.kind == "TypeReference") {
    const spelling = language == "java" && javaBoxed
      ? type.name == "integer" ? "Integer" : type.name == "boolean" ? "Boolean" : type.name == "string" ? "String" : "void"
      : emitScalarType(language, type)

    writer.mapped(spelling, {mappingKind: "exact", node: type, path, role: "type"})
    return
  }
  const prefix = type.kind == "ListType"
    ? language == "ruby" ? "Array[" : language == "php" ? "list<" :
      language == "java" ? "java.util.List<" : "ReadonlyArray<"
    : language == "ruby" ? "Hash[" : language == "php" ? "array<" :
      language == "java" ? "java.util.Map<" : "ReadonlyMap<"

  writer.mapped(prefix, {mappingKind: "exact", node: type, path, role: "type"})
  if (type.kind == "ListType") {
    emitType(writer, type.elementType, `${path}/elementType`, language, language == "java")
  } else {
    emitType(writer, type.keyType, `${path}/keyType`, language, language == "java")
    writer.synthetic(language == "javascript" || language == "typescript" ? ", " : ",", "map type separator", [type], [path])
    emitType(writer, type.valueType, `${path}/valueType`, language, language == "java")
  }
  writer.mapped(language == "ruby" ? "]" : ">", {mappingKind: "anchor", node: type, path})
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
  if (expression.kind == "ListLiteral") {
    writer.mapped(language == "java" ? "java.util.List.of(" : "[", {mappingKind: "anchor", node: expression, path})
    expression.elements.forEach((element, index) => {
      if (index) writer.synthetic(", ", "list element separator", [expression], [path])
      emitExpression(writer, element, `${path}/elements/${index}`, language, emitIdentifier)
    })
    writer.mapped(language == "java" ? ")" : "]", {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind == "MapLiteral") {
    const open = language == "java" ? "java.util.Map.of(" : language == "javascript" || language == "typescript" ? "new Map([" :
      language == "php" ? "[" : "{"
    const close = language == "java" ? ")" : language == "javascript" || language == "typescript" ? "])" :
      language == "php" ? "]" : "}"

    writer.mapped(open, {mappingKind: "anchor", node: expression, path})
    expression.entries.forEach((entry, index) => {
      const entryPath = `${path}/entries/${index}`

      if (index) writer.synthetic(", ", "map entry separator", [expression], [path])
      if (language == "javascript" || language == "typescript") writer.mapped("[", {mappingKind: "anchor", node: entry, path: entryPath})
      emitExpression(writer, entry.key, `${entryPath}/key`, language, emitIdentifier)
      writer.mapped(language == "ruby" ? " => " : language == "php" ? " => " : ", ", {
        mappingKind: "exact", node: entry, path: entryPath, role: "operator"
      })
      emitExpression(writer, entry.value, `${entryPath}/value`, language, emitIdentifier)
      if (language == "javascript" || language == "typescript") writer.mapped("]", {mappingKind: "anchor", node: entry, path: entryPath})
    })
    writer.mapped(close, {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind == "ListIndexExpression") {
    emitExpression(writer, expression.collection, `${path}/collection`, language, emitIdentifier)
    writer.mapped(language == "java" ? ".get(" : "[", {mappingKind: "exact", node: expression, path, role: "operator"})
    emitExpression(writer, expression.index, `${path}/index`, language, emitIdentifier)
    writer.mapped(language == "java" ? ")" : "]", {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind == "MapLookupExpression") {
    emitExpression(writer, expression.collection, `${path}/collection`, language, emitIdentifier)
    const operator = language == "ruby" ? ".fetch(" : language == "php" ? "[" : ".get("

    writer.mapped(operator, {mappingKind: "exact", node: expression, path, role: "operator"})
    emitExpression(writer, expression.key, `${path}/key`, language, emitIdentifier)
    writer.mapped(language == "php" ? "]" : ")", {mappingKind: "anchor", node: expression, path})
    if (language == "typescript") {
      writer.synthetic("!", "statically proven map lookup", [expression], [path])
    }
    return
  }
  if (expression.kind == "CollectionSizeExpression") {
    if (language == "php") {
      writer.mapped("count(", {mappingKind: "exact", node: expression, path, role: "operator"})
      emitExpression(writer, expression.collection, `${path}/collection`, language, emitIdentifier)
      writer.mapped(")", {mappingKind: "anchor", node: expression, path})
      return
    }
    emitExpression(writer, expression.collection, `${path}/collection`, language, emitIdentifier)
    const operator = language == "ruby" || language == "java" ? ".size" :
      expression.collectionKind == "list" ? ".length" : ".size"

    writer.mapped(`${operator}${language == "java" ? "()" : ""}`, {
      mappingKind: "exact", node: expression, path, role: "operator"
    })
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
  if (expression.kind == "ListLiteral") return expression.elements.some((element) => expressionContainsSignProducingOperation(element))
  if (expression.kind == "MapLiteral") {
    return expression.entries.some((entry) => expressionContainsSignProducingOperation(entry.key) ||
      expressionContainsSignProducingOperation(entry.value))
  }
  if (expression.kind == "ListIndexExpression") {
    return expressionContainsSignProducingOperation(expression.collection) || expressionContainsSignProducingOperation(expression.index)
  }
  if (expression.kind == "MapLookupExpression") {
    return expressionContainsSignProducingOperation(expression.collection) || expressionContainsSignProducingOperation(expression.key)
  }
  if (expression.kind == "CollectionSizeExpression") return expressionContainsSignProducingOperation(expression.collection)

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
