// @ts-check

import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {lstat, open, realpath} from "node:fs/promises"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {SemantifoldProject} from "./project-manifest.js"

const snapshotAttempts = 2
/** @type {WeakMap<ProjectSnapshotBuilder, (event: Readonly<{attempt: number, pass: number, path: string}>) => Promise<void> | void>} */
const snapshotReadObservers = new WeakMap()

/**
 * Installs an internal deterministic read observer for real-filesystem snapshot specs.
 * This helper is intentionally not part of the package root API.
 * @param {ProjectSnapshotBuilder} builder - Snapshot builder instance.
 * @param {(event: Readonly<{attempt: number, pass: number, path: string}>) => Promise<void> | void} observer - Ordered read observer.
 * @returns {void}
 */
export function observeProjectSnapshotReads(builder, observer) {
  if (!(builder instanceof ProjectSnapshotBuilder) || typeof observer != "function") {
    throw new TypeError("Invalid project snapshot read observer.")
  }
  snapshotReadObservers.set(builder, observer)
}

/**
 * One complete immutable ordered source snapshot.
 */
export class ProjectSnapshot {
  /**
   * Constructs a trusted snapshot value.
   * @param {{hash: string, manifestText: string, projectId: string, sources: SnapshotSource[]}} value - Stable snapshot fields.
   */
  constructor(value) {
    this.hash = value.hash
    this.manifestText = value.manifestText
    this.projectId = value.projectId
    this.sources = Object.freeze(value.sources.map(source => Object.freeze({...source})))
    Object.freeze(this)
  }
}

/**
 * Reads one complete graph twice before exposing an immutable source snapshot.
 */
export class ProjectSnapshotBuilder {
  /**
   * Builds a stable snapshot with one bounded retry when the graph changes mid-read.
   * @param {SemantifoldProject} project - Validated immutable project.
   * @returns {Promise<ProjectSnapshot>} Stable complete snapshot.
   */
  async build(project) {
    if (!(project instanceof SemantifoldProject)) {
      snapshotFailure("INVALID_PROJECT_SNAPSHOT", "project", "Snapshot building requires a validated Semantifold project.")
    }
    let unstablePath = "semantifold.json"

    for (let attempt = 0; attempt < snapshotAttempts; attempt += 1) {
      try {
        const first = await readProjectGraph(project, this, attempt + 1, 1)
        const second = await readProjectGraph(project, this, attempt + 1, 2)
        const difference = graphDifference(first, second, project)

        if (difference !== null) {
          unstablePath = difference
          continue
        }
        const finalDifference = await graphStateDifference(project, second)

        if (finalDifference !== null) {
          unstablePath = finalDifference
          continue
        }
        const manifestText = decodeUtf8(first.manifestBytes, "semantifold.json", project.id)

        if (manifestText != project.manifestText) {
          snapshotFailure("UNSTABLE_PROJECT_SNAPSHOT", project.id,
            "Project manifest changed after it was validated; restart the build from the new manifest.", manifestLocation())
        }
        const sources = project.sources.map((source, index) => ({
          id: source.id,
          language: source.language,
          path: source.path,
          source: decodeUtf8(first.sourceBytes[index], source.path, project.id)
        }))

        return new ProjectSnapshot({
          hash: snapshotHash(first.manifestBytes, sources),
          manifestText,
          projectId: project.id,
          sources
        })
      } catch (error) {
        if (!(error instanceof UnstableSnapshotRead)) throw error
        unstablePath = error.path
      }
    }

    return snapshotFailure("UNSTABLE_PROJECT_SNAPSHOT", project.id,
      "Project manifest or source files changed repeatedly while the snapshot was loading.", sourceLocation(unstablePath))
  }
}

/**
 * Reads every declared file in stable manifest order.
 * @param {SemantifoldProject} project - Validated project.
 * @param {ProjectSnapshotBuilder} builder - Active builder.
 * @param {number} attempt - One-based bounded attempt.
 * @param {number} pass - One-based verification pass.
 * @returns {Promise<ProjectGraphRead>} Complete graph bytes.
 */
async function readProjectGraph(project, builder, attempt, pass) {
  const manifest = await readStableRegularFile(project.manifestPath, "semantifold.json", project.id, true)

  await snapshotReadObservers.get(builder)?.(Object.freeze({attempt, pass, path: "semantifold.json"}))
  /** @type {Buffer[]} */
  const sourceBytes = []
  /** @type {string[]} */
  const sourceIdentities = []
  /** @type {string[]} */
  const sourceStates = []
  const uniqueSourceIdentities = new Set()

  for (const source of project.sources) {
    const read = await readStableRegularFile(source.absolutePath, source.path, project.id, false)

    if (uniqueSourceIdentities.has(read.identity)) {
      snapshotFailure("PROJECT_SOURCE_ALIAS", project.id,
        "Project source paths must not alias the same file.", sourceLocation(source.path))
    }
    uniqueSourceIdentities.add(read.identity)
    sourceBytes.push(read.bytes)
    sourceIdentities.push(read.identity)
    sourceStates.push(read.state)
    await snapshotReadObservers.get(builder)?.(Object.freeze({attempt, pass, path: source.path}))
  }

  return {
    manifestBytes: manifest.bytes,
    manifestIdentity: manifest.identity,
    manifestState: manifest.state,
    sourceBytes,
    sourceIdentities,
    sourceStates
  }
}

