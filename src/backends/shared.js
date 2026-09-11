// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {isDenseArray} from "../array.js"
import {validateBackendTypes} from "../semantic/validate.js"
import {validateTargetBindingIdentifier, validateTargetIdentifier, validateTargetTypeIdentifier} from "./identifiers.js"
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
const task007Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const task008Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const task009Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])
const javaObjectInstanceMethodSignatures = new Set([
  "clone()", "equals(Object)", "finalize()", "getClass()", "hashCode()", "notify()", "notifyAll()", "toString()",
  "wait()", "wait(long)", "wait(long,int)"
])

/**
 * Checks the intentionally narrow backend contract.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {{externalDeclarationIds?: Set<string>, program?: boolean, visibleFunctions?: Map<string, import("../semantic/types.js").FunctionDeclaration>, visibleRecords?: Map<string, import("../semantic/types.js").RecordDeclaration>}} [options] - Resolved program validation context.
 * @returns {void}
 */
export function validateBackendModule(module, language, options = {}) {
  if (!module || typeof module != "object" || Array.isArray(module)) {
    return unsupportedCapability(language, "missing or invalid module", undefined)
  }
  if (module.kind != "Module") unsupportedCapability(language, module.kind, module.location)
  if (!Array.isArray(module.functions) || !module.entryPoint || typeof module.entryPoint != "object" ||
    module.entryPoint.kind != "EntryPoint") unsupportedCapability(language, "missing or invalid module members", module.location)
  const declaredRecords = module.records
  const records = declaredRecords === undefined ? [] : declaredRecords

  if (!Array.isArray(records)) unsupportedCapability(language, "missing or invalid record declarations", module.location)
  if (module.functions.length == 0 && (!options.program ||
    records.length == 0 && module.entryPoint.body?.statements?.length == 0)) {
    unsupportedCapability(language, "module without declarations or executable entry", module.location)
  }
  if (records.length > 0 && !task009Languages.has(language)) {
    unsupportedCapability(language, "Task 009 closed records", records[0]?.location ?? module.location)
  }
  validateRecordTargets(records, module.functions, language, module.location)
  if (!task008Languages.has(language)) rejectIterationStatements(module, language)
  if (!task007Languages.has(language)) rejectOptionalTypes(module, language)
  if (!task006Languages.has(language)) rejectCollectionTypes(module, language)
  validateBlock(module.entryPoint.body, language, module.entryPoint.location, 0, new Set(), options.externalDeclarationIds)
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
    if (typeof functionDeclaration.id != "string" || !/^(?:[a-z][a-z0-9._-]*#)?function:[0-9]+$/u.test(functionDeclaration.id) ||
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
    validateBlock(functionDeclaration.body, language, functionDeclaration.location, 0, new Set(), options.externalDeclarationIds)

    for (const parameter of functionDeclaration.parameters) {
      if (!parameter || typeof parameter != "object" || Array.isArray(parameter) || parameter.kind != "Parameter") {
        unsupportedCapability(language, "missing or invalid parameter", functionDeclaration.location)
      }
      validateTargetBindingIdentifier(language, parameter.name, "parameter", parameter.location)
    }
  }
  validateScaffoldingNames(module, language)
  validateBackendTypes(module, language, {functions: options.visibleFunctions, records: options.visibleRecords})
}

/**
 * Validates every nominal record identifier, identity, field, and target collision before output allocation.
 * @param {import("../semantic/types.js").RecordDeclaration[]} records - Candidate records.
 * @param {import("../semantic/types.js").FunctionDeclaration[]} functions - Candidate functions.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target language.
 * @param {import("../semantic/types.js").SourceLocation | undefined} moduleLocation - Module fallback location.
 * @returns {void}
 */
function validateRecordTargets(records, functions, language, moduleLocation) {
  const declarationIds = new Set()
  const targetNames = new Set()

  for (const declaration of functions) {
    if (!declaration || typeof declaration != "object" || Array.isArray(declaration)) continue
    const name = Reflect.get(declaration, "name")

    if (typeof name != "string") continue
    targetNames.add(language == "php" ? name.toLowerCase() : name)
  }

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex]
    const location = diagnosticLocation(record?.location, moduleLocation)
    const recordKeys = record && typeof record == "object" && !Array.isArray(record)
      ? Object.keys(record).filter((key) => key != "sourceProvenance").sort().join(",")
      : ""

    if (!record || typeof record != "object" || Array.isArray(record) || record.kind != "RecordDeclaration" ||
      recordKeys != "fields,id,kind,location,name" || !isDenseArray(record.fields)) {
      unsupportedCapability(language, "missing or invalid record declaration", location)
    }
    requireSemanticLocation(record.location, language, "record declaration location", moduleLocation)
    validateTargetTypeIdentifier(language, record.name, record.location)
    if (typeof record.id != "string" || !new RegExp(`^(?:[a-z][a-z0-9._-]*#)?record:${recordIndex}$`, "u").test(record.id) ||
      declarationIds.has(record.id)) {
      unsupportedCapability(language, "duplicate or invalid record declaration identity", record.location)
    }
    declarationIds.add(record.id)
    const targetName = language == "php" ? record.name.toLowerCase() : record.name

    if (targetNames.has(targetName)) unsupportedCapability(language, `record declaration collision '${record.name}'`, record.location)
    targetNames.add(targetName)
    const fieldNames = new Set()

    for (let fieldIndex = 0; fieldIndex < record.fields.length; fieldIndex += 1) {
      const field = record.fields[fieldIndex]
      const fieldLocation = diagnosticLocation(field?.location, record.location)
      const fieldKeys = field && typeof field == "object" && !Array.isArray(field)
        ? Object.keys(field).filter((key) => key != "sourceProvenance").sort().join(",")
        : ""

      if (!field || typeof field != "object" || Array.isArray(field) || field.kind != "RecordField" ||
        fieldKeys != "id,kind,location,name,type") {
        unsupportedCapability(language, "missing or invalid record field", fieldLocation)
      }
      requireSemanticLocation(field.location, language, "record field location", record.location)
      if (field.id != `${record.id}:field:${fieldIndex}`) {
        unsupportedCapability(language, "duplicate or invalid record field identity", field.location)
      }
      validateTargetIdentifier(language, field.name, "record field", field.location)
      const collision = language == "javascript" && ["constructor", "prototype", "__proto__"].includes(field.name) ||
        language == "typescript" && ["constructor", "prototype", "__proto__"].includes(field.name) ||
        language == "php" && field.name.toLowerCase().startsWith("__") ||
        language == "ruby" && ["initialize", "freeze", "send", "public_send", "method", "singleton_class"].includes(field.name) ||
        language == "java" && javaObjectInstanceMethodSignatures.has(`${field.name}()`)

      if (collision) unsupportedCapability(language, `record field collision '${field.name}'`, field.location)
      const normalized = language == "php" ? field.name.toLowerCase() : field.name

      if (fieldNames.has(normalized)) unsupportedCapability(language, `duplicate target record field '${field.name}'`, field.location)
      fieldNames.add(normalized)
    }
  }
}

