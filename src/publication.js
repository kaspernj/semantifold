// @ts-check

import {createHash, randomUUID} from "node:crypto"
import {constants} from "node:fs"
import {lstat, mkdir, open, readFile, readdir, realpath, rename, rm} from "node:fs/promises"
import path from "node:path"
import {findPortableArtifactPathConflict, isSafeArtifactPath} from "./artifact-path.js"
import {createGeneratedArtifactSet} from "./artifacts.js"
import {finalizeByteMapping} from "./binary-mapping.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "./mapping.js"

const activePointerName = "active-generation.json"
const generationsName = "generations"
const journalName = ".semantifold-publication-journal"
const identityPattern = /^[a-z][a-z0-9-]*$/u
const generationPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const buildRolePattern = /^[a-z][a-z0-9-]*$/u
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\u0020-\u007e]+)?$/u
const targetRoles = new Set(["application", "binary", "text"])
const publicationBoundaries = new Set([
  "after-stage",
  "before-pointer-replace",
  "after-pointer-replace",
  "before-cleanup",
  "before-journal-remove"
])
/** @type {WeakMap<GeneratedArtifactPublisher, {boundary: string, error: Error}>} */
const injectedPublicationFailures = new WeakMap()
/** @type {WeakMap<GeneratedArtifactPublisher, (operation: string) => void>} */
const publicationFilesystemObservers = new WeakMap()

/**
 * Installs one internal, one-shot deterministic failure used by real-filesystem interruption specs.
 * This helper is intentionally not part of the package root API.
 * @param {GeneratedArtifactPublisher} publisher - Publisher instance.
 * @param {"after-stage" | "before-pointer-replace" | "after-pointer-replace" | "before-cleanup" | "before-journal-remove"} boundary - Exact lifecycle boundary.
 * @param {Error} error - Injected failure.
 * @returns {void}
 */
export function injectPublicationFailure(publisher, boundary, error) {
  if (!(publisher instanceof GeneratedArtifactPublisher) || !publicationBoundaries.has(boundary) || !(error instanceof Error)) {
    throw new TypeError("Invalid publication failure injection.")
  }
  injectedPublicationFailures.set(publisher, {boundary, error})
}

/**
 * Installs an internal deterministic filesystem-operation observer for durability specs.
 * This helper is intentionally not part of the package root API.
 * @param {GeneratedArtifactPublisher} publisher - Publisher instance.
 * @param {(operation: string) => void} observer - Synchronous operation observer.
 * @returns {void}
 */
export function observePublicationFilesystem(publisher, observer) {
  if (!(publisher instanceof GeneratedArtifactPublisher) || typeof observer != "function") {
    throw new TypeError("Invalid publication filesystem observer.")
  }
  publicationFilesystemObservers.set(publisher, observer)
}

/**
 * Owns transactional publication in one dedicated directory beneath a canonical project root.
 */
export class GeneratedArtifactPublisher {
  /** @type {string} */
  #projectId
  /** @type {string} */
  #projectRoot
  /** @type {string} */
  #publicationRoot
  /** @type {readonly string[]} */
  #sourceRoots
  /** @type {Promise<void>} */
  #publicationTail = Promise.resolve()

  /**
   * Creates a project-scoped publisher without touching the filesystem.
   * @param {object} options - Publisher identity and owned paths.
   * @param {string} options.projectId - Stable lowercase project identity.
   * @param {string} options.projectRoot - Canonical absolute project root.
   * @param {string} options.publicationRoot - Canonical absolute publisher-owned directory beneath the project root.
   * @param {readonly string[]} options.sourceRoots - Canonical absolute project source roots kept disjoint from publication.
   */
  constructor(options) {
    if (!isPlainObject(options)) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", "publication", "Publisher options must be a plain object.")
    }
    const {projectId, projectRoot, publicationRoot, sourceRoots} = options

