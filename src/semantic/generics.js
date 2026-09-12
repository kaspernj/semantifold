// @ts-check

/**
 * Builds an ordered substitution map for a closed generic record application.
 * @param {import("./types.js").RecordType} type - Closed record application.
 * @param {import("./types.js").RecordDeclaration} declaration - Resolved declaration.
 * @returns {Map<string, import("./types.js").SemanticValueType>} Substitutions.
 */
export function recordTypeSubstitutions(type, declaration) {
  return new Map((declaration.typeParameters ?? []).map((parameter, index) => [
    /** @type {string} */ (parameter.id),
    /** @type {import("./types.js").SemanticValueType} */ (type.arguments?.[index])
  ]))
}

/**
 * Applies complete recursive substitution without mutating declaration-owned types.
 * @param {import("./types.js").SemanticValueType} type - Open semantic type.
 * @param {Map<string, import("./types.js").SemanticValueType>} substitutions - Closed substitutions.
 * @returns {import("./types.js").SemanticValueType} Substituted type.
 */
export function substituteValueType(type, substitutions) {
  if (type.kind == "TypeVariableReference") return substitutions.get(type.parameterId) ?? type
  if (type.kind == "ListType") return {...type, elementType: substituteValueType(type.elementType, substitutions)}
  if (type.kind == "MapType" || type.kind == "OrderedMapType") return {
    ...type,
    keyType: /** @type {import("./types.js").TypeReference} */ (substituteValueType(type.keyType, substitutions)),
    valueType: substituteValueType(type.valueType, substitutions)
  }
  if (type.kind == "OptionalType") return {...type, valueType: substituteValueType(type.valueType, substitutions)}
  if (type.kind == "RecordType" && type.arguments) {
    return {...type, arguments: type.arguments.map((argument) => substituteValueType(argument, substitutions))}
  }

  return type
}

/**
 * Checks whether a recursive type contains any declaration-scoped variable
 * outside an explicitly visible identity set.
 * @param {import("./types.js").SemanticValueType} type - Candidate open type.
 * @param {Set<string>} [visibleParameterIds] - Exact variable identities permitted by the caller's lexical scope.
 * @returns {boolean} Whether any non-visible type variable occurs.
 */
export function typeContainsAnyVariable(type, visibleParameterIds = new Set()) {
  if (type.kind == "TypeVariableReference") return !visibleParameterIds.has(type.parameterId)
  if (type.kind == "RecordType") {
    return type.arguments?.some((argument) => typeContainsAnyVariable(argument, visibleParameterIds)) ?? false
  }
  if (type.kind == "ListType") return typeContainsAnyVariable(type.elementType, visibleParameterIds)
  if (type.kind == "MapType" || type.kind == "OrderedMapType") {
    return typeContainsAnyVariable(type.keyType, visibleParameterIds) ||
      typeContainsAnyVariable(type.valueType, visibleParameterIds)
  }
  if (type.kind == "OptionalType") return typeContainsAnyVariable(type.valueType, visibleParameterIds)

  return false
}
