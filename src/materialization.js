// @ts-check

import {chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile} from "node:fs/promises"
import path from "node:path"
import {findPortableArtifactPathConflict, isSafeArtifactPath, portableArtifactPathKey} from "./artifact-path.js"
import {createGeneratedArtifactSet} from "./artifacts.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"

/**
 * @typedef MaterializationFilesystem
 * @property {typeof chmod} chmod - Permission change.
 * @property {typeof lstat} lstat - Non-following status.
 * @property {typeof mkdir} mkdir - Directory creation.
 * @property {typeof mkdtemp} mkdtemp - Private staging directory creation.
 * @property {typeof readdir} readdir - Directory listing.
 * @property {typeof rename} rename - Atomic same-filesystem publication.
 * @property {typeof rm} rm - Private staging cleanup.
 * @property {typeof writeFile} writeFile - Exclusive artifact write.
 */

const defaultFilesystem = {chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile}

/**
 * Materializes one validated artifact set at a caller-selected absent destination.
 * @param {object} input - Create-only materialization request.
 * @param {import("./semantic/types.js").GeneratedArtifactSet} input.artifactSet - Complete generated set.
 * @param {string} input.destination - Absolute absent output directory below an existing real directory.
 * @returns {Promise<import("./semantic/types.js").ArtifactMaterializationResult>} Published path record.
 */
export async function materializeGeneratedArtifactSet(input) {
  return defaultMaterializer(input)
}

/**
 * Creates a materializer with narrow filesystem overrides for deterministic failure testing.
 * @param {Partial<MaterializationFilesystem>} [overrides] - Filesystem operation overrides.
 * @returns {(input: {artifactSet: import("./semantic/types.js").GeneratedArtifactSet, destination: string}) => Promise<import("./semantic/types.js").ArtifactMaterializationResult>} Materializer.
 */
export function createArtifactMaterializer(overrides = {}) {
  const filesystem = {...defaultFilesystem, ...overrides}

  return async function materialize({artifactSet, destination}) {
    const snapshot = snapshotArtifactSet(artifactSet)
    const paths = snapshot.artifacts.map(({path: artifactPath}) => artifactPath)
    const directories = artifactDirectories(paths)

    await preflightDestination(destination, filesystem)
    const parent = path.dirname(destination)
    const basename = path.basename(destination)
    /** @type {string | null} */
    let stage = null

    try {
      stage = await filesystem.mkdtemp(path.join(parent, `.${basename}.semantifold-stage-`))
      await filesystem.chmod(stage, 0o700)
      await requireRealDirectory(stage, filesystem, "Private materialization stage")
      for (const directory of directories) {
        const directoryPath = artifactFilesystemPath(stage, directory)

        await filesystem.mkdir(directoryPath, {mode: 0o700})
        await requireRealDirectory(directoryPath, filesystem, `Staged directory '${directory}'`)
      }
      for (const artifact of snapshot.artifacts) {
        const filename = artifactFilesystemPath(stage, artifact.path)

        await filesystem.writeFile(filename, artifact.content, {flag: "wx", mode: 0o600})
        const status = await filesystem.lstat(filename)

        if (status.isSymbolicLink() || !status.isFile()) {
          refuse(`Staged artifact '${artifact.path}' is not a regular file.`)
        }
      }
      await preflightDestination(destination, filesystem)
      await filesystem.rename(stage, destination)
      stage = null

      return Object.freeze({
        destination,
        paths: Object.freeze([...paths]),
        schema: /** @type {const} */ ("ArtifactMaterialization"),
        version: /** @type {const} */ (1)
      })
    } catch (error) {
      let cleanupError

      if (stage !== null) {
        try {
          await filesystem.rm(stage, {force: true, recursive: true})
        } catch (candidate) {
          cleanupError = candidate
        }
      }
      if (error instanceof SemantifoldDiagnostic && cleanupError === undefined) throw error
      const cause = cleanupError === undefined
        ? error
        : new AggregateError([error, cleanupError], "Materialization and private-stage cleanup both failed.")

      fail("Artifact-set materialization failed before publication.", cause)
    }
  }
}

const defaultMaterializer = createArtifactMaterializer()

/**
 * Revalidates an artifact set at the filesystem boundary and enforces portable path uniqueness.
 * @param {unknown} candidate - Untrusted artifact-set value.
 * @returns {import("./semantic/types.js").GeneratedArtifactSet} Detached validated snapshot.
 */
function snapshotArtifactSet(candidate) {
  if (!isPlainObject(candidate) || candidate.schema != "GeneratedArtifactSet" || candidate.version != 1 ||
    typeof candidate.entry != "string") refuse("Materialization requires a versioned generated artifact set.")
  const snapshot = createGeneratedArtifactSet({
    artifacts: candidate.artifacts,
    ...(candidate.metadata === undefined ? {} : {metadata: candidate.metadata}),
    target: candidate.target
  })

  if (snapshot.entry != candidate.entry) refuse("Artifact-set entry metadata does not match its generated entry.")
  const conflict = findPortableArtifactPathConflict(snapshot.artifacts.map(({path: artifactPath}) => artifactPath))

  if (conflict) {
    refuse(`Artifact path '${conflict.path}' has a ${conflict.kind} conflict${conflict.other ? ` with '${conflict.other}'` : ""}.`)
  }

  return snapshot
}