    if (!identityPattern.test(projectId ?? "")) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", "publication", "Project identity must be a stable lowercase ID.")
    }
    if (!isCanonicalAbsolutePath(projectRoot) || !isCanonicalAbsolutePath(publicationRoot) ||
      !isStrictPathDescendant(projectRoot, publicationRoot)) {
      publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
        "Project and publication roots must be canonical absolute paths with publication strictly beneath the project root.")
    }
    if (!isDenseArray(sourceRoots) || sourceRoots.length == 0) {
      publicationFailure("INVALID_PUBLICATION_ROOT", projectId, "Source roots must be a non-empty array of canonical absolute paths.")
    }
    /** @type {string[]} */
    const validatedSourceRoots = []

    for (let index = 0; index < sourceRoots.length; index += 1) {
      const sourceRoot = sourceRoots[index]

      if (!isCanonicalAbsolutePath(sourceRoot)) {
        publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
          "Source roots must be a non-empty array of canonical absolute paths.")
      }
      if (!isPathWithin(projectRoot, sourceRoot)) {
        publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
          "Source roots must remain within the canonical project root.")
      }
      if (pathsOverlap(publicationRoot, sourceRoot)) {
        publicationFailure("PUBLICATION_SOURCE_OVERLAP", projectId,
          "Publication root and source roots must be disjoint.")
      }
      validatedSourceRoots.push(sourceRoot)
    }

    this.#projectId = projectId
    this.#projectRoot = projectRoot
    this.#publicationRoot = publicationRoot
    this.#sourceRoots = Object.freeze(validatedSourceRoots)
  }

  /**
   * Stages, validates, and publishes one complete immutable project generation.
   * Calls on one publisher instance are serialized in invocation order.
   * @param {import("./semantic/types.js").PublicationRequest} request - Complete publication request.
   * @returns {Promise<import("./semantic/types.js").PublishedGeneration>} Committed immutable snapshot.
   */
  publish(request) {
    /** @type {(value: import("./semantic/types.js").PublishedGeneration) => void} */
    let resolveResult
    /** @type {(reason?: unknown) => void} */
    let rejectResult
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const operation = this.#publicationTail.then(async () => {
      try {
        resolveResult(await this.#publish(request))
      } catch (error) {
        rejectResult(error)
      }
    })

    this.#publicationTail = operation.catch(() => {})

    return result
  }

  /**
   * Resolves the active pointer exactly once and verifies the referenced immutable generation.
   * @returns {Promise<import("./semantic/types.js").PublishedGeneration>} Verified pointer-once snapshot.
   */
  async resolveActive() {
    await this.#prepareRoot()
    const pointerPath = path.join(this.#publicationRoot, activePointerName)
    const pointer = await readActivePointer(pointerPath, this.#projectId, false)

    if (!pointer) publicationFailure("ACTIVE_GENERATION_MISSING", this.#projectId, "No active generation has been published.")
    const generation = await verifyPublishedGeneration(this.#publicationRoot, this.#projectId, pointer, false)
    const cleanupPending = await hasCommittedCleanupJournal(this.#publicationRoot, this.#projectId, pointer.generationId)

    return publishedGeneration(this.#publicationRoot, generation.manifest, cleanupPending)
  }

  /**
   * Performs one serialized publication.
   * @param {import("./semantic/types.js").PublicationRequest} request - Complete request.
   * @returns {Promise<import("./semantic/types.js").PublishedGeneration>} Publication result.
   */
  async #publish(request) {
    const validated = validatePublicationRequest(request, this.#projectId)

    await this.#prepareRoot()
    await reconcilePublication(this.#publicationRoot, this.#projectId, this)
    await verifyAtomicReplacement(this.#publicationRoot, this.#projectId)
    await validateExistingPointer(this.#publicationRoot, this.#projectId)

    const generationPath = path.join(this.#publicationRoot, generationsName, validated.generationId)
    const manifestPath = path.join(generationPath, "manifest.json")
    const tempPointerName = `.active-generation.${validated.generationId}.tmp`
    const tempPointerPath = path.join(this.#publicationRoot, tempPointerName)
    const journalPath = path.join(this.#publicationRoot, journalName, `${validated.generationId}.json`)
    let committed = false
    let journalCreated = false
    let generationCreated = false
    let tempPointerCreated = false
    let failureCode = "PUBLICATION_STAGE_WRITE_FAILED"

    try {
      await assertAbsent(generationPath, "PUBLICATION_UNOWNED_CONFLICT", this.#projectId,
        "Generation identity is already owned or ambiguous.")
      await assertAbsent(tempPointerPath, "PUBLICATION_UNOWNED_CONFLICT", this.#projectId,
        "Temporary active pointer path is already owned or ambiguous.")
      await assertAbsent(journalPath, "PUBLICATION_UNOWNED_CONFLICT", this.#projectId,
        "Publication journal identity is already owned or ambiguous.")
      const journal = {
        generationId: validated.generationId,
        projectId: this.#projectId,
        schema: "SemantifoldPublicationJournal",
        tempPointer: tempPointerName,
        version: 1
      }

      await writeSyncedFile(journalPath, serializeJson(journal), "wx")
      journalCreated = true
      await syncDirectory(path.dirname(journalPath))
      await mkdir(generationPath, {mode: 0o700})
      generationCreated = true
      await syncDirectory(path.dirname(generationPath))

      /** @type {import("./semantic/types.js").GenerationTargetManifest[]} */
      const targetManifests = []

      for (const target of validated.targets) {
        targetManifests.push(await stageTarget(generationPath, target, this.#projectId))
      }
      reachPublicationBoundary(this, "after-stage")
      const manifestCandidate = /** @type {import("./semantic/types.js").GenerationManifest} */ ({
        generationId: validated.generationId,
        projectId: this.#projectId,
        schema: /** @type {const} */ ("SemantifoldGenerationManifest"),
        targets: targetManifests,
        version: /** @type {const} */ (1)
      })
      const manifestBytes = serializeJson(manifestCandidate)
      const manifest = validateGenerationManifest(JSON.parse(manifestBytes.toString("utf8")), this.#projectId,
        validated.generationId)

      await writeSyncedFile(manifestPath, manifestBytes, "wx")
      await syncTreeDirectories(generationPath)
      await verifyManifestFiles(generationPath, manifest, this.#projectId)
      failureCode = "PUBLICATION_POINTER_FAILED"

      const pointer = {
        generationId: validated.generationId,
        manifestHash: sha256(manifestBytes),
        projectId: this.#projectId,
        schema: "SemantifoldActiveGeneration",
        version: 1
      }

      await writeSyncedFile(tempPointerPath, serializeJson(pointer), "wx", () => {
        tempPointerCreated = true
      })
      reachPublicationBoundary(this, "before-pointer-replace")
      await rename(tempPointerPath, path.join(this.#publicationRoot, activePointerName))
      tempPointerCreated = false
      committed = true
      reachPublicationBoundary(this, "after-pointer-replace")
      await syncDirectory(this.#publicationRoot)

      let cleanupPending = false

      try {
        reachPublicationBoundary(this, "before-cleanup")
        await removeJournalOwnedState({
          journalPath,
          projectId: this.#projectId,
          publicationRoot: this.#publicationRoot,
          publisher: this
        })
      } catch (_error) {
        cleanupPending = true
      }

      return publishedGeneration(this.#publicationRoot, deepFreeze(manifest), cleanupPending)
    } catch (error) {
      if (!committed) {
        try {
          await removeJournalOwnedState({
            ...(generationCreated ? {candidatePath: generationPath} : {}),
            ...(journalCreated ? {journalPath} : {}),
            projectId: this.#projectId,
            publicationRoot: this.#publicationRoot,
            publisher: this,
            ...(tempPointerCreated ? {temporaryPointerPath: tempPointerPath} : {})
          })
        } catch (cleanupError) {
          if (cleanupError instanceof SemantifoldDiagnostic) throw cleanupError
          publicationFailure("PUBLICATION_RECOVERY_FAILED", this.#projectId,
            "Failed publication left state that requires recovery.", cleanupError)
        }
      }
      if (error instanceof SemantifoldDiagnostic) throw error

      publicationFailure(failureCode, this.#projectId,
        committed
          ? "Active generation changed, but durable pointer publication did not complete."
          : "Candidate generation could not be staged.", error)
    }
  }

  /**
   * Creates and validates owned root directories and source-root separation.
   * @returns {Promise<void>} Completion.
   */
  async #prepareRoot() {
    await ensureDirectoryWithoutSymlinks(this.#projectRoot, false, this.#projectId)
    await ensureDirectoryWithoutSymlinks(this.#publicationRoot, true, this.#projectId)
    let exactProject
    let exactPublication

    try {
      exactProject = await realpath(this.#projectRoot)
      exactPublication = await realpath(this.#publicationRoot)
    } catch (error) {
      publicationFailure("INVALID_PUBLICATION_ROOT", this.#projectId,
        "Publication root could not be resolved safely.", error)
    }
    if (!isStrictPathDescendant(exactProject, exactPublication)) {
      publicationFailure("INVALID_PUBLICATION_ROOT", this.#projectId,
        "Publication root must resolve strictly beneath the project root.")
    }
    for (const sourceRoot of this.#sourceRoots) {
      await ensureDirectoryWithoutSymlinks(sourceRoot, false, this.#projectId)
      let exactSource

      try {
        exactSource = await realpath(sourceRoot)
      } catch (error) {
        publicationFailure("INVALID_PUBLICATION_ROOT", this.#projectId,
          "Source root could not be resolved safely.", error)
      }

      if (!isPathWithin(exactProject, exactSource)) {
        publicationFailure("INVALID_PUBLICATION_ROOT", this.#projectId,
          "Source roots must resolve within the project root.")
      }
      if (pathsOverlap(exactPublication, exactSource)) {
        publicationFailure("PUBLICATION_SOURCE_OVERLAP", this.#projectId,
          "Publication root and source roots resolve to overlapping paths.")
      }
    }
    await ensureOwnedDirectory(path.join(this.#publicationRoot, generationsName), this.#projectId)
    await ensureOwnedDirectory(path.join(this.#publicationRoot, journalName), this.#projectId)
  }
}

/**
 * Throws and consumes a configured internal failure at an exact lifecycle boundary.
 * @param {GeneratedArtifactPublisher} publisher - Active publisher.
 * @param {string} boundary - Reached boundary.
 * @returns {void}
 */
function reachPublicationBoundary(publisher, boundary) {
  const injection = injectedPublicationFailures.get(publisher)

  if (injection?.boundary == boundary) {
    injectedPublicationFailures.delete(publisher)
    throw injection.error
  }
}

/**
 * Reports one completed filesystem operation to the internal deterministic seam.
 * @param {GeneratedArtifactPublisher} publisher - Active publisher.
 * @param {string} operation - Completed operation.
 * @returns {void}
 */
function observePublicationFilesystemOperation(publisher, operation) {
  publicationFilesystemObservers.get(publisher)?.(operation)
}

/**
 * Reconciles only candidates and temporary pointers whose ownership is proven by a strict journal.
 * The active pointer remains the sole commit authority.
 * @param {string} publicationRoot - Publication root.
 * @param {string} projectId - Project identity.
 * @param {GeneratedArtifactPublisher} publisher - Active publisher.
 * @returns {Promise<void>} Completion.
 */
async function reconcilePublication(publicationRoot, projectId, publisher) {
  const journals = await readPublicationJournals(publicationRoot, projectId)

  if (journals.length == 0) return
  const pointer = await readActivePointer(path.join(publicationRoot, activePointerName), projectId, true)

  if (pointer) await verifyPublishedGeneration(publicationRoot, projectId, pointer, true)
  for (const {journal, journalPath} of journals) {
    const candidatePath = ownedPath(path.join(publicationRoot, generationsName), journal.generationId, projectId)
    const temporaryPointerPath = path.join(publicationRoot, journal.tempPointer)
    const committed = pointer?.generationId == journal.generationId

    if (!committed) {
      const candidateStatus = await optionalStatus(candidatePath, projectId, "candidate generation")

      if (candidateStatus) {
        if (!candidateStatus.isDirectory() || candidateStatus.isSymbolicLink()) {
          publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
            "Journal-owned candidate is not a real directory.")
        }
      }
    }
    const temporaryStatus = await optionalStatus(temporaryPointerPath, projectId, "temporary pointer")

    if (temporaryStatus) {
      if (!temporaryStatus.isFile() || temporaryStatus.isSymbolicLink()) {
        publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
          "Journal-owned temporary pointer is not a regular file.")
      }
    }
    await removeJournalOwnedState({
      ...(!committed ? {candidatePath} : {}),
      journalPath,
      projectId,
      publicationRoot,
      publisher,
      temporaryPointerPath
    })
  }
}

/**
 * Reads and validates every recovery journal without changing publication state.
 * @param {string} publicationRoot - Publication root.
 * @param {string} projectId - Project identity.
 * @returns {Promise<readonly {journal: PublicationJournal, journalPath: string}[]>} Ordered journals.
 */
async function readPublicationJournals(publicationRoot, projectId) {
  const journalDirectory = path.join(publicationRoot, journalName)
  let entries

  try {
    entries = await readdir(journalDirectory)
  } catch (error) {
    publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
      "Publication journal directory could not be inspected.", error)
  }
  entries.sort(compareStrings)
  /** @type {{journal: PublicationJournal, journalPath: string}[]} */
  const journals = []

  for (const entry of entries) {
    if (!entry.endsWith(".json") || !generationPattern.test(entry.slice(0, -5))) {
      publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
        "Publication journal contains an unrecognized entry.")
    }
    const journalPath = path.join(journalDirectory, entry)
    let journal

    try {
      const status = await lstat(journalPath)

      if (!status.isFile() || status.isSymbolicLink()) {
        publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
          "Publication journal entry must be a regular file.")
      }
      journal = JSON.parse(await readFile(journalPath, "utf8"))
    } catch (error) {
      if (error instanceof SemantifoldDiagnostic) throw error
      publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
        "Publication journal entry is not valid JSON.", error)
    }
    if (!isPublicationJournal(journal) || journal.projectId != projectId || `${journal.generationId}.json` != entry) {
      publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
        "Publication journal entry does not match the versioned project contract.")
    }
    journals.push({journal, journalPath})
  }

  return Object.freeze(journals)
}

/**
 * Reports committed cleanup state while failing closed on every journal entry.
 * @param {string} publicationRoot - Publication root.
 * @param {string} projectId - Project identity.
 * @param {string} generationId - Pointer-selected generation identity.
 * @returns {Promise<boolean>} Whether committed cleanup remains.
 */
async function hasCommittedCleanupJournal(publicationRoot, projectId, generationId) {
  const journals = await readPublicationJournals(publicationRoot, projectId)

  return journals.some(({journal}) => journal.generationId == generationId)
}

/**
 * Removes proven journal-owned state and durably synchronizes each parent before discarding its ownership proof.
 * @param {object} options - Exact cleanup state.
 * @param {string} [options.candidatePath] - Proven candidate generation path.
 * @param {string} [options.temporaryPointerPath] - Proven temporary pointer path.
 * @param {string} [options.journalPath] - Ownership journal path.
 * @param {string} options.projectId - Project identity.
 * @param {string} options.publicationRoot - Publication root.
 * @param {GeneratedArtifactPublisher} options.publisher - Active publisher.
 * @returns {Promise<void>} Completion.
 */
async function removeJournalOwnedState({candidatePath, journalPath, projectId, publicationRoot, publisher, temporaryPointerPath}) {
  try {
    if (candidatePath) {
      await rm(candidatePath, {force: true, recursive: true})
      observePublicationFilesystemOperation(publisher, "remove-candidate")
      await syncDirectory(path.join(publicationRoot, generationsName))
      observePublicationFilesystemOperation(publisher, "sync-candidate-parent")
    }
    if (temporaryPointerPath) {
      await rm(temporaryPointerPath, {force: true})
      observePublicationFilesystemOperation(publisher, "remove-temporary-pointer")
      await syncDirectory(publicationRoot)
      observePublicationFilesystemOperation(publisher, "sync-temporary-pointer-parent")
    }
    if (journalPath) {
      reachPublicationBoundary(publisher, "before-journal-remove")
      await rm(journalPath)
      observePublicationFilesystemOperation(publisher, "remove-journal")
      await syncDirectory(path.dirname(journalPath))
      observePublicationFilesystemOperation(publisher, "sync-journal-parent")
    }
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
      "Journal-owned publication state could not be durably reconciled.", error)
  }
}

/**
 * Reads optional metadata without following symbolic links.
 * @param {string} filename - Exact owned path.
 * @param {string} projectId - Project identity.
 * @param {string} subject - Stable subject description.
 * @returns {Promise<import("node:fs").Stats | null>} Status or absence.
 */
async function optionalStatus(filename, projectId, subject) {
  try {
    return await lstat(filename)
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return null
    publicationFailure("PUBLICATION_RECOVERY_FAILED", projectId,
      `Journal-owned ${subject} could not be inspected.`, error)
  }
}

/**
 * Validates and snapshots one publication request before staging.
 * @param {unknown} request - Request candidate.
 * @param {string} projectId - Project diagnostic identity.
 * @returns {{generationId: string, targets: readonly ValidatedPublicationTarget[]}} Validated request.
 */
function validatePublicationRequest(request, projectId) {
  if (!isPlainObject(request)) {
    publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
      "Publication requires a unique generation ID and a non-empty ordered target array.")
  }
  const generationId = request.generationId
  const requestedTargets = request.targets

  if (typeof generationId != "string" || !generationPattern.test(generationId) ||
    !isDenseArray(requestedTargets) || requestedTargets.length == 0) {
    publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
      "Publication requires a unique generation ID and a non-empty ordered target array.")
  }
  /** @type {ValidatedPublicationTarget[]} */
  const targets = []
  const targetIds = new Set()
  /** @type {string[]} */
  const projections = []
  /** @type {string[]} */
  const completeArtifactPaths = []

  for (let index = 0; index < requestedTargets.length; index += 1) {
    const target = requestedTargets[index]

    if (!isPlainObject(target)) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
        `Target ${index} requires a stable lowercase identity.`)
    }
    const targetId = target.id
    const role = target.role
    const sourceProjection = target.sourceProjection
    const buildProjection = target.buildProjection
    const artifactSetCandidate = target.artifactSet
    const validatorsCandidate = target.validators

    if (typeof targetId != "string" || !identityPattern.test(targetId)) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
        `Target ${index} requires a stable lowercase identity.`)
    }
    if (typeof role != "string" || !targetRoles.has(role)) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
        `Target '${targetId}' requires an explicit language-neutral role.`)
    }

    if (targetIds.has(targetId)) {
      publicationFailure("PUBLICATION_PATH_COLLISION", projectId, `Duplicate target identity '${targetId}'.`)
    }
    targetIds.add(targetId)
    if (!isSafeArtifactPath(sourceProjection) || !isSafeArtifactPath(buildProjection)) {
      publicationFailure("INVALID_PUBLICATION_PROJECTION", projectId,
        `Target '${targetId}' requires canonical relative source and build projections.`)
    }
    projections.push(sourceProjection, buildProjection)
    let artifactSet

    try {
      artifactSet = createGeneratedArtifactSet(artifactSetCandidate)
    } catch (error) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
        `Target '${targetId}' does not contain a valid generated artifact set.`, error)
    }
    const validators = validatorsCandidate === undefined ? [] : validatorsCandidate

    if (!isDenseArray(validators)) {
      publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
        `Target '${targetId}' validators must be a dense function array.`)
    }
    /** @type {import("./semantic/types.js").PublicationValidator[]} */
    const validatedValidators = []

    for (let validatorIndex = 0; validatorIndex < validators.length; validatorIndex += 1) {
      const validator = validators[validatorIndex]

      if (typeof validator != "function") {
        publicationFailure("INVALID_PUBLICATION_REQUEST", projectId,
          `Target '${targetId}' validators must be a dense function array.`)
      }
      validatedValidators.push(/** @type {import("./semantic/types.js").PublicationValidator} */ (validator))
    }
    const artifactConflict = findPortableArtifactPathConflict(artifactSet.artifacts.map(({path: artifactPath}) => artifactPath))

    if (artifactConflict) {
      publicationFailure("PUBLICATION_PATH_COLLISION", projectId,
        `Target '${targetId}' artifact paths have a portable ${artifactConflict.kind} conflict.`)
    }
    for (const artifact of artifactSet.artifacts) {
      completeArtifactPaths.push(`${sourceProjection}/${artifact.path}`)
    }
    targets.push(Object.freeze({
      artifactSet,
      buildProjection,
      id: targetId,
      role: /** @type {import("./semantic/types.js").PublicationTargetRole} */ (role),
      sourceProjection,
      validators: Object.freeze(validatedValidators)
    }))
  }
  const projectionConflict = findPortableArtifactPathConflict(projections)

  if (projectionConflict) {
    publicationFailure("PUBLICATION_PROJECTION_OVERLAP", projectId,
      "Target source/build projections must be distinct and non-nested under portable comparison.")
  }
  if (findPortableArtifactPathConflict([...projections, "manifest.json"])) {
    publicationFailure("INVALID_PUBLICATION_PROJECTION", projectId,
      "Target source/build projections must not overlap the generation manifest path.")
  }
  const artifactConflict = findPortableArtifactPathConflict(completeArtifactPaths)

  if (artifactConflict) {
    publicationFailure("PUBLICATION_PATH_COLLISION", projectId,
      "Projected artifact paths collide under portable comparison.")
  }

  return {generationId, targets: Object.freeze(targets)}
}

/**
 * Stages one validated target and invokes its ordered validators.
 * @param {string} generationPath - Candidate generation path.
 * @param {ValidatedPublicationTarget} target - Validated target.
 * @param {string} projectId - Project diagnostic identity.
 * @returns {Promise<import("./semantic/types.js").GenerationTargetManifest>} Target manifest.
 */
async function stageTarget(generationPath, target, projectId) {
  const sourcePath = ownedPath(generationPath, target.sourceProjection, projectId)
  const buildPath = ownedPath(generationPath, target.buildProjection, projectId)

  await mkdir(sourcePath, {mode: 0o700, recursive: true})
  await mkdir(buildPath, {mode: 0o700, recursive: true})
  /** @type {import("./semantic/types.js").GenerationArtifactManifest[]} */
  const artifacts = []

  for (const artifact of target.artifactSet.artifacts) {
    const filename = ownedPath(sourcePath, artifact.path, projectId)
    const bytes = artifact.contentKind == "text"
      ? Buffer.from(/** @type {string} */ (artifact.content), "utf8")
      : Buffer.from(/** @type {Uint8Array} */ (artifact.content))

    await mkdir(path.dirname(filename), {mode: 0o700, recursive: true})
    try {
      await writeSyncedFile(filename, bytes, "wx")
    } catch (error) {
      if (error instanceof SemantifoldDiagnostic) throw error
      publicationFailure("PUBLICATION_STAGE_WRITE_FAILED", projectId,
        `Generated artifact '${artifact.path}' could not be staged.`, error)
    }
    artifacts.push(Object.freeze({
      byteLength: bytes.byteLength,
      contentKind: artifact.contentKind,
      hash: Object.freeze({algorithm: /** @type {const} */ ("sha256"), value: sha256(bytes)}),
      mediaType: artifact.mediaType,
      path: artifact.path,
      provenance: artifact.provenance,
      role: artifact.role
    }))
  }

  /** @type {import("./semantic/types.js").PublicationBuildArtifactInput[]} */
  const buildDescriptors = []
  const context = Object.freeze({buildPath, sourcePath, targetId: target.id})

  for (let index = 0; index < target.validators.length; index += 1) {
    let produced

    try {
      produced = await target.validators[index](context)
    } catch (error) {
      publicationFailure("PUBLICATION_VALIDATION_FAILED", projectId,
        `Validator ${index} failed for target '${target.id}'.`, error)
    }
    if (produced === undefined) continue
    if (!isDenseArray(produced)) {
      publicationFailure("PUBLICATION_VALIDATION_FAILED", projectId,
        `Validator ${index} returned invalid build-artifact metadata for target '${target.id}'.`)
    }
    for (const descriptor of produced) {
      buildDescriptors.push(validateBuildArtifactDescriptor(descriptor, target.id, projectId))
    }
  }

  const descriptorConflict = findPortableArtifactPathConflict(buildDescriptors.map(({path: artifactPath}) => artifactPath))

  if (descriptorConflict) {
    publicationFailure("PUBLICATION_PATH_COLLISION", projectId,
      `Target '${target.id}' build artifacts have a portable ${descriptorConflict.kind} conflict.`)
  }
  const stagedBuildFiles = await listRegularFiles(buildPath, projectId)
  const declared = new Set(buildDescriptors.map(({path: artifactPath}) => artifactPath))

  if (stagedBuildFiles.length != declared.size || stagedBuildFiles.some(filename => !declared.has(filename))) {
    publicationFailure("PUBLICATION_VALIDATION_FAILED", projectId,
      `Target '${target.id}' validators must declare every staged build artifact exactly once.`)
  }
  /** @type {import("./semantic/types.js").GenerationBuildArtifactManifest[]} */
  const finalizedBuildArtifacts = []

  for (const descriptor of buildDescriptors) {
    const bytes = await readAndSyncRegularFile(ownedPath(buildPath, descriptor.path, projectId), projectId,
      "PUBLICATION_STAGE_HASH_MISMATCH", `Build artifact '${descriptor.path}' is not a stable regular file.`)

    finalizedBuildArtifacts.push(Object.freeze({
      byteLength: bytes.byteLength,
      hash: Object.freeze({algorithm: /** @type {const} */ ("sha256"), value: sha256(bytes)}),
      mediaType: descriptor.mediaType,
      path: descriptor.path,
      role: descriptor.role
    }))
  }

  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    buildArtifacts: Object.freeze(finalizedBuildArtifacts),
    id: target.id,
    ...(target.artifactSet.metadata === undefined ? {} : {metadata: target.artifactSet.metadata}),
    projections: Object.freeze({build: target.buildProjection, source: target.sourceProjection}),
    role: target.role,
    target: target.artifactSet.target
  })
}

/**
 * Validates validator/compiler output metadata.
 * @param {unknown} descriptor - Metadata candidate.
 * @param {string} targetId - Target identity.
 * @param {string} projectId - Project diagnostic identity.
 * @returns {import("./semantic/types.js").PublicationBuildArtifactInput} Validated metadata.
 */
function validateBuildArtifactDescriptor(descriptor, targetId, projectId) {
  if (!isPlainObject(descriptor) || !hasExactKeys(descriptor, ["mediaType", "path", "role"])) {
    publicationFailure("PUBLICATION_VALIDATION_FAILED", projectId,
      `Target '${targetId}' validator returned invalid build-artifact metadata.`)
  }
  const descriptorPath = descriptor.path
  const mediaType = descriptor.mediaType
  const role = descriptor.role

  if (!isSafeArtifactPath(descriptorPath) || typeof mediaType != "string" ||
    !mediaTypePattern.test(mediaType) || /[\r\n]/u.test(mediaType) ||
    typeof role != "string" || !buildRolePattern.test(role)) {
    publicationFailure("PUBLICATION_VALIDATION_FAILED", projectId,
      `Target '${targetId}' validator returned invalid build-artifact metadata.`)
  }

  return Object.freeze({mediaType, path: descriptorPath, role})
}

/**
 * Verifies every manifest reference and staged byte before pointer reachability.
 * @param {string} generationPath - Candidate generation path.
 * @param {import("./semantic/types.js").GenerationManifest} manifest - Candidate manifest.
 * @param {string} projectId - Project diagnostic identity.
 * @returns {Promise<void>} Completion.
 */
async function verifyManifestFiles(generationPath, manifest, projectId) {
  for (const target of manifest.targets) {
    const sourcePath = ownedPath(generationPath, target.projections.source, projectId)
    const buildPath = ownedPath(generationPath, target.projections.build, projectId)
    const sourceFiles = await listRegularFiles(sourcePath, projectId)

    if (sourceFiles.length != target.artifacts.length ||
      sourceFiles.some(filename => !target.artifacts.some(artifact => artifact.path == filename))) {
      publicationFailure("PUBLICATION_STAGE_HASH_MISMATCH", projectId,
        `Target '${target.id}' generated-source files do not match its manifest.`)
    }
    for (const artifact of target.artifacts) {
      await verifyManifestFile(sourcePath, artifact, projectId)
    }
    const buildFiles = await listRegularFiles(buildPath, projectId)

    if (buildFiles.length != target.buildArtifacts.length ||
      buildFiles.some(filename => !target.buildArtifacts.some(artifact => artifact.path == filename))) {
      publicationFailure("PUBLICATION_STAGE_HASH_MISMATCH", projectId,
        `Target '${target.id}' build files do not match its manifest.`)
    }
    for (const artifact of target.buildArtifacts) {
      await verifyManifestFile(buildPath, artifact, projectId)
    }
    try {
      const artifacts = []

      for (const artifact of target.artifacts) {
        const bytes = await readAndSyncRegularFile(ownedPath(sourcePath, artifact.path, projectId), projectId,
          "PUBLICATION_STAGE_HASH_MISMATCH", `Manifest artifact '${artifact.path}' is not a stable regular file.`)
        let content

        if (artifact.contentKind == "text") {
          try {
            content = new TextDecoder("utf-8", {fatal: true}).decode(bytes)
          } catch (error) {
            publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
              `Text artifact '${artifact.path}' is not valid UTF-8.`, error)
          }
        } else content = new Uint8Array(bytes)
        artifacts.push({
          content,
          contentKind: artifact.contentKind,
          mediaType: artifact.mediaType,
          ownership: /** @type {const} */ ("generated"),
          path: artifact.path,
          provenance: rehydrateProvenance(artifact.provenance, projectId),
          role: artifact.role
        })
      }
      createGeneratedArtifactSet({
        artifacts,
        ...(target.metadata === undefined ? {} : {metadata: target.metadata}),
        target: target.target
      })
    } catch (error) {
      if (error instanceof SemantifoldDiagnostic && error.code == "MALFORMED_GENERATION_MANIFEST") throw error
      publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
        `Target '${target.id}' artifact provenance does not match its staged bytes.`, error)
    }
  }
  await verifyGenerationInventory(generationPath, manifest, projectId)
}

/**
 * Restores JSON-omitted optional mapping fields and verifies persisted mapping projections.
 * @param {import("./semantic/types.js").ArtifactProvenance} provenance - Persisted provenance.
 * @param {string} projectId - Project identity.
 * @returns {import("./semantic/types.js").ArtifactProvenance} Canonical provenance.
 */
function rehydrateProvenance(provenance, projectId) {
  if (provenance.kind == "text") {
    const mapping = finalizeMapping(provenance.mapping)
    const sourceMap = toSourceMapV3(mapping)
    const jsonSourceMap = JSON.parse(JSON.stringify(sourceMap))

    if (!sameJsonValue(jsonSourceMap, provenance.sourceMap)) {
      publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
        "Persisted Source Map projection contradicts its rich mapping.")
    }

    return Object.freeze({
      kind: /** @type {const} */ ("text"),
      mapping,
      sourceMap,
      ...(provenance.sourceMapFilename === undefined ? {} : {sourceMapFilename: provenance.sourceMapFilename})
    })
  }
  if (provenance.kind == "bytes") {
    return Object.freeze({kind: /** @type {const} */ ("bytes"), mapping: finalizeByteMapping(provenance.mapping)})
  }

  return provenance
}

/**
 * Verifies one referenced file.
 * @param {string} projectionPath - Owning projection path.
 * @param {{byteLength: number, hash: import("./semantic/types.js").GenerationContentHash, path: string}} artifact - Manifest record.
 * @param {string} projectId - Project diagnostic identity.
 * @returns {Promise<Buffer>} Exact verified bytes.
 */
async function verifyManifestFile(projectionPath, artifact, projectId) {
  const bytes = await readAndSyncRegularFile(ownedPath(projectionPath, artifact.path, projectId), projectId,
    "PUBLICATION_STAGE_HASH_MISMATCH", `Manifest artifact '${artifact.path}' is not a stable regular file.`)

  if (bytes.byteLength != artifact.byteLength || sha256(bytes) != artifact.hash.value) {
    publicationFailure("PUBLICATION_STAGE_HASH_MISMATCH", projectId,
      `Manifest artifact '${artifact.path}' bytes do not match its recorded hash.`)
  }

  return bytes
}

/**
 * Validates an existing active pointer before a new candidate is staged.
 * @param {string} publicationRoot - Publication root.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function validateExistingPointer(publicationRoot, projectId) {
  const pointerPath = path.join(publicationRoot, activePointerName)
  const pointer = await readActivePointer(pointerPath, projectId, true)

  if (pointer) await verifyPublishedGeneration(publicationRoot, projectId, pointer, false)
}

/**
 * Reads and strictly validates one active pointer.
 * @param {string} pointerPath - Pointer filename.
 * @param {string} projectId - Expected project identity.
 * @param {boolean} optional - Whether absence is allowed.
 * @returns {Promise<ActivePointer | null>} Pointer or absent value.
 */
async function readActivePointer(pointerPath, projectId, optional) {
  let pointerBytes

  try {
    const status = await lstat(pointerPath)

    if (!status.isFile() || status.isSymbolicLink()) {
      publicationFailure("MALFORMED_ACTIVE_GENERATION", projectId,
        "Active-generation pointer must be a regular file.")
    }
    pointerBytes = await readFile(pointerPath)
  } catch (error) {
    if (optional && isErrorCode(error, "ENOENT")) return null
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure(optional ? "MALFORMED_ACTIVE_GENERATION" : "ACTIVE_GENERATION_MISSING", projectId,
      optional ? "Active-generation pointer could not be read." : "No active generation has been published.", error)
  }
  let value

  try {
    value = JSON.parse(pointerBytes.toString("utf8"))
  } catch (error) {
    publicationFailure("MALFORMED_ACTIVE_GENERATION", projectId,
      "Active-generation pointer is not valid JSON.", error)
  }
  if (!isActivePointer(value) || value.projectId != projectId) {
    publicationFailure("MALFORMED_ACTIVE_GENERATION", projectId,
      "Active-generation pointer does not match the versioned project contract.")
  }

  return value
}

/**
 * Verifies a pointer-selected generation without consulting the pointer again.
 * @param {string} publicationRoot - Publication root.
 * @param {string} projectId - Project identity.
 * @param {ActivePointer} pointer - Pointer snapshot.
 * @param {boolean} cleanupPending - Recovery state.
 * @returns {Promise<import("./semantic/types.js").PublishedGeneration>} Verified generation.
 */
async function verifyPublishedGeneration(publicationRoot, projectId, pointer, cleanupPending) {
  const generationPath = ownedPath(path.join(publicationRoot, generationsName), pointer.generationId, projectId)
  const manifestPath = path.join(generationPath, "manifest.json")
  let manifestBytes

  try {
    manifestBytes = await readAndSyncRegularFile(manifestPath, projectId, "MALFORMED_GENERATION_MANIFEST",
      "Generation manifest must be a regular file.")
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
      "Generation manifest could not be read.", error)
  }
  if (sha256(manifestBytes) != pointer.manifestHash) {
    publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
      "Generation manifest hash does not match the active pointer.")
  }
  let value

  try {
    value = JSON.parse(manifestBytes.toString("utf8"))
  } catch (error) {
    publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
      "Generation manifest is not valid JSON.", error)
  }
  const manifest = validateGenerationManifest(value, projectId, pointer.generationId)

  await verifyManifestFiles(generationPath, manifest, projectId)

  return publishedGeneration(publicationRoot, manifest, cleanupPending)
}

