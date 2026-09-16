// @ts-check

import {createHash} from "node:crypto"
import {isDenseArray} from "../array.js"
import {findPortableArtifactPathConflict, isSafeArtifactPath} from "../artifact-path.js"
import {createByteMapping} from "../binary-mapping.js"
import {SemantifoldDiagnostic, unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {preflightSemanticProgram} from "./program.js"
import {emitScalarType} from "./scalars.js"
import {kotlinRuntime} from "./kotlin-runtime.js"
import {emitKotlinBlock} from "./kotlin.js"
import {SourceWriter} from "./writer.js"

const projectRoot = "generated/android-app"
const generatorVersion = "0.4.0"
/** @type {Readonly<Set<import("../semantic/types.js").SemanticLanguage>>} */
const androidSourceLanguages = new Set([
  "php", "ruby", "javascript", "typescript", "java", "kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "dart"
])
const requestFields = new Set(["assets", "configuration", "language", "module", "program", "resources", "role"])
const configurationFields = new Set([
  "activityClassName", "applicationId", "buildToolsVersion", "compileSdk", "displayName", "minimumSdk", "namespace",
  "orientation", "packageName", "permissions", "productName", "targetSdk", "theme", "versionCode", "versionName"
])
const resourceFields = new Set(["content", "mediaType", "path", "sha256"])
const kotlinKeywords = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface", "is", "null",
  "object", "package", "return", "super", "this", "throw", "true", "try", "typealias", "typeof", "val", "var", "when", "while"
])
const androidScaffoldSymbols = new Set([
  "Activity", "Base64", "Bundle", "IllegalStateException", "Instrumentation", "Intent", "R", "SemantifoldEntryTest",
  "SemantifoldUiInstrumentation", "StandardCharsets", "String", "SuppressLint", "Test", "TextView", "Throwable", "View"
])
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\u0020-\u007e]+)?$/u
const semanticVersionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[A-Za-z-][A-Za-z0-9-]*)(?:\.(?:0|[1-9][0-9]*|[A-Za-z-][A-Za-z0-9-]*))*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/u
const toolchain = Object.freeze({
  androidGradlePlugin: "8.11.1",
  archives: {
    buildTools: {
      revision: "35.0.0",
      sha256: "bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88",
      url: "https://dl.google.com/android/repository/build-tools_r35_linux.zip"
    },
    commandLineTools: {
      revision: "11076708",
      sha256: "2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258",
      url: "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    },
    emulator: {
      buildId: "13610412",
      revision: "35.6.11",
      sha256: "2fe2b56fe93ce75e1d478a40162131381d911c355efeaedb54dd1e0d0897a5cf",
      url: "https://edgedl.me.gvt1.com/edgedl/android/repository/emulator-linux_x64-13610412.zip"
    },
    platform: {
      revision: "35-r2",
      sha256: "0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0",
      url: "https://dl.google.com/android/repository/platform-35_r02.zip"
    },
    platformTools: {
      revision: "37.0.1",
      sha256: "d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1",
      url: "https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip"
    },
    systemImage: {
      revision: "35-google_apis-x86_64-r9",
      sha256: "c67b9ba0ff5bc0eb6d046871bfa228af14d4d47b02f0cdae94f048e511b7566e",
      url: "https://dl.google.com/android/repository/sys-img/google_apis/x86_64-35_r09.zip"
    }
  },
  buildTools: "35.0.0",
  commandLineTools: "11076708",
  compileSdk: 35,
  emulator: "35.6.11",
  gradle: "8.13",
  java: "21.0.8",
  kotlin: "2.2.10",
  kotlinCompilerSha256: "302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc",
  systemImage: "system-images;android-35;google_apis;x86_64",
  targetSdk: 35
})
const excludedPathPatterns = Object.freeze([".gradle/**", "**/build/**", "local.properties"])
const androidKotlinRuntime = `@file:Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")

package __PACKAGE__.semantic

${kotlinRuntime.replaceAll("private ", "internal ")}
internal class SemantifoldOutputSink {
  private val values: java.util.ArrayList<String> = java.util.ArrayList<String>()

  fun reset() {
    values.clear()
  }

  fun write(value: Long) {
    values.add(value.toString())
  }

  fun write(value: Boolean) {
    values.add(if (value) "true" else "false")
  }

  fun write(value: String) {
    values.add(value)
  }

  fun snapshot(): java.util.ArrayList<String> = java.util.ArrayList<String>(values)
}
`

/** @typedef {{content: string | Uint8Array, contentKind: "binary" | "text", fullPath: string, mediaType: string, path: string, sha256: string}} AndroidInputFile */
/** @typedef {{end: number, field: string, path: string, start: number}} ConfigurationSpan */

/**
 * Preflights a complete Android application request before allocating a source writer.
 * @param {Record<string, unknown>} input - Candidate application request.
 * @returns {{assets: AndroidInputFile[], configuration: import("../semantic/types.js").AndroidApplicationConfiguration, modulePaths: Map<string, string>, modules: import("../semantic/types.js").SemanticModule[], packagePath: string, program: import("../semantic/types.js").SemanticProgram, resources: AndroidInputFile[], sources: {content: string, filename: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} Prepared application.
 */
export function preflightAndroidApplication(input) {
  if (!isPlainObject(input) || Object.keys(input).some(key => !requestFields.has(key)) ||
    Boolean(input.module) == Boolean(input.program)) {
    invalidInput("Android application generation requires a closed request with exactly one semantic module or program.")
  }
  if (input.language !== undefined && input.language != "android" || input.role !== undefined && input.role != "application") {
    invalidInput("Android application generation accepts only the Android application role.")
  }
  const configuration = normalizeConfiguration(input.configuration)
  const program = input.program ?? normalizeSingleModule(
    /** @type {import("../semantic/types.js").SemanticModule | undefined} */ (input.module))
  const prepared = preflightSemanticProgram({
    backendLanguage: "kotlin",
    diagnosticLanguage: "android",
    program: /** @type {import("../semantic/types.js").SemanticProgram} */ (program),
    sourceLanguages: androidSourceLanguages
  })
  validateActivityClassName(configuration.activityClassName, prepared.program.entryModule)
  const packagePath = configuration.packageName.replaceAll(".", "/")
  const semanticRoot = `${projectRoot}/app/src/main/kotlin/${packagePath}/semantic`
  const modulePaths = new Map(prepared.modules.map(module => [
    /** @type {string} */ (Reflect.get(module, "id")),
    `${semanticRoot}/${moduleName(/** @type {string} */ (Reflect.get(module, "id")))}.kt`
  ]))
  const resources = normalizeInputFiles(input.resources, "resource")
  const assets = normalizeInputFiles(input.assets, "asset")
  const fixedPaths = applicationPaths(configuration, modulePaths)
  const completePaths = [
    ...fixedPaths,
    ...resources.map(({fullPath}) => fullPath),
    ...assets.map(({fullPath}) => fullPath)
  ]
  const conflict = findPortableArtifactPathConflict(completePaths)

  if (conflict) {
    invalidPath(`Application artifact path '${conflict.path}' has a ${conflict.kind} conflict${conflict.other ? ` with '${conflict.other}'` : ""}.`)
  }

  return {...prepared, assets, configuration, modulePaths, packagePath, resources}
}

/**
 * Generates one complete deterministic Android/Kotlin project.
 * @param {Record<string, unknown>} input - Application generation request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], metadata: {applicationManifest: string, platformQualification: string}, target: "android"}} Candidate artifact set.
 */
export function generateAndroidApplication(input) {
  const prepared = preflightAndroidApplication(input)
  const configurationSpans = /** @type {ConfigurationSpan[]} */ ([])
  const configuration = prepared.configuration
  const packagePath = prepared.packagePath
  const semanticArtifacts = renderSemanticArtifacts(prepared)
  const artifacts = /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */ ([
    configuredText(`${projectRoot}/app/build.gradle.kts`, "manifest", renderAppBuild(configuration, configurationSpans),
      "Pinned dependency-minimal Android application build."),
    configuredText(`${projectRoot}/app/src/androidTest/AndroidManifest.xml`, "manifest",
      renderAndroidTestManifest(configuration, configurationSpans), "Platform-only Android instrumentation declaration."),
    configuredText(`${projectRoot}/app/src/androidTest/kotlin/${packagePath}/SemantifoldUiInstrumentation.kt`, "support",
      renderInstrumentation(configuration, configurationSpans), "Platform-only accessibility and lifecycle assertion."),
    configuredText(`${projectRoot}/app/src/main/AndroidManifest.xml`, "manifest",
      renderAndroidManifest(configuration, configurationSpans), "Closed allowlisted Android application manifest."),
    configuredText(`${projectRoot}/app/src/main/kotlin/${packagePath}/${configuration.activityClassName}.kt`, "entry",
      renderActivity(configuration, prepared.program.entryModule, configurationSpans),
      "Synthetic Android activity lifecycle and native output view binding."),
    ...semanticArtifacts,
    syntheticText(`${projectRoot}/app/src/main/res/layout/activity_main.xml`, "resource", renderLayout(),
      "Synthetic one-view Android layout and accessibility identity."),
    configuredText(`${projectRoot}/app/src/main/res/values/strings.xml`, "resource",
      renderStrings(configuration, configurationSpans), "Escaped application labels derived from configuration."),
    syntheticText(`${projectRoot}/app/src/main/res/values/themes.xml`, "resource", renderTheme(),
      "Closed platform-native application theme."),
    configuredText(`${projectRoot}/app/src/test/kotlin/${packagePath}/SemantifoldEntryTest.kt`, "support",
      renderUnitTest(configuration, prepared.program.entryModule, configurationSpans),
      "JUnit test-scope-only semantic determinism assertion."),
    syntheticText(`${projectRoot}/build.gradle.kts`, "manifest", renderRootBuild(),
      "Pinned Android and Kotlin build plugins."),
    syntheticText(`${projectRoot}/gradle.properties`, "support", renderGradleProperties(),
      "Pinned hermetic Gradle process properties."),
    configuredText(`${projectRoot}/settings.gradle.kts`, "manifest", renderSettings(configuration, configurationSpans),
      "Closed official Gradle plugin and dependency repositories."),
    ...prepared.resources.map(inputFileArtifact),
    ...prepared.assets.map(inputFileArtifact)
  ])

  artifacts.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const manifestPath = `${projectRoot}/semantifold-project.json`

  artifacts.push(syntheticText(manifestPath, "manifest",
    renderProjectManifest(prepared, artifacts, manifestPath, configurationSpans),
    "Versioned Android project ownership, toolchain, and provenance manifest."))

  return {
    artifacts,
    metadata: {applicationManifest: manifestPath, platformQualification: "tensorbuzz-kvm"},
    target: "android"
  }
}

/**
 * Renders the mapped semantic Kotlin artifacts for every program module.
 * @param {ReturnType<typeof preflightAndroidApplication>} prepared - Prepared application.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact[]} Semantic Kotlin artifacts.
 */
function renderSemanticArtifacts(prepared) {
  const semanticRoot = `${projectRoot}/app/src/main/kotlin/${prepared.packagePath}/semantic`
  /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */
  const artifacts = [syntheticText(`${semanticRoot}/SemantifoldRuntime.kt`, "support",
    androidKotlinRuntime.replaceAll("__PACKAGE__", prepared.configuration.packageName),
    "Shared Android application output capture and checked Kotlin scalar support.")]
  const declarations = new Map()

  for (const module of prepared.modules) {
    for (const declaration of module.functions) declarations.set(declaration.id, {
      declaration,
      moduleId: /** @type {string} */ (Reflect.get(module, "id"))
    })
  }
  for (const module of prepared.modules) {
    const moduleId = /** @type {string} */ (Reflect.get(module, "id"))
    const filename = /** @type {string} */ (prepared.modulePaths.get(moduleId))
    const sinkName = outputSinkName(module)
    const writer = new SourceWriter({
      callArgumentSuffix: sinkName,
      callNameResolver: expression => {
        const resolved = declarations.get(expression.resolution?.declarationId)

        if (!resolved) throw new TypeError(`Unknown validated Android function '${expression.resolution?.declarationId}'.`)

        return `SemantifoldModule${moduleName(resolved.moduleId)}.${resolved.declaration.name}`
      },
      filename,
      language: "kotlin",
      methodStringEquality: true,
      module,
      program: prepared.program,
      programPaths: prepared.modulePaths,
      sources: prepared.sources
    })

    writer.synthetic(`@file:Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")\n\npackage ${prepared.configuration.packageName}.semantic\n\n`,
      "Android semantic package namespace", [module], [""])
    emitSemanticModule(writer, module, moduleId, moduleId == prepared.program.entryModule, sinkName)
    const mapping = finalizeMapping(writer.finish())

    artifacts.push({
      content: mapping.generated.content,
      contentKind: "text",
      mediaType: "text/x-kotlin",
      ownership: "generated",
      path: filename,
      provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping), sourceMapFilename: `${filename}.map`},
      role: "source"
    })
  }

  return artifacts
}

