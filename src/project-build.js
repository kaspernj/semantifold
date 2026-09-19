// @ts-check

import {generateProgramArtifacts} from "./backends/program.js"
import {SemantifoldDiagnostic} from "./diagnostic.js"
import {parseProgramSource} from "./frontends/program.js"
import {ProjectManifestLoader} from "./project-manifest.js"
import {ProjectSnapshotBuilder} from "./project-snapshot.js"
import {GeneratedArtifactPublisher} from "./publication.js"

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

  /**
   * Creates a one-shot project builder.
   * @param {{manifestLoader?: ProjectManifestLoader, snapshotBuilder?: ProjectSnapshotBuilder}} [options] - Lifecycle collaborators.
   */
  constructor(options = {}) {
    this.#manifestLoader = options.manifestLoader ?? new ProjectManifestLoader()
    this.#snapshotBuilder = options.snapshotBuilder ?? new ProjectSnapshotBuilder()
  }

  /**
   * Builds and atomically publishes one project generation.
   * @param {string} [projectPath] - Project manifest path.
   * @param {import("./project-reporter.js").ProjectBuildReporter} [reporter] - Optional state reporter.
   * @returns {Promise<Readonly<ProjectBuildSuccess>>} Committed build result.
   */
  async build(projectPath = "./semantifold.json", reporter) {
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

      publicationTargets.push({
        artifactSet,
        buildProjection: target.buildProjection,
        id: target.id,
        role: target.role,
        sourceProjection: target.sourceProjection
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
    const generationId = `g-${snapshot.hash}`
    const generation = await publisher.publish({generationId, targets: publicationTargets})

    projectBuildObservers.get(this)?.("publish")

    return Object.freeze({
      generation,
      generationId,
      projectId: project.id,
      snapshotHash: snapshot.hash,
      status: /** @type {const} */ ("succeeded"),
      targets: Object.freeze(targetResults)
    })
  }
}

/**
 * @typedef ProjectBuildTargetResult
 * @property {number} artifactCount - Generated artifact count.
 * @property {string} id - Project target identity.
 * @property {import("./semantic/types.js").BackendLanguage} language - Backend target identity.
 * @property {import("./semantic/types.js").PublicationTargetRole} role - Explicit target role.
 */

/**
 * @typedef ProjectBuildSuccess
 * @property {"succeeded"} status - Terminal success state.
 * @property {string} projectId - Stable project identity.
 * @property {string} snapshotHash - Complete ordered input hash.
 * @property {string} generationId - Deterministic immutable generation identity.
 * @property {readonly ProjectBuildTargetResult[]} targets - Ordered generated target results.
 * @property {import("./semantic/types.js").PublishedGeneration} generation - Committed publisher snapshot.
 */