/**
 * Strictly validates a persisted generation manifest.
 * @param {unknown} value - Parsed manifest value.
 * @param {string} projectId - Expected project identity.
 * @param {string} generationId - Expected generation identity.
 * @returns {import("./semantic/types.js").GenerationManifest} Frozen manifest.
 */
function validateGenerationManifest(value, projectId, generationId) {
  if (!isPlainObject(value) || !hasExactKeys(value, ["generationId", "projectId", "schema", "targets", "version"]) ||
    value.schema != "SemantifoldGenerationManifest" || value.version != 1 || value.projectId != projectId ||
    value.generationId != generationId || !isDenseArray(value.targets) || value.targets.length == 0) {
    publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
      "Generation manifest does not match the versioned project contract.")
  }
  /** @type {import("./semantic/types.js").GenerationTargetManifest[]} */
  const targets = []
  /** @type {string[]} */
  const projections = []
  const ids = new Set()

  for (const target of value.targets) {
    const targetKeys = target && typeof target == "object" && "metadata" in target
      ? ["artifacts", "buildArtifacts", "id", "metadata", "projections", "role", "target"]
      : ["artifacts", "buildArtifacts", "id", "projections", "role", "target"]

    if (!isPlainObject(target) || !hasExactKeys(target, targetKeys) ||
      !identityPattern.test(typeof target.id == "string" ? target.id : "") || ids.has(target.id) ||
      typeof target.role != "string" || !targetRoles.has(target.role) ||
      typeof target.target != "string" || !identityPattern.test(target.target) ||
      !isPlainObject(target.projections) || !hasExactKeys(target.projections, ["build", "source"]) ||
      !isSafeArtifactPath(target.projections.source) || !isSafeArtifactPath(target.projections.build) ||
      !isDenseArray(target.artifacts) || target.artifacts.length == 0 || !isDenseArray(target.buildArtifacts)) {
      publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
        "Generation manifest contains an invalid target record.")
    }
    const targetId = /** @type {string} */ (target.id)

    ids.add(targetId)
    projections.push(target.projections.source, target.projections.build)
    const artifacts = target.artifacts.map(artifact => validatePersistedArtifact(artifact, true, projectId))
    const buildArtifacts = target.buildArtifacts.map(artifact => validatePersistedArtifact(artifact, false, projectId))

    if (findPortableArtifactPathConflict(artifacts.map(({path: artifactPath}) => artifactPath)) ||
      findPortableArtifactPathConflict(buildArtifacts.map(({path: artifactPath}) => artifactPath))) {
      publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
        "Generation manifest contains colliding artifact paths.")
    }
    targets.push(Object.freeze({
      artifacts: Object.freeze(/** @type {import("./semantic/types.js").GenerationArtifactManifest[]} */ (artifacts)),
      buildArtifacts: Object.freeze(/** @type {import("./semantic/types.js").GenerationBuildArtifactManifest[]} */ (buildArtifacts)),
      id: targetId,
      ...(target.metadata === undefined ? {} : {metadata: deepFreeze(/** @type {Record<string, unknown>} */ (target.metadata))}),
      projections: Object.freeze({build: target.projections.build, source: target.projections.source}),
      role: /** @type {import("./semantic/types.js").PublicationTargetRole} */ (target.role),
      target: target.target
    }))
  }
  if (findPortableArtifactPathConflict(projections) ||
    findPortableArtifactPathConflict([...projections, "manifest.json"])) {
    publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
      "Generation manifest contains overlapping projections.")
  }

  return Object.freeze({
    generationId,
    projectId,
    schema: /** @type {const} */ ("SemantifoldGenerationManifest"),
    targets: Object.freeze(targets),
    version: /** @type {const} */ (1)
  })
}

