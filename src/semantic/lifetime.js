// @ts-check

/** @typedef {(code: string, detail: string, location: import("./types.js").SourceLocation) => never} LifetimeFail */
/** @typedef {{kind: "open", originId: string, origin: import("./types.js").SourceLocation} | {kind: "moved", originId: string, origin: import("./types.js").SourceLocation, destination: string} | {kind: "terminal", originId: string, origin: import("./types.js").SourceLocation, closeSiteId: string | import("./types.js").SourceLocation}} OwnerState */
/** @typedef {{kind: "normal" | "return" | "raise" | "break" | "continue", state: Map<string, OwnerState>, location?: import("./types.js").SourceLocation, errorId?: string}} LifetimeExit */

/**
 * Performs path-sensitive structured lifetime validation for Task 034 owned values.
 * @param {import("./types.js").SemanticModule} module - Fully type-resolved module.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {void}
 */
export function validateResourceLifetimes(module, fail) {
  if (!(module.capabilities ?? []).some(({resources}) => resources.length > 0) && !moduleContainsOwnedType(module)) return

  for (const declaration of module.classes ?? []) {
    analyzeOwner(declaration.constructor.parameters, declaration.constructor.body, fail)
    for (const method of declaration.methods) analyzeOwner(method.parameters, method.body, fail,
      declaration.ownership?.kind == "ownedResource" ? declaration.ownership.fieldId : undefined)
  }
  for (const declaration of module.functions) analyzeOwner(declaration.parameters, declaration.body, fail)
  analyzeOwner([], module.entryPoint.body, fail)
}

/**
 * Analyzes one function, constructor, method, or entry-point owner.
 * @param {import("./types.js").Parameter[]} parameters - Owned parameters.
 * @param {import("./types.js").Block} body - Structured body.
 * @param {LifetimeFail} fail - Located failure.
 * @param {string} [borrowedFieldId] - Owned receiver field, when present.
 * @returns {void}
 */
function analyzeOwner(parameters, body, fail, borrowedFieldId) {
  /** @type {Map<string, OwnerState>} */
  const initial = new Map()
  const obligations = new Set(parameters.filter(({type}) => isOwned(type)).map(({name}) => name))

  for (const parameter of parameters) {
    if (isOwned(parameter.type)) initial.set(parameter.name, openState(`parameter:${parameter.name}`, parameter.location))
  }
  if (borrowedFieldId) initial.set(`this.${borrowedFieldId}`, openState(`receiver:${borrowedFieldId}`, body.location))
  const exits = analyzeBlock(body, [{kind: "normal", state: initial}], fail)

  for (const exit of exits) checkLeaks(exit.state, obligations, exit.location ?? body.location, fail)
}

/**
 * Evaluates one lexical block while retaining every abrupt exit separately.
 * @param {import("./types.js").Block} block - Structured block.
 * @param {LifetimeExit[]} incoming - Incoming control-flow states.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {LifetimeExit[]} Reachable exits.
 */
function analyzeBlock(block, incoming, fail) {
  let active = incoming.filter(({kind}) => kind == "normal")
  const departed = incoming.filter(({kind}) => kind != "normal")
  /** @type {Set<string>} */
  const locals = new Set()

  for (const statement of block.statements) {
    if (active.length == 0) break
    const next = []

    for (const flow of active) next.push(...analyzeStatement(statement, flow.state, fail, locals))
    departed.push(...next.filter(({kind}) => kind != "normal"))
    active = mergeEquivalentNormals(next.filter(({kind}) => kind == "normal"), statement.location, fail)
  }
  const exits = [...departed, ...active.map((flow) => ({...flow, location: flow.location ?? block.location}))]

  for (const exit of exits) {
    checkLeaks(exit.state, locals, exit.location ?? block.location, fail)
    for (const name of locals) exit.state.delete(name)
  }
  return exits
}

