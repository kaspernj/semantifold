// @ts-check

import {authorizedOperation, isTask034OperationName} from "./capabilities.js"

/** @typedef {{failureIds: Set<string>, host: boolean}} EffectSummary */
/** @typedef {(expression: import("./types.js").Expression) => void} ExpressionVisitor */

/**
 * Resolves compiler-authorized calls before ordinary semantic type validation.
 * Source functions always win; authority is never inferred from spelling alone.
 * @param {import("./types.js").SemanticModule} module - Parser-authored module.
 * @param {Map<string, import("./types.js").FunctionDeclaration>} functions - Visible ordinary functions.
 * @param {(code: string, detail: string, location: import("./types.js").SourceLocation) => never} fail - Located failure.
 * @param {boolean} normalize - Whether parser-authored operation intent may be normalized.
 * @returns {void}
 */
export function validateEffectGraph(module, functions, fail, normalize) {
  const capabilities = module.capabilities ?? []
  const operationIds = new Set()
  const resourceIds = new Set()
  const failureIds = new Set()
  const operationNames = new Set()

  if (!Array.isArray(capabilities)) fail("INVALID_CAPABILITY_AUTHORITY", "Capabilities must be an ordered array.", module.location)
  for (const [capabilityIndex, capability] of capabilities.entries()) {
    if (!capability || capability.kind != "EffectCapabilityDeclaration" || capability.id != `capability:${capabilityIndex}` ||
      typeof capability.authorityId != "string" || typeof capability.name != "string" || !Array.isArray(capability.resources) ||
      !Array.isArray(capability.failures) || !Array.isArray(capability.operations)) {
      fail("INVALID_CAPABILITY_AUTHORITY", "Malformed capability declaration graph.", module.location)
    }
    for (const [index, resource] of capability.resources.entries()) {
      if (resource.kind != "EffectResourceDeclaration" || resource.id != `${capability.id}/resource:${index}` ||
        resourceIds.has(resource.id)) fail("INVALID_CAPABILITY_AUTHORITY", "Malformed capability resource identity.", module.location)
      resourceIds.add(resource.id)
    }
    for (const [index, failure] of capability.failures.entries()) {
      if (failure.kind != "EffectFailureDeclaration" || failure.id != `${capability.id}/failure:${index}` ||
        failureIds.has(failure.id)) fail("INVALID_CAPABILITY_AUTHORITY", "Malformed capability failure identity.", module.location)
      failureIds.add(failure.id)
    }
    for (const [index, operation] of capability.operations.entries()) {
      if (operation.kind != "EffectOperationDeclaration" || operation.id != `${capability.id}/operation:${index}` ||
        operationIds.has(operation.id) || operationNames.has(operation.name) || !Array.isArray(operation.parameters) ||
        !Array.isArray(operation.failureIds) || operation.effects?.length != 1 || operation.effects[0] != "host" ||
        operation.failureIds.some((id) => !failureIds.has(id))) {
        fail("INVALID_CAPABILITY_AUTHORITY", "Malformed or ambiguous capability operation graph.", module.location)
      }
      operationIds.add(operation.id)
      operationNames.add(operation.name)
    }
  }

  forEachExpression(module, (expression) => {
    if (expression.kind == "EffectCallExpression") {
      const capability = capabilities.find(({id}) => id == expression.resolution?.capabilityId)
      const operation = capability?.operations.find(({id}) => id == expression.operation)

      if (operation && expression.resolution.operationId == operation.id &&
        (!Array.isArray(expression.resolution.failureIds) ||
          expression.resolution.failureIds.join(",") != operation.failureIds.join(","))) {
        fail("UNDECLARED_FAILURE", "UNDECLARED_FAILURE: Effect call failure boundary does not match its compiler authority.",
          expression.location)
      }
      if (!operation || expression.resolution.operationId != operation.id ||
        JSON.stringify(expression.resolution) != JSON.stringify(signature(/** @type {import("./types.js").EffectCapabilityDeclaration} */ (capability), operation))) {
        fail("UNDECLARED_EFFECT", "Effect call resolution does not match its compiler authority.", expression.location)
      }
      return
    }
    if (expression.kind != "CallExpression") return
    if (functions.has(expression.callee)) return
    const match = authorizedOperation(capabilities, expression.callee)

    if (!match) {
      if (isTask034OperationName(expression.callee)) {
        fail("MISSING_CAPABILITY_AUTHORITY", `Operation '${expression.callee}' requires explicit compiler authority.`, expression.location)
      }
      return
    }
    if (!normalize) {
      fail("UNDECLARED_EFFECT", `Caller-authored ordinary call '${expression.callee}' cannot forge a capability operation.`, expression.location)
    }
    const {capability, operation} = match
    const flow = operation.resourceFlow

    if ((flow.kind == "borrow" || flow.kind == "close") && expression.arguments[flow.parameterIndex]) {
      const argument = expression.arguments[flow.parameterIndex]
      if (argument.kind != "IdentifierExpression" && argument.kind != "PrivateFieldRead" && argument.kind != "ReceiverExpression") {
        fail("INVALID_RESOURCE_BORROW", "An owned borrow must name one immediate resource place.", argument.location)
      }
      expression.arguments[flow.parameterIndex] = {
        expression: argument,
        kind: "OwnedBorrowExpression",
        location: argument.location,
        mode: flow.kind == "close" ? "exclusive" : "shared",
        sourceProvenance: argument.sourceProvenance,
        type: /** @type {import("./types.js").OwnedResourceType | import("./types.js").OwnedReferenceType} */ (
          operation.parameters[flow.parameterIndex].type
        )
      }
    }
    const replacement = /** @type {import("./types.js").EffectCallExpression} */ (/** @type {unknown} */ (expression))
    delete /** @type {{callee?: string}} */ (replacement).callee
    replacement.kind = "EffectCallExpression"
    replacement.operation = operation.id
    replacement.resolution = signature(capability, operation)
  })

  const complete = completeEffectSummaries(module, failureIds)
  const summaries = complete.functions
  const methodSummaries = complete.methods
  let site = 0

  forEachExpression(module, (expression) => {
    if (expression.kind == "EffectCallExpression") {
      if (normalize) expression.effectSiteId = `effect:${site}`
      else validateSite(expression, site, fail)
      site += 1
      return
    }
    if (expression.kind == "CallExpression") {
      const summary = summaries.get(expression.callee)
      if (!summary?.host) {
        if (normalize) {
          delete expression.effectSiteId
          delete expression.effects
          delete expression.failureIds
        }
        if (!normalize && Array.isArray(expression.failureIds) && expression.failureIds.length > 0) {
          fail("UNDECLARED_FAILURE", "UNDECLARED_FAILURE: Pure call carries a forged typed failure boundary.", expression.location)
        }
        if (!normalize && (expression.effectSiteId !== undefined || expression.effects !== undefined || expression.failureIds !== undefined)) {
          fail("UNDECLARED_EFFECT", "Pure call carries forged effect metadata.", expression.location)
        }
        return
      }
      if (normalize) {
        expression.effectSiteId = `effect:${site}`
        expression.effects = ["host"]
        expression.failureIds = [...summary.failureIds]
      } else {
        validateSite(expression, site, fail)
        if (!Array.isArray(expression.failureIds) || expression.failureIds.join(",") != [...summary.failureIds].join(",")) {
          fail("UNDECLARED_FAILURE", "UNDECLARED_FAILURE: Call failure boundary does not match its resolved function.", expression.location)
        }
        if (expression.effects?.length != 1 || expression.effects[0] != "host") {
          fail("UNDECLARED_EFFECT", "Call effect summary does not match its resolved function.", expression.location)
        }
      }
      site += 1
      return
    }
    if (expression.kind == "MethodCallExpression") {
      const summary = methodSummaries.get(expression.method)
      if (!summary?.host) {
        if (normalize) {
          delete expression.effectSiteId
          delete expression.effects
          delete expression.failureIds
        }
        if (!normalize && Array.isArray(expression.failureIds) && expression.failureIds.length > 0) {
          fail("UNDECLARED_FAILURE", "UNDECLARED_FAILURE: Pure method call carries a forged typed failure boundary.", expression.location)
        }
        if (!normalize && (expression.effectSiteId !== undefined || expression.effects !== undefined || expression.failureIds !== undefined)) {
          fail("UNDECLARED_EFFECT", "Pure method call carries forged effect metadata.", expression.location)
        }
        return
      }
      if (normalize) {
        expression.effectSiteId = `effect:${site}`
        expression.effects = ["host"]
        expression.failureIds = [...summary.failureIds]
      } else {
        validateSite(expression, site, fail)
        if (!Array.isArray(expression.failureIds) || expression.failureIds.join(",") != [...summary.failureIds].join(",")) {
          fail("UNDECLARED_FAILURE", "UNDECLARED_FAILURE: Method failure boundary does not match its resolved declaration.", expression.location)
        }
        if (expression.effects?.length != 1 || expression.effects[0] != "host") {
          fail("UNDECLARED_EFFECT", "Method effect summary does not match its resolved declaration.", expression.location)
        }
      }
      site += 1
    }
  }, true)
}

