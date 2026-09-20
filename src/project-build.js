// @ts-check

import {generateProgramArtifacts} from "./backends/program.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {parseProgramSource} from "./frontends/program.js"
import {ProjectManifestLoader} from "./project-manifest.js"
import {ProjectSnapshotBuilder} from "./project-snapshot.js"
import {GeneratedArtifactPublisher} from "./publication.js"
import {languageRegistry} from "./language-registry.js"
import {createTargetCheckPlan, TargetCheckRunner} from "./target-check.js"
import {canonicalToolchains, discoverCanonicalToolchain} from "./toolchains.js"

/** @type {WeakMap<ProjectBuilder, (operation: string) => void>} */
const projectBuildObservers = new WeakMap()

/**
 * Installs an internal synchronous orchestration observer for focused specs.
 * This helper is intentionally not part of the package root API.
 * @param {ProjectBuilder} builder - Project builder instance.
 * @param {(operation: string) => void} observer - Ordered operation observer.
 * @returns {void}
 */
export function observeProjectBuild(builder, observer) {
  if (!(builder instanceof ProjectBuilder) || typeof observer != "function") {
    throw new TypeError("Invalid project build observer.")
  }
  projectBuildObservers.set(builder, observer)
}

/**
 * Orchestrates one complete immutable project build and one transactional publication.
 */
export class ProjectBuilder {
  /** @type {ProjectManifestLoader} */
  #manifestLoader
  /** @type {ProjectSnapshotBuilder} */
  #snapshotBuilder
  /** @type {TargetCheckRunner} */
  #checkRunner
  /** @type {Readonly<Record<string, string | undefined>> | undefined} */
  #environment

  /**
   * Creates a one-shot project builder.
   * @param {{checkRunner?: TargetCheckRunner, environment?: Readonly<Record<string, string | undefined>>, manifestLoader?: ProjectManifestLoader, snapshotBuilder?: ProjectSnapshotBuilder}} [options] - Lifecycle collaborators.
   */
  constructor(options = {}) {
    if (options.checkRunner !== undefined && !(options.checkRunner instanceof TargetCheckRunner)) {
      throw new TypeError("Project builder check runner must be a TargetCheckRunner.")
    }
    this.#manifestLoader = options.manifestLoader ?? new ProjectManifestLoader()
    this.#snapshotBuilder = options.snapshotBuilder ?? new ProjectSnapshotBuilder()
    this.#checkRunner = options.checkRunner ?? new TargetCheckRunner()
    this.#environment = options.environment === undefined ? undefined : snapshotEnvironment(options.environment)
  }

