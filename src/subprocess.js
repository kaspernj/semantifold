// @ts-check

import {spawn} from "node:child_process"
import {StringDecoder} from "node:string_decoder"

const forcedTerminationGraceMs = 250
const retainedPipeGraceMs = 250
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
 * @returns {Promise<{stderr: string, stdout: string}>} Output after the owned process group closes.
 */
export function executeFileWithDeadline(input) {
  return executeFileWithDeadlineUsing(input, registerChildSpawn)
}

/**
 * Creates an executor whose spawn observation belongs only to that executor instance.
 * @param {object} dependencies - Internal lifecycle dependencies.
 * @param {(child: import("node:child_process").ChildProcess, listener: () => void) => void} dependencies.registerSpawnListener - Registers deadline initialization.
 * @returns {typeof executeFileWithDeadline} Owned subprocess executor.
 */
export function createExecuteFileWithDeadline({registerSpawnListener}) {
  return (input) => executeFileWithDeadlineUsing(input, registerSpawnListener)
}

/**
 * Executes with exact instance-owned spawn observation.
 * @param {Parameters<typeof executeFileWithDeadline>[0]} input - Process request.
 * @param {(child: import("node:child_process").ChildProcess, listener: () => void) => void} registerSpawnListener - Registers deadline initialization.
 * @returns {Promise<{stderr: string, stdout: string}>} Output after the owned process group closes.
 */
function executeFileWithDeadlineUsing({arguments: processArguments, cwd, environment, executable, maxBuffer, timeoutMs}, registerSpawnListener) {
  if (process.platform == "win32") {
    return Promise.reject(Object.assign(new Error("Owned process-tree termination is unavailable on this platform."), {
      code: "ENOTSUP",
      stderr: "",
      stdout: ""
    }))
  }

  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let deadlineTimer
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let forceTimer
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let pipeTimer
    /** @type {Error | undefined} */
    let launchError
    let deadlineExceeded = false
    let outputExceeded = false
    let settled = false
    const stderr = outputCapture(maxBuffer, () => terminateForOutputLimit())
    const stdout = outputCapture(maxBuffer, () => terminateForOutputLimit())
    const child = spawn(executable, [...processArguments], {
      cwd,
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    })
    const processGroupId = child.pid

    child.stderr.on("data", stderr.receive)
    child.stdout.on("data", stdout.receive)
    child.once("error", (error) => {
      launchError = error
    })
    registerSpawnListener(child, () => {
      if (processGroupId == undefined || !verifyOwnedProcessGroup(processGroupId)) {
        launchError = Object.assign(new Error("Spawned subprocess did not establish its required process group."), {code: "ENOTSUP"})
        child.kill("SIGKILL")
        return
      }

      deadlineTimer = setTimeout(() => {
        if (settled) return
        deadlineExceeded = true
        beginTermination(processGroupId)
      }, timeoutMs)
    })
    child.once("close", (code, signal) => {
      settled = true
      if (deadlineTimer != undefined) clearTimeout(deadlineTimer)
      if (forceTimer != undefined) clearTimeout(forceTimer)
      if (pipeTimer != undefined) clearTimeout(pipeTimer)
      const capturedStderr = stderr.finish()
      const capturedStdout = stdout.finish()

      if (launchError) {
        reject(Object.assign(launchError, {stderr: capturedStderr, stdout: capturedStdout}))
      } else if (outputExceeded) {
        reject(Object.assign(new Error(`Subprocess exceeded its ${maxBuffer}-byte output capture limit.`), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          signal,
          stderr: capturedStderr,
          stdout: capturedStdout
        }))
      } else if (deadlineExceeded) {
        const timeoutError = Object.assign(new Error("Subprocess exceeded its owned deadline."), {
          code,
          signal,
          stderr: capturedStderr,
          stdout: capturedStdout
        })

        deadlineFailures.add(timeoutError)
        reject(timeoutError)
      } else if (code != 0 || signal != null) {
        reject(Object.assign(new Error("Subprocess failed after launch."), {
          code,
          signal,
          stderr: capturedStderr,
          stdout: capturedStdout
        }))
      } else resolve({stderr: capturedStderr, stdout: capturedStdout})
    })

    /** Begins bounded termination after output capture crosses its limit. */
    function terminateForOutputLimit() {
      if (outputExceeded || settled) return
      outputExceeded = true
      if (processGroupId != undefined) beginTermination(processGroupId)
    }

    /**
     * Signals the owned group now and escalates if its inherited pipes remain open.
     * @param {number} ownedGroupId - Spawn-verified process-group identity.
     */
    function beginTermination(ownedGroupId) {
      signalOwnedProcessGroup(ownedGroupId, "SIGTERM")
      if (!settled && forceTimer == undefined) {
        forceTimer = setTimeout(() => {
          if (settled) return
          signalOwnedProcessGroup(ownedGroupId, "SIGKILL")
          pipeTimer = setTimeout(() => {
            if (settled) return
            child.stdout.destroy()
            child.stderr.destroy()
          }, retainedPipeGraceMs)
        }, forcedTerminationGraceMs)
      }
    }
  })
}

/**
 * Registers production deadline initialization on the child's real spawn event.
 * @param {import("node:child_process").ChildProcess} child - Exact spawned child.
 * @param {() => void} listener - Deadline initialization.
 */
function registerChildSpawn(child, listener) {
  child.once("spawn", listener)
}

/**
 * Creates one byte-bounded UTF-8 stream capture.
 * @param {number} maximumBytes - Maximum captured bytes.
 * @param {() => void} onExceeded - First-overflow callback.
 * @returns {{finish: () => string, receive: (chunk: Buffer) => void}} Capture callbacks.
 */
function outputCapture(maximumBytes, onExceeded) {
  const decoder = new StringDecoder("utf8")
  let byteLength = 0
  let content = ""
  let exceeded = false

  return {
    finish() {
      return content + decoder.end()
    },
    receive(chunk) {
      if (exceeded) return
      const remaining = maximumBytes - byteLength

      if (chunk.length > remaining) {
        if (remaining > 0) content += decoder.write(chunk.subarray(0, remaining))
        exceeded = true
        onExceeded()
        return
      }
      byteLength += chunk.length
      content += decoder.write(chunk)
    }
  }
}

/**
 * Verifies that the spawned child is the live leader of its distinct POSIX group.
 * @param {number} processGroupId - Spawn-returned child PID and required group ID.
 * @returns {boolean} Whether the owned group exists.
 */
function verifyOwnedProcessGroup(processGroupId) {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ESRCH") return false
    throw error
  }
}

/**
 * Signals only the verified process group created for the exact spawned child.
 * @param {number} processGroupId - Spawn-returned child PID and POSIX process-group ID.
 * @param {"SIGKILL" | "SIGTERM"} signal - Lifecycle signal.
 * @returns {void}
 */
function signalOwnedProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code == "ESRCH")) throw error
  }
}

/**
 * Reports whether this module's deadline timer initiated termination.
 * @param {unknown} error - Subprocess failure.
 * @returns {boolean} Whether the failure belongs to an owned deadline.
 */
export function exceededOwnedDeadline(error) {
  return typeof error == "object" && error != null && deadlineFailures.has(error)
}