/**
 * Rejects Task 008 statements before a non-cohort backend reaches collection-type checks.
 * @param {import("../semantic/types.js").SemanticModule} module - Candidate module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target identity.
 * @returns {void}
 */
function rejectIterationStatements(module, language) {
  for (const declaration of module.functions) {
    rejectBlockIteration(declaration && typeof declaration == "object" && !Array.isArray(declaration)
      ? Reflect.get(declaration, "body")
      : undefined, language)
  }
  rejectBlockIteration(module.entryPoint.body, language)
}

/**
 * Finds a Task 008 node without descending through malformed or cyclic containers.
 * @param {unknown} block - Candidate block.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target identity.
 * @param {Set<object>} [seen] - Visited containers.
 * @returns {void}
 */
function rejectBlockIteration(block, language, seen = new Set()) {
  if (!block || typeof block != "object" || Array.isArray(block) || seen.has(block)) return
  seen.add(block)
  const statements = Reflect.get(block, "statements")

  if (!Array.isArray(statements)) return
  for (const statement of statements) {
    if (!statement || typeof statement != "object" || Array.isArray(statement)) continue
    const kind = Reflect.get(statement, "kind")
    const location = diagnosticLocation(Reflect.get(statement, "location"), Reflect.get(block, "location"))

    if (["ForEachStatement", "BreakStatement", "ContinueStatement"].includes(kind)) {
      unsupportedCapability(language, "Task 008 ordered list iteration", location)
    }
    if (kind == "IfStatement") {
      rejectBlockIteration(Reflect.get(statement, "consequent"), language, seen)
      rejectBlockIteration(Reflect.get(statement, "alternate"), language, seen)
    }
  }
}

/**
 * Rejects Task 007 optional types before a non-cohort emitter allocates output.
 * @param {import("../semantic/types.js").SemanticModule} module - Candidate semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target identity.
 * @returns {void}
 */
function rejectOptionalTypes(module, language) {
  for (const declaration of module.functions) {
    if (!declaration || typeof declaration != "object" || Array.isArray(declaration)) continue
    const location = Reflect.get(declaration, "location") ?? module.location

    if (containsOptionalType(Reflect.get(declaration, "returnType"))) {
      unsupportedCapability(language, "Task 007 optional return type", location)
    }
    for (const parameter of Array.isArray(Reflect.get(declaration, "parameters")) ? Reflect.get(declaration, "parameters") : []) {
      if (containsOptionalType(parameter?.type)) {
        unsupportedCapability(language, "Task 007 optional parameter type", parameter.location ?? location)
      }
    }
    rejectBlockOptionalTypes(Reflect.get(declaration, "body"), language)
  }
  rejectBlockOptionalTypes(module.entryPoint.body, language)
}

