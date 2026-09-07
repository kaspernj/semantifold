// @ts-check

import {unsupportedCapability} from "../diagnostic.js"

/** @type {Record<import("../semantic/types.js").SemanticLanguage, RegExp>} */
const identifierPatterns = {
  c: /^[A-Za-z][A-Za-z0-9_]*$/u,
  csharp: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  go: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  java: /^[A-Za-z_$][A-Za-z0-9_$]*$/u,
  javascript: /^[A-Za-z_$][A-Za-z0-9_$]*$/u,
  php: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  python: /^(?:_|\p{XID_Start})(?:_|\p{XID_Continue})*$/u,
  ruby: /^[a-z_][A-Za-z0-9_]*$/u,
  typescript: /^[A-Za-z_$][A-Za-z0-9_$]*$/u
}

/** @type {Record<import("../semantic/types.js").SemanticLanguage, Set<string>>} */
const reservedWords = {
  c: new Set([
    "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern",
    "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return", "short", "signed",
    "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while",
    "bool", "true", "false", "TRUE", "FALSE", "int64_t", "uint64_t", "size_t", "ptrdiff_t", "main", "NULL", "INT64_C", "UINT64_C",
    "INT64_MIN", "INT64_MAX", "PTRDIFF_MAX", "CHAR_BIT", "stdin", "stdout", "stderr", "malloc", "free", "exit",
    "fwrite", "fflush", "memcpy", "memcmp", "FILE", "fpos_t", "div_t", "ldiv_t", "lldiv_t", "wchar_t", "max_align_t",
    "offsetof", "alignas", "alignof", "noreturn", "true", "false", "assert", "static_assert", "errno",
    "EOF", "BUFSIZ", "FOPEN_MAX", "FILENAME_MAX", "L_tmpnam", "SEEK_CUR", "SEEK_END", "SEEK_SET", "TMP_MAX",
    "EXIT_FAILURE", "EXIT_SUCCESS", "MB_CUR_MAX", "MB_LEN_MAX", "RAND_MAX",
    "remove", "rename", "tmpfile", "tmpnam", "fclose", "fopen", "freopen", "setbuf", "setvbuf",
    "fprintf", "fscanf", "printf", "scanf", "snprintf", "sprintf", "sscanf", "vfprintf", "vfscanf", "vprintf",
    "vscanf", "vsnprintf", "vsprintf", "vsscanf", "fgetc", "fgets", "fputc", "fputs", "getc", "getchar",
    "putc", "putchar", "puts", "ungetc", "fread", "fgetpos", "fseek", "fsetpos", "ftell", "rewind", "clearerr",
    "feof", "ferror", "perror", "atof", "atoi", "atol", "atoll", "strtod", "strtof", "strtold", "strtol",
    "strtoll", "strtoul", "strtoull", "rand", "srand", "aligned_alloc", "calloc", "realloc", "abort", "atexit",
    "at_quick_exit", "quick_exit", "getenv", "system", "bsearch", "qsort", "abs", "labs", "llabs", "div", "ldiv",
    "lldiv", "mblen", "mbtowc", "wctomb", "mbstowcs", "wcstombs", "memmove", "strcpy", "strncpy", "strcat",
    "strncat", "strcmp", "strcoll", "strncmp", "strxfrm", "memchr", "strchr", "strcspn", "strpbrk", "strrchr",
    "strspn", "strstr", "strtok", "memset", "strerror", "strlen"
  ]),
  csharp: new Set([
    "__arglist", "__makeref", "__reftype", "__refvalue", "abstract", "add", "alias", "allows", "and", "as",
    "ascending", "async", "await", "base", "bool", "break",
    "by", "byte", "case", "catch", "char", "checked", "class", "const", "continue", "decimal", "default",
    "delegate", "descending", "do", "double", "dynamic", "else", "enum", "equals", "event", "explicit", "extension", "extern",
    "false", "field", "file", "finally", "fixed", "float", "for", "foreach", "from", "get", "global", "goto",
    "group", "if", "implicit", "in", "init", "int", "interface", "internal", "into", "is", "join", "let", "lock",
    "long", "managed", "nameof", "namespace", "new", "nint", "not", "notnull", "null", "nuint", "object", "on",
    "operator", "or", "orderby", "out", "override", "params", "partial", "private", "protected", "public", "readonly",
    "record", "ref", "remove", "required", "return", "sbyte", "scoped", "sealed", "select", "set", "short", "sizeof",
    "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong",
    "unchecked", "unmanaged", "unsafe", "ushort", "using", "value", "var", "virtual", "void", "volatile", "when",
    "where", "while", "with", "yield"
  ]),
  go: new Set([
    "_", "break", "default", "func", "interface", "select", "case", "defer", "go", "map", "struct", "chan",
    "else", "goto", "package", "switch", "const", "fallthrough", "if", "range", "type", "continue", "for",
    "import", "return", "var"
  ]),
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
  python: new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "bool", "break", "case", "class",
    "continue", "def", "del", "elif", "else", "except", "exec", "finally", "for", "from", "global", "if",
    "import", "in", "int", "is", "lambda", "match", "nonlocal", "not", "or", "pass", "print",
    "raise", "return", "str", "try", "type", "while", "with", "yield", "_", "__debug__"
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

  if (!identifierPatterns[language].test(name) || reservedWords[language].has(reservedName) ||
    language == "python" && name.normalize("NFKC") != name ||
    language == "c" && !isCIdentifier(name)) {
    unsupportedCapability(language, `${role} identifier '${name}'`, location)
  }
}

/**
 * Protects the exact C header environment and implementation-reserved namespace in either direction.
 * @param {string} name - Caller identifier.
 * @returns {boolean} Whether the spelling is safe in the canonical translation unit.
 */
export function isCIdentifier(name) {
  return identifierPatterns.c.test(name) && !reservedWords.c.has(name) &&
    !/^(?:semantifold_|SEMANTIFOLD_|Semantifold|atomic_|INT[0-9_A-Z]|UINT[0-9_A-Z]|INTMAX_|UINTMAX_|SIZE_|PTRDIFF_|SIG_ATOMIC_|WCHAR_|WINT_|CHAR_|SCHAR_|UCHAR_|SHRT_|USHRT_|LONG_|ULONG_|LLONG_|ULLONG_)/u.test(name) &&
    !/^(?:u?int(?:8|16|32|64|max|ptr|_least[0-9]+|_fast[0-9]+)_t)$/u.test(name)
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
