// @ts-check

import {SemantifoldDiagnostic} from "../diagnostic.js"

const authoritySchema = "SemantifoldCapabilityAuthority"
const authorityIdPattern = /^[a-z][a-z0-9.-]*$/u
const declarationNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u
const scalarNames = new Set(["boolean", "integer", "string"])
const createdAuthorities = new WeakSet()
const task034ProbeOperations = Object.freeze([
  Object.freeze({failures: Object.freeze(["capability:0/failure:0"]), flow: Object.freeze({kind: "none"}),
    name: "probeEffect", parameters: Object.freeze([["label", "string"], ["value", "integer"], ["fail", "boolean"]]),
    returnType: "integer"}),
  Object.freeze({failures: Object.freeze(["capability:0/failure:1"]),
    flow: Object.freeze({kind: "acquire", resourceId: "capability:0/resource:0"}), name: "probeAcquire",
    parameters: Object.freeze([["fail", "boolean"]]), returnType: "resource"}),
  Object.freeze({failures: Object.freeze(["capability:0/failure:2", "capability:0/failure:4"]),
    flow: Object.freeze({kind: "borrow", parameterIndex: 0, terminalFailureId: "capability:0/failure:4"}), name: "probeRead",
    parameters: Object.freeze([["resource", "resource"], ["fail", "boolean"]]), returnType: "optional:string"}),
  Object.freeze({failures: Object.freeze(["capability:0/failure:3", "capability:0/failure:4"]),
    flow: Object.freeze({kind: "close", parameterIndex: 0, terminalFailureId: "capability:0/failure:4"}), name: "probeClose",
    parameters: Object.freeze([["resource", "resource"], ["fail", "boolean"]]), returnType: "void"}),
  Object.freeze({failures: Object.freeze([]), flow: Object.freeze({kind: "none"}), name: "probeTrace",
    parameters: Object.freeze([]), returnType: "string"})
])

/**
 * Creates an immutable, detached compiler-authority descriptor.
 * @param {unknown} input - Untrusted authority input.
 * @returns {Readonly<import("./types.js").CapabilityAuthority>} Normalized authority.
 */