/**
 * Validates one persisted artifact record.
 * @param {unknown} value - Record candidate.
 * @param {boolean} generated - Whether this is a generated-source artifact.
 * @param {string} projectId - Project identity.
 * @returns {import("./semantic/types.js").GenerationArtifactManifest | import("./semantic/types.js").GenerationBuildArtifactManifest} Frozen record.
 */
function validatePersistedArtifact(value, generated, projectId) {
  const keys = generated
    ? ["byteLength", "contentKind", "hash", "mediaType", "path", "provenance", "role"]
    : ["byteLength", "hash", "mediaType", "path", "role"]

  if (!isPlainObject(value) || !hasExactKeys(value, keys) || !isSafeArtifactPath(value.path) ||
    typeof value.byteLength != "number" || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || typeof value.mediaType != "string" ||
    !mediaTypePattern.test(value.mediaType) || typeof value.role != "string" ||
    !(generated ? ["entry", "source", "manifest", "support", "mapping", "resource", "loader"].includes(value.role) :
      buildRolePattern.test(value.role)) ||
    (generated && value.contentKind != "text" && value.contentKind != "binary") ||
    (generated && !isPlainObject(value.provenance)) ||
    !isPlainObject(value.hash) || !hasExactKeys(value.hash, ["algorithm", "value"]) || value.hash.algorithm != "sha256" ||
    typeof value.hash.value != "string" || !/^[a-f0-9]{64}$/u.test(value.hash.value)) {
    publicationFailure("MALFORMED_GENERATION_MANIFEST", projectId,
      "Generation manifest contains an invalid artifact record.")
  }

  return Object.freeze(/** @type {import("./semantic/types.js").GenerationArtifactManifest | import("./semantic/types.js").GenerationBuildArtifactManifest} */ ({
    byteLength: value.byteLength,
    ...(generated ? {contentKind: value.contentKind} : {}),
    hash: Object.freeze({algorithm: /** @type {const} */ ("sha256"), value: value.hash.value}),
    mediaType: value.mediaType,
    path: value.path,
    ...(generated ? {provenance: deepFreeze(/** @type {import("./semantic/types.js").ArtifactProvenance} */ (value.provenance))} : {}),
    role: value.role
  }))
}

