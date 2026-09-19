// @ts-check

import {lstat, readFile, realpath} from "node:fs/promises"
import path from "node:path"
import {findPortableArtifactPathConflict, isSafeArtifactPath, isSafeSourcePath} from "./artifact-path.js"
import {supportsProgramArtifactRole} from "./backends/program.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {supportsProgramSourceLanguage} from "./frontends/program.js"
import {languageRegistry} from "./language-registry.js"

const projectIdentityPattern = /^[a-z][a-z0-9-]*$/u
const moduleIdentityPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z][a-z0-9_]*)*$/u
const sourceRoles = new Map([
  ["text", "textBackend"],
  ["binary", "binaryBackend"],
  ["application", "applicationBackend"]
])
const projectFields = ["id", "publicationRoot", "schema", "sources", "targets", "version"]
const sourceFields = ["entry", "id", "language", "path"]
const targetRequiredFields = ["id", "language", "role", "sourceProjection"]
const targetOptionalFields = ["buildProjection"]

/**
 * One validated immutable Semantifold project request.
 */
export class SemantifoldProject {
  /**
   * Constructs a trusted normalized project value for the manifest loader.
   * @param {NormalizedProject} value - Validated normalized fields.
   */
  constructor(value) {
    this.entryModule = value.entryModule
    this.id = value.id
    this.manifestPath = value.manifestPath
    this.manifestText = value.manifestText
    this.projectRoot = value.projectRoot
    this.publicationRoot = value.publicationRoot
    this.sources = Object.freeze(value.sources.map(source => Object.freeze({...source})))
    this.targets = Object.freeze(value.targets.map(target => Object.freeze({...target})))
    this.version = /** @type {const} */ (1)
    Object.freeze(this)
  }
}

/**
 * Loads and validates the strict versioned project-manifest boundary.
 */
export class ProjectManifestLoader {
  /**
   * Loads one project manifest without reading source content.
   * @param {string} [projectPath] - Manifest path, relative to the process working directory or absolute.
   * @returns {Promise<SemantifoldProject>} Immutable normalized project.
   */
  async load(projectPath = "./semantifold.json") {
    if (typeof projectPath != "string" || projectPath.length == 0 || projectPath.includes("\0")) {
      projectFailure("INVALID_PROJECT_MANIFEST", "project", "Project manifest path must be a non-empty path string.")
    }
    const manifestPath = path.resolve(projectPath)
    const projectRoot = path.dirname(manifestPath)

    await requireCanonicalProjectRoot(projectRoot)
    await requireRegularFile(manifestPath, "semantifold.json", "PROJECT_MANIFEST_READ_FAILED")
    let bytes

    try {
      bytes = await readFile(manifestPath)
    } catch (error) {
      projectFailure("PROJECT_MANIFEST_READ_FAILED", "project", "Project manifest could not be read.", manifestLocation(), error)
    }
    let manifestText

    try {
      manifestText = new TextDecoder("utf-8", {fatal: true}).decode(bytes)
    } catch (error) {
      projectFailure("INVALID_PROJECT_MANIFEST", "project", "Project manifest must be valid UTF-8.", manifestLocation(), error)
    }
    let candidate

    try {
      candidate = JSON.parse(manifestText)
    } catch (error) {
      projectFailure("INVALID_PROJECT_MANIFEST", "project", "Project manifest must contain valid JSON.", manifestLocation(), error)
    }

    return normalizeProject(candidate, {manifestPath, manifestText, projectRoot})
  }
}

/**
 * Validates and normalizes one parsed manifest.
 * @param {unknown} candidate - Parsed JSON value.
 * @param {{manifestPath: string, manifestText: string, projectRoot: string}} context - Canonical manifest context.
 * @returns {Promise<SemantifoldProject>} Immutable project value.
 */
