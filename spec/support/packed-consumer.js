// @ts-check

const internalPackageName = "semantifold-tree-sitter-legacy-internal"
const retiredPackageName = "@kaspernj/semantifold-tree-sitter-legacy"

export const typeConsumerSource = `
import {generateArtifactSet, parse, supportedLanguages} from "semantifold"

const parser: typeof parse = parse
const languages: readonly string[] = supportedLanguages
const cModule = parse({language: "c", filename: "program.c", source: ""})
const cArtifacts = generateArtifactSet({language: "c", module: cModule})

void parser
void languages
void cArtifacts
const cppModule = parse({language: "cpp", filename: "program.cpp", source: ""})
const cppArtifacts = generateArtifactSet({language: "cpp", module: cppModule})
void cppArtifacts
const rustModule = parse({language: "rust", filename: "src/main.rs", source: "fn main() {}"})
const rustArtifacts = generateArtifactSet({language: "rust", module: rustModule})
void rustArtifacts
const kotlinModule = parse({language: "kotlin", filename: "Program.kt", source:
  "fun add(left: Long, right: Long): Long { return left + right }\\nfun main() { println(add(1, 2)) }\\n"})
const kotlinArtifacts = generateArtifactSet({language: "kotlin", module: kotlinModule})
void kotlinArtifacts
`