/**
 * Evaluates one statement from one normal state.
 * @param {import("./types.js").Statement} statement - Statement.
 * @param {Map<string, OwnerState>} state - Incoming ownership state.
 * @param {LifetimeFail} fail - Located failure.
 * @param {Set<string>} locals - Locals introduced in the current block.
 * @returns {LifetimeExit[]} Reachable exits.
 */
function analyzeStatement(statement, state, fail, locals) {
  if (statement.kind == "LocalDeclaration") {
    const flows = evaluateExpression(statement.initializer, cloneState(state), fail)

    if (isOwned(statement.type)) {
      locals.add(statement.name)
      for (const flow of flows) {
        if (flow.kind != "normal") continue
        const origin = statement.initializer.kind == "OwnedMoveExpression"
          ? flow.state.get(statement.initializer.expression.name)?.origin ?? statement.initializer.location
          : statement.initializer.location
        flow.state.set(statement.name, openState(`local:${statement.name}`, origin))
      }
    }
    return flows.map((flow) => ({...flow, location: statement.location}))
  }
  if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") {
    return evaluateExpression(statement.expression, cloneState(state), fail).map((flow) => ({...flow, location: statement.location}))
  }
  if (statement.kind == "AssignmentStatement" || statement.kind == "PrivateFieldWriteStatement") {
    return evaluateExpression(statement.expression, cloneState(state), fail).map((flow) => ({...flow, location: statement.location}))
  }
  if (statement.kind == "ReturnStatement") {
    const flows = statement.expression ? evaluateExpression(statement.expression, cloneState(state), fail) :
      /** @type {LifetimeExit[]} */ ([{kind: "normal", state: cloneState(state)}])
    return flows.map((flow) => flow.kind == "normal"
      ? {kind: "return", location: statement.location, state: flow.state}
      : {...flow, location: statement.location})
  }
  if (statement.kind == "RaiseStatement") {
    const flows = evaluateExpression(statement.error.message, cloneState(state), fail)
    return flows.map((flow) => flow.kind == "normal"
      ? {errorId: statement.error.error.declarationId, kind: "raise", location: statement.location, state: flow.state}
      : {...flow, location: statement.location})
  }
  if (statement.kind == "IfStatement") {
    const conditions = evaluateExpression(statement.condition, cloneState(state), fail)
    /** @type {LifetimeExit[]} */
    const result = conditions.filter(({kind}) => kind != "normal")

    for (const condition of conditions.filter(({kind}) => kind == "normal")) {
      result.push(...analyzeBlock(statement.consequent, [{kind: "normal", state: cloneState(condition.state)}], fail))
      const alternate = statement.alternate
        ? analyzeBlock(statement.alternate, [{kind: "normal", state: cloneState(condition.state)}], fail)
        : /** @type {LifetimeExit[]} */ ([{kind: "normal", location: statement.location, state: cloneState(condition.state)}])

      result.push(...alternate)
    }
    return mergeEquivalentNormals(result, statement.location, fail)
  }
  if (statement.kind == "TryStatement") {
    const bodyExits = analyzeBlock(statement.body, [{kind: "normal", state: cloneState(state)}], fail)
    /** @type {LifetimeExit[]} */
    const result = bodyExits.filter((flow) => flow.kind != "raise" || flow.errorId != statement.catchType.declarationId)

    for (const caught of bodyExits.filter((flow) => flow.kind == "raise" && flow.errorId == statement.catchType.declarationId)) {
      result.push(...analyzeBlock(statement.catchBody, [{kind: "normal", state: cloneState(caught.state)}], fail))
    }
    return mergeEquivalentNormals(result, statement.location, fail)
  }
  if (statement.kind == "WhileStatement") {
    const conditions = evaluateExpression(statement.condition, cloneState(state), fail)
    /** @type {LifetimeExit[]} */
    const result = conditions.filter(({kind}) => kind != "normal")

    for (const condition of conditions.filter(({kind}) => kind == "normal")) {
      const bodyExits = analyzeBlock(statement.body, [{kind: "normal", state: cloneState(condition.state)}], fail)
      for (const exit of bodyExits) {
        if (exit.kind == "normal" || exit.kind == "continue") requireSameState(condition.state, exit.state, statement.location, fail)
        else if (exit.kind == "break") {
          requireSameState(condition.state, exit.state, statement.location, fail)
          result.push({kind: "normal", location: statement.location, state: exit.state})
        } else result.push(exit)
      }
      result.push({kind: "normal", location: statement.location, state: condition.state})
    }
    return mergeEquivalentNormals(result, statement.location, fail)
  }
  if (statement.kind == "ForEachStatement" || statement.kind == "ForEachMapStatement") {
    const operand = statement.kind == "ForEachStatement" ? statement.list : statement.map
    const operands = evaluateExpression(operand, cloneState(state), fail)
    /** @type {LifetimeExit[]} */
    const result = operands.filter(({kind}) => kind != "normal")

    for (const evaluated of operands.filter(({kind}) => kind == "normal")) {
      const bodyExits = analyzeBlock(statement.body, [{kind: "normal", state: cloneState(evaluated.state)}], fail)
      for (const exit of bodyExits) {
        if (exit.kind == "normal" || exit.kind == "continue") requireSameState(evaluated.state, exit.state, statement.location, fail)
        else if (exit.kind == "break") {
          requireSameState(evaluated.state, exit.state, statement.location, fail)
          result.push({kind: "normal", location: statement.location, state: exit.state})
        } else result.push(exit)
      }
      result.push({kind: "normal", location: statement.location, state: evaluated.state})
    }
    return mergeEquivalentNormals(result, statement.location, fail)
  }
  if (statement.kind == "BreakStatement") return [{kind: "break", location: statement.location, state: cloneState(state)}]
  if (statement.kind == "ContinueStatement") return [{kind: "continue", location: statement.location, state: cloneState(state)}]

  return []
}

