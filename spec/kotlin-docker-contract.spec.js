// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import DockerfileAst from "dockerfile-ast"
import {parse as parseYaml} from "yaml"

const {DockerfileParser} = DockerfileAst
const executeFile = promisify(execFile)
const archive = "https://github.com/JetBrains/kotlin/releases/download/v2.4.20/kotlin-compiler-2.4.20.zip"
const checksum = "59e9ca74c7904ef2c122b12114937673ccce68de820a663f0ed66ccf8799e0b7"
const executable = "/opt/kotlinc/bin/kotlinc"
const installRoot = "/opt/kotlinc"
const convergenceCommand = `rm -rf ${installRoot}`
const moveCommand = `mv kotlinc ${installRoot}`
const compilerPermissionCommand = `chmod 0755 ${executable}`
const developmentJdkPackage = "openjdk-25-jdk-headless=25.0.4+7-1~26.04"
const tensorbuzzJdkPackage = "openjdk-25-jdk-headless=25.0.4+7-1~24.04"
const compilerReadback = `KOTLIN_VERSION_OUTPUT="$(${executable} -version 2>&1)"`
const compilerVersionPattern = String.raw`^info: kotlinc-jvm 2\.4\.20 \(JRE 25\.0\.4\+7-1-(24|26)\.04-Ubuntu\)$`
const compilerVersionProbe = `printf '%s\\n' "$KOTLIN_VERSION_OUTPUT" | grep --extended-regexp --quiet '${compilerVersionPattern}'`

/**
 * Extracts the exact compiler-version probe from one canonical bootstrap.
 * @param {string} name - Bootstrap name for assertion diagnostics.
 * @param {string} bootstrap - Canonical bootstrap source.
 * @returns {string} Executable shell probe.
 */
function extractCompilerVersionProbe(name, bootstrap) {
  const line = bootstrap.split("\n").find((candidate) => candidate.includes("grep --extended-regexp --quiet"))

  assert.ok(line, `${name} must contain a compiler-version probe`)
  let probe = line.trim()

  if (probe.startsWith("&& ")) probe = probe.slice(3)
  if (probe.endsWith(" \\")) probe = probe.slice(0, -2)
  assert.equal(probe, compilerVersionProbe, `${name} must use the exact shared compiler-version probe`)

  return probe
}

/**
 * Runs one canonical compiler-version probe through the host shell and GNU grep.
 * @param {string} probe - Exact shell probe.
 * @param {string} identity - Simulated kotlinc identity.
 * @returns {Promise<string | number>} Process exit code.
 */
async function compilerVersionProbeStatus(probe, identity) {
  try {
    await executeFile("sh", ["-eu", "-c", probe], {env: {...process.env, KOTLIN_VERSION_OUTPUT: identity}})

    return 0
  } catch (error) {
    if (error instanceof Error && "code" in error &&
      (typeof error.code == "number" || typeof error.code == "string")) return error.code
    throw error
  }
}

/**
 * Executes a canonical install lifecycle against an isolated stale destination.
 * @param {string} name - Bootstrap name for assertion diagnostics.
 * @param {string} bootstrap - Canonical bootstrap source.
 * @returns {Promise<void>} When the lifecycle converges to an executable fresh compiler tree.
 */
async function expectStaleInstallConvergence(name, bootstrap) {
  const convergenceIndex = bootstrap.indexOf(convergenceCommand)
  const moveIndex = bootstrap.indexOf(moveCommand)
  const permissionIndex = bootstrap.indexOf(compilerPermissionCommand)

  assert.ok(convergenceIndex >= 0, `${name} must remove the dedicated Kotlin destination`)
  assert.ok(moveIndex > convergenceIndex, `${name} must converge the destination before installing Kotlin`)
  assert.ok(permissionIndex > moveIndex, `${name} must restore the extracted Kotlin launcher's executable mode`)

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-kotlin-install-"))
  const extractionRoot = path.join(temporaryRoot, "extraction")
  const isolatedInstallRoot = path.join(temporaryRoot, "opt", "kotlinc")

  try {
    const extractedCompiler = path.join(extractionRoot, "kotlinc", "bin", "kotlinc")

    await mkdir(path.dirname(extractedCompiler), {recursive: true})
    await writeFile(extractedCompiler, "fresh\n")
    assert.equal((await stat(extractedCompiler)).mode & 0o111, 0, "fixture must model jar's non-executable extraction")
    await mkdir(path.join(isolatedInstallRoot, "kotlinc"), {recursive: true})
    await writeFile(path.join(isolatedInstallRoot, "stale"), "stale\n")

    const lifecycle = [convergenceCommand, moveCommand, compilerPermissionCommand]
      .map((command) => command.replaceAll(installRoot, isolatedInstallRoot)).join("\n")

    await executeFile("sh", ["-eu", "-c", lifecycle], {cwd: extractionRoot})
    expect(await readdir(isolatedInstallRoot)).toEqual(["bin"])
    expect(await readFile(path.join(isolatedInstallRoot, "bin", "kotlinc"), "utf8")).toEqual("fresh\n")
    assert.equal((await stat(path.join(isolatedInstallRoot, "bin", "kotlinc"))).mode & 0o777, 0o755)
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true})
  }
}

