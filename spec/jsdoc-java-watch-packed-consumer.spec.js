// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {execFile, spawn} from "node:child_process"
import {readFileSync, watch as watchFileSystem} from "node:fs"
import {chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain} from "../index.js"
import {alternateNpmEnvironment, registryEnvironment} from "./support/ios-packed-consumer.js"
import {packRootPackage} from "./support/root-package-pack.js"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const warningPattern = /^\(node:\d+\) ExperimentalWarning: WASI is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n?$/u

describe("packed JavaScript/JSDoc-to-Java watch vertical slice", () => {
  it("installs the copy-ready project and preserves coherent real-javac generations through one watched edit lifecycle", {timeoutMs: 600_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task044-packed-"))
    const packDirectory = path.join(root, "pack")
    const consumerDirectory = path.join(root, "consumer")
    const userConfig = path.join(root, "empty-user.npmrc")
    const globalConfig = path.join(root, "empty-global.npmrc")
    const alternateConfig = path.join(root, "alternate.npmrc")

    try {
      await Promise.all([mkdir(packDirectory), mkdir(consumerDirectory)])
      await writeFile(userConfig, "")
      await writeFile(globalConfig, "")
      await writeFile(alternateConfig, "registry=https://global.invalid/\n")
      await writeFile(`${alternateConfig}.user`, "registry=https://user.invalid/\n")
      const inherited = alternateNpmEnvironment(alternateConfig)
      const packEnvironment = registryEnvironment(path.join(root, "pack-cache"), userConfig, globalConfig, inherited)
      const packed = await packRootPackage(
        (executable, arguments_, options) => executeFile(executable, arguments_, {...options, env: packEnvironment}),
        repositoryRoot,
        packDirectory
      )
      const packResult = parsePackResult(packed.stdout)
      const files = packResult.files.map(({path: filename}) => filename)
      const tarball = path.join(packDirectory, packResult.filename)

      expect(files).toContain("examples/jsdoc-java-watch/semantifold.json")
      expect(files).toContain("examples/jsdoc-java-watch/src/main.js")
      expect(files).toContain("examples/jsdoc-java-watch/expected-output.txt")
      await writeFile(path.join(consumerDirectory, "package.json"), `${JSON.stringify({
        dependencies: {semantifold: `file:${tarball}`},
        devDependencies: {"@types/node": "^24.3.0", typescript: "^7.0.0"},
        name: "semantifold-task044-consumer",
        private: true,
        type: "module",
        version: "1.0.0"
      }, null, 2)}\n`)
      await writeFile(path.join(consumerDirectory, "type-consumer.mts"), `import {ProjectWatchCoordinator, ProjectWatchReporter, SemantifoldCli} from "semantifold"
void new ProjectWatchCoordinator()
void new ProjectWatchReporter()
void new SemantifoldCli()
`)
      const environment = registryEnvironment(path.join(root, "install-cache"), userConfig, globalConfig, inherited)
      const javac = await discoverCanonicalToolchain("javac")
      const java = await discoverCanonicalToolchain("java")

      for (const command of ["install", "ci"]) {
        if (command == "ci") environment.npm_config_cache = path.join(root, "ci-cache")
        expect((await executeFile("npm", ["config", "get", "install-links"], {
          cwd: consumerDirectory,
          env: environment
        })).stdout.trim()).toEqual("false")
        await executeFile("npm", [command], {cwd: consumerDirectory, env: environment, maxBuffer: 20 * 1024 * 1024})
        const listed = JSON.parse((await executeFile("npm", ["ls", "--all", "--json"], {
          cwd: consumerDirectory,
          env: environment,
          maxBuffer: 20 * 1024 * 1024
        })).stdout)

        expect(listed.problems).toEqual(undefined)
        await executeFile(path.join(consumerDirectory, "node_modules/.bin/tsc"), [
          "--module", "nodenext", "--moduleResolution", "nodenext", "--noEmit", "--strict", "--target", "ES2024",
          "--types", "node", "type-consumer.mts"
        ], {cwd: consumerDirectory, env: environment})
        const projectDirectory = path.join(consumerDirectory, `project-${command}`)
        const installedExample = path.join(consumerDirectory, "node_modules/semantifold/examples/jsdoc-java-watch")

        await cp(installedExample, projectDirectory, {recursive: true})
        const proxy = await createCompilerProxy(path.join(root, `compiler-${command}`), javac.executable)
        const scenarioEnvironment = {...environment, SEMANTIFOLD_JAVAC: proxy.executable}

        await runWatchScenario({
          environment: scenarioEnvironment,
          executable: path.join(consumerDirectory, "node_modules/.bin/semantifold"),
          javaExecutable: java.executable,
          projectDirectory,
          proxy,
          shutdown: command == "install" ? "idle" : "active"
        })
      }
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

/**
 * Drives one packed long-lived CLI through successful, failed, recovered, superseded, and shutdown cycles.
 * @param {{environment: NodeJS.ProcessEnv, executable: string, javaExecutable: string, projectDirectory: string, proxy: CompilerProxy, shutdown: "active" | "idle"}} options - Scenario inputs.
 * @returns {Promise<void>}
 */
async function runWatchScenario({environment, executable, javaExecutable, projectDirectory, proxy, shutdown}) {
  const sourcePath = path.join(projectDirectory, "src/main.js")
  const expectedInitial = await readFile(path.join(projectDirectory, "expected-output.txt"), "utf8")
  const initialSource = await readFile(sourcePath, "utf8")
  const watcher = runWatch(executable, projectDirectory, environment)

  try {
    const firstRecord = await watcher.next(record => record.state == "cycle-succeeded" && record.cycle == 1)
    const first = await inspectActive(projectDirectory, firstRecord, expectedInitial, javaExecutable, environment)
    const firstCheck = watcher.records().find(record => record.state == "target-checked" && record.cycle == 1)

    expect(firstCheck).toMatchObject({exitCode: 0, stage: "compile", target: "java-main", tool: {id: "javac", source: "override"}})
    expect(proxy.compileEvents().filter(({event}) => event == "compile-start")).toHaveLength(1)

    const sourceStatus = await stat(sourcePath)
    const touched = new Date(sourceStatus.mtimeMs + 2_000)

    await utimes(sourcePath, touched, touched)
    await watcher.next(record => record.state == "reconciled-unchanged")
    await assertActiveUnchanged(projectDirectory, first)
    expect(proxy.compileEvents().filter(({event}) => event == "compile-start")).toHaveLength(1)

    await writeFile(sourcePath, editedSource(initialSource, "semantic-edit", 4))
    const secondRecord = await watcher.next(record => record.state == "cycle-succeeded" && record.cycle == 2)
    const second = await inspectActive(projectDirectory, secondRecord, "semantic-edit\n7\nenabled\n", javaExecutable, environment)

    expect(second.generationId == first.generationId).toBeFalse()
    expect(secondRecord.snapshotHash == firstRecord.snapshotHash).toBeFalse()
    const beforeFrontendFailure = proxy.compileEvents().filter(({event}) => event == "compile-start").length

    await writeFile(sourcePath, "/** @param {number} value */\nfunction broken(\n")
    const frontendFailure = await watcher.next(record => record.state == "cycle-failed" && record.cycle == 3)
    const located = diagnosticChain(frontendFailure.diagnostic).find(diagnostic => diagnostic.location !== undefined)

    assert.notEqual(located, undefined)
    expect(located.location.filename).toEqual("src/main.js")
    expect(proxy.compileEvents().filter(({event}) => event == "compile-start")).toHaveLength(beforeFrontendFailure)
    await assertActiveUnchanged(projectDirectory, second)

    await writeFile(sourcePath, editedSource(initialSource, "frontend-recovered", 5))
    const fourthRecord = await watcher.next(record => record.state == "cycle-recovered" && record.cycle == 4)
    const fourth = await inspectActive(projectDirectory, fourthRecord, "frontend-recovered\n8\nenabled\n", javaExecutable, environment)

    await proxy.failNextCompile()
    await writeFile(sourcePath, editedSource(initialSource, "check-failure", 6))
    const checkFailure = await watcher.next(record => record.state == "cycle-failed" && record.cycle == 5)
    const checkDiagnostic = diagnosticChain(checkFailure.diagnostic).find(({code}) => code == "TARGET_CHECK_NONZERO_EXIT")

    assert.notEqual(checkDiagnostic, undefined)
    expect(checkDiagnostic.stage).toEqual("compile")
    expect(checkDiagnostic.stderr).toContain("error")
    await assertActiveUnchanged(projectDirectory, fourth)
    expect(await readdir(path.join(projectDirectory, ".semantifold/generations"))).toHaveLength(3)

    await writeFile(sourcePath, editedSource(initialSource, "check-recovered", 7))
    const sixthRecord = await watcher.next(record => record.state == "cycle-recovered" && record.cycle == 6)
    const sixth = await inspectActive(projectDirectory, sixthRecord, "check-recovered\n10\nenabled\n", javaExecutable, environment)
    const burstBlock = await proxy.blockNextCompile("burst")

    await writeFile(sourcePath, editedSource(initialSource, "burst-old", 8))
    await Promise.all([
      burstBlock.started,
      watcher.next(record => record.state == "target-generated" && record.cycle == 7)
    ])

    const replacementPath = path.join(projectDirectory, "src/burst-replacement.js")
    const dirty = watcher.next(record => record.state == "cycle-dirty" && record.cycle == 7)

    await writeFile(replacementPath, editedSource(initialSource, "burst-intermediate", 9))
    await rename(replacementPath, sourcePath)
    await dirty
    await writeFile(sourcePath, editedSource(initialSource, "burst-latest", 10))
    await burstBlock.release()
    await watcher.next(record => record.state == "cycle-superseded" && record.cycle == 7)
    await assertActiveUnchanged(projectDirectory, sixth)
    const eighthRecord = await watcher.next(record => record.state == "cycle-succeeded" && record.cycle == 8)
    const eighth = await inspectActive(projectDirectory, eighthRecord, "burst-latest\n13\nenabled\n", javaExecutable, environment)

    assertSerializedCompilerEvents(proxy.compileEvents())
    expect(fileExists(proxy.overlapPath)).toBeFalse()

    if (shutdown == "active") {
      const shutdownBlock = await proxy.blockNextCompile("shutdown")

      await writeFile(sourcePath, editedSource(initialSource, "active-shutdown", 11))
      const [shutdownMarker] = await Promise.all([
        shutdownBlock.started,
        watcher.next(record => record.state == "target-generated" && record.cycle == 9)
      ])

      expect(watcher.child.kill("SIGINT")).toBeTrue()
      const closed = await watcher.closed

      expect(closed).toEqual({code: 0, signal: null})
      assert.throws(() => process.kill(shutdownMarker.pid, 0), error =>
        error instanceof Error && "code" in error && error.code == "ESRCH")
      await assertActiveUnchanged(projectDirectory, eighth)
      expect(watcher.records().filter(record => record.state == "cycle-cancelled" && record.cycle == 9)).toHaveLength(1)
    } else {
      expect(watcher.child.kill("SIGINT")).toBeTrue()
      expect(await watcher.closed).toEqual({code: 0, signal: null})
      await assertActiveUnchanged(projectDirectory, eighth)
    }
    const watcherTerminals = watcher.records().filter(record => record.terminalScope == "watch")

    expect(watcherTerminals).toHaveLength(1)
    expect(watcherTerminals[0]).toMatchObject({state: "watch-stopped", terminal: true})
    expect(watcher.stderr().replace(warningPattern, "")).toEqual("")
    expect(fileExists(proxy.activePath)).toBeFalse()
    expect(fileExists(proxy.overlapPath)).toBeFalse()
    expect(await readdir(path.join(projectDirectory, ".semantifold/generations"))).toHaveLength(5)
    await assertMissingJavacFails(executable, projectDirectory, environment, eighth.pointerBytes)
  } finally {
    if (watcher.child.exitCode == null && watcher.child.signalCode == null) watcher.child.kill("SIGINT")
    await watcher.closed
  }
}

/**
 * Resolves one active pointer and verifies its manifest, hashes, projections, provenance, cycle identity, and runtime output.
 * @param {string} projectDirectory - Packed example root.
 * @param {Record<string, any>} record - Successful cycle terminal.
 * @param {string} expectedOutput - Exact Java runtime output.
 * @param {string} javaExecutable - Canonical Java runtime.
 * @param {NodeJS.ProcessEnv} environment - Credential-free process environment.
 * @returns {Promise<ActiveEvidence>} Immutable evidence.
 */
async function inspectActive(projectDirectory, record, expectedOutput, javaExecutable, environment) {
  const publicationRoot = path.join(projectDirectory, ".semantifold")
  const pointerPath = path.join(publicationRoot, "active-generation.json")
  const pointerBytes = await readFile(pointerPath)
  const pointer = JSON.parse(pointerBytes.toString("utf8"))
  const generationId = pointer.generationId
  const generationRoot = path.join(publicationRoot, "generations", generationId)
  const manifestBytes = await readFile(path.join(generationRoot, "manifest.json"))
  const manifest = JSON.parse(manifestBytes.toString("utf8"))
  const target = manifest.targets[0]

  expect(record).toMatchObject({
    checked: true,
    generationId,
    project: "jsdoc-java-watch",
    terminal: true,
    terminalScope: "cycle"
  })
  expect(generationId).toMatch(new RegExp(`^g-${record.snapshotHash}-checked-[a-f0-9-]+$`, "u"))
  expect(pointer).toEqual({
    generationId,
    manifestHash: sha256(manifestBytes),
    projectId: "jsdoc-java-watch",
    schema: "SemantifoldActiveGeneration",
    version: 1
  })
  expect(manifest).toMatchObject({
    generationId,
    projectId: "jsdoc-java-watch",
    schema: "SemantifoldGenerationManifest",
    version: 1
  })
  expect(manifest.targets).toHaveLength(1)
  expect(target).toMatchObject({
    id: "java-main",
    projections: {build: "targets/java/classes", source: "targets/java/source"},
    role: "text",
    target: "java"
  })
  expect(target.artifacts).toHaveLength(1)
  expect(target.buildArtifacts.some(({path: filename}) => filename == "semantifold/generated/main/Main.class")).toBeTrue()
  const sourceArtifact = target.artifacts[0]
  const classArtifact = target.buildArtifacts.find(({path: filename}) => filename == "semantifold/generated/main/Main.class")

  assert.notEqual(classArtifact, undefined)
  expect(sourceArtifact).toMatchObject({contentKind: "text", mediaType: "text/x-java-source", role: "entry"})
  expect(sourceArtifact.provenance.kind).toEqual("text")
  const javaPath = path.join(generationRoot, target.projections.source, sourceArtifact.path)
  const classPath = path.join(generationRoot, target.projections.build, classArtifact.path)
  const javaBytes = await readFile(javaPath)
  const classBytes = await readFile(classPath)

  expect(sourceArtifact.hash).toEqual({algorithm: "sha256", value: sha256(javaBytes)})
  expect(sourceArtifact.byteLength).toEqual(javaBytes.byteLength)
  expect(classArtifact.hash).toEqual({algorithm: "sha256", value: sha256(classBytes)})
  expect(classArtifact.byteLength).toEqual(classBytes.byteLength)
  const executed = await executeFile(javaExecutable, [
    "-cp", path.join(generationRoot, target.projections.build), "semantifold.generated.main.Main"
  ], {cwd: projectDirectory, env: environment})

  expect(executed.stdout).toEqual(expectedOutput)
  expect(executed.stderr).toEqual("")

  return {classBytes, classPath, generationId, javaBytes, javaPath, pointerBytes}
}

/** @param {string} projectDirectory @param {ActiveEvidence} evidence @returns {Promise<void>} */
async function assertActiveUnchanged(projectDirectory, evidence) {
  assert.deepEqual(await readFile(path.join(projectDirectory, ".semantifold/active-generation.json")), evidence.pointerBytes)
  assert.deepEqual(await readFile(evidence.javaPath), evidence.javaBytes)
  assert.deepEqual(await readFile(evidence.classPath), evidence.classBytes)
}

/**
 * Proves a declared checked build fails instead of degrading when javac cannot be resolved.
 * @param {string} executable - Packed CLI.
 * @param {string} projectDirectory - Project root.
 * @param {NodeJS.ProcessEnv} environment - Base environment.
 * @param {Buffer} pointerBytes - Last-good pointer.
 */
async function assertMissingJavacFails(executable, projectDirectory, environment, pointerBytes) {
  const missing = await runCommand(executable, ["build", "--check", "--ndjson"], {
    ...environment,
    SEMANTIFOLD_JAVAC: path.join(projectDirectory, "missing-javac")
  }, projectDirectory)
  const records = missing.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
  const terminal = records.at(-1)

  expect(missing.code).toEqual(1)
  expect(terminal).toMatchObject({state: "failed", terminal: true})
  expect(diagnosticChain(terminal.diagnostic).some(({code}) => code == "TOOL_NOT_FOUND")).toBeTrue()
  assert.deepEqual(await readFile(path.join(projectDirectory, ".semantifold/active-generation.json")), pointerBytes)
}

/**
 * Creates a test-owned configured javac boundary that always delegates exact arrays to real javac.
 * It can corrupt only one staged candidate or gate only one invocation without a production hook.
 * @param {string} root - Proxy-owned temporary root.
 * @param {string} javacExecutable - Canonical real javac.
 * @returns {Promise<CompilerProxy>} Proxy controls.
 */
async function createCompilerProxy(root, javacExecutable) {
  await mkdir(root, {recursive: true})
  const executable = path.join(root, "javac-proxy.mjs")
  const controlPath = path.join(root, "control.json")
  const eventPath = path.join(root, "events.ndjson")
  const activePath = path.join(root, "active.json")
  const overlapPath = path.join(root, "overlap.json")
  const proxySource = `#!/usr/bin/env node
import {spawn} from "node:child_process"
import {appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, watch, writeFileSync} from "node:fs"
import path from "node:path"

const realJavac = ${JSON.stringify(javacExecutable)}
const controlPath = ${JSON.stringify(controlPath)}
const eventPath = ${JSON.stringify(eventPath)}
const activePath = ${JSON.stringify(activePath)}
const overlapPath = ${JSON.stringify(overlapPath)}
const arguments_ = process.argv.slice(2)
const record = event => appendFileSync(eventPath, JSON.stringify({event, pid: process.pid}) + "\\n")

if (arguments_.length == 1 && arguments_[0] == "-version") {
  const child = spawn(realJavac, arguments_, {stdio: "inherit"})
  child.once("error", error => { console.error(error.message); process.exit(127) })
  child.once("close", (code, signal) => process.exit(signal == null ? code ?? 1 : 1))
} else {
  let activeDescriptor
  try {
    activeDescriptor = openSync(activePath, "wx")
    writeFileSync(activeDescriptor, JSON.stringify({pid: process.pid}) + "\\n")
    closeSync(activeDescriptor)
  } catch (error) {
    writeFileSync(overlapPath, JSON.stringify({pid: process.pid}) + "\\n")
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(97)
  }
  let finished = false
  let child
  const cleanup = event => {
    if (finished) return
    finished = true
    record(event)
    try { unlinkSync(activePath) } catch (error) { if (!(error && error.code == "ENOENT")) throw error }
  }
  const terminate = signal => {
    record("termination-requested")
    if (child) child.kill(signal)
    cleanup("compile-terminated")
    process.exit(signal == "SIGTERM" ? 143 : 130)
  }
  process.on("SIGTERM", () => terminate("SIGTERM"))
  process.on("SIGINT", () => terminate("SIGINT"))
  record("compile-start")
  let control = {mode: "normal"}
  try { control = JSON.parse(readFileSync(controlPath, "utf8")) } catch (error) {
    if (!(error && error.code == "ENOENT")) throw error
  }
  writeFileSync(controlPath, JSON.stringify({mode: "normal"}) + "\\n")
  if (control.mode == "invalid") {
    const javaPath = arguments_.find(argument => argument.endsWith(".java"))
    if (!javaPath) throw new Error("Invalid-Java fixture received no Java artifact.")
    appendFileSync(javaPath, "this is not valid Java\\n")
    record("candidate-corrupted")
  }
  if (control.mode == "block") {
    const released = new Promise((resolve, reject) => {
      const watcher = watch(path.dirname(control.release), () => {
        if (!existsSync(control.release)) return
        watcher.close()
        resolve()
      })
      watcher.once("error", reject)
      if (existsSync(control.release)) {
        watcher.close()
        resolve()
      }
    })
    writeFileSync(control.marker, JSON.stringify({pid: process.pid}) + "\\n")
    await released
    record("compile-released")
  }
  record("real-javac-start")
  child = spawn(realJavac, arguments_, {stdio: ["ignore", "pipe", "pipe"]})
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  child.once("error", error => {
    console.error(error.message)
    cleanup("compile-error")
    process.exit(127)
  })
  child.once("close", (code, signal) => {
    cleanup("compile-close")
    process.exit(signal == null ? code ?? 1 : 1)
  })
}
`

  await writeFile(executable, proxySource)
  await chmod(executable, 0o700)
  await writeFile(controlPath, `${JSON.stringify({mode: "normal"})}\n`)

  return {
    activePath,
    async blockNextCompile(name) {
      const markerPath = path.join(root, `${name}-started.json`)
      const releasePath = path.join(root, `${name}-release.json`)
      const started = waitForFile(markerPath).then(bytes => JSON.parse(bytes.toString("utf8")))

      await writeFile(controlPath, `${JSON.stringify({marker: markerPath, mode: "block", release: releasePath})}\n`)

      return {release: () => writeFile(releasePath, "release\n"), started}
    },
    compileEvents() {
      try {
        return readJsonLines(eventPath)
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code == "ENOENT") return []
        throw error
      }
    },
    executable,
    async failNextCompile() {
      await writeFile(controlPath, `${JSON.stringify({mode: "invalid"})}\n`)
    },
    overlapPath
  }
}

/**
 * Starts one NDJSON watch process and exposes event-based record waits.
 * @param {string} executable - Packed CLI.
 * @param {string} cwd - Project root.
 * @param {NodeJS.ProcessEnv} environment - Exact process environment.
 * @returns {WatchProcess}
 */
function runWatch(executable, cwd, environment) {
  const child = spawn(executable, ["watch", "--check", "--ndjson"], {cwd, env: environment, stdio: ["ignore", "pipe", "pipe"]})
  /** @type {Record<string, any>[]} */
  const records = []
  /** @type {{predicate: (record: Record<string, any>) => boolean, reject: (error: Error) => void, resolve: (record: Record<string, any>) => void}[]} */
  const waiting = []
  let stdout = ""
  let stderr = ""

  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", chunk => {
    stderr += chunk
  })
  child.stdout.on("data", chunk => {
    stdout += chunk
    let newline

    while ((newline = stdout.indexOf("\n")) != -1) {
      const line = stdout.slice(0, newline)

      stdout = stdout.slice(newline + 1)
      if (line.length == 0) continue
      const record = JSON.parse(line)

      records.push(record)
      for (let index = waiting.length - 1; index >= 0; index -= 1) {
        if (waiting[index].predicate(record)) waiting.splice(index, 1)[0].resolve(record)
      }
    }
  })
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => {
      const error = new Error(`Watch process closed before ${waiting.length} awaited record(s).`)

      for (const waiter of waiting.splice(0)) waiter.reject(error)
      resolve({code, signal})
    })
  })

  return {
    child,
    closed,
    next(predicate) {
      const existing = records.find(predicate)

      if (existing !== undefined) return Promise.resolve(existing)

      return new Promise((resolve, reject) => waiting.push({predicate, reject, resolve}))
    },
    records: () => [...records],
    stderr: () => stderr
  }
}