export function createCapabilityAuthority(input) {
  try {
    if (createdAuthorities.has(/** @type {object} */ (input))) return /** @type {Readonly<import("./types.js").CapabilityAuthority>} */ (input)
    requirePlain(input, "authority")
    const authorityInput = /** @type {import("./types.js").CapabilityAuthorityInput} */ (input)

    requireKeys(authorityInput, ["capabilities", "id", "schema", "schemaVersion"], "authority")
    if (authorityInput.schema != authoritySchema || authorityInput.schemaVersion != 1 || typeof authorityInput.id != "string" ||
      !authorityIdPattern.test(authorityInput.id) || !dense(authorityInput.capabilities)) invalid("Authority schema, version, identity, or capability list is invalid.")

    const capabilityNames = new Set()
    const authorityResourceNames = new Set()
    const authorityFailureNames = new Set()
    const authorityOperationNames = new Set()
    const capabilities = authorityInput.capabilities.map((candidate, capabilityIndex) => {
      requirePlain(candidate, `capability ${capabilityIndex}`)
      requireKeys(candidate, ["failures", "name", "operations", "resources"], `capability ${capabilityIndex}`)
      requireName(candidate.name, capabilityNames, "capability")
      if (!dense(candidate.resources) || !dense(candidate.failures) || !dense(candidate.operations)) {
        invalid(`Capability '${candidate.name}' requires ordered resource, failure, and operation arrays.`)
      }
      const capabilityId = `capability:${capabilityIndex}`
      const resourceNames = new Map()
      const resources = candidate.resources.map((resource, resourceIndex) => {
        requireNamed(resource, resourceNames, "resource")
        requireName(resource.name, authorityResourceNames, "authority resource")
        const id = `${capabilityId}/resource:${resourceIndex}`
        resourceNames.set(resource.name, id)
        return {id, kind: /** @type {const} */ ("EffectResourceDeclaration"), name: resource.name}
      })
      const failureNames = new Map()
      const failures = candidate.failures.map((failure, failureIndex) => {
        requireNamed(failure, failureNames, "failure")
        requireName(failure.name, authorityFailureNames, "authority failure")
        const id = `${capabilityId}/failure:${failureIndex}`
        failureNames.set(failure.name, id)
        return {id, kind: /** @type {const} */ ("EffectFailureDeclaration"), name: failure.name}
      })
      const operationNames = new Set()
      const operations = candidate.operations.map((operation, operationIndex) => {
        requirePlain(operation, `operation ${operationIndex}`)
        requireKeys(operation, ["effects", "failures", "name", "parameters", "resourceFlow", "returnType"], `operation ${operationIndex}`)
        requireName(operation.name, operationNames, "operation")
        requireName(operation.name, authorityOperationNames, "authority operation")
        if (!dense(operation.parameters) || !dense(operation.failures) || !dense(operation.effects) ||
          operation.effects.length != 1 || operation.effects[0] != "host") invalid(`Operation '${operation.name}' has an invalid effect declaration.`)
        const parameterNames = new Set()
        const parameters = operation.parameters.map((parameter, parameterIndex) => {
          requirePlain(parameter, `parameter ${parameterIndex}`)
          requireKeys(parameter, ["name", "type"], `parameter ${parameterIndex}`)
          requireName(parameter.name, parameterNames, "parameter")
          return {name: parameter.name, type: normalizeValueType(parameter.type, resourceNames)}
        })
        const returnType = operation.returnType == "void" ? {kind: /** @type {const} */ ("TypeReference"), name: /** @type {const} */ ("void")} :
          normalizeValueType(operation.returnType, resourceNames)
        const failureIds = operation.failures.map((name) => {
          if (typeof name != "string" || !failureNames.has(name)) invalid(`Operation '${operation.name}' names an undeclared failure '${String(name)}'.`)
          return /** @type {string} */ (failureNames.get(name))
        })
        if (new Set(failureIds).size != failureIds.length) invalid(`Operation '${operation.name}' repeats a declared failure.`)
        const resourceFlow = normalizeResourceFlow(operation.resourceFlow, resources, resourceNames, failureNames, parameters)

        validateResourceOperation(operation.name, parameters, returnType, failureIds, resourceFlow)

        return {
          effects: /** @type {const} */ (["host"]),
          failureIds,
          id: `${capabilityId}/operation:${operationIndex}`,
          kind: /** @type {const} */ ("EffectOperationDeclaration"),
          name: operation.name,
          parameters,
          resourceFlow,
          returnType
        }
      })

      return {
        authorityId: authorityInput.id,
        failures,
        id: capabilityId,
        kind: /** @type {const} */ ("EffectCapabilityDeclaration"),
        name: candidate.name,
        operations,
        resources
      }
    })
    const result = /** @type {import("./types.js").CapabilityAuthority} */ ({
      capabilities,
      id: authorityInput.id,
      schema: authoritySchema,
      schemaVersion: 1
    })

    deepFreeze(result)
    createdAuthorities.add(result)
    return result
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    return invalid("Authority payload is malformed.")
  }
}

/**
 * Normalizes an optional parse authority.
 * @param {unknown} input - Optional caller input.
 * @returns {Readonly<import("./types.js").CapabilityAuthority> | undefined} Authority or legacy absence.
 */
export function normalizeCapabilityAuthority(input) {
  return input === undefined ? undefined : createCapabilityAuthority(input)
}

/**
 * Finds one source-visible operation only when an ordinary source declaration did not win resolution.
 * @param {readonly import("./types.js").EffectCapabilityDeclaration[]} capabilities - Authorized declarations.
 * @param {string} name - Source spelling.
 * @returns {{capability: import("./types.js").EffectCapabilityDeclaration, operation: import("./types.js").EffectOperationDeclaration} | undefined} Match.
 */
export function authorizedOperation(capabilities, name) {
  for (const capability of capabilities) {
    const operation = capability.operations.find((candidate) => candidate.name == name)
    if (operation) return {capability, operation}
  }
  return undefined
}

/**
 * Checks the bounded conformance operation namespace.
 * @param {string} name - Candidate source name.
 * @returns {boolean} Whether the name belongs to Task 034.
 */
export function isTask034OperationName(name) {
  return ["probeAcquire", "probeClose", "probeEffect", "probeRead", "probeTrace"].includes(name)
}

/**
 * Checks the exact built-in conformance capability identity.
 * @param {readonly import("./types.js").EffectCapabilityDeclaration[]} capabilities - Candidate graph.
 * @returns {boolean} Whether the graph has the supported identity and declaration order.
 */