/**
 * Computes the joint finite fixed point across functions and resolved receiver methods.
 * @param {import("./types.js").SemanticModule} module - Resolved module.
 * @param {Set<string>} capabilityFailureIds - Declared capability failures.
 * @returns {{functions: Map<string, EffectSummary>, methods: Map<string, EffectSummary>}} Complete summaries.
 */
function completeEffectSummaries(module, capabilityFailureIds) {
  let functions = effectSummaries(module.functions, new Map(), capabilityFailureIds)
  let methods = directMethodSummaries(module, functions, new Map(), capabilityFailureIds)

  while (true) {
    const nextFunctions = effectSummaries(module.functions, methods, capabilityFailureIds)
    const nextMethods = directMethodSummaries(module, nextFunctions, methods, capabilityFailureIds)

    if (sameSummaries(functions, nextFunctions) && sameSummaries(methods, nextMethods)) {
      return {functions: nextFunctions, methods: nextMethods}
    }
    functions = nextFunctions
    methods = nextMethods
  }
}

/**
 * Compares stable host/failure summary maps.
 * @param {Map<string, EffectSummary>} left - Previous summaries.
 * @param {Map<string, EffectSummary>} right - Next summaries.
 * @returns {boolean} Whether the summaries are identical.
 */
function sameSummaries(left, right) {
  if (left.size != right.size) return false
  for (const [name, summary] of left) {
    const candidate = right.get(name)

    if (!candidate || summary.host != candidate.host || summary.failureIds.size != candidate.failureIds.size ||
      [...summary.failureIds].some((id) => !candidate.failureIds.has(id))) return false
  }
  return true
}

