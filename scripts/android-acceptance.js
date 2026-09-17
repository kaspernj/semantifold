// @ts-check

import {execFile} from "node:child_process"
import {constants as fsConstants} from "node:fs"
import {access} from "node:fs/promises"
import {chmod, mkdtemp, mkdir, readFile, readdir, rm, stat} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {generateProgramArtifactSet, parseProgram} from "../index.js"
import {materializeAndroidAcceptanceProject} from "./android-materialization.js"

const executeFile = promisify(execFile)
const infrastructurePrefix = "SEMANTIFOLD_ANDROID_INFRASTRUCTURE:"
const expectedOutput = "hé😀\nhé😀!\nhé😀!?"

const sources = [{
  filename: "main.rb",
  id: "main",
  language: /** @type {const} */ ("ruby"),
  source: `require_relative "math_tools"
module Main
  puts MathTools.decorate(MathTools.decorate("hé😀", "!"), "?")
end
`
}, {
  filename: "math_tools.rb",
  id: "math_tools",
  language: /** @type {const} */ ("ruby"),
  source: `module MathTools
  module_function
  # @param value [String]
  # @param suffix [String]
  # @return [String]
  def decorate(value, suffix)
    puts value
    return value + suffix
  end
end
`
}]

try {
  const mode = process.argv[2] == "--check" ? "check" : process.env.SEMANTIFOLD_ANDROID_MODE
  const tools = await checkInfrastructure(mode)

  if (mode == "check") process.exit(0)
  if (mode != "prepare" && mode != "offline-build") infrastructure("Mode must be 'prepare' or 'offline-build'.")
  const temporary = mode == "prepare"
  const root = temporary
    ? await mkdtemp(path.join(os.tmpdir(), "semantifold-android-prefetch-"))
    : process.env.SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT

  if (typeof root != "string" || !path.isAbsolute(root)) infrastructure("Offline acceptance root must be an absolute path.")
  if (!temporary) await mkdir(root, {mode: 0o700})
  const buildEnvironment = {
    ...tools.environment,
    SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: root
  }

  try {
    const set = generateProgramArtifactSet({
      language: "android",
      program: parseProgram({entryModule: "main", sources}),
      role: "application"
    })
    const materialized = await materializeAndroidAcceptanceProject(set, root)
    await createDebugKeystore(tools.keytool, root, buildEnvironment)
    const common = ["--no-daemon", "--console=plain", "--stacktrace"]

    if (mode == "prepare") {
      await gradle(tools.gradle, materialized.projectDirectory,
        [...common, "lintDebug", "testDebugUnitTest", "assembleDebug", "assembleDebugAndroidTest"], buildEnvironment)
    } else {
      const arguments_ = [...common, "--offline", "lintDebug", "testDebugUnitTest", "assembleDebug", "assembleDebugAndroidTest"]

      await gradle(tools.gradle, materialized.projectDirectory, arguments_, buildEnvironment)
      const runtime = await gradle(tools.gradle, materialized.projectDirectory,
        [...common, "--offline", ":app:dependencies", "--configuration", "debugRuntimeClasspath"], buildEnvironment)
      const tests = await gradle(tools.gradle, materialized.projectDirectory,
        [...common, "--offline", ":app:dependencies", "--configuration", "debugUnitTestRuntimeClasspath"], buildEnvironment)
      const runtimeDependencies = dependencyEntries(runtime.stdout)
      const testDependencies = dependencyEntries(tests.stdout)

      if (runtimeDependencies.length != 0) {
        throw new Error(`Runtime dependency graph must be empty, received: ${dependencyDescriptions(runtimeDependencies)}.`)
      }
      const expectedTestDependencies = new Set(["junit:junit:4.13.2", "org.hamcrest:hamcrest-core:1.3"])
      const testDependencySet = new Set(testDependencies.map(({coordinate}) => coordinate))

      if (testDependencies.length != expectedTestDependencies.size ||
        testDependencySet.size != expectedTestDependencies.size ||
        [...expectedTestDependencies].some(coordinate => !testDependencySet.has(coordinate))) {
        throw new Error(`Unit-test dependency graph differs from exact non-transitive junit:junit:4.13.2 and org.hamcrest:hamcrest-core:1.3: ${dependencyDescriptions(testDependencies)}.`)
      }
      const apk = path.join(materialized.projectDirectory, "app/build/outputs/apk/debug/app-debug.apk")
      const testApk = path.join(materialized.projectDirectory, "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk")

      await rejectApkDependency(apk, "org/junit/")
      await rejectApkDependency(apk, "org/hamcrest/")
      await rejectApkDependency(apk, "kotlin/jvm/internal/")
      await rejectApkDependency(apk, "kotlin/collections/")
      await requireApkDependency(testApk, "kotlin/jvm/internal/Intrinsics")
      process.stdout.write(`${JSON.stringify({
        acceptanceRoot: root,
        apk,
        expectedOutputBase64: Buffer.from(expectedOutput, "utf8").toString("base64"),
        projectDirectory: materialized.projectDirectory,
        testApk
      })}\n`)
    }
  } finally {
    if (temporary) await rm(root, {force: true, recursive: true})
  }
} catch (error) {
  const classified = error instanceof Error && error.message.startsWith(infrastructurePrefix)
  const message = error instanceof Error ? error.stack ?? error.message : String(error)

  process.stderr.write(`${message}\n`)
  process.exitCode = classified ? 2 : 1
}