/**
 * Reads exact bytes through one descriptor while detecting replacement or mutation.
 * @param {string} filename - Canonical absolute path.
 * @param {string} displayPath - Project-relative diagnostic path.
 * @param {string} projectId - Project identity.
 * @param {boolean} manifest - Whether this is the project manifest.
 * @returns {Promise<StableFileRead>} Stable bytes and filesystem identity.
 */
async function readStableRegularFile(filename, displayPath, projectId, manifest) {
  let handle

  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const beforePath = await realpath(filename)
    const before = await handle.stat({bigint: true})
    const beforeEntry = await lstat(filename, {bigint: true})

    if (!before.isFile() || !beforeEntry.isFile() || beforePath != filename || !sameFileIdentity(before, beforeEntry)) {
      throw new UnstableSnapshotRead(displayPath)
    }
    const bytes = await handle.readFile()
    const after = await handle.stat({bigint: true})
    const afterPath = await realpath(filename)
    const afterEntry = await lstat(filename, {bigint: true})

    if (!after.isFile() || !afterEntry.isFile() || afterPath != filename || !sameFileState(before, after) ||
      !sameFileIdentity(after, afterEntry) || BigInt(bytes.byteLength) != after.size) {
      throw new UnstableSnapshotRead(displayPath)
    }

    return {
      bytes,
      identity: `${String(before.dev)}:${String(before.ino)}`,
      state: stableFileState(before)
    }
  } catch (error) {
    if (error instanceof UnstableSnapshotRead) throw error
    return snapshotFailure(manifest ? "PROJECT_MANIFEST_READ_FAILED" : "PROJECT_SOURCE_READ_FAILED", projectId,
      manifest ? "Project manifest could not be read into a stable snapshot." : "Declared source could not be read into a stable snapshot.",
      sourceLocation(displayPath), error)
  } finally {
    await handle?.close()
  }
}

/**
 * Compares descriptor state around one read.
 * @param {import("node:fs").BigIntStats} left - State before the read.
 * @param {import("node:fs").BigIntStats} right - State after the read.
 * @returns {boolean} Whether identity and mutation-sensitive metadata agree.
 */
function sameFileState(left, right) {
  return left.dev == right.dev && left.ino == right.ino && left.size == right.size &&
    left.mtimeNs == right.mtimeNs && left.ctimeNs == right.ctimeNs
}

/**
 * Compares the path entry with the opened descriptor identity.
 * @param {import("node:fs").BigIntStats} left - Open descriptor or path state.
 * @param {import("node:fs").BigIntStats} right - Open descriptor or path state.
 * @returns {boolean} Whether both identify the same filesystem node.
 */
function sameFileIdentity(left, right) {
  return left.dev == right.dev && left.ino == right.ino
}

/**
 * Serializes mutation-sensitive descriptor state for complete-graph comparison.
 * @param {import("node:fs").BigIntStats} status - Stable descriptor state.
 * @returns {string} Internal state identity.
 */
function stableFileState(status) {
  return [status.dev, status.ino, status.size, status.mtimeNs, status.ctimeNs].map(String).join(":")
}

/**
 * Locates the first byte difference between two complete graph reads.
 * @param {ProjectGraphRead} left - First graph.
 * @param {ProjectGraphRead} right - Second graph.
 * @param {SemantifoldProject} project - Ordered path authority.
 * @returns {string | null} Project-relative changed path, or null.
 */
function graphDifference(left, right, project) {
  if (left.manifestIdentity != right.manifestIdentity || left.manifestState != right.manifestState ||
    !left.manifestBytes.equals(right.manifestBytes)) {
    return "semantifold.json"
  }
  if (left.sourceBytes.length != right.sourceBytes.length) return "semantifold.json"
  const index = left.sourceBytes.findIndex((bytes, sourceIndex) =>
    left.sourceIdentities[sourceIndex] != right.sourceIdentities[sourceIndex] ||
    left.sourceStates[sourceIndex] != right.sourceStates[sourceIndex] || !bytes.equals(right.sourceBytes[sourceIndex]))

  return index == -1 ? null : project.sources[index].path
}

/**
 * Revalidates every path entry after the final complete graph read.
 * @param {SemantifoldProject} project - Ordered path authority.
 * @param {ProjectGraphRead} graph - Final complete graph read.
 * @returns {Promise<string | null>} First changed project-relative path, or null.
 */