/**
 * Rejects optional local types recursively in one candidate block.
 * @param {unknown} block - Candidate block.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target identity.
 * @returns {void}
 */
function rejectBlockOptionalTypes(block, language) {
  if (!block || typeof block != "object" || Array.isArray(block) || !Array.isArray(Reflect.get(block, "statements"))) return
  for (const statement of Reflect.get(block, "statements")) {
    if (!statement || typeof statement != "object" || Array.isArray(statement)) continue
    if (statement.kind == "LocalDeclaration" && containsOptionalType(statement.type)) {
      unsupportedCapability(language, "Task 007 optional local type", statement.location)
    }
    if (statement.kind == "IfStatement") {
      rejectBlockOptionalTypes(statement.consequent, language)
      if (statement.alternate) rejectBlockOptionalTypes(statement.alternate, language)
    }
    if (statement.kind == "ForEachStatement") {
      if (containsOptionalType(statement.valueBinding?.type)) {
        unsupportedCapability(language, "Task 007 optional iteration binding type", statement.valueBinding.location ?? statement.location)
      }
      rejectBlockOptionalTypes(statement.body, language)
    }
  }
}

/**
 * Checks one bounded recursive semantic type for an optional node.
 * @param {unknown} type - Candidate type.
 * @param {Set<object>} [seen] - Cycle protection.
 * @returns {boolean} Whether an optional type occurs.
 */
function containsOptionalType(type, seen = new Set()) {
  if (!type || typeof type != "object" || Array.isArray(type) || seen.has(type)) return false
  seen.add(type)
  const kind = Reflect.get(type, "kind")

  if (kind == "OptionalType") return true
  if (kind == "ListType") return containsOptionalType(Reflect.get(type, "elementType"), seen)
  if (kind == "MapType") return containsOptionalType(Reflect.get(type, "keyType"), seen) ||
    containsOptionalType(Reflect.get(type, "valueType"), seen)

  return false
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
    if (statement.kind == "ForEachStatement") {
      if (isCollectionType(statement.valueBinding?.type)) {
        unsupportedCapability(language, "Task 006 immutable collection iteration binding type", statement.valueBinding.location ?? statement.location)
      }
      rejectBlockCollectionTypes(statement.body, language)
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
  validateRecordConstructorNames(module, language)
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
    if (statement.kind == "ForEachStatement" && ownedEntryNames.has(statement.valueBinding.name)) {
      unsupportedCapability(language, `entry iteration binding '${statement.valueBinding.name}' captures backend scaffolding`,
        statement.valueBinding.location)
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
      if (statement.kind == "ForEachStatement" && ownedPrintReceiverNames.has(statement.valueBinding.name)) {
        unsupportedCapability(language, `function iteration binding '${statement.valueBinding.name}' captures backend scaffolding`,
          statement.valueBinding.location)
      }
    }
  }
  if (language == "java") validateJavaUtilFactoryNames(module)
}

/**
 * Rejects JavaScript-family lexical bindings that can capture emitted bare record constructor names.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated-shape semantic module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target language.
 * @returns {void}
 */