/**
 * Evaluates one expression with failure states at exact evaluation boundaries.
 * @param {import("./types.js").Expression} expression - Expression.
 * @param {Map<string, OwnerState>} state - Incoming ownership state.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {LifetimeExit[]} Reachable exits.
 */
function evaluateExpression(expression, state, fail) {
  if (expression.kind == "OwnedMoveExpression") {
    const owner = requireOwner(expression.expression.name, state, expression.location, fail)

    if (owner.kind == "moved") fail("USE_AFTER_MOVE", `Resource '${expression.expression.name}' was already moved.`, expression.location)
    if (owner.kind == "terminal") fail("USE_AFTER_CLOSE", `Resource '${expression.expression.name}' is terminal after close.`, expression.location)
    state.set(expression.expression.name, {...owner, destination: "transfer", kind: "moved"})
    return [{kind: "normal", state}]
  }
  if (expression.kind == "OwnedBorrowExpression") {
    const name = placeName(expression.expression)
    const owner = requireOwner(name, state, expression.location, fail)

    if (owner.kind == "moved") fail("USE_AFTER_MOVE", `Resource '${name}' was moved before this borrow.`, expression.location)
    return [{kind: "normal", state}]
  }
  if (expression.kind == "EffectCallExpression") return evaluateEffectCall(expression, state, fail)
  if (expression.kind == "CallExpression" || expression.kind == "MethodCallExpression" || expression.kind == "ReferenceConstruction") {
    return evaluateOrdinaryCall(expression, state, fail)
  }

  /** @type {LifetimeExit[]} */
  let flows = [{kind: "normal", state}]
  for (const child of expressionChildren(expression)) flows = evaluateForFlows(child, flows, fail)
  return flows
}

/**
 * Applies one capability operation's declared ownership and failure flow.
 * @param {import("./types.js").EffectCallExpression} expression - Effect call.
 * @param {Map<string, OwnerState>} state - Incoming ownership state.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {LifetimeExit[]} Reachable exits.
 */
