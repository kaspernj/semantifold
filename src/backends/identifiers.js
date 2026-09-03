// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** @type {Record<import("../semantic/types.js").SemanticLanguage, RegExp>} */
const identifierPatterns = {
  java: /^[A-Za-z_$][A-Za-z0-9_$]*$/u,
  javascript: /^[A-Za-z_$][A-Za-z0-9_$]*$/u,
  php: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  ruby: /^[a-z_][A-Za-z0-9_]*$/u,
  typescript: /^[A-Za-z_$][A-Za-z0-9_$]*$/u
}

/** @type {Record<import("../semantic/types.js").SemanticLanguage, Set<string>>} */
const reservedWords = {
  java: new Set([
    "_", "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue",
    "default", "do", "double", "else", "enum", "exports", "extends", "false", "final", "finally", "float", "for",
    "goto", "if", "implements", "import", "instanceof", "int", "interface", "long", "module", "native", "new",
    "non-sealed", "null", "open", "opens", "package", "permits", "private", "protected", "provides", "public",
    "record", "requires", "return", "sealed", "short", "static", "strictfp", "super", "switch", "synchronized",
    "this", "throw", "throws", "to", "transient", "transitive", "true", "try", "uses", "var", "void", "volatile",
    "when", "while", "with", "yield"
  ]),
  javascript: new Set([
    "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
    "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import", "in",
    "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static",
    "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield"
  ]),
  php: new Set([
    "__halt_compiler", "abstract", "and", "array", "as", "break", "callable", "case", "catch", "class", "clone",
    "const", "continue", "declare", "default", "die", "do", "echo", "else", "elseif", "empty", "enddeclare",
    "endfor", "endforeach", "endif", "endswitch", "endwhile", "enum", "eval", "exit", "extends", "false", "final",
    "finally", "fn", "for", "foreach", "from", "function", "global", "goto", "if", "implements", "include",
    "include_once", "instanceof", "insteadof", "interface", "isset", "iterable", "list", "match", "mixed", "namespace",
    "never", "new", "null", "object", "or", "parent", "print", "private", "protected", "public", "readonly", "require",
    "require_once", "return", "self", "static", "switch", "throw", "trait", "true", "try", "unset", "use", "var",
    "void", "while", "xor", "yield"
  ]),
  ruby: new Set([
    "BEGIN", "END", "__ENCODING__", "__END__", "__FILE__", "__LINE__", "alias", "and", "begin", "break", "case",
    "class", "def", "defined?", "do", "else", "elsif", "end", "ensure", "false", "for", "if", "in", "module",
    "next", "nil", "not", "or", "redo", "rescue", "retry", "return", "self", "super", "then", "true", "undef",
    "unless", "until", "when", "while", "yield"
  ]),
  typescript: new Set([
    "abstract", "any", "as", "asserts", "async", "await", "boolean", "break", "case", "catch", "class", "const",
    "constructor", "continue", "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends",
    "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in", "infer", "instanceof",
    "interface", "is", "keyof", "let", "module", "namespace", "never", "new", "null", "number", "object", "of",
    "override", "package", "private", "protected", "public", "readonly", "require", "return", "satisfies", "set",
    "static", "string", "super", "switch", "symbol", "this", "throw", "true", "try", "type", "typeof", "undefined",
    "unique", "unknown", "using", "var", "void", "while", "with", "yield"
  ])
}

const phpInvalidParameterBindings = new Set([
  "GLOBALS", "_COOKIE", "_ENV", "_FILES", "_GET", "_POST", "_REQUEST", "_SERVER", "_SESSION", "this"
])
const phpInvalidAssignedBindings = new Set(["GLOBALS", "this"])

/**
 * Validates an identifier against the target backend's deliberately narrow lexical contract.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {unknown} name - Candidate semantic identifier.
 * @param {string} role - Identifier role for diagnostics.
 * @param {import("../semantic/types.js").SourceLocation | undefined} location - Originating location.
 * @returns {void}
 */
export function validateTargetIdentifier(language, name, role, location) {
  if (typeof name != "string") unsupportedCapability(language, `${role} identifier`, location)

  const reservedName = language == "php" ? name.toLowerCase() : name

  if (!identifierPatterns[language].test(name) || reservedWords[language].has(reservedName)) {
    unsupportedCapability(language, `${role} identifier '${name}'`, location)
  }
}

/**
 * Validates a binding identifier against target restrictions beyond general identifier syntax.
 * @param {import("../semantic/types.js").SemanticLanguage} language - Target language.
 * @param {unknown} name - Candidate semantic identifier.
 * @param {string} role - Binding role for diagnostics.
 * @param {import("../semantic/types.js").SourceLocation | undefined} location - Originating location.
 * @returns {void}
 */
export function validateTargetBindingIdentifier(language, name, role, location) {
  validateTargetIdentifier(language, name, role, location)

  const invalidTypeScriptBinding = language == "typescript" && (name == "arguments" || name == "eval")
  const invalidPhpVariable = language == "php" && typeof name == "string" &&
    ((role == "parameter" && phpInvalidParameterBindings.has(name)) ||
      ((role == "local" || role == "assignment target") && phpInvalidAssignedBindings.has(name)))
  const invalidRubyBinding = language == "ruby" && typeof name == "string" && /^_[1-9]$/u.test(name)

  if (invalidTypeScriptBinding || invalidPhpVariable || invalidRubyBinding) {
    unsupportedCapability(language, `${role} identifier '${name}'`, location)
  }
}