export function isTask034ResourceProbe(capabilities) {
  if (!dense(capabilities) || capabilities.length != 1) return false
  const capability = capabilities[0]

  if (!plainWithKeys(capability, ["authorityId", "failures", "id", "kind", "name", "operations", "resources"]) ||
    capability.authorityId != "semantifold.task034.resource-probe" || capability.id != "capability:0" ||
    capability.kind != "EffectCapabilityDeclaration" || capability.name != "ResourceProbe" ||
    !dense(capability.resources) || !dense(capability.failures) || !dense(capability.operations) ||
    capability.resources.length != 1 || capability.failures.length != 5 || capability.operations.length != 5) return false
  if (!exactNamedDeclaration(capability.resources[0], "EffectResourceDeclaration", "capability:0/resource:0", "ProbeResource")) return false
  const expectedFailures = ["ProbeOperationFailure", "ProbeAcquireFailure", "ProbeReadFailure", "ProbeCloseFailure", "ProbeResourceClosed"]

  if (!capability.failures.every((failure, index) =>
    exactNamedDeclaration(failure, "EffectFailureDeclaration", `capability:0/failure:${index}`, expectedFailures[index]))) return false
  return capability.operations.every((operation, index) => exactProbeOperation(operation, index, task034ProbeOperations[index]))
}

/**
 * Checks one exact normalized declaration.
 * @param {unknown} candidate - Candidate declaration.
 * @param {string} kind - Expected kind.
 * @param {string} id - Expected identity.
 * @param {string} name - Expected source name.
 * @returns {boolean} Whether the declaration is exact.
 */
function exactNamedDeclaration(candidate, kind, id, name) {
  return plainWithKeys(candidate, ["id", "kind", "name"]) && candidate.kind == kind && candidate.id == id && candidate.name == name
}

/**
 * Checks one exact Task 034 conformance operation.
 * @param {unknown} candidate - Candidate operation.
 * @param {number} index - Expected operation index.
 * @param {(typeof task034ProbeOperations)[number]} expected - Exact contract.
 * @returns {boolean} Whether the operation matches the protected binding.
 */
function exactProbeOperation(candidate, index, expected) {
  if (!plainWithKeys(candidate, ["effects", "failureIds", "id", "kind", "name", "parameters", "resourceFlow", "returnType"]) ||
    candidate.kind != "EffectOperationDeclaration" || candidate.id != `capability:0/operation:${index}` ||
    candidate.name != expected.name || !sameStringArray(candidate.effects, ["host"]) ||
    !sameStringArray(candidate.failureIds, expected.failures) || !dense(candidate.parameters) ||
    candidate.parameters.length != expected.parameters.length || !exactFlatObject(candidate.resourceFlow, expected.flow) ||
    !exactProbeType(candidate.returnType, expected.returnType)) return false
  return candidate.parameters.every((parameter, parameterIndex) => plainWithKeys(parameter, ["name", "type"]) &&
    parameter.name == expected.parameters[parameterIndex][0] && exactProbeType(parameter.type, expected.parameters[parameterIndex][1]))
}

/**
 * Checks one exact normalized conformance type.
 * @param {unknown} candidate - Candidate type.
 * @param {string} expected - Compact expected type.
 * @returns {boolean} Whether the type is exact.
 */
function exactProbeType(candidate, expected) {
  if (expected == "resource") {
    return plainWithKeys(candidate, ["kind", "resourceId"]) && candidate.kind == "OwnedResourceType" &&
      candidate.resourceId == "capability:0/resource:0"
  }
  if (expected == "optional:string") {
    return plainWithKeys(candidate, ["kind", "valueType"]) && candidate.kind == "OptionalType" &&
      exactProbeType(candidate.valueType, "string")
  }
  return plainWithKeys(candidate, ["kind", "name"]) && candidate.kind == "TypeReference" && candidate.name == expected
}

/**
 * Checks an exact shallow object of primitive contract fields.
 * @param {unknown} candidate - Candidate object.
 * @param {Readonly<Record<string, unknown>>} expected - Expected fields.
 * @returns {boolean} Whether all fields and values match.
 */
function exactFlatObject(candidate, expected) {
  const keys = Object.keys(expected)
  return plainWithKeys(candidate, keys) && keys.every((key) => candidate[key] == expected[key])
}

/**
 * Checks an exact dense string sequence.
 * @param {unknown} candidate - Candidate sequence.
 * @param {readonly string[]} expected - Expected strings.
 * @returns {boolean} Whether order and values match.
 */