describe("Kotlin canonical compiler and JVM image contract", () => {
  it("admits only the qualified Ubuntu packaging suffixes through both canonical shell probes", async () => {
    const dockerSource = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const tensorbuzzSource = await readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8")
    const tensorbuzz = parseYaml(tensorbuzzSource)
    const probes = [
      ["Docker", extractCompilerVersionProbe("Docker", dockerSource)],
      ["TensorBuzz", extractCompilerVersionProbe("TensorBuzz", tensorbuzz.before_install.join("\n"))]
    ]
    const identities = [
      ["info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-24.04-Ubuntu)", 0],
      ["info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-26.04-Ubuntu)", 0],
      "info: kotlinc-jvm 2.4.10 (JRE 25.0.4+7-1-24.04-Ubuntu)",
      "info: kotlinc-jvm 2.4.20 (JRE 24.0.2+12-1-24.04-Ubuntu)",
      "info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-25.04-Ubuntu)",
      "info: kotlinc-js 2.4.20 (JRE 25.0.4+7-1-24.04-Ubuntu)"
    ].map((entry) => typeof entry == "string" ? [entry, 1] : entry)
    const outcomes = await Promise.all(probes.flatMap(([name, probe]) => identities.map(async ([identity, expected]) => ({
      actual: await compilerVersionProbeStatus(probe, identity), expected, identity, name
    }))))

    for (const {actual, expected, identity, name} of outcomes) {
      assert.equal(actual, expected, `${name} compiler probe classification for ${identity}`)
    }
  })

  it("pins and probes the official Kotlin 2.4.20 compiler without shadowing PATH", async () => {
    const source = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const instructions = DockerfileParser.parse(source).getInstructions()
    const runs = instructions.filter((instruction) => instruction.getKeyword() == "RUN")
      .map((instruction) => instruction.getArgumentsContent()).join("\n")

    expect(source).toContain(archive)
    expect(source).toContain(checksum)
    expect(source).toContain(developmentJdkPackage)
    expect(source).toContain(`ENV SEMANTIFOLD_KOTLINC=${executable}`)
    expect(runs).toContain(compilerReadback)
    expect(runs).toContain(compilerVersionProbe)
    expect(runs).toContain("openjdk version \"25.0.4\"")
    expect(source).not.toMatch(/ENV PATH=.*kotlinc|ln --symbolic .*kotlinc/u)
  })

  it("installs the same checksummed compiler and the exact Noble JDK build in TensorBuzz", async () => {
    const source = await readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8")
    const config = parseYaml(source)
    const beforeInstall = config.before_install.join("\n")

    expect(beforeInstall).toContain(archive)
    expect(beforeInstall).toContain(checksum)
    expect(beforeInstall).toContain(tensorbuzzJdkPackage)
    expect(beforeInstall).toContain(compilerReadback)
    expect(beforeInstall).toContain(compilerVersionProbe)
    expect(beforeInstall).toContain("openjdk version \"25.0.4\"")
    expect(config.environment.SEMANTIFOLD_KOTLINC).toEqual(executable)
    expect(config.environment.PATH).toEqual(undefined)
  })

  it("converges stale destinations and restores the launcher mode before both compiler probes", async () => {
    const dockerSource = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const tensorbuzzSource = await readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8")
    const tensorbuzz = parseYaml(tensorbuzzSource)

    await expectStaleInstallConvergence("Docker", dockerSource)
    await expectStaleInstallConvergence("TensorBuzz", tensorbuzz.before_install.join("\n"))
  })
})
