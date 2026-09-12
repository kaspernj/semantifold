// @ts-check

/** @type {Readonly<Record<import("../semantic/types.js").TextBackendLanguage, Readonly<Record<import("../semantic/types.js").FunctionReturnTypeName, string>>>>} */
const targetScalarTypes = Object.freeze({
  swift: Object.freeze({boolean: "Bool", integer: "Int64", string: "String", void: "Void"}),
  rust: Object.freeze({boolean: "bool", integer: "i64", string: "String", void: "()"}),
  cpp: Object.freeze({boolean: "bool", integer: "std::int64_t", string: "std::string", void: "void"}),
  c: Object.freeze({boolean: "bool", integer: "int64_t", string: "SemantifoldString", void: "void"}),
  csharp: Object.freeze({boolean: "bool", integer: "long", string: "string", void: "void"}),
  go: Object.freeze({boolean: "bool", integer: "int64", string: "string", void: "void"}),
  java: Object.freeze({boolean: "boolean", integer: "int", string: "String", void: "void"}),
  kotlin: Object.freeze({boolean: "Boolean", integer: "Long", string: "String", void: "Unit"}),
  javascript: Object.freeze({boolean: "boolean", integer: "number", string: "string", void: "void"}),
  php: Object.freeze({boolean: "bool", integer: "int", string: "string", void: "void"}),
  python: Object.freeze({boolean: "bool", integer: "int", string: "str", void: "None"}),
  ruby: Object.freeze({boolean: "bool", integer: "Integer", string: "String", void: "void"}),
  typescript: Object.freeze({boolean: "boolean", integer: "number", string: "string", void: "void"})
})

/**
 * Emits one target-language scalar or function-return type spelling.
 * @param {import("../semantic/types.js").TextBackendLanguage} language - Target language.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {string} Target type spelling.
 */
export function emitScalarType(language, type) {
  return type.kind == "TypeReference" ? targetScalarTypes[language][type.name] : ""
}

/**
 * Emits one recursively parameterized semantic type for the Task 006 cohort.
 * @param {import("../semantic/types.js").TextBackendLanguage} language - Target language.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @param {boolean} [javaBoxed] - Whether Java scalar arguments require boxed spellings.
 * @returns {string} Exact target spelling.
 */
export function emitSemanticType(language, type, javaBoxed = false) {
  if (type.kind == "RecordType" || type.kind == "ReferenceType") {
    throw new TypeError("Nominal type emission requires declaration context.")
  }
  if (type.kind == "TypeVariableReference") throw new TypeError("Type-variable emission requires declaration context.")
  if (type.kind == "TypeReference") {
    if (language == "java" && javaBoxed) {
      return type.name == "integer" ? "Integer" : type.name == "boolean" ? "Boolean" : type.name == "string" ? "String" : "void"
    }

    return emitScalarType(language, type)
  }

  const element = type.kind == "ListType" ? type.elementType : type.valueType
  const nested = emitSemanticType(language, element, language == "java")

  if (type.kind == "ListType") {
    if (language == "ruby") return `Array[${nested}]`
    if (language == "php") return `list<${nested}>`
    if (language == "javascript" || language == "typescript") return `ReadonlyArray<${nested}>`
    if (language == "java") return `java.util.List<${nested}>`
  } else {
    if (language == "ruby") return `Hash[String,${nested}]`
    if (language == "php") return `array<string,${nested}>`
    if (language == "javascript" || language == "typescript") return `ReadonlyMap<string, ${nested}>`
    if (language == "java") return `java.util.Map<String,${nested}>`
  }

  return ""
}

/**
 * Emits a safely escaped target-language string literal.
 * @param {import("../semantic/types.js").TextBackendLanguage} language - Target language.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} Target string literal.
 */
export function emitStringLiteral(language, value) {
  if (language == "swift") return emitSwiftString(value)
  if (language == "php") return emitPhpString(value)
  if (language == "ruby") return emitRubyString(value)
  if (language == "java") return emitJavaString(value)
  if (language == "kotlin") return emitKotlinString(value)

  const literal = JSON.stringify(value)

  if (typeof literal != "string") throw new TypeError("A validated semantic string did not serialize.")

  const escapedLineSeparators = literal.replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")

  return language == "csharp" ? escapedLineSeparators.replaceAll("\u0085", "\\u0085") : escapedLineSeparators
}