/**
 * Builds the complete immutable resolution recorded at an effect call site.
 * @param {import("./types.js").EffectCapabilityDeclaration} capability - Declaring capability.
 * @param {import("./types.js").EffectOperationDeclaration} operation - Resolved operation.
 * @returns {import("./types.js").ResolvedEffectOperationSignature} Complete resolution.
 */
function signature(capability, operation) {
  return {
    capabilityId: capability.id,
    effects: /** @type {const} */ (["host"]),
    failureIds: [...operation.failureIds],
    kind: /** @type {const} */ ("ResolvedEffectOperationSignature"),
    operationId: operation.id,
    parameterTypes: operation.parameters.map(({type}) => /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type))),
    resourceFlow: structuredClone(operation.resourceFlow),
    returnType: typeIdentity(operation.returnType)
  }
}

/**
 * Removes locations and provenance from one resolved type.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {import("./types.js").FunctionReturnTypeIdentity} Stable type identity.
 */
function typeIdentity(type) {
  if (type.kind == "TypeReference") return type.name
  if (type.kind == "OwnedResourceType") return {kind: type.kind, resourceId: type.resourceId}
  if (type.kind == "OwnedReferenceType") return {declarationId: type.declarationId, kind: type.kind}
  if (type.kind == "OptionalType") return {kind: type.kind,
    valueType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.valueType))}
  if (type.kind == "ListType") return {
    elementType: /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.elementType)), kind: type.kind}
  if (type.kind == "MapType" || type.kind == "OrderedMapType") {
    const keyType = /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.keyType))
    const valueType = /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(type.valueType))

    return type.kind == "OrderedMapType" ? {keyType, kind: type.kind, order: "insertion", valueType} :
      {keyType, kind: type.kind, valueType}
  }
  if (type.kind == "RecordType") return {arguments: type.arguments?.map((argument) =>
    /** @type {import("./types.js").SemanticTypeIdentity} */ (typeIdentity(argument))), declarationId: type.declarationId, kind: type.kind}
  if (type.kind == "ReferenceType") return {declarationId: type.declarationId, kind: type.kind}
  return {kind: type.kind, parameterId: type.parameterId}
}