function evaluateEffectCall(expression, state, fail) {
  /** @type {LifetimeExit[]} */
  let flows = [{kind: "normal", state}]

  for (const argument of expression.arguments) flows = evaluateForFlows(argument, flows, fail)
  const result = flows.filter(({kind}) => kind != "normal")
  const resourceFlow = expression.resolution.resourceFlow

  for (const flow of flows.filter(({kind}) => kind == "normal")) {
    let operationState = cloneState(flow.state)
    let terminalFailure

    if (resourceFlow.kind == "borrow" || resourceFlow.kind == "close") {
      const argument = expression.arguments[resourceFlow.parameterIndex]
      if (argument.kind != "OwnedBorrowExpression") fail("INVALID_RESOURCE_BORROW", "Resource operation lacks an immediate borrow.", argument.location)
      const name = placeName(argument.expression)
      const owner = requireOwner(name, operationState, argument.location, fail)

      if (owner.kind == "moved") fail("USE_AFTER_MOVE", `Resource '${name}' was moved before this operation.`, argument.location)
      if (owner.kind == "terminal") terminalFailure = resourceFlow.terminalFailureId
      else if (resourceFlow.kind == "close") operationState.set(name, {...owner, closeSiteId: expression.effectSiteId, kind: "terminal"})
    }
    if (terminalFailure) {
      result.push({errorId: terminalFailure, kind: "raise", location: expression.location, state: operationState})
      continue
    }
    const failureIds = expression.resolution.failureIds.filter((id) =>
      resourceFlow.kind != "borrow" && resourceFlow.kind != "close" || id != resourceFlow.terminalFailureId)

    result.push({kind: "normal", state: cloneState(operationState)})
    for (const errorId of failureIds) {
      result.push({errorId, kind: "raise", location: expression.location, state: cloneState(operationState)})
    }
  }
  return result
}

/**
 * Applies call-entry ownership commit semantics after ordered argument evaluation.
 * @param {import("./types.js").CallExpression | import("./types.js").MethodCallExpression | import("./types.js").ReferenceConstruction} expression - Call.
 * @param {Map<string, OwnerState>} state - Incoming ownership state.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {LifetimeExit[]} Reachable exits.
 */
