// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {isTask034ResourceProbe} from "../semantic/capabilities.js"

const adoptedTargets = new Set(["php", "ruby", "javascript", "typescript", "java"])
const protectedSupportNames = new Set([
  "ProbeOperationFailure", "ProbeAcquireFailure", "ProbeReadFailure", "ProbeCloseFailure", "ProbeResourceClosed", "ProbeResource",
  "probeEffect", "probeAcquire", "probeRead", "probeClose", "probeTrace"
])

/** @typedef {{expression: import("../semantic/types.js").Expression, path: string}} ExpressionPath */
/** @typedef {{detail: string, location: import("../semantic/types.js").SourceLocation}} ExcludedEffect */

/**
 * Validates Task 034 target support before a SourceWriter is allocated.
 * @param {import("../semantic/types.js").SemanticModule} module - Candidate module.
 * @param {import("../semantic/types.js").BackendLanguage} language - Requested target.
 * @returns {void}
 */
export function preflightEffectCapabilities(module, language) {
  const capabilities = module?.capabilities

  if (capabilities === undefined) {
    const unauthorized = findTask034Node(module)

    if (unauthorized) {
      unsupportedCapability(language, "MISSING_CAPABILITY_AUTHORITY: Task 034 IR requires its compiler authority graph",
        /** @type {import("../semantic/types.js").SourceLocation | undefined} */ (Reflect.get(unauthorized, "location") ?? module?.location))
    }
    return
  }
  if (!Array.isArray(capabilities) || capabilities.length == 0) {
    unsupportedCapability(language, "malformed or empty Task 034 capability graph", module?.location)
  }
  if (!adoptedTargets.has(language)) {
    unsupportedCapability(language, "Task 034 effectful capabilities and owned resources", module.location)
  }
  if (!isTask034ResourceProbe(capabilities)) {
    unsupportedCapability(language, "unbound Task 034 capability authority", module.location)
  }
  if (!Array.isArray(module.functions) || !module.entryPoint || typeof module.entryPoint != "object" ||
    !module.entryPoint.body || !Array.isArray(module.entryPoint.body.statements) ||
    [module.records, module.classes, module.errors].some((declarations) => declarations !== undefined && !Array.isArray(declarations))) {
    unsupportedCapability(language, "malformed Task 034 semantic module", module.location)
  }
  const collision = moduleNeedsEffectSupport(module) ? findSupportCollision(module, language) : undefined

  if (collision) unsupportedCapability(language, `protected Task 034 support name '${collision.name}'`, collision.location)
  const excluded = findExcludedEffectContext(module)
  if (excluded) unsupportedCapability(language, excluded.detail, excluded.location)
}

/**
 * Finds compiler-authorized Task 034 IR that has been detached from its authority graph.
 * @param {unknown} value - Candidate semantic graph.
 * @param {Set<object>} [seen] - Cycle protection.
 * @returns {object | undefined} First unauthorized Task 034 node.
 */
function findTask034Node(value, seen = new Set()) {
  if (!value || typeof value != "object" || seen.has(value)) return undefined
  seen.add(value)
  if (!Array.isArray(value)) {
    const kind = Reflect.get(value, "kind")

    if (["EffectCallExpression", "OwnedBorrowExpression", "OwnedMoveExpression", "OwnedReferenceType", "OwnedResourceType"].includes(String(kind)) ||
      kind == "ErrorType" && /^capability:[0-9]+\/failure:[0-9]+$/u.test(String(Reflect.get(value, "declarationId")))) return value
  }
  for (const [key, child] of Object.entries(value)) {
    if (["location", "sourceProvenance"].includes(key)) continue
    const found = findTask034Node(child, seen)
    if (found) return found
  }
  return undefined
}

/**
 * Finds one user declaration that would collide with fixed protected support.
 * @param {import("../semantic/types.js").SemanticModule} module - Validated semantic graph.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target language.
 * @returns {{name: string, location: import("../semantic/types.js").SourceLocation} | undefined} First collision.
 */
function findSupportCollision(module, language) {
  const reserved = new Set([...protectedSupportNames].map((name) => supportNameKey(name, language)))
  if (language == "javascript" || language == "typescript") {
    reserved.add("__semantifoldTask034Fs")
    reserved.add("__semantifoldTask034Trace")
  } else if (language == "php") reserved.add("__semantifold_task034_trace")
  const declarations = [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions]

  for (const declaration of declarations) {
    if (!declaration || typeof declaration != "object") continue
    if (reserved.has(supportNameKey(declaration.name, language))) return {location: declaration.location, name: declaration.name}
  }
  if (language == "javascript" || language == "typescript" || language == "php") {
    for (const statement of module.entryPoint.body.statements) {
      if (!statement || typeof statement != "object") continue
      if (statement.kind == "LocalDeclaration" && reserved.has(supportNameKey(statement.name, language))) {
        return {location: statement.location, name: statement.name}
      }
    }
  }
  return undefined
}