/**
 * Constructs a frozen resolved-generation result.
 * @param {string} publicationRoot - Publication root.
 * @param {import("./semantic/types.js").GenerationManifest} manifest - Verified manifest.
 * @param {boolean} cleanupPending - Whether cleanup remains.
 * @returns {import("./semantic/types.js").PublishedGeneration} Frozen result.
 */
function publishedGeneration(publicationRoot, manifest, cleanupPending) {
  const generationPath = path.join(publicationRoot, generationsName, manifest.generationId)
  const targets = manifest.targets.map(target => Object.freeze({
    buildPath: path.join(generationPath, target.projections.build),
    id: target.id,
    role: target.role,
    sourcePath: path.join(generationPath, target.projections.source)
  }))

  return Object.freeze({
    cleanupPending,
    generationId: manifest.generationId,
    generationPath,
    manifest,
    manifestPath: path.join(generationPath, "manifest.json"),
    targets: Object.freeze(targets)
  })
}

/**
 * Probes the exact same-directory regular-file replacement primitive used by the active pointer.
 * @param {string} publicationRoot - Publication root.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function verifyAtomicReplacement(publicationRoot, projectId) {
  const identity = randomUUID()
  const source = path.join(publicationRoot, `.semantifold-atomic-${identity}.source`)
  const destination = path.join(publicationRoot, `.semantifold-atomic-${identity}.destination`)
  const expected = Buffer.from("candidate\n")
  let sourceCreated = false
  let destinationCreated = false

  try {
    await writeSyncedFile(source, Buffer.from("candidate\n"), "wx")
    sourceCreated = true
    await writeSyncedFile(destination, Buffer.from("previous\n"), "wx")
    destinationCreated = true
    await rename(source, destination)
    sourceCreated = false
    await syncDirectory(publicationRoot)
    const destinationStatus = await lstat(destination)
    const replaced = await readFile(destination)

    if (!destinationStatus.isFile() || destinationStatus.isSymbolicLink() || !replaced.equals(expected)) {
      publicationFailure("PUBLICATION_ATOMIC_REPLACE_UNSUPPORTED", projectId,
        "Filesystem did not provide same-directory regular-file replacement.")
    }
    try {
      await lstat(source)
      publicationFailure("PUBLICATION_ATOMIC_REPLACE_UNSUPPORTED", projectId,
        "Filesystem did not remove the replaced temporary name atomically.")
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) throw error
    }
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure("PUBLICATION_ATOMIC_REPLACE_UNSUPPORTED", projectId,
      "Filesystem did not provide same-directory regular-file replacement.", error)
  } finally {
    await Promise.allSettled([
      ...(sourceCreated ? [rm(source, {force: true})] : []),
      ...(destinationCreated ? [rm(destination, {force: true})] : [])
    ])
  }
}

/**
 * Writes and synchronizes one newly owned file.
 * @param {string} filename - Exact filename.
 * @param {Uint8Array} bytes - Exact bytes.
 * @param {"wx"} flag - Exclusive creation mode.
 * @param {() => void} [onCreated] - Called immediately after exclusive creation succeeds.
 * @returns {Promise<void>} Completion.
 */