function sameStringArray(candidate, expected) {
  return dense(candidate) && candidate.length == expected.length && candidate.every((value, index) => value == expected[index])
}

/**
 * Checks an ordinary object's exact own-key set.
 * @param {unknown} candidate - Candidate object.
 * @param {string[]} keys - Exact keys.
 * @returns {candidate is Record<string, unknown>} Whether the object and fields are exact.
 */
function plainWithKeys(candidate, keys) {
  return candidate !== null && typeof candidate == "object" && !Array.isArray(candidate) &&
    Object.getPrototypeOf(candidate) == Object.prototype && Object.keys(candidate).sort().join(",") == [...keys].sort().join(",")
}

/**
 * Normalizes one closed operation value type.
 * @param {unknown} candidate - Raw value type.
 * @param {Map<string, string>} resourceNames - Resource identities by name.
 * @returns {import("./types.js").SemanticValueType} Normalized type.
 */
function normalizeValueType(candidate, resourceNames) {
  if (typeof candidate == "string" && scalarNames.has(candidate)) {
    return {kind: /** @type {const} */ ("TypeReference"), name: /** @type {import("./types.js").SemanticTypeName} */ (candidate)}
  }
  requirePlain(candidate, "operation type")
  if (candidate.kind == "OwnedResourceType") {
    requireKeys(candidate, ["kind", "resource"], "owned resource type")
    if (typeof candidate.resource != "string" || !resourceNames.has(candidate.resource)) invalid(`Unknown owned resource '${String(candidate.resource)}'.`)
    return {kind: /** @type {const} */ ("OwnedResourceType"), resourceId: /** @type {string} */ (resourceNames.get(candidate.resource))}
  }
  if (candidate.kind == "OptionalType") {
    requireKeys(candidate, ["kind", "valueType"], "optional type")
    if (typeof candidate.valueType != "string" || !scalarNames.has(candidate.valueType)) invalid("Capability optionals may contain only scalar values.")
    return {kind: /** @type {const} */ ("OptionalType"), valueType: {kind: /** @type {const} */ ("TypeReference"),
      name: /** @type {import("./types.js").SemanticTypeName} */ (candidate.valueType)}}
  }
  return invalid("Unsupported capability value type.")
}

/**
 * Normalizes one closed resource transition.
 * @param {unknown} candidate - Raw transition.
 * @param {import("./types.js").EffectResourceDeclaration[]} resources - Declared resources.
 * @param {Map<string, string>} resourceNames - Resource identities by name.
 * @param {Map<string, string>} failureNames - Failure identities by name.
 * @param {import("./types.js").EffectParameter[]} parameters - Normalized ordered parameters.
 * @returns {import("./types.js").EffectResourceFlow} Normalized flow.
 */
function normalizeResourceFlow(candidate, resources, resourceNames, failureNames, parameters) {
  requirePlain(candidate, "resource flow")
  if (candidate.kind == "none") {
    requireKeys(candidate, ["kind"], "resource flow")
    return {kind: /** @type {const} */ ("none")}
  }
  if (candidate.kind == "acquire") {
    requireKeys(candidate, ["kind", "resource"], "acquisition flow")
    if (typeof candidate.resource != "string" || !resourceNames.has(candidate.resource)) invalid("Acquisition names an undeclared resource.")
    const resourceId = resourceNames.get(candidate.resource)
    if (!resources.some(({id}) => id == resourceId)) invalid("Acquisition resource identity is invalid.")
    return {kind: /** @type {const} */ ("acquire"), resourceId: /** @type {string} */ (resourceId)}
  }
  if (candidate.kind == "borrow" || candidate.kind == "close") {
    requireKeys(candidate, ["kind", "parameterIndex", "terminalFailure"], `${candidate.kind} flow`)
    const parameterIndex = /** @type {number} */ (candidate.parameterIndex)
    if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0 || parameterIndex >= parameters.length ||
      parameters[parameterIndex].type.kind != "OwnedResourceType") invalid(`${candidate.kind} flow requires an owned resource parameter.`)
    if (typeof candidate.terminalFailure != "string" || !failureNames.has(candidate.terminalFailure)) {
      invalid(`${candidate.kind} flow requires a declared terminal failure.`)
    }
    return {kind: /** @type {"borrow" | "close"} */ (candidate.kind), parameterIndex,
      terminalFailureId: /** @type {string} */ (failureNames.get(candidate.terminalFailure))}
  }
  return invalid("Unknown resource-flow kind.")
}