/**
 * Validates the absolute destination and every existing parent without following symlinks.
 * @param {string} destination - Proposed publication path.
 * @param {MaterializationFilesystem} filesystem - Filesystem operations.
 * @returns {Promise<void>} Completion after a side-effect-free preflight.
 */
async function preflightDestination(destination, filesystem) {
  if (typeof destination != "string" || !path.isAbsolute(destination) || path.normalize(destination) != destination ||
    destination == path.parse(destination).root || !isSafeArtifactPath(path.basename(destination))) {
    refuse("Materialization destination must be a normalized absolute path with a safe final component.")
  }
  const parent = path.dirname(destination)

  await requireRealDirectoryChain(parent, filesystem)
  if (await optionalStatus(destination, filesystem)) refuse(`Destination '${destination}' already exists.`)
  const destinationKey = portableArtifactPathKey(path.basename(destination))
  const siblings = await filesystem.readdir(parent)

  for (const sibling of siblings) {
    if (portableArtifactPathKey(sibling) == destinationKey) {
      refuse(`Destination '${destination}' has a portable case-fold collision with '${sibling}'.`)
    }
  }
}

/**
 * Rejects symlinks and non-directories at every component of an existing absolute directory.
 * @param {string} directory - Absolute existing directory.
 * @param {MaterializationFilesystem} filesystem - Filesystem operations.
 * @returns {Promise<void>} Completed validation.
 */
async function requireRealDirectoryChain(directory, filesystem) {
  const root = path.parse(directory).root
  const relative = path.relative(root, directory)
  let current = root

  await requireRealDirectory(current, filesystem, `Directory '${current}'`)
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    await requireRealDirectory(current, filesystem, `Directory '${current}'`)
  }
}

/**
 * Requires one path to be a non-symlink directory.
 * @param {string} directory - Directory path.
 * @param {MaterializationFilesystem} filesystem - Filesystem operations.
 * @param {string} subject - Diagnostic subject.
 * @returns {Promise<void>} Completed validation.
 */
async function requireRealDirectory(directory, filesystem, subject) {
  let status

  try {
    status = await filesystem.lstat(directory)
  } catch (error) {
    refuse(`${subject} is unavailable.`, error)
  }
  if (status.isSymbolicLink() || !status.isDirectory()) refuse(`${subject} must be a real directory.`)
}

/**
 * Returns lstat or null only for a missing path.
 * @param {string} candidate - Candidate path.
 * @param {MaterializationFilesystem} filesystem - Filesystem operations.
 * @returns {Promise<import("node:fs").Stats | null>} Status.
 */
async function optionalStatus(candidate, filesystem) {
  try {
    return await filesystem.lstat(candidate)
  } catch (error) {
    if (isNodeError(error) && error.code == "ENOENT") return null
    refuse(`Unable to inspect destination '${candidate}'.`, error)
  }
}

/**
 * Collects parent directories in deterministic creation order.
 * @param {string[]} paths - Validated artifact paths.
 * @returns {string[]} Parent directories in creation order.
 */
function artifactDirectories(paths) {
  const directories = new Set()

  for (const artifactPath of paths) {
    const components = artifactPath.split("/")

    for (let length = 1; length < components.length; length += 1) {
      directories.add(components.slice(0, length).join("/"))
    }
  }

  return [...directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length

    return depth || (left < right ? -1 : left > right ? 1 : 0)
  })
}

/**
 * Resolves a validated POSIX artifact path inside a private stage.
 * @param {string} root - Private stage root.
 * @param {string} artifactPath - POSIX artifact path.
 * @returns {string} Host path.
 */
function artifactFilesystemPath(root, artifactPath) {
  return path.join(root, ...artifactPath.split("/"))
}

/**
 * Tests for a plain object.
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, unknown>} Plain-object result.
 */
function isPlainObject(value) {
  return value != null && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Narrows a Node error with an error code.
 * @param {unknown} value - Candidate Node error.
 * @returns {value is Error & {code: unknown}} Narrowed error.
 */
function isNodeError(value) {
  return value instanceof Error && "code" in value
}

/**
 * Throws a create-only or path-safety refusal.
 * @param {string} message - Refusal detail.
 * @param {unknown} [cause] - Underlying failure.
 * @returns {never} Always throws.
 */
function refuse(message, cause) {
  throw new SemantifoldDiagnostic({
    ...(cause instanceof Error ? {cause} : {}),
    code: "MATERIALIZATION_REFUSED",
    language: "artifact",
    message
  })
}

/**
 * Throws a transactional staging failure.
 * @param {string} message - Failure detail.
 * @param {unknown} cause - Underlying failure.
 * @returns {never} Always throws.
 */
function fail(message, cause) {
  throw new SemantifoldDiagnostic({
    ...(cause instanceof Error ? {cause} : {}),
    code: "MATERIALIZATION_FAILED",
    language: "artifact",
    message
  })
}
