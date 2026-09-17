// @ts-check

import {createHash} from "node:crypto"
import {isDenseArray} from "../array.js"
import {findPortableArtifactPathConflict, isSafeArtifactPath} from "../artifact-path.js"
import {createByteMapping} from "../binary-mapping.js"
import {SemantifoldDiagnostic, unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {dartRuntime} from "./dart-runtime.js"
import {emitDartBlock, findUnreadDartLocals} from "./dart.js"
import {preflightSemanticProgram} from "./program.js"
import {emitScalarType} from "./scalars.js"
import {SourceWriter} from "./writer.js"

const projectRoot = "generated/flutter-app"
const generatorVersion = "0.6.0"
const flutterToolchain = Object.freeze({
  archive: "flutter_linux_3.47.4-stable.tar.xz",
  archiveSha256: "5b45f0ceda99b9bebdc873e7e69f6450aeb4c30f454b505e2e62fc9255a907d3",
  dart: "3.13.3",
  revision: "9584c6713b324636289d067944a46fd6b49df14b",
  version: "3.47.4"
})
const androidToolchain = Object.freeze({
  androidGradlePlugin: "8.11.1",
  buildTools: "35.0.0",
  cmake: "3.22.1",
  compileSdk: 35,
  gradle: "8.14",
  java: "21.0.8",
  kotlinGradlePlugin: "2.2.20",
  minimumSdk: 23,
  ndk: "27.0.12077973",
  targetSdk: 35
})
/** @type {readonly (readonly [string, string, string])[]} */
const flutterLockedHostedPackages = Object.freeze([
  ["async", "2.13.1", "e2eb0491ba5ddb6177742d2da23904574082139b07c1e33b8503b9f46f3e1a37"],
  ["boolean_selector", "2.1.2", "8aab1771e1243a5063b8b0ff68042d67334e3feab9e95b9490f9a6ebf73b42ea"],
  ["characters", "1.4.1", "faf38497bda5ead2a8c7615f4f7939df04333478bf32e4173fcb06d428b5716b"],
  ["clock", "1.1.3", "e51d50bca3217c9a9fa2b41a30e4a38971133f5f9ec7a3d57bae095007f1d28e"],
  ["collection", "1.19.1", "2f5709ae4d3d59dd8f7cd309b4e023046b57d8a6c82130785d2b0e5868084e76"],
  ["fake_async", "1.3.3", "5368f224a74523e8d2e7399ea1638b37aecfca824a3cc4dfdf77bf1fa905ac44"],
  ["leak_tracker", "11.0.2", "33e2e26bdd85a0112ec15400c8cbffea70d0f9c3407491f672a2fad47915e2de"],
  ["leak_tracker_flutter_testing", "3.0.10", "1dbc140bb5a23c75ea9c4811222756104fbcd1a27173f0c34ca01e16bea473c1"],
  ["leak_tracker_testing", "3.0.2", "8d5a2d49f4a66b49744b23b018848400d23e54caf9463f4eb20df3eb8acb2eb1"],
  ["matcher", "0.12.20", "31bd099b47c10cd1aeb55146a2d46ce0277630ecef3f7dae54ad7873f36696cd"],
  ["material_color_utilities", "0.13.0", "9c337007e82b1889149c82ed242ed1cb24a66044e30979c44912381e9be4c48b"],
  ["meta", "1.19.0", "307249ce4ff29d58a18e97f6345f539382eb9c9c29ecda628900f31de0443dd9"],
  ["path", "1.9.1", "75cca69d1490965be98c73ceaea117e8a04dd21217b37b292c9ddbec0d955bc5"],
  ["source_span", "1.10.2", "56a02f1f4cd1a2d96303c0144c93bd6d909eea6bee6bf5a0e0b685edbd4c47ab"],
  ["stack_trace", "1.12.2", "277654b3034d17ac6f9f1cb5595db011b1d5d41e8806866db28e0abaa101c490"],
  ["stream_channel", "2.1.4", "969e04c80b8bcdf826f8f16579c7b14d780458bd97f56d107d3950fdbeef059d"],
  ["string_scanner", "1.4.1", "921cd31725b72fe181906c6a94d987c78e3b98c2e205b397ea399d4054872b43"],
  ["term_glyph", "1.2.2", "7f554798625ea768a7518313e58f83891c7f5024f88e46e7182a4558850a4b8e"],
  ["test_api", "0.7.12", "2a122cbe059f8b610d3a5415f42e255b6c17b1f21eee1d960f31080237fb4f11"],
  ["vector_math", "2.4.2", "f36f9f3be64c6198714492bb455c11056e33e2f85d9a0b676a48301e44fdcf47"],
  ["vm_service", "15.3.0", "5f37239c4851efcef929cea7824e76df7f2f0970aef85d66bbc430afa40e72f0"]
])
/** @type {readonly (readonly [string, "direct main" | "direct dev" | "transitive"])[]} */
const flutterLockedSdkPackages = Object.freeze([
  ["flutter", "direct main"],
  ["flutter_test", "direct dev"],
  ["sky_engine", "transitive"]
])
/** @type {Readonly<Set<import("../semantic/types.js").SemanticLanguage>>} */
const flutterSourceLanguages = new Set([
  "php", "ruby", "javascript", "typescript", "java", "kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "dart", "zig"
])
const requestFields = new Set(["assets", "configuration", "language", "module", "program", "role"])
const configurationFields = new Set([
  "activityClassName", "applicationId", "buildToolsVersion", "compileSdk", "displayName", "minimumSdk", "organization",
  "packageName", "permissions", "targetSdk", "versionCode", "versionName"
])
const assetFields = new Set(["content", "mediaType", "path", "sha256"])
const dartKeywords = new Set([
  "abstract", "as", "assert", "async", "await", "base", "break", "case", "catch", "class", "const", "continue",
  "covariant", "default", "deferred", "do", "dynamic", "else", "enum", "export", "extends", "extension", "external",
  "factory", "false", "final", "finally", "for", "Function", "get", "hide", "if", "implements", "import", "in",
  "interface", "is", "late", "library", "mixin", "new", "null", "of", "on", "operator", "part", "required",
  "rethrow", "return", "sealed", "set", "show", "static", "super", "switch", "sync", "this", "throw", "true",
  "try", "typedef", "var", "void", "when", "while", "with", "yield"
])
const javaKeywords = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default",
  "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private", "protected", "public",
  "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient",
  "try", "void", "volatile", "while"
])
const forbiddenPackageNames = new Set([
  ...flutterLockedHostedPackages.map(([name]) => name),
  ...flutterLockedSdkPackages.map(([name]) => name),
  "integration_test",
  "semantifold"
])
const androidRunnerBaseClassNames = new Set(["FlutterActivity"])
const semanticVersionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[A-Za-z-][A-Za-z0-9-]*)(?:\.(?:0|[1-9][0-9]*|[A-Za-z-][A-Za-z0-9-]*))*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/u
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:[\u0020-\u007e]+)?$/u
const excludedPathPatterns = Object.freeze([
  ".dart_tool/**", ".flutter-plugins", ".flutter-plugins-dependencies", "android/.gradle/**", "android/app/build/**",
  "android/local.properties", "build/**"
])
const outputSinkRuntime = `
final class _SemantifoldOutputSink {
  final List<String> _values = <String>[];

  void write(Object value) {
    if (value is! int && value is! bool && value is! String) {
      throw StateError('Unsupported Semantifold output value');
    }
    _values.add(value.toString());
  }

  List<String> snapshot() => List<String>.unmodifiable(_values);
}
`

