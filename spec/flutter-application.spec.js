// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {describe, expect, it} from "@velocious/testing"
import {
  generateArtifactSet,
  generateProgramArtifactSet,
  languageCapabilities,
  mappingFromSourceMap,
  originalPositionFor,
  parse,
  parseProgram,
  SemantifoldDiagnostic
} from "../index.js"
import {preflightFlutterApplication} from "../src/backends/flutter.js"

const dartSource = `String decorate(String value, String suffix) {
  print(value);
  return value + suffix;
}

void main() {
  print(decorate(decorate("hé😀", "!"), "?"));
}
`

const longZeroArgumentFunction = "formatterCanonicalZeroArgumentFunction"
const longZeroArgumentSource = `String ${longZeroArgumentFunction}() {
  return "value";
}

String passthrough(String value) {
  return value;
}

void main() {
  print(passthrough(${longZeroArgumentFunction}()));
}
`

const rubySources = () => [{
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

const sha256 = content => createHash("sha256").update(content).digest("hex")

describe("Flutter application artifact target", () => {
  it("registers an application-only Flutter target independently from Dart", () => {
    const descriptor = languageCapabilities.find(({id}) => id == "flutter")
    const dart = languageCapabilities.find(({id}) => id == "dart")
    const module = parse({filename: "program.dart", language: "dart", source: dartSource})
    const prepared = preflightFlutterApplication({module})

    expect(descriptor?.roles).toEqual({
      applicationBackend: true,
      binaryBackend: false,
      frontend: false,
      interoperability: false,
      provider: false,
      textBackend: false
    })
    expect(descriptor?.acceptance).toEqual({
      stages: ["generate", "restore", "compile", "validate", "instantiate", "execute"],
      toolchains: ["flutter", "android"]
    })
    expect(dart?.roles.frontend).toBeTrue()
    expect(dart?.roles.textBackend).toBeTrue()
    expect(dart?.roles.applicationBackend).toBeFalse()
    expect(prepared.configuration).toEqual({
      activityClassName: "MainActivity",
      applicationId: "dev.semantifold.generated",
      buildToolsVersion: "35.0.0",
      compileSdk: 35,
      displayName: "Semantifold",
      minimumSdk: 23,
      organization: "dev.semantifold",
      packageName: "semantifold_generated",
      targetSdk: 35,
      versionCode: 1,
      versionName: "1.0.0"
    })
  })

  it("generates one byte-identical Android-qualified Flutter project from a Ruby multi-module program", () => {
    const input = {
      language: /** @type {const} */ ("flutter"),
      program: parseProgram({entryModule: "main", sources: rubySources()}),
      role: /** @type {const} */ ("application")
    }
    const first = generateProgramArtifactSet(input)
    const second = generateProgramArtifactSet(input)
    const root = "generated/flutter-app"

    expect(first).toEqual(second)
    expect(first.target).toEqual("flutter")
    expect(first.entry).toEqual(`${root}/lib/main.dart`)
    expect(first.artifacts.every(({path}) => path.startsWith(`${root}/`))).toBeTrue()
    expect(first.artifacts.map(({path}) => path)).toEqual([
      `${root}/.metadata`,
      `${root}/analysis_options.yaml`,
      `${root}/android/app/build.gradle.kts`,
      `${root}/android/app/src/main/AndroidManifest.xml`,
      `${root}/android/app/src/main/java/dev/semantifold/generated/MainActivity.java`,
      `${root}/android/app/src/main/res/drawable/launch_background.xml`,
      `${root}/android/app/src/main/res/values-night/styles.xml`,
      `${root}/android/app/src/main/res/values/styles.xml`,
      `${root}/android/app/src/main/res/xml/backup_rules.xml`,
      `${root}/android/app/src/main/res/xml/data_extraction_rules.xml`,
      `${root}/android/build.gradle.kts`,
      `${root}/android/gradle.properties`,
      `${root}/android/settings.gradle.kts`,
      `${root}/lib/main.dart`,
      `${root}/lib/src/semantic/main.dart`,
      `${root}/lib/src/semantic/math_tools.dart`,
      `${root}/lib/src/semantic/semantifold.dart`,
      `${root}/pubspec.lock`,
      `${root}/pubspec.yaml`,
      `${root}/test/semantic_logic_test.dart`,
      `${root}/test/widget_test.dart`,
      `${root}/semantifold-project.json`
    ])
    expect(first.metadata).toEqual({
      applicationManifest: `${root}/semantifold-project.json`,
      platformQualification: {android: "tensorbuzz-kvm", ios: "deferred-owner-direction"}
    })
  })

  it("keeps semantic Dart mapped while the Material widget and platform runner remain synthetic", () => {
    const program = parseProgram({entryModule: "main", sources: rubySources()})
    const set = generateProgramArtifactSet({language: "flutter", program, role: "application"})
    const byPath = new Map(set.artifacts.map(artifact => [artifact.path, artifact]))
    const root = "generated/flutter-app"
    const library = byPath.get(`${root}/lib/src/semantic/math_tools.dart`)
    const entryLogic = String(byPath.get(`${root}/lib/src/semantic/main.dart`)?.content)
    const widget = String(byPath.get(`${root}/lib/main.dart`)?.content)
    const runner = byPath.get(`${root}/android/app/src/main/java/dev/semantifold/generated/MainActivity.java`)

    expect(String(library?.content)).toContain("abstract final class SemantifoldModuleMathTools")
    expect(String(library?.content)).toContain("semantifoldOutput.write(value)")
    expect(entryLogic).toContain("static List<String> semantifoldEntry()")
    expect(entryLogic).toContain("SemantifoldModuleMathTools.decorate")
    expect(entryLogic).not.toContain("print(")
    expect(widget).toContain("class SemantifoldApplication extends StatelessWidget")
    expect(widget).toContain("const Key('semantifold-output')")
    expect(widget).toContain("label: 'semantifold-output'")
    expect(widget).toContain("lines.join('\\n')")
    assert.ok(library && library.provenance.kind == "text")
    expect(library.provenance.mapping.sources.map(({filename}) => filename)).toContain("math_tools.rb")
    expect(library.provenance.mapping.spans.some(({mappingKind}) => mappingKind == "exact")).toBeTrue()
    expect(byPath.get(`${root}/lib/main.dart`)?.provenance.kind).toEqual("synthetic")
    expect(runner?.provenance.kind).toEqual("synthetic")
  })

  it("keeps zero-argument sink declarations and calls formatter-canonical", () => {
    const module = parse({filename: "wide.dart", language: "dart", source: longZeroArgumentSource})
    const set = generateArtifactSet({language: "flutter", module, role: "application"})
    const semantic = String(set.artifacts.find(({content, path}) => path.includes("/lib/src/semantic/") &&
      String(content).includes(longZeroArgumentFunction))?.content)

    expect(semantic).toContain(`${longZeroArgumentFunction}(\n    _SemantifoldOutputSink semantifoldOutput,\n  ) {`)
    expect(semantic).toContain(`${longZeroArgumentFunction}(\n          semantifoldOutput,\n        )`)
    expect(semantic).toContain(`\n  }\n\n  static String passthrough(`)
  })

  it("keeps ordinary Dart print source-mapped while Flutter output plumbing stays synthetic", () => {
    const source = `String identity(String value) {
  return value;
}

void main() {
  print(identity("mapped"));
}
`
    const module = parse({filename: "mapped.dart", language: "dart", source})
    const dartSet = generateArtifactSet({language: "dart", module})
    const dartEntry = dartSet.artifacts.find(({path}) => path == "bin/program.dart")

    assert.ok(dartEntry && dartEntry.provenance.kind == "text" && typeof dartEntry.content == "string")
    const dartPrintOffset = dartEntry.content.indexOf("print(identity(\"mapped\"))")
    const richPrint = originalPositionFor(dartEntry.provenance.mapping, {offset: dartPrintOffset})
    const projectedPrint = originalPositionFor(mappingFromSourceMap(dartEntry.provenance.sourceMap, {
      content: dartEntry.content,
      filename: dartEntry.path,
      language: "dart"
    }), {offset: dartPrintOffset})

    expect(richPrint.mappingKind).not.toEqual("synthetic")
    expect(richPrint.role).toEqual("callee")
    expect(richPrint.location?.start.offset).toEqual(source.indexOf("print"))
    expect(projectedPrint.location?.start.offset).toEqual(source.indexOf("print"))

    const flutterSet = generateArtifactSet({language: "flutter", module, role: "application"})
    const flutterEntry = flutterSet.artifacts.find(({content, path}) => path.includes("/lib/src/semantic/") &&
      String(content).includes("identity"))

    assert.ok(flutterEntry && flutterEntry.provenance.kind == "text" && typeof flutterEntry.content == "string")
    const sinkOffset = flutterEntry.content.indexOf("semantifoldOutput.write")
    const sink = originalPositionFor(flutterEntry.provenance.mapping, {offset: sinkOffset})
    const projectedSink = originalPositionFor(mappingFromSourceMap(flutterEntry.provenance.sourceMap, {
      content: flutterEntry.content,
      filename: flutterEntry.path,
      language: "dart"
    }), {offset: sinkOffset})

    expect(sink.mappingKind).toEqual("synthetic")
    expect(projectedSink.location).toEqual(undefined)
  })

  it("emits a pub-plugin-free Flutter package and dependency-closed Android contract", () => {
    const module = parse({filename: "program.dart", language: "dart", source: dartSource})
    const set = generateArtifactSet({language: "flutter", module, role: "application"})
    const content = Object.fromEntries(set.artifacts.map(artifact => [artifact.path, String(artifact.content)]))
    const root = "generated/flutter-app"
    const pubspec = content[`${root}/pubspec.yaml`]
    const settings = content[`${root}/android/settings.gradle.kts`]
    const build = content[`${root}/android/app/build.gradle.kts`]
    const properties = content[`${root}/android/gradle.properties`]
    const manifest = content[`${root}/android/app/src/main/AndroidManifest.xml`]
    const lock = content[`${root}/pubspec.lock`]
    const lockedPackageNames = [...lock.matchAll(/^ {2}([a-z][a-z0-9_]*):$/gmu)].map(([, name]) => name)

    expect(pubspec).toContain("sdk: 3.13.3")
    expect(pubspec).toContain("flutter: 3.47.4")
    expect(pubspec).toContain("flutter:\n    sdk: flutter")
    expect(pubspec).toContain("flutter_test:\n    sdk: flutter")
    expect(pubspec).not.toMatch(/cupertino_icons|flutter_lints|integration_test|hosted:|git:|path:/u)
    expect(lockedPackageNames).toContain("async")
    expect(lockedPackageNames).toContain("collection")
    for (const packageName of lockedPackageNames) {
      assert.throws(
        () => generateArtifactSet({configuration: {packageName}, language: "flutter", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.code == "INVALID_APPLICATION_CONFIGURATION",
        packageName
      )
    }
    expect(settings).toContain('id("com.android.application") version "8.11.1" apply false')
    expect(settings).toContain('id("dev.flutter.flutter-plugin-loader") version "1.0.0"')
    expect(settings).toContain('id("org.jetbrains.kotlin.android") version "2.2.20" apply false')
    expect(build).toContain('id("org.jetbrains.kotlin.android")')
    expect(properties).toContain("kotlin.stdlib.default.dependency=false")
    expect(build).toContain("compileSdk = 35")
    expect(build).toContain('ndkVersion = "27.0.12077973"')
    expect(build).toContain("minSdk = 23")
    expect(build).toContain("targetSdk = 35")
    expect(build).toContain('buildToolsVersion = "35.0.0"')
    expect(build).toContain("SEMANTIFOLD_FLUTTER_ACCEPTANCE_ROOT")
    expect(build).toContain('exclude(group = "androidx.profileinstaller", module = "profileinstaller")')
    expect(build).not.toMatch(/dependencies\s*\{|implementation\s*\(/u)
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:exported="true"')
    expect(manifest).toContain('android:name="${applicationName}"')
    expect(manifest.match(/tools:node="removeAll"/gu)?.length).toEqual(2)
    expect(manifest).toContain('<provider android:name="androidx.startup.InitializationProvider" tools:node="remove" />')
    expect(manifest).not.toMatch(/<receiver|<service|<queries/u)
    expect(set.artifacts.map(({path}) => path)).not.toContain(`${root}/ios`)
  })

  it("records complete ownership, hashes, source identities, configuration causality, and honest platform status", () => {
    const sources = rubySources()
    const set = generateProgramArtifactSet({
      language: "flutter",
      program: parseProgram({entryModule: "main", sources}),
      role: "application"
    })
    const manifestArtifact = set.artifacts.find(({path}) => path.endsWith("semantifold-project.json"))

    assert.ok(manifestArtifact && typeof manifestArtifact.content == "string")
    const manifest = JSON.parse(manifestArtifact.content)

    expect(manifest.schema).toEqual("SemantifoldFlutterProject")
    expect(manifest.target).toEqual("flutter")
    expect(manifest.ownership.ownedRoot).toEqual("generated/flutter-app")
    expect(manifest.ownership.ownedPaths).toEqual(set.artifacts.map(({path}) => path))
    expect(manifest.platforms).toEqual({
      android: {acceptance: "tensorbuzz-kvm", artifacts: "generated"},
      ios: {
        acceptance: "deferred",
        artifacts: "omitted",
        reason: "Owner direction defers macOS, Xcode, Apple SDK, signing, and iOS Simulator qualification."
      }
    })
    expect(manifest.toolchain.flutter).toEqual({
      archive: "flutter_linux_3.47.4-stable.tar.xz",
      archiveSha256: "5b45f0ceda99b9bebdc873e7e69f6450aeb4c30f454b505e2e62fc9255a907d3",
      dart: "3.13.3",
      revision: "9584c6713b324636289d067944a46fd6b49df14b",
      version: "3.47.4"
    })
    expect(manifest.provenance.semanticSources).toEqual(sources.map(item => ({
      artifacts: [`generated/flutter-app/lib/src/semantic/${item.id}.dart`],
      filename: item.filename,
      language: item.language,
      sha256: sha256(item.source)
    })))
    expect(manifest.semanticProgram.entry.moduleId).toEqual("main")
    expect(manifest.provenance.syntheticScaffolding).toContain("generated/flutter-app/lib/main.dart")
    const applicationIdentity = manifest.provenance.configuration.find(({field}) => field == "applicationId")

    expect(applicationIdentity.manifestPointer).toEqual("/configuration/applicationId")
    expect(applicationIdentity.outputs.length).toBeGreaterThan(0)
  })

  it("accepts only hashed safe Flutter assets and snapshots caller bytes", () => {
    const module = parse({filename: "program.dart", language: "dart", source: dartSource})
    const bytes = new Uint8Array([0, 1, 2, 255])
    const set = generateArtifactSet({
      assets: [
        {content: "fixture", mediaType: "text/plain", path: "assets/fixtures/value.txt", sha256: sha256("fixture")},
        {content: bytes, mediaType: "image/png", path: "assets/images/logo.png", sha256: sha256(bytes)}
      ],
      language: "flutter",
      module,
      role: "application"
    })

    bytes[0] = 9
    expect(set.artifacts.map(({path}) => path)).toContain("generated/flutter-app/assets/fixtures/value.txt")
    const resource = set.artifacts.find(({path}) => path.endsWith("assets/images/logo.png"))

    assert.ok(resource && resource.content instanceof Uint8Array)
    expect([...resource.content]).toEqual([0, 1, 2, 255])
    const pubspec = String(set.artifacts.find(({path}) => path.endsWith("pubspec.yaml"))?.content)

    expect(pubspec).toContain("    - assets/fixtures/value.txt\n    - assets/images/logo.png\n")
  })

  it("rejects unsafe configuration and unsupported public controls before returning output", () => {
    const module = parse({filename: "program.dart", language: "dart", source: dartSource})
    const invalid = [
      {configuration: {packageName: "Bad-Name"}},
      {configuration: {packageName: "flutter"}},
      {configuration: {packageName: "async"}},
      {configuration: {packageName: "collection"}},
      {configuration: {organization: "Bad.Org"}},
      {configuration: {applicationId: "dev.other.application"}},
      {configuration: {activityClassName: "main.activity"}},
      {configuration: {activityClassName: "FlutterActivity"}},
      {configuration: {displayName: "two\u2028lines"}},
      {configuration: {compileSdk: 36}},
      {configuration: {minimumSdk: 24}},
      {configuration: {targetSdk: 36}},
      {configuration: {versionCode: 0}},
      {configuration: {versionName: "01.0.0"}},
      {configuration: {permissions: ["android.permission.INTERNET"]}},
      {configuration: {iosDeploymentTarget: "18.0"}},
      {outputDirectory: "/tmp/app"},
      {overwrite: true},
      {sdkPath: "/opt/flutter"},
      {plugins: []},
      {platformChannels: []},
      {resources: []}
    ]

    for (const candidate of invalid) {
      assert.throws(
        () => generateArtifactSet({...candidate, language: "flutter", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.language == "flutter" &&
          ["INVALID_APPLICATION_CONFIGURATION", "INVALID_APPLICATION_INPUT"].includes(error.code),
        JSON.stringify(candidate)
      )
    }
  })

  it("rejects asset traversal, Unicode/case/prefix collisions, checksums, and generated paths transactionally", () => {
    const module = parse({filename: "program.dart", language: "dart", source: dartSource})
    const item = {content: "x", mediaType: "text/plain", path: "assets/value.txt", sha256: sha256("x")}
    const invalid = [
      [{...item, path: "../assets/value.txt"}],
      [{...item, path: "/assets/value.txt"}],
      [{...item, path: "value.txt"}],
      [{...item, path: "assets/valué.txt"}],
      [{...item, sha256: "0".repeat(64)}],
      [item, {...item}],
      [{...item, path: "assets/Value.txt"}, {...item, path: "assets/value.txt"}],
      [{...item, path: "assets/fixtures"}, {...item, path: "assets/fixtures/value.txt"}],
      [{...item, path: "lib/main.dart"}]
    ]

    for (const assets of invalid) {
      assert.throws(
        () => generateArtifactSet({assets, language: "flutter", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.language == "flutter" &&
          ["INVALID_APPLICATION_ASSET", "INVALID_APPLICATION_PATH"].includes(error.code)
      )
    }
  })

  it("reports unsupported Dart semantics as located Flutter diagnostics without partial artifacts", () => {
    const module = parse({
      filename: "unsupported.rb",
      language: "ruby",
      source: `# @param left [Array[Integer]]
# @param right [Array[Integer]]
# @return [Array[Integer]]
def choose(left, right)
  return left
end

# @type [Array[Integer]]
# @semantifold-immutable
values = [1, 2]
puts values[0]
`
    })

    assert.throws(
      () => generateArtifactSet({language: "flutter", module, role: "application"}),
      error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "flutter" && error.location?.filename == "unsupported.rb"
    )
  })
})
