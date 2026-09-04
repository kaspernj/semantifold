// @ts-check

import {execFile} from "node:child_process"

const forcedTerminationGraceMs = 250
const deadlineFailures = new WeakSet()

/**
 * Executes one exact file while owning its complete bounded lifecycle.
 * @param {object} input - Process request.
 * @param {readonly string[]} input.arguments - Exact argument array.
 * @param {string} [input.cwd] - Working directory.
 * @param {Readonly<Record<string, string>>} input.environment - Exact environment.
 * @param {string} input.executable - Exact executable path.
 * @param {number} input.maxBuffer - Maximum bytes captured per output stream.
 * @param {number} input.timeoutMs - Deadline before termination begins.
 * @returns {Promise<{stderr: string, stdout: string}>} Output after the direct child closes.
 */
export function executeFileWithDeadline({arguments: processArguments, cwd, environment, executable, maxBuffer, timeoutMs}) {
  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let deadlineTimer
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let forceTimer
    let deadlineExceeded = false
    let settled = false
    const child = execFile(executable, [...processArguments], {
      cwd,
      encoding: "utf8",
      env: environment,
      maxBuffer
    }, (error, stdout, stderr) => {
      settled = true
      if (deadlineTimer != undefined) clearTimeout(deadlineTimer)
      if (forceTimer != undefined) clearTimeout(forceTimer)

      if (error) {
        const processError = Object.assign(error, {stderr, stdout})

        if (deadlineExceeded) deadlineFailures.add(processError)
        reject(processError)
      } else if (deadlineExceeded) {
        const timeoutError = Object.assign(new Error("Subprocess exceeded its owned deadline."), {
          code: child.exitCode,
          signal: child.signalCode,
          stderr,
          stdout
        })

        deadlineFailures.add(timeoutError)
        reject(timeoutError)
      } else resolve({stderr, stdout})
    })

    if (!settled) {
      deadlineTimer = setTimeout(() => {
        if (settled) return
        deadlineExceeded = true
        child.kill("SIGTERM")
        if (!settled) {
          forceTimer = setTimeout(() => {
            if (!settled) child.kill("SIGKILL")
          }, forcedTerminationGraceMs)
        }
      }, timeoutMs)
    }
  })
}

/**
 * Reports whether this module's deadline timer initiated termination.
 * @param {unknown} error - Subprocess failure.
 * @returns {boolean} Whether the failure belongs to an owned deadline.
 */
export function exceededOwnedDeadline(error) {
  return typeof error == "object" && error != null && deadlineFailures.has(error)
}
