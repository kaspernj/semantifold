// @ts-check

import {SemantifoldDiagnostic} from "./diagnostic.js"
import {ProjectBuilder} from "./project-build.js"
import {ProjectBuildReporter} from "./project-reporter.js"
import {ProjectWatchCoordinator} from "./project-watch.js"
import {ProjectWatchReporter} from "./project-watch-reporter.js"

/**
 * Owns one strict command invocation while delegating durable build behavior.
 */
export class SemantifoldCli {
  /** @type {ProjectBuilder} */
  #builder
  /** @type {ProjectWatchCoordinator} */
  #coordinator
  /** @type {import("./project-reporter.js").WritableOutput} */
  #stdout
  /** @type {import("./project-reporter.js").WritableOutput} */
  #stderr

  /**
   * Creates an importable CLI lifecycle.
   * @param {{builder?: ProjectBuilder, coordinator?: ProjectWatchCoordinator, stderr?: import("./project-reporter.js").WritableOutput, stdout?: import("./project-reporter.js").WritableOutput}} [options] - Collaborators and sinks.
   */
  constructor(options = {}) {
    this.#builder = options.builder ?? new ProjectBuilder()
    this.#coordinator = options.coordinator ?? new ProjectWatchCoordinator({builder: this.#builder})
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
    const watchHint = arguments_[0] == "watch"
    let reporter = watchHint
      ? new ProjectWatchReporter({format: hintedFormat, stderr: this.#stderr, stdout: this.#stdout})
      : new ProjectBuildReporter({format: hintedFormat, stderr: this.#stderr, stdout: this.#stdout})

    try {
      const options = parseSemantifoldCliArguments(arguments_)
      const command = "command" in options ? options.command : "build"

      if (options.format != hintedFormat) {
        reporter = command == "watch"
          ? new ProjectWatchReporter({format: options.format, stderr: this.#stderr, stdout: this.#stdout})
          : new ProjectBuildReporter({format: options.format, stderr: this.#stderr, stdout: this.#stdout})
      }
      if (command == "watch") {
        const result = await this.#coordinator.run(options.projectPath, /** @type {ProjectWatchReporter} */ (reporter), {
          check: options.check
        })

        return result.status == "stopped" ? 0 : 1
      }
      const controller = new AbortController()
      const forwardSignal = () => controller.abort("Semantifold CLI received a termination signal.")

      if (options.check) {
        process.once("SIGINT", forwardSignal)
        process.once("SIGTERM", forwardSignal)
      }
      let result

      try {
        result = await this.#builder.build(options.projectPath, /** @type {ProjectBuildReporter} */ (reporter), {
          check: options.check,
          ...(options.check ? {signal: controller.signal} : {})
        })
      } finally {
        if (options.check) {
          process.removeListener("SIGINT", forwardSignal)
          process.removeListener("SIGTERM", forwardSignal)
        }
      }

      /** @type {ProjectBuildReporter} */ (reporter).succeeded(result)

      return 0
    } catch (error) {
      if (reporter instanceof ProjectWatchReporter) reporter.watchFailed(error)
      else reporter.failed(error)

      return 1
    }
  }
}

/**
 * Parses the intentionally narrow one-shot CLI grammar.
 * @param {readonly string[]} arguments_ - Arguments after the executable name.
 * @returns {Readonly<{check: boolean, format: "human" | "ndjson", projectPath: string}> | Readonly<{command: "watch", check: boolean, format: "human" | "ndjson", projectPath: string}>} Validated command options.
 */
export function parseSemantifoldCliArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length == 0 || arguments_[0] != "build" && arguments_[0] != "watch") {
    invalidArguments("Expected the command 'semantifold build' or 'semantifold watch'.")
  }
  const command = /** @type {"build" | "watch"} */ (arguments_[0])
  let format = /** @type {"human" | "ndjson"} */ ("human")
  let projectPath = "./semantifold.json"
  let projectSeen = false
  let ndjsonSeen = false
  let checkSeen = false

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]

    if (argument == "--check") {
      if (checkSeen) invalidArguments("Option '--check' may be supplied only once.")
      checkSeen = true
      continue
    }
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

  return command == "watch"
    ? Object.freeze({command, check: checkSeen, format, projectPath})
    : Object.freeze({check: checkSeen, format, projectPath})
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