/**
 * Applies target namespace casing to a protected support name.
 * @param {string} name - Source name.
 * @param {import("../semantic/types.js").BackendLanguage} language - Target language.
 * @returns {string} Comparable name.
 */
function supportNameKey(name, language) {
  return language == "php" ? name.toLowerCase() : name
}

/**
 * Emits fixed target-private Task 034 conformance support.
 * @param {import("./writer.js").SourceWriter} writer - Destination writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Authorized module.
 * @param {"php" | "ruby" | "javascript" | "typescript" | "java"} language - Adopted target.
 * @param {"top" | "members"} [placement] - Java support placement.
 * @returns {void}
 */
export function emitEffectSupport(writer, module, language, placement = "top") {
  if (!module.capabilities || !moduleNeedsEffectSupport(module)) return
  const content = language == "php" ? phpSupport : language == "ruby" ? rubySupport : language == "javascript" ? javascriptSupport :
    language == "typescript" ? typescriptSupport : placement == "top" ? javaTopSupport : javaMemberSupport

  writer.synthetic(content, "semantifold-task034-support", [module])
}

/**
 * Recognizes only the byte-exact protected support emitted by this backend.
 * Frontends use this in addition to parser-shape checks during generated-source reparse.
 * @param {string} source - Complete candidate source.
 * @param {"php" | "ruby" | "javascript" | "typescript" | "java"} language - Adopted target.
 * @param {"top" | "members"} [placement] - Java support placement.
 * @returns {boolean} Whether the exact protected segment is present.
 */
export function hasExactEffectSupport(source, language, placement = "top") {
  const content = language == "php" ? phpSupport : language == "ruby" ? rubySupport : language == "javascript" ? javascriptSupport :
    language == "typescript" ? typescriptSupport : placement == "top" ? javaTopSupport : javaMemberSupport

  return source.includes(content)
}

/**
 * Materializes nested effect sites before their enclosing eager expression.
 * The installed replacements remain active until the next statement begins.
 * @param {import("./writer.js").SourceWriter} writer - Destination writer.
 * @param {import("../semantic/types.js").Statement} statement - Current statement.
 * @param {string} indent - Current target indentation.
 * @param {string} path - Exact statement path.
 * @param {"php" | "ruby" | "javascript" | "typescript" | "java"} language - Adopted target.
 * @param {(expression: import("../semantic/types.js").Expression, path: string) => void} emit - Target expression emitter.
 * @returns {void}
 */
export function emitEffectPrefixes(writer, statement, indent, path, language, emit) {
  /** @type {ExpressionPath[]} */
  const planned = []

  for (const root of statementExpressionRoots(statement, path)) collectNestedEffects(root.expression, root.path, root.expression, planned)
  writer.planEffectReplacements(planned.map(({expression}) => expression))
  for (const {expression, path: expressionPath} of planned) {
    const name = writer.effectTemporaryName(expression)
    const type = effectExpressionType(writer, expression)
    const typeName = emittedTypeName(writer, type, language)
    const declaration = language == "php"
      ? `/**\n${indent} * @var ${typeName} $${name}\n${indent} * @semantifold-immutable\n${indent} */\n${indent}$${name} = `
      : language == "ruby"
        ? `# @type [${typeName}]\n${indent}# @semantifold-immutable\n${indent}${name} = `
        : language == "javascript" ? `/** @type {${typeName}} */\n${indent}const ${name} = `
          : language == "typescript" ? `const ${name}: ${typeName} = ` : `final ${typeName} ${name} = `

    writer.synthetic(`${indent}${declaration}`, "exactly-once effect temporary", [expression], [expressionPath])
    writer.emitEffectDefinition(expression, () => emit(expression, expressionPath))
    writer.synthetic(language == "ruby" ? "\n" : ";\n", "exactly-once effect temporary terminator", [expression], [expressionPath])
  }
}

/**
 * Resolves the result type needed for an effect temporary.
 * @param {import("./writer.js").SourceWriter} writer - Active writer.
 * @param {import("../semantic/types.js").Expression} expression - Effectful expression.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType | undefined} Result type.
 */
function effectExpressionType(writer, expression) {
  if (expression.kind == "EffectCallExpression") return writer.effectOperationForId(expression.operation).returnType
  if (expression.kind == "MethodCallExpression" || expression.kind == "CallExpression") {
    return expression.resolution ? semanticTypeForIdentity(expression.resolution.returnType) : undefined
  }
  return undefined
}

