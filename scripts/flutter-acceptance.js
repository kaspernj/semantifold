// @ts-check

import {execFile} from "node:child_process"
import {constants as fsConstants} from "node:fs"
import {access, chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {generateProgramArtifactSet, parseProgram} from "../index.js"
import {materializeFlutterAcceptanceProject} from "./flutter-materialization.js"

const executeFile = promisify(execFile)
const infrastructurePrefix = "SEMANTIFOLD_FLUTTER_INFRASTRUCTURE:"
const expectedOutput = "hé😀\nhé😀!\nhé😀!?"
const expectedPackages = new Set([
  "async", "boolean_selector", "characters", "clock", "collection", "fake_async", "flutter", "flutter_test",
  "leak_tracker", "leak_tracker_flutter_testing", "leak_tracker_testing", "matcher", "material_color_utilities",
  "meta", "path", "semantifold_generated", "sky_engine", "source_span", "stack_trace", "stream_channel",
  "string_scanner", "term_glyph", "test_api", "vector_math", "vm_service"
])
const sources = [{
  filename: "main.rb",
  id: "main",
  language: /** @type {const} */ ("ruby"),
  source: `require_relative "math_tools"
module Main
  puts MathTools.decorate(MathTools.decorate(MathTools.formatter_canonical_zero_argument_function, "!"), "?")
end
`
}, {
  filename: "math_tools.rb",
  id: "math_tools",
  language: /** @type {const} */ ("ruby"),
  source: `module MathTools
  module_function
  # @return [String]
  def formatter_canonical_zero_argument_function
    return "hé😀"
  end

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
  const mode = process.argv[2] == "--check" ? "check" : process.env.SEMANTIFOLD_FLUTTER_MODE
  const tools = await checkInfrastructure(mode)

  if (mode == "check") process.exit(0)
  if (mode != "prepare" && mode != "offline-build") infrastructure("Mode must be 'prepare' or 'offline-build'.")
  const temporary = mode == "prepare"
  const root = temporary
    ? await mkdtemp(path.join(os.tmpdir(), "semantifold-flutter-prefetch-"))
    : process.env.SEMANTIFOLD_FLUTTER_ACCEPTANCE_ROOT

  if (typeof root != "string" || !path.isAbsolute(root)) infrastructure("Acceptance root must be an absolute path.")
  if (!temporary) await mkdir(root, {mode: 0o700})
  const environment = {...tools.environment, SEMANTIFOLD_FLUTTER_ACCEPTANCE_ROOT: root}

  try {
    const set = generateProgramArtifactSet({
      configuration: {applicationId: "dev.semantifold.flutter.generated", organization: "dev.semantifold"},
      language: "flutter",
      program: parseProgram({entryModule: "main", sources}),
      role: "application"
    })
    const materialized = await materializeFlutterAcceptanceProject(set, root)
    const project = materialized.projectDirectory
    const lockPath = path.join(project, "pubspec.lock")
    const lockBefore = await readFile(lockPath, "utf8")

    await writeFile(path.join(project, "android/local.properties"),
      `sdk.dir=${tools.androidHome}\nflutter.sdk=${tools.flutterHome}\n`, {flag: "wx", mode: 0o600})
    await createDebugKeystore(tools.keytool, root, environment)
    await command(tools.dart, ["pub", "get", "--offline", "--enforce-lockfile"], project, environment)
    if (await readFile(lockPath, "utf8") != lockBefore) throw new Error("Offline pub resolution changed the owned lockfile.")
    await verifyPackageConfiguration(path.join(project, ".dart_tool/package_config.json"))
    await command(tools.dart, ["format", "--output=none", "--set-exit-if-changed", "lib", "test"], project, environment)
    await command(tools.dart, [tools.flutterSnapshot, "analyze", "--no-pub", "--fatal-infos", "--fatal-warnings"],
      project, environment)
    await command(tools.dart, [tools.flutterSnapshot, "test", "--no-pub", "--reporter", "expanded"],
      project, environment)
    const common = ["--no-daemon", "--console=plain", "--stacktrace"]
    const tasks = ["lintDebug", "assembleDebug"]

    await command(tools.gradle, [...common, ...(mode == "offline-build" ? ["--offline"] : []), ...tasks],
      path.join(project, "android"), environment)
    if (!temporary) {
      const dependencies = await command(tools.gradle,
        [...common, "--offline", ":app:dependencies", "--configuration", "debugRuntimeClasspath"],
        path.join(project, "android"), environment)
      const apk = path.join(project, "build/app/outputs/flutter-apk/app-debug.apk")

      if (!dependencies.stdout.includes("io.flutter:flutter_embedding_debug")) {
        throw new Error("Flutter Android runtime graph is missing the SDK-owned embedding.")
      }
      if (dependencies.stdout.includes("androidx.profileinstaller:profileinstaller")) {
        throw new Error("Flutter Android runtime graph contains the excluded profile installer.")
      }
      if (/^[| ]*(?:\+---|\\---) project :(?!app(?: \(\*\))?$)/mu.test(dependencies.stdout)) {
        throw new Error("Flutter Android runtime graph contains an undeclared project dependency.")
      }
      const permissions = await command(path.join(tools.androidHome, "build-tools/35.0.0/aapt2"),
        ["dump", "permissions", apk], project, environment)
      const apkManifest = await command(path.join(tools.androidHome, "build-tools/35.0.0/aapt2"),
        ["dump", "xmltree", apk, "--file", "AndroidManifest.xml"], project, environment)

      if (/uses-permission/iu.test(permissions.stdout)) throw new Error("Flutter APK contains an undeclared permission.")
      if (/^\s+E: (?:permission|uses-permission|provider|receiver|service)\b/mu.test(apkManifest.stdout)) {
        throw new Error("Flutter APK contains a forbidden permission or background component.")
      }
      process.stdout.write(`${JSON.stringify({
        acceptanceRoot: root,
        applicationId: "dev.semantifold.flutter.generated",
        apk,
        expectedOutputBase64: Buffer.from(expectedOutput, "utf8").toString("base64"),
        projectDirectory: project
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
  const flutterHome = requiredDirectory("SEMANTIFOLD_FLUTTER_HOME")
  const gradleHome = requiredDirectory("SEMANTIFOLD_GRADLE_HOME")
  const gradleUserHome = requiredDirectory("SEMANTIFOLD_GRADLE_USER_HOME")
  const javaHome = requiredDirectory("JAVA_HOME")
  const pubCache = requiredDirectory("SEMANTIFOLD_FLUTTER_PUB_CACHE")
  const dart = path.join(flutterHome, "bin/cache/dart-sdk/bin/dart")
  const flutterSnapshot = path.join(flutterHome, "bin/cache/flutter_tools.snapshot")
  const gradle = path.join(gradleHome, "bin/gradle")
  const keytool = path.join(javaHome, "bin/keytool")
  const environment = {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    CI: "true",
    FLUTTER_ROOT: flutterHome,
    FLUTTER_STORAGE_BASE_URL: "https://storage.googleapis.com",
    FLUTTER_SUPPRESS_ANALYTICS: "true",
    GRADLE_USER_HOME: gradleUserHome,
    JAVA_HOME: javaHome,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PUB_CACHE: pubCache,
    PUB_HOSTED_URL: "https://pub.dev",
    TZ: "UTC"
  }

  for (const executable of [dart, gradle, keytool, path.join(javaHome, "bin/java"),
    path.join(androidHome, "build-tools/35.0.0/aapt2"), path.join(androidHome, "cmake/3.22.1/bin/cmake")]) {
    try {
      if (!(await stat(executable)).isFile()) infrastructure(`Required executable is not a file: ${executable}`)
      await access(executable, fsConstants.X_OK)
    } catch (error) {
      infrastructure(`Required tool is missing or is not executable: ${executable}`, error)
    }
  }
  for (const filename of [flutterSnapshot, path.join(androidHome, "platforms/android-35/android.jar"),
    path.join(androidHome, "ndk/27.0.12077973/source.properties"),
    path.join(androidHome, "cmake/3.22.1/source.properties")]) {
    try {
      if (!(await stat(filename)).isFile()) infrastructure(`Required tool artifact is not a file: ${filename}`)
    } catch (error) {
      infrastructure(`Required tool artifact is missing: ${filename}`, error)
    }
  }
  const ndkProperties = await readFile(path.join(androidHome, "ndk/27.0.12077973/source.properties"), "utf8")
  const cmakeProperties = await readFile(path.join(androidHome, "cmake/3.22.1/source.properties"), "utf8")

  if (!ndkProperties.split(/\r?\n/u).includes("Pkg.Revision = 27.0.12077973")) {
    infrastructure("Android NDK is not exact revision 27.0.12077973.")
  }
  if (!cmakeProperties.split(/\r?\n/u).includes("Pkg.Revision = 3.22.1")) {
    infrastructure("Android CMake is not exact revision 3.22.1.")
  }
  if ((await readdir(pubCache)).length == 0) infrastructure("The declared offline pub cache is empty.")
  if (mode != "prepare" && (await readdir(gradleUserHome)).length == 0) {
    infrastructure("The shared offline Gradle cache is empty.")
  }
  const gitRevision = await infrastructureCommand("git", ["-C", flutterHome, "rev-parse", "HEAD"], environment, "Flutter Git")
  const flutterVersion = await infrastructureCommand(dart, [flutterSnapshot, "--version", "--machine"], environment, "Flutter")
  const dartVersion = await infrastructureCommand(dart, ["--version"], environment, "Dart")
  const gradleVersion = await infrastructureCommand(gradle, ["--version"], environment, "Gradle")
  const javaVersion = await infrastructureCommand(path.join(javaHome, "bin/java"), ["-version"], environment, "Java")
  let flutter

  try {
    flutter = JSON.parse(flutterVersion.stdout)
  } catch (error) {
    infrastructure("Flutter machine version output is not JSON.", error)
  }
  if (gitRevision.stdout.trim() != "9584c6713b324636289d067944a46fd6b49df14b" ||
    flutter.frameworkVersion != "3.47.4" || flutter.frameworkRevision != gitRevision.stdout.trim() ||
    flutter.dartSdkVersion != "3.13.3") infrastructure("Flutter SDK identity differs from exact 3.47.4.")
  if (!/Dart SDK version: 3\.13\.3 /u.test(`${dartVersion.stdout}\n${dartVersion.stderr}`)) {
    infrastructure("Dart is not exact version 3.13.3.")
  }
  if (!/^Gradle 8\.14$/mu.test(gradleVersion.stdout)) infrastructure("Gradle is not exact version 8.14.")
  if (!/version "21\.0\.8"/u.test(javaVersion.stderr)) infrastructure("Java is not exact version 21.0.8.")

  return {androidHome, dart, environment, flutterHome, flutterSnapshot, gradle, keytool}
}

/** @param {string} filename @returns {Promise<void>} */
async function verifyPackageConfiguration(filename) {
  const configuration = JSON.parse(await readFile(filename, "utf8"))
  const names = configuration.packages.map(({name}) => name)

  if (names.length != expectedPackages.size || new Set(names).size != expectedPackages.size ||
    names.some(name => !expectedPackages.has(name))) {
    throw new Error(`Resolved Flutter package graph differs from the exact owned lockfile: ${names.join(", ")}.`)
  }
}

async function createDebugKeystore(keytool, root, environment) {
  const destination = path.join(root, "debug.keystore")

  await executeFile(keytool, [
    "-genkeypair", "-noprompt", "-keystore", destination, "-storepass", "android", "-alias", "androiddebugkey",
    "-keypass", "android", "-dname", "CN=Android Debug,O=Android,C=US", "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000"
  ], {env: environment})
  await chmod(destination, 0o600)
}

async function command(executable, arguments_, directory, environment) {
  try {
    return await executeFile(executable, arguments_, {cwd: directory, env: environment, maxBuffer: 40 * 1024 * 1024})
  } catch (error) {
    if (error && typeof error == "object") {
      const standardOutput = Reflect.get(error, "stdout")
      const standardError = Reflect.get(error, "stderr")

      if (standardOutput) process.stderr.write(String(standardOutput))
      if (standardError) process.stderr.write(String(standardError))
      if (arguments_.includes("--offline") &&
        /(?:offline mode|no cached version|not available for offline|cached resource is missing)/iu
          .test(`${String(standardOutput ?? "")}\n${String(standardError ?? "")}`)) {
        infrastructure("Offline Flutter dependency cache is incomplete.", error)
      }
    }
    throw error
  }
}

async function infrastructureCommand(executable, arguments_, environment, name) {
  try {
    return await executeFile(executable, arguments_, {env: environment})
  } catch (error) {
    infrastructure(`${name} version probe failed.`, error)
  }
}

function requiredDirectory(name) {
  const value = process.env[name]

  if (!value || !path.isAbsolute(value)) infrastructure(`${name} must name an absolute qualified tool directory.`)

  return value
}

function infrastructure(detail, cause) {
  throw new Error(`${infrastructurePrefix} ${detail}`, cause === undefined ? undefined : {cause})
}
