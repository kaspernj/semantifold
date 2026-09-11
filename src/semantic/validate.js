// @ts-check

import {semanticFailure, unsupportedCapability, unsupportedSyntax} from "../diagnostic.js"
import {hasOnlyUnicodeScalars, isScalarTypeName, scalarType} from "./scalars.js"
import {adaptedOperationFor} from "./operators.js"
import {parserRangeFor} from "./provenance.js"

const task005Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])

/** @typedef {Map<string, import("./types.js").RecordDeclaration>} RecordRegistry */

/**
 * @typedef Binding
 * @property {boolean} mutable - Whether assignment is allowed.
 * @property {import("./types.js").SemanticValueType} type - Binding type.
 * @property {import("./types.js").Expression | undefined} knownValue - Current statically known immutable value.
 */

/**
 * @typedef Scope
 * @property {Map<string, Binding>} bindings - Bindings declared directly in this scope.
 * @property {Set<string>} pending - Names declared later in this scope.
 * @property {Set<Binding>} presenceProofs - Optional bindings proven present on this path.
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
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, records?: Map<string, import("./types.js").RecordDeclaration>}} [visible] - Program imports visible during validation.
 * @returns {import("./types.js").SemanticModule} Validated module.
 */
export function validateParsedModule(module, language, visible = {}) {
  validateModuleShape(module, language, (detail, location) => unsupportedSyntax(language, detail, location))
  validateModuleTypes(module, (code, detail, location) => semanticFailure(language, code, detail, location), true, visible)

  return module
}

/**
 * Validates scalar types and bindings for a caller-supplied semantic module before emission.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {import("./types.js").BackendLanguage} language - Backend language or binary target.
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, records?: Map<string, import("./types.js").RecordDeclaration>}} [visible] - Resolved program imports.
 * @returns {void}
 */
export function validateBackendTypes(module, language, visible = {}) {
  validateModuleTypes(module, (_code, detail, location) => unsupportedCapability(language, detail, location), false, visible)
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
    if (!["AssignmentStatement", "BreakStatement", "ContinueStatement", "ExpressionStatement", "ForEachStatement", "IfStatement", "LocalDeclaration", "PrintStatement", "ReturnStatement"].includes(statement.kind)) {
      fail(`${detail} statement ${statement.kind}`, statement.location)
    }
    if (statement.kind == "IfStatement") {
      validateBlockShape(statement.consequent, "if consequent", fail)
      if (statement.alternate) validateBlockShape(statement.alternate, "if alternate", fail)
    }
    if (statement.kind == "ForEachStatement") validateBlockShape(statement.body, "for-each body", fail)
  }
}

/**
 * Validates declarations and expression types within lexical scopes.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, records?: Map<string, import("./types.js").RecordDeclaration>}} [visible] - Program imports visible during validation.
 * @returns {void}
 */