/**
 * Emits one noninterpolated Swift string over Unicode scalar values.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} Swift string literal.
 */
function emitSwiftString(value) {
  let emitted = "\""

  for (const character of value) {
    const codePoint = /** @type {number} */ (character.codePointAt(0))

    if (character == "\"") emitted += "\\\""
    else if (character == "\\") emitted += "\\\\"
    else if (character == "\n") emitted += "\\n"
    else if (character == "\r") emitted += "\\r"
    else if (character == "\t") emitted += "\\t"
    else if (codePoint < 32 || codePoint == 127 || codePoint == 0x85 || codePoint == 0x2028 || codePoint == 0x2029) {
      emitted += `\\u{${codePoint.toString(16)}}`
    } else emitted += character
  }

  return `${emitted}"`
}

/**
 * Emits a PHP double-quoted string while preventing interpolation.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} PHP string literal.
 */
function emitPhpString(value) {
  let emitted = "\""

  for (const character of value) {
    const codePoint = character.codePointAt(0)

    if (character == "\"") emitted += "\\\""
    else if (character == "\\") emitted += "\\\\"
    else if (character == "$") emitted += "\\$"
    else if (character == "\n") emitted += "\\n"
    else if (character == "\r") emitted += "\\r"
    else if (character == "\t") emitted += "\\t"
    else if (character == "\f") emitted += "\\f"
    else if (character == "\v") emitted += "\\v"
    else if (codePoint == 27) emitted += "\\e"
    else if (codePoint !== undefined && (codePoint < 32 || codePoint == 127)) {
      emitted += `\\x${codePoint.toString(16).padStart(2, "0")}`
    } else emitted += character
  }

  return `${emitted}"`
}

/**
 * Emits a Ruby double-quoted string while preventing interpolation.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} Ruby string literal.
 */
function emitRubyString(value) {
  let emitted = "\""

  for (const character of value) {
    const codePoint = character.codePointAt(0)

    if (character == "\"") emitted += "\\\""
    else if (character == "\\") emitted += "\\\\"
    else if (character == "#") emitted += "\\#"
    else if (character == "\n") emitted += "\\n"
    else if (character == "\r") emitted += "\\r"
    else if (character == "\t") emitted += "\\t"
    else if (character == "\f") emitted += "\\f"
    else if (character == "\v") emitted += "\\v"
    else if (codePoint == 27) emitted += "\\e"
    else if (codePoint !== undefined && (codePoint < 32 || codePoint == 127)) {
      emitted += `\\u{${codePoint.toString(16)}}`
    } else emitted += character
  }

  return `${emitted}"`
}

/**
 * Emits a Java string using standard or fixed-width octal control escapes.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} Java string literal.
 */
function emitJavaString(value) {
  let emitted = "\""

  for (const character of value) {
    const codePoint = character.codePointAt(0)

    if (character == "\"") emitted += "\\\""
    else if (character == "\\") emitted += "\\\\"
    else if (character == "\b") emitted += "\\b"
    else if (character == "\t") emitted += "\\t"
    else if (character == "\n") emitted += "\\n"
    else if (character == "\f") emitted += "\\f"
    else if (character == "\r") emitted += "\\r"
    else if (codePoint !== undefined && (codePoint < 32 || codePoint == 127)) {
      emitted += `\\${codePoint.toString(8).padStart(3, "0")}`
    } else emitted += character
  }

  return `${emitted}"`
}

/**
 * Emits an ordinary noninterpolated Kotlin string over Unicode scalar values.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} Kotlin string literal.
 */
function emitKotlinString(value) {
  let emitted = "\""

  for (const character of value) {
    const codePoint = /** @type {number} */ (character.codePointAt(0))

    if (character == "\"") emitted += "\\\""
    else if (character == "\\") emitted += "\\\\"
    else if (character == "$") emitted += "\\$"
    else if (character == "\b") emitted += "\\b"
    else if (character == "\t") emitted += "\\t"
    else if (character == "\n") emitted += "\\n"
    else if (character == "\r") emitted += "\\r"
    else if (codePoint < 32 || codePoint == 127) emitted += `\\u${codePoint.toString(16).padStart(4, "0")}`
    else emitted += character
  }

  return `${emitted}"`
}