  /**
   * Builds and atomically publishes one project generation.
   * @param {string} [projectPath] - Project manifest path.
   * @param {import("./project-reporter.js").ProjectBuildReporter} [reporter] - Optional state reporter.
   * @param {{check?: boolean, signal?: AbortSignal, timeoutMs?: number}} [options] - Optional developer-check lifecycle.
   * @returns {Promise<Readonly<ProjectBuildSuccess>>} Committed build result.
   */
  async build(projectPath = "./semantifold.json", reporter, options = {}) {
    if (typeof options != "object" || options == null || Array.isArray(options) || Object.getPrototypeOf(options) != Object.prototype ||
      options.check !== undefined && typeof options.check != "boolean" ||
      options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
      throw new SemantifoldDiagnostic({
        code: "INVALID_PROJECT_BUILD",
        language: "project",
        message: "Project build options require an optional Boolean check and AbortSignal."
      })
    }
    const check = options.check === true
    const project = await this.#manifestLoader.load(projectPath)

    reporter?.projectLoaded(project.id)
    const snapshot = await this.#snapshotBuilder.build(project)

    reporter?.snapshotLoaded(snapshot.hash)
    projectBuildObservers.get(this)?.("snapshot")
    const program = parseProgramSource({
      entryModule: project.entryModule,
      sources: snapshot.sources.map(source => ({
        filename: source.path,
        id: source.id,
        language: source.language,
        source: source.source
      }))
    })

    projectBuildObservers.get(this)?.("parse")
    /** @type {import("./semantic/types.js").PublicationTargetInput[]} */
    const publicationTargets = []
    /** @type {ProjectBuildTargetResult[]} */
    const targetResults = []
    /** @type {Map<string, import("./semantic/types.js").TargetCheckResult>} */
    const checkResults = new Map()

    for (const target of project.targets) {
      if (target.role == "binary") {
        throw new SemantifoldDiagnostic({
          code: "UNSUPPORTED_PROJECT_TARGET",
          language: target.language,
          message: "Complete semantic programs do not support binary project generation."
        })
      }
      const artifactSet = generateProgramArtifacts({
        language: target.language,
        program,
        role: target.role
      })
      const checkCapability = languageRegistry.record(target.language).check

      if (check && !checkCapability.supported) {
        throw new SemantifoldDiagnostic({
          code: "UNSUPPORTED_TARGET_CHECK",
          language: target.language,
          message: `Project target '${target.id}' does not provide a developer check plan.`
        })
      }
      /**
       * Ordered candidate validators when checking is enabled.
       * @type {import("./semantic/types.js").PublicationValidator[] | undefined}
       */
      const validators = check ? [async ({buildPath, sourcePath, targetId}) => {
        /** @type {import("./semantic/types.js").DiscoveredToolchain[]} */
        const tools = []

        for (const toolchain of checkCapability.toolchains) {
          tools.push(await discoverCanonicalToolchain(/** @type {keyof typeof canonicalToolchains} */ (toolchain), {
            ...(this.#environment === undefined ? {} : {environment: this.#environment})
          }))
        }
        const plan = createTargetCheckPlan({
          artifacts: artifactSet,
          buildPath,
          projectId: project.id,
          sourcePath,
          targetId,
          tools: Object.freeze(tools)
        })
        const result = await this.#checkRunner.run(plan, {
          onStage: stage => {
            reporter?.targetChecked({id: target.id, language: target.language, stage})
            projectBuildObservers.get(this)?.(`check:${target.id}:${stage.stage}`)
          },
          ...(options.signal === undefined ? {} : {signal: options.signal}),
          ...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs})
        })

        checkResults.set(target.id, result)

        return [...result.outputs]
      }] : undefined

      publicationTargets.push({
        artifactSet,
        buildProjection: target.buildProjection,
        id: target.id,
        role: target.role,
        sourceProjection: target.sourceProjection,
        ...(validators === undefined ? {} : {validators})
      })
      targetResults.push(Object.freeze({
        artifactCount: artifactSet.artifacts.length,
        id: target.id,
        language: target.language,
        role: target.role
      }))
      reporter?.targetGenerated(targetResults[targetResults.length - 1])
      projectBuildObservers.get(this)?.(`target:${target.id}`)
    }
    const publisher = new GeneratedArtifactPublisher({
      projectId: project.id,
      projectRoot: project.projectRoot,
      publicationRoot: project.publicationRoot,
      sourceFiles: project.sources.map(({absolutePath}) => absolutePath)
    })
    const generationId = `g-${snapshot.hash}${check ? "-checked" : ""}`
    const generation = await publisher.publish({generationId, targets: publicationTargets})

    projectBuildObservers.get(this)?.("publish")

    return Object.freeze({
      generation,
      generationId,
      checked: check,
      projectId: project.id,
      snapshotHash: snapshot.hash,
      status: /** @type {const} */ ("succeeded"),
      targets: Object.freeze(targetResults.map(target => {
        const result = checkResults.get(target.id)

        return Object.freeze({
          ...target,
          ...(result === undefined ? {} : {check: Object.freeze({stages: result.stages})})
        })
      }))
    })
  }
}

/**
 * @typedef ProjectBuildTargetResult
 * @property {number} artifactCount - Generated artifact count.
 * @property {string} id - Project target identity.
 * @property {import("./semantic/types.js").BackendLanguage} language - Backend target identity.
 * @property {import("./semantic/types.js").PublicationTargetRole} role - Explicit target role.
 * @property {Readonly<{stages: readonly import("./semantic/types.js").TargetCheckStageResult[]}>} [check] - Successful developer-check evidence.
 */

/**
 * @typedef ProjectBuildSuccess
 * @property {"succeeded"} status - Terminal success state.
 * @property {string} projectId - Stable project identity.
 * @property {string} snapshotHash - Complete ordered input hash.
 * @property {string} generationId - Deterministic immutable generation identity.
 * @property {boolean} checked - Whether developer checks completed for every target.
 * @property {readonly ProjectBuildTargetResult[]} targets - Ordered generated target results.
 * @property {import("./semantic/types.js").PublishedGeneration} generation - Committed publisher snapshot.
 */

/**
 * Detaches explicit tool discovery configuration from caller mutation.
 * @param {unknown} candidate - Candidate environment.
 * @returns {Readonly<Record<string, string | undefined>>} Immutable snapshot.
 */
function snapshotEnvironment(candidate) {
  if (typeof candidate != "object" || candidate == null || Array.isArray(candidate)) {
    throw new TypeError("Project builder environment must be a plain string record.")
  }
  const prototype = Object.getPrototypeOf(candidate)

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Project builder environment must be a plain string record.")
  }
  /** @type {Record<string, string | undefined>} */
  const snapshot = Object.create(null)

  for (const key of Reflect.ownKeys(candidate)) {
    if (typeof key != "string") throw new TypeError("Project builder environment must use string keys.")
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key)

    if (descriptor == undefined || !descriptor.enumerable || !("value" in descriptor) ||
      descriptor.value !== undefined && typeof descriptor.value != "string") {
      throw new TypeError("Project builder environment must contain string or undefined data values.")
    }
    snapshot[key] = descriptor.value
  }

  return Object.freeze(snapshot)
}