export const consumerSource = `
import assert from "node:assert/strict"
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises"
import {spawnSync} from "node:child_process"
import {createHash} from "node:crypto"
import os from "node:os"
import {createRequire} from "node:module"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import * as semantifold from "semantifold"

const internalPackageName = "${internalPackageName}"
const retiredPackageName = "${retiredPackageName}"
const consumerRequire = createRequire(import.meta.url)
const semantifoldEntry = fileURLToPath(import.meta.resolve("semantifold"))
const semantifoldDirectory = path.dirname(path.dirname(semantifoldEntry))
const semantifoldRequire = createRequire(semantifoldEntry)
const internalEntry = semantifoldRequire.resolve(internalPackageName)
const internalDirectory = path.dirname(path.dirname(internalEntry))
const internalRequire = createRequire(internalEntry)
const modernRuntimePath = semantifoldRequire.resolve("tree-sitter")
const legacyRuntimePath = internalRequire.resolve("tree-sitter")
const rustGrammarPath = internalRequire.resolve("tree-sitter-rust")
const rustGrammar = JSON.parse(await readFile(internalRequire.resolve("tree-sitter-rust/package.json"), "utf8"))
const cppGrammarPath = internalRequire.resolve("tree-sitter-cpp")
const cppGrammar = JSON.parse(await readFile(internalRequire.resolve("tree-sitter-cpp/package.json"), "utf8"))
const cGrammarPath = internalRequire.resolve("tree-sitter-c")
const goGrammarPath = semantifoldRequire.resolve("tree-sitter-go/bindings/node/index.js")
const kotlinGrammarPath = semantifoldRequire.resolve("tree-sitter-kotlin")
const kotlinGrammar = JSON.parse(await readFile(semantifoldRequire.resolve("tree-sitter-kotlin/package.json"), "utf8"))
const modernRuntime = JSON.parse(await readFile(semantifoldRequire.resolve("tree-sitter/package.json"), "utf8"))
const legacyRuntime = JSON.parse(await readFile(internalRequire.resolve("tree-sitter/package.json"), "utf8"))
const cGrammar = JSON.parse(await readFile(internalRequire.resolve("tree-sitter-c/package.json"), "utf8"))
const internalManifest = JSON.parse(await readFile(path.join(internalDirectory, "package.json"), "utf8"))

for (const filename of [semantifoldEntry, internalEntry, modernRuntimePath, legacyRuntimePath, cGrammarPath, cppGrammarPath,
  rustGrammarPath, kotlinGrammarPath]) {
  assert.ok((await realpath(filename)).startsWith(path.join(process.cwd(), "node_modules") + path.sep))
}
const {parseCst} = await import(pathToFileURL(internalEntry).href)
const {default: Parser} = await import(pathToFileURL(modernRuntimePath).href)
const {default: GoLanguage} = await import(pathToFileURL(goGrammarPath).href)
const goParser = new Parser()

goParser.setLanguage(GoLanguage)
const goTree = goParser.parse("package main\\nfunc main() {}\\n")
const cSnapshot = parseCst("/* 😀 */\\r\\nint main(void) { return 0; }\\r\\n")

function isPlainFrozenData(value) {
  if (value == null || ["boolean", "number", "string"].includes(typeof value)) return true
  if (typeof value != "object" || !Object.isFrozen(value)) return false
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false
  return Reflect.ownKeys(value).every((key) => typeof key == "string" && isPlainFrozenData(value[key]))
}

const rustSnapshot = parseCst("/* 😀 */ fn main() {}", "rust")
assert.equal(rustSnapshot.language, "rust")
assert.equal(rustSnapshot.root.hasError, false)
const cppSnapshot = parseCst("std::string copy(std::string a, std::string b) { return a; }", "cpp")
assert.equal(cppSnapshot.language, "cpp")
assert.equal(cppSnapshot.root.hasError, false)
assert.equal(goTree.rootNode.hasError, false)
assert.equal(cSnapshot.root.hasError, false)
assert.equal(cSnapshot.root.endIndex, "/* 😀 */\\r\\nint main(void) { return 0; }\\r\\n".length)
assert.deepEqual(JSON.parse(JSON.stringify(cSnapshot)), cSnapshot)
const semanticC = semantifold.parse({language: "c", filename: "program.c", source:
  '#include "semantifold_runtime.h"\\nstatic int64_t add(int64_t left, int64_t right) { return left + right; }\\n' +
  'int main(void) { semantifold_print_integer(add(1, 2)); semantifold_cleanup(); return 0; }\\n'})
const cArtifacts = semantifold.generateArtifactSet({language: "c", module: semanticC})
assert.deepEqual(cArtifacts.artifacts.map(({path: artifactPath}) => artifactPath), ["program.c", "semantifold_runtime.h"])
assert.equal(semantifold.parse({language: "c", filename: "program.c", source: cArtifacts.artifacts[0].content}).functions[0].name, "add")
const cppArtifact = semantifold.generateArtifact({language: "cpp", module: semanticC})
const cppModule = semantifold.parse({language: "cpp", filename: "program.cpp", source: cppArtifact.code})
assert.equal(cppModule.functions[0].name, "add")
assert.equal(semantifold.generate({language: "cpp", module: cppModule}), cppArtifact.code)
assert.throws(() => consumerRequire.resolve(internalPackageName), {code: "MODULE_NOT_FOUND"})
assert.throws(() => semantifoldRequire.resolve(retiredPackageName), {code: "MODULE_NOT_FOUND"})
const rustArtifacts = semantifold.generateArtifactSet({language: "rust", module: semanticC})
assert.deepEqual(rustArtifacts.artifacts.map(({path: artifactPath}) => artifactPath), ["Cargo.toml", "Cargo.lock", "src/main.rs"])
const rustModule = semantifold.parse({language: "rust", filename: "src/main.rs", source: rustArtifacts.artifacts[2].content})
assert.equal(rustModule.functions[0].name, "add")
assert.deepEqual(semantifold.generateArtifactSet({language: "rust", module: rustModule}).artifacts.map(({content}) => content),
  rustArtifacts.artifacts.map(({content}) => content))
const nativeProof = []
const rustc = await semantifold.discoverCanonicalToolchain("rustc")
const cargo = await semantifold.discoverCanonicalToolchain("cargo")
const crate = await mkdtemp(path.join(os.tmpdir(), "semantifold-packed-rust-"))
const digest = content => createHash("sha256").update(content).digest("hex")
const hashes = rustArtifacts.artifacts.map(({content}) => digest(content))
try {
  for (const artifact of rustArtifacts.artifacts) {
    const filename = path.join(crate, artifact.path)
    await mkdir(path.dirname(filename), {recursive: true})
    await writeFile(filename, artifact.content)
  }
  const env = {PATH: process.env.PATH, HOME: crate, CARGO_HOME: path.join(crate, "empty-cargo-home"), RUSTC: rustc.executable,
    CARGO_NET_OFFLINE: "true", CARGO_TERM_COLOR: "never", LANG: "C.UTF-8", LC_ALL: "C.UTF-8"}
  const invoke = (executable, args) => {
    const result = spawnSync(executable, args, {cwd: crate, env, encoding: "utf8", timeout: 30000, maxBuffer: 1048576})
    nativeProof.push({executable, arguments: args, stdout: result.stdout, stderr: result.stderr, status: result.status, signal: result.signal})
    if (result.error) throw result.error
    assert.equal(result.status, 0, JSON.stringify(nativeProof.at(-1)))
    assert.equal(result.signal, null)
    return result
  }
  invoke(cargo.executable, ["check", "--offline", "--locked"])
  for (const mode of ["debug", "release"]) {
    const flags = mode == "release" ? ["--release"] : []
    invoke(cargo.executable, ["build", "--offline", "--locked", ...flags])
    const direct = invoke(path.join(crate, "target", mode, "semantifold-generated"), [])
    const run = invoke(cargo.executable, ["run", "--offline", "--locked", "--quiet", ...flags])
    assert.equal(direct.stdout, "3\\n")
    assert.equal(direct.stderr, "")
    assert.equal(run.stdout, direct.stdout)
    assert.equal(run.stderr, "")
  }
  for (const [index, artifact] of rustArtifacts.artifacts.entries()) assert.equal(digest(await readFile(path.join(crate, artifact.path))), hashes[index])
} finally {
  await writeFile("rust-command-results.json", JSON.stringify({tools: {rustc, cargo}, commands: nativeProof, artifacts: rustArtifacts, hashes}, null, 2) + "\\n")
  await rm(crate, {recursive: true, force: true})
}
const kotlinArtifacts = semantifold.generateArtifactSet({language: "kotlin", module: semanticC})
assert.deepEqual(kotlinArtifacts.artifacts.map(({path: artifactPath}) => artifactPath), ["Program.kt"])
assert.equal(kotlinArtifacts.metadata.compiler.version, "2.4.20")
assert.deepEqual(semantifold.generateArtifactSet({language: "kotlin", module: semanticC}), kotlinArtifacts)
const kotlinModule = semantifold.parse({language: "kotlin", filename: "Program.kt", source: kotlinArtifacts.artifacts[0].content})
assert.equal(kotlinModule.functions[0].name, "add")
assert.equal(semantifold.generateArtifactSet({language: "kotlin", module: kotlinModule}).artifacts[0].content,
  kotlinArtifacts.artifacts[0].content)
const kotlinc = await semantifold.discoverCanonicalToolchain("kotlinc")
const java = await semantifold.discoverCanonicalToolchain("java25")
const kotlinDirectory = await mkdtemp(path.join(os.tmpdir(), "semantifold-packed-kotlin-"))
const kotlinCommands = []
try {
  await writeFile(path.join(kotlinDirectory, "Program.kt"), kotlinArtifacts.artifacts[0].content)
  const kotlinEnvironment = {PATH: process.env.PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8"}
  const invokeKotlin = (executable, args) => {
    const result = spawnSync(executable, args, {cwd: kotlinDirectory, env: kotlinEnvironment, encoding: "utf8", timeout: 30000,
      maxBuffer: 1048576})
    kotlinCommands.push({executable, arguments: args, stdout: result.stdout, stderr: result.stderr, status: result.status,
      signal: result.signal})
    if (result.error) throw result.error
    assert.equal(result.status, 0, JSON.stringify(kotlinCommands.at(-1)))
    assert.equal(result.signal, null)
    return result
  }
  invokeKotlin(kotlinc.executable, ["-language-version", "2.4", "-api-version", "2.4", "-jvm-target", "25", "-Werror",
    "-include-runtime", "Program.kt", "-d", "Program.jar"])
  const kotlinRun = invokeKotlin(java.executable, ["-jar", "Program.jar"])
  assert.equal(kotlinRun.stdout, "3\\n")
  assert.equal(kotlinRun.stderr, "")
} finally {
  await writeFile("kotlin-command-results.json", JSON.stringify({tools: {kotlinc, java}, commands: kotlinCommands,
    artifacts: kotlinArtifacts}, null, 2) + "\\n")
  await rm(kotlinDirectory, {recursive: true, force: true})
}
process.stdout.write(JSON.stringify({
  rustGrammarVersion: rustGrammar.version,
  rustGrammarIsInternal: rustGrammarPath.startsWith(internalDirectory + path.sep),
  rustSnapshotIsPlainFrozenData: isPlainFrozenData(rustSnapshot),
  rustRoundTrip: true,
  rustNativeModes: ["debug", "release"],
  rustArtifactsStable: true,
  cppGrammarVersion: cppGrammar.version,
  cppGrammarIsInternal: cppGrammarPath.startsWith(internalDirectory + path.sep),
  cppSnapshotIsPlainFrozenData: isPlainFrozenData(cppSnapshot),
  cppRoundTrip: true,
  cGrammarVersion: cGrammar.version,
  cRoot: cSnapshot.root.type,
  grammarIsInternal: cGrammarPath.startsWith(internalDirectory + path.sep),
  goRoot: goTree.rootNode.type,
  kotlinCompilerVersion: kotlinc.version,
  kotlinJavaVersion: java.version,
  kotlinGrammarVersion: kotlinGrammar.version,
  kotlinGrammarIsBundled: kotlinGrammarPath.startsWith(semantifoldDirectory + path.sep),
  kotlinRoundTrip: true,
  kotlinRuntimeOutput: "3\\n",
  internalPackageIsNotConsumerDependency: true,
  internalPackageIsPrivate: internalManifest.private === true && internalManifest.exports === undefined,
  legacyRuntimeIsInternal: legacyRuntimePath.startsWith(internalDirectory + path.sep),
  legacyRuntimeVersion: legacyRuntime.version,
  modernRuntimeIsBundled: modernRuntimePath.startsWith(semantifoldDirectory + path.sep),
  modernRuntimeVersion: modernRuntime.version,
  pathsAreDistinct: modernRuntimePath !== legacyRuntimePath,
  retiredPackageIsAbsent: true,
  rootApiIsPrivate: !("parseCst" in semantifold),
  snapshotIsPlainFrozenData: isPlainFrozenData(cSnapshot)
}))
`