/**
 * Requires every owned parameter/result to have one complete modeled transition.
 * @param {string} name - Operation name.
 * @param {import("./types.js").EffectParameter[]} parameters - Ordered parameters.
 * @param {import("./types.js").SemanticFunctionReturnType} returnType - Operation result.
 * @param {string[]} failureIds - Declared failure identities.
 * @param {import("./types.js").EffectResourceFlow} resourceFlow - Declared transition.
 * @returns {void}
 */
function validateResourceOperation(name, parameters, returnType, failureIds, resourceFlow) {
  const ownedParameters = parameters.flatMap((parameter, index) => parameter.type.kind == "OwnedResourceType" ? [index] : [])

  if (resourceFlow.kind == "none") {
    if (ownedParameters.length > 0 || returnType.kind == "OwnedResourceType") {
      invalid(`Operation '${name}' has an owned value without a resource transition.`)
    }
    return
  }
  if (resourceFlow.kind == "acquire") {
    if (ownedParameters.length > 0 || returnType.kind != "OwnedResourceType" || returnType.resourceId != resourceFlow.resourceId) {
      invalid(`Operation '${name}' acquisition result does not match its resource transition.`)
    }
    return
  }
  if (ownedParameters.length != 1 || ownedParameters[0] != resourceFlow.parameterIndex ||
    returnType.kind == "OwnedResourceType" || !failureIds.includes(resourceFlow.terminalFailureId)) {
    invalid(`Operation '${name}' borrow/close transition is incomplete.`)
  }
}

/**
 * Validates one single-field named declaration.
 * @param {unknown} candidate - Raw declaration.
 * @param {Map<string, string | undefined>} names - Already-declared names.
 * @param {string} subject - Diagnostic subject.
 * @returns {void}
 */
function requireNamed(candidate, names, subject) {
  requirePlain(candidate, subject)
  requireKeys(candidate, ["name"], subject)
  if (typeof candidate.name != "string" || !declarationNamePattern.test(candidate.name) || names.has(candidate.name)) {
    invalid(`Duplicate or invalid ${subject} name.`)
  }
  names.set(candidate.name, undefined)
}

/**
 * Validates and reserves one declaration name.
 * @param {unknown} name - Candidate name.
 * @param {Set<string>} names - Already-declared names.
 * @param {string} subject - Diagnostic subject.
 * @returns {void}
 */
function requireName(name, names, subject) {
  if (typeof name != "string" || !declarationNamePattern.test(name) || names.has(name)) invalid(`Duplicate or invalid ${subject} name.`)
  names.add(name)
}

/**
 * Requires an ordinary object.
 * @param {unknown} value - Candidate value.
 * @param {string} subject - Diagnostic subject.
 * @returns {asserts value is Record<string, unknown>} Asserts an ordinary object.
 */
function requirePlain(value, subject) {
  if (!value || typeof value != "object" || Array.isArray(value) || Object.getPrototypeOf(value) != Object.prototype) invalid(`Invalid ${subject} object.`)
}

/**
 * Requires one exact field set.
 * @param {Record<string, unknown>} value - Candidate object.
 * @param {string[]} keys - Required keys.
 * @param {string} subject - Diagnostic subject.
 * @returns {void}
 */
function requireKeys(value, keys, subject) {
  if (Object.keys(value).sort().join(",") != [...keys].sort().join(",")) invalid(`Invalid ${subject} fields.`)
}

/**
 * Checks an ordered dense array.
 * @param {unknown} value - Candidate array.
 * @returns {value is unknown[]} Whether the value is dense.
 */
function dense(value) {
  return Array.isArray(value) && value.every((_item, index) => Object.hasOwn(value, index))
}

/**
 * Recursively freezes a detached authority graph.
 * @template {object} Value
 * @param {Value} value - Object to freeze.
 * @returns {Readonly<Value>} Frozen object.
 */
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child == "object" && !Object.isFrozen(child)) deepFreeze(child)
  }
  return Object.freeze(value)
}

/**
 * Raises one stable authority diagnostic.
 * @param {string} message - Diagnostic message.
 * @returns {never} Always throws.
 */
function invalid(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_CAPABILITY_AUTHORITY", language: "capability", message})
}
