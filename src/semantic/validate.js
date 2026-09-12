// @ts-check

import {semanticFailure, unsupportedCapability, unsupportedSyntax} from "../diagnostic.js"
import {recordTypeSubstitutions, substituteValueType, typeContainsAnyVariable} from "./generics.js"
import {hasOnlyUnicodeScalars, isScalarTypeName, scalarType} from "./scalars.js"
import {adaptedOperationFor} from "./operators.js"
import {parserRangeFor} from "./provenance.js"

const task005Languages = new Set(["php", "ruby", "javascript", "typescript", "java"])

/** @typedef {Map<string, import("./types.js").RecordDeclaration>} RecordRegistry */
/** @typedef {Map<string, import("./types.js").ClassDeclaration>} ClassRegistry */
/** @typedef {Map<string, import("./types.js").ErrorDeclaration>} ErrorRegistry */
/** @type {WeakMap<RecordRegistry, ClassRegistry>} */
const referenceClassesByRecordRegistry = new WeakMap()

/**
 * @typedef Binding
 * @property {boolean} mutable - Whether assignment is allowed.
 * @property {import("./types.js").SemanticBindingType} type - Binding type.
 * @property {import("./types.js").Expression | undefined} knownValue - Current statically known immutable value.
 */

/**
 * @typedef Scope
 * @property {Map<string, Binding>} bindings - Bindings declared directly in this scope.
 * @property {Set<string>} pending - Names declared later in this scope.
 * @property {Set<Binding>} presenceProofs - Optional bindings proven present on this path.
 * @property {Scope | undefined} parent - Enclosing lexical scope.
 * @property {Set<string>} typeParameters - Type parameters visible throughout the enclosing declaration.
 * @property {Set<string>} usedNames - All names used by the enclosing function or entry point.
 * @property {import("./types.js").ClassDeclaration | undefined} currentClass - Declaring class for receiver-private access.
 */

/**
 * @typedef LoopFlowContext
 * @property {import("./types.js").ForEachStatement | import("./types.js").ForEachMapStatement | import("./types.js").WhileStatement} [nearest] - Nearest active loop.
 * @property {object} owner - Enclosing function or entry-point identity.
 * @property {Map<string, object>} owners - Loop owner by module-local loop identity.
 */

/**
 * @typedef SemanticFail
 * @type {(code: string, detail: string, location: import("./types.js").SourceLocation) => never}
 */

/**
 * Enforces the coherent release-candidate semantic subset after adaptation.
 * @param {import("./types.js").SemanticModule} module - Adapted semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Source language.
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, records?: Map<string, import("./types.js").RecordDeclaration>, errors?: Map<string, import("./types.js").ErrorDeclaration>, callEffects?: Map<string, Set<string>>}} [visible] - Program imports visible during validation.
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
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, records?: Map<string, import("./types.js").RecordDeclaration>, errors?: Map<string, import("./types.js").ErrorDeclaration>, callEffects?: Map<string, Set<string>>}} [visible] - Resolved program imports.
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
  for (const declaration of module.classes ?? []) {
    validateBlockShape(declaration.constructor?.body, "constructor body", fail)
    for (const method of declaration.methods ?? []) validateBlockShape(method.body, "method body", fail)
  }
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
    if (!["AssignmentStatement", "BreakStatement", "ContinueStatement", "ExpressionStatement", "ForEachMapStatement", "ForEachStatement", "IfStatement", "LocalDeclaration", "PrivateFieldWriteStatement", "PrintStatement", "RaiseStatement", "ReturnStatement", "TryStatement", "WhileStatement"].includes(statement.kind)) {
      fail(`${detail} statement ${statement.kind}`, statement.location)
    }
    if (statement.kind == "IfStatement") {
      validateBlockShape(statement.consequent, "if consequent", fail)
      if (statement.alternate) validateBlockShape(statement.alternate, "if alternate", fail)
    }
    if (statement.kind == "ForEachStatement" || statement.kind == "ForEachMapStatement" || statement.kind == "WhileStatement") {
      validateBlockShape(statement.body, "loop body", fail)
    }
    if (statement.kind == "TryStatement") {
      validateBlockShape(statement.body, "try body", fail)
      validateBlockShape(statement.catchBody, "catch body", fail)
    }
  }
}

/**
 * Validates declarations and expression types within lexical scopes.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, records?: Map<string, import("./types.js").RecordDeclaration>, errors?: Map<string, import("./types.js").ErrorDeclaration>, callEffects?: Map<string, Set<string>>}} [visible] - Program imports visible during validation.
 * @returns {void}
 */
function validateModuleTypes(module, fail, normalizeOperations, visible = {}) {
  const classes = registerClassDeclarations(module.classes ?? [], fail, normalizeOperations)
  const records = validateRecordDeclarations(module.records ?? [], fail, normalizeOperations, visible.records, classes)
  const errors = validateErrorDeclarations(module.errors ?? [], fail, normalizeOperations, visible.errors)
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
    validateTypeParameters(functionDeclaration, fail, normalizeOperations)
    functions.set(functionDeclaration.name, functionDeclaration)
  }

  const loopOwners = prepareLoopIdentities(module, normalizeOperations, fail)

  const reservedValueNames = new Set([
    ...functions.keys(),
    ...[...records.values()].map((declaration) => declaration.name),
    ...[...classes.values()].map((declaration) => declaration.name),
    ...[...errors.values()].map((declaration) => declaration.name)
  ])

  const nominalNames = new Set()

  for (const declaration of [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? []]) {
    if (nominalNames.has(declaration.name)) {
      fail("DUPLICATE_BINDING", `Duplicate nominal declaration '${declaration.name}'.`, roleLocation(declaration, "name"))
    }
    nominalNames.add(declaration.name)
  }
  const localFunctionNames = new Set(module.functions.map(({name}) => name))
  const callEffects = inferCallEffects(functions, visible.callEffects, localFunctionNames)

  for (const declaration of module.classes ?? []) {
    validateClassDeclaration(declaration, functions, records, errors, callEffects, reservedValueNames, fail,
      normalizeOperations, loopOwners)
  }

  for (const functionDeclaration of module.functions) {
    validateFunction(functionDeclaration, functions, records, errors, callEffects, reservedValueNames, fail, normalizeOperations, loopOwners)
  }

  const entryScope = createScope(undefined, module.entryPoint.body.statements, reservedValueNames)

  validateBlock(module.entryPoint.body, entryScope, undefined, functions, records, errors, callEffects, fail,
    normalizeOperations, {owner: module.entryPoint, owners: loopOwners})
}

/**
 * Assigns parser-authored loop/control identities and validates caller-owned identities without crossing a function boundary.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @param {boolean} normalizeOperations - Whether parser-authored identities are assigned.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {Map<string, object>} Loop owner by identity.
 */
function prepareLoopIdentities(module, normalizeOperations, fail) {
  const owners = new Map()
  let nextLoop = 0

  const classOwners = (module.classes ?? []).flatMap((declaration) => [declaration.constructor, ...declaration.methods])

  for (const owner of [...classOwners, ...module.functions, module.entryPoint]) visit(owner.body, owner, [])

  return owners

  /**
   * Visits one block in lexical semantic order.
   * @param {import("./types.js").Block} block - Candidate block.
   * @param {object} owner - Enclosing function or entry point.
   * @param {(import("./types.js").ForEachStatement | import("./types.js").ForEachMapStatement | import("./types.js").WhileStatement)[]} active - Active loops.
   * @returns {void}
   */
  function visit(block, owner, active) {
    if (!block || !Array.isArray(block.statements)) return
    for (const statement of block.statements) {
      if (!statement || typeof statement != "object") continue
      if (["ForEachStatement", "ForEachMapStatement", "WhileStatement"].includes(statement.kind)) {
        const loop = /** @type {import("./types.js").ForEachStatement | import("./types.js").ForEachMapStatement | import("./types.js").WhileStatement} */ (statement)

        if (normalizeOperations) loop.id = `loop:${nextLoop}`
        nextLoop += 1
        if (typeof loop.id != "string" || !/^loop:[0-9]+$/u.test(loop.id) || owners.has(loop.id)) {
          fail("INVALID_LOOP_TARGET", "Duplicate or invalid loop identity.", loop.location)
        }
        owners.set(loop.id, owner)
        visit(loop.body, owner, [...active, loop])
      } else if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
        if (normalizeOperations && active.length > 0) statement.targetLoopId = /** @type {string} */ (active.at(-1)?.id)
      } else if (statement.kind == "IfStatement") {
        visit(statement.consequent, owner, active)
        if (statement.alternate) visit(statement.alternate, owner, active)
      } else if (statement.kind == "TryStatement") {
        visit(statement.body, owner, active)
        visit(statement.catchBody, owner, active)
      }
    }
  }
}

/**
 * Derives validator-only unchecked-error effects for a validated module's local functions.
 * These effects never enter semantic function declarations or public signatures.
 * @param {import("./types.js").SemanticModule} module - Validated semantic module.
 * @param {{functions?: Map<string, import("./types.js").FunctionDeclaration>, callEffects?: Map<string, Set<string>>}} [visible] - Imported functions and already-resolved effects by local binding.
 * @returns {Map<string, Set<string>>} Local function effects by source-visible name.
 */
export function moduleUncheckedErrorEffects(module, visible = {}) {
  const functions = new Map(visible.functions ?? [])

  for (const declaration of module.functions) functions.set(declaration.name, declaration)
  const localFunctionNames = new Set(module.functions.map(({name}) => name))
  const effects = inferCallEffects(functions, visible.callEffects, localFunctionNames)

  return new Map(module.functions.map((declaration) => [declaration.name, new Set(effects.get(declaration.name) ?? [])]))
}

/**
 * Assigns and validates the closed nominal identities owned by reference classes.
 * @param {unknown} declarations - Candidate declarations.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether parser-authored identities are assigned.
 * @returns {ClassRegistry} Classes by stable identity.
 */
