// @ts-check

import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  createTargetCheckPlan,
  languageCapabilities,
  SemantifoldDiagnostic,
  TargetCheckRunner
} from "../index.js"
import {createTargetCheckRunner} from "../src/target-check.js"
import {createLanguageRegistry} from "../src/language-registry.js"

const synthetic = Object.freeze({kind: /** @type {const} */ ("synthetic"), reason: "check-plan fixture", relatedOrigins: Object.freeze([])})

/** @returns {import("../src/semantic/types.js").DiscoveredToolchain} */
function javacTool() {
  return Object.freeze({
    command: "javac",
    executable: "/usr/bin/javac",
    id: "javac",
    source: /** @type {const} */ ("canonical"),
    version: "javac 25.0.4",
    versionArguments: Object.freeze(["-version"]),
    versionOutput: "javac 25.0.4"
  })
}

/** @returns {import("../src/semantic/types.js").GeneratedArtifactSet} */
function javaArtifacts() {
  return createGeneratedArtifactSet({
    artifacts: [{
      content: "package demo; public final class Main {}\n",
      contentKind: "text",
      mediaType: "text/x-java-source",
      ownership: "generated",
      path: "demo/Main.java",
      provenance: synthetic,
      role: "entry"
    }, {
      content: "package demo; final class Helper {}\n",
      contentKind: "text",
      mediaType: "text/x-java-source",
      ownership: "generated",
      path: "demo/Helper.java",
      provenance: synthetic,
      role: "source"
    }],
    target: "java"
  })
}

/**
 * Creates exact staged roots and their Java plan.
 * @returns {Promise<{buildPath: string, plan: import("../src/semantic/types.js").TargetCheckPlan, root: string, sourcePath: string}>}
 */
async function stagedPlan() {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task040-plan-"))
  const sourcePath = path.join(root, "source")
  const buildPath = path.join(root, "build")

  await mkdir(path.join(sourcePath, "demo"), {recursive: true})
  await mkdir(buildPath)
  for (const artifact of javaArtifacts().artifacts) {
    await writeFile(path.join(sourcePath, artifact.path), /** @type {string} */ (artifact.content))
  }
  const plan = createTargetCheckPlan({
    artifacts: javaArtifacts(),
    buildPath,
    projectId: "plan-project",
    sourcePath,
    targetId: "java-main",
    tools: [javacTool()]
  })

  return {buildPath, plan, root, sourcePath}
}

/**
 * Rebuilds a frozen plan around one caller-supplied stage.
 * @param {import("../src/semantic/types.js").TargetCheckPlan} plan - Valid base plan.
 * @param {Record<string, unknown>} stage - Replacement stage.
 * @returns {import("../src/semantic/types.js").TargetCheckPlan} Candidate plan.
 */
function replaceStage(plan, stage) {
  return /** @type {import("../src/semantic/types.js").TargetCheckPlan} */ (Object.freeze({...plan, stages: Object.freeze([Object.freeze(stage)])}))
}