/**
 * Emits one namespaced semantic module and its entry bridge when applicable.
 * @param {SourceWriter} writer - Mapped Kotlin writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Prepared module.
 * @param {string} moduleId - Stable module identity.
 * @param {boolean} entry - Whether this module owns the entry block.
 * @param {string} sinkName - Collision-safe output sink binding.
 */
function emitSemanticModule(writer, module, moduleId, entry, sinkName) {
  writer.synthetic(`internal object SemantifoldModule${moduleName(moduleId)} {\n`,
    "Android semantic module namespace", [module], [""])
  module.functions.forEach((declaration, functionIndex) => {
    const path = `/functions/${functionIndex}`

    writer.synthetic("  ", "Android namespaced function indentation", [declaration], [path])
    writer.mapped("fun", {mappingKind: "anchor", node: declaration, path})
    writer.synthetic(" ", "declaration spacing", [declaration], [path])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
    writer.synthetic("(", "function parameter scaffold", [declaration], [path])
    declaration.parameters.forEach((parameter, parameterIndex) => {
      const parameterPath = `${path}/parameters/${parameterIndex}`

      if (parameterIndex) writer.synthetic(", ", "parameter separator", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(": ", "parameter annotation scaffold", [parameter], [parameterPath])
      writer.mapped(emitScalarType("kotlin", parameter.type), {mappingKind: "exact", node: parameter.type,
        path: `${parameterPath}/type`, role: "type"})
    })
    if (declaration.parameters.length) writer.synthetic(", ", "output sink parameter separator", [declaration], [path])
    writer.synthetic(`${sinkName}: SemantifoldOutputSink): `, "shared Android output sink parameter", [declaration], [path])
    writer.mapped(emitScalarType("kotlin", declaration.returnType), {mappingKind: "exact", node: declaration.returnType,
      path: `${path}/returnType`, role: "type"})
    writer.synthetic(" {\n", "Kotlin function body scaffold", [declaration], [path])
    emitKotlinBlock(writer, declaration.body, "    ", `${path}/body`, `${sinkName}.write`)
    writer.synthetic("  }\n", "Kotlin function body scaffold", [declaration], [path])
  })
  if (entry) {
    writer.synthetic("  fun semantifoldEntry(): java.util.ArrayList<String> {\n", "Android semantic entry scaffold", [module.entryPoint], ["/entryPoint"])
    writer.synthetic(`    val ${sinkName} = SemantifoldOutputSink()\n`, "Android output sink allocation",
      [module.entryPoint], ["/entryPoint"])
    writer.synthetic(`    ${sinkName}.reset()\n`, "Android lifecycle-safe output reset", [module.entryPoint], ["/entryPoint"])
    emitKotlinBlock(writer, module.entryPoint.body, "    ", "/entryPoint/body", `${sinkName}.write`)
    writer.synthetic(`    return ${sinkName}.snapshot()\n`, "Android semantic output return",
      [module.entryPoint], ["/entryPoint"])
    writer.synthetic("  }\n", "Android semantic entry scaffold", [module.entryPoint], ["/entryPoint"])
  }
  writer.synthetic("}\n", "Android semantic module namespace", [module], [""])
}

/**
 * Lists every fixed generated path before any writer is allocated.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized application configuration.
 * @param {Map<string, string>} modulePaths - Semantic module output paths.
 * @returns {string[]} Fixed owned artifact paths.
 */
function applicationPaths(configuration, modulePaths) {
  const packagePath = configuration.packageName.replaceAll(".", "/")

  return [
    `${projectRoot}/app/build.gradle.kts`,
    `${projectRoot}/app/src/androidTest/AndroidManifest.xml`,
    `${projectRoot}/app/src/androidTest/kotlin/${packagePath}/SemantifoldUiInstrumentation.kt`,
    `${projectRoot}/app/src/main/AndroidManifest.xml`,
    `${projectRoot}/app/src/main/kotlin/${packagePath}/${configuration.activityClassName}.kt`,
    ...modulePaths.values(),
    `${projectRoot}/app/src/main/kotlin/${packagePath}/semantic/SemantifoldRuntime.kt`,
    `${projectRoot}/app/src/main/res/layout/activity_main.xml`,
    `${projectRoot}/app/src/main/res/values/strings.xml`,
    `${projectRoot}/app/src/main/res/values/themes.xml`,
    `${projectRoot}/app/src/test/kotlin/${packagePath}/SemantifoldEntryTest.kt`,
    `${projectRoot}/build.gradle.kts`,
    `${projectRoot}/gradle.properties`,
    `${projectRoot}/settings.gradle.kts`,
    `${projectRoot}/semantifold-project.json`
  ]
}

/**
 * Renders the pinned root plugin declarations.
 * @returns {string} Root Gradle Kotlin script.
 */
function renderRootBuild() {
  return `plugins {
  id("com.android.application") version "${toolchain.androidGradlePlugin}" apply false
  id("org.jetbrains.kotlin.android") version "${toolchain.kotlin}" apply false
}
`
}

/**
 * Renders closed project settings and repositories.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Settings Gradle Kotlin script.
 */
function renderSettings(configuration, spans) {
  return configured(`${projectRoot}/settings.gradle.kts`, spans, [`pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "`, field("productName", kotlinEscape(configuration.productName)), `"
include(":app")
`])
}

/**
 * Renders deterministic Gradle process properties.
 * @returns {string} Gradle properties file.
 */
function renderGradleProperties() {
  return `org.gradle.caching=false
org.gradle.configuration-cache=false
org.gradle.daemon=false
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 -Duser.language=en -Duser.country=US -Duser.timezone=UTC
org.gradle.parallel=false
kotlin.stdlib.default.dependency=false
kotlin.code.style=official
`
}

/**
 * Renders the application module build contract.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Application Gradle Kotlin script.
 */
function renderAppBuild(configuration, spans) {
  return configured(`${projectRoot}/app/build.gradle.kts`, spans, [
    `import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

dependencies {
  testRuntimeOnly("org.hamcrest:hamcrest-core:1.3") {
    isTransitive = false
  }
}

val semantifoldKotlinHome = providers.environmentVariable("SEMANTIFOLD_KOTLIN_HOME").orNull
  ?: throw GradleException("SEMANTIFOLD_ANDROID_INFRASTRUCTURE: SEMANTIFOLD_KOTLIN_HOME is required")
val semantifoldKotlinStdlib = file("$semantifoldKotlinHome/lib/kotlin-stdlib.jar")
if (!semantifoldKotlinStdlib.isFile) {
  throw GradleException("SEMANTIFOLD_ANDROID_INFRASTRUCTURE: pinned Kotlin compile library is missing")
}
val semantifoldAcceptanceRoot = providers.environmentVariable("SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT").orNull
  ?: throw GradleException("SEMANTIFOLD_ANDROID_INFRASTRUCTURE: SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT is required")
val semantifoldDebugKeystore = file("$semantifoldAcceptanceRoot/debug.keystore")
if (!semantifoldDebugKeystore.isFile) {
  throw GradleException("SEMANTIFOLD_ANDROID_INFRASTRUCTURE: ephemeral debug keystore is missing")
}

android {
  namespace = "`,
    field("namespace", configuration.namespace), `"\n  compileSdk = `, field("compileSdk", String(configuration.compileSdk)),
    `\n  buildToolsVersion = "`, field("buildToolsVersion", configuration.buildToolsVersion), `"\n\n  defaultConfig {\n    applicationId = "`,
    field("applicationId", configuration.applicationId), `"\n    minSdk = `, field("minimumSdk", String(configuration.minimumSdk)),
    `\n    targetSdk = `, field("targetSdk", String(configuration.targetSdk)), `\n    versionCode = `,
    field("versionCode", String(configuration.versionCode)), `\n    versionName = "`, field("versionName", kotlinEscape(configuration.versionName)),
    `"\n    testApplicationId = "`, field("applicationId", configuration.applicationId),
    `.test"\n    testInstrumentationRunner = "`, field("packageName", configuration.packageName),
    `.SemantifoldUiInstrumentation"\n  }\n\n  signingConfigs {\n    getByName("debug") {\n      storeFile = semantifoldDebugKeystore\n      storePassword = "android"\n      keyAlias = "androiddebugkey"\n      keyPassword = "android"\n    }\n  }\n  buildTypes {\n    getByName("debug") {\n      signingConfig = signingConfigs.getByName("debug")\n    }\n  }\n  buildFeatures {\n    buildConfig = false\n  }\n  compileOptions {\n    sourceCompatibility = JavaVersion.VERSION_21\n    targetCompatibility = JavaVersion.VERSION_21\n  }\n  lint {\n    abortOnError = true\n    checkDependencies = true\n    disable += "MissingApplicationIcon"\n    disable += "OldTargetApi"\n    disable += "GradleDependency"\n    warningsAsErrors = true\n  }\n  packaging {\n    resources.excludes += setOf("META-INF/LICENSE*", "META-INF/NOTICE*")\n  }\n}\n\ntasks.withType<KotlinJvmCompile>().configureEach {\n  libraries.from(files(semantifoldKotlinStdlib))\n  compilerOptions {\n    allWarningsAsErrors.set(true)\n    freeCompilerArgs.addAll("-Xno-call-assertions", "-Xno-param-assertions", "-Xno-receiver-assertions")\n    jvmTarget.set(JvmTarget.JVM_21)\n  }\n}\n\ndependencies {\n  testImplementation("junit:junit:4.13.2") {\n    isTransitive = false\n  }\n}\n`
  ])
}

/**
 * Renders the allowlisted Android application manifest.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Android application manifest.
 */
function renderAndroidManifest(configuration, spans) {
  const orientation = configuration.orientation == "unspecified" ? "" : ` android:screenOrientation="${configuration.orientation}"`

  return configured(`${projectRoot}/app/src/main/AndroidManifest.xml`, spans, [
    `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application\n    android:allowBackup="false"\n    android:label="@string/app_name"\n    android:supportsRtl="true"\n    android:theme="@style/Theme.Semantifold">\n    <activity\n      android:name="`,
    field("packageName", configuration.packageName), `.`, field("activityClassName", configuration.activityClassName),
    `"\n      android:exported="true"`,
    orientation ? field("orientation", orientation) : "", `>\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n    </activity>\n  </application>\n</manifest>\n`
  ])
}

/**
 * Renders the platform-only instrumentation manifest.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Android test manifest.
 */
function renderAndroidTestManifest(configuration, spans) {
  return configured(`${projectRoot}/app/src/androidTest/AndroidManifest.xml`, spans, [
    `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <instrumentation\n    android:name="`,
    field("packageName", configuration.packageName), `.SemantifoldUiInstrumentation"\n    android:targetPackage="`,
    field("applicationId", xmlEscape(configuration.applicationId)), `" />\n</manifest>\n`
  ])
}

/**
 * Renders the synthetic launcher activity.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {string} entryModule - Selected semantic entry module identity.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Kotlin launcher activity source.
 */
function renderActivity(configuration, entryModule, spans) {
  const resourceImport = configuration.namespace == configuration.packageName
    ? []
    : ["import ", field("namespace", configuration.namespace), ".R\n"]

  return configured(`${projectRoot}/app/src/main/kotlin/${configuration.packageName.replaceAll(".", "/")}/${configuration.activityClassName}.kt`, spans, [
    "package ", field("packageName", configuration.packageName), `

import android.app.Activity
import android.annotation.SuppressLint
import android.os.Bundle
import android.widget.TextView
`, ...resourceImport, `import `, field("packageName", configuration.packageName),
    `.semantic.SemantifoldModule${moduleName(entryModule)}

class `, field("activityClassName", configuration.activityClassName), ` : Activity() {
  @SuppressLint("SetTextI18n")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    val lines = SemantifoldModule${moduleName(entryModule)}.semantifoldEntry()
    val output = java.lang.StringBuilder()
    var index = 0
    while (index < lines.size) {
      if (index > 0) output.append('\\n')
      output.append(lines[index])
      index += 1
    }
    findViewById<TextView>(R.id.semantifold_output).text = output.toString()
  }
}
`
  ])
}

/**
 * Renders the single accessibility-important native text view.
 * @returns {string} Android layout XML.
 */
function renderLayout() {
  return `<?xml version="1.0" encoding="utf-8"?>
<TextView xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/semantifold_output"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:gravity="center"
  android:importantForAccessibility="yes"
  android:textIsSelectable="true" />
`
}

/**
 * Renders configuration-derived string resources.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Android string resource XML.
 */
function renderStrings(configuration, spans) {
  return configured(`${projectRoot}/app/src/main/res/values/strings.xml`, spans, [
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="app_name">`,
    field("displayName", xmlEscape(configuration.displayName)), `</string>\n</resources>\n`
  ])
}

/**
 * Renders the fixed platform-native baseline theme.
 * @returns {string} Android theme resource XML.
 */
function renderTheme() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="Theme.Semantifold" parent="android:style/Theme.Material.Light.NoActionBar">
    <item name="android:fontFamily">sans</item>
    <item name="android:windowActionModeOverlay">true</item>
  </style>
</resources>
`
}

/**
 * Renders the sole JUnit test-scope semantic assertion.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {string} entryModule - Selected semantic entry module identity.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Kotlin unit test source.
 */
function renderUnitTest(configuration, entryModule, spans) {
  return configured(`${projectRoot}/app/src/test/kotlin/${configuration.packageName.replaceAll(".", "/")}/SemantifoldEntryTest.kt`, spans, [
    "package ", field("packageName", configuration.packageName), `

import `, field("packageName", configuration.packageName), `.semantic.SemantifoldModule${moduleName(entryModule)}
import org.junit.Test

class SemantifoldEntryTest {
  @Test
  fun entryIsDeterministicAcrossFreshRuns() {
    val firstOutput = SemantifoldModule${moduleName(entryModule)}.semantifoldEntry()
    val secondOutput = SemantifoldModule${moduleName(entryModule)}.semantifoldEntry()
    if (!firstOutput.equals(secondOutput)) {
      throw AssertionError("Semantic entry output differs across fresh runs.")
    }
  }
}
`
  ])
}

/**
 * Renders the framework-only instrumentation runner.
 * @param {import("../semantic/types.js").AndroidApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Collected configuration provenance spans.
 * @returns {string} Kotlin instrumentation source.
 */
function renderInstrumentation(configuration, spans) {
  const resourceImport = configuration.namespace == configuration.packageName
    ? []
    : ["import ", field("namespace", configuration.namespace), ".R\n"]

  return configured(`${projectRoot}/app/src/androidTest/kotlin/${configuration.packageName.replaceAll(".", "/")}/SemantifoldUiInstrumentation.kt`, spans, [
    "package ", field("packageName", configuration.packageName), `

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.TextView
import java.nio.charset.StandardCharsets
`, ...resourceImport, `
class SemantifoldUiInstrumentation : Instrumentation() {
  private var inputArguments: Bundle? = null

  override fun onCreate(arguments: Bundle?) {
    inputArguments = arguments
    start()
  }

  override fun onStart() {
    try {
      val providedArguments = inputArguments
        ?: throw IllegalStateException("missing instrumentation arguments")
      val encoded = providedArguments.getString("expected_output_base64")
        ?: throw IllegalStateException("missing expected_output_base64 instrumentation argument")
      val expected = String(Base64.decode(encoded, Base64.NO_WRAP), StandardCharsets.UTF_8)
      val launch = targetContext.packageManager.getLaunchIntentForPackage(targetContext.packageName)
        ?: throw IllegalStateException("generated application has no launcher intent")
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      val activity = startActivitySync(launch) as `, field("activityClassName", configuration.activityClassName), `
      assertOutput(activity, expected)
      val monitor = addMonitor(`, field("activityClassName", configuration.activityClassName), `::class.java.name, null, false)
      runOnMainSync { activity.recreate() }
      waitForIdleSync()
      val recreated = waitForMonitorWithTimeout(monitor, 10_000)
        ?: throw IllegalStateException("activity was not recreated")
      assertOutput(recreated, expected)
      finish(Activity.RESULT_OK, Bundle())
    } catch (error: Throwable) {
      val result = Bundle()
      result.putString("semantifold_failure", android.util.Log.getStackTraceString(error))
      finish(Activity.RESULT_CANCELED, result)
    }
  }

  private fun assertOutput(activity: Activity, expected: String) {
    waitForIdleSync()
    val actual = activity.findViewById<TextView>(R.id.semantifold_output)
      ?: throw IllegalStateException("missing semantifold_output view")
    if (actual.visibility != View.VISIBLE) throw IllegalStateException("output view is not visible")
    if (actual.javaClass != TextView::class.java) throw IllegalStateException("output view is not a native TextView")
    if (!actual.text.toString().equals(expected)) throw IllegalStateException("output text mismatch")
    if (actual.contentDescription != null) throw IllegalStateException("output content description must stay absent")
    if (actual.importantForAccessibility != View.IMPORTANT_FOR_ACCESSIBILITY_YES) {
      throw IllegalStateException("output view is not accessibility-important")
    }
  }
}
`
  ])
}

/**
 * Renders the ownership, toolchain, and provenance manifest.
 * @param {ReturnType<typeof preflightAndroidApplication>} prepared - Prepared application.
 * @param {import("../semantic/types.js").GeneratedSetArtifact[]} artifacts - Owned project artifacts.
 * @param {string} manifestPath - Ownership manifest path.
 * @param {ConfigurationSpan[]} spans - Configuration provenance spans.
 * @returns {string} Canonical project manifest JSON.
 */
function renderProjectManifest(prepared, artifacts, manifestPath, spans) {
  const inputPaths = new Set([...prepared.resources, ...prepared.assets].map(({fullPath}) => fullPath))
  const semanticArtifacts = artifacts.filter(artifact => artifact.provenance.kind == "text")
  const ownedPaths = [...artifacts.map(({path}) => path), manifestPath]

  return stringifyCanonicalJson({
    configuration: prepared.configuration,
    generator: {name: "semantifold", version: generatorVersion},
    ownership: {
      excludedPathPatterns,
      ownedPaths,
      ownedRoot: projectRoot,
      sha256: artifacts.map(artifact => ({path: artifact.path, sha256: hashContent(artifact.content)}))
    },
    provenance: {
      configuration: Object.keys(prepared.configuration).sort().map(fieldName => ({
        field: fieldName,
        manifestPointer: `/configuration/${fieldName}`,
        outputs: configurationOutputs(spans, fieldName)
      })),
      inputs: [...prepared.resources, ...prepared.assets].map(item => ({
        contentKind: item.contentKind,
        mediaType: item.mediaType,
        path: item.fullPath,
        sha256: item.sha256
      })),
      semanticSources: prepared.sources.map(source => ({
        artifacts: semanticArtifacts.filter(artifact => artifact.provenance.kind == "text" &&
          artifact.provenance.mapping.spans.some(({origin}) => originReferencesFilename(origin, source.filename)))
          .map(({path}) => path),
        filename: source.filename,
        ...(source.language === undefined ? {} : {language: source.language}),
        sha256: createHash("sha256").update(source.content).digest("hex")
      })),
      syntheticScaffolding: [...artifacts.filter(artifact => artifact.provenance.kind == "synthetic" &&
        !inputPaths.has(artifact.path)).map(({path}) => path), manifestPath]
    },
    schema: "SemantifoldAndroidProject",
    semanticProgram: semanticProgramManifest(prepared),
    target: "android",
    toolchain,
    version: 1
  })
}

/**
 * Renders semantic module and source identities for the project manifest.
 * @param {ReturnType<typeof preflightAndroidApplication>} prepared - Prepared application.
 * @returns {Record<string, unknown>} Semantic program manifest.
 */
function semanticProgramManifest(prepared) {
  const sourceContent = new Map(prepared.sources.map(source => [source.filename, source.content]))
  const order = new Map(prepared.program.modules.map((module, index) => [module.id, index]))
  const modules = prepared.program.modules.map(module => {
    const source = prepared.program.sources.find(candidate => candidate.filename == module.sourceFilename)
    const content = sourceContent.get(module.sourceFilename)

    if (!source || content === undefined) throw new TypeError(`Preflighted Android module '${module.id}' lost source ownership.`)

    return {
      dependencies: [...new Set(module.imports.map(({moduleId}) => moduleId))]
        .sort((left, right) => /** @type {number} */ (order.get(left)) - /** @type {number} */ (order.get(right))),
      generatedArtifacts: [prepared.modulePaths.get(module.id)],
      id: module.id,
      namespace: `SemantifoldModule${moduleName(module.id)}`,
      source: {filename: source.filename, id: source.id, sha256: createHash("sha256").update(content).digest("hex")}
    }
  })
  const entryId = prepared.program.entryModule

  return {
    entry: {
      activityArtifact: `${projectRoot}/app/src/main/kotlin/${prepared.packagePath}/${prepared.configuration.activityClassName}.kt`,
      generatedArtifact: prepared.modulePaths.get(entryId),
      generatedFunctionIdentity: `SemantifoldModule${moduleName(entryId)}.semantifoldEntry`,
      moduleId: entryId
    },
    modules,
    schema: "SemantifoldAndroidSemanticProgram",
    sources: prepared.program.sources.map(source => ({
      filename: source.filename,
      id: source.id,
      language: source.language,
      moduleIds: modules.filter(module => module.source.filename == source.filename).map(({id}) => id),
      ownership: source.ownership ?? "application",
      sha256: createHash("sha256").update(/** @type {string} */ (sourceContent.get(source.filename))).digest("hex")
    })),
    version: 1
  }
}

/**
 * Validates and normalizes the closed Android configuration.
 * @param {unknown} candidate - Candidate configuration.
 * @returns {import("../semantic/types.js").AndroidApplicationConfiguration} Normalized configuration.
 */
function normalizeConfiguration(candidate) {
  if (candidate === undefined) candidate = {}
  if (!isPlainObject(candidate) || Object.keys(candidate).some(key => !configurationFields.has(key))) {
    invalidConfiguration("Android application configuration must be a closed plain object.")
  }
  const configuration = /** @type {import("../semantic/types.js").AndroidApplicationConfigurationInput} */ (candidate)
  const applicationId = configuration.applicationId ?? "dev.semantifold.generated"
  const namespace = configuration.namespace ?? applicationId
  const packageName = configuration.packageName ?? namespace
  const activityClassName = configuration.activityClassName ?? "MainActivity"
  const productName = configuration.productName ?? "Semantifold"
  const displayName = configuration.displayName ?? "Semantifold"
  const minimumSdk = configuration.minimumSdk ?? 23
  const targetSdk = configuration.targetSdk ?? toolchain.targetSdk
  const compileSdk = configuration.compileSdk ?? toolchain.compileSdk
  const buildToolsVersion = configuration.buildToolsVersion ?? toolchain.buildTools
  const versionCode = configuration.versionCode ?? 1
  const versionName = configuration.versionName ?? "1.0.0"
  const orientation = configuration.orientation ?? "unspecified"
  const theme = configuration.theme ?? "system"

  for (const [label, value] of [["Application ID", applicationId], ["Namespace", namespace], ["Package name", packageName]]) {
    if (typeof value != "string" || !isPackageName(value)) invalidConfiguration(`${label} must be a lowercase Java package identity.`)
  }
  if (typeof activityClassName != "string" || !/^[A-Z][A-Za-z0-9]*$/u.test(activityClassName) || kotlinKeywords.has(activityClassName)) {
    invalidConfiguration("Activity class name must be an ASCII upper-camel Kotlin identifier.")
  }
  for (const [label, value] of [["Product name", productName], ["Display name", displayName]]) {
    if (typeof value != "string" || value.length == 0 || value.trim() != value || [...value].length > 64 ||
      !hasOnlyUnicodeScalars(value) || /[\p{Cc}\p{Zl}\p{Zp}\uFFFE\uFFFF]/u.test(value)) {
      invalidConfiguration(`${label} must be a non-empty single-line Unicode scalar string of at most 64 characters.`)
    }
  }
  if (/[\\/:<>"?*|]/u.test(productName)) {
    invalidConfiguration("Product name contains a character forbidden by the Gradle project-name contract.")
  }
  if (minimumSdk !== 23 || targetSdk !== 35 || compileSdk !== 35 || minimumSdk > targetSdk || targetSdk > compileSdk) {
    invalidConfiguration("SDK levels must use the qualified minimum 23, target 35, and compile 35 matrix.")
  }
  if (buildToolsVersion != toolchain.buildTools) invalidConfiguration("Build Tools version must be exactly '35.0.0'.")
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
    invalidConfiguration("Version code must be a positive Android-safe integer.")
  }
  if (typeof versionName != "string" || !semanticVersionPattern.test(versionName)) {
    invalidConfiguration("Version name must be a canonical non-empty semantic version string.")
  }
  if (orientation != "unspecified") invalidConfiguration("The baseline orientation is exactly 'unspecified'.")
  if (theme != "system") invalidConfiguration("The baseline theme is exactly 'system'.")
  if (configuration.permissions !== undefined &&
    (!isDenseArray(configuration.permissions) || configuration.permissions.length != 0)) {
    invalidConfiguration("The baseline Android permission set must be empty.")
  }

  return {
    activityClassName,
    applicationId,
    buildToolsVersion,
    compileSdk,
    displayName,
    minimumSdk,
    namespace,
    orientation,
    packageName,
    productName,
    targetSdk,
    theme,
    versionCode,
    versionName
  }
}

/**
 * Validates, snapshots, and orders caller-provided inputs.
 * @param {unknown} candidate - Candidate resource or asset list.
 * @param {"asset" | "resource"} kind - Android input kind.
 * @returns {AndroidInputFile[]} Normalized inputs.
 */
function normalizeInputFiles(candidate, kind) {
  if (candidate === undefined) return []
  if (!isDenseArray(candidate)) invalidResource(`Application ${kind}s must be a dense array.`)
  /** @type {AndroidInputFile[]} */
  const files = []

  for (let index = 0; index < candidate.length; index += 1) {
    const item = candidate[index]

    if (!isPlainObject(item) || Object.keys(item).length != resourceFields.size ||
      Object.keys(item).some(key => !resourceFields.has(key))) invalidResource(`${capitalize(kind)} ${index} must use the closed input schema.`)
    const path = item.path
    const content = item.content
    const mediaType = item.mediaType
    const sha256 = item.sha256

    if (!isSafeArtifactPath(path) || kind == "resource" && !isAllowedResourcePath(path)) {
      invalidResource(`${capitalize(kind)} ${index} has an unsafe or unsupported path.`)
    }
    if (typeof content != "string" && !(content instanceof Uint8Array) || typeof content == "string" &&
      (content.length == 0 || !hasOnlyUnicodeScalars(content)) || content instanceof Uint8Array && content.byteLength == 0) {
      invalidResource(`${capitalize(kind)} '${path}' requires non-empty exact content.`)
    }
    if (typeof mediaType != "string" || !mediaTypePattern.test(mediaType) || /[\r\n]/u.test(mediaType)) {
      invalidResource(`${capitalize(kind)} '${path}' requires an explicit valid media type.`)
    }
    if (kind == "resource" && path.startsWith("drawable-") && !["image/png", "image/webp"].includes(mediaType)) {
      invalidResource(`Drawable resource '${path}' must use PNG or WebP media type.`)
    }
    const snapshot = typeof content == "string" ? content : new Uint8Array(content)
    const actualHash = createHash("sha256").update(snapshot).digest("hex")

    if (typeof sha256 != "string" || !/^[0-9a-f]{64}$/u.test(sha256) || sha256 != actualHash) {
      invalidResource(`${capitalize(kind)} '${path}' SHA-256 does not match its exact content.`)
    }
    const fullPath = `${projectRoot}/app/src/main/${kind == "resource" ? "res" : "assets"}/${path}`

    files.push({content: snapshot, contentKind: typeof snapshot == "string" ? "text" : "binary", fullPath, mediaType, path, sha256})
  }
  files.sort((left, right) => left.fullPath < right.fullPath ? -1 : left.fullPath > right.fullPath ? 1 : 0)
  const conflict = findPortableArtifactPathConflict(files.map(({fullPath}) => fullPath))

  if (conflict) invalidResource(`${capitalize(kind)} path '${conflict.path}' has a ${conflict.kind} conflict.`)
  if (kind == "resource") validateResourceIdentifiers(files)

  return files
}

/**
 * Rejects two files that Android would compile to the same resource identifier in one configuration.
 * @param {AndroidInputFile[]} files - Validated resource inputs.
 */
function validateResourceIdentifiers(files) {
  const identifiers = new Map()

  for (const file of files) {
    const separator = file.path.indexOf("/")
    const directory = file.path.slice(0, separator)
    const filename = file.path.slice(separator + 1)
    const extension = filename.indexOf(".")
    const name = extension == -1 ? filename : filename.slice(0, extension)
    const resourceType = directory.split("-", 1)[0]
    const key = `${directory}/${name}`
    const previous = identifiers.get(key)

    if (previous) {
      invalidResource(`Android resource identifier '${resourceType}/${name}' collides between '${previous}' and '${file.path}' in configuration '${directory}'.`)
    }
    identifiers.set(key, file.path)
  }
}

/**
 * Tests whether a caller resource uses the narrow allowlisted resource grammar.
 * @param {string} value - Resource path relative to res.
 * @returns {boolean} Whether the path is supported.
 */
function isAllowedResourcePath(value) {
  if (/^raw\/[a-z][a-z0-9_]*(?:\.[a-z0-9]+)?$/u.test(value)) return true

  return /^drawable-(?:mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)\/[a-z][a-z0-9_]*\.(?:png|webp)$/u.test(value)
}

/**
 * Converts a validated input snapshot into an owned artifact.
 * @param {AndroidInputFile} item - Validated caller input.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Owned input artifact.
 */
function inputFileArtifact(item) {
  const reason = `Exact caller-provided Android input (sha256:${item.sha256}).`

  if (typeof item.content == "string") {
    return {
      ...syntheticText(item.fullPath, "resource", item.content, reason),
      mediaType: item.mediaType
    }
  }
  const content = new Uint8Array(item.content)

  return {
    content,
    contentKind: "binary",
    mediaType: item.mediaType,
    ownership: "generated",
    path: item.fullPath,
    provenance: {kind: "bytes", mapping: createByteMapping({
      byteLength: content.byteLength,
      path: item.fullPath,
      ranges: [{generated: {end: content.byteLength, start: 0},
        origin: {kind: "synthetic", reason, relatedOrigins: []}, role: "resource"}]
    })},
    role: "resource"
  }
}

/**
 * Creates a deterministic synthetic text artifact.
 * @param {string} path - Artifact path.
 * @param {import("../semantic/types.js").GeneratedArtifactRole} role - Artifact role.
 * @param {string} content - UTF-8 artifact content.
 * @param {string} reason - Synthetic provenance reason.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Text artifact.
 */
function syntheticText(path, role, content, reason) {
  return {content, contentKind: "text", mediaType: mediaTypeFor(path), ownership: "generated", path,
    provenance: {kind: "synthetic", reason, relatedOrigins: []}, role}
}

/**
 * Creates a configuration-derived text artifact.
 * @param {string} path - Artifact path.
 * @param {import("../semantic/types.js").GeneratedArtifactRole} role - Artifact role.
 * @param {string} content - UTF-8 artifact content.
 * @param {string} reason - Synthetic provenance reason.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Text artifact.
 */
function configuredText(path, role, content, reason) {
  return syntheticText(path, role, content, reason)
}

/**
 * Derives the media type for a generated text path.
 * @param {string} path - Generated artifact path.
 * @returns {string} Artifact media type.
 */
function mediaTypeFor(path) {
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".xml")) return "application/xml"
  if (path.endsWith(".kt") || path.endsWith(".kts")) return "text/x-kotlin"

  return "text/plain"
}

/**
 * Marks one rendered value as configuration-derived.
 * @param {string} fieldName - Configuration field name.
 * @param {string} value - Rendered field value.
 * @returns {{field: string, value: string}} Marked configuration value.
 */
function field(fieldName, value) {
  return {field: fieldName, value}
}

/**
 * Joins rendered parts while recording configuration causality.
 * @param {string} path - Output artifact path.
 * @param {ConfigurationSpan[]} spans - Mutable provenance span collector.
 * @param {(string | {field: string, value: string})[]} parts - Synthetic and marked parts.
 * @returns {string} Rendered text.
 */
function configured(path, spans, parts) {
  let content = ""

  for (const part of parts) {
    if (typeof part == "string") content += part
    else {
      const start = content.length

      content += part.value
      spans.push({end: content.length, field: part.field, path, start})
    }
  }

  return content
}

/**
 * Groups configuration spans by artifact.
 * @param {ConfigurationSpan[]} spans - All rendered configuration spans.
 * @param {string} fieldName - Requested configuration field.
 * @returns {{path: string, ranges: {end: number, start: number}[]}[]} Output ranges.
 */
function configurationOutputs(spans, fieldName) {
  const grouped = new Map()

  for (const span of spans) {
    if (span.field != fieldName) continue
    const ranges = grouped.get(span.path) ?? []

    ranges.push({end: span.end, start: span.start})
    grouped.set(span.path, ranges)
  }

  return [...grouped].map(([path, ranges]) => ({path, ranges}))
}

/**
 * Tests whether a mapping origin refers to one semantic source file.
 * @param {import("../semantic/types.js").SemanticOrigin} origin - Mapping origin.
 * @param {string} filename - Semantic source filename.
 * @returns {boolean} Whether the origin owns the filename.
 */
function originReferencesFilename(origin, filename) {
  if (origin.kind == "source") return origin.location.filename == filename
  if (origin.kind == "derived") return origin.origins.some(({location}) => location.filename == filename)

  return origin.relatedOrigins.some(({location}) => location.filename == filename)
}

/**
 * Hashes exact text or bytes for ownership records.
 * @param {string | Uint8Array} content - Exact artifact content.
 * @returns {string} Lowercase SHA-256 digest.
 */
function hashContent(content) {
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Serializes JSON with recursively stable object-key ordering.
 * @param {unknown} value - JSON-compatible value.
 * @returns {string} Canonical indented JSON with trailing newline.
 */
function stringifyCanonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

/**
 * Recursively sorts object keys without changing array order.
 * @param {unknown} value - JSON-compatible value.
 * @returns {unknown} Canonically ordered value.
 */
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainObject(value)) return value

  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]))
}