async function graphStateDifference(project, graph) {
  const entries = [{
    filename: project.manifestPath,
    identity: graph.manifestIdentity,
    path: "semantifold.json",
    state: graph.manifestState
  }, ...project.sources.map((source, index) => ({
    filename: source.absolutePath,
    identity: graph.sourceIdentities[index],
    path: source.path,
    state: graph.sourceStates[index]
  }))]

  for (const entry of entries) {
    try {
      const status = await lstat(entry.filename, {bigint: true})
      const exact = await realpath(entry.filename)

      if (!status.isFile() || exact != entry.filename || `${String(status.dev)}:${String(status.ino)}` != entry.identity ||
        stableFileState(status) != entry.state) return entry.path
    } catch (_error) {
      return entry.path
    }
  }

  return null
}

/**
 * Computes a framed deterministic SHA-256 identity over exact manifest and ordered source inputs.
 * @param {Buffer} manifestBytes - Exact manifest bytes.
 * @param {readonly SnapshotSource[]} sources - Ordered decoded sources.
 * @returns {string} Lowercase SHA-256 digest.
 */
function snapshotHash(manifestBytes, sources) {
  const hash = createHash("sha256")

  updateHash(hash, "SemantifoldProjectSnapshot/1")
  updateHash(hash, manifestBytes)
  for (const source of sources) {
    updateHash(hash, source.id)
    updateHash(hash, source.path)
    updateHash(hash, source.language)
    updateHash(hash, source.source)
  }

  return hash.digest("hex")
}

/**
 * Adds one length-framed field to a content hash.
 * @param {import("node:crypto").Hash} hash - Active hash.
 * @param {string | Buffer} value - Field bytes.
 * @returns {void}
 */
function updateHash(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8")
  const length = Buffer.alloc(8)

  length.writeBigUInt64BE(BigInt(bytes.byteLength))
  hash.update(length)
  hash.update(bytes)
}

/**
 * Decodes strict UTF-8 for parser inputs.
 * @param {Buffer} bytes - Exact file bytes.
 * @param {string} filename - Project-relative filename.
 * @param {string} projectId - Project identity.
 * @returns {string} Decoded source.
 */
function decodeUtf8(bytes, filename, projectId) {
  try {
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes)
  } catch (error) {
    return snapshotFailure("INVALID_PROJECT_SOURCE_ENCODING", projectId,
      "Project manifests and sources must be valid UTF-8.", sourceLocation(filename), error)
  }
}

/** Internal marker for a read that may safely use the bounded retry. */
class UnstableSnapshotRead extends Error {
  /**
   * Creates an internal retry marker.
   * @param {string} path - Project-relative unstable path.
   */
  constructor(path) {
    super("Unstable project snapshot read.")
    this.path = path
  }
}

/**
 * Creates the stable manifest boundary location.
 * @returns {import("./semantic/types.js").SourceLocation} Manifest location.
 */
function manifestLocation() {
  return sourceLocation("semantifold.json")
}

/**
 * Creates a stable project-relative file location.
 * @param {string} filename - Project-relative filename.
 * @returns {import("./semantic/types.js").SourceLocation} Start-of-file location.
 */
function sourceLocation(filename) {
  const point = {column: 1, line: 1, offset: 0}

  return {end: point, filename, start: point}
}

/**
 * Throws one stable snapshot diagnostic.
 * @param {string} code - Stable diagnostic code.
 * @param {string} projectId - Project identity.
 * @param {string} message - Stable detail.
 * @param {import("./semantic/types.js").SourceLocation} [location] - Project-relative location.
 * @param {unknown} [error] - Preserved cause.
 * @returns {never} Always throws.
 */
function snapshotFailure(code, projectId, message, location, error) {
  throw new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code,
    language: projectId,
    location,
    message
  })
}

/**
 * @typedef SnapshotSource
 * @property {string} id - Stable semantic module identity.
 * @property {import("./semantic/types.js").SemanticLanguage} language - Registered source language.
 * @property {string} path - Project-relative source path.
 * @property {string} source - Exact decoded source text.
 */

/**
 * @typedef ProjectGraphRead
 * @property {Buffer} manifestBytes - Exact manifest bytes.
 * @property {string} manifestIdentity - Stable manifest device/inode identity.
 * @property {string} manifestState - Stable manifest mutation-sensitive state.
 * @property {Buffer[]} sourceBytes - Exact source bytes in manifest order.
 * @property {string[]} sourceIdentities - Stable source device/inode identities in manifest order.
 * @property {string[]} sourceStates - Stable source mutation-sensitive states in manifest order.
 */

/**
 * @typedef StableFileRead
 * @property {Buffer} bytes - Exact stable file bytes.
 * @property {string} identity - Stable device/inode identity.
 * @property {string} state - Stable mutation-sensitive file state.
 */