function validateRecordConstructorNames(module, language) {
  if (language != "javascript" && language != "typescript") return
  const recordNames = new Set((module.records ?? []).map((record) => record.name))

  /**
   * Checks declarations nested beneath one owning block.
   * @param {import("../semantic/types.js").Block} block - Block to inspect.
   * @param {"entry" | "function"} owner - Owning scope kind.
   * @returns {void}
   */
  const validateBlockNames = (block, owner) => {
    for (const statement of allStatements(block)) {
      if (statement.kind == "LocalDeclaration" && recordNames.has(statement.name)) {
        unsupportedCapability(language, `${owner} local '${statement.name}' captures record constructor`, bindingNameLocation(statement))
      }
      if (statement.kind == "ForEachStatement" && recordNames.has(statement.valueBinding.name)) {
        unsupportedCapability(
          language,
          `${owner} iteration binding '${statement.valueBinding.name}' captures record constructor`,
          bindingNameLocation(statement.valueBinding)
        )
      }
    }
  }

  validateBlockNames(module.entryPoint.body, "entry")
  for (const declaration of module.functions) {
    for (const parameter of declaration.parameters) {
      if (recordNames.has(parameter.name)) {
        unsupportedCapability(language, `function parameter '${parameter.name}' captures record constructor`, bindingNameLocation(parameter))
      }
    }
    validateBlockNames(declaration.body, "function")
  }
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
        statement.kind == "ForEachStatement" ? statement.list :
        statement.kind == "LocalDeclaration" ? statement.initializer :
          statement.kind == "AssignmentStatement" ? statement.expression :
            statement.kind == "ReturnStatement" ? statement.expression :
              statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ? statement.expression : undefined

      if (capture && expression && (expressionContainsKind(expression, "ListLiteral") ||
        expressionContainsKind(expression, "MapLiteral") || expressionContainsKind(expression, "OptionalNone") ||
        expressionContainsKind(expression, "OptionalSome"))) {
        unsupportedCapability("java", capture.detail, capture.location)
      }
      if (statement.kind == "IfStatement") {
        validateBlockNames(statement.consequent, capture, owner)
        if (statement.alternate) validateBlockNames(statement.alternate, capture, owner)
      }
      if (statement.kind == "ForEachStatement") {
        const loopCapture = statement.valueBinding.name == "java" ? {
          detail: `${owner} iteration binding 'java' captures java.util factory syntax`,
          location: statement.valueBinding.location
        } : capture

        validateBlockNames(statement.body, loopCapture, owner)
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
        statement.kind == "ForEachStatement" ? statement.list :
        statement.kind == "LocalDeclaration" ? statement.initializer :
          statement.kind == "AssignmentStatement" ? statement.expression :
            statement.kind == "ReturnStatement" ? statement.expression :
              statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ? statement.expression : undefined

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
  if (expression.kind == "RecordConstruction") {
    return expression.arguments.some((argument) => expressionContainsKind(argument, kind))
  }
  if (expression.kind == "MemberRead") return expressionContainsKind(expression.receiver, kind)
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
  if (expression.kind == "OptionalSome") return expressionContainsKind(expression.value, kind)
  if (expression.kind == "OptionalIsPresent" || expression.kind == "OptionalUnwrap") {
    return expressionContainsKind(expression.operand, kind)
  }

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
 * Returns a parser-backed binding-name location when one survived semantic adaptation.
 * @param {import("../semantic/types.js").Parameter | import("../semantic/types.js").LocalDeclaration | import("../semantic/types.js").ValueBinding} binding - Semantic binding.
 * @returns {import("../semantic/types.js").SourceLocation} Exact name or binding location.
 */
function bindingNameLocation(binding) {
  return binding.sourceProvenance?.ranges.name ?? binding.location
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
  return block.statements.flatMap((statement) => {
    if (statement.kind == "IfStatement") {
      return [statement, ...allStatements(statement.consequent), ...(statement.alternate ? allStatements(statement.alternate) : [])]
    }
    if (statement.kind == "ForEachStatement") return [statement, ...allStatements(statement.body)]

    return [statement]
  })
}

/**
 * Validates one complete semantic block before emission.
 * @param {unknown} block - Candidate block.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Enclosing location.
 * @param {number} [loopDepth] - Number of enclosing list loops.
 * @param {Set<object>} [activePath] - Blocks on the active recursive path.
 * @param {Set<string>} [externalDeclarationIds] - Resolved declarations whose source spelling is target-independent.
 * @returns {void}
 */
function validateBlock(block, language, ownerLocation, loopDepth = 0, activePath = new Set(), externalDeclarationIds = new Set()) {
  if (!block || typeof block != "object" || Array.isArray(block)) {
    return unsupportedCapability(language, "missing or invalid block", ownerLocation)
  }

  const candidate = /** @type {import("../semantic/types.js").Block} */ (block)
  const location = diagnosticLocation(candidate.location, ownerLocation)

  if (activePath.has(candidate)) unsupportedCapability(language, "cyclic block", location)
  if (candidate.kind != "Block") unsupportedCapability(language, `block ${String(Reflect.get(block, "kind"))}`, location)
  if (!Array.isArray(candidate.statements)) unsupportedCapability(language, "missing or invalid block statements", location)
  const blockPath = new Set(activePath)

  blockPath.add(candidate)
  for (const statement of candidate.statements) {
    validateStatement(statement, language, location, loopDepth, blockPath, externalDeclarationIds)
  }
}

/**
 * Validates one supported statement recursively.
 * @param {unknown} statement - Candidate statement.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend language or binary target.
 * @param {import("../semantic/types.js").SourceLocation | undefined} ownerLocation - Enclosing body location.
 * @param {number} [loopDepth] - Active loop nesting.
 * @param {Set<object>} [activePath] - Active block containers.
 * @param {Set<string>} [externalDeclarationIds] - Resolved declarations whose source spelling is target-independent.
 * @returns {void}
 */
function validateStatement(statement, language, ownerLocation, loopDepth = 0, activePath = new Set(), externalDeclarationIds = new Set()) {
  if (!statement || typeof statement != "object" || Array.isArray(statement)) {
    return unsupportedCapability(language, "missing or invalid statement", ownerLocation)
  }

  const kind = Reflect.get(statement, "kind")
  const ownLocation = Reflect.get(statement, "location")
  const location = diagnosticLocation(ownLocation, ownerLocation)

  if (typeof kind != "string") return unsupportedCapability(language, "missing or invalid statement", location)
  if (kind == "LocalDeclaration") {
    const declaration = /** @type {import("../semantic/types.js").LocalDeclaration} */ (statement)

    if (typeof declaration.mutable != "boolean") {
      unsupportedCapability(language, "local declaration with invalid mutability", location)
    }
    validateTargetBindingIdentifier(language, declaration.name, "local", location)
    validateExpression(declaration.initializer, language, location, false, new Set(), externalDeclarationIds)
    return
  }
  if (kind == "AssignmentStatement") {
    const assignment = /** @type {import("../semantic/types.js").AssignmentStatement} */ (statement)

    validateAssignmentTarget(assignment.target, language, location)
    validateExpression(assignment.expression, language, location, false, new Set(), externalDeclarationIds)
    return
  }
  if (kind == "ReturnStatement") {
    const expression = Reflect.get(statement, "expression")

    if (expression !== undefined) validateExpression(expression, language, location, false, new Set(), externalDeclarationIds)
    if (language == "ruby" && loopDepth > 0) {
      unsupportedCapability(language, "return from an iteration body", location)
    }
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
    validateExpression(expression, language, location, false, new Set(), externalDeclarationIds)
    return
  }
  if (kind == "PrintStatement") {
    validateExpression(Reflect.get(statement, "expression"), language, location, false, new Set(), externalDeclarationIds)
    return
  }
  if (kind == "IfStatement") {
    const branch = /** @type {import("../semantic/types.js").IfStatement} */ (statement)

    validateExpression(branch.condition, language, location, false, new Set(), externalDeclarationIds)
    validateBlock(branch.consequent, language, location, loopDepth, activePath, externalDeclarationIds)
    if (Object.hasOwn(branch, "alternate")) {
      validateBlock(branch.alternate, language, location, loopDepth, activePath, externalDeclarationIds)
    }
    return
  }
  if (kind == "BreakStatement" || kind == "ContinueStatement") {
    if (!task008Languages.has(language)) unsupportedCapability(language, "Task 008 ordered list iteration", location)
    requireSemanticLocation(ownLocation, language, `${kind} location`, ownerLocation)
    const fields = Object.keys(/** @type {object} */ (statement)).filter((key) => key != "sourceProvenance").sort().join(",")

    if (fields != "kind,location") unsupportedCapability(language, `malformed ${kind}`, location)
    if (loopDepth == 0) unsupportedCapability(language, `${kind == "BreakStatement" ? "break" : "continue"} outside a loop`, location)
    return
  }
  if (kind == "ForEachStatement") {
    if (!task008Languages.has(language)) unsupportedCapability(language, "Task 008 ordered list iteration", location)
    const loopLocation = requireSemanticLocation(ownLocation, language, "ForEachStatement location", ownerLocation)
    const loop = /** @type {import("../semantic/types.js").ForEachStatement} */ (statement)
    const fields = Object.keys(loop).filter((key) => key != "sourceProvenance").sort().join(",")

    if (fields != "body,kind,list,location,valueBinding") unsupportedCapability(language, "malformed ForEachStatement", loopLocation)
    if (!loop.list || typeof loop.list != "object" || Array.isArray(loop.list)) {
      unsupportedCapability(language, "missing or invalid iteration collection", loopLocation)
    }
    requireSemanticLocation(Reflect.get(loop.list, "location"), language, "iteration collection location", loopLocation)
    validateExpression(loop.list, language, loopLocation, false, new Set(), externalDeclarationIds)
    if (!loop.valueBinding || typeof loop.valueBinding != "object" || Array.isArray(loop.valueBinding)) {
      unsupportedCapability(language, "missing or invalid iteration binding", loopLocation)
    }
    const binding = loop.valueBinding
    const bindingLocation = requireSemanticLocation(Reflect.get(binding, "location"), language, "iteration binding location", loopLocation)
    const bindingFields = Object.keys(binding).filter((key) => key != "sourceProvenance").sort().join(",")

    if (binding.kind != "ValueBinding" || bindingFields != "kind,location,mutable,name,type") {
      unsupportedCapability(language, "malformed iteration binding", bindingLocation)
    }
    if (binding.mutable !== false) unsupportedCapability(language, "mutable iteration binding", bindingLocation)
    validateTargetBindingIdentifier(language, binding.name, "iteration binding", bindingLocation)
    if (!loop.body || typeof loop.body != "object" || Array.isArray(loop.body)) {
      unsupportedCapability(language, "missing or invalid iteration body", loopLocation)
    }
    requireSemanticLocation(Reflect.get(loop.body, "location"), language, "iteration body location", loopLocation)
    validateBlock(loop.body, language, loopLocation, loopDepth + 1, activePath, externalDeclarationIds)
    return
  }

  unsupportedCapability(language, `statement ${kind}`, location)
}

/**
 * Returns a complete semantic location suitable for diagnostic construction.
 * @param {unknown} candidate - Preferred location.
 * @param {unknown} fallback - Nearest enclosing location.
 * @returns {import("../semantic/types.js").SourceLocation | undefined} Safe diagnostic location.
 */
function diagnosticLocation(candidate, fallback) {
  if (isSemanticLocation(candidate)) return candidate
  if (isSemanticLocation(fallback)) return fallback

  return undefined
}

/**
 * Requires one complete parser-neutral location before any backend or diagnostic consumes it.
 * @param {unknown} candidate - Required location.
 * @param {import("../semantic/types.js").BackendLanguage} language - Backend identity.
 * @param {string} subject - Location owner for a deterministic diagnostic.
 * @param {unknown} fallback - Nearest enclosing location.
 * @returns {import("../semantic/types.js").SourceLocation} Validated location.
 */
function requireSemanticLocation(candidate, language, subject, fallback) {
  if (!isSemanticLocation(candidate)) unsupportedCapability(language, `missing or invalid ${subject}`, diagnosticLocation(fallback, undefined))

  return candidate
}

/**
 * Checks a complete ordered UTF-16 source range.
 * @param {unknown} location - Candidate source range.
 * @returns {location is import("../semantic/types.js").SourceLocation} Whether the range is safe to consume.
 */
function isSemanticLocation(location) {
  if (!location || typeof location != "object" || Array.isArray(location)) return false
  const candidate = /** @type {{filename?: unknown, start?: unknown, end?: unknown}} */ (location)

  if (typeof candidate.filename != "string" || candidate.filename.length == 0 ||
    !isSemanticPoint(candidate.start) || !isSemanticPoint(candidate.end)) return false

  return candidate.end.offset >= candidate.start.offset && candidate.end.line >= candidate.start.line &&
    (candidate.end.line != candidate.start.line || candidate.end.column >= candidate.start.column)
}

/**
 * Checks one complete one-based UTF-16 source point.
 * @param {unknown} point - Candidate source point.
 * @returns {point is import("../semantic/types.js").SourcePoint} Whether all coordinates are valid.
 */
function isSemanticPoint(point) {
  if (!point || typeof point != "object" || Array.isArray(point)) return false
  const candidate = /** @type {{offset?: unknown, line?: unknown, column?: unknown}} */ (point)

  return Number.isSafeInteger(candidate.offset) && Number(candidate.offset) >= 0 &&
    Number.isSafeInteger(candidate.line) && Number(candidate.line) >= 1 &&
    Number.isSafeInteger(candidate.column) && Number(candidate.column) >= 1
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
 * @param {Set<object>} [activePath] - Ancestors on the current recursive validation path.
 * @param {Set<string>} [externalDeclarationIds] - Resolved declarations whose source spelling is target-independent.
 * @returns {void}
 */
function validateExpression(expression, language, ownerLocation, allowJavaNegatedMinimumOperand = false, activePath = new Set(), externalDeclarationIds = new Set()) {
  if (!expression || typeof expression != "object" || Array.isArray(expression)) {
    return unsupportedCapability(language, "missing or invalid expression", ownerLocation)
  }

  const candidate = /** @type {import("../semantic/types.js").Expression} */ (expression)
  const location = candidate.location ?? ownerLocation

  if (activePath.has(candidate)) unsupportedCapability(language, "cyclic expression", location)
  const expressionPath = new Set(activePath)

  expressionPath.add(candidate)

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
  if (["OptionalNone", "OptionalSome", "OptionalIsPresent", "OptionalUnwrap"].includes(candidate.kind)) {
    if (!task007Languages.has(language)) unsupportedCapability(language, "Task 007 optional values", location)
    const fields = Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",")
    const expectedFields = candidate.kind == "OptionalNone" ? "kind,location" :
      candidate.kind == "OptionalSome" ? "kind,location,value" : "kind,location,operand"

    if (fields != expectedFields) unsupportedCapability(language, `malformed ${candidate.kind}`, location)
    if (candidate.kind == "OptionalNone") return
    if (candidate.kind == "OptionalSome") {
      validateExpression(candidate.value, language, location, false, expressionPath, externalDeclarationIds)
      return
    }
    const operation = /** @type {import("../semantic/types.js").OptionalIsPresent | import("../semantic/types.js").OptionalUnwrap} */ (candidate)

    if (!operation.operand || operation.operand.kind != "IdentifierExpression") {
      unsupportedCapability(language, `${candidate.kind} without a simple identifier operand`, location)
    }
    validateExpression(operation.operand, language, location, false, expressionPath, externalDeclarationIds)
    return
  }
  if (["ListLiteral", "MapLiteral", "ListIndexExpression", "MapLookupExpression", "CollectionSizeExpression"].includes(candidate.kind)) {
    if (!task006Languages.has(language)) unsupportedCapability(language, "Task 006 immutable collections", location)
    if (candidate.kind == "ListLiteral") {
      if (!isDenseArray(candidate.elements)) unsupportedCapability(language, "missing or sparse list elements", location)
      for (const element of candidate.elements) {
        validateExpression(element, language, location, false, expressionPath, externalDeclarationIds)
      }
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
        validateExpression(entry.key, language, entry.location, false, expressionPath, externalDeclarationIds)
        validateExpression(entry.value, language, entry.location, false, expressionPath, externalDeclarationIds)
      }
      return
    }
    if (candidate.kind == "ListIndexExpression") {
      if (candidate.totality == "fail-on-absence" && language != "java") {
        unsupportedCapability(language, "list access depends on Java-specific bounds failure", location)
      }
      validateExpression(candidate.collection, language, location, false, expressionPath, externalDeclarationIds)
      validateExpression(candidate.index, language, location, false, expressionPath, externalDeclarationIds)
      return
    }
    if (candidate.kind == "MapLookupExpression") {
      if (candidate.totality == "fail-on-absence" && language != "ruby") {
        unsupportedCapability(language, "map lookup depends on Ruby fetch absence failure", location)
      }
      validateExpression(candidate.collection, language, location, false, expressionPath, externalDeclarationIds)
      validateExpression(candidate.key, language, location, false, expressionPath, externalDeclarationIds)
      return
    }
    if (candidate.kind == "CollectionSizeExpression") {
      if (candidate.collectionKind != "list" && candidate.collectionKind != "map") {
        unsupportedCapability(language, "collection size without a validated receiver kind", location)
      }
      validateExpression(candidate.collection, language, location, false, expressionPath, externalDeclarationIds)
      return
    }
  }
  if (candidate.kind == "CallExpression") {
    const declarationId = candidate.resolution && typeof candidate.resolution == "object" && !Array.isArray(candidate.resolution)
      ? Reflect.get(candidate.resolution, "declarationId")
      : undefined

    if (typeof declarationId != "string" || !externalDeclarationIds.has(declarationId)) {
      validateTargetIdentifier(language, candidate.callee, "callee", location)
    }
    if (!candidate.resolution || typeof candidate.resolution != "object" || Array.isArray(candidate.resolution)) {
      unsupportedCapability(language, "missing or invalid resolved call signature", location)
    }
    if (!Array.isArray(candidate.arguments)) {
      unsupportedCapability(language, "missing or invalid call arguments", location)
    }
    if (!task005Languages.has(language) && candidate.arguments.length != 2) {
      unsupportedCapability(language, "call argument count other than two", location)
    }
    for (const argument of candidate.arguments) {
      validateExpression(argument, language, location, false, expressionPath, externalDeclarationIds)
    }
    return
  }
  if (candidate.kind == "RecordConstruction") {
    const fields = Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",")

    if (fields != "arguments,kind,location,record" || !candidate.record || candidate.record.kind != "RecordType" ||
      typeof candidate.record.declarationId != "string" || !isDenseArray(candidate.arguments)) {
      unsupportedCapability(language, "malformed RecordConstruction", location)
    }
    for (const argument of candidate.arguments) {
      validateExpression(argument, language, location, false, expressionPath, externalDeclarationIds)
    }
    return
  }
  if (candidate.kind == "MemberRead") {
    const fields = Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",")

    if (fields != "field,kind,location,receiver" || typeof candidate.field != "string") {
      unsupportedCapability(language, "malformed MemberRead", location)
    }
    validateExpression(candidate.receiver, language, location, false, expressionPath, externalDeclarationIds)
    return
  }
  if (candidate.kind == "UnaryExpression") {
    if (!Object.hasOwn(unaryOperationSyntax, String(candidate.operation))) {
      unsupportedCapability(language, `unary operation ${String(candidate.operation)}`, location)
    }
    validateExpression(candidate.operand, language, location, candidate.operation == "IntegerNegate", expressionPath,
      externalDeclarationIds)
    validateKnownTargetInteger(candidate, language, location)
    return
  }
  if (candidate.kind == "BinaryExpression") {
    if (!Object.hasOwn(binaryOperationSyntax, String(candidate.operation))) {
      unsupportedCapability(language, `binary operation ${String(candidate.operation)}`, location)
    }
    validateExpression(candidate.left, language, location, false, expressionPath, externalDeclarationIds)
    validateExpression(candidate.right, language, location, false, expressionPath, externalDeclarationIds)
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
  if (type.kind == "RecordType") {
    const record = writer.recordForId(type.declarationId)

    writer.mapped(writer.recordNameForId(type.declarationId), {
      mappingKind: "exact", name: record.name, node: type, path, role: "type"
    })
    return
  }
  if (type.kind == "TypeReference") {
    const spelling = language == "java" && javaBoxed
      ? type.name == "integer" ? "Integer" : type.name == "boolean" ? "Boolean" : type.name == "string" ? "String" : "void"
      : emitScalarType(language, type)

    writer.mapped(spelling, {mappingKind: "exact", node: type, path, role: "type"})
    return
  }
  if (type.kind == "OptionalType") {
    const prefix = language == "java" ? "java.util.Optional<" : language == "php" ? "?" : ""

    writer.mapped(prefix, {mappingKind: "exact", node: type, path, role: "type"})
    emitType(writer, type.valueType, `${path}/valueType`, language, language == "java")
    writer.mapped(language == "java" ? ">" : language == "ruby" ? "?" : language == "javascript" ? "|null" :
      language == "typescript" ? " | null" : "", {mappingKind: "anchor", node: type, path})
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
  if (expression.kind == "OptionalNone") {
    writer.mapped(language == "java" ? "java.util.Optional.empty()" : language == "ruby" ? "nil" : "null", {
      mappingKind: "exact", node: expression, path, role: "absence"
    })
    return
  }
  if (expression.kind == "OptionalSome") {
    if (language == "java") {
      writer.mapped("java.util.Optional.of(", {mappingKind: "exact", node: expression, path, role: "some"})
    } else {
      writer.mapped("(", {mappingKind: "exact", node: expression, path, role: "some"})
    }
    emitExpression(writer, expression.value, `${path}/value`, language, emitIdentifier)
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind == "OptionalIsPresent") {
    if (language == "ruby") writer.mapped("!", {mappingKind: "exact", node: expression, path, role: "operator"})
    emitExpression(writer, expression.operand, `${path}/operand`, language, emitIdentifier)
    writer.mapped(language == "java" ? ".isPresent()" : language == "ruby" ? ".nil?" : " !== null", {
      mappingKind: "exact", node: expression, path, role: "operator"
    })
    return
  }
  if (expression.kind == "OptionalUnwrap") {
    if (language != "java") {
      writer.mapped("(", {mappingKind: "exact", node: expression, path, role: "unwrap"})
    }
    emitExpression(writer, expression.operand, `${path}/operand`, language, emitIdentifier)
    if (language == "java") {
      writer.mapped(".get()", {mappingKind: "exact", node: expression, path, role: "unwrap"})
    } else writer.mapped(")", {mappingKind: "anchor", node: expression, path})
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
    writer.mapped(writer.callNameFor(expression), {
      mappingKind: "exact", name: expression.callee, node: expression, path, role: "callee"
    })
    writer.mapped("(", {mappingKind: "anchor", node: expression, path})
    expression.arguments.forEach((argument, index) => {
      if (index > 0) writer.synthetic(", ", "argument separator", [expression], [path])
      emitExpression(writer, argument, `${path}/arguments/${index}`, language, emitIdentifier)
    })
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind == "RecordConstruction") {
    const record = writer.recordForId(expression.record.declarationId)
    const targetName = writer.recordNameForId(expression.record.declarationId)
    const prefix = language == "ruby" ? `${targetName}.new(` : `new ${targetName}(`

    writer.mapped(prefix, {mappingKind: "exact", name: record.name, node: expression, path, role: "record"})
    expression.arguments.forEach((argument, index) => {
      if (index > 0) writer.synthetic(", ", "record argument separator", [expression], [path])
      emitExpression(writer, argument, `${path}/arguments/${index}`, language, emitIdentifier)
    })
    writer.mapped(")", {mappingKind: "anchor", node: expression, path})
    return
  }
  if (expression.kind == "MemberRead") {
    emitExpression(writer, expression.receiver, `${path}/receiver`, language, emitIdentifier)
    const field = writer.fieldForId(expression.field)
    const spelling = language == "php" ? `->${field.name}` : language == "java" ? `.${field.name}()` : `.${field.name}`

    writer.mapped(spelling, {mappingKind: "exact", node: expression, path, role: "member"})
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
    if (statement.kind == "ForEachStatement") {
      return expressionContainsSignProducingOperation(statement.list) || blockContainsSignProducingOperation(statement.body)
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
  if (expression.kind == "RecordConstruction") {
    return expression.arguments.some((argument) => expressionContainsSignProducingOperation(argument))
  }
  if (expression.kind == "MemberRead") return expressionContainsSignProducingOperation(expression.receiver)
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
  if (expression.kind == "OptionalSome") return expressionContainsSignProducingOperation(expression.value)
  if (expression.kind == "OptionalIsPresent" || expression.kind == "OptionalUnwrap") {
    return expressionContainsSignProducingOperation(expression.operand)
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