/**
 * Tests a lowercase Kotlin-compatible package identity.
 * @param {string} value - Candidate package name.
 * @returns {boolean} Whether the name is accepted.
 */
function isPackageName(value) {
  const parts = value.split(".")

  return parts.length >= 2 && parts.every(part => /^[a-z][a-z0-9_]*$/u.test(part) && !kotlinKeywords.has(part))
}

/**
 * Rejects launcher names that shadow an unqualified symbol in generated same-package Kotlin.
 * @param {string} activityClassName - Validated launcher class name.
 * @param {string} entryModule - Selected semantic entry module.
 */
function validateActivityClassName(activityClassName, entryModule) {
  const semanticEntrySymbol = `SemantifoldModule${moduleName(entryModule)}`

  if (androidScaffoldSymbols.has(activityClassName) || activityClassName == semanticEntrySymbol) {
    invalidConfiguration(`Activity class name '${activityClassName}' collides with generated Kotlin symbol '${activityClassName}'.`)
  }
}

/**
 * Allocates one module-wide output sink that cannot shadow a source binding.
 * @param {import("../semantic/types.js").SemanticModule} module - Prepared semantic module.
 * @returns {string} Collision-safe Kotlin binding.
 */
function outputSinkName(module) {
  const bindings = new Set(module.functions.flatMap(declaration => declaration.parameters.map(({name}) => name)))

  for (const declaration of module.functions) collectBlockBindingNames(declaration.body, bindings)
  collectBlockBindingNames(module.entryPoint.body, bindings)
  let candidate = "semantifoldOutput"

  while (bindings.has(candidate)) candidate += "_"

  return candidate
}