/**
 * Rehydrates a resolved call result for target-local temporary spelling.
 * @param {import("../semantic/types.js").FunctionReturnTypeIdentity} identity - Exact resolved result identity.
 * @returns {import("../semantic/types.js").SemanticFunctionReturnType} Detached semantic type.
 */
function semanticTypeForIdentity(identity) {
  if (typeof identity == "string") {
    return {kind: "TypeReference", name: /** @type {import("../semantic/types.js").FunctionReturnTypeName} */ (identity)}
  }
  if (identity.kind == "ListType") return {elementType: semanticTypeForValueIdentity(identity.elementType), kind: "ListType"}
  if (identity.kind == "MapType") return {keyType: /** @type {import("../semantic/types.js").TypeReference} */ (
    semanticTypeForValueIdentity(identity.keyType)), kind: "MapType",
    valueType: semanticTypeForValueIdentity(identity.valueType)}
  if (identity.kind == "OrderedMapType") return {keyType: /** @type {import("../semantic/types.js").TypeReference} */ (
    semanticTypeForValueIdentity(identity.keyType)), kind: "OrderedMapType",
    order: "insertion", valueType: semanticTypeForValueIdentity(identity.valueType)}
  if (identity.kind == "OptionalType") return {kind: "OptionalType", valueType: semanticTypeForValueIdentity(identity.valueType)}
  if (identity.kind == "RecordType") return {arguments: identity.arguments?.map(semanticTypeForValueIdentity),
    declarationId: identity.declarationId, kind: "RecordType"}
  if (identity.kind == "ReferenceType") return {declarationId: identity.declarationId, kind: "ReferenceType"}
  if (identity.kind == "OwnedResourceType") return {kind: "OwnedResourceType", resourceId: identity.resourceId}
  if (identity.kind == "OwnedReferenceType") return {declarationId: identity.declarationId, kind: "OwnedReferenceType"}
  return {kind: "TypeVariableReference", location: /** @type {never} */ (undefined), parameterId: identity.parameterId}
}

/**
 * Rehydrates one non-void resolved type identity.
 * @param {import("../semantic/types.js").SemanticTypeIdentity} identity - Exact type identity.
 * @returns {import("../semantic/types.js").SemanticValueType} Detached semantic type.
 */
function semanticTypeForValueIdentity(identity) {
  return /** @type {import("../semantic/types.js").SemanticValueType} */ (semanticTypeForIdentity(identity))
}

/**
 * Renders the subset of semantic types admitted for synthetic temporaries.
 * @param {import("./writer.js").SourceWriter} writer - Active writer.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType | undefined} type - Semantic type.
 * @param {"php" | "ruby" | "javascript" | "typescript" | "java"} language - Target.
 * @param {boolean} [nested] - Whether Java requires a boxed scalar.
 * @returns {string} Target type spelling.
 */
function emittedTypeName(writer, type, language, nested = false) {
  if (!type || type.kind == "TypeReference" && type.name == "void") return language == "java" ? "Object" : "unknown"
  if (type.kind == "TypeReference") {
    if (language == "php") return type.name == "integer" ? "int" : type.name == "boolean" ? "bool" : "string"
    if (language == "ruby") return type.name == "integer" ? "Integer" : type.name == "boolean" ? "Boolean" : "String"
    if (language == "java") return type.name == "integer" ? nested ? "Integer" : "int" :
      type.name == "boolean" ? nested ? "Boolean" : "boolean" : "String"
    return type.name == "integer" ? "number" : type.name
  }
  if (type.kind == "OwnedResourceType") return writer.resourceForId(type.resourceId).name
  if (type.kind == "ReferenceType" || type.kind == "OwnedReferenceType") return writer.classNameForId(type.declarationId)
  if (type.kind == "TypeVariableReference") return writer.typeParameterForId(type.parameterId).name
  if (type.kind == "RecordType") {
    const name = writer.recordNameForId(type.declarationId)
    const arguments_ = type.arguments?.map((argument) => emittedTypeName(writer, argument, language, true)) ?? []

    return arguments_.length == 0 ? name : language == "ruby" ? `${name}[${arguments_.join(",")}]` : `${name}<${arguments_.join(",")}>`
  }
  if (type.kind == "OptionalType") {
    const value = emittedTypeName(writer, type.valueType, language, true)
    return language == "php" ? `?${value}` : language == "ruby" ? `${value}?` :
      language == "java" ? `java.util.Optional<${value}>` : `${value} | null`
  }
  if (type.kind == "ListType") {
    const value = emittedTypeName(writer, type.elementType, language, true)
    return language == "php" ? `list<${value}>` : language == "ruby" ? `Array<${value}>` :
      language == "java" ? `java.util.List<${value}>` : `readonly ${value}[]`
  }
  if (type.kind == "MapType" || type.kind == "OrderedMapType") {
    const key = emittedTypeName(writer, type.keyType, language, true)
    const value = emittedTypeName(writer, type.valueType, language, true)

    if (language == "php") return `array<${key},${value}>`
    if (language == "ruby") return `Hash[${key},${value}]`
    if (language == "java") return `${type.kind == "OrderedMapType" ? "java.util.SequencedMap" : "java.util.Map"}<${key},${value}>`
    return `ReadonlyMap<${key}, ${value}>`
  }
  return language == "java" ? "Object" : "unknown"
}

