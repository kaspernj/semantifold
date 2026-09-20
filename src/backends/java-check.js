// @ts-check

import path from "node:path"
import {SemantifoldDiagnostic} from "../diagnostic.js"
import {deterministicEnvironment} from "../toolchains.js"

/**
 * Constructs Java's non-executing compiler plan from staged generated artifacts.
 * @param {Readonly<{
 *   artifacts: import("../semantic/types.js").GeneratedArtifactSet,
 *   buildPath: string,
 *   projectId: string,
 *   sourcePath: string,
 *   targetId: string,
 *   tools: readonly import("../semantic/types.js").DiscoveredToolchain[]
 * }>} context - Exact validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable javac plan.
 */
export function createJavaCheckPlan(context) {
  const javac = context.tools.find(({id}) => id == "javac")

  if (!javac) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "java",
      message: "Java developer checks require the declared 'javac' toolchain."
    })
  }
  const artifactPaths = context.artifacts.artifacts
    .filter(artifact => artifact.path.endsWith(".java"))
    .map(artifact => path.join(context.sourcePath, artifact.path))

  if (artifactPaths.length == 0) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "java",
      message: "Java developer checks require at least one staged '.java' artifact."
    })
  }
  const argv = Object.freeze(["-d", context.buildPath, ...artifactPaths])
  const pathArguments = Object.freeze([
    Object.freeze({index: 1, ownership: /** @type {const} */ ("build")}),
    ...artifactPaths.map((_, index) => Object.freeze({index: index + 2, ownership: /** @type {const} */ ("source")}))
  ])
  const stage = Object.freeze({
    argv,
    cwd: context.sourcePath,
    environment: deterministicEnvironment({}),
    executable: javac.executable,
    output: Object.freeze({
      mediaType: "application/java-vm",
      ownership: /** @type {const} */ ("build"),
      path: context.buildPath,
      role: "compiler-output"
    }),
    pathArguments,
    stage: /** @type {const} */ ("compile"),
    tool: javac
  })

  return Object.freeze({
    artifactPaths: Object.freeze(artifactPaths),
    buildPath: context.buildPath,
    mode: /** @type {const} */ ("developer-check"),
    projectId: context.projectId,
    schema: /** @type {const} */ ("SemantifoldTargetCheckPlan"),
    sourcePath: context.sourcePath,
    stages: Object.freeze([stage]),
    target: "java",
    targetId: context.targetId,
    version: /** @type {const} */ (1)
  })
}