function registerClassDeclarations(declarations, fail, normalizeOperations) {
  if (!Array.isArray(declarations)) {
    return fail("TYPE_MISMATCH", "Reference class declarations must be an ordered array.", /** @type {never} */ (undefined))
  }
  /** @type {ClassRegistry} */
  const classes = new Map()
  const names = new Set()

  for (let classIndex = 0; classIndex < declarations.length; classIndex += 1) {
    const declaration = declarations[classIndex]

    if (!declaration || declaration.kind != "ClassDeclaration" || !Array.isArray(declaration.fields) ||
      !Array.isArray(declaration.methods) || !declaration.constructor || declaration.constructor.kind != "ConstructorDeclaration") {
      return fail("DUPLICATE_CLASS", "Malformed or invalid reference class declaration.", declaration?.location)
    }
    if (declaration.fields.length == 0) {
      fail("INCOMPLETE_INITIALIZATION", "Reference classes must declare private instance state.", declaration.location)
    }
    if (normalizeOperations) declaration.id = `class:${classIndex}`
    if (typeof declaration.id != "string" || !/^(?:[a-z][a-z0-9._-]*#)?class:[0-9]+$/u.test(declaration.id) ||
      classes.has(declaration.id) || typeof declaration.name != "string" || declaration.name.length == 0 || names.has(declaration.name)) {
      fail("DUPLICATE_CLASS", `Duplicate or invalid reference class '${String(declaration.name)}'.`, roleLocation(declaration, "name"))
    }
    names.add(declaration.name)
    classes.set(declaration.id, declaration)

    const fieldNames = new Set()

    for (let fieldIndex = 0; fieldIndex < declaration.fields.length; fieldIndex += 1) {
      const field = declaration.fields[fieldIndex]
      const expectedId = `${declaration.id}:field:${fieldIndex}`

      if (!field || field.kind != "PrivateField") {
        fail("DUPLICATE_PRIVATE_FIELD", "Malformed or invalid private field.", field?.location ?? declaration.location)
      }
      if (normalizeOperations) field.id = expectedId
      if (field.id != expectedId || typeof field.name != "string" || field.name.length == 0 || fieldNames.has(field.name)) {
        fail("DUPLICATE_PRIVATE_FIELD", `Duplicate or invalid private field '${String(field.name)}'.`, roleLocation(field, "name"))
      }
      fieldNames.add(field.name)
    }

    const constructorId = `${declaration.id}:constructor`

    if (normalizeOperations) declaration.constructor.id = constructorId
    if (declaration.constructor.id != constructorId || !Array.isArray(declaration.constructor.parameters) ||
      !declaration.constructor.body || declaration.constructor.body.kind != "Block") {
      fail("DUPLICATE_CONSTRUCTOR", "Malformed or invalid constructor declaration.", declaration.constructor.location)
    }

    const methodNames = new Set()

    for (let methodIndex = 0; methodIndex < declaration.methods.length; methodIndex += 1) {
      const method = declaration.methods[methodIndex]
      const expectedId = `${declaration.id}:method:${methodIndex}`

      if (!method || method.kind != "MethodDeclaration") {
        fail("DUPLICATE_METHOD", "Malformed or invalid method declaration.", method?.location ?? declaration.location)
      }
      if (normalizeOperations) method.id = expectedId
      if (method.id != expectedId || typeof method.name != "string" || method.name.length == 0 || methodNames.has(method.name) ||
        !Array.isArray(method.parameters) || !method.body || method.body.kind != "Block") {
        fail("DUPLICATE_METHOD", `Duplicate or invalid method '${String(method.name)}'.`, roleLocation(method, "name"))
      }
      methodNames.add(method.name)
    }
  }

  return classes
}

/**
 * Validates exact construction, private state, and method bodies for one class.
 * @param {import("./types.js").ClassDeclaration} declaration - Class declaration.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Function signatures.
 * @param {RecordRegistry} records - Record and reference-class registries.
 * @param {ErrorRegistry} errors - Error declarations.
 * @param {Map<string, Set<string>>} callEffects - Function call effects.
 * @param {Set<string>} reservedValueNames - Module-reserved names.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether parser-authored resolutions are assigned.
 * @param {Map<string, object>} loopOwners - Loop ownership registry.
 * @returns {void}
 */
function validateClassDeclaration(declaration, functions, records, errors, callEffects, reservedValueNames, fail,
  normalizeOperations, loopOwners) {
  for (const field of declaration.fields) {
    validateValueTypeReference(field.type, field.location, fail, undefined, records)
  }

  const constructor = declaration.constructor

  if (syntacticBlockEffects(constructor.body, callEffects).size > 0) {
    fail("UNSUPPORTED_STATEMENT", "Reference constructors cannot expose unchecked-error effects in Task 033.", constructor.location)
  }

  if (constructor.parameters.length != declaration.fields.length || constructor.body.statements.length != declaration.fields.length) {
    fail("INCOMPLETE_INITIALIZATION", `Constructor for '${declaration.name}' must initialize every private field exactly once in declaration order.`,
      constructor.location)
  }
  const constructorScope = createScope(undefined, constructor.body.statements, reservedValueNames, new Set(), declaration)

  for (let index = 0; index < constructor.parameters.length; index += 1) {
    const parameter = constructor.parameters[index]
    const field = declaration.fields[index]
    const type = validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records)

    if (!sameType(type, field.type)) {
      fail("TYPE_MISMATCH", `Constructor parameter '${parameter.name}' must exactly match private field '${field.name}'.`, parameter.location)
    }
    declareBinding(parameter.name, {knownValue: undefined, mutable: false, type}, roleLocation(parameter, "name"), constructorScope, fail)
    const statement = constructor.body.statements[index]

    if (!statement || statement.kind != "PrivateFieldWriteStatement" || statement.field != field.id ||
      statement.receiver?.kind != "ReceiverExpression" || statement.receiver.classId != declaration.id ||
      statement.expression?.kind != "IdentifierExpression" || statement.expression.name != parameter.name) {
      fail("INCOMPLETE_INITIALIZATION", `Constructor for '${declaration.name}' must initialize '${field.name}' from its corresponding parameter.`,
        statement?.location ?? constructor.location)
    }
  }
  validateBlock(constructor.body, constructorScope, {kind: "TypeReference", name: "void"}, functions, records,
    errors, callEffects, fail, normalizeOperations, {owner: constructor, owners: loopOwners})

  for (const method of declaration.methods) {
    if (syntacticBlockEffects(method.body, callEffects).size > 0) {
      fail("UNSUPPORTED_STATEMENT", `Reference method '${method.name}' cannot expose unchecked-error effects in Task 033.`, method.location)
    }
    const scope = createScope(undefined, method.body.statements, reservedValueNames, new Set(), declaration)

    for (const parameter of method.parameters) {
      const type = validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records)

      declareBinding(parameter.name, {knownValue: undefined, mutable: false, type}, roleLocation(parameter, "name"), scope, fail)
    }
    const returnType = validateReturnTypeReference(method.returnType, method.location, fail, records)
    const flow = validateBlock(method.body, scope, returnType, functions, records, errors, callEffects, fail,
      normalizeOperations, {owner: method, owners: loopOwners})

    if (!isVoidType(returnType) && flow.normal) {
      fail("MISSING_RETURN", `Method '${method.name}' does not return on every reachable path.`, method.location)
    }
  }
}

/**
 * Validates nominal unchecked-error declarations.
 * @param {unknown} declarations - Candidate declarations.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether parser-authored identities are assigned.
 * @param {Map<string, import("./types.js").ErrorDeclaration>} [visibleErrors] - Imported error declarations by identity.
 * @returns {ErrorRegistry} Validated declarations by identity.
 */
function validateErrorDeclarations(declarations, fail, normalizeOperations, visibleErrors = new Map()) {
  if (!Array.isArray(declarations)) return fail("TYPE_MISMATCH", "Error declarations must be an ordered array.", /** @type {never} */ (undefined))
  /** @type {ErrorRegistry} */
  const errors = new Map(visibleErrors)
  const names = new Set()

  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index]

    if (!declaration || declaration.kind != "ErrorDeclaration") {
      return fail("TYPE_MISMATCH", "Malformed error declaration.", declaration?.location)
    }
    if (normalizeOperations) declaration.id = `error:${index}`
    if (typeof declaration.id != "string" || !/^(?:[a-z][a-z0-9._-]*#)?error:[0-9]+$/u.test(declaration.id) || errors.has(declaration.id)) {
      fail("DUPLICATE_ERROR", "Duplicate or invalid error declaration identity.", declaration.location)
    }
    if (typeof declaration.name != "string" || names.has(declaration.name)) {
      fail("DUPLICATE_ERROR", `Duplicate or invalid error '${String(declaration.name)}'.`, roleLocation(declaration, "name"))
    }
    names.add(declaration.name)
    errors.set(declaration.id, declaration)
  }

  return errors
}

/**
 * Assigns and validates one declaration's invariant unbounded type parameters.
 * @param {import("./types.js").FunctionDeclaration | import("./types.js").RecordDeclaration} declaration - Owning declaration.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether parser-authored identities are assigned.
 * @returns {void}
 */
function validateTypeParameters(declaration, fail, normalizeOperations) {
  if (declaration.typeParameters === undefined) return
  if (!Array.isArray(declaration.typeParameters)) {
    fail("TYPE_MISMATCH", "Type parameters must be a dense ordered array.", declaration.location)
  }
  const names = new Set()

  for (let index = 0; index < declaration.typeParameters.length; index += 1) {
    const parameter = declaration.typeParameters[index]
    const keys = parameter && typeof parameter == "object" && !Array.isArray(parameter)
      ? Object.keys(parameter).filter((key) => key != "sourceProvenance").sort().join(",") : ""

    if (!Object.hasOwn(declaration.typeParameters, index) || !parameter || parameter.kind != "TypeParameter" ||
      keys != "id,kind,location,name" || typeof parameter.name != "string" || parameter.name.length == 0) {
      fail("TYPE_MISMATCH", "Malformed type parameter declaration.", parameter?.location ?? declaration.location)
    }
    if (names.has(parameter.name)) {
      fail("DUPLICATE_TYPE_PARAMETER", `Duplicate type parameter '${parameter.name}'.`, roleLocation(parameter, "name"))
    }
    names.add(parameter.name)
    const expectedId = `${declaration.id}:type:${index}`

    if (normalizeOperations) parameter.id = expectedId
    if (parameter.id != expectedId) {
      fail("DUPLICATE_TYPE_PARAMETER", "Duplicate or invalid type parameter identity.", parameter.location)
    }
  }
}

/**
 * Returns the closed identity scope owned by one validated declaration.
 * @param {import("./types.js").FunctionDeclaration | import("./types.js").RecordDeclaration} declaration - Declaration.
 * @returns {Set<string>} Type-parameter identities.
 */
function declarationTypeParameterIds(declaration) {
  return new Set((declaration.typeParameters ?? []).map(({id}) => /** @type {string} */ (id)))
}

/**
 * Validates nominal declarations and returns their stable identity registry.
 * @param {unknown} declarations - Candidate ordered declarations.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether parser-authored identities are assigned.
 * @param {Map<string, import("./types.js").RecordDeclaration>} [visibleRecords] - Imported record declarations by identity.
 * @param {ClassRegistry} [classes] - Module reference classes by identity.
 * @returns {RecordRegistry} Validated declarations by identity.
 */