async function checkInfrastructure(mode) {
  const androidHome = requiredDirectory("SEMANTIFOLD_ANDROID_HOME")
  const gradleHome = requiredDirectory("SEMANTIFOLD_GRADLE_HOME")
  const gradleUserHome = requiredDirectory("SEMANTIFOLD_GRADLE_USER_HOME")
  const javaHome = requiredDirectory("JAVA_HOME")
  const kotlinHome = requiredDirectory("SEMANTIFOLD_KOTLIN_HOME")
  const gradle = path.join(gradleHome, "bin/gradle")
  const keytool = path.join(javaHome, "bin/keytool")
  const environment = {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    GRADLE_USER_HOME: gradleUserHome,
    JAVA_HOME: javaHome,
    SEMANTIFOLD_KOTLIN_HOME: kotlinHome,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC"
  }

  for (const [name, directory] of [["Android SDK", androidHome], ["Gradle", gradleHome],
    ["Gradle cache", gradleUserHome], ["Java", javaHome], ["Kotlin", kotlinHome]]) {
    try {
      if (!(await stat(directory)).isDirectory()) infrastructure(`${name} path is not a directory: ${directory}`)
    } catch (error) {
      infrastructure(`${name} directory is missing: ${directory}`, error)
    }
  }
  for (const executable of [gradle, path.join(javaHome, "bin/java"), keytool, path.join(kotlinHome, "bin/kotlinc"),
    path.join(androidHome, "platform-tools/adb"),
    path.join(androidHome, "emulator/emulator"), path.join(androidHome, "build-tools/35.0.0/aapt2")]) {
    try {
      const information = await stat(executable)

      if (!information.isFile()) infrastructure(`Required executable is missing: ${executable}`)
      await access(executable, fsConstants.X_OK)
    } catch (error) {
      infrastructure(`Required tool is missing or is not executable: ${executable}`, error)
    }
  }
  try {
    if (!(await stat(path.join(kotlinHome, "lib/kotlin-stdlib.jar"))).isFile()) {
      infrastructure("Pinned Kotlin stdlib is not a file.")
    }
  } catch (error) {
    infrastructure("Pinned Kotlin stdlib is missing.", error)
  }
  if (mode != "prepare" && (await readdir(gradleUserHome)).length == 0) {
    infrastructure("The declared offline Gradle cache is empty.")
  }
  const gradleVersion = await infrastructureCommand(gradle, ["--version"], environment, "Gradle")
  const javaVersion = await infrastructureCommand(path.join(javaHome, "bin/java"), ["-version"], environment, "Java")
  const kotlinVersion = await infrastructureCommand(path.join(kotlinHome, "bin/kotlinc"), ["-version"], environment, "Kotlin")
  const emulatorVersion = await infrastructureCommand(
    path.join(androidHome, "emulator/emulator"), ["-version"], environment, "Android emulator")

  if (!/^Gradle 8\.14$/mu.test(gradleVersion.stdout)) infrastructure("Gradle is not exact version 8.14.")
  if (!/version "21\.0\.8"/u.test(javaVersion.stderr)) infrastructure("Java is not exact version 21.0.8.")
  if (!/kotlinc-jvm 2\.2\.10/u.test(kotlinVersion.stderr)) infrastructure("Kotlin is not exact version 2.2.10.")
  if (!/Android emulator version 35\.6\.11/u.test(`${emulatorVersion.stdout}\n${emulatorVersion.stderr}`)) {
    infrastructure("Android emulator is not exact version 35.6.11.")
  }
  for (const sdkPath of ["platforms/android-35/android.jar", "build-tools/35.0.0/aapt2",
    "system-images/android-35/google_apis/x86_64/system.img"]) {
    let information

    try {
      information = await stat(path.join(androidHome, sdkPath))
    } catch (error) {
      infrastructure(`Required Android SDK package is missing: ${sdkPath}`, error)
    }
    if (!information.isFile()) infrastructure(`Required Android SDK package is not a file: ${sdkPath}`)
  }
  await requireProperties(path.join(androidHome, "platform-tools/source.properties"), ["Pkg.Revision=37.0.1"], "Platform Tools")
  await requireProperties(path.join(androidHome, "platforms/android-35/source.properties"),
    ["Pkg.Revision=2", "AndroidVersion.ApiLevel=35"], "Android platform")
  await requireProperties(path.join(androidHome, "build-tools/35.0.0/source.properties"),
    ["Pkg.Revision=35.0.0"], "Build Tools")
  await requireProperties(path.join(androidHome, "emulator/source.properties"),
    ["Pkg.Revision=35.6.11", "Pkg.BuildId=13610412"], "Android emulator")
  await requireProperties(path.join(androidHome, "system-images/android-35/google_apis/x86_64/source.properties"),
    ["Pkg.Revision=9", "AndroidVersion.ApiLevel=35", "SystemImage.Abi=x86_64", "SystemImage.TagId=google_apis"],
    "Android system image")

  return {environment, gradle, keytool}
}