/** @typedef {{content: string | Uint8Array, contentKind: "binary" | "text", fullPath: string, mediaType: string, path: string, sha256: string}} FlutterAsset */
/** @typedef {{end: number, field: string, path: string, start: number}} ConfigurationSpan */

/**
 * Preflights a complete Flutter application request before rendering any artifact.
 * @param {Record<string, unknown>} input - Candidate application request.
 * @returns {{assets: FlutterAsset[], configuration: import("../semantic/types.js").FlutterApplicationConfiguration, modulePaths: Map<string, string>, modules: import("../semantic/types.js").SemanticModule[], packagePath: string, program: import("../semantic/types.js").SemanticProgram, sources: {content: string, filename: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} Prepared application.
 */
export function preflightFlutterApplication(input) {
  if (!isPlainObject(input) || Object.keys(input).some(key => !requestFields.has(key)) ||
    Boolean(input.module) == Boolean(input.program)) {
    invalidInput("Flutter application generation requires a closed request with exactly one semantic module or program.")
  }
  if (input.language !== undefined && input.language != "flutter" || input.role !== undefined && input.role != "application") {
    invalidInput("Flutter application generation accepts only the Flutter application role.")
  }
  const configuration = normalizeConfiguration(input.configuration)
  const program = input.program ?? normalizeSingleModule(
    /** @type {import("../semantic/types.js").SemanticModule | undefined} */ (input.module))
  const prepared = preflightSemanticProgram({
    backendLanguage: "dart",
    diagnosticLanguage: "flutter",
    program: /** @type {import("../semantic/types.js").SemanticProgram} */ (program),
    sourceLanguages: flutterSourceLanguages
  })
  const entryModule = prepared.modules.find(module => Reflect.get(module, "id") == prepared.program.entryModule)
  const entryCollision = entryModule?.functions.find(({name}) => name == "semantifoldEntry")

  if (entryCollision) unsupportedCapability("flutter", "reserved generated semantic entry function 'semantifoldEntry'", entryCollision.location)
  const packagePath = configuration.applicationId.replaceAll(".", "/")
  const modulePaths = new Map(prepared.modules.map(module => {
    const moduleId = /** @type {string} */ (Reflect.get(module, "id"))

    return [moduleId, `${projectRoot}/lib/src/semantic/${moduleFileName(moduleId)}.dart`]
  }))
  const assets = normalizeAssets(input.assets)
  const completePaths = [...applicationPaths(configuration, modulePaths), ...assets.map(({fullPath}) => fullPath)]
  const conflict = findPortableArtifactPathConflict(completePaths)

  if (conflict) {
    invalidPath(`Application artifact path '${conflict.path}' has a ${conflict.kind} conflict${conflict.other ? ` with '${conflict.other}'` : ""}.`)
  }
  const semanticNames = new Map()

  for (const module of prepared.modules) {
    const moduleId = /** @type {string} */ (Reflect.get(module, "id"))
    const name = moduleName(moduleId)
    const previous = semanticNames.get(name)

    if (previous) invalidPath(`Semantic modules '${previous}' and '${moduleId}' collide at generated Dart class '${name}'.`)
    semanticNames.set(name, moduleId)
  }

  return {...prepared, assets, configuration, modulePaths, packagePath}
}

/**
 * Generates one deterministic SDK-only Flutter project for the qualified Android lane.
 * @param {Record<string, unknown>} input - Application generation request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], metadata: {applicationManifest: string, platformQualification: {android: string, ios: string}}, target: "flutter"}} Candidate artifact set.
 */
export function generateFlutterApplication(input) {
  const prepared = preflightFlutterApplication(input)
  const configurationSpans = /** @type {ConfigurationSpan[]} */ ([])
  const configuration = prepared.configuration
  const semanticArtifacts = renderSemanticArtifacts(prepared)
  const artifacts = /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */ ([
    syntheticText(`${projectRoot}/.metadata`, "manifest", renderMetadata(),
      "Exact Flutter 3.47.4 project-template identity; generated migration is disabled."),
    syntheticText(`${projectRoot}/analysis_options.yaml`, "support", renderAnalysisOptions(),
      "Closed analyzer configuration without external lint packages."),
    configuredText(`${projectRoot}/android/app/build.gradle.kts`, "manifest", renderAndroidAppBuild(configuration, configurationSpans),
      "Task 028-compatible Android build and isolated debug-signing configuration."),
    configuredText(`${projectRoot}/android/app/src/main/AndroidManifest.xml`, "manifest",
      renderAndroidManifest(configuration, configurationSpans), "Closed permission-free Flutter Android application manifest."),
    configuredText(`${projectRoot}/android/app/src/main/java/${prepared.packagePath}/${configuration.activityClassName}.java`, "support",
      renderAndroidActivity(configuration, configurationSpans), "Synthetic Flutter Android embedding launcher."),
    syntheticText(`${projectRoot}/android/app/src/main/res/drawable/launch_background.xml`, "resource", renderLaunchBackground(),
      "Synthetic minimum-SDK-qualified Flutter launch background."),
    syntheticText(`${projectRoot}/android/app/src/main/res/values-night/styles.xml`, "resource", renderAndroidStyles(true),
      "Synthetic dark platform launch and Flutter host themes."),
    syntheticText(`${projectRoot}/android/app/src/main/res/values/styles.xml`, "resource", renderAndroidStyles(false),
      "Synthetic light platform launch and Flutter host themes."),
    syntheticText(`${projectRoot}/android/app/src/main/res/xml/backup_rules.xml`, "resource", renderBackupRules(),
      "Closed API 23-30 full-backup exclusions reused from the Android safety contract."),
    syntheticText(`${projectRoot}/android/app/src/main/res/xml/data_extraction_rules.xml`, "resource", renderDataExtractionRules(),
      "Closed Android 12+ backup and transfer exclusions reused from the Android safety contract."),
    syntheticText(`${projectRoot}/android/build.gradle.kts`, "manifest", renderAndroidRootBuild(),
      "Task 028-compatible deterministic Android root build."),
    syntheticText(`${projectRoot}/android/gradle.properties`, "support", renderAndroidGradleProperties(),
      "Pinned isolated Gradle properties for the qualified Android lane."),
    configuredText(`${projectRoot}/android/settings.gradle.kts`, "manifest", renderAndroidSettings(configuration, configurationSpans),
      "Exact Flutter Gradle plugin loader with the pinned Task 028 Android plugin matrix."),
    configuredText(`${projectRoot}/lib/main.dart`, "entry", renderWidgetApplication(prepared, configurationSpans),
      "Synthetic stateless Material application and labelled output widget."),
    ...semanticArtifacts,
    syntheticText(`${projectRoot}/pubspec.lock`, "manifest", renderPubspecLock(),
      "Exact Flutter 3.47.4 SDK dependency resolution; no caller package resolution."),
    configuredText(`${projectRoot}/pubspec.yaml`, "manifest", renderPubspec(prepared, configurationSpans),
      "Closed SDK-only Flutter package and asset manifest."),
    configuredText(`${projectRoot}/test/semantic_logic_test.dart`, "support", renderLogicTest(prepared, configurationSpans),
      "SDK-owned Flutter test for fresh deterministic semantic entry execution."),
    configuredText(`${projectRoot}/test/widget_test.dart`, "support", renderWidgetTest(prepared, configurationSpans),
      "SDK-owned Flutter widget test for exact text, key, and semantics label."),
    ...prepared.assets.map(assetArtifact)
  ])

  artifacts.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const manifestPath = `${projectRoot}/semantifold-project.json`

  artifacts.push(syntheticText(manifestPath, "manifest",
    renderProjectManifest(prepared, artifacts, manifestPath, configurationSpans),
    "Versioned Flutter project ownership, toolchain, provenance, and platform-status manifest."))

  return {
    artifacts,
    metadata: {
      applicationManifest: manifestPath,
      platformQualification: {android: "tensorbuzz-kvm", ios: "deferred-owner-direction"}
    },
    target: "flutter"
  }
}

