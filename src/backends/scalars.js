// @ts-check

/** @type {Readonly<Record<import("../semantic/types.js").SemanticLanguage, Readonly<Record<import("../semantic/types.js").SemanticTypeName, string>>>>} */
const targetScalarTypes = Object.freeze({
  csharp: Object.freeze({boolean: "bool", integer: "long", string: "string"}),
  java: Object.freeze({boolean: "boolean", integer: "int", string: "String"}),
  javascript: Object.freeze({boolean: "boolean", integer: "number", string: "string"}),
  php: Object.freeze({boolean: "bool", integer: "int", string: "string"}),
  python: Object.freeze({boolean: "bool", integer: "int", string: "str"}),
  ruby: Object.freeze({boolean: "bool", integer: "Integer", string: "String"}),
  typescript: Object.freeze({boolean: "boolean", integer: "number", string: "string"})
})

/**
 * Emits one target-language scalar type spelling.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {import("../semantic/types.js").TypeReference} type - Semantic scalar type.
 * @returns {string} Target type spelling.
 */
export function emitScalarType(language, type) {
  return targetScalarTypes[language][type.name]
}

/**
 * Emits a safely escaped target-language string literal.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {string} value - Valid Unicode scalar string.
 * @returns {string} Target string literal.
 */
export function emitStringLiteral(language, value) {
  if (language == "php") return emitPhpString(value)
  if (language == "ruby") return emitRubyString(value)
  if (language == "java") return emitJavaString(value)

  const literal = JSON.stringify(value)

  if (typeof literal != "string") throw new TypeError("A validated semantic string did not serialize.")

  const escapedLineSeparators = literal.replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")

  return language == "csharp" ? escapedLineSeparators.replaceAll("\u0085", "\\u0085") : escapedLineSeparators
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