/**
 * Returns the expression roots evaluated by one statement.
 * @param {import("../semantic/types.js").Statement} statement - Statement.
 * @param {string} path - Stable statement path.
 * @returns {ExpressionPath[]} Expression roots.
 */
function statementExpressionRoots(statement, path) {
  if (statement.kind == "LocalDeclaration") return [{expression: statement.initializer, path: `${path}/initializer`}]
  if (statement.kind == "AssignmentStatement" || statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") {
    return [{expression: statement.expression, path: `${path}/expression`}]
  }
  if (statement.kind == "ReturnStatement") return statement.expression ? [{expression: statement.expression, path: `${path}/expression`}] : []
  if (statement.kind == "PrivateFieldWriteStatement") return [{expression: statement.expression, path: `${path}/expression`}]
  if (statement.kind == "IfStatement" || statement.kind == "WhileStatement") return [{expression: statement.condition, path: `${path}/condition`}]
  if (statement.kind == "ForEachStatement") return [{expression: statement.list, path: `${path}/list`}]
  if (statement.kind == "ForEachMapStatement") return [{expression: statement.map, path: `${path}/map`}]
  if (statement.kind == "RaiseStatement") return [{expression: statement.error.message, path: `${path}/error/message`}]
  return []
}

/**
 * Collects nested effect sites in postorder so children are materialized first.
 * @param {import("../semantic/types.js").Expression} expression - Current expression.
 * @param {string} path - Current occurrence path.
 * @param {import("../semantic/types.js").Expression} root - Statement expression root.
 * @param {ExpressionPath[]} output - Ordered plan receiving nested sites.
 * @returns {void}
 */
function collectNestedEffects(expression, path, root, output) {
  for (const child of expressionChildren(expression, path)) collectNestedEffects(child.expression, child.path, root, output)
  if (expression !== root && (expression.kind == "EffectCallExpression" || typeof Reflect.get(expression, "effectSiteId") == "string")) {
    output.push({expression, path})
  }
}

/**
 * Returns path-bearing expression children in evaluation order.
 * @param {import("../semantic/types.js").Expression} expression - Parent expression.
 * @param {string} path - Parent path.
 * @returns {ExpressionPath[]} Children.
 */
function expressionChildren(expression, path) {
  if (expression.kind == "CallExpression" || expression.kind == "EffectCallExpression" || expression.kind == "ReferenceConstruction" ||
    expression.kind == "RecordConstruction") return expression.arguments.map((child, index) => ({expression: child, path: `${path}/arguments/${index}`}))
  if (expression.kind == "MethodCallExpression") return [
    {expression: expression.receiver, path: `${path}/receiver`},
    ...expression.arguments.map((child, index) => ({expression: child, path: `${path}/arguments/${index}`}))
  ]
  if (expression.kind == "OwnedMoveExpression" || expression.kind == "OwnedBorrowExpression") {
    return [{expression: expression.expression, path: `${path}/expression`}]
  }
  if (expression.kind == "BinaryExpression") return [
    {expression: expression.left, path: `${path}/left`}, {expression: expression.right, path: `${path}/right`}
  ]
  if (expression.kind == "UnaryExpression") return [{expression: expression.operand, path: `${path}/operand`}]
  if (expression.kind == "OptionalSome") return [{expression: expression.value, path: `${path}/value`}]
  if (expression.kind == "OptionalIsPresent" || expression.kind == "OptionalUnwrap") {
    return [{expression: expression.operand, path: `${path}/operand`}]
  }
  if (expression.kind == "ListLiteral") return expression.elements.map((child, index) => ({expression: child, path: `${path}/elements/${index}`}))
  if (expression.kind == "MapLiteral" || expression.kind == "OrderedMapLiteral") return expression.entries.flatMap((entry, index) => [
    {expression: entry.key, path: `${path}/entries/${index}/key`}, {expression: entry.value, path: `${path}/entries/${index}/value`}
  ])
  if (expression.kind == "ListIndexExpression") return [
    {expression: expression.collection, path: `${path}/collection`}, {expression: expression.index, path: `${path}/index`}
  ]
  if (expression.kind == "MapLookupExpression") return [
    {expression: expression.collection, path: `${path}/collection`}, {expression: expression.key, path: `${path}/key`}
  ]
  if (expression.kind == "CollectionSizeExpression") return [{expression: expression.collection, path: `${path}/collection`}]
  if (expression.kind == "MemberRead") return [{expression: expression.receiver, path: `${path}/receiver`}]
  return []
}