function evaluateOrdinaryCall(expression, state, fail) {
  const arguments_ = expression.kind == "MethodCallExpression" ? [expression.receiver, ...expression.arguments] : expression.arguments
  /** @type {LifetimeExit[]} */
  let flows = [{kind: "normal", state}]
  /** @type {string[]} */
  const reservedMoves = []

  for (const argument of arguments_) {
    if (argument.kind == "OwnedMoveExpression") {
      for (const flow of flows.filter(({kind}) => kind == "normal")) {
        const owner = requireOwner(argument.expression.name, flow.state, argument.location, fail)
        if (owner.kind == "moved") fail("USE_AFTER_MOVE", `Resource '${argument.expression.name}' was already moved.`, argument.location)
        if (owner.kind == "terminal") fail("USE_AFTER_CLOSE", `Resource '${argument.expression.name}' is terminal after close.`, argument.location)
      }
      if (reservedMoves.includes(argument.expression.name)) {
        fail("RESOURCE_ALIAS", `Resource '${argument.expression.name}' cannot be transferred to two parameters.`, argument.location)
      }
      reservedMoves.push(argument.expression.name)
    } else flows = evaluateForFlows(argument, flows, fail)
  }
  const result = flows.filter(({kind}) => kind != "normal")

  for (const flow of flows.filter(({kind}) => kind == "normal")) {
    const entered = cloneState(flow.state)
    for (const name of reservedMoves) {
      const owner = requireOwner(name, entered, expression.location, fail)
      if (owner.kind == "moved") fail("USE_AFTER_MOVE", `Resource '${name}' was already moved.`, expression.location)
      if (owner.kind == "terminal") fail("USE_AFTER_CLOSE", `Resource '${name}' is terminal after close.`, expression.location)
      entered.set(name, {...owner, destination: "callee", kind: "moved"})
    }
    if (expression.kind == "MethodCallExpression" && expression.resolution?.resourceFlow) {
      const receiver = expression.receiver.kind == "OwnedBorrowExpression" ? expression.receiver.expression : expression.receiver
      if (receiver.kind != "IdentifierExpression" && receiver.kind != "ReceiverExpression" && receiver.kind != "PrivateFieldRead") {
        fail("INVALID_RESOURCE_BORROW", "Owned method receiver must be an immediate borrowed place.", receiver.location)
      }
      const name = placeName(receiver)
      const owner = requireOwner(name, entered, expression.location, fail)

      if (owner.kind == "terminal") {
        if (expression.resolution.resourceFlow.terminalFailureId) {
          result.push({errorId: expression.resolution.resourceFlow.terminalFailureId, kind: "raise",
            location: expression.location, state: entered})
          continue
        }
        fail("USE_AFTER_CLOSE", `Resource '${name}' is terminal after close.`, expression.location)
      }
      if (expression.resolution.resourceFlow.kind == "terminal") {
        entered.set(name, {...owner, closeSiteId: expression.effectSiteId ?? expression.location, kind: "terminal"})
      }
    }
    result.push({kind: "normal", state: cloneState(entered)})
    for (const errorId of expression.failureIds ?? []) {
      result.push({errorId, kind: "raise", location: expression.location, state: cloneState(entered)})
    }
  }
  return result
}

/**
 * Evaluates a child expression only along normal incoming paths.
 * @param {import("./types.js").Expression} expression - Child expression.
 * @param {LifetimeExit[]} flows - Incoming paths.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {LifetimeExit[]} Reachable exits.
 */
function evaluateForFlows(expression, flows, fail) {
  const result = flows.filter(({kind}) => kind != "normal")
  for (const flow of flows.filter(({kind}) => kind == "normal")) result.push(...evaluateExpression(expression, cloneState(flow.state), fail))
  return result
}

/**
 * Returns non-call expression children in evaluation order.
 * @param {import("./types.js").Expression} expression - Parent expression.
 * @returns {import("./types.js").Expression[]} Children.
 */
function expressionChildren(expression) {
  if (expression.kind == "BinaryExpression") return [expression.left, expression.right]
  if (expression.kind == "UnaryExpression") return [expression.operand]
  if (expression.kind == "OptionalSome") return [expression.value]
  if (expression.kind == "OptionalIsPresent" || expression.kind == "OptionalUnwrap") return [expression.operand]
  if (expression.kind == "ListLiteral") return expression.elements
  if (expression.kind == "MapLiteral" || expression.kind == "OrderedMapLiteral") return expression.entries.map(({value}) => value)
  if (expression.kind == "ListIndexExpression") return [expression.collection, expression.index]
  if (expression.kind == "MapLookupExpression") return [expression.collection, expression.key]
  if (expression.kind == "CollectionSizeExpression") return [expression.collection]
  if (expression.kind == "RecordConstruction") return expression.arguments
  if (expression.kind == "MemberRead") return [expression.receiver]
  if (expression.kind == "PrivateFieldRead") return [expression.receiver]
  if (expression.kind == "ErrorMessageRead") return [expression.receiver]
  return []
}

/**
 * Merges normal paths only after proving identical ownership states.
 * @param {LifetimeExit[]} flows - Candidate paths.
 * @param {import("./types.js").SourceLocation} location - Join location.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {LifetimeExit[]} Merged paths.
 */
