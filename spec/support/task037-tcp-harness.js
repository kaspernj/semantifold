// @ts-check

import {createServer} from "node:net"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {executeFileWithDeadline} from "../../src/subprocess.js"
import {deterministicEnvironment, discoverCanonicalToolchain} from "../../src/toolchains.js"

/**
 * Discovers every real command declared by the Task 037 acceptance class.
 * @returns {Promise<Record<string, import("../../src/semantic/types.js").DiscoveredToolchain>>} Exact tools.
 */
export async function discoverTask037Toolchains() {
  const entries = await Promise.all(["php82", "ruby", "node", "tsc", "javac", "java"].map(async (id) =>
    [id, await discoverCanonicalToolchain(/** @type {"php82" | "ruby" | "node" | "tsc" | "javac" | "java"} */ (id))]))

  return Object.fromEntries(entries)
}

/**
 * Runs one callback against a fresh event-driven loopback TCP server.
 * @template Result
 * @param {string | Uint8Array} bytes - Exact bytes sent before clean close.
 * @param {(port: number) => Promise<Result>} run - Client invocation.
 * @returns {Promise<{accepted: number, result: Result}>} Client result and connection count.
 */
export async function withTask037TcpServer(bytes, run) {
  const sockets = new Set()
  let accepted = 0
  let resolveClosed
  let rejectClosed
  const closed = new Promise((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject })
  const server = createServer((socket) => {
    accepted++
    sockets.add(socket)
    socket.once("error", rejectClosed)
    socket.once("close", () => { sockets.delete(socket); resolveClosed() })
    socket.end(typeof bytes == "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes))
  })

  try {
    await deadline(new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    }), "server listen")
    const address = server.address()

    if (!address || typeof address == "string") throw new Error("Task 037 server has no TCP address.")
    const result = await run(address.port)

    await deadline(closed, "client close")
    return {accepted, result}
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
}

/**
 * Reserves and closes one ephemeral loopback listener, yielding a genuine refused endpoint.
 * @returns {Promise<number>} Closed TCP port.
 */
export async function task037RefusedPort() {
  const server = createServer()

  await deadline(new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  }), "refused-port listen")
  const address = server.address()

  if (!address || typeof address == "string") throw new Error("Task 037 refused endpoint has no TCP address.")
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

/**
 * Writes a generated artifact set into one fresh lane.
 * @param {import("../../src/semantic/types.js").GeneratedArtifactSet} set - Generated artifacts.
 * @param {string} directory - Lane root.
 * @returns {Promise<void>} Completion.
 */
export async function writeTask037Artifacts(set, directory) {
  for (const artifact of set.artifacts) {
    const filename = join(directory, artifact.path)

    await mkdir(dirname(filename), {recursive: true})
    await writeFile(filename, String(artifact.content), "utf8")
  }
}

/**
 * Executes a real Ruby source or generated PHP set in a fresh owned directory.
 * @param {object} input - Execution request.
 * @param {string} input.executable - Exact discovered executable.
 * @param {string} input.entry - Entry filename relative to the lane.
 * @param {string} [input.source] - Optional source content.
 * @param {import("../../src/semantic/types.js").GeneratedArtifactSet} [input.set] - Optional generated set.
 * @returns {Promise<{stderr: string, stdout: string}>} Bounded process output.
 */
export async function executeTask037Client({executable, entry, source, set}) {
  const directory = await mkdtemp(join(tmpdir(), "semantifold-task037-runtime-"))

  try {
    if (source !== undefined) await writeFile(join(directory, entry), source, "utf8")
    if (set !== undefined) await writeTask037Artifacts(set, directory)
    return await executeFileWithDeadline({arguments: [entry], cwd: directory, environment: deterministicEnvironment(), executable,
      maxBuffer: 256 * 1024, timeoutMs: 10_000})
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

/**
 * Runs the real PHP syntax check for every generated artifact.
 * @param {import("../../src/semantic/types.js").GeneratedArtifactSet} set - Generated set.
 * @param {string} executable - Exact PHP executable.
 * @returns {Promise<void>} Completion.
 */
export async function lintTask037PhpArtifacts(set, executable) {
  const directory = await mkdtemp(join(tmpdir(), "semantifold-task037-php-lint-"))

  try {
    await writeTask037Artifacts(set, directory)
    for (const artifact of set.artifacts) {
      await executeFileWithDeadline({arguments: ["-l", artifact.path], cwd: directory, environment: deterministicEnvironment(), executable,
        maxBuffer: 64 * 1024, timeoutMs: 10_000})
    }
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

/**
 * Applies an explicit event deadline without introducing a scheduling sleep.
 * @template Result
 * @param {Promise<Result>} promise - Event promise.
 * @param {string} label - Failure label.
 * @returns {Promise<Result>} Bounded result.
 */
function deadline(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Task 037 ${label} deadline exceeded.`)), 10_000)

    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}