function validateRecordDeclarations(declarations, fail, normalizeOperations, visibleRecords = new Map(), classes = new Map()) {
  if (!Array.isArray(declarations)) return fail("TYPE_MISMATCH", "Record declarations must be an ordered array.", /** @type {never} */ (undefined))
  /** @type {RecordRegistry} */
  const records = new Map(visibleRecords)

  referenceClassesByRecordRegistry.set(records, classes)
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
    validateTypeParameters(declaration, fail, normalizeOperations)
    records.set(declaration.id, declaration)
  }

  for (const declaration of declarations) {
    const fieldNames = new Set()
    const typeParameters = declarationTypeParameterIds(declaration)

    for (let fieldIndex = 0; fieldIndex < declaration.fields.length; fieldIndex += 1) {
      const field = declaration.fields[fieldIndex]

      if (!field || field.kind != "RecordField") fail("TYPE_MISMATCH", "Malformed record field.", field?.location ?? declaration.location)
      if (normalizeOperations) field.id = `${declaration.id}:field:${fieldIndex}`
      if (typeof field.id != "string" || field.id != `${declaration.id}:field:${fieldIndex}`) {
        fail("DUPLICATE_FIELD", "Duplicate or invalid record field identity.", field.location)
      }
      if (fieldNames.has(field.name)) fail("DUPLICATE_FIELD", `Duplicate field '${field.name}'.`, roleLocation(field, "name"))
      fieldNames.add(field.name)
      validateValueTypeReference(field.type, field.location, fail, undefined, records, typeParameters)
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
 * @param {ErrorRegistry} errors - Error declarations by identity.
 * @param {Map<string, Set<string>>} callEffects - Internally inferred unchecked-error effects.
 * @param {Set<string>} reservedValueNames - Module functions and nominal constructors unavailable to lexical bindings.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @param {Map<string, object>} loopOwners - Loop owner by module-local identity.
 * @returns {void}
 */
function validateFunction(declaration, functions, records, errors, callEffects, reservedValueNames, fail, normalizeOperations, loopOwners) {
  const typeParameters = declarationTypeParameterIds(declaration)
  const scope = createScope(undefined, declaration.body.statements, reservedValueNames, typeParameters)

  for (const parameter of declaration.parameters) {
    const type = validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records, typeParameters)

    declareBinding(parameter.name, {knownValue: undefined, mutable: false, type}, roleLocation(parameter, "name"), scope, fail)
  }

  const returnType = validateReturnTypeReference(declaration.returnType, declaration.location, fail, records, typeParameters)
  const returns = validateBlock(declaration.body, scope, returnType, functions, records, errors, callEffects, fail,
    normalizeOperations, {owner: declaration, owners: loopOwners})

  if (!isVoidType(returnType) && returns.normal) {
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
 * @param {ErrorRegistry} errors - Error declarations by identity.
 * @param {Map<string, Set<string>>} callEffects - Internally inferred unchecked-error effects.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to replace transient frontend operation intent.
 * @param {LoopFlowContext} loopContext - Active loop and owner identities.
 * @returns {{normal: boolean, raises: Set<string>}} Reachable normal continuation and escaping error identities.
 */
function validateBlock(block, scope, returnType, functions, records, errors, callEffects, fail, normalizeOperations, loopContext) {
  let normal = true
  const raises = new Set()

  for (const statement of block.statements) {
    if (!normal) fail("UNREACHABLE_STATEMENT", "Statement is unreachable.", statement.location)

    if (statement.kind == "LocalDeclaration") {
      const declaredType = validateValueTypeReference(statement.type, statement.location, fail, undefined, records, scope.typeParameters)
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
      addExpressionEffects(raises, statement.initializer, callEffects)
      continue
    }
    if (statement.kind == "AssignmentStatement") {
      const binding = resolveBinding(statement.target.name, statement.target.location, scope, fail)

      if (binding.type.kind == "ErrorType") {
        fail("IMMUTABLE_ASSIGNMENT", `Cannot assign to immutable catch binding '${statement.target.name}'.`, statement.target.location)
      }
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
      addExpressionEffects(raises, statement.expression, callEffects)
      continue
    }
    if (statement.kind == "PrivateFieldWriteStatement") {
      const declaration = scope.currentClass

      if (!declaration || !statement.receiver || statement.receiver.kind != "ReceiverExpression" ||
        statement.receiver.classId != declaration.id) {
        fail("ILLEGAL_PRIVATE_ACCESS", "Private field receiver must be the declaring class receiver.", statement.location)
      }
      const field = declaration.fields.find((candidate) => candidate.id == statement.field)

      if (!field) fail("ILLEGAL_PRIVATE_ACCESS", "Private field identity is not owned by the declaring class.", statement.location)
      const expressionType = inferValueExpressionType(
        statement.expression, scope, functions, records, fail, normalizeOperations, "a private field assignment", field.type
      )

      if (!sameType(expressionType, field.type)) {
        fail("TYPE_MISMATCH", `Private field assignment type ${typeDescription(expressionType)}; expected ${typeDescription(field.type)}.`,
          statement.expression.location)
      }
      addExpressionEffects(raises, statement.expression, callEffects)
      continue
    }
    if (statement.kind == "PrintStatement") {
      const printedType = inferValueExpressionType(statement.expression, scope, functions, records, fail, normalizeOperations, "a print value")

      if (printedType.kind != "TypeReference") {
        fail("TYPE_MISMATCH", "Collections and records cannot be printed directly.", statement.expression.location)
      }
      addExpressionEffects(raises, statement.expression, callEffects)
      continue
    }
    if (statement.kind == "ExpressionStatement") {
      if (!statement.expression || !["CallExpression", "MethodCallExpression"].includes(statement.expression.kind)) {
        fail("TYPE_MISMATCH", "Expression statement must contain a direct or receiver call.", statement.location)
      }
      const expressionType = inferExpressionType(statement.expression, scope, functions, records, fail, normalizeOperations)

      if (expressionType != "void") {
        fail("TYPE_MISMATCH", "Expression statements may contain only void calls.", statement.expression.location)
      }
      addExpressionEffects(raises, statement.expression, callEffects)
      continue
    }
    if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
      const control = statement.kind == "BreakStatement" ? "break" : "continue"

      if (!loopContext.nearest) {
        if (typeof statement.targetLoopId == "string" && loopContext.owners.has(statement.targetLoopId) &&
          loopContext.owners.get(statement.targetLoopId) !== loopContext.owner) {
          fail("CROSS_FUNCTION_LOOP_TARGET", `${control[0].toUpperCase()}${control.slice(1)} target crosses a function boundary.`, statement.location)
        }
        fail(`ILLEGAL_${control.toUpperCase()}_CONTEXT`, `${control[0].toUpperCase()}${control.slice(1)} statement outside a loop.`, statement.location)
      }
      if (typeof statement.targetLoopId != "string" || !loopContext.owners.has(statement.targetLoopId)) {
        fail("INVALID_LOOP_TARGET", `${control[0].toUpperCase()}${control.slice(1)} has an invalid loop target identity.`, statement.location)
      }
      if (loopContext.owners.get(statement.targetLoopId) !== loopContext.owner) {
        fail("CROSS_FUNCTION_LOOP_TARGET", `${control[0].toUpperCase()}${control.slice(1)} target crosses a function boundary.`, statement.location)
      }
      if (statement.targetLoopId != loopContext.nearest.id) {
        fail("INVALID_LOOP_TARGET", `${control[0].toUpperCase()}${control.slice(1)} must target the nearest enclosing loop.`, statement.location)
      }
      normal = false
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
      if (statement.expression) addExpressionEffects(raises, statement.expression, callEffects)
      normal = false
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
      const consequentReturns = validateBlock(statement.consequent, consequentScope, returnType, functions, records, errors, callEffects, fail, normalizeOperations, loopContext)
      const consequentKnownValues = visibleBindings.map((binding) => binding.knownValue)

      visibleBindings.forEach((binding, index) => {
        binding.knownValue = initialKnownValues[index]
      })
      let alternateReturns = {normal: true, raises: new Set()}

      if (statement.alternate) {
        alternateReturns = validateBlock(statement.alternate, alternateScope, returnType, functions, records, errors, callEffects, fail, normalizeOperations, loopContext)
      }
      const alternateKnownValues = visibleBindings.map((binding) => binding.knownValue)

      visibleBindings.forEach((binding, index) => {
        if (!consequentReturns.normal && alternateReturns.normal) binding.knownValue = alternateKnownValues[index]
        else if (consequentReturns.normal && !alternateReturns.normal) binding.knownValue = consequentKnownValues[index]
        else if (consequentReturns.normal && alternateReturns.normal && consequentKnownValues[index] === alternateKnownValues[index]) {
          binding.knownValue = consequentKnownValues[index]
        } else binding.knownValue = undefined
      })
      const continuingProofs = !consequentReturns.normal && alternateReturns.normal
        ? alternateScope.presenceProofs
        : consequentReturns.normal && !alternateReturns.normal
          ? consequentScope.presenceProofs
          : consequentReturns.normal && alternateReturns.normal
            ? new Set([...consequentScope.presenceProofs].filter((binding) => alternateScope.presenceProofs.has(binding)))
            : new Set()
      const visibleSet = new Set(visibleBindings)

      scope.presenceProofs.clear()
      for (const binding of continuingProofs) {
        if (visibleSet.has(binding)) scope.presenceProofs.add(binding)
      }
      addExpressionEffects(raises, statement.condition, callEffects)
      addAll(raises, consequentReturns.raises)
      addAll(raises, alternateReturns.raises)
      normal = consequentReturns.normal || alternateReturns.normal
      continue
    }
    if (statement.kind == "WhileStatement") {
      const assignedOuterBindings = outerMutableBindingsAssignedBy(statement.body, scope)

      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
      const conditionType = inferValueExpressionType(
        statement.condition, scope, functions, records, fail, normalizeOperations, "a condition-controlled loop condition"
      )

      if (!isScalarType(conditionType, "boolean")) {
        fail("NON_BOOLEAN_CONDITION", `While condition type ${typeDescription(conditionType)}; expected boolean.`, statement.condition.location)
      }
      const loopScope = createScope(scope, statement.body.statements)

      applyPresenceNarrowing(statement.condition, scope, loopScope, true)
      const bodyFlow = validateBlock(statement.body, loopScope, returnType, functions, records, errors, callEffects, fail,
        normalizeOperations, {nearest: statement, owner: loopContext.owner, owners: loopContext.owners})

      addExpressionEffects(raises, statement.condition, callEffects)
      addAll(raises, bodyFlow.raises)
      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
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
      const bindingType = validateValueTypeReference(statement.valueBinding.type, statement.valueBinding.location, fail, undefined, records, scope.typeParameters)

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
      const bodyFlow = validateBlock(statement.body, loopScope, returnType, functions, records, errors, callEffects, fail,
        normalizeOperations, {nearest: statement, owner: loopContext.owner, owners: loopContext.owners})
      addExpressionEffects(raises, statement.list, callEffects)
      addAll(raises, bodyFlow.raises)
      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
      continue
    }
    if (statement.kind == "ForEachMapStatement") {
      const mapType = inferValueExpressionType(statement.map, scope, functions, records, fail, normalizeOperations,
        "a map iteration collection")

      if (mapType.kind != "OrderedMapType") {
        fail("TYPE_MISMATCH", `Map iteration collection type ${typeDescription(mapType)}; expected ordered map.`, statement.map.location)
      }
      if (!statement.keyBinding || statement.keyBinding.kind != "ValueBinding" ||
        !statement.valueBinding || statement.valueBinding.kind != "ValueBinding") {
        fail("TYPE_MISMATCH", "Map iteration requires exact key and value bindings.", statement.location)
      }
      if (statement.keyBinding.mutable !== false || statement.valueBinding.mutable !== false) {
        fail("TYPE_MISMATCH", "Map iteration bindings must be immutable.",
          statement.keyBinding.mutable !== false ? statement.keyBinding.location : statement.valueBinding.location)
      }
      const keyType = validateValueTypeReference(statement.keyBinding.type, statement.keyBinding.location, fail,
        undefined, records, scope.typeParameters)
      const valueType = validateValueTypeReference(statement.valueBinding.type, statement.valueBinding.location, fail,
        undefined, records, scope.typeParameters)

      if (!sameType(keyType, mapType.keyType)) {
        fail("TYPE_MISMATCH", `Map iteration key binding type ${typeDescription(keyType)}; expected ${typeDescription(mapType.keyType)}.`,
          typeLocation(statement.keyBinding.type, statement.keyBinding.location))
      }
      if (!sameType(valueType, mapType.valueType)) {
        fail("TYPE_MISMATCH", `Map iteration value binding type ${typeDescription(valueType)}; expected ${typeDescription(mapType.valueType)}.`,
          typeLocation(statement.valueBinding.type, statement.valueBinding.location))
      }
      const assignedOuterBindings = outerMutableBindingsAssignedBy(statement.body, scope)

      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
      const loopScope = createScope(scope, statement.body.statements)

      declareBinding(statement.keyBinding.name, {knownValue: undefined, mutable: false, type: keyType},
        roleLocation(statement.keyBinding, "name"), loopScope, fail)
      declareBinding(statement.valueBinding.name, {knownValue: undefined, mutable: false, type: valueType},
        roleLocation(statement.valueBinding, "name"), loopScope, fail)
      const bodyFlow = validateBlock(statement.body, loopScope, returnType, functions, records, errors, callEffects,
        fail, normalizeOperations, {nearest: statement, owner: loopContext.owner, owners: loopContext.owners})

      addExpressionEffects(raises, statement.map, callEffects)
      addAll(raises, bodyFlow.raises)
      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
      continue
    }
    if (statement.kind == "RaiseStatement") {
      if (!statement.error || statement.error.kind != "ErrorConstruction") {
        fail("NON_ERROR_RAISE", "Raise requires one constructed semantic error.", statement.location)
      }
      const raisedType = validateErrorType(statement.error.error, statement.error.location, errors, fail)
      const messageType = inferValueExpressionType(
        statement.error.message, scope, functions, records, fail, normalizeOperations, "an error message", scalarType("string")
      )

      if (!isScalarType(messageType, "string")) {
        fail("NON_ERROR_RAISE", `Error message type ${typeDescription(messageType)}; expected string.`, statement.error.message.location)
      }
      addExpressionEffects(raises, statement.error.message, callEffects)
      raises.add(raisedType.declarationId)
      normal = false
      continue
    }
    if (statement.kind == "TryStatement") {
      const caughtType = validateErrorType(statement.catchType, statement.location, errors, fail)

      if (!statement.catchBinding || statement.catchBinding.kind != "CatchBinding" || statement.catchBinding.mutable !== false) {
        fail("INVALID_ERROR_HANDLER", "Catch requires one immutable typed binding.", statement.catchBinding?.location ?? statement.location)
      }
      const bindingType = validateErrorType(statement.catchBinding.type, statement.catchBinding.location, errors, fail)

      if (bindingType.declarationId != caughtType.declarationId) {
        fail("INVALID_ERROR_HANDLER", "Catch binding type must exactly match its handler type.", statement.catchBinding.location)
      }
      const bodyAssignedOuterBindings = outerMutableBindingsAssignedBy(statement.body, scope)
      const assignedOuterBindings = new Set(bodyAssignedOuterBindings)

      outerMutableBindingsAssignedBy(statement.catchBody, scope, assignedOuterBindings)
      const bodyScope = createScope(scope, statement.body.statements)
      const bodyFlow = validateBlock(statement.body, bodyScope, returnType, functions, records, errors, callEffects, fail, normalizeOperations, loopContext)
      const catchScope = createScope(scope, statement.catchBody.statements)

      for (const binding of bodyAssignedOuterBindings) {
        binding.knownValue = undefined
        catchScope.presenceProofs.delete(binding)
      }

      declareBinding(statement.catchBinding.name, {
        knownValue: undefined,
        mutable: false,
        type: bindingType
      }, roleLocation(statement.catchBinding, "name"), catchScope, fail)
      const catchFlow = validateBlock(statement.catchBody, catchScope, returnType, functions, records, errors, callEffects, fail, normalizeOperations, loopContext)

      if (!bodyFlow.raises.has(caughtType.declarationId)) {
        fail("UNREACHABLE_HANDLER", `Handler for '${errors.get(caughtType.declarationId)?.name}' cannot be reached.`, typeLocation(statement.catchType, statement.location))
      }
      bodyFlow.raises.delete(caughtType.declarationId)
      addAll(raises, bodyFlow.raises)
      addAll(raises, catchFlow.raises)
      normal = bodyFlow.normal || catchFlow.normal
      for (const binding of assignedOuterBindings) {
        binding.knownValue = undefined
        scope.presenceProofs.delete(binding)
      }
      continue
    }

    const unexpected = /** @type {{kind: string, location: import("./types.js").SourceLocation}} */ (statement)

    fail("UNSUPPORTED_STATEMENT", unexpected.kind, unexpected.location)
  }

  return {normal, raises}
}

/**
 * Validates one exact nominal error type.
 * @param {unknown} type - Candidate type.
 * @param {import("./types.js").SourceLocation} location - Owning location.
 * @param {ErrorRegistry} errors - Visible error declarations.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {import("./types.js").ErrorType} Validated type.
 */
function validateErrorType(type, location, errors, fail) {
  if (!type || typeof type != "object" || Array.isArray(type)) {
    return fail("UNKNOWN_ERROR", "Handler or raise is missing an exact error type.", location)
  }
  const candidate = /** @type {import("./types.js").ErrorType} */ (type)

  if (candidate.kind != "ErrorType" ||
    Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",") != "declarationId,kind" ||
    typeof candidate.declarationId != "string" || !errors.has(candidate.declarationId)) {
    fail("UNKNOWN_ERROR", `Unknown error declaration '${String(candidate.declarationId)}'.`, typeLocation(candidate, location))
  }

  return candidate
}

/**
 * Adds every source value to one set.
 * @param {Set<string>} target - Destination identities.
 * @param {Set<string>} source - Source identities.
 * @returns {void}
 */
function addAll(target, source) {
  for (const value of source) target.add(value)
}

/**
 * Adds unchecked errors raised while evaluating one expression.
 * @param {Set<string>} target - Destination identities.
 * @param {unknown} expression - Candidate semantic expression.
 * @param {Map<string, Set<string>>} callEffects - Inferred call effects.
 * @returns {void}
 */
function addExpressionEffects(target, expression, callEffects) {
  const pending = [expression]
  const seen = new Set()

  while (pending.length > 0) {
    const value = pending.pop()

    if (!value || typeof value != "object" || seen.has(value)) continue
    seen.add(value)
    if (Reflect.get(value, "kind") == "CallExpression") addAll(target, callEffects.get(Reflect.get(value, "callee")) ?? new Set())
    for (const [key, child] of Object.entries(value)) {
      if (["location", "sourceProvenance", "resolution"].includes(key)) continue
      if (Array.isArray(child)) pending.push(...child)
      else if (child && typeof child == "object") pending.push(child)
    }
  }
}

/**
 * Derives unchecked-error propagation over the resolved finite function graph.
 * This is validator state, never a checked effect in the public function signature.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Resolved functions.
 * @param {Map<string, Set<string>>} [seedEffects] - Dependency effects keyed by local import name.
 * @param {Set<string>} [localFunctionNames] - Functions whose bodies belong to the current module.
 * @returns {Map<string, Set<string>>} Escaping error identities by source-visible function name.
 */
function inferCallEffects(functions, seedEffects = new Map(), localFunctionNames = new Set(functions.keys())) {
  const effects = new Map([...functions.keys()].map((name) => [name, new Set(seedEffects.get(name) ?? [])]))
  let changed = true

  while (changed) {
    changed = false
    for (const name of localFunctionNames) {
      const declaration = functions.get(name)

      if (!declaration) continue
      const next = syntacticBlockEffects(declaration.body, effects)
      const current = /** @type {Set<string>} */ (effects.get(name))

      for (const error of next) {
        if (!current.has(error)) {
          current.add(error)
          changed = true
        }
      }
    }
  }

  return effects
}

/**
 * Computes escaping identities from one block for the call-effect fixed point.
 * @param {unknown} block - Candidate block.
 * @param {Map<string, Set<string>>} callEffects - Current fixed-point state.
 * @returns {Set<string>} Escaping identities.
 */
function syntacticBlockEffects(block, callEffects) {
  const result = new Set()
  const statements = Reflect.get(/** @type {object} */ (block ?? {}), "statements")

  if (!Array.isArray(statements)) return result
  for (const statement of statements) {
    if (!statement || typeof statement != "object") continue
    const kind = Reflect.get(statement, "kind")

    if (kind == "RaiseStatement") {
      const construction = Reflect.get(statement, "error")
      const type = construction && typeof construction == "object" ? Reflect.get(construction, "error") : undefined
      const declarationId = type && typeof type == "object" ? Reflect.get(type, "declarationId") : undefined

      if (typeof declarationId == "string") result.add(declarationId)
      if (construction && typeof construction == "object") addExpressionEffects(result, Reflect.get(construction, "message"), callEffects)
      continue
    }
    if (kind == "TryStatement") {
      const bodyEffects = syntacticBlockEffects(Reflect.get(statement, "body"), callEffects)
      const catchType = Reflect.get(statement, "catchType")
      const caughtId = catchType && typeof catchType == "object" ? Reflect.get(catchType, "declarationId") : undefined

      if (typeof caughtId == "string" && bodyEffects.delete(caughtId)) {
        addAll(bodyEffects, syntacticBlockEffects(Reflect.get(statement, "catchBody"), callEffects))
      }
      addAll(result, bodyEffects)
      continue
    }
    if (kind == "IfStatement") {
      addExpressionEffects(result, Reflect.get(statement, "condition"), callEffects)
      addAll(result, syntacticBlockEffects(Reflect.get(statement, "consequent"), callEffects))
      addAll(result, syntacticBlockEffects(Reflect.get(statement, "alternate"), callEffects))
      continue
    }
    if (kind == "ForEachStatement" || kind == "ForEachMapStatement") {
      addExpressionEffects(result, Reflect.get(statement, kind == "ForEachStatement" ? "list" : "map"), callEffects)
      addAll(result, syntacticBlockEffects(Reflect.get(statement, "body"), callEffects))
      continue
    }
    if (kind == "WhileStatement") {
      addExpressionEffects(result, Reflect.get(statement, "condition"), callEffects)
      addAll(result, syntacticBlockEffects(Reflect.get(statement, "body"), callEffects))
      continue
    }
    for (const key of ["expression", "initializer"]) addExpressionEffects(result, Reflect.get(statement, key), callEffects)
  }

  return result
}

/**
 * Creates a lexical scope with declarations marked pending until visited.
 * @param {Scope | undefined} parent - Enclosing scope.
 * @param {{kind: string, name?: string}[]} statements - Scope statements.
 * @param {Set<string>} [reservedNames] - Names unavailable to root bindings.
 * @param {Set<string>} [typeParameters] - Declaration-scoped type parameters.
 * @param {import("./types.js").ClassDeclaration} [currentClass] - Declaring class for receiver-private access.
 * @returns {Scope} Scope.
 */
function createScope(parent, statements, reservedNames = new Set(), typeParameters = parent?.typeParameters ?? new Set(),
  currentClass = parent?.currentClass) {
  const pending = new Set(statements.filter((statement) => statement.kind == "LocalDeclaration")
    .map((statement) => /** @type {{name: string}} */ (statement).name))

  return {
    bindings: new Map(),
    currentClass,
    parent,
    pending,
    presenceProofs: new Set(parent?.presenceProofs ?? []),
    typeParameters,
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
 * @param {Set<string>} [typeParameters] - Type-variable identities in declaration scope.
 * @returns {import("./types.js").SemanticValueType} Validated value type.
 */
function validateValueTypeReference(type, location, fail, seen, records = new Map(), typeParameters = new Set()) {
  const candidate = validateTypeReference(type, location, fail, seen, records, typeParameters)

  if (isVoidType(candidate)) return fail("VOID_AS_VALUE", "Void is valid only as a function return type.", typeLocation(type, location))

  return candidate
}

/**
 * Validates one function return type reference.
 * @param {unknown} type - Candidate semantic return type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {RecordRegistry} [records] - Record declarations by identity.
 * @param {Set<string>} [typeParameters] - Type-variable identities in declaration scope.
 * @returns {import("./types.js").SemanticFunctionReturnType} Validated return type.
 */
function validateReturnTypeReference(type, location, fail, records = new Map(), typeParameters = new Set()) {
  return validateTypeReference(type, location, fail, new Set(), records, typeParameters)
}

/**
 * Validates one recursive semantic type-reference shape.
 * @param {unknown} type - Candidate semantic type reference.
 * @param {import("./types.js").SourceLocation} location - Owning source location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {Set<object>} [seen] - Active recursive type path.
 * @param {RecordRegistry} [records] - Record declarations by identity.
 * @param {Set<string>} [typeParameters] - Type-variable identities in declaration scope.
 * @returns {import("./types.js").SemanticFunctionReturnType} Validated type.
 */
function validateTypeReference(type, location, fail, seen = new Set(), records = new Map(), typeParameters = new Set()) {
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
  if (candidate.kind == "TypeVariableReference") {
    if (Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",") != "kind,location,parameterId" ||
      typeof candidate.parameterId != "string" || !typeParameters.has(candidate.parameterId)) {
      fail("FREE_TYPE_VARIABLE", `Free or unknown type variable '${String(candidate.parameterId)}'.`, typeLocation(candidate, location))
    }

    return candidate
  }
  if (candidate.kind == "RecordType") {
    const keys = Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",")
    const declaration = records.get(candidate.declarationId)

    if (!(["arguments,declarationId,kind", "declarationId,kind"].includes(keys)) ||
      typeof candidate.declarationId != "string" || !declaration) {
      fail("UNKNOWN_RECORD", `Unknown record declaration '${String(candidate.declarationId)}'.`, typeLocation(candidate, location))
    }
    const expectedArity = declaration.typeParameters?.length ?? 0

    if (expectedArity > 0 && candidate.arguments === undefined) {
      fail("RAW_GENERIC_APPLICATION", `Generic record '${declaration.name}' requires ${expectedArity} type arguments.`, typeLocation(candidate, location))
    }
    if (expectedArity == 0 && candidate.arguments !== undefined) {
      fail("GENERIC_ARITY_MISMATCH", `Non-generic record '${declaration.name}' does not accept type arguments.`, typeLocation(candidate, location))
    }
    const candidateArguments = candidate.arguments

    if (candidateArguments !== undefined && (!Array.isArray(candidateArguments) ||
      candidateArguments.some((_argument, index) => !Object.hasOwn(candidateArguments, index)))) {
      fail("TYPE_MISMATCH", "Generic record arguments must be a dense ordered array.", typeLocation(candidate, location))
    }
    const arguments_ = candidate.arguments ?? []

    if (arguments_.length != expectedArity) {
      fail("GENERIC_ARITY_MISMATCH", `Record '${declaration.name}' has ${arguments_.length} type arguments; expected ${expectedArity}.`, typeLocation(candidate, location))
    }
    if (seen.has(candidate)) {
      return fail("TYPE_MISMATCH", "Recursive generic applications cannot contain cycles.", typeLocation(candidate, location))
    }
    seen.add(candidate)
    for (const argument of arguments_) {
      validateValueTypeReference(argument, typeLocation(argument, location), fail, seen, records, typeParameters)
    }
    seen.delete(candidate)

    return candidate
  }
  if (candidate.kind == "ReferenceType") {
    const classes = referenceClassesFor(records)

    if (Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",") != "declarationId,kind" ||
      typeof candidate.declarationId != "string" || !classes.has(candidate.declarationId)) {
      fail("UNKNOWN_CLASS", `Unknown reference class declaration '${String(candidate.declarationId)}'.`, typeLocation(candidate, location))
    }

    return candidate
  }
  if (candidate.kind == "ListType") {
    if (seen.has(candidate)) return fail("TYPE_MISMATCH", "Recursive collection types cannot contain cycles.", typeLocation(candidate, location))
    seen.add(candidate)
    const elementType = validateValueTypeReference(candidate.elementType, typeLocation(candidate, location, "elementType"), fail, seen, records, typeParameters)

    seen.delete(candidate)

    if (candidate.elementType !== elementType) candidate.elementType = elementType

    return candidate
  }
  if (candidate.kind == "MapType" || candidate.kind == "OrderedMapType") {
    const expectedFields = candidate.kind == "OrderedMapType" ? "keyType,kind,order,valueType" : "keyType,kind,valueType"

    if (Object.keys(candidate).filter((key) => key != "sourceProvenance").sort().join(",") != expectedFields) {
      return fail("TYPE_MISMATCH", `Malformed ${candidate.kind == "OrderedMapType" ? "ordered map" : "map"} type.`,
        typeLocation(candidate, location))
    }
    if (candidate.kind == "OrderedMapType" && candidate.order != "insertion") {
      return fail("TYPE_MISMATCH", "Ordered map type requires insertion order.", typeLocation(candidate, location))
    }
    if (seen.has(candidate)) return fail("TYPE_MISMATCH", "Recursive collection types cannot contain cycles.", typeLocation(candidate, location))
    seen.add(candidate)
    const keyType = validateValueTypeReference(candidate.keyType, typeLocation(candidate, location, "keyType"), fail, seen, records, typeParameters)

    if (!isScalarType(keyType, "string")) {
      fail("TYPE_MISMATCH", `Map key type ${typeDescription(keyType)}; expected string.`, typeLocation(candidate.keyType, location))
    }
    const valueType = validateValueTypeReference(candidate.valueType, typeLocation(candidate, location, "valueType"), fail, seen, records, typeParameters)

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
    const valueType = validateValueTypeReference(candidate.valueType, typeLocation(candidate, location, "valueType"), fail, seen, records, typeParameters)

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
 * Retrieves the reference-class registry attached to the record validation context.
 * @param {RecordRegistry} records - Record validation registry.
 * @returns {ClassRegistry} Reference classes.
 */
function referenceClassesFor(records) {
  return referenceClassesByRecordRegistry.get(records) ?? new Map()
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
 * @param {boolean} [inferCollectionElements] - Whether a generic-call evidence pass may infer nonempty collection literals.
 * @returns {import("./types.js").SemanticValueType} Expression value type.
 */
function inferValueExpressionType(expression, scope, functions, records, fail, normalizeOperations, context, expectedType,
  inferCollectionElements = false) {
  const type = inferExpressionType(expression, scope, functions, records, fail, normalizeOperations, expectedType, inferCollectionElements)

  if (type == "void") return fail("VOID_AS_VALUE", `Void call cannot be used as ${context}.`, expression.location)
  if (type.kind == "ErrorType") return fail("TYPE_MISMATCH", `Error value cannot be used as ${context}.`, expression.location)

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
 * @param {boolean} [inferCollectionElements] - Whether a generic-call evidence pass may infer nonempty collection literals.
 * @returns {import("./types.js").SemanticBindingType | "void"} Expression type.
 */
function inferExpressionType(expression, scope, functions, records, fail, normalizeOperations, expectedType,
  inferCollectionElements = false) {
  if (expression.kind == "IdentifierExpression") return resolveBinding(expression.name, expression.location, scope, fail).type

  if (expression.kind == "ReceiverExpression") {
    if (!scope.currentClass || expression.classId != scope.currentClass.id) {
      return fail("ILLEGAL_PRIVATE_ACCESS", "Receiver expression is valid only inside its declaring class.", expression.location)
    }

    return {declarationId: /** @type {string} */ (scope.currentClass.id), kind: "ReferenceType"}
  }

  if (expression.kind == "PrivateFieldRead") {
    const declaration = scope.currentClass

    if (!declaration || !expression.receiver || expression.receiver.kind != "ReceiverExpression" ||
      expression.receiver.classId != declaration.id) {
      return fail("ILLEGAL_PRIVATE_ACCESS", "Private field receiver must be the declaring class receiver.", expression.location)
    }
    const field = declaration.fields.find((candidate) => candidate.id == expression.field)

    if (!field) return fail("ILLEGAL_PRIVATE_ACCESS", "Private field identity is not owned by the declaring class.", expression.location)

    return field.type
  }

  if (expression.kind == "ErrorMessageRead") {
    if (!expression.receiver || expression.receiver.kind != "IdentifierExpression") {
      return fail("INVALID_MEMBER_RECEIVER", "Error message receiver must be one catch binding.", expression.location)
    }
    const receiver = resolveBinding(expression.receiver.name, expression.receiver.location, scope, fail)

    if (receiver.type.kind != "ErrorType") {
      return fail("INVALID_MEMBER_RECEIVER", "Message member requires a typed error catch binding.", expression.receiver.location)
    }

    return scalarType("string")
  }

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
      const valueType = inferValueExpressionType(
        expression.value, scope, functions, records, fail, normalizeOperations, "an optional present value"
      )

      if (valueType.kind == "OptionalType") {
        return fail("INVALID_OPTIONAL_CONSTITUENT", "Optional values cannot directly contain another optional.", expression.value.location)
      }

      return {kind: "OptionalType", valueType}
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
    if (!Array.isArray(expression.elements)) {
      return fail("TYPE_MISMATCH", "List literal elements must be a dense source-ordered array.", expression.location)
    }
    if ((!expectedType || expectedType.kind != "ListType") &&
      (!inferCollectionElements || expression.elements.length == 0)) {
      return fail("MISSING_TYPE", "List literal requires an explicit recursive list type.", expression.location)
    }
    /** @type {import("./types.js").SemanticValueType | undefined} */
    let inferredElementType
    for (let index = 0; index < expression.elements.length; index++) {
      if (!Object.hasOwn(expression.elements, index)) {
        fail("TYPE_MISMATCH", "Sparse list literals are outside the implemented subset.", expression.location)
      }
      const element = expression.elements[index]
      const actual = inferValueExpressionType(
        element, scope, functions, records, fail, normalizeOperations, "a list element",
        expectedType?.kind == "ListType" ? expectedType.elementType : inferredElementType, inferCollectionElements
      )

      inferredElementType ??= actual
      const requiredElementType = expectedType?.kind == "ListType" ? expectedType.elementType : inferredElementType

      if (!sameType(actual, requiredElementType)) {
        fail("TYPE_MISMATCH", `List element type ${typeDescription(actual)}; expected ${typeDescription(requiredElementType)}.`, element.location)
      }
    }

    return expectedType?.kind == "ListType"
      ? expectedType
      : {elementType: /** @type {import("./types.js").SemanticValueType} */ (inferredElementType), kind: "ListType"}
  }
  if (expression.kind == "MapLiteral") {
    if (expectedType && expectedType.kind != "MapType") {
      return fail("TYPE_MISMATCH", `Map literal context ${typeDescription(expectedType)}; expected map.`, expression.location)
    }
    if (!expectedType && !inferCollectionElements) {
      return fail("MISSING_TYPE", "Map literal requires an explicit recursive map type.", expression.location)
    }
    if (expectedType?.kind == "MapType" && !isScalarType(expectedType.keyType, "string")) {
      return fail("TYPE_MISMATCH", "Map key type must be string.", typeLocation(expectedType.keyType, expression.location))
    }
    const entries = validateMapLiteralEntries(expression, scope, functions, records, fail, normalizeOperations,
      inferCollectionElements)

    if (!expectedType && entries.length == 0) {
      return fail("MISSING_TYPE", "Empty map literal requires an explicit recursive map type.", expression.location)
    }
    /** @type {import("./types.js").SemanticValueType | undefined} */
    let inferredValueType

    for (const entry of entries) {
      const actual = inferValueExpressionType(
        entry.value, scope, functions, records, fail, normalizeOperations, "a map value",
        expectedType?.kind == "MapType" ? expectedType.valueType : inferredValueType, inferCollectionElements
      )
      inferredValueType ??= actual
      const requiredValueType = expectedType?.kind == "MapType" ? expectedType.valueType : inferredValueType

      if (!sameType(actual, requiredValueType)) {
        fail("TYPE_MISMATCH", `Map value type ${typeDescription(actual)}; expected ${typeDescription(requiredValueType)}.`, entry.value.location)
      }
    }

    return expectedType?.kind == "MapType" ? expectedType : {
      keyType: scalarType("string"),
      kind: "MapType",
      valueType: /** @type {import("./types.js").SemanticValueType} */ (inferredValueType)
    }
  }
  if (expression.kind == "OrderedMapLiteral") {
    if (expectedType && expectedType.kind != "OrderedMapType") {
      return fail("TYPE_MISMATCH", `Ordered-map literal context ${typeDescription(expectedType)}; expected ordered map.`, expression.location)
    }
    if (!expectedType && !inferCollectionElements) {
      return fail("MISSING_TYPE", "Ordered-map literal requires an explicit recursive ordered-map type.", expression.location)
    }
    if (expectedType?.kind == "OrderedMapType" && !isScalarType(expectedType.keyType, "string")) {
      return fail("TYPE_MISMATCH", "Ordered-map key type must be string.", typeLocation(expectedType.keyType, expression.location))
    }
    const entries = validateMapLiteralEntries(expression, scope, functions, records, fail, normalizeOperations,
      inferCollectionElements)

    if (!expectedType && entries.length == 0) {
      return fail("MISSING_TYPE", "Empty ordered-map literal requires an explicit recursive ordered-map type.", expression.location)
    }
    /** @type {import("./types.js").SemanticValueType | undefined} */
    let inferredValueType

    for (const entry of entries) {
      const actual = inferValueExpressionType(
        entry.value, scope, functions, records, fail, normalizeOperations, "an ordered-map value",
        expectedType?.kind == "OrderedMapType" ? expectedType.valueType : inferredValueType, inferCollectionElements
      )
      inferredValueType ??= actual
      const requiredValueType = expectedType?.kind == "OrderedMapType" ? expectedType.valueType : inferredValueType

      if (!sameType(actual, requiredValueType)) {
        fail("TYPE_MISMATCH", `Ordered-map value type ${typeDescription(actual)}; expected ${typeDescription(requiredValueType)}.`,
          entry.value.location)
      }
    }

    return expectedType?.kind == "OrderedMapType" ? expectedType : {
      keyType: scalarType("string"),
      kind: "OrderedMapType",
      order: "insertion",
      valueType: /** @type {import("./types.js").SemanticValueType} */ (inferredValueType)
    }
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

    if (collectionType.kind != "MapType" && collectionType.kind != "OrderedMapType") {
      return fail("TYPE_MISMATCH", `Map lookup receiver type ${typeDescription(collectionType)}; expected map.`, expression.collection.location)
    }
    if (!isScalarType(keyType, "string")) {
      fail("TYPE_MISMATCH", `Map lookup key type ${typeDescription(keyType)}; expected string.`, expression.key.location)
    }
    const knownCollection = knownValueForExpression(expression.collection, scope)
    const knownKey = knownValueForExpression(expression.key, scope)

    if ((knownCollection?.kind == "MapLiteral" || knownCollection?.kind == "OrderedMapLiteral") &&
      knownKey?.kind == "StringLiteral" &&
      !knownCollection.entries.some((entry) => entry.key.value == knownKey.value)) {
      fail("MISSING_MAP_KEY", `Map key '${knownKey.value}' is absent from the literal initializer.`, expression.location)
    }
    const proven = provenMapValue(expression.collection, expression.key, scope)

    validateAccessTotality(expression, proven !== undefined, normalizeOperations, fail)

    return collectionType.valueType
  }
  if (expression.kind == "CollectionSizeExpression") {
    const collectionType = inferValueExpressionType(expression.collection, scope, functions, records, fail, normalizeOperations, "a collection-size receiver")

    if (collectionType.kind != "ListType" && collectionType.kind != "MapType" && collectionType.kind != "OrderedMapType") {
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
  if (expression.kind == "ReferenceConstruction") {
    const referenceType = validateValueTypeReference(expression.reference, expression.location, fail, undefined, records,
      scope.typeParameters)

    if (referenceType.kind != "ReferenceType") {
      return fail("TYPE_MISMATCH", "Reference construction requires a nominal reference class type.", expression.location)
    }
    const declaration = referenceClassesFor(records).get(referenceType.declarationId)

    if (!declaration) return fail("UNKNOWN_CLASS", `Unknown reference class '${referenceType.declarationId}'.`, expression.location)
    if (!isDenseArray(expression.arguments)) {
      return fail("TYPE_MISMATCH", "Constructor arguments must be a dense ordered array.", expression.location)
    }
    if (expression.arguments.length != declaration.constructor.parameters.length) {
      return fail("CONSTRUCTOR_ARITY_MISMATCH",
        `Constructor for '${declaration.name}' has ${expression.arguments.length} arguments; expected ${declaration.constructor.parameters.length}.`,
        expression.location)
    }
    const parameterTypes = declaration.constructor.parameters.map((parameter) =>
      validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records))

    for (let index = 0; index < expression.arguments.length; index += 1) {
      const actual = inferValueExpressionType(expression.arguments[index], scope, functions, records, fail,
        normalizeOperations, "a constructor argument", parameterTypes[index])

      if (!sameType(actual, parameterTypes[index])) {
        fail("TYPE_MISMATCH", `Constructor argument type ${typeDescription(actual)}; expected ${typeDescription(parameterTypes[index])}.`,
          expression.arguments[index].location)
      }
    }
    const resolution = {
      declarationId: /** @type {string} */ (declaration.constructor.id),
      kind: /** @type {const} */ ("ResolvedConstructorSignature"),
      parameterTypes: parameterTypes.map((type) => /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type)))
    }

    if (normalizeOperations) expression.resolution = resolution
    else validateReferenceResolution(expression.resolution, resolution, expression.location, fail, "constructor")

    return referenceType
  }
  if (expression.kind == "MethodCallExpression") {
    const receiverType = inferValueExpressionType(expression.receiver, scope, functions, records, fail,
      normalizeOperations, "a method receiver")

    if (receiverType.kind != "ReferenceType") {
      return fail("INVALID_METHOD_RECEIVER", "Method call receiver must have a reference class type.", expression.receiver.location)
    }
    const declaration = referenceClassesFor(records).get(receiverType.declarationId)

    if (!declaration) return fail("UNKNOWN_CLASS", `Unknown reference class '${receiverType.declarationId}'.`, expression.receiver.location)
    const method = declaration.methods.find((candidate) => candidate.id == expression.method) ??
      (normalizeOperations ? declaration.methods.find((candidate) => candidate.name == expression.method) : undefined)

    if (!method) return fail("UNKNOWN_METHOD", `Class '${declaration.name}' has no method '${expression.method}'.`,
      roleLocation(expression, "member"))
    if (normalizeOperations) expression.method = /** @type {string} */ (method.id)
    if (!isDenseArray(expression.arguments)) return fail("TYPE_MISMATCH", "Method arguments must be a dense ordered array.", expression.location)
    if (expression.arguments.length != method.parameters.length) {
      return fail("METHOD_ARITY_MISMATCH",
        `Method '${method.name}' has ${expression.arguments.length} arguments; expected ${method.parameters.length}.`, expression.location)
    }
    const parameterTypes = method.parameters.map((parameter) =>
      validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records))

    for (let index = 0; index < expression.arguments.length; index += 1) {
      const actual = inferValueExpressionType(expression.arguments[index], scope, functions, records, fail,
        normalizeOperations, "a method argument", parameterTypes[index])

      if (!sameType(actual, parameterTypes[index])) {
        fail("TYPE_MISMATCH", `Method argument type ${typeDescription(actual)}; expected ${typeDescription(parameterTypes[index])}.`,
          expression.arguments[index].location)
      }
    }
    const returnType = validateReturnTypeReference(method.returnType, method.location, fail, records)
    const resolution = {
      declarationId: /** @type {string} */ (method.id),
      kind: /** @type {const} */ ("ResolvedMethodSignature"),
      parameterTypes: parameterTypes.map((type) => /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type))),
      returnType: typeIdentity(returnType)
    }

    if (normalizeOperations) expression.resolution = resolution
    else validateReferenceResolution(expression.resolution, resolution, expression.location, fail, "method")

    return isVoidType(returnType) ? "void" : returnType
  }
  if (expression.kind == "RecordConstruction") {
    const recordType = validateValueTypeReference(expression.record, expression.location, fail, undefined, records, scope.typeParameters)

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
    const substitutions = recordTypeSubstitutions(recordType, declaration)
    for (let index = 0; index < expression.arguments.length; index += 1) {
      const argument = expression.arguments[index]
      const field = declaration.fields[index]
      const fieldType = substituteValueType(field.type, substitutions)
      const actual = inferValueExpressionType(
        argument, scope, functions, records, fail, normalizeOperations, `record field '${field.name}'`, fieldType
      )

      if (!sameType(actual, fieldType)) {
        fail("TYPE_MISMATCH", `Record field '${field.name}' argument type ${typeDescription(actual)}; expected ${typeDescription(fieldType)}.`, argument.location)
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

    return substituteValueType(field.type, recordTypeSubstitutions(receiverType, declaration))
  }
  if (expression.kind == "CallExpression") {
    const functionDeclaration = functions.get(expression.callee)

    if (!functionDeclaration) {
      return fail("UNRESOLVED_BINDING", `Unknown function '${expression.callee}'.`, roleLocation(expression, "callee"))
    }
    if (expression.arguments.length != functionDeclaration.parameters.length) {
      return fail("TYPE_MISMATCH", `Call argument count for '${expression.callee}'.`, expression.location)
    }
    const declarationTypeParameters = declarationTypeParameterIds(functionDeclaration)
    /** @type {Map<string, import("./types.js").SemanticValueType>} */
    const substitutions = new Map()
    const parameterTypes = functionDeclaration.parameters.map((parameter) => validateValueTypeReference(
      parameter.type, parameter.location, fail, undefined, records, declarationTypeParameters
    ))
    for (let index = 0; index < expression.arguments.length; index++) {
      const argument = expression.arguments[index]
      const expectedType = parameterTypes[index]
      const gathersGenericEvidence = typeContainsAnyVariable(expectedType)

      if (gathersGenericEvidence) {
        inferGenericArgumentEvidence(expectedType, argument, substitutions, scope, functions, records, fail,
          normalizeOperations)
        continue
      }
      const actualType = inferValueExpressionType(
        argument, scope, functions, records, fail, normalizeOperations, "a call argument", expectedType
      )

      if ((functionDeclaration.typeParameters?.length ?? 0) > 0) {
        inferTypeArguments(expectedType, actualType, substitutions, argument.location, fail)
      } else if (!sameType(actualType, expectedType)) {
        fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actualType)}; expected ${typeDescription(expectedType)}.`, argument.location)
      }
    }
    for (const parameter of functionDeclaration.typeParameters ?? []) {
      if (!substitutions.has(/** @type {string} */ (parameter.id))) {
        const evidenceFreeIndex = parameterTypes.findIndex((type) =>
          typeContainsVariable(type, /** @type {string} */ (parameter.id)))

        if (evidenceFreeIndex >= 0) {
          fail("GENERIC_INFERENCE_FAILURE", "Cannot infer a type parameter from an evidence-free call argument.",
            expression.arguments[evidenceFreeIndex].location)
        }
        fail("GENERIC_INFERENCE_FAILURE", `Cannot infer type parameter '${parameter.name}' from call arguments.`, expression.location)
      }
    }
    for (let index = 0; index < functionDeclaration.parameters.length; index += 1) {
      const expected = substituteValueType(functionDeclaration.parameters[index].type, substitutions)
      const actual = inferValueExpressionType(expression.arguments[index], scope, functions, records, fail,
        normalizeOperations, "a call argument", expected)

      if (!sameType(actual, expected)) {
        fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actual)}; expected ${typeDescription(expected)}.`, expression.arguments[index].location)
      }
    }
    const resolution = signatureFor(functionDeclaration, records, fail, substitutions)

    if (normalizeOperations) expression.resolution = resolution
    else validateResolution(expression.resolution, resolution, expression.location, fail)
    const returnType = substituteReturnType(validateReturnTypeReference(functionDeclaration.returnType,
      functionDeclaration.location, fail, records, declarationTypeParameters), substitutions)

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
 * Validates map layout and fixed string keys independently of contextual value inference.
 * @param {import("./types.js").MapLiteral | import("./types.js").OrderedMapLiteral} expression - Candidate map literal.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to normalize frontend intent.
 * @param {boolean} inferCollectionElements - Whether nested collection evidence may be inferred.
 * @returns {import("./types.js").MapEntry[]} Validated dense entries.
 */