describe("registry-driven target check plans", () => {
  it("publishes explicit immutable developer-check capabilities without claiming unsupported targets", () => {
    const java = languageCapabilities.find(({id}) => id == "java")
    const go = languageCapabilities.find(({id}) => id == "go")

    expect(java?.check).toEqual({stages: ["compile"], supported: true, toolchains: ["javac"]})
    expect(go?.check).toEqual({stages: [], supported: false, toolchains: []})
    expect(Object.isFrozen(java?.check)).toBeTrue()
    expect(Object.isFrozen(java?.check.stages)).toBeTrue()
    expect(Object.isFrozen(java?.check.toolchains)).toBeTrue()
    const goArtifacts = createGeneratedArtifactSet({
      artifacts: [{
        content: "package main\nfunc main() {}\n",
        contentKind: "text",
        mediaType: "text/x-go",
        ownership: "generated",
        path: "main.go",
        provenance: synthetic,
        role: "entry"
      }],
      target: "go"
    })

    assert.throws(() => createTargetCheckPlan({
      artifacts: goArtifacts,
      buildPath: "/candidate/build",
      projectId: "plan-project",
      sourcePath: "/candidate/source",
      targetId: "go-main",
      tools: []
    }), error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_TARGET_CHECK")
  })

  it("rejects registry check factories that claim execution or undeclared stages and tools", () => {
    const factory = () => ({})
    const base = {
      acceptance: {stages: ["generate", "compile", "validate", "execute"], toolchains: ["javac", "java"]},
      artifactMultiplicity: "single",
      defaultFilename: "Main.demo",
      id: "demo",
      mapping: {binaryRanges: false, richText: false, sourceMapV3: false},
      mediaType: "text/x-demo",
      roundTrip: false,
      textBackend: () => undefined
    }

    for (const check of [
      {factory, stages: ["execute"], toolchains: ["java"]},
      {factory, stages: ["restore"], toolchains: ["javac"]},
      {factory, stages: ["compile"], toolchains: ["missing"]},
      {factory, stages: ["compile", "compile"], toolchains: ["javac"]},
      {factory, stages: ["validate", "compile"], toolchains: ["javac"]}
    ]) {
      assert.throws(() => createLanguageRegistry([{...base, check}]), error =>
        error instanceof SemantifoldDiagnostic && error.code == "INVALID_REGISTRY")
    }
  })

  it("constructs Java's immutable exact javac argv for every staged Java artifact and the isolated build root", async () => {
    const {buildPath, plan, root, sourcePath} = await stagedPlan()

    try {
      expect(plan).toMatchObject({
        buildPath,
        mode: "developer-check",
        projectId: "plan-project",
        schema: "SemantifoldTargetCheckPlan",
        sourcePath,
        target: "java",
        targetId: "java-main",
        version: 1
      })
      expect(plan.artifactPaths).toEqual([
        path.join(sourcePath, "demo/Main.java"),
        path.join(sourcePath, "demo/Helper.java")
      ])
      expect(plan.stages).toHaveLength(1)
      expect(plan.stages[0]).toMatchObject({
        argv: ["-d", buildPath, ...plan.artifactPaths],
        cwd: sourcePath,
        environment: {LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/local/bin:/usr/bin:/bin", TZ: "UTC"},
        executable: "/usr/bin/javac",
        output: {mediaType: "application/java-vm", ownership: "build", path: buildPath, role: "compiler-output"},
        stage: "compile",
        tool: javacTool()
      })
      expect(plan.stages[0].pathArguments).toEqual([
        {index: 1, ownership: "build"},
        {index: 2, ownership: "source"},
        {index: 3, ownership: "source"}
      ])
      expect(Object.isFrozen(plan)).toBeTrue()
      expect(Object.isFrozen(plan.artifactPaths)).toBeTrue()
      expect(Object.isFrozen(plan.stages)).toBeTrue()
      expect(Object.isFrozen(plan.stages[0].argv)).toBeTrue()
      expect(Object.isFrozen(plan.stages[0].environment)).toBeTrue()
      expect(Object.isFrozen(plan.stages[0].pathArguments)).toBeTrue()
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects undeclared tools, invalid order, escaped ownership, mutable or sparse vectors, and developer execution", async () => {
    const {plan, root} = await stagedPlan()
    let executions = 0
    const runner = createTargetCheckRunner({
      async execute() {
        executions += 1
        return {stderr: "", stdout: ""}
      },
      now: () => 0
    })
    const base = plan.stages[0]
    const sparse = [...base.argv]

    Reflect.deleteProperty(sparse, "1")
    const candidates = [
      replaceStage(plan, {...base, tool: Object.freeze({...javacTool(), id: "java"})}),
      Object.freeze({...plan, stages: Object.freeze([
        Object.freeze({...base, stage: /** @type {const} */ ("validate")}),
        Object.freeze({...base, stage: /** @type {const} */ ("compile")})
      ])}),
      Object.freeze({...plan, artifactPaths: Object.freeze([path.join(root, "escaped.java")])}),
      replaceStage(plan, {...base, argv: Object.freeze(["-d", path.join(root, "escaped"), ...base.argv.slice(2)])}),
      replaceStage(plan, {...base, argv: [...base.argv]}),
      replaceStage(plan, {...base, argv: Object.freeze(sparse)}),
      replaceStage(plan, {...base, environment: {...base.environment}}),
      replaceStage(plan, {...base, inputs: [...base.inputs]}),
      replaceStage(plan, {...base, inputs: Object.freeze([path.join(root, "escaped.java")])}),
      replaceStage(plan, {...base, inputHash: "0".repeat(64)}),
      replaceStage(plan, {...base, pathArguments: Object.freeze([
        Object.freeze({index: 1, ownership: /** @type {const} */ ("build"), prefix: "--out="}),
        ...base.pathArguments.slice(1)
      ])}),
      replaceStage(plan, {
        ...base,
        environment: Object.freeze({...base.environment, HOME: path.join(root, "escaped-home")}),
        environmentPaths: Object.freeze([Object.freeze({name: "HOME", ownership: /** @type {const} */ ("build")})])
      }),
      replaceStage(plan, {...base, transientPaths: Object.freeze([path.join(root, "escaped-cache")])}),
      replaceStage(plan, {...base, stage: /** @type {const} */ ("execute")})
    ]

    try {
      for (const candidate of candidates) {
        await assert.rejects(
          () => runner.run(candidate),
          error => error instanceof SemantifoldDiagnostic && error.code == "INVALID_TARGET_CHECK_PLAN"
        )
      }
      expect(executions).toEqual(0)
      expect(new TargetCheckRunner()).toBeInstanceOf(TargetCheckRunner)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