/**
 * Emits mapped application-owned Dart semantic modules.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared application.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact[]} Semantic Dart artifacts.
 */
function renderSemanticArtifacts(prepared) {
  const declarations = new Map()

  for (const module of prepared.modules) {
    for (const declaration of module.functions) declarations.set(declaration.id, {
      declaration,
      moduleId: /** @type {string} */ (Reflect.get(module, "id"))
    })
  }
  /** @type {import("../semantic/types.js").GeneratedSetArtifact[]} */
  const artifacts = [syntheticText(`${projectRoot}/lib/src/semantic/semantifold.dart`, "support",
    renderSemanticLibrary(prepared), "Shared checked Dart scalar/output runtime and deterministic part ownership.")]

  for (const module of prepared.modules) {
    const moduleId = /** @type {string} */ (Reflect.get(module, "id"))
    const filename = /** @type {string} */ (prepared.modulePaths.get(moduleId))
    const sinkName = outputSinkName(module)
    const writer = new SourceWriter({
      callArgumentSuffix: sinkName,
      callNameResolver: expression => {
        const resolved = declarations.get(expression.resolution?.declarationId)

        if (!resolved) throw new TypeError(`Unknown validated Flutter function '${expression.resolution?.declarationId}'.`)

        return `SemantifoldModule${moduleName(resolved.moduleId)}.${resolved.declaration.name}`
      },
      filename,
      language: "dart",
      module,
      program: prepared.program,
      programPaths: prepared.modulePaths,
      sources: prepared.sources
    })

    writer.synthetic("part of 'semantifold.dart';\n\n", "Flutter semantic library part directive", [module], [""])
    emitSemanticModule(writer, module, moduleId, moduleId == prepared.program.entryModule, sinkName)
    const mapping = finalizeMapping(writer.finish())

    artifacts.push({
      content: mapping.generated.content,
      contentKind: "text",
      mediaType: "text/x-dart",
      ownership: "generated",
      path: filename,
      provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping), sourceMapFilename: `${filename}.map`},
      role: "source"
    })
  }

  return artifacts
}

/**
 * Emits one namespaced semantic Dart part.
 * @param {SourceWriter} writer - Mapped source writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Prepared semantic module.
 * @param {string} moduleId - Stable semantic module identity.
 * @param {boolean} entry - Whether this module owns the application entry.
 * @param {string} sinkName - Collision-safe output sink binding.
 */
function emitSemanticModule(writer, module, moduleId, entry, sinkName) {
  const unreadLocals = findUnreadDartLocals(module)

  writer.synthetic(`abstract final class SemantifoldModule${moduleName(moduleId)} {\n`,
    "Flutter semantic module namespace", [module], [""])
  module.functions.forEach((declaration, functionIndex) => {
    const path = `/functions/${functionIndex}`

    writer.synthetic("  static ", "Flutter namespaced function scaffold", [declaration], [path])
    writer.mapped(emitScalarType("dart", declaration.returnType), {
      mappingKind: "exact", node: declaration.returnType, path: `${path}/returnType`, role: "type"
    })
    writer.synthetic(" ", "declaration spacing", [declaration], [path])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
    const parameterTexts = declaration.parameters.map(parameter => `${emitScalarType("dart", parameter.type)} ${parameter.name}`)

    parameterTexts.push(`_SemantifoldOutputSink ${sinkName}`)
    const multiline = writer.column - 1 + `(${parameterTexts.join(", ")}) {`.length > 80

    writer.mapped("(", {mappingKind: "anchor", node: declaration, path})
    declaration.parameters.forEach((parameter, parameterIndex) => {
      const parameterPath = `${path}/parameters/${parameterIndex}`

      if (multiline) writer.synthetic(`${parameterIndex ? "" : "\n"}    `,
        "Dart application parameter indentation", [parameter], [parameterPath])
      else if (parameterIndex) writer.synthetic(", ", "parameter separator", [parameter], [parameterPath])
      writer.mapped(emitScalarType("dart", parameter.type), {
        mappingKind: "exact", node: parameter.type, path: `${parameterPath}/type`, role: "type"
      })
      writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      if (multiline) writer.synthetic(",\n", "Dart formatter parameter separator", [parameter], [parameterPath])
    })
    if (multiline) writer.synthetic(`${declaration.parameters.length ? "" : "\n"}    _SemantifoldOutputSink ${sinkName},\n  `,
      "Flutter output sink parameter", [declaration], [path])
    else writer.synthetic(`${declaration.parameters.length ? ", " : ""}_SemantifoldOutputSink ${sinkName}`,
      "Flutter output sink parameter", [declaration], [path])
    writer.mapped(")", {mappingKind: "anchor", node: declaration, path})
    writer.synthetic(" {\n", "Dart function body scaffold", [declaration], [path])
    emitDartBlock(writer, declaration.body, "    ", `${path}/body`, unreadLocals, `${sinkName}.write`, true)
    writer.synthetic("  }\n", "Dart function body scaffold", [declaration], [path])
    if (functionIndex + 1 < module.functions.length || entry) {
      writer.synthetic("\n", "Dart formatter declaration separator", [declaration], [path])
    }
  })
  if (entry) {
    writer.synthetic("  static List<String> semantifoldEntry() {\n", "Flutter semantic entry scaffold",
      [module.entryPoint], ["/entryPoint"])
    writer.synthetic(`    final _SemantifoldOutputSink ${sinkName} = _SemantifoldOutputSink();\n`,
      "Flutter output sink allocation", [module.entryPoint], ["/entryPoint"])
    emitDartBlock(writer, module.entryPoint.body, "    ", "/entryPoint/body", unreadLocals, `${sinkName}.write`, true)
    writer.synthetic(`    return ${sinkName}.snapshot();\n`, "Flutter semantic output return",
      [module.entryPoint], ["/entryPoint"])
    writer.synthetic("  }\n", "Flutter semantic entry scaffold", [module.entryPoint], ["/entryPoint"])
  }
  writer.synthetic("}\n", "Flutter semantic module namespace", [module], [""])
}