function validateMapLiteralEntries(expression, scope, functions, records, fail, normalizeOperations,
  inferCollectionElements) {
  if (!Array.isArray(expression.entries)) {
    return fail("TYPE_MISMATCH", "Map literal entries must be a dense source-ordered array.", expression.location)
  }
  if (!isDenseArray(expression.entries)) {
    return fail("TYPE_MISMATCH", "Sparse map literals are outside the implemented subset.", expression.location)
  }
  const keys = new Set()

  for (const entry of expression.entries) {
    if (!entry || entry.kind != "MapEntry" || !entry.key || entry.key.kind != "StringLiteral") {
      fail("TYPE_MISMATCH", "Map entries require literal string keys.", entry?.location ?? expression.location)
    }
    inferValueExpressionType(entry.key, scope, functions, records, fail, normalizeOperations, "a map key",
      scalarType("string"), inferCollectionElements)
    if (isNumericString(entry.key.value)) {
      fail("INVALID_MAP_KEY", "Map initializer keys must be nonnumeric strings.", entry.key.location)
    }
    if (keys.has(entry.key.value)) {
      fail("DUPLICATE_MAP_KEY", `Duplicate ${expression.kind == "OrderedMapLiteral" ? "ordered-map" : "map"} key '${entry.key.value}'.`,
        entry.key.location)
    }
    keys.add(entry.key.value)
  }

  return expression.entries
}