function mergeEquivalentNormals(flows, location, fail) {
  const normal = flows.filter(({kind}) => kind == "normal")
  if (normal.length > 1) {
    for (const candidate of normal.slice(1)) requireSameState(normal[0].state, candidate.state, location, fail)
  }
  return [...flows.filter(({kind}) => kind != "normal"), ...(normal.length > 0 ? [normal[0]] : [])]
}

/**
 * Requires a finite ownership invariant at a branch or loop join.
 * @param {Map<string, OwnerState>} left - First ownership state.
 * @param {Map<string, OwnerState>} right - Second ownership state.
 * @param {import("./types.js").SourceLocation} location - Join location.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {void}
 */
function requireSameState(left, right, location, fail) {
  const names = new Set([...left.keys(), ...right.keys()])
  for (const name of names) {
    const leftState = left.get(name)
    const rightState = right.get(name)
    if (leftState?.kind != rightState?.kind || leftState?.originId != rightState?.originId) {
      fail("RESOURCE_STATE_MISMATCH", `Resource '${name}' has different ownership state across reachable paths.`, location)
    }
  }
}

/**
 * Rejects every owned value that leaves its introducing scope open.
 * @param {Map<string, OwnerState>} state - Ownership state.
 * @param {Set<string>} names - Owners introduced in the scope.
 * @param {import("./types.js").SourceLocation} location - Exit location.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {void}
 */
function checkLeaks(state, names, location, fail) {
  for (const name of names) {
    const owner = state.get(name)
    if (owner?.kind == "open") {
      const origin = owner.origin
      fail("LEAKED_RESOURCE", `Owned resource '${name}' remains open; acquired at ${origin.filename}:${origin.start.line}:${origin.start.column}.`, location)
    }
  }
}

/**
 * Resolves an owned place in the current scope.
 * @param {string} name - Stable place name.
 * @param {Map<string, OwnerState>} state - Ownership state.
 * @param {import("./types.js").SourceLocation} location - Use location.
 * @param {LifetimeFail} fail - Located failure.
 * @returns {OwnerState} Owner state.
 */
function requireOwner(name, state, location, fail) {
  const owner = state.get(name)
  if (!owner) return fail("INVALID_RESOURCE_BORROW", `No owned resource place '${name}' is in scope.`, location)
  return owner
}

/**
 * Converts an immediate owned expression to a stable place name.
 * @param {import("./types.js").IdentifierExpression | import("./types.js").ReceiverExpression | import("./types.js").PrivateFieldRead} expression - Owned place.
 * @returns {string} Place identity.
 */
function placeName(expression) {
  if (expression.kind == "IdentifierExpression") return expression.name
  if (expression.kind == "ReceiverExpression") return "this"
  if (expression.kind == "PrivateFieldRead") return `this.${expression.field}`
  return "<invalid>"
}

/**
 * Creates one open ownership state.
 * @param {string} originId - Deterministic origin identity.
 * @param {import("./types.js").SourceLocation} origin - Acquisition location.
 * @returns {OwnerState} Open state.
 */
function openState(originId, origin) {
  return {kind: "open", origin, originId}
}

/**
 * Clones an ownership state for a control-flow fork.
 * @param {Map<string, OwnerState>} state - State to clone.
 * @returns {Map<string, OwnerState>} Detached state.
 */
function cloneState(state) {
  return new Map([...state].map(([name, value]) => [name, {...value}]))
}

/**
 * Checks whether a type carries linear ownership.
 * @param {import("./types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {boolean} Whether the type is owned.
 */
function isOwned(type) {
  return type.kind == "OwnedResourceType" || type.kind == "OwnedReferenceType"
}

/**
 * Checks whether any function signature contains an owned type.
 * @param {import("./types.js").SemanticModule} module - Semantic module.
 * @returns {boolean} Whether lifetime analysis is required.
 */
function moduleContainsOwnedType(module) {
  for (const declaration of module.functions) {
    if (declaration.parameters.some(({type}) => isOwned(type)) || isOwned(declaration.returnType)) return true
  }
  return false
}