/**
 * Renders the shared semantic Dart library.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared project.
 * @returns {string} Dart library source.
 */
function renderSemanticLibrary(prepared) {
  const parts = prepared.modules.map(module => `part '${moduleFileName(/** @type {string} */ (Reflect.get(module, "id")))}.dart';`).join("\n")

  return `${parts}\n\n${dartRuntime}${outputSinkRuntime}`
}

/**
 * Renders exact Flutter template identity metadata.
 * @returns {string} Metadata YAML.
 */
function renderMetadata() {
  return `# This file tracks properties of this Semantifold-owned Flutter project.
version:
  revision: ${flutterToolchain.revision}
  channel: stable
project_type: app
`
}

/**
 * Renders the closed analyzer configuration.
 * @returns {string} Analyzer YAML.
 */
function renderAnalysisOptions() {
  return `analyzer:
  language:
    strict-casts: true
    strict-raw-types: true
`
}

/**
 * Renders the SDK-only package manifest.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared project.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Pubspec YAML.
 */
function renderPubspec(prepared, spans) {
  const configuration = prepared.configuration
  const assetLines = prepared.assets.length == 0 ? "" : `\n  assets:\n${prepared.assets.map(({path}) => `    - ${path}`).join("\n")}\n`

  return configured(`${projectRoot}/pubspec.yaml`, spans, [
    "name: ", field("packageName", configuration.packageName), "\npublish_to: none\nversion: ",
    field("versionName", configuration.versionName), "+", field("versionCode", String(configuration.versionCode)),
    "\nenvironment:\n  sdk: 3.13.3\n  flutter: 3.47.4\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n",
    assetLines
  ])
}

/**
 * Renders the exact Flutter SDK dependency lock.
 * @returns {string} Pub lock YAML.
 */
function renderPubspecLock() {
  const hosted = new Map(flutterLockedHostedPackages.map(package_ => [package_[0], package_]))
  const sdk = new Map(flutterLockedSdkPackages)
  const packageNames = [...hosted.keys(), ...sdk.keys()].sort()
  const packages = packageNames.map(name => {
    const sdkDependency = sdk.get(name)

    if (sdkDependency) return `  ${name}:
    dependency: ${sdkDependency == "transitive" ? sdkDependency : `"${sdkDependency}"`}
    description: flutter
    source: sdk
    version: "0.0.0"`
    const locked = hosted.get(name)

    if (!locked) throw new TypeError(`Missing validated Flutter lock entry '${name}'.`)
    const [, version, sha256] = locked
    const renderedHash = /^[0-9]/u.test(sha256) ? `"${sha256}"` : sha256

    return `  ${name}:
    dependency: transitive
    description:
      name: ${name}
      sha256: ${renderedHash}
      url: "https://pub.dev"
    source: hosted
    version: "${version}"`
  }).join("\n")

  return `# Generated by pub
# See https://dart.dev/tools/pub/glossary#lockfile
packages:
${packages}
sdks:
  dart: "3.13.3"
  flutter: "3.47.4"
`
}

/**
 * Renders the synthetic Material widget shell.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared project.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Flutter entry source.
 */
function renderWidgetApplication(prepared, spans) {
  const entryClass = `SemantifoldModule${moduleName(prepared.program.entryModule)}`

  return configured(`${projectRoot}/lib/main.dart`, spans, [
    `import 'package:flutter/material.dart';

import 'src/semantic/semantifold.dart';

void main() {
  runApp(const SemantifoldApplication());
}

class SemantifoldApplication extends StatelessWidget {
  const SemantifoldApplication({super.key});

  @override
  Widget build(BuildContext context) {
    final List<String> lines = ${entryClass}.semantifoldEntry();

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '`, field("displayName", dartEscape(prepared.configuration.displayName)), `',
      home: Scaffold(
        body: Center(
          child: Semantics(
            key: const Key('semantifold-output'),
            container: true,
            explicitChildNodes: true,
            label: 'semantifold-output',
            child: Text(lines.join('\\n')),
          ),
        ),
      ),
    );
  }
}
`
  ])
}

/**
 * Renders the semantic-entry determinism test.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared project.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Flutter test source.
 */
function renderLogicTest(prepared, spans) {
  const entryClass = `SemantifoldModule${moduleName(prepared.program.entryModule)}`

  return configured(`${projectRoot}/test/semantic_logic_test.dart`, spans, [
    "import 'package:flutter_test/flutter_test.dart';\nimport 'package:", field("packageName", prepared.configuration.packageName),
    `/src/semantic/semantifold.dart';

void main() {
  test('semantic entry is deterministic across fresh runs', () {
    expect(
      ${entryClass}.semantifoldEntry(),
      ${entryClass}.semantifoldEntry(),
    );
  });
}
`
  ])
}

/**
 * Renders the exact labelled widget test.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared project.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Flutter widget test source.
 */
function renderWidgetTest(prepared, spans) {
  const entryClass = `SemantifoldModule${moduleName(prepared.program.entryModule)}`

  return configured(`${projectRoot}/test/widget_test.dart`, spans, [
    "import 'package:flutter/material.dart';\nimport 'package:flutter_test/flutter_test.dart';\nimport 'package:",
    field("packageName", prepared.configuration.packageName), `/main.dart';
import 'package:`, field("packageName", prepared.configuration.packageName), `/src/semantic/semantifold.dart';

void main() {
  testWidgets('renders exact labelled semantic output', (
    WidgetTester tester,
  ) async {
    final String expected = ${entryClass}.semantifoldEntry().join('\\n');

    await tester.pumpWidget(const SemantifoldApplication());
    final Finder output = find.byKey(const Key('semantifold-output'));

    expect(output, findsOneWidget);
    expect(
      tester.widget<Semantics>(output).properties.label,
      'semantifold-output',
    );
    expect(
      find.descendant(of: output, matching: find.text(expected)),
      findsOneWidget,
    );
  });
}
`
  ])
}

/**
 * Renders the shared Android root build.
 * @returns {string} Gradle Kotlin source.
 */
