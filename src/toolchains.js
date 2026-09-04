// @ts-check

import {constants as fsConstants} from "node:fs"
import {access, realpath, stat} from "node:fs/promises"
import path from "node:path"
import {isDenseArray} from "./array.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {exceededOwnedDeadline, executeFileWithDeadline} from "./subprocess.js"
import {isSupportedTimeoutMs, maximumTimeoutMs} from "./timeout.js"

const defaultTimeoutMs = 10_000

export const canonicalToolchains = deepFreeze({
  php: definition("php", "SEMANTIFOLD_PHP", ["--version"], /^PHP 8\./u),
  ruby: definition("ruby", "SEMANTIFOLD_RUBY", ["--version"], /^ruby 3\./u),
  node: definition("node", "SEMANTIFOLD_NODE", ["--version"], /^v24\./u),
  tsc: definition("tsc", "SEMANTIFOLD_TSC", ["--version"], /^Version 7\./u),
  javac: definition("javac", "SEMANTIFOLD_JAVAC", ["-version"], /^javac (?:1[7-9]|2[0-9])\./u),
  java: definition("java", "SEMANTIFOLD_JAVA", ["-version"], /^(?:openjdk|java) version "(?:1[7-9]|2[0-9])\./u),
  python: definition("python3", "SEMANTIFOLD_PYTHON", ["--version"], /^Python 3\./u)
})

/**
 * Discovers one repository-declared canonical toolchain.
 * @param {keyof typeof canonicalToolchains} id - Canonical toolchain ID.
 * @param {{environment?: Readonly<Record<string, string | undefined>>, override?: string, timeoutMs?: number}} [options] - Discovery options.
 * @returns {Promise<import("./semantic/types.js").DiscoveredToolchain>} Exact executable and version.
 */
export async function discoverCanonicalToolchain(id, options = {}) {
  if (typeof id != "string" || id.length == 0) {
    invalidToolchain("Canonical toolchain ID must be a non-empty primitive string.", "toolchain")
  }
  if (!isPlainObject(options)) invalidToolchain("Canonical toolchain options must be an object.", id)
  const definition = Object.hasOwn(canonicalToolchains, id)
    ? canonicalToolchains[/** @type {keyof typeof canonicalToolchains} */ (id)]
    : undefined

  if (!definition) invalidToolchain(`Unknown canonical toolchain '${id}'.`, id)
  const configurationEnvironment = options.environment === undefined
    ? undefined
    : snapshotEnvironment(options.environment, id)
  const environment = configurationEnvironment ?? defaultEnvironment()
  const configured = options.override === undefined
    ? configurationEnvironment === undefined
      ? process.env[definition.overrideEnvironmentVariable]
      : configurationEnvironment[definition.overrideEnvironmentVariable]
    : options.override

  return discoverToolchain({
    canonicalCommand: definition.canonicalCommand,
    environment,
    id,
    override: configured,
    supportedVersion: definition.supportedVersion,
    timeoutMs: options.timeoutMs,
    versionArguments: definition.versionArguments
  })
}

/**
 * Resolves and versions one configured or canonical executable without invoking a shell.
 * @param {object} input - Discovery request.
 * @param {string} input.canonicalCommand - Canonical PATH command.
 * @param {Readonly<Record<string, string | undefined>>} [input.environment] - Explicit discovery environment.
 * @param {string} input.id - Toolchain ID.
 * @param {string} [input.override] - Configured absolute executable path.
 * @param {RegExp} [input.supportedVersion] - Full captured-output version policy.
 * @param {number} [input.timeoutMs] - Version command timeout.
 * @param {string[]} input.versionArguments - Exact version argument array.
 * @returns {Promise<import("./semantic/types.js").DiscoveredToolchain>} Discovered tool.
 */
export async function discoverToolchain(input) {
  if (!isPlainObject(input)) invalidToolchain("Toolchain discovery requires a request object.", "toolchain")
  const versionArgumentCandidate = input.versionArguments
  const versionArguments = isDenseArray(versionArgumentCandidate) ? [...versionArgumentCandidate] : undefined
  const candidate = {
    canonicalCommand: input.canonicalCommand,
    environment: input.environment === undefined ? defaultEnvironment() : input.environment,
    id: input.id,
    override: input.override,
    supportedVersion: input.supportedVersion,
    timeoutMs: input.timeoutMs === undefined ? defaultTimeoutMs : input.timeoutMs,
    versionArguments
  }

  validateDiscovery(candidate)
  const canonicalCommand = /** @type {string} */ (candidate.canonicalCommand)
  const environment = /** @type {Readonly<Record<string, string | undefined>>} */ (candidate.environment)
  const id = /** @type {string} */ (candidate.id)
  const override = /** @type {string | undefined} */ (candidate.override)
  const supportedVersion = candidate.supportedVersion instanceof RegExp
    ? new RegExp(candidate.supportedVersion.source, candidate.supportedVersion.flags)
    : undefined
  const timeoutMs = /** @type {number} */ (candidate.timeoutMs)
  const validatedVersionArguments = /** @type {string[]} */ (candidate.versionArguments)
  const normalizedEnvironment = deterministicEnvironment(environment)
  const {executable, source} = override === undefined
    ? await resolveCanonical(id, canonicalCommand, normalizedEnvironment.PATH ?? "")
    : {executable: await resolveOverride(id, override, canonicalCommand), source: /** @type {const} */ ("override")}
  /** @type {{stdout: string, stderr: string}} */
  let result

  try {
    result = await executeFileWithDeadline({
      arguments: validatedVersionArguments,
      environment: normalizedEnvironment,
      executable,
      maxBuffer: 1024 * 1024,
      timeoutMs
    })
  } catch (error) {
    const processError = processErrorFields(error)
    const timedOut = exceededOwnedDeadline(error)

    throw new SemantifoldDiagnostic({
      ...processError,
      cause: error instanceof Error ? error : undefined,
      code: timedOut ? "TOOL_VERSION_TIMEOUT" : "TOOL_VERSION_FAILURE",
      command: canonicalCommand,
      executable,
      language: id,
      message: timedOut
        ? `Version command for '${executable}' exceeded ${timeoutMs}ms.`
        : `Version command for '${executable}' failed.`,
      stderr: processError.stderr,
      stdout: processError.stdout
    })
  }

  const {stderr, stdout} = result
  const versionOutput = [stdout, stderr].filter((value) => value.length > 0).join("\n").trim()
  const version = versionOutput.split(/\r?\n/u)[0] ?? ""

  if (version.length == 0) {
    throw new SemantifoldDiagnostic({
      code: "TOOL_VERSION_FAILURE",
      command: canonicalCommand,
      executable,
      language: id,
      message: `Version command for '${executable}' returned no version output.`,
      stderr,
      stdout
    })
  }
  if (supportedVersion && !supportedVersion.test(versionOutput)) {
    throw new SemantifoldDiagnostic({
      code: "TOOL_UNSUPPORTED_VERSION",
      command: canonicalCommand,
      executable,
      language: id,
      message: `Executable '${executable}' reported unsupported version '${version}'.`,
      stderr,
      stdout,
      version
    })
  }

  return deepFreeze({
    command: canonicalCommand,
    executable,
    id,
    source,
    version,
    versionArguments: validatedVersionArguments,
    versionOutput
  })
}

/**
 * Builds one canonical immutable toolchain declaration.
 * @param {string} canonicalCommand - PATH command.
 * @param {string} overrideEnvironmentVariable - Configured override variable.
 * @param {string[]} versionArguments - Exact version arguments.
 * @param {RegExp} supportedVersion - Supported version output.
 * @returns {{canonicalCommand: string, overrideEnvironmentVariable: string, supportedVersion: RegExp, versionArguments: string[]}} Declaration.
 */
function definition(canonicalCommand, overrideEnvironmentVariable, versionArguments, supportedVersion) {
  return {canonicalCommand, overrideEnvironmentVariable, supportedVersion, versionArguments}
}

/**
 * Validates tool discovery before filesystem or process access.
 * @param {{
 *   canonicalCommand: unknown,
 *   environment: unknown,
 *   id: unknown,
 *   override: unknown,
 *   supportedVersion: unknown,
 *   timeoutMs: unknown,
 *   versionArguments: unknown
 * }} input - Candidate discovery fields.
 * @returns {void}
 */
function validateDiscovery(input) {
  if (typeof input.id != "string" || input.id.length == 0 ||
    typeof input.canonicalCommand != "string" || input.canonicalCommand.length == 0 ||
    input.canonicalCommand.includes("/") || input.canonicalCommand.includes("\\") || input.canonicalCommand.includes("\0") ||
    !isDenseArray(input.versionArguments) || !input.versionArguments.every(validArgument) ||
    !isEnvironment(input.environment) || !isSupportedTimeoutMs(input.timeoutMs) ||
    (input.override !== undefined && (typeof input.override != "string" || !path.isAbsolute(input.override) || input.override.includes("\0"))) ||
    (input.supportedVersion !== undefined && (!(input.supportedVersion instanceof RegExp) || input.supportedVersion.global || input.supportedVersion.sticky))) {
    invalidToolchain(`Toolchain discovery requires a canonical basename, absolute override, argument array, environment, and timeout from 1 through ${maximumTimeoutMs}ms.`,
      typeof input.id == "string" ? input.id : "toolchain")
  }
}

/**
 * Resolves one unambiguous canonical command from an explicit PATH.
 * @param {string} id - Toolchain ID.
 * @param {string} command - Canonical command.
 * @param {string} pathValue - Explicit PATH.
 * @returns {Promise<{executable: string, source: "canonical"}>} Exact executable.
 */
async function resolveCanonical(id, command, pathValue) {
  const matches = new Map()

  for (const directory of pathValue.split(path.delimiter)) {
    if (directory.length == 0 || !path.isAbsolute(directory)) continue
    const candidate = path.join(directory, command)

    try {
      const exact = await resolveExecutableFile(candidate)

      if (exact != undefined) matches.set(exact, exact)
    } catch {
      // A PATH candidate is absent or non-executable; discovery continues deterministically.
    }
  }

  if (matches.size == 0) {
    throw new SemantifoldDiagnostic({
      code: "TOOL_NOT_FOUND",
      command,
      language: id,
      message: `Canonical command '${command}' was not found as an executable on PATH.`
    })
  }
  if (matches.size > 1) {
    throw new SemantifoldDiagnostic({
      code: "TOOL_AMBIGUOUS",
      command,
      language: id,
      message: `Canonical command '${command}' resolves to multiple executables: ${[...matches.keys()].join(", ")}.`
    })
  }

  return {executable: /** @type {string} */ ([...matches.keys()][0]), source: /** @type {const} */ ("canonical")}
}

/**
 * Resolves one configured absolute executable.
 * @param {string} id - Toolchain ID.
 * @param {string} override - Absolute override.
 * @param {string} command - Canonical command.
 * @returns {Promise<string>} Exact executable path.
 */
async function resolveOverride(id, override, command) {
  /** @type {Error | undefined} */
  let cause

  try {
    const exact = await resolveExecutableFile(override)

    if (exact != undefined) return exact
  } catch (error) {
    cause = error instanceof Error ? error : undefined
  }

  throw new SemantifoldDiagnostic({
    cause,
    code: "TOOL_NOT_FOUND",
    command,
    executable: override,
    language: id,
    message: `Configured executable '${override}' is missing or not executable.`
  })
}

/**
 * Resolves one candidate to an executable regular file.
 * @param {string} candidate - Candidate path.
 * @returns {Promise<string | undefined>} Exact regular executable, if the file type is valid.
 */
async function resolveExecutableFile(candidate) {
  const exact = await realpath(candidate)
  const status = await stat(exact)

  if (!status.isFile()) return undefined
  await access(exact, fsConstants.X_OK)

  return exact
}

/**
 * Produces the minimal deterministic process environment.
 * @param {Readonly<Record<string, string | undefined>>} environment - Explicit inputs.
 * @returns {Readonly<Record<string, string>>} Normalized environment.
 */
export function deterministicEnvironment(environment = defaultEnvironment()) {
  const entries = environmentEntries(environment)

  if (entries == undefined) invalidToolchain("Process environment must be a plain own-property data record of string or undefined values.", "environment")
  /** @type {Record<string, string>} */
  const normalized = Object.create(null)

  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || key.includes("\0") || (value !== undefined && value.includes("\0"))) {
      invalidToolchain("Process environment contains an invalid key or value.", "environment")
    }
    if (value !== undefined) normalized[key] = value
  }
  normalized.LANG = "C.UTF-8"
  normalized.LC_ALL = "C.UTF-8"
  normalized.TZ = "UTC"
  normalized.PATH ??= "/usr/local/bin:/usr/bin:/bin"

  return Object.freeze(normalized)
}