/**
 * Collects argument-only generic evidence while deferring recursively contextual literals.
 * The complete argument is validated against its closed substituted type after inference.
 * @param {import("./types.js").SemanticValueType} formal - Open declaration parameter type.
 * @param {import("./types.js").Expression} expression - Call argument or nested collection value.
 * @param {Map<string, import("./types.js").SemanticValueType>} substitutions - Inference state.
 * @param {Scope} scope - Visible lexical scope.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Module function signatures.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {boolean} normalizeOperations - Whether to normalize frontend intent.
 * @returns {void}
 */
function inferGenericArgumentEvidence(formal, expression, substitutions, scope, functions, records, fail,
  normalizeOperations) {
  if (expression.kind == "OptionalNone") return
  if (formal.kind == "OptionalType" && expression.kind == "OptionalSome") {
    inferGenericArgumentEvidence(formal.valueType, expression.value, substitutions, scope, functions, records, fail,
      normalizeOperations)
    return
  }
  if (formal.kind == "ListType" && expression.kind == "ListLiteral") {
    if (!Array.isArray(expression.elements)) {
      fail("TYPE_MISMATCH", "List literal elements must be a dense source-ordered array.", expression.location)
    }
    if (!isDenseArray(expression.elements)) {
      fail("TYPE_MISMATCH", "Sparse list literals are outside the implemented subset.", expression.location)
    }
    for (const element of expression.elements) {
      inferGenericArgumentEvidence(formal.elementType, element, substitutions, scope, functions, records, fail,
        normalizeOperations)
    }
    return
  }
  if ((formal.kind == "MapType" && expression.kind == "MapLiteral") ||
    (formal.kind == "OrderedMapType" && expression.kind == "OrderedMapLiteral")) {
    const entries = validateMapLiteralEntries(expression, scope, functions, records, fail, normalizeOperations, true)

    for (const entry of entries) {
      inferGenericArgumentEvidence(formal.valueType, entry.value, substitutions, scope, functions, records, fail,
        normalizeOperations)
    }
    return
  }
  const actual = inferValueExpressionType(
    expression, scope, functions, records, fail, normalizeOperations, "a call argument", undefined, true
  )

  inferTypeArguments(formal, actual, substitutions, expression.location, fail)
}