/**
 * Checks whether generated support is required by a semantic capability node or type.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {boolean} Whether the protected binding is required.
 */
function moduleNeedsEffectSupport(module) {
  /** @type {unknown[]} */
  const pending = [module.entryPoint, ...module.functions, ...module.records ?? [], ...module.errors ?? [], ...module.classes ?? []]
  const seen = new Set()

  while (pending.length > 0) {
    const value = pending.pop()

    if (!value || typeof value != "object" || seen.has(value)) continue
    seen.add(value)
    const kind = Reflect.get(value, "kind")

    if (kind == "EffectCallExpression" || kind == "OwnedResourceType" || kind == "OwnedReferenceType" ||
      kind == "ErrorType" && /^capability:[0-9]+\/failure:[0-9]+$/u.test(String(Reflect.get(value, "declarationId")))) return true
    for (const [key, child] of Object.entries(value)) {
      if (["location", "sourceProvenance"].includes(key)) continue
      if (Array.isArray(child)) pending.push(...child)
      else if (child && typeof child == "object") pending.push(child)
    }
  }
  return false
}

/**
 * Finds a context excluded from bounded eager lowering.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {ExcludedEffect | undefined} First deterministic exclusion.
 */
function findExcludedEffectContext(module) {
  /** @type {object[]} */
  const owners = [...module.functions.filter((owner) => owner && typeof owner == "object"), module.entryPoint]

  for (const declaration of module.classes ?? []) {
    if (!declaration || typeof declaration != "object") continue
    if (declaration.constructor && typeof declaration.constructor == "object") owners.push(declaration.constructor)
    if (Array.isArray(declaration.methods)) owners.push(...declaration.methods.filter((owner) => owner && typeof owner == "object"))
  }
  for (const owner of owners) {
    const body = Reflect.get(owner, "body")

    if (!body || typeof body != "object") continue
    const found = blockExcluded(/** @type {import("../semantic/types.js").Block} */ (body))
    if (found) return found
  }
  return undefined
}

/**
 * Finds an excluded context in one structured block.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @returns {ExcludedEffect | undefined} First deterministic exclusion.
 */