function renderAndroidRootBuild() {
  return `allprojects {
  repositories {
    google()
    mavenCentral()
  }
}

val newBuildDir: Directory = rootProject.layout.buildDirectory.dir("../../build").get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
  project.layout.buildDirectory.value(newBuildDir.dir(project.name))
  project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
  delete(rootProject.layout.buildDirectory)
}
`
}

/**
 * Renders Flutter plugin and Android plugin ownership.
 * @param {import("../semantic/types.js").FlutterApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Gradle settings source.
 */
function renderAndroidSettings(configuration, spans) {
  return configured(`${projectRoot}/android/settings.gradle.kts`, spans, [`pluginManagement {
  val flutterSdkPath = run {
    val properties = java.util.Properties()
    file("local.properties").inputStream().use { properties.load(it) }
    requireNotNull(properties.getProperty("flutter.sdk")) { "flutter.sdk not set in local.properties" }
  }

  includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

plugins {
  id("dev.flutter.flutter-plugin-loader") version "1.0.0"
  id("com.android.application") version "${androidToolchain.androidGradlePlugin}" apply false
  id("org.jetbrains.kotlin.android") version "${androidToolchain.kotlinGradlePlugin}" apply false
}

rootProject.name = "`, field("packageName", configuration.packageName), `"
include(":app")
`])
}

/**
 * Renders deterministic Android Gradle properties.
 * @returns {string} Gradle properties.
 */
function renderAndroidGradleProperties() {
  return `android.builtInKotlin=false
android.newDsl=false
android.useAndroidX=true
kotlin.stdlib.default.dependency=false
org.gradle.caching=false
org.gradle.configuration-cache=false
org.gradle.daemon=false
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 -Duser.language=en -Duser.country=US -Duser.timezone=UTC
org.gradle.parallel=false
`
}

/**
 * Renders the Flutter Android application build.
 * @param {import("../semantic/types.js").FlutterApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Application Gradle source.
 */
function renderAndroidAppBuild(configuration, spans) {
  return configured(`${projectRoot}/android/app/build.gradle.kts`, spans, [`plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("dev.flutter.flutter-gradle-plugin")
}

val semantifoldAcceptanceRoot = providers.environmentVariable("SEMANTIFOLD_FLUTTER_ACCEPTANCE_ROOT").orNull
  ?: throw GradleException("SEMANTIFOLD_FLUTTER_INFRASTRUCTURE: SEMANTIFOLD_FLUTTER_ACCEPTANCE_ROOT is required")
val semantifoldDebugKeystore = file("$semantifoldAcceptanceRoot/debug.keystore")
if (!semantifoldDebugKeystore.isFile) {
  throw GradleException("SEMANTIFOLD_FLUTTER_INFRASTRUCTURE: ephemeral debug keystore is missing")
}

configurations.configureEach {
  exclude(group = "androidx.profileinstaller", module = "profileinstaller")
}

android {
  namespace = "`, field("applicationId", configuration.applicationId), `"
  compileSdk = `, field("compileSdk", String(configuration.compileSdk)), `
  buildToolsVersion = "`, field("buildToolsVersion", configuration.buildToolsVersion), `"
  ndkVersion = "${androidToolchain.ndk}"

  defaultConfig {
    applicationId = "`, field("applicationId", configuration.applicationId), `"
    minSdk = `, field("minimumSdk", String(configuration.minimumSdk)), `
    targetSdk = `, field("targetSdk", String(configuration.targetSdk)), `
    versionCode = `, field("versionCode", String(configuration.versionCode)), `
    versionName = "`, field("versionName", configuration.versionName), `"
  }

  signingConfigs {
    getByName("debug") {
      storeFile = semantifoldDebugKeystore
      storePassword = "android"
      keyAlias = "androiddebugkey"
      keyPassword = "android"
    }
  }

  buildTypes {
    getByName("debug") {
      signingConfig = signingConfigs.getByName("debug")
    }
  }

  buildFeatures {
    buildConfig = false
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  lint {
    abortOnError = true
    checkDependencies = true
    disable += "MissingApplicationIcon"
    disable += "OldTargetApi"
    disable += "GradleDependency"
    warningsAsErrors = true
  }
}

flutter {
  source = "../.."
}
`])
}

/**
 * Renders the permission-free Android manifest.
 * @param {import("../semantic/types.js").FlutterApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Android manifest XML.
 */
function renderAndroidManifest(configuration, spans) {
  return configured(`${projectRoot}/android/app/src/main/AndroidManifest.xml`, spans, [
    `<manifest
  xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:tools="http://schemas.android.com/tools">
  <permission tools:node="removeAll" />
  <uses-permission tools:node="removeAll" />
  <application
    android:allowBackup="false"
    android:dataExtractionRules="@xml/data_extraction_rules"
    android:fullBackupContent="@xml/backup_rules"
    android:label="`, field("displayName", xmlEscape(configuration.displayName)), `"
    android:name="\${applicationName}"
    android:supportsRtl="true">
    <activity
      android:name=".`, field("activityClassName", configuration.activityClassName), `"
      android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
      android:exported="true"
      android:hardwareAccelerated="true"
      android:launchMode="singleTop"
      android:taskAffinity=""
      android:theme="@style/LaunchTheme"
      android:windowSoftInputMode="adjustResize">
      <meta-data
        android:name="io.flutter.embedding.android.NormalTheme"
        android:resource="@style/NormalTheme" />
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    <meta-data android:name="flutterEmbedding" android:value="2" />
    <provider android:name="androidx.startup.InitializationProvider" tools:node="remove" />
  </application>
</manifest>
`
  ])
}

/**
 * Renders the Java Flutter activity launcher.
 * @param {import("../semantic/types.js").FlutterApplicationConfiguration} configuration - Normalized configuration.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @returns {string} Java source.
 */
function renderAndroidActivity(configuration, spans) {
  return configured(`${projectRoot}/android/app/src/main/java/${configuration.applicationId.replaceAll(".", "/")}/${configuration.activityClassName}.java`, spans, [
    "package ", field("applicationId", configuration.applicationId), `;

import io.flutter.embedding.android.FlutterActivity;

public final class `, field("activityClassName", configuration.activityClassName), ` extends FlutterActivity {
}
`
  ])
}

/**
 * Renders platform launch and host styles.
 * @param {boolean} night - Whether to render the night theme.
 * @returns {string} Android resource XML.
 */
