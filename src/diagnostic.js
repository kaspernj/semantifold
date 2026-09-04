// @ts-check

/** A clear parser, semantic, or backend capability diagnostic. */
export class SemantifoldDiagnostic extends Error {
  /**
   * Creates a diagnostic.
   * @param {object} options - Diagnostic fields.
   * @param {string} options.code - Stable diagnostic code.
   * @param {string} options.message - Human-readable message.
   * @param {string} options.language - Related language, target, tool, or registry identity.
   * @param {import("./semantic/types.js").SourceLocation | undefined} [options.location] - Related location.
   * @param {import("./semantic/types.js").SourceLocation | undefined} [options.generatedLocation] - Pre-remapping generated location.
   * @param {Error | undefined} [options.cause] - Preserved parser error.
   * @param {string | undefined} [options.command] - Canonical command when tool discovery is involved.
   * @param {string | undefined} [options.executable] - Exact resolved executable when known.
   * @param {number | undefined} [options.exitCode] - Process exit code when available.
   * @param {string | undefined} [options.signal] - Process termination signal when available.
   * @param {string | undefined} [options.stage] - Acceptance stage when execution is involved.
   * @param {string | undefined} [options.stderr] - Captured standard error when available.
   * @param {string | undefined} [options.stdout] - Captured standard output when available.
   * @param {string | undefined} [options.version] - Captured executable version when known.
   */
  constructor({cause, code, command, executable, exitCode, generatedLocation, language, location, message, signal, stage, stderr, stdout, version}) {
    const locationText = location ? ` at ${location.filename}:${location.start.line}:${location.start.column}` : ""

    super(`[${code}] ${language}${locationText}: ${message}`, cause ? {cause} : undefined)
    this.name = "SemantifoldDiagnostic"
    this.code = code
    this.detail = message
    this.generatedLocation = generatedLocation
    this.language = language
    this.location = location
    if (command != undefined) this.command = command
    if (executable != undefined) this.executable = executable
    if (exitCode != undefined) this.exitCode = exitCode
    if (signal != undefined) this.signal = signal
    if (stage != undefined) this.stage = stage
    if (stderr != undefined) this.stderr = stderr
    if (stdout != undefined) this.stdout = stdout
    if (version != undefined) this.version = version
  }
}

/**
 * Throws a normalized parser diagnostic while preserving the parser error.
 * @param {import("./semantic/types.js").SemanticLanguage} language - Frontend language.
 * @param {unknown} error - Opaque parser error, narrowed immediately.
 * @returns {never} Always throws.
 */
export function parseFailure(language, error) {
  const cause = error instanceof Error ? error : new Error(String(error))

  throw new SemantifoldDiagnostic({
    cause,
    code: "PARSE_ERROR",
    language,
    message: cause.message
  })
}

/**
 * Throws an unsupported-syntax diagnostic.
 * @param {import("./semantic/types.js").SemanticLanguage} language - Frontend language.
 * @param {string} syntax - Parser syntax kind.
 * @param {import("./semantic/types.js").SourceLocation | undefined} location - Source location.
 * @returns {never} Always throws.
 */
export function unsupportedSyntax(language, syntax, location) {
  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_SYNTAX",
    language,
    location,
    message: `Syntax '${syntax}' is outside the implemented semantic subset.`
  })
}

/**
 * Throws a missing-type diagnostic.
 * @param {import("./semantic/types.js").SemanticLanguage} language - Frontend language.
 * @param {string} subject - Untyped subject.
 * @param {import("./semantic/types.js").SourceLocation | undefined} location - Source location.
 * @returns {never} Always throws.
 */
export function missingType(language, subject, location) {
  throw new SemantifoldDiagnostic({
    code: "MISSING_TYPE",
    language,
    location,
    message: `${subject} requires an explicit supported scalar type: integer, boolean, or string.`
  })
}

/**
 * Throws a language-neutral semantic diagnostic discovered after adaptation.
 * @param {import("./semantic/types.js").SemanticLanguage} language - Source language.
 * @param {string} code - Stable semantic diagnostic code.
 * @param {string} detail - Human-readable semantic failure.
 * @param {import("./semantic/types.js").SourceLocation | undefined} location - Source location.
 * @returns {never} Always throws.
 */
export function semanticFailure(language, code, detail, location) {
  throw new SemantifoldDiagnostic({code, language, location, message: detail})
}

/**
 * Throws an unsupported backend-capability diagnostic.
 * @param {import("./semantic/types.js").SemanticLanguage} language - Backend language.
 * @param {string} capability - Unsupported semantic capability.
 * @param {import("./semantic/types.js").SourceLocation | undefined} location - Semantic source location.
 * @returns {never} Always throws.
 */
export function unsupportedCapability(language, capability, location) {
  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_CAPABILITY",
    language,
    location,
    message: `Backend cannot emit semantic capability '${capability}'.`
  })
}

/**
 * Throws when a registered identity lacks one requested role.
 * @param {string} language - Registered language or target identity.
 * @param {string} role - Requested registry role.
 * @param {import("./semantic/types.js").SourceLocation | undefined} [location] - Related semantic location.
 * @returns {never} Always throws.
 */
export function unsupportedRole(language, role, location) {
  throw new SemantifoldDiagnostic({
    code: "UNSUPPORTED_ROLE",
    language,
    location,
    message: `Registered language or target does not provide role '${role}'.`
  })
}