function blockExcluded(block) {
  if (!block || typeof block != "object" || !Array.isArray(block.statements)) return undefined
  for (const statement of block.statements) {
    if (!statement || typeof statement != "object") continue
    if (statement.kind == "WhileStatement" && containsEffect(statement.condition)) {
      return {detail: "effectful condition-controlled loop condition", location: statement.condition.location}
    }
    const expressions = statement.kind == "LocalDeclaration" ? [statement.initializer] :
      statement.kind == "AssignmentStatement" || statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement" ? [statement.expression] :
        statement.kind == "ReturnStatement" ? statement.expression ? [statement.expression] : [] :
          statement.kind == "IfStatement" ? [statement.condition] : statement.kind == "ForEachStatement" ? [statement.list] :
            statement.kind == "ForEachMapStatement" ? [statement.map] : statement.kind == "PrivateFieldWriteStatement" ? [statement.expression] :
              statement.kind == "RaiseStatement" ? [statement.error.message] : []
    for (const expression of expressions) {
      const conditional = findConditionalEffect(expression)
      if (conditional) return {detail: "effectful short-circuit BooleanAnd/BooleanOr expression", location: conditional.location}
    }
    const nested = statement.kind == "IfStatement" ? [statement.consequent, ...(statement.alternate ? [statement.alternate] : [])] :
      statement.kind == "ForEachStatement" || statement.kind == "ForEachMapStatement" || statement.kind == "WhileStatement" ? [statement.body] :
        statement.kind == "TryStatement" ? [statement.body, statement.catchBody] : []
    for (const child of nested) {
      const found = blockExcluded(child)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Finds an effect below a short-circuit operator.
 * @param {import("../semantic/types.js").Expression} expression - Expression root.
 * @returns {import("../semantic/types.js").Expression | undefined} Invalid conditional effect.
 */
function findConditionalEffect(expression) {
  if (!expression || typeof expression != "object") return undefined
  if (expression.kind == "BinaryExpression" && ["BooleanAnd", "BooleanOr"].includes(expression.operation) &&
    (containsEffect(expression.left) || containsEffect(expression.right))) return expression
  for (const child of children(expression)) {
    const found = findConditionalEffect(child)
    if (found) return found
  }
  return undefined
}

/**
 * Checks whether an expression evaluates an effect.
 * @param {import("../semantic/types.js").Expression} expression - Expression root.
 * @returns {boolean} Whether an effect is reachable.
 */
function containsEffect(expression) {
  if (!expression || typeof expression != "object") return false
  return expression.kind == "EffectCallExpression" || Boolean(Reflect.get(expression, "effectSiteId")) || children(expression).some(containsEffect)
}

/**
 * Returns child expressions in evaluation order.
 * @param {import("../semantic/types.js").Expression} expression - Parent expression.
 * @returns {import("../semantic/types.js").Expression[]} Children.
 */
function children(expression) {
  if (!expression || typeof expression != "object") return []
  if (expression.kind == "CallExpression" || expression.kind == "EffectCallExpression" || expression.kind == "ReferenceConstruction" ||
    expression.kind == "RecordConstruction") return expression.arguments
  if (expression.kind == "MethodCallExpression") return [expression.receiver, ...expression.arguments]
  if (expression.kind == "OwnedMoveExpression" || expression.kind == "OwnedBorrowExpression") return [expression.expression]
  if (expression.kind == "BinaryExpression") return [expression.left, expression.right]
  if (expression.kind == "UnaryExpression") return [expression.operand]
  if (expression.kind == "OptionalSome") return [expression.value]
  if (expression.kind == "OptionalIsPresent" || expression.kind == "OptionalUnwrap") return [expression.operand]
  if (expression.kind == "ListLiteral") return expression.elements
  if (expression.kind == "MapLiteral" || expression.kind == "OrderedMapLiteral") return expression.entries.flatMap(({key, value}) => [key, value])
  if (expression.kind == "ListIndexExpression") return [expression.collection, expression.index]
  if (expression.kind == "MapLookupExpression") return [expression.collection, expression.key]
  if (expression.kind == "CollectionSizeExpression") return [expression.collection]
  if (expression.kind == "MemberRead") return [expression.receiver]
  return []
}

const phpSupport = `/* semantifold-task034-support */
final class ProbeOperationFailure extends RuntimeException {}
final class ProbeAcquireFailure extends RuntimeException {}
final class ProbeReadFailure extends RuntimeException {}
final class ProbeCloseFailure extends RuntimeException {}
final class ProbeResourceClosed extends RuntimeException {}
final class ProbeResource {
    public bool $closed = false;
    public function __construct(public mixed $handle) {}
}
$GLOBALS['__semantifold_task034_trace'] = [];
function probeEffect(string $label, int $value, bool $fail): int {
    $GLOBALS['__semantifold_task034_trace'][] = 'effect:' . $label;
    if ($fail) throw new ProbeOperationFailure('ProbeOperationFailure');
    return $value;
}
function probeAcquire(bool $fail): ProbeResource {
    $GLOBALS['__semantifold_task034_trace'][] = 'acquire';
    if ($fail) throw new ProbeAcquireFailure('ProbeAcquireFailure');
    try { $handle = @fopen((string) getenv('SEMANTIFOLD_TASK034_PROBE_PATH'), 'rb'); }
    catch (Throwable) { throw new ProbeAcquireFailure('ProbeAcquireFailure'); }
    if ($handle === false) throw new ProbeAcquireFailure('ProbeAcquireFailure');
    return new ProbeResource($handle);
}
function probeRead(ProbeResource $resource, bool $fail): ?string {
    if ($resource->closed) throw new ProbeResourceClosed('ProbeResourceClosed');
    $GLOBALS['__semantifold_task034_trace'][] = 'read';
    if ($fail) throw new ProbeReadFailure('ProbeReadFailure');
    try { $line = @fgets($resource->handle); }
    catch (Throwable) { throw new ProbeReadFailure('ProbeReadFailure'); }
    if ($line === false) {
        if (feof($resource->handle)) return null;
        throw new ProbeReadFailure('ProbeReadFailure');
    }
    return rtrim($line, "\\r\\n");
}
function probeClose(ProbeResource $resource, bool $fail): void {
    if ($resource->closed) throw new ProbeResourceClosed('ProbeResourceClosed');
    $GLOBALS['__semantifold_task034_trace'][] = 'close';
    try { $closed = @fclose($resource->handle); }
    catch (Throwable) { $resource->closed = true; throw new ProbeCloseFailure('ProbeCloseFailure'); }
    $resource->closed = true;
    if ($fail || !$closed) throw new ProbeCloseFailure('ProbeCloseFailure');
}
function probeTrace(): string { return implode(',', $GLOBALS['__semantifold_task034_trace']); }
/* semantifold-task034-support-end */

`

const rubySupport = `# semantifold-task034-support
class ProbeOperationFailure < StandardError; end
class ProbeAcquireFailure < StandardError; end
class ProbeReadFailure < StandardError; end
class ProbeCloseFailure < StandardError; end
class ProbeResourceClosed < StandardError; end
class ProbeResource
  attr_accessor :handle, :closed
  def initialize(handle); @handle = handle; @closed = false; end
end
$__semantifold_task034_trace = []
def probeEffect(label, value, fail_value)
  $__semantifold_task034_trace << "effect:#{label}"
  raise ProbeOperationFailure, "ProbeOperationFailure" if fail_value
  value
end
def probeAcquire(fail_value)
  $__semantifold_task034_trace << "acquire"
  raise ProbeAcquireFailure, "ProbeAcquireFailure" if fail_value
  begin; ProbeResource.new(File.open(ENV.fetch("SEMANTIFOLD_TASK034_PROBE_PATH"), "r")); rescue ProbeAcquireFailure; raise; rescue StandardError; raise ProbeAcquireFailure, "ProbeAcquireFailure"; end
end
def probeRead(resource, fail_value)
  raise ProbeResourceClosed, "ProbeResourceClosed" if resource.closed
  $__semantifold_task034_trace << "read"
  raise ProbeReadFailure, "ProbeReadFailure" if fail_value
  begin; value = resource.handle.gets; value.nil? ? nil : value.chomp; rescue ProbeReadFailure; raise; rescue StandardError; raise ProbeReadFailure, "ProbeReadFailure"; end
end
def probeClose(resource, fail_value)
  raise ProbeResourceClosed, "ProbeResourceClosed" if resource.closed
  $__semantifold_task034_trace << "close"
  begin; resource.handle.close; rescue StandardError; resource.closed = true; raise ProbeCloseFailure, "ProbeCloseFailure"; end
  resource.closed = true
  raise ProbeCloseFailure, "ProbeCloseFailure" if fail_value
  nil
end
def probeTrace; $__semantifold_task034_trace.join(","); end
# semantifold-task034-support-end

`

const javascriptSupport = `/* semantifold-task034-support */
const __semantifoldTask034Fs = process.getBuiltinModule("node:fs")
class ProbeOperationFailure extends Error {}
class ProbeAcquireFailure extends Error {}
class ProbeReadFailure extends Error {}
class ProbeCloseFailure extends Error {}
class ProbeResourceClosed extends Error {}
class ProbeResource { constructor(handle) { this.handle = handle; this.closed = false; this.position = 0 } }
const __semantifoldTask034Trace = []
function probeEffect(label, value, fail) { __semantifoldTask034Trace.push(\`effect:\${label}\`); if (fail) throw new ProbeOperationFailure("ProbeOperationFailure"); return value }
function probeAcquire(fail) { __semantifoldTask034Trace.push("acquire"); if (fail) throw new ProbeAcquireFailure("ProbeAcquireFailure"); try { return new ProbeResource(__semantifoldTask034Fs.openSync(process.env.SEMANTIFOLD_TASK034_PROBE_PATH, "r")) } catch { throw new ProbeAcquireFailure("ProbeAcquireFailure") } }
function probeRead(resource, fail) { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("read"); if (fail) throw new ProbeReadFailure("ProbeReadFailure"); try { const bytes = []; const buffer = Buffer.alloc(1); while (true) { const count = __semantifoldTask034Fs.readSync(resource.handle, buffer, 0, 1, resource.position++); if (count === 0) return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8"); if (buffer[0] === 10) return Buffer.from(bytes).toString("utf8").replace(/\\r$/u, ""); bytes.push(buffer[0]) } } catch { throw new ProbeReadFailure("ProbeReadFailure") } }
function probeClose(resource, fail) { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("close"); try { __semantifoldTask034Fs.closeSync(resource.handle) } catch { resource.closed = true; throw new ProbeCloseFailure("ProbeCloseFailure") } resource.closed = true; if (fail) throw new ProbeCloseFailure("ProbeCloseFailure") }
function probeTrace() { return __semantifoldTask034Trace.join(",") }
/* semantifold-task034-support-end */

`

const typescriptSupport = `/* semantifold-task034-support */
const __semantifoldTask034Fs = process.getBuiltinModule("node:fs")
class ProbeOperationFailure extends Error {}
class ProbeAcquireFailure extends Error {}
class ProbeReadFailure extends Error {}
class ProbeCloseFailure extends Error {}
class ProbeResourceClosed extends Error {}
class ProbeResource { closed = false; position = 0; constructor(readonly handle: number) {} }
const __semantifoldTask034Trace: string[] = []
function probeEffect(label: string, value: number, fail: boolean): number { __semantifoldTask034Trace.push(\`effect:\${label}\`); if (fail) throw new ProbeOperationFailure("ProbeOperationFailure"); return value }
function probeAcquire(fail: boolean): ProbeResource { __semantifoldTask034Trace.push("acquire"); if (fail) throw new ProbeAcquireFailure("ProbeAcquireFailure"); try { return new ProbeResource(__semantifoldTask034Fs.openSync(process.env.SEMANTIFOLD_TASK034_PROBE_PATH as string, "r")) } catch { throw new ProbeAcquireFailure("ProbeAcquireFailure") } }
function probeRead(resource: ProbeResource, fail: boolean): string | null { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("read"); if (fail) throw new ProbeReadFailure("ProbeReadFailure"); try { const bytes: number[] = []; const buffer = Buffer.alloc(1); while (true) { const count = __semantifoldTask034Fs.readSync(resource.handle, buffer, 0, 1, resource.position++); if (count === 0) return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8"); if (buffer[0] === 10) return Buffer.from(bytes).toString("utf8").replace(/\\r$/u, ""); bytes.push(buffer[0]) } } catch { throw new ProbeReadFailure("ProbeReadFailure") } }
function probeClose(resource: ProbeResource, fail: boolean): void { if (resource.closed) throw new ProbeResourceClosed("ProbeResourceClosed"); __semantifoldTask034Trace.push("close"); try { __semantifoldTask034Fs.closeSync(resource.handle) } catch { resource.closed = true; throw new ProbeCloseFailure("ProbeCloseFailure") } resource.closed = true; if (fail) throw new ProbeCloseFailure("ProbeCloseFailure") }
function probeTrace(): string { return __semantifoldTask034Trace.join(",") }
/* semantifold-task034-support-end */

`

const javaTopSupport = `// semantifold-task034-support
final class ProbeOperationFailure extends RuntimeException { ProbeOperationFailure() { super("ProbeOperationFailure"); } }
final class ProbeAcquireFailure extends RuntimeException { ProbeAcquireFailure() { super("ProbeAcquireFailure"); } }
final class ProbeReadFailure extends RuntimeException { ProbeReadFailure() { super("ProbeReadFailure"); } }
final class ProbeCloseFailure extends RuntimeException { ProbeCloseFailure() { super("ProbeCloseFailure"); } }
final class ProbeResourceClosed extends RuntimeException { ProbeResourceClosed() { super("ProbeResourceClosed"); } }
final class ProbeResource { final java.nio.channels.FileChannel handle; boolean closed = false; ProbeResource(java.nio.channels.FileChannel handle) { this.handle = handle; } }
// semantifold-task034-support-top-end

`

const javaMemberSupport = `  // semantifold-task034-support-members
  private static final java.util.ArrayList<String> __semantifoldTask034Trace = new java.util.ArrayList<>();
  static int probeEffect(String label, int value, boolean fail) { __semantifoldTask034Trace.add("effect:" + label); if (fail) throw new ProbeOperationFailure(); return value; }
  static ProbeResource probeAcquire(boolean fail) { __semantifoldTask034Trace.add("acquire"); if (fail) throw new ProbeAcquireFailure(); try { return new ProbeResource(java.nio.channels.FileChannel.open(java.nio.file.Path.of(System.getenv("SEMANTIFOLD_TASK034_PROBE_PATH")))); } catch (RuntimeException | java.io.IOException exception) { throw new ProbeAcquireFailure(); } }
  static java.util.Optional<String> probeRead(ProbeResource resource, boolean fail) { if (resource.closed) throw new ProbeResourceClosed(); __semantifoldTask034Trace.add("read"); if (fail) throw new ProbeReadFailure(); try { java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(); java.nio.ByteBuffer buffer = java.nio.ByteBuffer.allocate(1); while (true) { buffer.clear(); int count = resource.handle.read(buffer); if (count < 0) return bytes.size() == 0 ? java.util.Optional.empty() : java.util.Optional.of(bytes.toString(java.nio.charset.StandardCharsets.UTF_8)); buffer.flip(); byte value = buffer.get(); if (value == 10) return java.util.Optional.of(bytes.toString(java.nio.charset.StandardCharsets.UTF_8).replaceFirst("\\r$", "")); bytes.write(value); } } catch (java.io.IOException exception) { throw new ProbeReadFailure(); } }
  static void probeClose(ProbeResource resource, boolean fail) { if (resource.closed) throw new ProbeResourceClosed(); __semantifoldTask034Trace.add("close"); try { resource.handle.close(); } catch (java.io.IOException exception) { resource.closed = true; throw new ProbeCloseFailure(); } resource.closed = true; if (fail) throw new ProbeCloseFailure(); }
  static String probeTrace() { return String.join(",", __semantifoldTask034Trace); }
  // semantifold-task034-support-members-end

`