async function normalizeProject(candidate, context) {
  if (!isPlainObject(candidate) || !hasExactKeys(candidate, projectFields)) {
    projectFailure("INVALID_PROJECT_MANIFEST", "project", "Project manifest requires exactly the version-1 root fields.", manifestLocation())
  }
  const {id, publicationRoot, schema, sources, targets, version} = candidate

  if (schema != "SemantifoldProject" || version != 1) {
    projectFailure("INVALID_PROJECT_MANIFEST", typeof id == "string" ? id : "project",
      "Project manifest requires schema 'SemantifoldProject' version 1.", manifestLocation())
  }
  if (typeof id != "string" || !projectIdentityPattern.test(id)) {
    projectFailure("INVALID_PROJECT_MANIFEST", "project", "Project identity must be a stable lowercase ID.", manifestLocation())
  }
  if (!isSafeArtifactPath(publicationRoot)) {
    projectFailure("INVALID_PROJECT_PATH", id, "Publication root must be one canonical project-relative path.", manifestLocation())
  }
  if (!isDenseArray(sources) || sources.length == 0) {
    projectFailure("INVALID_PROJECT_MANIFEST", id, "Project sources must be a non-empty ordered array.", manifestLocation())
  }
  if (!isDenseArray(targets) || targets.length == 0) {
    projectFailure("INVALID_PROJECT_MANIFEST", id, "Project targets must be a non-empty ordered array.", manifestLocation())
  }
  const normalizedPublicationRoot = path.join(context.projectRoot, publicationRoot)
  const sourceIds = new Set()
  const sourcePaths = []
  /** @type {NormalizedProjectSource[]} */
  const normalizedSources = []
  let entryModule

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]

    if (!isPlainObject(source) || !hasExactKeys(source, sourceFields)) {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Source ${index} requires exactly path, language, ID, and entry fields.`, manifestLocation())
    }
    if (typeof source.id != "string" || !moduleIdentityPattern.test(source.id) || sourceIds.has(source.id)) {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Source ${index} has an invalid or duplicate module identity.`, manifestLocation())
    }
    if (!isSafeSourcePath(source.path)) {
      projectFailure("INVALID_PROJECT_PATH", id, `Source '${source.id}' path must be canonical and project-relative.`, manifestLocation())
    }
    if (typeof source.language != "string") {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Source '${source.id}' requires a registered source language.`, manifestLocation())
    }
    languageRegistry.resolve(source.language, "frontend", manifestLocation())
    if (!supportsProgramSourceLanguage(source.language)) {
      projectFailure("UNSUPPORTED_PROJECT_SOURCE", source.language,
        "Registered frontend does not participate in the explicit multi-file project profile.", manifestLocation())
    }
    if (typeof source.entry != "boolean") {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Source '${source.id}' entry must be Boolean.`, manifestLocation())
    }
    if (source.entry) {
      if (entryModule !== undefined) {
        projectFailure("INVALID_PROJECT_MANIFEST", id, "Project sources must declare exactly one entry module.", manifestLocation())
      }
      entryModule = source.id
    }
    const absolutePath = path.join(context.projectRoot, source.path)

    if (portablePathsOverlap(source.path, publicationRoot)) {
      projectFailure("PROJECT_SOURCE_PUBLICATION_OVERLAP", id,
        `Source '${source.id}' overlaps the publisher-owned publication root.`, manifestLocation())
    }
    sourceIds.add(source.id)
    sourcePaths.push(source.path)
    normalizedSources.push({
      absolutePath,
      entry: source.entry,
      id: source.id,
      language: /** @type {import("./semantic/types.js").SemanticLanguage} */ (source.language),
      path: source.path
    })
  }
  if (entryModule === undefined) {
    projectFailure("INVALID_PROJECT_MANIFEST", id, "Project sources must declare exactly one entry module.", manifestLocation())
  }
  const sourceConflict = findPortableArtifactPathConflict(sourcePaths)

  if (sourceConflict) {
    projectFailure("PROJECT_SOURCE_ALIAS", id, "Project source paths must be unique under portable comparison.", manifestLocation())
  }
  const sourceLanguages = new Set(normalizedSources.map(({language}) => language))

  if (sourceLanguages.size != 1) {
    projectFailure("INVALID_PROJECT_MANIFEST", id, "A project must use one source-language compatibility profile.", manifestLocation())
  }
  await requireExistingProjectPaths(context.projectRoot, normalizedPublicationRoot, normalizedSources, id)
  const targetIds = new Set()
  /** @type {NormalizedProjectTarget[]} */
  const normalizedTargets = []
  /** @type {string[]} */
  const projections = []

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]

    if (!isPlainObject(target) || !hasRequiredAndOptionalKeys(target, targetRequiredFields, targetOptionalFields)) {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Target ${index} contains missing or unknown fields.`, manifestLocation())
    }
    if (typeof target.id != "string" || !projectIdentityPattern.test(target.id) || targetIds.has(target.id)) {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Target ${index} has an invalid or duplicate identity.`, manifestLocation())
    }
    if (typeof target.language != "string" || typeof target.role != "string" || !sourceRoles.has(target.role)) {
      projectFailure("INVALID_PROJECT_MANIFEST", id, `Target '${target.id}' requires a registered target and explicit role.`, manifestLocation())
    }
    languageRegistry.resolve(target.language, /** @type {"textBackend" | "binaryBackend" | "applicationBackend"} */ (sourceRoles.get(target.role)), manifestLocation())
    if (!supportsProgramArtifactRole(target.language, target.role)) {
      projectFailure("UNSUPPORTED_PROJECT_TARGET", target.language,
        `Registered target does not support '${target.role}' generation for complete semantic programs.`, manifestLocation())
    }
    const buildProjection = target.buildProjection === undefined ? `targets/${target.id}/build` : target.buildProjection

    if (!isSafeArtifactPath(target.sourceProjection) || !isSafeArtifactPath(buildProjection)) {
      projectFailure("INVALID_PROJECT_PATH", id, `Target '${target.id}' projections must be canonical generation-relative paths.`, manifestLocation())
    }
    targetIds.add(target.id)
    projections.push(target.sourceProjection, buildProjection)
    normalizedTargets.push({
      buildProjection,
      id: target.id,
      language: /** @type {import("./semantic/types.js").BackendLanguage} */ (target.language),
      role: /** @type {import("./semantic/types.js").PublicationTargetRole} */ (target.role),
      sourceProjection: target.sourceProjection
    })
  }
  if (findPortableArtifactPathConflict(projections)) {
    projectFailure("PROJECT_PROJECTION_COLLISION", id,
      "Target source/build projections must be distinct and non-nested under portable comparison.", manifestLocation())
  }
  if (findPortableArtifactPathConflict([...projections, "manifest.json"])) {
    projectFailure("INVALID_PROJECT_PATH", id,
      "Target source/build projections must not overlap the reserved generation manifest path.", manifestLocation())
  }

  return new SemantifoldProject({
    entryModule,
    id,
    manifestPath: context.manifestPath,
    manifestText: context.manifestText,
    projectRoot: context.projectRoot,
    publicationRoot: normalizedPublicationRoot,
    sources: normalizedSources,
    targets: normalizedTargets
  })
}