function validateModuleTypes(module, fail, normalizeOperations, visible = {}) {
  const records = validateRecordDeclarations(module.records ?? [], fail, normalizeOperations, visible.records)
  /** @type {Map<string, import("./types.js").FunctionDeclaration>} */
  const functions = new Map(visible.functions ?? [])
  const declarationIds = new Set([...functions.values()].flatMap(({id}) => typeof id == "string" ? [id] : []))

  for (const [index, functionDeclaration] of module.functions.entries()) {
    if (normalizeOperations) functionDeclaration.id = `function:${index}`
    if (typeof functionDeclaration.id != "string" || !/^(?:[a-z][a-z0-9._-]*#)?function:[0-9]+$/u.test(functionDeclaration.id) ||
      declarationIds.has(functionDeclaration.id)) {
      fail("DUPLICATE_BINDING", "Duplicate or invalid function declaration identity.", functionDeclaration.location)
    }
    if (functions.has(functionDeclaration.name)) {
      fail("DUPLICATE_BINDING", `duplicate function '${functionDeclaration.name}'.`, roleLocation(functionDeclaration, "name"))
    }
    declarationIds.add(functionDeclaration.id)
    functions.set(functionDeclaration.name, functionDeclaration)
  }

  const reservedValueNames = new Set([
    ...functions.keys(),
    ...[...records.values()].map((declaration) => declaration.name)
  ])

  for (const functionDeclaration of module.functions) {
    validateFunction(functionDeclaration, functions, records, reservedValueNames, fail, normalizeOperations)
  }

  const entryScope = createScope(undefined, module.entryPoint.body.statements, reservedValueNames)

  validateBlock(module.entryPoint.body, entryScope, undefined, functions, records, fail, normalizeOperations)
}

/**
 * Validates nominal declarations and returns their stable identity registry.
 * @param {unknown} declarations - Candidate ordered declarations.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether parser-authored identities are assigned.
 * @param {Map<string, import("./types.js").RecordDeclaration>} [visibleRecords] - Imported record declarations by identity.
 * @returns {RecordRegistry} Validated declarations by identity.
 */
function validateRecordDeclarations(declarations, fail, normalizeOperations, visibleRecords = new Map()) {
  if (!Array.isArray(declarations)) return fail("TYPE_MISMATCH", "Record declarations must be an ordered array.", /** @type {never} */ (undefined))
  /** @type {RecordRegistry} */
  const records = new Map(visibleRecords)
  const names = new Set()

  for (let recordIndex = 0; recordIndex < declarations.length; recordIndex += 1) {
    const declaration = declarations[recordIndex]

    if (!declaration || declaration.kind != "RecordDeclaration" || !Array.isArray(declaration.fields)) {
      return fail("TYPE_MISMATCH", "Malformed record declaration.", declaration?.location)
    }
    if (normalizeOperations) declaration.id = `record:${recordIndex}`
    if (typeof declaration.id != "string" || !/^(?:[a-z][a-z0-9._-]*#)?record:[0-9]+$/u.test(declaration.id) || records.has(declaration.id)) {
      fail("DUPLICATE_RECORD", "Duplicate or invalid record declaration identity.", declaration.location)
    }
    if (names.has(declaration.name)) {
      fail("DUPLICATE_RECORD", `Duplicate record '${declaration.name}'.`, roleLocation(declaration, "name"))
    }
    names.add(declaration.name)
    records.set(declaration.id, declaration)
  }

  for (const declaration of declarations) {
    const fieldNames = new Set()

    for (let fieldIndex = 0; fieldIndex < declaration.fields.length; fieldIndex += 1) {
      const field = declaration.fields[fieldIndex]

      if (!field || field.kind != "RecordField") fail("TYPE_MISMATCH", "Malformed record field.", field?.location ?? declaration.location)
      if (normalizeOperations) field.id = `${declaration.id}:field:${fieldIndex}`
      if (typeof field.id != "string" || field.id != `${declaration.id}:field:${fieldIndex}`) {
        fail("DUPLICATE_FIELD", "Duplicate or invalid record field identity.", field.location)
      }
      if (fieldNames.has(field.name)) fail("DUPLICATE_FIELD", `Duplicate field '${field.name}'.`, roleLocation(field, "name"))
      fieldNames.add(field.name)
      validateValueTypeReference(field.type, field.location, fail, undefined, records)
    }
  }
  validateDirectRecordRecursion(declarations, records, fail)

  return records
}

/**
 * Rejects cycles composed solely of unmediated record fields.
 * @param {import("./types.js").RecordDeclaration[]} declarations - Valid declarations.
 * @param {RecordRegistry} records - Declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {void}
 */
function validateDirectRecordRecursion(declarations, records, fail) {
  const complete = new Set()

  /**
   * Visits one declaration along an unmediated record path.
   * @param {import("./types.js").RecordDeclaration} declaration - Current declaration.
   * @param {Set<string>} active - Declaration identities active on this path.
   * @returns {void}
   */
  function visit(declaration, active) {
    if (complete.has(/** @type {string} */ (declaration.id))) return
    const next = new Set(active)

    next.add(/** @type {string} */ (declaration.id))
    for (const field of declaration.fields) {
      if (field.type.kind != "RecordType") continue
      if (next.has(field.type.declarationId)) {
        fail("ILLEGAL_RECORD_RECURSION", `Direct value-recursive field '${field.name}'.`, typeLocation(field.type, field.location))
      }
      const referenced = records.get(field.type.declarationId)

      if (referenced) visit(referenced, next)
    }
    complete.add(/** @type {string} */ (declaration.id))
  }

  for (const declaration of declarations) visit(declaration, new Set())
}

/**
 * Validates one non-void function and its complete control flow.
 * @param {import("./types.js").FunctionDeclaration} declaration - Function declaration.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {Set<string>} reservedValueNames - Module functions and nominal constructors unavailable to lexical bindings.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @returns {void}
 */
function validateFunction(declaration, functions, records, reservedValueNames, fail, normalizeOperations) {
  const scope = createScope(undefined, declaration.body.statements, reservedValueNames)

  for (const parameter of declaration.parameters) {
    const type = validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records)

    declareBinding(parameter.name, {knownValue: undefined, mutable: false, type}, roleLocation(parameter, "name"), scope, fail)
  }

  const returnType = validateReturnTypeReference(declaration.returnType, declaration.location, fail, records)
  const returns = validateBlock(declaration.body, scope, returnType, functions, records, fail, normalizeOperations)

  if (!isVoidType(returnType) && !returns) {
    fail("MISSING_RETURN", `Function '${declaration.name}' does not return on every reachable path.`, declaration.location)
  }
}

/**
 * Validates one ordered block and reports whether every path returns.
 * @param {import("./types.js").Block} block - Semantic block.
 * @param {Scope} scope - Scope belonging to this block.
 * @param {import("./types.js").SemanticFunctionReturnType | undefined} returnType - Function return type, absent for entry points.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @param {number} [loopDepth] - Number of active semantic loops.
 * @returns {boolean} Whether every path through the block completes abruptly.
 */
function validateBlock(block, scope, returnType, functions, records, fail, normalizeOperations, loopDepth = 0) {
  let alwaysReturns = false

  for (const statement of block.statements) {
    if (alwaysReturns) fail("UNREACHABLE_STATEMENT", "Statement is unreachable.", statement.location)

    if (statement.kind == "LocalDeclaration") {
      const declaredType = validateValueTypeReference(statement.type, statement.location, fail, undefined, records)
      const initializerType = inferValueExpressionType(
        statement.initializer, scope, functions, records, fail, normalizeOperations, "an initializer", declaredType
      )

      scope.pending.delete(statement.name)
      if (!sameType(initializerType, declaredType)) {
        fail("TYPE_MISMATCH", `Initializer type ${typeDescription(initializerType)}; expected ${typeDescription(declaredType)}.`, statement.initializer.location)
      }
      declareBinding(statement.name, {
        knownValue: knownValueForExpression(statement.initializer, scope),
        mutable: statement.mutable,
        type: declaredType
      }, roleLocation(statement, "name"), scope, fail)
      continue
    }
    if (statement.kind == "AssignmentStatement") {
      const binding = resolveBinding(statement.target.name, statement.target.location, scope, fail)
      const expressionType = inferValueExpressionType(
        statement.expression, scope, functions, records, fail, normalizeOperations, "an assignment", binding.type
      )

      if (!binding.mutable) {
        fail("IMMUTABLE_ASSIGNMENT", `Cannot assign to immutable binding '${statement.target.name}'.`, statement.target.location)
      }
      if (!sameType(expressionType, binding.type)) {
        fail("TYPE_MISMATCH", `Assignment type ${typeDescription(expressionType)}; expected ${typeDescription(binding.type)}.`, statement.expression.location)
      }
      binding.knownValue = knownValueForExpression(statement.expression, scope)
      scope.presenceProofs.delete(binding)
      continue
    }
    if (statement.kind == "PrintStatement") {
      const printedType = inferValueExpressionType(statement.expression, scope, functions, records, fail, normalizeOperations, "a print value")

      if (printedType.kind != "TypeReference") {
        fail("TYPE_MISMATCH", "Collections and records cannot be printed directly.", statement.expression.location)
      }
      continue
    }
    if (statement.kind == "ExpressionStatement") {
      if (!statement.expression || statement.expression.kind != "CallExpression") {
        fail("TYPE_MISMATCH", "Expression statement must contain a direct call.", statement.location)
      }
      const expressionType = inferExpressionType(statement.expression, scope, functions, records, fail, normalizeOperations)

      if (expressionType != "void") {
        fail("TYPE_MISMATCH", "Expression statements may contain only void calls.", statement.expression.location)
      }
      continue
    }
    if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
      if (loopDepth == 0) {
        const control = statement.kind == "BreakStatement" ? "break" : "continue"

        fail(`ILLEGAL_${control.toUpperCase()}_CONTEXT`, `${control[0].toUpperCase()}${control.slice(1)} statement outside a loop.`, statement.location)
      }
      alwaysReturns = true
      continue
    }
    if (statement.kind == "ReturnStatement") {
      if (!returnType) fail("ILLEGAL_RETURN_CONTEXT", "Return statement outside a function.", statement.location)
      if (isVoidType(returnType)) {
        if (statement.expression) {
          fail("VOID_RETURN_VALUE", "Void function cannot return a value.", statement.expression.location)
        }
      } else {
        if (!statement.expression) {
          fail("MISSING_RETURN_VALUE", `Function return requires a ${typeDescription(returnType)} value.`, statement.location)
        }
        const actualType = inferValueExpressionType(
          statement.expression,
          scope,
          functions,
          records,
          fail,
          normalizeOperations,
          "a returned value",
          returnType
        )

        if (!sameType(actualType, returnType)) {
          fail("TYPE_MISMATCH", `Return type ${typeDescription(actualType)}; expected ${typeDescription(returnType)}.`, statement.expression.location)
        }
      }
      alwaysReturns = true
      continue
    }
    if (statement.kind == "IfStatement") {
      const conditionType = inferValueExpressionType(statement.condition, scope, functions, records, fail, normalizeOperations, "a condition")

      if (!isScalarType(conditionType, "boolean")) {
        fail("NON_BOOLEAN_CONDITION", `If condition type ${typeDescription(conditionType)}; expected boolean.`, statement.condition.location)
      }
      const visibleBindings = bindingsVisibleFrom(scope)
      const initialKnownValues = visibleBindings.map((binding) => binding.knownValue)
      const consequentScope = createScope(scope, statement.consequent.statements)
      const alternateScope = createScope(scope, statement.alternate?.statements ?? [])
      applyPresenceNarrowing(statement.condition, scope, consequentScope, true)
      applyPresenceNarrowing(statement.condition, scope, alternateScope, false)
      const consequentReturns = validateBlock(statement.consequent, consequentScope, returnType, functions, records, fail, normalizeOperations, loopDepth)
      const consequentKnownValues = visibleBindings.map((binding) => binding.knownValue)

      visibleBindings.forEach((binding, index) => {
        binding.knownValue = initialKnownValues[index]
      })
      let alternateReturns = false

      if (statement.alternate) {
        alternateReturns = validateBlock(statement.alternate, alternateScope, returnType, functions, records, fail, normalizeOperations, loopDepth)
      }
      const alternateKnownValues = visibleBindings.map((binding) => binding.knownValue)

      visibleBindings.forEach((binding, index) => {
        if (consequentReturns && !alternateReturns) binding.knownValue = alternateKnownValues[index]
        else if (!consequentReturns && alternateReturns) binding.knownValue = consequentKnownValues[index]
        else if (!consequentReturns && !alternateReturns && consequentKnownValues[index] === alternateKnownValues[index]) {
          binding.knownValue = consequentKnownValues[index]
        } else binding.knownValue = undefined
      })
      const continuingProofs = consequentReturns && !alternateReturns
        ? alternateScope.presenceProofs
        : !consequentReturns && alternateReturns
          ? consequentScope.presenceProofs
          : !consequentReturns && !alternateReturns
            ? new Set([...consequentScope.presenceProofs].filter((binding) => alternateScope.presenceProofs.has(binding)))
            : new Set()
      const visibleSet = new Set(visibleBindings)

      scope.presenceProofs.clear()
      for (const binding of continuingProofs) {
        if (visibleSet.has(binding)) scope.presenceProofs.add(binding)
      }
      alwaysReturns = consequentReturns && alternateReturns
      continue
    }
    if (statement.kind == "ForEachStatement") {
      const listType = inferValueExpressionType(statement.list, scope, functions, records, fail, normalizeOperations, "an iteration collection")

      if (listType.kind != "ListType") {
        fail("TYPE_MISMATCH", `Iteration collection type ${typeDescription(listType)}; expected list.`, statement.list.location)
      }
      if (!statement.valueBinding || statement.valueBinding.kind != "ValueBinding") {
        fail("TYPE_MISMATCH", "Iteration requires one typed value binding.", statement.location)
      }
      if (statement.valueBinding.mutable !== false) {
        fail("TYPE_MISMATCH", "Iteration binding must be immutable.", statement.valueBinding.location ?? statement.location)
      }
      const bindingType = validateValueTypeReference(statement.valueBinding.type, statement.valueBinding.location, fail, undefined, records)

      if (!sameType(bindingType, listType.elementType)) {
        fail("TYPE_MISMATCH", `Iteration binding type ${typeDescription(bindingType)}; expected ${typeDescription(listType.elementType)}.`,
          typeLocation(statement.valueBinding.type, statement.valueBinding.location))
      }
      const assignedOuterBindings = outerMutableBindingsAssignedBy(statement.body, scope)

      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
      const loopScope = createScope(scope, statement.body.statements)

      declareBinding(statement.valueBinding.name, {
        knownValue: undefined,
        mutable: false,
        type: bindingType
      }, roleLocation(statement.valueBinding, "name"), loopScope, fail)
      validateBlock(statement.body, loopScope, returnType, functions, records, fail, normalizeOperations, loopDepth + 1)
      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
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

  return {
    bindings: new Map(),
    parent,
    pending,
    presenceProofs: new Set(parent?.presenceProofs ?? []),
    usedNames: parent?.usedNames ?? new Set(reservedNames)
  }
}

/**
 * Applies a simple-identifier presence proof to exactly the branch where the test is true.
 * @param {import("./types.js").Expression} condition - Validated branch condition.
 * @param {Scope} sourceScope - Scope containing the tested binding.
 * @param {Scope} branchScope - Branch-local proof scope.
 * @param {boolean} branchWhenTrue - Whether this is the condition's true branch.
 * @returns {void}
 */
function applyPresenceNarrowing(condition, sourceScope, branchScope, branchWhenTrue) {
  let test = condition
  let presentWhenTrue = true

  if (condition.kind == "UnaryExpression" && condition.operation == "BooleanNot" &&
    condition.operand.kind == "OptionalIsPresent") {
    test = condition.operand
    presentWhenTrue = false
  }
  if (test.kind != "OptionalIsPresent") return
  const binding = findBinding(test.operand.name, sourceScope)

  if (!binding) return
  if (branchWhenTrue == presentWhenTrue) branchScope.presenceProofs.add(binding)
  else branchScope.presenceProofs.delete(binding)
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
 * @param {Set<object>} [seen] - Active recursive type path.
 * @param {RecordRegistry} [records] - Record declarations by identity.
 * @returns {import("./types.js").SemanticValueType} Validated value type.
 */
function validateValueTypeReference(type, location, fail, seen, records = new Map()) {
  const candidate = validateTypeReference(type, location, fail, seen, records)

  if (isVoidType(candidate)) return fail("VOID_AS_VALUE", "Void is valid only as a function return type.", typeLocation(type, location))

  return candidate
}

/**
 * Validates one function return type reference.
 * @param {unknown} type - Candidate semantic return type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {RecordRegistry} [records] - Record declarations by identity.
 * @returns {import("./types.js").SemanticFunctionReturnType} Validated return type.
 */
function validateReturnTypeReference(type, location, fail, records = new Map()) {
  return validateTypeReference(type, location, fail, new Set(), records)
}

/**
 * Validates one recursive semantic type-reference shape.
 * @param {unknown} type - Candidate semantic type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {Set<object>} [seen] - Active recursive type path.
 * @param {RecordRegistry} [records] - Record declarations by identity.
 * @returns {import("./types.js").SemanticFunctionReturnType} Validated type.
 */
function validateTypeReference(type, location, fail, seen = new Set(), records = new Map()) {
  if (!type || typeof type != "object" || Array.isArray(type)) {
    return fail("TYPE_MISMATCH", "Unsupported semantic type.", location)
  }

  const candidate = /** @type {import("./types.js").SemanticFunctionReturnType} */ (type)

  if (candidate.kind == "TypeReference") {
    if (!isScalarTypeName(candidate.name) && candidate.name != "void") {
      fail("TYPE_MISMATCH", "Unsupported scalar or void return type.", typeLocation(candidate, location))
    }

    return candidate
  }
  if (candidate.kind == "RecordType") {
    if (Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",") != "declarationId,kind" ||
      typeof candidate.declarationId != "string" || !records.has(candidate.declarationId)) {
      fail("UNKNOWN_RECORD", `Unknown record declaration '${String(candidate.declarationId)}'.`, typeLocation(candidate, location))
    }

    return candidate
  }
  if (candidate.kind == "ListType") {
    if (seen.has(candidate)) return fail("TYPE_MISMATCH", "Recursive collection types cannot contain cycles.", typeLocation(candidate, location))
    seen.add(candidate)
    const elementType = validateValueTypeReference(candidate.elementType, typeLocation(candidate, location, "elementType"), fail, seen, records)

    seen.delete(candidate)

    if (candidate.elementType !== elementType) candidate.elementType = elementType

    return candidate
  }
  if (candidate.kind == "MapType") {
    if (seen.has(candidate)) return fail("TYPE_MISMATCH", "Recursive collection types cannot contain cycles.", typeLocation(candidate, location))
    seen.add(candidate)
    const keyType = validateValueTypeReference(candidate.keyType, typeLocation(candidate, location, "keyType"), fail, seen, records)

    if (!isScalarType(keyType, "string")) {
      fail("TYPE_MISMATCH", `Map key type ${typeDescription(keyType)}; expected string.`, typeLocation(candidate.keyType, location))
    }
    const valueType = validateValueTypeReference(candidate.valueType, typeLocation(candidate, location, "valueType"), fail, seen, records)

    seen.delete(candidate)

    if (candidate.keyType !== keyType) candidate.keyType = /** @type {import("./types.js").TypeReference} */ (keyType)
    if (candidate.valueType !== valueType) candidate.valueType = valueType

    return candidate
  }
  if (candidate.kind == "OptionalType") {
    if (Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",") != "kind,valueType") {
      return fail("TYPE_MISMATCH", "Malformed optional type.", typeLocation(candidate, location))
    }
    if (seen.has(candidate)) return fail("TYPE_MISMATCH", "Recursive optional types cannot contain cycles.", typeLocation(candidate, location))
    seen.add(candidate)
    const valueType = validateValueTypeReference(candidate.valueType, typeLocation(candidate, location, "valueType"), fail, seen, records)

    seen.delete(candidate)
    if (valueType.kind == "OptionalType") {
      fail("INVALID_OPTIONAL_CONSTITUENT", "Optional values cannot directly contain another optional.", typeLocation(candidate, location, "valueType"))
    }
    if (candidate.valueType !== valueType) candidate.valueType = valueType

    return candidate
  }

  return fail("TYPE_MISMATCH", "Unsupported semantic type.", typeLocation(candidate, location))
}

/**
 * Infers a value expression and rejects the non-value result of a void call.
 * @param {import("./types.js").Expression} expression - Semantic expression.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to normalize frontend intent and call resolution.
 * @param {string} context - Value context for diagnostics.
 * @param {import("./types.js").SemanticValueType} [expectedType] - Contextual collection type.
 * @returns {import("./types.js").SemanticValueType} Expression value type.
 */
function inferValueExpressionType(expression, scope, functions, records, fail, normalizeOperations, context, expectedType) {
  const type = inferExpressionType(expression, scope, functions, records, fail, normalizeOperations, expectedType)

  if (type == "void") fail("VOID_AS_VALUE", `Void call cannot be used as ${context}.`, expression.location)

  return type
}

/**
 * Infers and validates one expression.
 * @param {import("./types.js").Expression} expression - Semantic expression.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @param {import("./types.js").SemanticValueType} [expectedType] - Contextual collection type.
 * @returns {import("./types.js").SemanticValueType | "void"} Expression type.
 */
function inferExpressionType(expression, scope, functions, records, fail, normalizeOperations, expectedType) {
  if (expression.kind == "IdentifierExpression") return resolveBinding(expression.name, expression.location, scope, fail).type

  if (expression.kind == "IntegerLiteral") {
    if (!Number.isSafeInteger(expression.value)) fail("TYPE_MISMATCH", "Non-safe integer literal.", expression.location)
    return scalarType("integer")
  }
  if (expression.kind == "BooleanLiteral") {
    if (typeof Reflect.get(expression, "value") != "boolean") {
      fail("TYPE_MISMATCH", "Invalid boolean literal value.", expression.location)
    }
    return scalarType("boolean")
  }
  if (expression.kind == "StringLiteral") {
    const value = Reflect.get(expression, "value")

    if (typeof value != "string" || !hasOnlyUnicodeScalars(value)) {
      fail("TYPE_MISMATCH", "Invalid Unicode string literal.", expression.location)
    }
    return scalarType("string")
  }
  if (expression.kind == "OptionalNone") {
    if (!expectedType || expectedType.kind != "OptionalType") {
      return fail("MISSING_TYPE", "Optional absence requires an explicit optional type.", expression.location)
    }

    return expectedType
  }
  if (expression.kind == "OptionalSome") {
    if (!expectedType || expectedType.kind != "OptionalType") {
      return fail("MISSING_TYPE", "Optional presence requires an explicit optional type.", expression.location)
    }
    const valueType = inferValueExpressionType(
      expression.value, scope, functions, records, fail, normalizeOperations, "an optional present value", expectedType.valueType
    )

    if (!sameType(valueType, expectedType.valueType)) {
      fail("TYPE_MISMATCH", `Optional present type ${typeDescription(valueType)}; expected ${typeDescription(expectedType.valueType)}.`, expression.value.location)
    }

    return expectedType
  }
  if (expression.kind == "OptionalIsPresent") {
    if (!expression.operand || expression.operand.kind != "IdentifierExpression") {
      return fail("TYPE_MISMATCH", "Optional presence test requires one simple identifier.", expression.location)
    }
    const operandType = resolveBinding(expression.operand.name, expression.operand.location, scope, fail).type

    if (operandType.kind != "OptionalType") {
      return fail("TYPE_MISMATCH", `Presence test received ${typeDescription(operandType)}; expected optional.`, expression.operand.location)
    }

    return scalarType("boolean")
  }
  if (expression.kind == "OptionalUnwrap") {
    if (!expression.operand || expression.operand.kind != "IdentifierExpression") {
      return fail("TYPE_MISMATCH", "Optional unwrap requires one simple identifier.", expression.location)
    }
    const binding = resolveBinding(expression.operand.name, expression.operand.location, scope, fail)

    if (binding.type.kind != "OptionalType") {
      return fail("TYPE_MISMATCH", `Optional unwrap received ${typeDescription(binding.type)}; expected optional.`, expression.operand.location)
    }
    if (!scope.presenceProofs.has(binding)) {
      return fail("UNCHECKED_OPTIONAL_UNWRAP", `Optional binding '${expression.operand.name}' is not proven present.`, expression.location)
    }

    return binding.type.valueType
  }
  if (expression.kind == "ListLiteral") {
    if (!expectedType || expectedType.kind != "ListType") {
      return fail("MISSING_TYPE", "List literal requires an explicit recursive list type.", expression.location)
    }
    if (!Array.isArray(expression.elements)) {
      return fail("TYPE_MISMATCH", "List literal elements must be a dense source-ordered array.", expression.location)
    }
    for (let index = 0; index < expression.elements.length; index++) {
      if (!Object.hasOwn(expression.elements, index)) {
        fail("TYPE_MISMATCH", "Sparse list literals are outside the implemented subset.", expression.location)
      }
      const element = expression.elements[index]
      const actual = inferValueExpressionType(
        element, scope, functions, records, fail, normalizeOperations, "a list element", expectedType.elementType
      )

      if (!sameType(actual, expectedType.elementType)) {
        fail("TYPE_MISMATCH", `List element type ${typeDescription(actual)}; expected ${typeDescription(expectedType.elementType)}.`, element.location)
      }
    }

    return expectedType
  }
  if (expression.kind == "MapLiteral") {
    if (!expectedType || expectedType.kind != "MapType") {
      return fail("MISSING_TYPE", "Map literal requires an explicit recursive map type.", expression.location)
    }
    if (!isScalarType(expectedType.keyType, "string")) {
      return fail("TYPE_MISMATCH", "Map key type must be string.", typeLocation(expectedType.keyType, expression.location))
    }
    if (!Array.isArray(expression.entries)) {
      return fail("TYPE_MISMATCH", "Map literal entries must be a dense source-ordered array.", expression.location)
    }
    const keys = new Set()

    for (let index = 0; index < expression.entries.length; index++) {
      if (!Object.hasOwn(expression.entries, index)) {
        fail("TYPE_MISMATCH", "Sparse map literals are outside the implemented subset.", expression.location)
      }
      const entry = expression.entries[index]

      if (!entry || entry.kind != "MapEntry" || !entry.key || entry.key.kind != "StringLiteral") {
        fail("TYPE_MISMATCH", "Map entries require literal string keys.", entry?.location ?? expression.location)
      }
      inferValueExpressionType(entry.key, scope, functions, records, fail, normalizeOperations, "a map key", expectedType.keyType)
      if (isNumericString(entry.key.value)) {
        fail("INVALID_MAP_KEY", "Map initializer keys must be nonnumeric strings.", entry.key.location)
      }
      if (keys.has(entry.key.value)) {
        fail("DUPLICATE_MAP_KEY", `Duplicate map key '${entry.key.value}'.`, entry.key.location)
      }
      keys.add(entry.key.value)
      const actual = inferValueExpressionType(
        entry.value, scope, functions, records, fail, normalizeOperations, "a map value", expectedType.valueType
      )

      if (!sameType(actual, expectedType.valueType)) {
        fail("TYPE_MISMATCH", `Map value type ${typeDescription(actual)}; expected ${typeDescription(expectedType.valueType)}.`, entry.value.location)
      }
    }

    return expectedType
  }
  if (expression.kind == "ListIndexExpression") {
    const collectionType = inferValueExpressionType(expression.collection, scope, functions, records, fail, normalizeOperations, "a list receiver")
    const indexType = inferValueExpressionType(expression.index, scope, functions, records, fail, normalizeOperations, "a list index", scalarType("integer"))

    if (collectionType.kind != "ListType") {
      return fail("TYPE_MISMATCH", `List index receiver type ${typeDescription(collectionType)}; expected list.`, expression.collection.location)
    }
    if (!isScalarType(indexType, "integer")) {
      fail("TYPE_MISMATCH", `List index type ${typeDescription(indexType)}; expected integer.`, expression.index.location)
    }
    const knownCollection = knownValueForExpression(expression.collection, scope)
    const knownIndex = knownValueForExpression(expression.index, scope)

    if (knownCollection?.kind == "ListLiteral" && knownIndex?.kind == "IntegerLiteral" &&
      (knownIndex.value < 0 || knownIndex.value >= knownCollection.elements.length)) {
      fail("INDEX_OUT_OF_BOUNDS", `List index ${knownIndex.value} is outside a literal list of size ${knownCollection.elements.length}.`, expression.location)
    }
    const proven = provenListElement(expression.collection, expression.index, scope)

    validateAccessTotality(expression, proven !== undefined, normalizeOperations, fail)

    return collectionType.elementType
  }
  if (expression.kind == "MapLookupExpression") {
    const collectionType = inferValueExpressionType(expression.collection, scope, functions, records, fail, normalizeOperations, "a map receiver")
    const keyType = inferValueExpressionType(expression.key, scope, functions, records, fail, normalizeOperations, "a map key", scalarType("string"))

    if (collectionType.kind != "MapType") {
      return fail("TYPE_MISMATCH", `Map lookup receiver type ${typeDescription(collectionType)}; expected map.`, expression.collection.location)
    }
    if (!isScalarType(keyType, "string")) {
      fail("TYPE_MISMATCH", `Map lookup key type ${typeDescription(keyType)}; expected string.`, expression.key.location)
    }
    const knownCollection = knownValueForExpression(expression.collection, scope)
    const knownKey = knownValueForExpression(expression.key, scope)

    if (knownCollection?.kind == "MapLiteral" && knownKey?.kind == "StringLiteral" &&
      !knownCollection.entries.some((entry) => entry.key.value == knownKey.value)) {
      fail("MISSING_MAP_KEY", `Map key '${knownKey.value}' is absent from the literal initializer.`, expression.location)
    }
    const proven = provenMapValue(expression.collection, expression.key, scope)

    validateAccessTotality(expression, proven !== undefined, normalizeOperations, fail)

    return collectionType.valueType
  }
  if (expression.kind == "CollectionSizeExpression") {
    const collectionType = inferValueExpressionType(expression.collection, scope, functions, records, fail, normalizeOperations, "a collection-size receiver")

    if (collectionType.kind != "ListType" && collectionType.kind != "MapType") {
      return fail("TYPE_MISMATCH", `Collection size receiver type ${typeDescription(collectionType)}; expected list or map.`, expression.collection.location)
    }
    const collectionKind = collectionType.kind == "ListType" ? "list" : "map"

    if (normalizeOperations) {
      if (expression.collectionKind !== undefined && expression.collectionKind != collectionKind) {
        fail("TYPE_MISMATCH", "Collection size operation does not match its receiver type.", expression.location)
      }
      expression.collectionKind = collectionKind
    }
    else if (expression.collectionKind != collectionKind) {
      fail("TYPE_MISMATCH", "Collection size kind does not match its receiver type.", expression.location)
    }

    return scalarType("integer")
  }
  if (expression.kind == "RecordConstruction") {
    const recordType = validateValueTypeReference(expression.record, expression.location, fail, undefined, records)

    if (recordType.kind != "RecordType") {
      return fail("TYPE_MISMATCH", "Record construction requires a nominal record type.", expression.location)
    }
    const declaration = records.get(recordType.declarationId)

    if (!declaration) return fail("UNKNOWN_RECORD", `Unknown record declaration '${recordType.declarationId}'.`, expression.location)
    if (!Array.isArray(expression.arguments) || expression.arguments.some((_argument, index) => !Object.hasOwn(expression.arguments, index))) {
      return fail("TYPE_MISMATCH", "Record construction arguments must be a dense ordered array.", expression.location)
    }
    if (expression.arguments.length != declaration.fields.length) {
      return fail(
        "RECORD_ARITY_MISMATCH",
        `Record '${declaration.name}' construction has ${expression.arguments.length} arguments; expected ${declaration.fields.length}.`,
        expression.location
      )
    }
    for (let index = 0; index < expression.arguments.length; index += 1) {
      const argument = expression.arguments[index]
      const field = declaration.fields[index]
      const actual = inferValueExpressionType(
        argument, scope, functions, records, fail, normalizeOperations, `record field '${field.name}'`, field.type
      )

      if (!sameType(actual, field.type)) {
        fail("TYPE_MISMATCH", `Record field '${field.name}' argument type ${typeDescription(actual)}; expected ${typeDescription(field.type)}.`, argument.location)
      }
    }

    return recordType
  }
  if (expression.kind == "MemberRead") {
    const receiverType = inferValueExpressionType(expression.receiver, scope, functions, records, fail, normalizeOperations, "a member receiver")

    if (receiverType.kind != "RecordType") {
      return fail("INVALID_MEMBER_RECEIVER", `Member receiver type ${typeDescription(receiverType)}; expected record.`, expression.receiver.location)
    }
    const declaration = records.get(receiverType.declarationId)

    if (!declaration) return fail("UNKNOWN_RECORD", `Unknown record declaration '${receiverType.declarationId}'.`, expression.receiver.location)
    const field = declaration.fields.find((candidate) => candidate.id == expression.field) ??
      (normalizeOperations ? declaration.fields.find((candidate) => candidate.name == expression.field) : undefined)

    if (!field) fail("UNKNOWN_FIELD", `Record '${declaration.name}' has no field '${expression.field}'.`, roleLocation(expression, "member"))
    if (normalizeOperations) expression.field = /** @type {string} */ (field.id)

    return field.type
  }
  if (expression.kind == "CallExpression") {
    const functionDeclaration = functions.get(expression.callee)

    if (!functionDeclaration) {
      return fail("UNRESOLVED_BINDING", `Unknown function '${expression.callee}'.`, roleLocation(expression, "callee"))
    }
    const resolution = signatureFor(functionDeclaration, records, fail)

    if (normalizeOperations) expression.resolution = resolution
    else validateResolution(expression.resolution, resolution, expression.location, fail)
    if (expression.arguments.length != functionDeclaration.parameters.length) {
      return fail("TYPE_MISMATCH", `Call argument count for '${expression.callee}'.`, expression.location)
    }
    for (let index = 0; index < expression.arguments.length; index++) {
      const argument = expression.arguments[index]
      const expectedType = validateValueTypeReference(functionDeclaration.parameters[index].type, functionDeclaration.parameters[index].location, fail, undefined, records)
      const actualType = inferValueExpressionType(
        argument, scope, functions, records, fail, normalizeOperations, "a call argument", expectedType
      )

      if (!sameType(actualType, expectedType)) {
        fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actualType)}; expected ${typeDescription(expectedType)}.`, argument.location)
      }
    }
    const returnType = validateReturnTypeReference(functionDeclaration.returnType, functionDeclaration.location, fail, records)

    return isVoidType(returnType) ? "void" : returnType
  }
  if (expression.kind == "UnaryExpression") {
    const operand = inferValueExpressionType(expression.operand, scope, functions, records, fail, normalizeOperations, "a unary operand")
    const operandType = scalarNameForOperation(operand, expression.operand.location, fail)
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
    return scalarType(signature.result)
  }
  if (expression.kind == "BinaryExpression") {
    const left = inferValueExpressionType(expression.left, scope, functions, records, fail, normalizeOperations, "a binary operand")
    const right = inferValueExpressionType(expression.right, scope, functions, records, fail, normalizeOperations, "a binary operand")
    const leftType = scalarNameForOperation(left, expression.left.location, fail)
    const rightType = scalarNameForOperation(right, expression.right.location, fail)
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
    return scalarType(signature.result)
  }

  const unexpected = /** @type {{kind: string, location: import("./types.js").SourceLocation}} */ (expression)

  return fail("TYPE_MISMATCH", unexpected.kind, unexpected.location)
}

/**
 * Builds the exact semantic signature bound to one declaration.
 * @param {import("./types.js").FunctionDeclaration} declaration - Resolved declaration.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").ResolvedFunctionSignature} Detached signature binding.
 */
function signatureFor(declaration, records, fail) {
  const parameterTypes = declaration.parameters.map((parameter) =>
    validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records))
  const returnType = validateReturnTypeReference(declaration.returnType, declaration.location, fail, records)

  return {
    declarationId: /** @type {string} */ (declaration.id),
    kind: "ResolvedFunctionSignature",
    parameterTypes: parameterTypes.map((type) => /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type))),
    returnType: typeIdentity(returnType)
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
    !Array.isArray(candidate.parameterTypes) || !validTypeIdentity(candidate.returnType, true) ||
    candidate.declarationId != expected.declarationId ||
    !sameTypeIdentity(candidate.returnType, expected.returnType) || candidate.parameterTypes.length != expected.parameterTypes.length) {
    fail("TYPE_MISMATCH", "Call resolution does not match its declaration signature.", location)
  }
  for (let index = 0; index < candidate.parameterTypes.length; index++) {
    const type = candidate.parameterTypes[index]

    if (!Object.hasOwn(candidate.parameterTypes, index) || !validTypeIdentity(type, false) ||
      !sameTypeIdentity(type, expected.parameterTypes[index])) {
      fail("TYPE_MISMATCH", "Call resolution does not match its declaration signature.", location)
    }
  }
}

/**
 * Converts a semantic type to its detached call-resolution identity.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Validated semantic type.
 * @returns {import("./types.js").FunctionReturnTypeIdentity} Detached identity.
 */
function typeIdentity(type) {
  if (type.kind == "TypeReference") return type.name
  if (type.kind == "RecordType") return {declarationId: type.declarationId, kind: "RecordType"}
  if (type.kind == "ListType") return {elementType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.elementType)), kind: "ListType"}
  if (type.kind == "OptionalType") return {kind: "OptionalType", valueType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.valueType))}

  return {
    keyType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.keyType)),
    kind: "MapType",
    valueType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.valueType))
  }
}

/**
 * Checks one externally supplied recursive type identity.
 * @param {unknown} type - Candidate identity.
 * @param {boolean} allowVoid - Whether void is permitted.
 * @param {Set<object>} [seen] - Active recursion path.
 * @returns {boolean} Whether the identity is closed and acyclic.
 */
function validTypeIdentity(type, allowVoid, seen = new Set()) {
  if (typeof type == "string") return isScalarTypeName(type) || allowVoid && type == "void"
  if (!type || typeof type != "object" || Array.isArray(type) || seen.has(type)) return false

  seen.add(type)
  const candidate = /** @type {Record<string, unknown>} */ (type)
  let valid = false

  if (candidate.kind == "ListType" && Object.keys(candidate).sort().join(",") == "elementType,kind") {
    valid = validTypeIdentity(candidate.elementType, false, seen)
  } else if (candidate.kind == "MapType" && Object.keys(candidate).sort().join(",") == "keyType,kind,valueType") {
    valid = candidate.keyType == "string" && validTypeIdentity(candidate.valueType, false, seen)
  } else if (candidate.kind == "OptionalType" && Object.keys(candidate).sort().join(",") == "kind,valueType") {
    valid = validTypeIdentity(candidate.valueType, false, seen) &&
      !(candidate.valueType && typeof candidate.valueType == "object" && Reflect.get(candidate.valueType, "kind") == "OptionalType")
  } else if (candidate.kind == "RecordType" && Object.keys(candidate).sort().join(",") == "declarationId,kind") {
    valid = typeof candidate.declarationId == "string" && /^(?:[a-z][a-z0-9._-]*#)?record:[0-9]+$/u.test(candidate.declarationId)
  }
  seen.delete(type)

  return valid
}

/**
 * Compares two closed type identities structurally.
 * @param {unknown} left - First identity.
 * @param {unknown} right - Second identity.
 * @returns {boolean} Whether the identities are equal.
 */
function sameTypeIdentity(left, right) {
  if (typeof left == "string" || typeof right == "string") return left === right
  if (!left || !right || typeof left != "object" || typeof right != "object") return false
  const leftType = /** @type {Record<string, unknown>} */ (left)
  const rightType = /** @type {Record<string, unknown>} */ (right)

  if (leftType.kind != rightType.kind) return false
  if (leftType.kind == "ListType") return sameTypeIdentity(leftType.elementType, rightType.elementType)
  if (leftType.kind == "OptionalType") return sameTypeIdentity(leftType.valueType, rightType.valueType)
  if (leftType.kind == "RecordType") return leftType.declarationId == rightType.declarationId
  if (leftType.kind == "MapType") {
    return sameTypeIdentity(leftType.keyType, rightType.keyType) && sameTypeIdentity(leftType.valueType, rightType.valueType)
  }

  return false
}

/**
 * Compares two validated semantic types structurally.
 * @param {import("./types.js").SemanticFunctionReturnType} left - First type.
 * @param {import("./types.js").SemanticFunctionReturnType} right - Second type.
 * @returns {boolean} Whether the types are equal.
 */
function sameType(left, right) {
  return sameTypeIdentity(typeIdentity(left), typeIdentity(right))
}

/**
 * Formats one validated semantic type for diagnostics.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {string} Stable recursive spelling.
 */
function typeDescription(type) {
  if (type.kind == "TypeReference") return type.name
  if (type.kind == "RecordType") return `record<${type.declarationId}>`
  if (type.kind == "ListType") return `list<${typeDescription(type.elementType)}>`
  if (type.kind == "OptionalType") return `optional<${typeDescription(type.valueType)}>`

  return `map<string, ${typeDescription(type.valueType)}>`
}

/**
 * Checks one scalar semantic type.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Semantic type.
 * @param {import("./types.js").SemanticTypeName} [name] - Optional required scalar.
 * @returns {type is import("./types.js").TypeReference} Whether it is the requested scalar.
 */
function isScalarType(type, name) {
  return type.kind == "TypeReference" && isScalarTypeName(type.name) && (name === undefined || type.name == name)
}

/**
 * Checks the sole non-value return type.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {type is import("./types.js").FunctionReturnTypeReference} Whether it is void.
 */
function isVoidType(type) {
  return type.kind == "TypeReference" && type.name == "void"
}

/**
 * Requires a scalar type for the pre-collection operator contract.
 * @param {import("./types.js").SemanticValueType} type - Operand type.
 * @param {import("./types.js").SourceLocation} location - Operand location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").SemanticTypeName} Scalar name.
 */
function scalarNameForOperation(type, location, fail) {
  if (!isScalarType(type)) {
    return fail("INVALID_OPERAND_TYPE", `Scalar operation received ${typeDescription(type)}.`, location)
  }

  return type.name
}

/**
 * Enforces that a total collection access is proven or uses a source operation that fails on absence.
 * @param {import("./types.js").ListIndexExpression | import("./types.js").MapLookupExpression} expression - Access.
 * @param {boolean} proven - Whether static literal propagation proves presence.
 * @param {boolean} normalizeOperations - Whether this is frontend admission.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {void}
 */
function validateAccessTotality(expression, proven, normalizeOperations, fail) {
  if (proven) {
    if (normalizeOperations) expression.totality = "proven"
    else if (expression.totality != "proven" && expression.totality != "fail-on-absence") {
      fail("UNCHECKED_COLLECTION_ACCESS", "Collection access lacks a totality guarantee.", expression.location)
    }

    return
  }
  if (expression.totality != "fail-on-absence") {
    fail("UNCHECKED_COLLECTION_ACCESS", "Collection access is not statically proven and does not fail on absence.", expression.location)
  }
}

/**
 * Resolves a binding without producing a diagnostic.
 * @param {string} name - Binding name.
 * @param {Scope} scope - Visible scope.
 * @returns {Binding | undefined} Binding when visible.
 */
function findBinding(name, scope) {
  for (let current = /** @type {Scope | undefined} */ (scope); current; current = current.parent) {
    const binding = current.bindings.get(name)

    if (binding) return binding
  }

  return undefined
}

/**
 * Returns the existing bindings whose known values must be merged across a conditional.
 * @param {Scope} scope - Visible scope.
 * @returns {Binding[]} Nearest-to-farthest bindings.
 */
function bindingsVisibleFrom(scope) {
  const bindings = []

  for (let current = /** @type {Scope | undefined} */ (scope); current; current = current.parent) {
    bindings.push(...current.bindings.values())
  }

  return bindings
}

/**
 * Finds visible mutable bindings that a loop body may assign on any nested path.
 * The set is computed after validating the list expression because collection evaluation precedes body effects.
 * @param {import("./types.js").Block} block - Candidate loop body.
 * @param {Scope} outerScope - Scope visible before entering the loop.
 * @param {Set<Binding>} [assigned] - Accumulated binding identities.
 * @returns {Set<Binding>} Exactly the visible mutable bindings targeted by nested assignments.
 */
function outerMutableBindingsAssignedBy(block, outerScope, assigned = new Set()) {
  for (const statement of block.statements) {
    if (statement.kind == "AssignmentStatement") {
      const binding = findBinding(statement.target.name, outerScope)

      if (binding?.mutable) assigned.add(binding)
    } else if (statement.kind == "IfStatement") {
      outerMutableBindingsAssignedBy(statement.consequent, outerScope, assigned)
      if (statement.alternate) outerMutableBindingsAssignedBy(statement.alternate, outerScope, assigned)
    } else if (statement.kind == "ForEachStatement") {
      outerMutableBindingsAssignedBy(statement.body, outerScope, assigned)
    }
  }

  return assigned
}

/**
 * Propagates only immutable values whose exact collection contents remain known.
 * @param {import("./types.js").Expression} expression - Expression.
 * @param {Scope} scope - Visible scope.
 * @returns {import("./types.js").Expression | undefined} Known value.
 */
function knownValueForExpression(expression, scope) {
  if (["IntegerLiteral", "BooleanLiteral", "StringLiteral", "ListLiteral", "MapLiteral"].includes(expression.kind)) return expression
  if (expression.kind == "IdentifierExpression") return findBinding(expression.name, scope)?.knownValue
  if (expression.kind == "ListIndexExpression") return provenListElement(expression.collection, expression.index, scope)
  if (expression.kind == "MapLookupExpression") return provenMapValue(expression.collection, expression.key, scope)

  return undefined
}

/**
 * Finds the statically selected list element.
 * @param {import("./types.js").Expression} collection - List receiver.
 * @param {import("./types.js").Expression} index - Index expression.
 * @param {Scope} scope - Visible scope.
 * @returns {import("./types.js").Expression | undefined} Proven element.
 */
function provenListElement(collection, index, scope) {
  const knownCollection = knownValueForExpression(collection, scope)
  const knownIndex = knownValueForExpression(index, scope)

  if (knownCollection?.kind != "ListLiteral" || knownIndex?.kind != "IntegerLiteral" ||
    knownIndex.value < 0 || knownIndex.value >= knownCollection.elements.length) return undefined

  return knownCollection.elements[knownIndex.value]
}

/**
 * Finds the statically selected map value.
 * @param {import("./types.js").Expression} collection - Map receiver.
 * @param {import("./types.js").Expression} key - Key expression.
 * @param {Scope} scope - Visible scope.
 * @returns {import("./types.js").Expression | undefined} Proven value.
 */
function provenMapValue(collection, key, scope) {
  const knownCollection = knownValueForExpression(collection, scope)
  const knownKey = knownValueForExpression(key, scope)

  if (knownCollection?.kind != "MapLiteral" || knownKey?.kind != "StringLiteral") return undefined

  return knownCollection.entries.find((entry) => entry.key.value == knownKey.value)?.value
}

/**
 * Identifies numeric strings independently from any target's key coercions.
 * @param {string} value - Literal key.
 * @returns {boolean} Whether it is numeric.
 */
function isNumericString(value) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())
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
 * @param {string} [role] - Recursive type role.
 * @returns {import("./types.js").SourceLocation} Exact type location when known.
 */
function typeLocation(type, ownerLocation, role = "type") {
  if (!type || typeof type != "object" || Array.isArray(type)) return ownerLocation
  const candidate = /** @type {import("./types.js").SemanticFunctionReturnType} */ (type)

  return candidate.sourceProvenance?.ranges[role] ?? parserRangeFor(candidate, role) ??
    candidate.sourceProvenance?.ranges.type ?? parserRangeFor(candidate, "type") ?? ownerLocation
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