/**
 * Collects local bindings recursively from the supported semantic block subset.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {Set<string>} bindings - Mutable binding-name set.
 */
function collectBlockBindingNames(block, bindings) {
  for (const statement of block.statements) {
    if (statement.kind == "LocalDeclaration") bindings.add(statement.name)
    else if (statement.kind == "IfStatement") {
      collectBlockBindingNames(statement.consequent, bindings)
      if (statement.alternate) collectBlockBindingNames(statement.alternate, bindings)
    }
  }
}

/**
 * Maps a preflighted module identity to a stable Kotlin suffix.
 * @param {string} id - Semantic module identity.
 * @returns {string} Kotlin object-name suffix.
 */
function moduleName(id) {
  return id.split(/[._-]+/u).map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join("")
}

/**
 * Wraps legacy single-module input in the canonical program contract.
 * @param {import("../semantic/types.js").SemanticModule | undefined} candidate - Candidate semantic module.
 * @returns {import("../semantic/types.js").SemanticProgram} Canonical single-module program.
 */
function normalizeSingleModule(candidate) {
  if (!isPlainObject(candidate)) unsupportedCapability("android", "missing or invalid module", undefined)
  const module = structuredClone(candidate)
  const sources = module.provenance?.sources

  if (!Array.isArray(sources) || sources.length != 1 || sources[0].content === null ||
    sources[0].filename != module.location?.filename || typeof sources[0].language != "string") {
    unsupportedCapability("android", "single-module source ownership", module.location)
  }
  rekeyModuleDeclarations(module, "main")
  const exports = [
    ...(module.records ?? []).map(declaration => applicationExport(declaration, "record")),
    ...(module.classes ?? []).map(declaration => applicationExport(declaration, "class")),
    ...(module.errors ?? []).map(declaration => applicationExport(declaration, "error")),
    ...module.functions.map(declaration => applicationExport(declaration, "function"))
  ]
  const programModule = {...module, exports, id: "main", imports: [], sourceFilename: sources[0].filename}

  return {entryModule: "main", kind: "Program", modules: [programModule], sources: structuredClone(sources)}
}