/**
 * Unifies one declaration-owned formal type with one argument type.
 * @param {import("./types.js").SemanticValueType} formal - Generic signature type.
 * @param {import("./types.js").SemanticValueType} actual - Inferred argument type.
 * @param {Map<string, import("./types.js").SemanticValueType>} substitutions - Inference state.
 * @param {import("./types.js").SourceLocation} location - Argument location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @returns {void}
 */
function inferTypeArguments(formal, actual, substitutions, location, fail) {
  if (formal.kind == "TypeVariableReference") {
    const prior = substitutions.get(formal.parameterId)

    if (prior) {
      if (!sameType(prior, actual)) {
        fail("GENERIC_INFERENCE_CONFLICT", `Conflicting inference for type parameter '${formal.parameterId}'.`, location)
      }
      return
    }
    if (!(actual.kind == "TypeVariableReference" && actual.parameterId == formal.parameterId) &&
      typeContainsVariable(actual, formal.parameterId)) {
      fail("GENERIC_INFERENCE_RECURSION", `Recursive inference for type parameter '${formal.parameterId}'.`, location)
    }
    substitutions.set(formal.parameterId, actual)
    return
  }
  if (formal.kind != actual.kind) {
    fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actual)}; expected ${typeDescription(formal)}.`, location)
  }
  if (formal.kind == "TypeReference") {
    if (!sameType(formal, actual)) {
      fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actual)}; expected ${typeDescription(formal)}.`, location)
    }
    return
  }
  if (formal.kind == "ReferenceType" && actual.kind == "ReferenceType") {
    if (formal.declarationId != actual.declarationId) {
      fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actual)}; expected ${typeDescription(formal)}.`, location)
    }
    return
  }
  if (formal.kind == "RecordType" && actual.kind == "RecordType") {
    if (formal.declarationId != actual.declarationId || (formal.arguments?.length ?? 0) != (actual.arguments?.length ?? 0)) {
      fail("TYPE_MISMATCH", `Call argument type ${typeDescription(actual)}; expected ${typeDescription(formal)}.`, location)
    }
    for (let index = 0; index < (formal.arguments?.length ?? 0); index += 1) {
      inferTypeArguments(/** @type {import("./types.js").SemanticValueType} */ (formal.arguments?.[index]),
        /** @type {import("./types.js").SemanticValueType} */ (actual.arguments?.[index]), substitutions, location, fail)
    }
    return
  }
  if (formal.kind == "ListType" && actual.kind == "ListType") {
    inferTypeArguments(formal.elementType, actual.elementType, substitutions, location, fail)
    return
  }
  if (formal.kind == "OptionalType" && actual.kind == "OptionalType") {
    inferTypeArguments(formal.valueType, actual.valueType, substitutions, location, fail)
    return
  }
  if ((formal.kind == "MapType" && actual.kind == "MapType") ||
    (formal.kind == "OrderedMapType" && actual.kind == "OrderedMapType")) {
    inferTypeArguments(formal.keyType, actual.keyType, substitutions, location, fail)
    inferTypeArguments(formal.valueType, actual.valueType, substitutions, location, fail)
  }
}

/**
 * Checks the occurs constraint for first-order inference.
 * @param {import("./types.js").SemanticValueType} type - Candidate inferred type.
 * @param {string} parameterId - Parameter being inferred.
 * @returns {boolean} Whether the type recursively contains the parameter.
 */
function typeContainsVariable(type, parameterId) {
  if (type.kind == "TypeVariableReference") return type.parameterId == parameterId
  if (type.kind == "RecordType") return type.arguments?.some((argument) => typeContainsVariable(argument, parameterId)) ?? false
  if (type.kind == "ListType") return typeContainsVariable(type.elementType, parameterId)
  if (type.kind == "MapType" || type.kind == "OrderedMapType") {
    return typeContainsVariable(type.keyType, parameterId) || typeContainsVariable(type.valueType, parameterId)
  }
  if (type.kind == "OptionalType") return typeContainsVariable(type.valueType, parameterId)

  return false
}

/**
 * Applies substitutions to a value or void return type.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Open return type.
 * @param {Map<string, import("./types.js").SemanticValueType>} substitutions - Closed substitutions.
 * @returns {import("./types.js").SemanticFunctionReturnType} Substituted return type.
 */
function substituteReturnType(type, substitutions) {
  return isVoidType(type) ? type : substituteValueType(type, substitutions)
}

/**
 * Builds the exact semantic signature bound to one declaration.
 * @param {import("./types.js").FunctionDeclaration} declaration - Resolved declaration.
 * @param {RecordRegistry} records - Record declarations by identity.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {Map<string, import("./types.js").SemanticValueType>} [substitutions] - Inferred generic substitutions.
 * @returns {import("./types.js").ResolvedFunctionSignature} Detached signature binding.
 */
function signatureFor(declaration, records, fail, substitutions = new Map()) {
  const typeParameters = declarationTypeParameterIds(declaration)
  const declaredParameters = declaration.typeParameters ?? []
  const parameterTypes = declaration.parameters.map((parameter) =>
    substituteValueType(validateValueTypeReference(parameter.type, parameter.location, fail, undefined, records, typeParameters), substitutions))
  const returnType = substituteReturnType(
    validateReturnTypeReference(declaration.returnType, declaration.location, fail, records, typeParameters), substitutions)

  return {
    declarationId: /** @type {string} */ (declaration.id),
    kind: "ResolvedFunctionSignature",
    parameterTypes: parameterTypes.map((type) => /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type))),
    returnType: typeIdentity(returnType),
    ...(declaredParameters.length > 0 ? {
      typeArguments: declaredParameters.map((parameter) =>
        /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(/** @type {import("./types.js").SemanticValueType} */ (
          substitutions.get(/** @type {string} */ (parameter.id))
        ))))
    } : {})
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
  const expectedKeys = expected.typeArguments ? "declarationId,kind,parameterTypes,returnType,typeArguments" :
    "declarationId,kind,parameterTypes,returnType"

  if (!actual || typeof actual != "object" || Array.isArray(actual) ||
    Object.keys(actual).sort().join(",") != expectedKeys) {
    fail("TYPE_MISMATCH", "Call is missing an exact resolved function signature.", location)
  }
  const candidate = /** @type {import("./types.js").ResolvedFunctionSignature} */ (actual)

  if (candidate.kind != "ResolvedFunctionSignature" || typeof candidate.declarationId != "string" ||
    !Array.isArray(candidate.parameterTypes) || !validTypeIdentity(candidate.returnType, true) ||
    candidate.declarationId != expected.declarationId ||
    !sameTypeIdentity(candidate.returnType, expected.returnType) || candidate.parameterTypes.length != expected.parameterTypes.length) {
    fail("TYPE_MISMATCH", "Call resolution does not match its declaration signature.", location)
  }
  if (expected.typeArguments) {
    const candidateTypeArguments = candidate.typeArguments

    if (!isDenseArray(candidateTypeArguments) || candidateTypeArguments.length != expected.typeArguments.length ||
      candidateTypeArguments.some((type, index) =>
        !validTypeIdentity(type, false) || !sameTypeIdentity(type, expected.typeArguments?.[index]))) {
      fail("TYPE_MISMATCH", "Call resolution does not match its inferred type arguments.", location)
    }
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
 * Validates exact caller-owned constructor or method resolution metadata.
 * @param {unknown} actual - Candidate resolution.
 * @param {import("./types.js").ResolvedConstructorSignature | import("./types.js").ResolvedMethodSignature} expected - Exact resolution.
 * @param {import("./types.js").SourceLocation} location - Expression location.
 * @param {SemanticFail} fail - Diagnostic callback.
 * @param {"constructor" | "method"} role - Resolution role.
 * @returns {void}
 */
function validateReferenceResolution(actual, expected, location, fail, role) {
  const expectedKeys = role == "constructor" ? "declarationId,kind,parameterTypes" :
    "declarationId,kind,parameterTypes,returnType"

  if (!actual || typeof actual != "object" || Array.isArray(actual) || Object.keys(actual).sort().join(",") != expectedKeys) {
    fail("TYPE_MISMATCH", `Reference ${role} call is missing an exact resolved ${role} signature.`, location)
  }
  const candidate = /** @type {Record<string, unknown>} */ (actual)

  if (candidate.kind != expected.kind || candidate.declarationId != expected.declarationId ||
    !isDenseArray(candidate.parameterTypes) || candidate.parameterTypes.length != expected.parameterTypes.length ||
    candidate.parameterTypes.some((type, index) => !validTypeIdentity(type, false) ||
      !sameTypeIdentity(type, expected.parameterTypes[index])) ||
    role == "method" && (!validTypeIdentity(candidate.returnType, true) ||
      !sameTypeIdentity(candidate.returnType, /** @type {import("./types.js").ResolvedMethodSignature} */ (expected).returnType))) {
    fail("TYPE_MISMATCH", `Resolved ${role} signature does not match its declaration.`, location)
  }
}

/**
 * Converts a semantic type to its detached call-resolution identity.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Validated semantic type.
 * @returns {import("./types.js").FunctionReturnTypeIdentity} Detached identity.
 */
function typeIdentity(type) {
  if (type.kind == "TypeReference") return type.name
  if (type.kind == "TypeVariableReference") return {kind: "TypeVariableReference", parameterId: type.parameterId}
  if (type.kind == "RecordType") return {
    declarationId: type.declarationId,
    kind: "RecordType",
    ...(type.arguments ? {arguments: type.arguments.map((argument) =>
      /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(argument)))} : {})
  }
  if (type.kind == "ReferenceType") return {declarationId: type.declarationId, kind: "ReferenceType"}
  if (type.kind == "ListType") return {elementType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.elementType)), kind: "ListType"}
  if (type.kind == "OptionalType") return {kind: "OptionalType", valueType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.valueType))}
  if (type.kind == "OrderedMapType") return {
    keyType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.keyType)),
    kind: "OrderedMapType",
    order: "insertion",
    valueType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.valueType))
  }

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
  } else if (candidate.kind == "OrderedMapType" &&
    Object.keys(candidate).sort().join(",") == "keyType,kind,order,valueType") {
    valid = candidate.keyType == "string" && candidate.order == "insertion" &&
      validTypeIdentity(candidate.valueType, false, seen)
  } else if (candidate.kind == "OptionalType" && Object.keys(candidate).sort().join(",") == "kind,valueType") {
    valid = validTypeIdentity(candidate.valueType, false, seen) &&
      !(candidate.valueType && typeof candidate.valueType == "object" && Reflect.get(candidate.valueType, "kind") == "OptionalType")
  } else if (candidate.kind == "TypeVariableReference" && Object.keys(candidate).sort().join(",") == "kind,parameterId") {
    valid = typeof candidate.parameterId == "string" && /^(?:[a-z][a-z0-9._-]*#)?(?:record|function):[0-9]+:type:[0-9]+$/u.test(candidate.parameterId)
  } else if (candidate.kind == "RecordType" &&
    ["arguments,declarationId,kind", "declarationId,kind"].includes(Object.keys(candidate).sort().join(","))) {
    const candidateArguments = candidate.arguments

    valid = typeof candidate.declarationId == "string" && /^(?:[a-z][a-z0-9._-]*#)?record:[0-9]+$/u.test(candidate.declarationId) &&
      (candidateArguments === undefined || isDenseArray(candidateArguments) &&
        candidateArguments.every((argument) => validTypeIdentity(argument, false, seen)))
  } else if (candidate.kind == "ReferenceType" && Object.keys(candidate).sort().join(",") == "declarationId,kind") {
    valid = typeof candidate.declarationId == "string" &&
      /^(?:[a-z][a-z0-9._-]*#)?class:[0-9]+$/u.test(candidate.declarationId)
  }
  seen.delete(type)

  return valid
}

/**
 * Checks array identity without relying on iteration methods that skip sparse slots.
 * @param {unknown} value - Candidate array.
 * @returns {value is unknown[]} Whether every indexed slot is present.
 */
function isDenseArray(value) {
  if (!Array.isArray(value)) return false

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }

  return true
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
  if (leftType.kind == "TypeVariableReference") return leftType.parameterId == rightType.parameterId
  if (leftType.kind == "RecordType") {
    const leftArguments = Array.isArray(leftType.arguments) ? leftType.arguments : []
    const rightArguments = Array.isArray(rightType.arguments) ? rightType.arguments : []

    return leftType.declarationId == rightType.declarationId && leftArguments.length == rightArguments.length &&
      leftArguments.every((argument, index) => sameTypeIdentity(argument, rightArguments[index]))
  }
  if (leftType.kind == "ReferenceType") return leftType.declarationId == rightType.declarationId
  if (leftType.kind == "MapType" || leftType.kind == "OrderedMapType") {
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
 * @param {import("./types.js").SemanticFunctionReturnType | import("./types.js").ErrorType} type - Semantic type.
 * @returns {string} Stable recursive spelling.
 */
function typeDescription(type) {
  if (type.kind == "TypeReference") return type.name
  if (type.kind == "TypeVariableReference") return `type-variable<${type.parameterId}>`
  if (type.kind == "RecordType") return `record<${type.declarationId}${type.arguments?.length
    ? `, ${type.arguments.map(typeDescription).join(", ")}` : ""}>`
  if (type.kind == "ReferenceType") return `reference<${type.declarationId}>`
  if (type.kind == "ErrorType") return `error<${type.declarationId}>`
  if (type.kind == "ListType") return `list<${typeDescription(type.elementType)}>`
  if (type.kind == "OptionalType") return `optional<${typeDescription(type.valueType)}>`
  if (type.kind == "OrderedMapType") return `ordered-map<string, ${typeDescription(type.valueType)}, insertion>`

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
    } else if (statement.kind == "ForEachStatement" || statement.kind == "ForEachMapStatement" || statement.kind == "WhileStatement") {
      outerMutableBindingsAssignedBy(statement.body, outerScope, assigned)
    } else if (statement.kind == "TryStatement") {
      outerMutableBindingsAssignedBy(statement.body, outerScope, assigned)
      outerMutableBindingsAssignedBy(statement.catchBody, outerScope, assigned)
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
  if (["IntegerLiteral", "BooleanLiteral", "StringLiteral", "ListLiteral", "MapLiteral", "OrderedMapLiteral"].includes(expression.kind)) return expression
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

  if (knownCollection?.kind != "MapLiteral" && knownCollection?.kind != "OrderedMapLiteral" ||
    knownKey?.kind != "StringLiteral") return undefined

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