/** @param {string} filename @returns {Promise<Buffer>} */
function waitForFile(filename) {
  return new Promise((resolve, reject) => {
    let settled = false
    const watcher = watchFileSystem(path.dirname(filename), () => void inspect())
    const finish = (error, bytes) => {
      if (settled) return
      settled = true
      watcher.close()
      if (error) reject(error)
      else resolve(/** @type {Buffer} */ (bytes))
    }
    const inspect = async () => {
      try {
        finish(undefined, await readFile(filename))
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code == "ENOENT")) finish(/** @type {Error} */ (error))
      }
    }

    watcher.once("error", error => finish(error))
    void inspect()
  })
}

/** @param {string} initial @param {string} label @param {number} left @returns {string} */
function editedSource(initial, label, left) {
  return initial.replace('console.log("task-044")', `console.log(${JSON.stringify(label)})`)
    .replace("add(2, 3)", `add(${left}, 3)`)
}

/** @param {Record<string, any>} diagnostic @returns {Record<string, any>[]} */
function diagnosticChain(diagnostic) {
  const result = []
  let current = diagnostic

  while (current && typeof current == "object") {
    result.push(current)
    current = current.cause
  }

  return result
}

/** @param {Readonly<{event: string, pid: number}[]>} events */
function assertSerializedCompilerEvents(events) {
  let active = 0
  let maximum = 0

  for (const {event} of events) {
    if (event == "compile-start") {
      active += 1
      maximum = Math.max(maximum, active)
    }
    if (["compile-close", "compile-error", "compile-terminated"].includes(event)) active -= 1
    assert.ok(active >= 0, `Unexpected compiler event order: ${JSON.stringify(events)}`)
  }
  expect(maximum).toEqual(1)
  expect(active).toEqual(0)
}