/**
 * Computes the fixed-point host-effect summary for ordinary functions.
 * @param {import("./types.js").FunctionDeclaration[]} functions - Module functions.
 * @param {Map<string, EffectSummary>} [methodSummaries] - Receiver-call summaries from the current fixed-point round.
 * @param {Set<string>} [capabilityFailureIds] - Capability failures eligible for call-site propagation.
 * @returns {Map<string, EffectSummary>} Summaries by source function name.
 */
function effectSummaries(functions, methodSummaries = new Map(), capabilityFailureIds = new Set()) {
  const summaries = new Map(functions.map(({name}) => /** @type {[string, EffectSummary]} */ (
    [name, {failureIds: new Set(), host: false}]
  )))
  let changed = true

  while (changed) {
    changed = false
    for (const declaration of functions) {
      const summary = summaries.get(declaration.name)
      if (!summary) continue
      forEachBlockExpression(declaration.body, (expression) => {
        if (expression.kind == "EffectCallExpression") {
          if (!summary.host) { summary.host = true; changed = true }
        } else if (expression.kind == "CallExpression") {
          const called = summaries.get(expression.callee)
          if (called?.host && !summary.host) { summary.host = true; changed = true }
        } else if (expression.kind == "MethodCallExpression") {
          const called = methodSummaries.get(expression.method)
          if (called?.host && !summary.host) { summary.host = true; changed = true }
        }
      }, false)
      const escaping = escapingBlockFailures(declaration.body, summaries, methodSummaries, capabilityFailureIds)

      for (const id of escaping) if (!summary.failureIds.has(id)) { summary.failureIds.add(id); changed = true }
    }
  }
  return summaries
}

/**
 * Computes the capability failures escaping one structured block.
 * @param {import("./types.js").Block} block - Function body.
 * @param {Map<string, EffectSummary>} functionSummaries - Current function fixed point.
 * @param {Map<string, EffectSummary>} methodSummaries - Resolved method summaries.
 * @param {Set<string>} capabilityFailureIds - Declared capability failures.
 * @returns {Set<string>} Escaping failure identities.
 */
function escapingBlockFailures(block, functionSummaries, methodSummaries, capabilityFailureIds) {
  const result = new Set()

  for (const statement of block.statements) {
    if (statement.kind == "TryStatement") {
      const body = escapingBlockFailures(statement.body, functionSummaries, methodSummaries, capabilityFailureIds)

      if (body.delete(statement.catchType.declarationId)) {
        addFailures(result, escapingBlockFailures(statement.catchBody, functionSummaries, methodSummaries, capabilityFailureIds))
      }
      addFailures(result, body)
      continue
    }
    for (const expression of statementExpressions(statement)) {
      addExpressionFailures(result, expression, functionSummaries, methodSummaries)
    }
    if (statement.kind == "RaiseStatement" && capabilityFailureIds.has(statement.error.error.declarationId)) {
      result.add(statement.error.error.declarationId)
    }
    for (const child of statementBlocks(statement)) {
      addFailures(result, escapingBlockFailures(child, functionSummaries, methodSummaries, capabilityFailureIds))
    }
  }
  return result
}

/**
 * Adds failures evaluated by one expression subtree.
 * @param {Set<string>} target - Destination identities.
 * @param {import("./types.js").Expression} expression - Expression root.
 * @param {Map<string, EffectSummary>} functionSummaries - Function summaries.
 * @param {Map<string, EffectSummary>} methodSummaries - Method summaries.
 * @returns {void}
 */
function addExpressionFailures(target, expression, functionSummaries, methodSummaries) {
  if (expression.kind == "EffectCallExpression") addFailures(target, expression.resolution.failureIds)
  else if (expression.kind == "CallExpression") addFailures(target, functionSummaries.get(expression.callee)?.failureIds ?? [])
  else if (expression.kind == "MethodCallExpression") addFailures(target, methodSummaries.get(expression.method)?.failureIds ?? [])
  for (const child of expressionChildren(expression)) addExpressionFailures(target, child, functionSummaries, methodSummaries)
}

/**
 * Returns directly evaluated expressions for one statement.
 * @param {import("./types.js").Statement} statement - Statement.
 * @returns {import("./types.js").Expression[]} Expression roots.
 */