async function writeSyncedFile(filename, bytes, flag, onCreated) {
  const handle = await open(filename, flag, 0o600)

  onCreated?.()
  /** @type {unknown} */
  let failure

  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    failure = error
  } finally {
    try {
      await handle.close()
    } catch (error) {
      if (failure === undefined) failure = error
    }
  }
  if (failure !== undefined) {
    await rm(filename, {force: true}).catch(() => {})
    throw failure
  }
}

/**
 * Reads and synchronizes one regular non-symlink file.
 * @param {string} filename - Exact filename.
 * @param {string} projectId - Project identity.
 * @param {string} code - Failure code.
 * @param {string} message - Stable failure detail.
 * @returns {Promise<Buffer>} Exact bytes.
 */
async function readAndSyncRegularFile(filename, projectId, code, message) {
  try {
    const status = await lstat(filename)

    if (!status.isFile() || status.isSymbolicLink()) publicationFailure(code, projectId, message)
    assertRegularFileImmutability(status, new Set(), projectId)
    const handle = await open(filename, constants.O_RDONLY)

    try {
      const bytes = await handle.readFile()

      await handle.sync()

      return bytes
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure(code, projectId, message, error)
  }
}

/**
 * Lists every regular file beneath one projection and rejects symlinks or special nodes.
 * @param {string} directory - Projection root.
 * @param {string} projectId - Project identity.
 * @returns {Promise<string[]>} Sorted relative POSIX paths.
 */
async function listRegularFiles(directory, projectId) {
  /** @type {string[]} */
  const files = []
  const identities = new Set()

  try {
    await visit(directory, "")
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure("PUBLICATION_GENERATION_VERIFICATION_FAILED", projectId,
      "Immutable generation filesystem inventory could not be verified.", error)
  }

  return files.sort(compareStrings)

  /**
   * Visits one owned directory.
   * @param {string} current - Exact directory.
   * @param {string} relative - Projection-relative path.
   * @returns {Promise<void>} Completion.
   */
  async function visit(current, relative) {
    await assertRealInventoryDirectory(current, projectId)
    const entries = await readdir(current)

    entries.sort(compareStrings)
    for (const entry of entries) {
      const childRelative = relative.length == 0 ? entry : `${relative}/${entry}`

      if (!isSafeArtifactPath(childRelative)) {
        publicationFailure("INVALID_PUBLICATION_PROJECTION", projectId,
          "Validator output contains a non-canonical relative path.")
      }
      const child = path.join(current, entry)
      const status = await lstat(child)

      if (status.isSymbolicLink()) {
        publicationFailure("PUBLICATION_SYMLINK_TRAVERSAL", projectId,
          "Candidate generation contains a symbolic link.")
      }
      if (status.isDirectory()) await visit(child, childRelative)
      else if (status.isFile()) {
        assertRegularFileImmutability(status, identities, projectId)
        files.push(childRelative)
      } else publicationFailure("PUBLICATION_GENERATION_INVENTORY_MISMATCH", projectId,
        "Immutable generation contains an undeclared filesystem entry.")
    }
  }
}

/**
 * Verifies that the manifest describes every directory and regular file in the immutable generation.
 * @param {string} generationPath - Exact generation root.
 * @param {import("./semantic/types.js").GenerationManifest} manifest - Verified manifest.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function verifyGenerationInventory(generationPath, manifest, projectId) {
  const expectedFiles = new Set(["manifest.json"])
  const expectedDirectories = new Set()

  for (const target of manifest.targets) {
    addExpectedDirectory(target.projections.source)
    addExpectedDirectory(target.projections.build)
    for (const artifact of target.artifacts) {
      addExpectedFile(`${target.projections.source}/${artifact.path}`)
    }
    for (const artifact of target.buildArtifacts) {
      addExpectedFile(`${target.projections.build}/${artifact.path}`)
    }
  }
  /** @type {Set<string>} */
  const observedFiles = new Set()
  /** @type {Set<string>} */
  const observedDirectories = new Set()
  const identities = new Set()

  try {
    await visit(generationPath, "")
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure("PUBLICATION_GENERATION_VERIFICATION_FAILED", projectId,
      "Immutable generation filesystem inventory could not be verified.", error)
  }
  if (!sameStringSet(expectedFiles, observedFiles) || !sameStringSet(expectedDirectories, observedDirectories)) {
    publicationFailure("PUBLICATION_GENERATION_INVENTORY_MISMATCH", projectId,
      "Immutable generation contains an undeclared filesystem entry.")
  }

  /**
   * Adds one expected directory and each generation-relative parent.
   * @param {string} relative - POSIX-style generation-relative directory.
   * @returns {void}
   */
  function addExpectedDirectory(relative) {
    const parts = relative.split("/")

    for (let index = 1; index <= parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join("/"))
    }
  }

  /**
   * Adds one expected regular file and its parent directories.
   * @param {string} relative - POSIX-style generation-relative filename.
   * @returns {void}
   */
  function addExpectedFile(relative) {
    expectedFiles.add(relative)
    const separator = relative.lastIndexOf("/")

    if (separator >= 0) addExpectedDirectory(relative.slice(0, separator))
  }

  /**
   * Visits every entry in one generation directory without following links.
   * @param {string} current - Exact directory.
   * @param {string} relative - Generation-relative directory.
   * @returns {Promise<void>} Completion.
   */
  async function visit(current, relative) {
    await assertRealInventoryDirectory(current, projectId)
    const entries = await readdir(current)

    entries.sort(compareStrings)
    for (const entry of entries) {
      const childRelative = relative.length == 0 ? entry : `${relative}/${entry}`

      if (!isSafeArtifactPath(childRelative)) {
        publicationFailure("PUBLICATION_GENERATION_INVENTORY_MISMATCH", projectId,
          "Immutable generation contains an undeclared filesystem entry.")
      }
      const child = path.join(current, entry)
      const status = await lstat(child)

      if (status.isSymbolicLink()) {
        publicationFailure("PUBLICATION_SYMLINK_TRAVERSAL", projectId,
          "Candidate generation contains a symbolic link.")
      }
      if (status.isDirectory()) {
        observedDirectories.add(childRelative)
        await visit(child, childRelative)
      } else if (status.isFile()) {
        assertRegularFileImmutability(status, identities, projectId)
        observedFiles.add(childRelative)
      } else {
        publicationFailure("PUBLICATION_GENERATION_INVENTORY_MISMATCH", projectId,
          "Immutable generation contains an undeclared filesystem entry.")
      }
    }
  }
}