/**
 * Requires a canonical real project root.
 * @param {string} projectRoot - Absolute manifest directory.
 * @returns {Promise<void>} Completion.
 */
async function requireCanonicalProjectRoot(projectRoot) {
  try {
    const exact = await realpath(projectRoot)

    if (exact != projectRoot) {
      projectFailure("PROJECT_SYMLINK_TRAVERSAL", "project", "Project root must not be reached through a symbolic link.", manifestLocation())
    }
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    projectFailure("PROJECT_MANIFEST_READ_FAILED", "project", "Project root could not be resolved.", manifestLocation(), error)
  }
}

/**
 * Validates every source path and every existing publication-root component.
 * @param {string} projectRoot - Canonical project root.
 * @param {string} publicationRoot - Normalized publication root.
 * @param {readonly NormalizedProjectSource[]} sources - Normalized sources.
 * @param {string} projectId - Project identity.
 * @returns {Promise<void>} Completion.
 */
async function requireExistingProjectPaths(projectRoot, publicationRoot, sources, projectId) {
  await requireNoSymlinkComponents(projectRoot, publicationRoot, projectId, true)
  const fileIdentities = new Set()

  for (const source of sources) {
    await requireNoSymlinkComponents(projectRoot, source.absolutePath, projectId, false)
    const status = await requireRegularFile(source.absolutePath, source.path, "PROJECT_SOURCE_READ_FAILED", projectId)
    const identity = `${String(status.dev)}:${String(status.ino)}`

    if (fileIdentities.has(identity)) {
      projectFailure("PROJECT_SOURCE_ALIAS", projectId, "Project source paths must not alias the same file.", sourceLocation(source.path))
    }
    fileIdentities.add(identity)
  }
}

/**
 * Rejects symlinks beneath a canonical project root.
 * @param {string} projectRoot - Canonical project root.
 * @param {string} target - Absolute target.
 * @param {string} projectId - Project identity.
 * @param {boolean} allowMissing - Whether a missing suffix is permitted.
 * @returns {Promise<void>} Completion.
 */
async function requireNoSymlinkComponents(projectRoot, target, projectId, allowMissing) {
  const relative = path.relative(projectRoot, target)
  let current = projectRoot

  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      const status = await lstat(current)

      if (status.isSymbolicLink()) {
        projectFailure("PROJECT_SYMLINK_TRAVERSAL", projectId, "Project path traversal encountered a symbolic link.", manifestLocation())
      }
    } catch (error) {
      if (allowMissing && isErrorCode(error, "ENOENT")) return
      if (error instanceof SemantifoldDiagnostic) throw error
      projectFailure("PROJECT_SOURCE_READ_FAILED", projectId, "Declared project path could not be inspected.", manifestLocation(), error)
    }
  }
}