/**
 * Retains only executable lookup from the ambient environment.
 * @returns {Readonly<Record<string, string | undefined>>} Minimal default environment.
 */
function defaultEnvironment() {
  return {PATH: process.env.PATH}
}

/**
 * Narrows stable fields from a version subprocess rejection.
 * @param {unknown} error - Process rejection.
 * @returns {{exitCode: number | undefined, signal: string | undefined, stderr: string, stdout: string}} Stable fields.
 */
function processErrorFields(error) {
  if (!error || typeof error != "object") return {exitCode: undefined, signal: undefined, stderr: "", stdout: ""}
  const value = /** @type {Record<string, unknown>} */ (error)

  return {
    exitCode: typeof value.code == "number" ? value.code : undefined,
    signal: typeof value.signal == "string" ? value.signal : undefined,
    stderr: typeof value.stderr == "string" ? value.stderr : "",
    stdout: typeof value.stdout == "string" ? value.stdout : ""
  }
}

/**
 * Checks one shell-free argument.
 * @param {unknown} value - Candidate argument.
 * @returns {value is string} Whether the argument is safe to pass directly.
 */
function validArgument(value) {
  return typeof value == "string" && !value.includes("\0")
}

/**
 * Checks explicit process-environment values.
 * @param {unknown} value - Candidate environment.
 * @returns {value is Readonly<Record<string, string | undefined>>} Whether entries are strings or undefined.
 */