function renderAndroidStyles(night) {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="LaunchTheme" parent="@android:style/Theme.${night ? "Black" : "Light"}.NoTitleBar">
    <item name="android:windowBackground">@drawable/launch_background</item>
  </style>
  <style name="NormalTheme" parent="@android:style/Theme.${night ? "Black" : "Light"}.NoTitleBar">
    <item name="android:windowBackground">?android:colorBackground</item>
  </style>
</resources>
`
}

/**
 * Renders a platform launch background.
 * @returns {string} Android resource XML.
 */
function renderLaunchBackground() {
  return `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="?android:colorBackground" />
</layer-list>
`
}

/**
 * Renders complete legacy backup exclusions.
 * @returns {string} Android resource XML.
 */
function renderBackupRules() {
  return `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="." />
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
  <exclude domain="device_root" path="." />
  <exclude domain="device_file" path="." />
  <exclude domain="device_database" path="." />
  <exclude domain="device_sharedpref" path="." />
</full-backup-content>
`
}

/**
 * Renders complete Android 12+ backup exclusions.
 * @returns {string} Android resource XML.
 */
function renderDataExtractionRules() {
  const exclusions = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"]
    .map(domain => `    <exclude domain="${domain}" path="." />`).join("\n")

  return `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${exclusions}
  </cloud-backup>
  <device-transfer>
${exclusions}
  </device-transfer>
</data-extraction-rules>
`
}

/**
 * Renders the ownership, toolchain, provenance, and platform-status manifest.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared application.
 * @param {import("../semantic/types.js").GeneratedSetArtifact[]} artifacts - Owned artifacts except this manifest.
 * @param {string} manifestPath - Manifest artifact path.
 * @param {ConfigurationSpan[]} spans - Configuration provenance spans.
 * @returns {string} Canonical manifest JSON.
 */
function renderProjectManifest(prepared, artifacts, manifestPath, spans) {
  const inputPaths = new Set(prepared.assets.map(({fullPath}) => fullPath))
  const semanticArtifacts = artifacts.filter(artifact => artifact.provenance.kind == "text")

  return stringifyCanonicalJson({
    configuration: prepared.configuration,
    generator: {name: "semantifold", version: generatorVersion},
    ownership: {
      excludedPathPatterns,
      ownedPaths: [...artifacts.map(({path}) => path), manifestPath],
      ownedRoot: projectRoot,
      sha256: artifacts.map(artifact => ({path: artifact.path, sha256: hashContent(artifact.content)}))
    },
    platforms: {
      android: {acceptance: "tensorbuzz-kvm", artifacts: "generated"},
      ios: {
        acceptance: "deferred",
        artifacts: "omitted",
        reason: "Owner direction defers macOS, Xcode, Apple SDK, signing, and iOS Simulator qualification."
      }
    },
    provenance: {
      configuration: Object.keys(prepared.configuration).sort().map(fieldName => ({
        field: fieldName,
        manifestPointer: `/configuration/${fieldName}`,
        outputs: configurationOutputs(spans, fieldName)
      })),
      inputs: prepared.assets.map(asset => ({
        contentKind: asset.contentKind,
        mediaType: asset.mediaType,
        path: asset.fullPath,
        sha256: asset.sha256
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
    schema: "SemantifoldFlutterProject",
    semanticProgram: semanticProgramManifest(prepared),
    target: "flutter",
    toolchain: {android: androidToolchain, flutter: flutterToolchain},
    version: 1
  })
}

/**
 * Describes the complete semantic program inside the application manifest.
 * @param {ReturnType<typeof preflightFlutterApplication>} prepared - Prepared project.
 * @returns {Record<string, unknown>} Semantic program manifest.
 */
function semanticProgramManifest(prepared) {
  const sourceContent = new Map(prepared.sources.map(source => [source.filename, source.content]))
  const order = new Map(prepared.program.modules.map((module, index) => [module.id, index]))
  const modules = prepared.program.modules.map(module => {
    const source = prepared.program.sources.find(candidate => candidate.filename == module.sourceFilename)
    const content = sourceContent.get(module.sourceFilename)

    if (!source || content === undefined) throw new TypeError(`Preflighted Flutter module '${module.id}' lost source ownership.`)

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
      generatedArtifact: prepared.modulePaths.get(entryId),
      generatedFunctionIdentity: `SemantifoldModule${moduleName(entryId)}.semantifoldEntry`,
      moduleId: entryId,
      widgetArtifact: `${projectRoot}/lib/main.dart`
    },
    modules,
    schema: "SemantifoldFlutterSemanticProgram",
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
 * Normalizes and validates the closed application configuration.
 * @param {unknown} candidate - Candidate configuration.
 * @returns {import("../semantic/types.js").FlutterApplicationConfiguration} Normalized configuration.
 */
function normalizeConfiguration(candidate) {
  if (candidate === undefined) candidate = {}
  if (!isPlainObject(candidate) || Object.keys(candidate).some(key => !configurationFields.has(key))) {
    invalidConfiguration("Flutter application configuration must be a closed plain object.")
  }
  const configuration = /** @type {import("../semantic/types.js").FlutterApplicationConfigurationInput} */ (candidate)
  const packageName = configuration.packageName ?? "semantifold_generated"
  const organization = configuration.organization ?? "dev.semantifold"
  const applicationId = configuration.applicationId ?? `${organization}.generated`
  const activityClassName = configuration.activityClassName ?? "MainActivity"
  const displayName = configuration.displayName ?? "Semantifold"
  const minimumSdk = configuration.minimumSdk ?? 23
  const targetSdk = configuration.targetSdk ?? 35
  const compileSdk = configuration.compileSdk ?? 35
  const buildToolsVersion = configuration.buildToolsVersion ?? "35.0.0"
  const versionCode = configuration.versionCode ?? 1
  const versionName = configuration.versionName ?? "1.0.0"

  if (typeof packageName != "string" || !/^[a-z][a-z0-9_]*$/u.test(packageName) || dartKeywords.has(packageName) ||
    forbiddenPackageNames.has(packageName)) invalidConfiguration("Dart package name must be a non-reserved lowercase underscore identifier.")
  if (typeof organization != "string" || !isReverseDns(organization, 2)) {
    invalidConfiguration("Organization must be a lowercase reverse-DNS identity with at least two segments.")
  }
  if (typeof applicationId != "string" || !isReverseDns(applicationId, 3) || !applicationId.startsWith(`${organization}.`)) {
    invalidConfiguration("Application ID must extend the exact organization as lowercase reverse DNS.")
  }
  if (typeof activityClassName != "string" || !/^[A-Z][A-Za-z0-9]*$/u.test(activityClassName) ||
    javaKeywords.has(activityClassName)) invalidConfiguration("Activity class name must be an ASCII upper-camel Java identifier.")
  if (androidRunnerBaseClassNames.has(activityClassName)) {
    invalidConfiguration("Activity class name must not collide with the imported Flutter launcher base class.")
  }
  if (typeof displayName != "string" || displayName.length == 0 || displayName.trim() != displayName ||
    [...displayName].length > 64 || !hasOnlyUnicodeScalars(displayName) || /[\p{Cc}\p{Zl}\p{Zp}\uFFFE\uFFFF]/u.test(displayName)) {
    invalidConfiguration("Display name must be a non-empty single-line Unicode scalar string of at most 64 characters.")
  }
  if (minimumSdk !== 23 || targetSdk !== 35 || compileSdk !== 35) {
    invalidConfiguration("SDK levels must reuse the qualified minimum 23, target 35, and compile 35 Android matrix.")
  }
  if (buildToolsVersion != "35.0.0") invalidConfiguration("Build Tools version must be exactly '35.0.0'.")
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
    invalidConfiguration("Version code must be a positive Android-safe integer.")
  }
  if (typeof versionName != "string" || !semanticVersionPattern.test(versionName) || versionName.includes("+")) {
    invalidConfiguration("Version name must be a canonical semantic version without build metadata.")
  }
  if (configuration.permissions !== undefined &&
    (!isDenseArray(configuration.permissions) || configuration.permissions.length != 0)) {
    invalidConfiguration("The baseline Flutter permission set must be empty.")
  }

  return {activityClassName, applicationId, buildToolsVersion, compileSdk, displayName, minimumSdk, organization,
    packageName, targetSdk, versionCode, versionName}
}

/**
 * Snapshots and validates exact caller assets.
 * @param {unknown} candidate - Candidate asset collection.
 * @returns {FlutterAsset[]} Normalized assets.
 */
function normalizeAssets(candidate) {
  if (candidate === undefined) return []
  if (!isDenseArray(candidate)) invalidAsset("Flutter assets must be a dense array.")
  /** @type {FlutterAsset[]} */
  const assets = []

  for (let index = 0; index < candidate.length; index += 1) {
    const item = candidate[index]

    if (!isPlainObject(item) || Object.keys(item).length != assetFields.size ||
      Object.keys(item).some(key => !assetFields.has(key))) invalidAsset(`Asset ${index} must use the closed input schema.`)
    const path = item.path
    const content = item.content
    const mediaType = item.mediaType
    const sha256 = item.sha256

    if (!isSafeArtifactPath(path) || !String(path).startsWith("assets/")) {
      invalidAsset(`Asset ${index} requires a safe portable path below 'assets'.`)
    }
    if (typeof content != "string" && !(content instanceof Uint8Array) || typeof content == "string" &&
      (content.length == 0 || !hasOnlyUnicodeScalars(content)) || content instanceof Uint8Array && content.byteLength == 0) {
      invalidAsset(`Asset '${path}' requires non-empty exact content.`)
    }
    if (typeof mediaType != "string" || !mediaTypePattern.test(mediaType) || /[\r\n]/u.test(mediaType)) {
      invalidAsset(`Asset '${path}' requires an explicit valid media type.`)
    }
    const snapshot = typeof content == "string" ? content : new Uint8Array(content)
    const actualHash = createHash("sha256").update(snapshot).digest("hex")

    if (typeof sha256 != "string" || !/^[0-9a-f]{64}$/u.test(sha256) || sha256 != actualHash) {
      invalidAsset(`Asset '${path}' SHA-256 does not match its exact content.`)
    }
    assets.push({content: snapshot, contentKind: typeof snapshot == "string" ? "text" : "binary",
      fullPath: `${projectRoot}/${path}`, mediaType, path, sha256})
  }
  assets.sort((left, right) => left.fullPath < right.fullPath ? -1 : left.fullPath > right.fullPath ? 1 : 0)
  const conflict = findPortableArtifactPathConflict(assets.map(({fullPath}) => fullPath))

  if (conflict) invalidAsset(`Asset path '${conflict.path}' has a ${conflict.kind} conflict.`)

  return assets
}

/**
 * Enumerates every generator-owned application path.
 * @param {import("../semantic/types.js").FlutterApplicationConfiguration} configuration - Normalized configuration.
 * @param {Map<string, string>} modulePaths - Semantic module paths.
 * @returns {string[]} Complete paths.
 */
function applicationPaths(configuration, modulePaths) {
  const packagePath = configuration.applicationId.replaceAll(".", "/")

  return [
    `${projectRoot}/.metadata`,
    `${projectRoot}/analysis_options.yaml`,
    `${projectRoot}/android/app/build.gradle.kts`,
    `${projectRoot}/android/app/src/main/AndroidManifest.xml`,
    `${projectRoot}/android/app/src/main/java/${packagePath}/${configuration.activityClassName}.java`,
    `${projectRoot}/android/app/src/main/res/drawable/launch_background.xml`,
    `${projectRoot}/android/app/src/main/res/values-night/styles.xml`,
    `${projectRoot}/android/app/src/main/res/values/styles.xml`,
    `${projectRoot}/android/app/src/main/res/xml/backup_rules.xml`,
    `${projectRoot}/android/app/src/main/res/xml/data_extraction_rules.xml`,
    `${projectRoot}/android/build.gradle.kts`,
    `${projectRoot}/android/gradle.properties`,
    `${projectRoot}/android/settings.gradle.kts`,
    `${projectRoot}/lib/main.dart`,
    ...modulePaths.values(),
    `${projectRoot}/lib/src/semantic/semantifold.dart`,
    `${projectRoot}/pubspec.lock`,
    `${projectRoot}/pubspec.yaml`,
    `${projectRoot}/test/semantic_logic_test.dart`,
    `${projectRoot}/test/widget_test.dart`,
    `${projectRoot}/semantifold-project.json`
  ]
}

/**
 * Converts one normalized asset to an owned artifact.
 * @param {FlutterAsset} asset - Normalized asset.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Generated asset.
 */
function assetArtifact(asset) {
  const reason = `Exact caller-provided Flutter asset (sha256:${asset.sha256}).`

  if (typeof asset.content == "string") return {...syntheticText(asset.fullPath, "resource", asset.content, reason), mediaType: asset.mediaType}
  const content = new Uint8Array(asset.content)

  return {
    content,
    contentKind: "binary",
    mediaType: asset.mediaType,
    ownership: "generated",
    path: asset.fullPath,
    provenance: {kind: "bytes", mapping: createByteMapping({
      byteLength: content.byteLength,
      path: asset.fullPath,
      ranges: [{generated: {end: content.byteLength, start: 0},
        origin: {kind: "synthetic", reason, relatedOrigins: []}, role: "asset"}]
    })},
    role: "resource"
  }
}

/**
 * Creates a synthetic text artifact.
 * @param {string} path - Artifact path.
 * @param {import("../semantic/types.js").GeneratedArtifactRole} role - Artifact role.
 * @param {string} content - Exact content.
 * @param {string} reason - Synthetic provenance reason.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Generated artifact.
 */
function syntheticText(path, role, content, reason) {
  return {content, contentKind: "text", mediaType: mediaTypeFor(path), ownership: "generated", path,
    provenance: {kind: "synthetic", reason, relatedOrigins: []}, role}
}

/**
 * Creates text whose configuration spans are recorded separately.
 * @param {string} path - Artifact path.
 * @param {import("../semantic/types.js").GeneratedArtifactRole} role - Artifact role.
 * @param {string} content - Exact content.
 * @param {string} reason - Synthetic provenance reason.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Generated artifact.
 */
function configuredText(path, role, content, reason) {
  return syntheticText(path, role, content, reason)
}

/**
 * Selects an exact media type from an owned path.
 * @param {string} path - Artifact path.
 * @returns {string} Media type.
 */
function mediaTypeFor(path) {
  if (path.endsWith(".dart")) return "text/x-dart"
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".yaml") || path.endsWith(".lock")) return "application/yaml"
  if (path.endsWith(".xml")) return "application/xml"
  if (path.endsWith(".java")) return "text/x-java-source"
  if (path.endsWith(".kts")) return "text/x-kotlin"

  return "text/plain"
}

/**
 * Marks one rendered value as configuration-derived.
 * @param {string} fieldName - Configuration field.
 * @param {string} value - Rendered value.
 * @returns {{field: string, value: string}} Marked value.
 */
function field(fieldName, value) {
  return {field: fieldName, value}
}

/**
 * Joins configured parts while recording exact output spans.
 * @param {string} path - Artifact path.
 * @param {ConfigurationSpan[]} spans - Configuration provenance sink.
 * @param {(string | {field: string, value: string})[]} parts - Literal and configured parts.
 * @returns {string} Rendered content.
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
 * Groups exact generated ranges for one configuration field.
 * @param {ConfigurationSpan[]} spans - Recorded spans.
 * @param {string} fieldName - Configuration field.
 * @returns {{path: string, ranges: {end: number, start: number}[]}[]} Grouped output ranges.
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
 * Checks whether provenance refers to one source file.
 * @param {import("../semantic/types.js").SemanticOrigin} origin - Semantic origin.
 * @param {string} filename - Source filename.
 * @returns {boolean} Whether the origin references the source.
 */
function originReferencesFilename(origin, filename) {
  if (origin.kind == "source") return origin.location.filename == filename
  if (origin.kind == "derived") return origin.origins.some(({location}) => location.filename == filename)

  return origin.relatedOrigins.some(({location}) => location.filename == filename)
}

/**
 * Hashes exact artifact content.
 * @param {string | Uint8Array} content - Artifact content.
 * @returns {string} Lowercase SHA-256.
 */
function hashContent(content) {
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Serializes a recursively sorted JSON value.
 * @param {unknown} value - JSON-compatible value.
 * @returns {string} Canonical indented JSON.
 */
function stringifyCanonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

/**
 * Recursively sorts object keys without reordering arrays.
 * @param {unknown} value - JSON-compatible value.
 * @returns {unknown} Sorted value.
 */
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainObject(value)) return value

  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]))
}

/**
 * Validates a lowercase reverse-DNS identity.
 * @param {string} value - Candidate identity.
 * @param {number} segments - Required minimum segment count.
 * @returns {boolean} Whether the identity is valid.
 */
function isReverseDns(value, segments) {
  const parts = value.split(".")

  return parts.length >= segments && parts.every(part => /^[a-z][a-z0-9_]*$/u.test(part) && !javaKeywords.has(part))
}

/**
 * Derives one stable Dart class suffix.
 * @param {string} id - Semantic module identity.
 * @returns {string} Dart class suffix.
 */
function moduleName(id) {
  return id.split(/[._-]+/u).map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join("")
}

/**
 * Derives one stable semantic part filename.
 * @param {string} id - Semantic module identity.
 * @returns {string} Dart filename.
 */
function moduleFileName(id) {
  return id.replaceAll(/[.-]/gu, "_")
}

/**
 * Allocates a collision-free private output sink binding.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {string} Dart binding name.
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
 * Collects every block-owned binding name.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {Set<string>} bindings - Mutable name set.
 * @returns {void}
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
 * Wraps one module in an explicit semantic project.
 * @param {import("../semantic/types.js").SemanticModule | undefined} candidate - Candidate module.
 * @returns {import("../semantic/types.js").SemanticProgram} Normalized project.
 */
function normalizeSingleModule(candidate) {
  if (!isPlainObject(candidate)) unsupportedCapability("flutter", "missing or invalid module", undefined)
  const module = structuredClone(candidate)
  const sources = module.provenance?.sources

  if (!Array.isArray(sources) || sources.length != 1 || sources[0].content === null ||
    sources[0].filename != module.location?.filename || typeof sources[0].language != "string") {
    unsupportedCapability("flutter", "single-module source ownership", module.location)
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
 * Converts one module declaration to an explicit application export.
 * @param {{id?: string, location: import("../semantic/types.js").SourceLocation, name: string}} declaration - Declaration.
 * @param {import("../semantic/types.js").SemanticDeclarationKind} symbolKind - Declaration kind.
 * @returns {import("../semantic/types.js").SemanticExport} Semantic export.
 */
function applicationExport(declaration, symbolKind) {
  return {declarationId: /** @type {string} */ (declaration.id), exportedName: declaration.name,
    kind: "Export", location: declaration.location, symbolKind}
}

/**
 * Re-keys one standalone module for application-project ownership.
 * @param {import("../semantic/types.js").SemanticModule} module - Standalone module.
 * @param {string} moduleId - Stable application module identity.
 * @returns {void}
 */
function rekeyModuleDeclarations(module, moduleId) {
  const declarations = [...module.records ?? [], ...module.classes ?? [], ...module.errors ?? [], ...module.functions]
  const replacements = new Map(declarations.filter(declaration => typeof declaration.id == "string")
    .map(declaration => [declaration.id, `${moduleId}#${declaration.id}`]))

  for (const declaration of declarations) if (typeof declaration.id == "string") declaration.id = replacements.get(declaration.id)
  const seen = new Set()
  const identityFields = new Set(["classId", "declarationId", "field", "method", "parameterId"])
  /**
   * Rewrites semantic declaration identities recursively.
   * @param {unknown} value - Candidate semantic value.
   * @returns {void}
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
 * Escapes an XML attribute value.
 * @param {string} value - Raw value.
 * @returns {string} Escaped value.
 */
function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

/**
 * Escapes a single-quoted Dart literal body.
 * @param {string} value - Raw value.
 * @returns {string} Escaped value.
 */
function dartEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("$", "\\$")
}

/**
 * Checks for a plain string-keyed object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is plain.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value == "object" && !Array.isArray(value) && Object.getPrototypeOf(value) == Object.prototype
}

/**
 * Throws a stable invalid-input diagnostic.
 * @param {string} message - Diagnostic detail.
 * @returns {never} Never returns.
 */
function invalidInput(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_INPUT", language: "flutter", message})
}

/**
 * Throws a stable invalid-configuration diagnostic.
 * @param {string} message - Diagnostic detail.
 * @returns {never} Never returns.
 */
function invalidConfiguration(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_CONFIGURATION", language: "flutter", message})
}

/**
 * Throws a stable invalid-asset diagnostic.
 * @param {string} message - Diagnostic detail.
 * @returns {never} Never returns.
 */
function invalidAsset(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_ASSET", language: "flutter", message})
}

/**
 * Throws a stable invalid-path diagnostic.
 * @param {string} message - Diagnostic detail.
 * @returns {never} Never returns.
 */
function invalidPath(message) {
  throw new SemantifoldDiagnostic({code: "INVALID_APPLICATION_PATH", language: "flutter", message})
}