/**
 * Requires one real regular file.
 * @param {string} filename - Absolute file path.
 * @param {string} displayPath - Stable diagnostic filename.
 * @param {string} code - Diagnostic code.
 * @param {string} [projectId] - Project identity.
 * @returns {Promise<import("node:fs").Stats>} File status.
 */
async function requireRegularFile(filename, displayPath, code, projectId = "project") {
  try {
    const status = await lstat(filename)

    if (status.isSymbolicLink()) {
      projectFailure("PROJECT_SYMLINK_TRAVERSAL", projectId, "Declared project file must not be a symbolic link.", sourceLocation(displayPath))
    }
    if (!status.isFile()) projectFailure(code, projectId, "Declared project file must be a regular file.", sourceLocation(displayPath))

    return status
  } catch (error) {
    if (error instanceof SemantifoldDiagnostic) throw error
    projectFailure(code, projectId, "Declared project file could not be inspected.", sourceLocation(displayPath), error)
  }
}

/**
 * Checks whether two validated POSIX-relative paths overlap portably.
 * @param {string} left - First path.
 * @param {string} right - Second path.
 * @returns {boolean} Whether either path contains the other.
 */
function portablePathsOverlap(left, right) {
  const leftKey = left.toLowerCase()
  const rightKey = right.toLowerCase()

  return leftKey == rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`)
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
 * Checks for a dense array without extra enumerable keys.
 * @param {unknown} value - Candidate value.
 * @returns {value is unknown[]} Whether the value is a dense array.
 */
function isDenseArray(value) {
  return Array.isArray(value) && Object.keys(value).every((key, index) => key == String(index))
}

/**
 * Checks an object's exact closed key set.
 * @param {Record<string, unknown>} value - Candidate object.
 * @param {readonly string[]} keys - Required exact keys.
 * @returns {boolean} Whether the key set is exact.
 */
function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()

  return actual.length == expected.length && actual.every((key, index) => key == expected[index])
}

/**
 * Checks exact required fields plus an optional closed field set.
 * @param {Record<string, unknown>} value - Candidate record.
 * @param {readonly string[]} required - Required fields.
 * @param {readonly string[]} optional - Optional fields.
 * @returns {boolean} Whether the shape is exact.
 */
function hasRequiredAndOptionalKeys(value, required, optional) {
  const actual = Object.keys(value)

  return required.every(key => actual.includes(key)) && actual.every(key => required.includes(key) || optional.includes(key))
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
 * Checks one narrowed filesystem error code.
 * @param {unknown} error - Opaque failure.
 * @param {string} code - Expected code.
 * @returns {boolean} Whether the code matches.
 */
function isErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code == code
}

/**
 * Throws one stable located project diagnostic.
 * @param {string} code - Stable diagnostic code.
 * @param {string} language - Project or registration identity.
 * @param {string} message - Stable detail.
 * @param {import("./semantic/types.js").SourceLocation} [location] - Project-relative location.
 * @param {unknown} [error] - Preserved cause.
 * @returns {never} Always throws.
 */
function projectFailure(code, language, message, location, error) {
  throw new SemantifoldDiagnostic({
    cause: error instanceof Error ? error : undefined,
    code,
    language,
    location,
    message
  })
}

/**
 * @typedef NormalizedProjectSource
 * @property {string} absolutePath - Canonical project-absolute file path.
 * @property {boolean} entry - Whether this is the sole entry module.
 * @property {string} id - Stable semantic module identity.
 * @property {import("./semantic/types.js").SemanticLanguage} language - Registered source language.
 * @property {string} path - Canonical project-relative file path.
 */

/**
 * @typedef NormalizedProjectTarget
 * @property {string} buildProjection - Generation-relative reserved build projection.
 * @property {string} id - Stable project target identity.
 * @property {import("./semantic/types.js").BackendLanguage} language - Registered target identity.
 * @property {import("./semantic/types.js").PublicationTargetRole} role - Explicit target role.
 * @property {string} sourceProjection - Generation-relative generated-source projection.
 */

/**
 * @typedef NormalizedProject
 * @property {string} entryModule - Sole entry module identity.
 * @property {string} id - Stable project identity.
 * @property {string} manifestPath - Canonical absolute manifest path.
 * @property {string} manifestText - Exact validated manifest text.
 * @property {string} projectRoot - Canonical absolute project root.
 * @property {string} publicationRoot - Canonical absolute publication root.
 * @property {NormalizedProjectSource[]} sources - Ordered normalized sources.
 * @property {NormalizedProjectTarget[]} targets - Ordered normalized targets.
 */