function isEnvironment(value) {
  return environmentEntries(value) != undefined
}

/**
 * Detaches an explicit environment before canonical override lookup can yield.
 * @param {unknown} value - Candidate environment record.
 * @param {string} id - Toolchain identity.
 * @returns {Readonly<Record<string, string | undefined>>} Owned environment data.
 */
function snapshotEnvironment(value, id) {
  const entries = environmentEntries(value)

  if (entries == undefined) {
    invalidToolchain("Canonical toolchain environment must be a plain own-property data record of string or undefined values.", id)
  }
  /** @type {Record<string, string | undefined>} */
  const snapshot = Object.create(null)

  for (const [key, entry] of entries) snapshot[key] = entry

  return Object.freeze(snapshot)
}

/**
 * Reads only enumerable own data properties from an ordinary or null-prototype record.
 * @param {unknown} value - Candidate environment record.
 * @returns {[string, string | undefined][] | undefined} Detached entries when valid.
 */
function environmentEntries(value) {
  if (typeof value != "object" || value == null || Array.isArray(value)) return undefined

  try {
    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) return undefined
    /** @type {[string, string | undefined][]} */
    const entries = []

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key != "string") return undefined
      const descriptor = Object.getOwnPropertyDescriptor(value, key)

      if (descriptor == undefined || !descriptor.enumerable || !("value" in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value != "string")) return undefined
      entries.push([key, descriptor.value])
    }

    return entries
  } catch {
    return undefined
  }
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Throws a normalized discovery-configuration diagnostic.
 * @param {string} message - Failure detail.
 * @param {string} id - Toolchain identity.
 * @returns {never} Always throws.
 */
function invalidToolchain(message, id) {
  throw new SemantifoldDiagnostic({code: "INVALID_TOOLCHAIN", language: id, message})
}

/**
 * Deeply freezes canonical declarations and discovery results.
 * @template T
 * @param {T} value - Toolchain-owned value.
 * @returns {T} Frozen value.
 */
function deepFreeze(value) {
  if (!value || typeof value != "object" || Object.isFrozen(value)) return value

  for (const nested of Object.values(value)) deepFreeze(nested)

  return Object.freeze(value)
}