/**
 * Requires exact package properties for one checksum-installed Android archive.
 * @param {string} filename - Installed source.properties path.
 * @param {string[]} requiredLines - Exact required property lines.
 * @param {string} name - Stable package name.
 */
async function requireProperties(filename, requiredLines, name) {
  let lines

  try {
    lines = new Set((await readFile(filename, "utf8")).split(/\r?\n/u))
  } catch (error) {
    infrastructure(`${name} provenance is missing: ${filename}`, error)
  }
  for (const line of requiredLines) {
    if (!lines.has(line)) infrastructure(`${name} provenance does not contain exact '${line}'.`)
  }
}

function requiredDirectory(name) {
  const value = process.env[name]

  if (!value || !path.isAbsolute(value)) infrastructure(`${name} must name an absolute qualified tool directory.`)

  return value
}

async function gradle(executable, directory, arguments_, environment) {
  try {
    return await executeFile(executable, arguments_, {cwd: directory, env: environment, maxBuffer: 40 * 1024 * 1024})
  } catch (error) {
    let output = ""

    if (error && typeof error == "object") {
      const standardOutput = Reflect.get(error, "stdout")
      const standardError = Reflect.get(error, "stderr")

      if (standardOutput) process.stderr.write(String(standardOutput))
      if (standardError) process.stderr.write(String(standardError))
      output = `${String(standardOutput ?? "")}\n${String(standardError ?? "")}`
    }
    if (arguments_.includes("--offline") &&
      /(?:offline mode|no cached version|not available for offline|cached resource is missing)/iu.test(output)) {
      infrastructure("Offline Gradle cache is incomplete.", error)
    }
    throw error
  }
}

/**
 * Runs one version probe as an infrastructure-owned operation.
 * @param {string} executable - Qualified executable.
 * @param {string[]} arguments_ - Exact version arguments.
 * @param {NodeJS.ProcessEnv} environment - Qualified deterministic environment.
 * @param {string} name - Stable tool label.
 * @returns {Promise<{stderr: string, stdout: string}>} Captured version output.
 */
async function infrastructureCommand(executable, arguments_, environment, name) {
  try {
    return await executeFile(executable, arguments_, {env: environment})
  } catch (error) {
    infrastructure(`${name} version probe failed.`, error)
  }
}

async function rejectApkDependency(apk, marker) {
  const archive = await executeFile("unzip", ["-p", apk, "classes*.dex"], {encoding: "buffer", maxBuffer: 100 * 1024 * 1024})

  if (archive.stdout.includes(Buffer.from(marker, "utf8"))) throw new Error(`Runtime APK contains forbidden dependency marker '${marker}'.`)
}

async function requireApkDependency(apk, marker) {
  const archive = await executeFile("unzip", ["-p", apk, "classes*.dex"], {encoding: "buffer", maxBuffer: 100 * 1024 * 1024})

  if (!archive.stdout.includes(Buffer.from(marker, "utf8"))) {
    throw new Error(`Instrumentation APK is missing required runtime marker '${marker}'.`)
  }
}

/**
 * Creates the acceptance-only debug signing key below the private root.
 * @param {string} keytool - Qualified JDK keytool executable.
 * @param {string} root - Private acceptance root.
 * @param {NodeJS.ProcessEnv} environment - Qualified deterministic environment.
 * @returns {Promise<void>} Completion.
 */
async function createDebugKeystore(keytool, root, environment) {
  const destination = path.join(root, "debug.keystore")

  await executeFile(keytool, [
    "-genkeypair", "-noprompt", "-keystore", destination, "-storepass", "android", "-alias", "androiddebugkey",
    "-keypass", "android", "-dname", "CN=Android Debug,O=Android,C=US", "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000"
  ], {env: environment})
  await chmod(destination, 0o600)
}

/**
 * Extracts resolved external entries from one Gradle dependency report.
 * @param {string} output - Gradle dependency report output.
 * @returns {{coordinate: string, description: string}[]} Resolved entries in report order.
 */
function dependencyEntries(output) {
  return [...output.matchAll(/^[| ]*(?:\+---|\\---) ((\S+)(?: [^\r\n]*)?)$/gmu)]
    .flatMap(([, description, coordinate]) => description == "project :app (*)" ? [] : [{coordinate, description}])
}

/**
 * Formats only dependency descriptions already selected by the report parser.
 * @param {{description: string}[]} entries - Parsed dependency entries.
 * @returns {string} Full matched descriptions in report order.
 */
function dependencyDescriptions(entries) {
  return entries.map(({description}) => description).join(", ")
}

function infrastructure(message, cause) {
  throw new Error(`${infrastructurePrefix} ${message}`, cause === undefined ? undefined : {cause})
}