/** @param {string} filename @returns {boolean} */
function fileExists(filename) {
  try {
    readFileSync(filename)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ENOENT") return false
    throw error
  }
}

/** @param {string} filename @returns {{event: string, pid: number}[]} */
function readJsonLines(filename) {
  return readFileSync(filename, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
}

/** @param {string} executable @param {string[]} arguments_ @param {NodeJS.ProcessEnv} environment @param {string} cwd */
function runCommand(executable, arguments_, environment, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {cwd, env: environment, stdio: ["ignore", "pipe", "pipe"]})
    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", chunk => {
      stdout += chunk
    })
    child.stderr.on("data", chunk => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({code, signal, stderr, stdout}))
  })
}

/** @param {Buffer} bytes @returns {string} */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

/** @param {string} output @returns {Record<string, any>} */
function parsePackResult(output) {
  const start = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1)

  assert.notEqual(start, -1, output)
  const parsed = JSON.parse(output.slice(start == 0 ? 0 : start + 1))

  assert.equal(parsed.length, 1)

  return parsed[0]
}

/**
 * @typedef ActiveEvidence
 * @property {Buffer} classBytes
 * @property {string} classPath
 * @property {string} generationId
 * @property {Buffer} javaBytes
 * @property {string} javaPath
 * @property {Buffer} pointerBytes
 */

/**
 * @typedef CompilerProxy
 * @property {string} activePath
 * @property {(name: string) => Promise<{release: () => Promise<void>, started: Promise<{pid: number}>}>} blockNextCompile
 * @property {() => {event: string, pid: number}[]} compileEvents
 * @property {string} executable
 * @property {() => Promise<void>} failNextCompile
 * @property {string} overlapPath
 */

/**
 * @typedef WatchProcess
 * @property {import("node:child_process").ChildProcessWithoutNullStreams} child
 * @property {Promise<{code: number | null, signal: NodeJS.Signals | null}>} closed
 * @property {(predicate: (record: Record<string, any>) => boolean) => Promise<Record<string, any>>} next
 * @property {() => Record<string, any>[]} records
 * @property {() => string} stderr
 */