/**
 * Verifies one inventory traversal root without following symbolic links.
 * @param {string} directory - Exact directory about to be read.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function assertRealInventoryDirectory(directory, projectId) {
  const status = await lstat(directory)

  if (status.isSymbolicLink()) {
    publicationFailure("PUBLICATION_SYMLINK_TRAVERSAL", projectId,
      "Candidate generation contains a symbolic link.")
  }
  if (!status.isDirectory()) {
    publicationFailure("PUBLICATION_GENERATION_INVENTORY_MISMATCH", projectId,
      "Immutable generation contains an undeclared filesystem entry.")
  }
}

/**
 * Rejects external hard links and duplicate stable file identities.
 * @param {import("node:fs").Stats} status - Regular-file status.
 * @param {Set<string>} identities - Previously observed device/inode identities.
 * @param {string} projectId - Project identity.
 * @returns {void}
 */
function assertRegularFileImmutability(status, identities, projectId) {
  if (status.nlink > 1) {
    publicationFailure("PUBLICATION_HARD_LINK", projectId,
      "Immutable generation files must not have external hard links.")
  }
  const identity = stableFileIdentity(status)

  if (identity !== null) {
    if (identities.has(identity)) {
      publicationFailure("PUBLICATION_HARD_LINK", projectId,
        "Immutable generation files must have unique filesystem identities.")
    }
    identities.add(identity)
  }
}

/**
 * Returns a stable device/inode identity only where the host reports one.
 * @param {import("node:fs").Stats} status - File status.
 * @returns {string | null} Identity or unavailable.
 */
function stableFileIdentity(status) {
  if ((typeof status.dev != "number" && typeof status.dev != "bigint") ||
    (typeof status.ino != "number" && typeof status.ino != "bigint") || status.ino == 0) return null

  return `${String(status.dev)}:${String(status.ino)}`
}

/**
 * Compares two string sets exactly.
 * @param {Set<string>} left - First set.
 * @param {Set<string>} right - Second set.
 * @returns {boolean} Equality.
 */
function sameStringSet(left, right) {
  return left.size == right.size && [...left].every(value => right.has(value))
}

/**
 * Synchronizes every directory in a staged tree from leaves to root.
 * @param {string} root - Tree root.
 * @returns {Promise<void>} Completion.
 */
async function syncTreeDirectories(root) {
  const entries = await readdir(root, {withFileTypes: true})

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) await syncTreeDirectories(path.join(root, entry.name))
  }
  await syncDirectory(root)
}

/**
 * Synchronizes one directory entry set.
 * @param {string} directory - Directory path.
 * @returns {Promise<void>} Completion.
 */
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY)

  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Ensures every existing path component is a real directory and optionally creates missing components.
 * @param {string} directory - Canonical absolute directory.
 * @param {boolean} create - Whether missing components may be created.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function ensureDirectoryWithoutSymlinks(directory, create, projectId) {
  const parsed = path.parse(directory)
  const relative = directory.slice(parsed.root.length)
  const parts = relative.split(path.sep).filter(Boolean)
  let current = parsed.root

  for (const part of parts) {
    current = path.join(current, part)
    try {
      const status = await lstat(current)

      if (status.isSymbolicLink()) {
        publicationFailure("PUBLICATION_SYMLINK_TRAVERSAL", projectId,
          "Owned path traversal encountered a symbolic link.")
      }
      if (!status.isDirectory()) {
        publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
          "Owned root path contains a non-directory component.")
      }
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) {
        if (error instanceof SemantifoldDiagnostic) throw error
        publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
          "Owned root path could not be validated.", error)
      }
      if (!create) {
        publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
          "Source root must exist as a real directory.", error)
      }
      try {
        await mkdir(current, {mode: 0o700})
      } catch (mkdirError) {
        publicationFailure("INVALID_PUBLICATION_ROOT", projectId,
          "Publication root could not be created safely.", mkdirError)
      }
    }
  }
}

/**
 * Ensures one reserved publisher directory is neither a symlink nor an unowned file.
 * @param {string} directory - Reserved directory.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function ensureOwnedDirectory(directory, projectId) {
  try {
    await mkdir(directory, {mode: 0o700})
  } catch (error) {
    if (!isErrorCode(error, "EEXIST")) {
      publicationFailure("PUBLICATION_STAGE_WRITE_FAILED", projectId,
        "Publisher-owned directory could not be created.", error)
    }
  }
  let status

  try {
    status = await lstat(directory)
  } catch (error) {
    publicationFailure("PUBLICATION_STAGE_WRITE_FAILED", projectId,
      "Reserved publisher path could not be inspected.", error)
  }

  if (!status.isDirectory() || status.isSymbolicLink()) {
    publicationFailure(status.isSymbolicLink() ? "PUBLICATION_SYMLINK_TRAVERSAL" : "PUBLICATION_UNOWNED_CONFLICT",
      projectId, "Reserved publisher path is not an owned real directory.")
  }
}

/**
 * Ensures an owned path has no pre-existing entry.
 * @param {string} filename - Exact path.
 * @param {string} code - Diagnostic code.
 * @param {string} projectId - Project identity.
 * @param {string} message - Stable failure detail.
 * @returns {Promise<void>} Completion.
 */
