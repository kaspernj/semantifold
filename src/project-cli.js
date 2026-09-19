// @ts-check

import {SemantifoldDiagnostic} from "./diagnostic.js"
import {ProjectBuilder} from "./project-build.js"
import {ProjectBuildReporter} from "./project-reporter.js"

/**
 * Owns one strict command invocation while delegating durable build behavior.
 */
export class SemantifoldCli {
  /** @type {ProjectBuilder} */
  #builder
  /** @type {import("./project-reporter.js").WritableOutput} */
  #stdout
  /** @type {import("./project-reporter.js").WritableOutput} */
  #stderr

  /**
   * Creates an importable CLI lifecycle.
   * @param {{builder?: ProjectBuilder, stderr?: import("./project-reporter.js").WritableOutput, stdout?: import("./project-reporter.js").WritableOutput}} [options] - Collaborators and sinks.
   */
  constructor(options = {}) {
    this.#builder = options.builder ?? new ProjectBuilder()
    this.#stdout = options.stdout ?? process.stdout
    this.#stderr = options.stderr ?? process.stderr
  }

  /**
   * Runs one command without mutating process exit state.
   * @param {readonly string[]} arguments_ - Arguments after the executable name.
   * @returns {Promise<0 | 1>} Exact process status.
   */
  async run(arguments_) {
    const hintedFormat = arguments_.includes("--ndjson") ? "ndjson" : "human"
    let reporter = new ProjectBuildReporter({format: hintedFormat, stderr: this.#stderr, stdout: this.#stdout})

    try {
      const options = parseSemantifoldCliArguments(arguments_)

      if (options.format != hintedFormat) {
        reporter = new ProjectBuildReporter({format: options.format, stderr: this.#stderr, stdout: this.#stdout})
      }
      const result = await this.#builder.build(options.projectPath, reporter)

      reporter.succeeded(result)

      return 0
    } catch (error) {
      reporter.failed(error)

      return 1
    }
  }
}

/**
 * Parses the intentionally narrow one-shot CLI grammar.
 * @param {readonly string[]} arguments_ - Arguments after the executable name.
 * @returns {Readonly<{format: "human" | "ndjson", projectPath: string}>} Validated command options.
 */
export function parseSemantifoldCliArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length == 0 || arguments_[0] != "build") {
    invalidArguments("Expected the command 'semantifold build'.")
  }
  let format = /** @type {"human" | "ndjson"} */ ("human")
  let projectPath = "./semantifold.json"
  let projectSeen = false
  let ndjsonSeen = false

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]

    if (argument == "--ndjson") {
      if (ndjsonSeen) invalidArguments("Option '--ndjson' may be supplied only once.")
      ndjsonSeen = true
      format = "ndjson"
      continue
    }
    if (argument == "--project") {
      if (projectSeen) invalidArguments("Option '--project' may be supplied only once.")
      const value = arguments_[index + 1]

      if (typeof value != "string" || value.length == 0 || value.startsWith("--")) {
        invalidArguments("Option '--project' requires one path value.")
      }
      projectSeen = true
      projectPath = value
      index += 1
      continue
    }
    invalidArguments(`Unknown command argument '${argument}'.`)
  }

  return Object.freeze({format, projectPath})
}

/**
 * Throws one stable CLI grammar diagnostic.
 * @param {string} message - Failure detail.
 * @returns {never} Always throws.
 */
function invalidArguments(message) {
  throw new SemantifoldDiagnostic({
    code: "INVALID_CLI_ARGUMENTS",
    language: "cli",
    message
  })
}
