// @ts-check

/** @type {readonly import("./types.js").SemanticTypeName[]} */
const scalarTypeNames = Object.freeze(["integer", "boolean", "string"])

/**
 * Returns the canonical semantic scalar type reference.
 * @param {import("./types.js").SemanticTypeName} name - Semantic scalar name.
 * @returns {import("./types.js").TypeReference} Scalar type reference.
 */
export function scalarType(name) {
  return {kind: /** @type {const} */ ("TypeReference"), name}
}

/**
 * Checks an opaque scalar type name without coercion.
 * @param {string} name - Candidate semantic type name.
 * @returns {name is import("./types.js").SemanticTypeName} Whether the name is supported.
 */
export function isScalarTypeName(name) {
  return scalarTypeNames.some((candidate) => candidate == name)
}

/**
 * Checks that a JavaScript string contains only complete Unicode scalar values.
 * @param {string} value - Candidate Unicode string.
 * @returns {boolean} Whether the string excludes lone UTF-16 surrogates.
 */
export function hasOnlyUnicodeScalars(value) {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const trailing = value.charCodeAt(index + 1)

      if (!Number.isInteger(trailing) || trailing < 0xDC00 || trailing > 0xDFFF) return false
      index++
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false
    }
  }

  return true
}