async function assertAbsent(filename, code, projectId, message) {
  try {
    await lstat(filename)
    publicationFailure(code, projectId, message)
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return
    if (error instanceof SemantifoldDiagnostic) throw error
    publicationFailure(code, projectId, message, error)
  }
}

/**
 * Resolves a validated relative path under an owned root and rejects escape.
 * @param {string} root - Owned root.
 * @param {string} relative - Validated relative POSIX path.
 * @param {string} projectId - Project identity.
 * @returns {string} Exact owned path.
 */
function ownedPath(root, relative, projectId) {
  const resolved = path.resolve(root, ...relative.split("/"))
  const child = path.relative(root, resolved)

  if (child.length == 0 || child == ".." || child.startsWith(`..${path.sep}`) || path.isAbsolute(child)) {
    publicationFailure("PUBLICATION_PATH_ESCAPE", projectId,
      "Resolved publication path escaped its owned root.")
  }

  return resolved
}

/**
 * Checks a canonical non-root absolute path without filesystem access.
 * @param {unknown} value - Path candidate.
 * @returns {value is string} Whether the path is canonical.
 */
function isCanonicalAbsolutePath(value) {
  return isCanonicalAbsolutePathForPath(value, path)
}

/**
 * Checks one absolute path using the supplied host path semantics.
 * This helper is intentionally not part of the package root API.
 * @param {unknown} value - Path candidate.
 * @param {typeof path.posix | typeof path.win32} hostPath - Host-native path implementation.
 * @returns {value is string} Whether the path is canonical for that host.
 */
export function isCanonicalAbsolutePathForPath(value, hostPath) {
  const separatorAlias = hostPath.sep == "/" ? "\\" : "/"

  return typeof value == "string" && value.length > 0 && !value.includes("\0") && !value.includes(separatorAlias) &&
    hostPath.isAbsolute(value) && value != hostPath.parse(value).root && hostPath.normalize(value) == value &&
    hostPath.resolve(value) == value
}

/**
 * Checks conservative portable overlap between absolute paths.
 * @param {string} left - First path.
 * @param {string} right - Second path.
 * @returns {boolean} Whether either contains the other.
 */
function pathsOverlap(left, right) {
  const leftKey = left.toLowerCase()
  const rightKey = right.toLowerCase()

  return leftKey == rightKey || leftKey.startsWith(`${rightKey}${path.sep}`) || rightKey.startsWith(`${leftKey}${path.sep}`)
}

/**
 * Checks whether a path is equal to or nested beneath one canonical root.
 * @param {string} root - Canonical root.
 * @param {string} candidate - Canonical candidate.
 * @returns {boolean} Whether the candidate is within the root.
 */
function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate)

  return relative.length == 0 || (relative != ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * Checks whether a path is strictly nested beneath one canonical root.
 * @param {string} root - Canonical root.
 * @param {string} candidate - Canonical candidate.
 * @returns {boolean} Whether the candidate is a strict descendant.
 */
function isStrictPathDescendant(root, candidate) {
  return isPathWithin(root, candidate) && path.relative(root, candidate).length > 0
}

/**
 * Serializes stable generated JSON with one trailing LF.
 * @param {unknown} value - JSON value.
 * @returns {Buffer} UTF-8 bytes.
 */
function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
}

/**
 * Hashes exact bytes with SHA-256.
 * @param {Uint8Array} bytes - Exact bytes.
 * @returns {string} Lowercase hexadecimal hash.
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

/**
 * Deeply freezes a parsed JSON value.
 * @template T
 * @param {T} value - JSON value.
 * @returns {T} Frozen value.
 */
function deepFreeze(value) {
  if (typeof value == "object" && value != null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }

  return value
}

/**
 * Compares detached JSON values without depending on object-key order.
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} Whether the values are structurally equal.
 */
function sameJsonValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length == right.length &&
      left.every((entry, index) => sameJsonValue(entry, right[index]))
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  return leftKeys.length == rightKeys.length &&
    leftKeys.every(key => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]))
}

/**
 * Checks an active-pointer value.
 * @param {unknown} value - Parsed value.
 * @returns {value is ActivePointer} Whether the value is strict and versioned.
 */
function isActivePointer(value) {
  return isPlainObject(value) && hasExactKeys(value, ["generationId", "manifestHash", "projectId", "schema", "version"]) &&
    value.schema == "SemantifoldActiveGeneration" && value.version == 1 &&
    typeof value.projectId == "string" && identityPattern.test(value.projectId) &&
    typeof value.generationId == "string" && generationPattern.test(value.generationId) &&
    typeof value.manifestHash == "string" && /^[a-f0-9]{64}$/u.test(value.manifestHash)
}

/**
 * Checks a recovery-journal value.
 * @param {unknown} value - Parsed value.
 * @returns {value is PublicationJournal} Whether the value is strict and versioned.
 */
function isPublicationJournal(value) {
  return isPlainObject(value) && hasExactKeys(value, ["generationId", "projectId", "schema", "tempPointer", "version"]) &&
    value.schema == "SemantifoldPublicationJournal" && value.version == 1 &&
    typeof value.projectId == "string" && identityPattern.test(value.projectId) &&
    typeof value.generationId == "string" && generationPattern.test(value.generationId) &&
    value.tempPointer == `.active-generation.${value.generationId}.tmp`
}

/**
 * Checks an ordinary object with exactly the expected enumerable string keys.
 * @param {Record<string, unknown>} value - Object candidate.
 * @param {readonly string[]} keys - Sorted expected keys.
 * @returns {boolean} Whether keys match exactly.
 */
function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort(compareStrings)

  return actual.length == keys.length && actual.every((key, index) => key == keys[index])
}

/**
 * Checks for an ordinary string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is plain.
 */
function isPlainObject(value) {
  return typeof value == "object" && value != null && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Checks for a dense ordinary array.
 * @param {unknown} value - Candidate value.
 * @returns {value is unknown[]} Whether the value is dense.
 */
function isDenseArray(value) {
  if (!Array.isArray(value)) return false
  const indexedKeys = Object.keys(value).filter(key => /^(?:0|[1-9][0-9]*)$/u.test(key))

  return indexedKeys.length == value.length
}

/**
 * Compares strings by Unicode code unit.
 * @param {string} left - First string.
 * @param {string} right - Second string.
 * @returns {number} Ordering.
 */
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Checks a narrowed filesystem error code.
 * @param {unknown} error - Opaque error.
 * @param {string} code - Expected code.
 * @returns {boolean} Whether the code matches.
 */
function isErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code == code
}

/**
 * Throws one stable publication diagnostic without embedding host paths or raw filesystem messages.
 * @param {string} code - Stable diagnostic code.
 * @param {string} projectId - Project identity.
 * @param {string} message - Stable detail.
 * @param {unknown} [error] - Preserved cause.
 * @returns {never} Always throws.
 */
function publicationFailure(code, projectId, message, error) {
  throw new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code,
    language: projectId,
    message
  })
}

/**
 * @typedef ValidatedPublicationTarget
 * @property {string} id - Target identity.
 * @property {import("./semantic/types.js").GeneratedArtifactSet} artifactSet - Detached artifact set.
 * @property {string} sourceProjection - Source projection.
 * @property {string} buildProjection - Build projection.
 * @property {import("./semantic/types.js").PublicationTargetRole} role - Language-neutral target role.
 * @property {readonly import("./semantic/types.js").PublicationValidator[]} validators - Ordered validators.
 */

/**
 * @typedef ActivePointer
 * @property {"SemantifoldActiveGeneration"} schema - Schema discriminator.
 * @property {1} version - Schema version.
 * @property {string} projectId - Project identity.
 * @property {string} generationId - Generation identity.
 * @property {string} manifestHash - SHA-256 generation-manifest hash.
 */

/**
 * @typedef PublicationJournal
 * @property {"SemantifoldPublicationJournal"} schema - Schema discriminator.
 * @property {1} version - Schema version.
 * @property {string} projectId - Project identity.
 * @property {string} generationId - Candidate generation identity.
 * @property {string} tempPointer - Owned sibling temporary-pointer filename.
 */