/**
 * Creates an application-local export record for single-module compatibility.
 * @param {{id?: string, location: import("../semantic/types.js").SourceLocation, name: string}} declaration - Semantic declaration.
 * @param {import("../semantic/types.js").SemanticDeclarationKind} symbolKind - Declaration kind.
 * @returns {import("../semantic/types.js").SemanticExport} Semantic export.
 */
function applicationExport(declaration, symbolKind) {
  return {declarationId: /** @type {string} */ (declaration.id), exportedName: declaration.name,
    kind: /** @type {const} */ ("Export"), location: declaration.location, symbolKind}
}

/**
 * Qualifies single-module declaration identities before program preflight.
 * @param {import("../semantic/types.js").SemanticModule} module - Cloned semantic module.
 * @param {string} moduleId - Canonical module identity.
 */
function rekeyModuleDeclarations(module, moduleId) {
  const declarations = [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions]
  const replacements = new Map(declarations.filter(declaration => typeof declaration.id == "string")
    .map(declaration => [declaration.id, `${moduleId}#${declaration.id}`]))

  for (const declaration of declarations) if (typeof declaration.id == "string") declaration.id = replacements.get(declaration.id)
  const seen = new Set()
  const identityFields = new Set(["classId", "declarationId", "field", "method", "parameterId"])
  /**
   * Rewrites declaration references throughout one semantic value graph.
   * @param {unknown} value - Candidate nested semantic value.
   */
  const visit = value => {
    if (!value || typeof value != "object" || seen.has(value)) return
    seen.add(value)
    for (const [key, nested] of Object.entries(value)) {
      if (!Array.isArray(value) && identityFields.has(key) && typeof nested == "string" && replacements.has(nested)) {
        Reflect.set(value, key, replacements.get(nested))
      } else visit(nested)
    }
  }

  visit(module)
}