function statementExpressions(statement) {
  if (statement.kind == "LocalDeclaration") return [statement.initializer]
  if (statement.kind == "AssignmentStatement" || statement.kind == "PrivateFieldWriteStatement" ||
    statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") return [statement.expression]
  if (statement.kind == "ReturnStatement") return statement.expression ? [statement.expression] : []
  if (statement.kind == "RaiseStatement") return [statement.error.message]
  if (statement.kind == "IfStatement" || statement.kind == "WhileStatement") return [statement.condition]
  if (statement.kind == "ForEachStatement") return [statement.list]
  if (statement.kind == "ForEachMapStatement") return [statement.map]
  return []
}

/**
 * Returns nested blocks whose failures propagate through one statement.
 * @param {import("./types.js").Statement} statement - Statement.
 * @returns {import("./types.js").Block[]} Child blocks.
 */
function statementBlocks(statement) {
  if (statement.kind == "IfStatement") return [statement.consequent, ...(statement.alternate ? [statement.alternate] : [])]
  if (statement.kind == "WhileStatement" || statement.kind == "ForEachStatement" || statement.kind == "ForEachMapStatement") {
    return [statement.body]
  }
  return []
}

/**
 * Adds an iterable of failure identities to a set.
 * @param {Set<string>} target - Destination.
 * @param {Iterable<string>} source - Source identities.
 * @returns {void}
 */
function addFailures(target, source) {
  for (const id of source) target.add(id)
}

/**
 * Computes bounded direct summaries for class methods.
 * @param {import("./types.js").SemanticModule} module - Resolved module.
 * @param {Map<string, EffectSummary>} functionSummaries - Ordinary function summaries.
 * @param {Map<string, EffectSummary>} priorMethodSummaries - Receiver summaries from the previous fixed-point round.
 * @param {Set<string>} capabilityFailureIds - Declared capability failures.
 * @returns {Map<string, EffectSummary>} Summaries by resolved method identity.
 */
function directMethodSummaries(module, functionSummaries, priorMethodSummaries, capabilityFailureIds) {
  /** @type {Map<string, EffectSummary>} */
  const summaries = new Map()

  for (const declaration of module.classes ?? []) {
    for (const method of declaration.methods) {
      /** @type {EffectSummary} */
      const summary = {failureIds: escapingBlockFailures(method.body, functionSummaries, priorMethodSummaries, capabilityFailureIds), host: false}

      forEachBlockExpression(method.body, (expression) => {
        if (expression.kind == "EffectCallExpression") {
          summary.host = true
          const flow = expression.resolution.resourceFlow
          const argument = flow.kind == "borrow" || flow.kind == "close" ? expression.arguments[flow.parameterIndex] : undefined
          const borrowedParameterName = argument?.kind == "OwnedBorrowExpression" && argument.expression.kind == "IdentifierExpression"
            ? argument.expression.name : undefined
          const knownOpenBorrow = declaration.ownership?.kind == "ownedResource" && argument?.kind == "OwnedBorrowExpression" && (
            argument.expression.kind == "PrivateFieldRead" && argument.expression.field == declaration.ownership.fieldId ||
            borrowedParameterName !== undefined && method.parameters.some((parameter) =>
              parameter.name == borrowedParameterName &&
              (parameter.type.kind == "OwnedResourceType" || parameter.type.kind == "OwnedReferenceType"))
          )
          const terminalFailureId = knownOpenBorrow
            ? flow.kind == "borrow" || flow.kind == "close" ? flow.terminalFailureId : undefined
            : undefined

          if (terminalFailureId) summary.failureIds.delete(terminalFailureId)
        } else if (expression.kind == "CallExpression") {
          const called = functionSummaries.get(expression.callee)
          if (called?.host) summary.host = true
        } else if (expression.kind == "MethodCallExpression") {
          const called = priorMethodSummaries.get(expression.method)
          if (called?.host) summary.host = true
        }
      }, false)
      summaries.set(/** @type {string} */ (method.id), summary)
    }
  }
  return summaries
}

/**
 * Validates one deterministic effect-site identity.
 * @param {import("./types.js").CallExpression | import("./types.js").EffectCallExpression | import("./types.js").MethodCallExpression} expression - Effectful call.
 * @param {number} site - Expected traversal index.
 * @param {(code: string, detail: string, location: import("./types.js").SourceLocation) => never} fail - Located failure.
 * @returns {void}
 */
function validateSite(expression, site, fail) {
  if (expression.effectSiteId != `effect:${site}`) {
    fail("INVALID_EFFECT_ORDER", `Effect site '${String(expression.effectSiteId)}' is not expected site 'effect:${site}'.`, expression.location)
  }
}

/**
 * Visits every expression in deterministic declaration and evaluation order.
 * @param {import("./types.js").SemanticModule} module - Module to traverse.
 * @param {ExpressionVisitor} visitor - Expression visitor.
 * @param {boolean} [postorder] - Visit children before parents.
 * @returns {void}
 */
function forEachExpression(module, visitor, postorder = false) {
  for (const declaration of module.classes ?? []) {
    forEachBlockExpression(declaration.constructor.body, visitor, postorder)
    for (const method of declaration.methods) forEachBlockExpression(method.body, visitor, postorder)
  }
  for (const declaration of module.functions) forEachBlockExpression(declaration.body, visitor, postorder)
  forEachBlockExpression(module.entryPoint.body, visitor, postorder)
}

/**
 * Visits expressions in one structured block.
 * @param {import("./types.js").Block} block - Block to traverse.
 * @param {ExpressionVisitor} visitor - Expression visitor.
 * @param {boolean} postorder - Visit children before parents.
 * @returns {void}
 */
function forEachBlockExpression(block, visitor, postorder) {
  for (const statement of block.statements) {
    if (statement.kind == "LocalDeclaration") visit(statement.initializer)
    else if (statement.kind == "AssignmentStatement" || statement.kind == "PrivateFieldWriteStatement") visit(statement.expression)
    else if (statement.kind == "ReturnStatement" && statement.expression) visit(statement.expression)
    else if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") visit(statement.expression)
    else if (statement.kind == "IfStatement") {
      visit(statement.condition); forEachBlockExpression(statement.consequent, visitor, postorder)
      if (statement.alternate) forEachBlockExpression(statement.alternate, visitor, postorder)
    } else if (statement.kind == "ForEachStatement") {
      visit(statement.list); forEachBlockExpression(statement.body, visitor, postorder)
    } else if (statement.kind == "ForEachMapStatement") {
      visit(statement.map); forEachBlockExpression(statement.body, visitor, postorder)
    } else if (statement.kind == "WhileStatement") {
      visit(statement.condition); forEachBlockExpression(statement.body, visitor, postorder)
    } else if (statement.kind == "RaiseStatement") visit(statement.error.message)
    else if (statement.kind == "TryStatement") {
      forEachBlockExpression(statement.body, visitor, postorder); forEachBlockExpression(statement.catchBody, visitor, postorder)
    }
  }

  /**
   * Visits one expression subtree.
   * @param {import("./types.js").Expression} expression - Expression root.
   * @returns {void}
   */
  function visit(expression) {
    if (!postorder) visitor(expression)
    for (const child of expressionChildren(expression)) visit(child)
    if (postorder) visitor(expression)
  }
}

/**
 * Returns semantic child expressions in evaluation order.
 * @param {import("./types.js").Expression} expression - Parent expression.
 * @returns {import("./types.js").Expression[]} Children.
 */
function expressionChildren(expression) {
  if (expression.kind == "CallExpression" || expression.kind == "EffectCallExpression" || expression.kind == "ReferenceConstruction" ||
    expression.kind == "RecordConstruction") return expression.arguments
  if (expression.kind == "MethodCallExpression") return [expression.receiver, ...expression.arguments]
  if (expression.kind == "OwnedBorrowExpression" || expression.kind == "OwnedMoveExpression") return [expression.expression]
  if (expression.kind == "BinaryExpression") return [expression.left, expression.right]
  if (expression.kind == "UnaryExpression") return [expression.operand]
  if (expression.kind == "OptionalSome") return [expression.value]
  if (expression.kind == "OptionalIsPresent" || expression.kind == "OptionalUnwrap") return [expression.operand]
  if (expression.kind == "ListLiteral") return expression.elements
  if (expression.kind == "MapLiteral" || expression.kind == "OrderedMapLiteral") return expression.entries.map(({value}) => value)
  if (expression.kind == "ListIndexExpression") return [expression.collection, expression.index]
  if (expression.kind == "MapLookupExpression") return [expression.collection, expression.key]
  if (expression.kind == "CollectionSizeExpression") return [expression.collection]
  if (expression.kind == "MemberRead") return [expression.receiver]
  if (expression.kind == "PrivateFieldRead") return [expression.receiver]
  if (expression.kind == "ErrorMessageRead") return [expression.receiver]
  return []
}
