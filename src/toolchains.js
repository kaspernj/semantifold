// @ts-check

import {execFile} from "node:child_process"
import {constants as fsConstants} from "node:fs"
import {access, realpath} from "node:fs/promises"
import path from "node:path"
import {promisify} from "node:util"
import {SemantifoldDiagnostic} from "./diagnostic.js"

const execFileAsync = promisify(execFile)
const defaultTimeoutMs = 10_000

export const canonicalToolchains = deepFreeze({
  php: definition("php", "SEMANTIFOLD_PHP", ["--version"], /^PHP 8\./u),
  ruby: definition("ruby", "SEMANTIFOLD_RUBY", ["--version"], /^ruby 3\./u),
  node: definition("node", "SEMANTIFOLD_NODE", ["--version"], /^v24\./u),
  tsc: definition("tsc", "SEMANTIFOLD_TSC", ["--version"], /^Version 7\./u),
  javac: definition("javac", "SEMANTIFOLD_JAVAC", ["-version"], /^javac (?:1[7-9]|2[0-9])\./u),
  java: definition("java", "SEMANTIFOLD_JAVA", ["-version"], /^(?:openjdk|java) version "(?:1[7-9]|2[0-9])\./u)
})

/**
 * Discovers one repository-declared canonical toolchain.
 * @param {keyof typeof canonicalToolchains} id - Canonical toolchain ID.
 * @param {{environment?: Readonly<Record<string, string | undefined>>, override?: string, timeoutMs?: number}} [options] - Discovery options.
 * @returns {Promise<import("./semantic/types.js").DiscoveredToolchain>} Exact executable and version.
 */
export async function discoverCanonicalToolchain(id, options = {}) {
  if (!isPlainObject(options)) invalidToolchain("Canonical toolchain options must be an object.", String(id))
  const definition = canonicalToolchains[id]

  if (!definition) invalidToolchain(`Unknown canonical toolchain '${id}'.`, String(id))
  const configurationEnvironment = options.environment ?? process.env
  const environment = options.environment ?? defaultEnvironment()
  const configured = options.override ?? configurationEnvironment[definition.overrideEnvironmentVariable]

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
  const candidate = {
    canonicalCommand: input.canonicalCommand,
    environment: input.environment ?? defaultEnvironment(),
    id: input.id,
    override: input.override,
    supportedVersion: input.supportedVersion,
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
    versionArguments: input.versionArguments
  }

  validateDiscovery(candidate)
  const canonicalCommand = /** @type {string} */ (candidate.canonicalCommand)
  const environment = /** @type {Readonly<Record<string, string | undefined>>} */ (candidate.environment)
  const id = /** @type {string} */ (candidate.id)
  const override = /** @type {string | undefined} */ (candidate.override)
  const supportedVersion = /** @type {RegExp | undefined} */ (candidate.supportedVersion)
  const timeoutMs = /** @type {number} */ (candidate.timeoutMs)
  const versionArguments = /** @type {string[]} */ (candidate.versionArguments)
  const normalizedEnvironment = deterministicEnvironment(environment)
  const {executable, source} = override == undefined
    ? await resolveCanonical(id, canonicalCommand, normalizedEnvironment.PATH ?? "")
    : {executable: await resolveOverride(id, override, canonicalCommand), source: /** @type {const} */ ("override")}
  /** @type {{stdout: string, stderr: string}} */
  let result

  try {
    result = await execFileAsync(executable, versionArguments, {
      encoding: "utf8",
      env: normalizedEnvironment,
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs
    })
  } catch (error) {
    const processError = processErrorFields(error)
    const timedOut = processError.signal == "SIGTERM" || processError.killed

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
    versionArguments: [...versionArguments],
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
  const timeoutMs = typeof input.timeoutMs == "number" ? input.timeoutMs : Number.NaN

  if (typeof input.id != "string" || input.id.length == 0 ||
    typeof input.canonicalCommand != "string" || input.canonicalCommand.length == 0 ||
    input.canonicalCommand.includes("/") || input.canonicalCommand.includes("\\") || input.canonicalCommand.includes("\0") ||
    !Array.isArray(input.versionArguments) || !input.versionArguments.every(validArgument) ||
    !isEnvironment(input.environment) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    (input.override != undefined && (typeof input.override != "string" || !path.isAbsolute(input.override) || input.override.includes("\0"))) ||
    (input.supportedVersion != undefined && (!(input.supportedVersion instanceof RegExp) || input.supportedVersion.global || input.supportedVersion.sticky))) {
    invalidToolchain("Toolchain discovery requires a canonical basename, absolute override, argument array, environment, and positive timeout.",
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
      await access(candidate, fsConstants.X_OK)
      const exact = await realpath(candidate)

      matches.set(exact, exact)
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
  try {
    await access(override, fsConstants.X_OK)

    return await realpath(override)
  } catch (error) {
    throw new SemantifoldDiagnostic({
      cause: error instanceof Error ? error : undefined,
      code: "TOOL_NOT_FOUND",
      command,
      executable: override,
      language: id,
      message: `Configured executable '${override}' is missing or not executable.`
    })
  }
}

/**
 * Produces the minimal deterministic process environment.
 * @param {Readonly<Record<string, string | undefined>>} environment - Explicit inputs.
 * @returns {Readonly<Record<string, string>>} Normalized environment.
 */
export function deterministicEnvironment(environment = defaultEnvironment()) {
  if (!isEnvironment(environment)) invalidToolchain("Process environment must contain only string or undefined values.", "environment")
  /** @type {Record<string, string>} */
  const normalized = {}

  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || key.includes("\0") || (value != undefined && value.includes("\0"))) {
      invalidToolchain("Process environment contains an invalid key or value.", "environment")
    }
    if (value != undefined) normalized[key] = value
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
 * @returns {{exitCode: number | undefined, killed: boolean, signal: string | undefined, stderr: string, stdout: string}} Stable fields.
 */
function processErrorFields(error) {
  if (!error || typeof error != "object") return {exitCode: undefined, killed: false, signal: undefined, stderr: "", stdout: ""}
  const value = /** @type {Record<string, unknown>} */ (error)

  return {
    exitCode: typeof value.code == "number" ? value.code : undefined,
    killed: value.killed === true,
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
  return typeof value == "object" && value != null && !Array.isArray(value) &&
    Object.entries(value).every(([key, entry]) => typeof key == "string" && (entry == undefined || typeof entry == "string"))
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