/**
 * Escapes a configuration value for XML text or attributes.
 * @param {string} value - Raw configuration value.
 * @returns {string} XML-safe value.
 */
function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

/**
 * Escapes a configuration value for a Kotlin string literal body.
 * @param {string} value - Raw configuration value.
 * @returns {string} Kotlin-safe value.
 */
function kotlinEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")
}

/**
 * Uppercases the initial ASCII character of a known non-empty word.
 * @param {string} value - Non-empty word.
 * @returns {string} Capitalized word.
 */
function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`
}

/**
 * Tests whether a value is a plain data object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is a plain object.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Throws a stable invalid-request diagnostic.
 * @param {string} message - Diagnostic message.
 * @returns {never} Never returns.
 */
function invalidInput(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_INPUT", language: "android", message})
}

/**
 * Throws a stable invalid-configuration diagnostic.
 * @param {string} message - Diagnostic message.
 * @returns {never} Never returns.
 */
function invalidConfiguration(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_CONFIGURATION", language: "android", message})
}

/**
 * Throws a stable invalid-resource diagnostic.
 * @param {string} message - Diagnostic message.
 * @returns {never} Never returns.
 */
function invalidResource(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_RESOURCE", language: "android", message})
}

/**
 * Throws a stable invalid-path diagnostic.
 * @param {string} message - Diagnostic message.
 * @returns {never} Never returns.
 */
function invalidPath(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_PATH", language: "android", message})
}
