// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {describe, expect, it} from "@velocious/testing"
import {
  generateArtifactSet,
  generateProgramArtifactSet,
  languageCapabilities,
  parse,
  parseProgram,
  SemantifoldDiagnostic
} from "../index.js"
import {preflightAndroidApplication} from "../src/backends/android.js"

const source = `fun decorate(value: String, suffix: String): String {
  println(value)
  return value + suffix
}

fun main() {
  println(decorate(decorate("hé😀", "!"), "?"))
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

describe("Android application artifact target", () => {
  it("registers the Android application-only target and normalizes deterministic defaults", () => {
    const descriptor = languageCapabilities.find(({id}) => id == "android")
    const module = parse({filename: "program.kt", language: "kotlin", source})
    const prepared = preflightAndroidApplication({module})

    expect(descriptor?.roles).toEqual({
      applicationBackend: true,
      binaryBackend: false,
      frontend: false,
      interoperability: false,
      provider: false,
      textBackend: false
    })
    expect(descriptor?.acceptance).toEqual({
      stages: ["generate", "compile", "validate", "instantiate", "execute"],
      toolchains: ["android"]
    })
    expect(descriptor?.features.generalFunctionsAndCalls).toBeFalse()
    expect(prepared.configuration).toEqual({
      activityClassName: "MainActivity",
      applicationId: "dev.semantifold.generated",
      buildToolsVersion: "35.0.0",
      compileSdk: 35,
      displayName: "Semantifold",
      minimumSdk: 23,
      namespace: "dev.semantifold.generated",
      orientation: "unspecified",
      packageName: "dev.semantifold.generated",
      productName: "Semantifold",
      targetSdk: 35,
      theme: "system",
      versionCode: 1,
      versionName: "1.0.0"
    })
  })

  it("generates one fixed-root Android project byte-identically from a multi-module program", () => {
    const input = {
      language: /** @type {const} */ ("android"),
      program: parseProgram({entryModule: "main", sources: rubySources()}),
      role: /** @type {const} */ ("application")
    }
    const first = generateProgramArtifactSet(input)
    const second = generateProgramArtifactSet(input)
    const root = "generated/android-app"

    expect(first).toEqual(second)
    expect(first.target).toEqual("android")
    expect(first.entry).toEqual(`${root}/app/src/main/kotlin/dev/semantifold/generated/MainActivity.kt`)
    expect(first.artifacts.every(({path}) => path.startsWith(`${root}/`))).toBeTrue()
    expect(first.artifacts.map(({path}) => path)).toEqual([
      `${root}/app/build.gradle.kts`,
      `${root}/app/src/androidTest/AndroidManifest.xml`,
      `${root}/app/src/androidTest/kotlin/dev/semantifold/generated/SemantifoldUiInstrumentation.kt`,
      `${root}/app/src/main/AndroidManifest.xml`,
      `${root}/app/src/main/kotlin/dev/semantifold/generated/MainActivity.kt`,
      `${root}/app/src/main/kotlin/dev/semantifold/generated/semantic/Main.kt`,
      `${root}/app/src/main/kotlin/dev/semantifold/generated/semantic/MathTools.kt`,
      `${root}/app/src/main/kotlin/dev/semantifold/generated/semantic/SemantifoldRuntime.kt`,
      `${root}/app/src/main/res/layout/activity_main.xml`,
      `${root}/app/src/main/res/values/strings.xml`,
      `${root}/app/src/main/res/values/themes.xml`,
      `${root}/app/src/main/res/xml/data_extraction_rules.xml`,
      `${root}/app/src/test/kotlin/dev/semantifold/generated/SemantifoldEntryTest.kt`,
      `${root}/build.gradle.kts`,
      `${root}/gradle.properties`,
      `${root}/settings.gradle.kts`,
      `${root}/semantifold-project.json`
    ])
    expect(first.metadata).toEqual({
      applicationManifest: `${root}/semantifold-project.json`,
      platformQualification: "tensorbuzz-kvm"
    })
  })

  it("reuses semantic Kotlin lowering with an application-owned resettable output sink and source mappings", () => {
    const program = parseProgram({entryModule: "main", sources: rubySources()})
    const set = generateProgramArtifactSet({language: "android", program, role: "application"})
    const byPath = new Map(set.artifacts.map(artifact => [artifact.path, artifact]))
    const root = "generated/android-app/app/src/main/kotlin/dev/semantifold/generated"
    const runtime = String(byPath.get(`${root}/semantic/SemantifoldRuntime.kt`)?.content)
    const library = byPath.get(`${root}/semantic/MathTools.kt`)
    const entry = String(byPath.get(`${root}/semantic/Main.kt`)?.content)
    const activity = String(byPath.get(`${root}/MainActivity.kt`)?.content)

    expect(runtime).toContain("internal class SemantifoldOutputSink")
    expect(runtime).toContain("fun reset()")
    expect(String(library?.content)).toContain("internal object SemantifoldModuleMathTools")
    expect(String(library?.content)).toContain("semantifoldOutput.write(value)")
    expect(entry).toContain("fun semantifoldEntry(): java.util.ArrayList<String>")
    expect(entry).toContain("SemantifoldModuleMathTools.decorate")
    expect(entry).toContain("semantifoldOutput.reset()")
    expect(entry).not.toContain("println(")
    expect(activity).toContain("val lines = SemantifoldModuleMain.semantifoldEntry()")
    expect(activity).toContain("findViewById<TextView>(R.id.semantifold_output)")
    assert.ok(library && library.provenance.kind == "text")
    expect(library.provenance.mapping.sources.map(({filename}) => filename)).toContain("math_tools.rb")
    expect(library.provenance.mapping.spans.some(({mappingKind}) => mappingKind == "exact")).toBeTrue()

    const collisionModule = parse({
      filename: "collision.kt",
      language: "kotlin",
      source: `fun decorate(semantifoldOutput: String, suffix: String): String {
  println(semantifoldOutput)
  return semantifoldOutput + suffix
}
fun main() {
  println(decorate("safe", "!"))
}
`
    })
    const collisionSet = generateArtifactSet({language: "android", module: collisionModule, role: "application"})
    const collisionSource = String(collisionSet.artifacts.find(({path}) => path.endsWith("semantic/Main.kt"))?.content)

    expect(collisionSource).toContain("semantifoldOutput_: SemantifoldOutputSink")
    expect(collisionSource).toContain("SemantifoldModuleMain.decorate(\"safe\", \"!\", semantifoldOutput_)")
  })

  it("emits a closed dependency-minimal manifest, build, native view, and instrumentation contract", () => {
    const module = parse({filename: "program.kt", language: "kotlin", source})
    const set = generateArtifactSet({language: "android", module, role: "application"})
    const content = Object.fromEntries(set.artifacts.map(artifact => [artifact.path, String(artifact.content)]))
    const root = "generated/android-app"
    const build = content[`${root}/app/build.gradle.kts`]
    const manifest = content[`${root}/app/src/main/AndroidManifest.xml`]
    const dataExtractionRules = content[`${root}/app/src/main/res/xml/data_extraction_rules.xml`]
    const activity = content[`${root}/app/src/main/kotlin/dev/semantifold/generated/MainActivity.kt`]
    const layout = content[`${root}/app/src/main/res/layout/activity_main.xml`]
    const unitTest = content[`${root}/app/src/test/kotlin/dev/semantifold/generated/SemantifoldEntryTest.kt`]
    const instrumentation = content[`${root}/app/src/androidTest/kotlin/dev/semantifold/generated/SemantifoldUiInstrumentation.kt`]

    expect(content[`${root}/settings.gradle.kts`]).toContain("RepositoriesMode.FAIL_ON_PROJECT_REPOS")
    expect(content[`${root}/build.gradle.kts`]).toContain('id("com.android.application") version "8.11.1" apply false')
    expect(content[`${root}/build.gradle.kts`]).toContain('id("org.jetbrains.kotlin.android") version "2.2.10" apply false')
    expect(build).toContain('buildToolsVersion = "35.0.0"')
    expect(build).toContain('testApplicationId = "dev.semantifold.generated.test"')
    expect(build).toContain('testImplementation("junit:junit:4.13.2") {\n    isTransitive = false\n  }')
    expect(build).toContain('testRuntimeOnly("org.hamcrest:hamcrest-core:1.3") {\n    isTransitive = false\n  }')
    expect(build).toContain("libraries.from(files(semantifoldKotlinStdlib))")
    expect(build).toContain('storeFile = semantifoldDebugKeystore')
    expect(build).toContain('SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT')
    expect(build).not.toMatch(/(?:implementation|runtimeOnly)\s*\(/u)
    expect(build).toContain("abortOnError = true")
    expect(build).toContain("warningsAsErrors = true")
    expect([...build.matchAll(/disable \+= "([^"]+)"/gu)].map(([, issue]) => issue))
      .toEqual(["MissingApplicationIcon", "OldTargetApi", "GradleDependency"])
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')
    expect(dataExtractionRules).toEqual(`<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
  </device-transfer>
</data-extraction-rules>
`)
    expect(manifest).toContain('android:exported="true"')
    expect(manifest.replace('xmlns:android="http://schemas.android.com/apk/res/android"', ""))
      .not.toMatch(/uses-permission|<service|<receiver|<provider|http:|https:/u)
    expect(layout).toContain('android:id="@+id/semantifold_output"')
    expect(layout).toContain('android:importantForAccessibility="yes"')
    expect(layout).not.toContain("contentDescription")
    expect(activity).toContain('@SuppressLint("SetTextI18n")')
    expect(unitTest).toContain("import org.junit.Test")
    expect(unitTest).not.toMatch(/org\.junit\.Assert|assertEquals/u)
    expect(unitTest).toContain("if (!firstOutput.equals(secondOutput))")
    expect(unitTest).toContain('throw AssertionError("Semantic entry output differs across fresh runs.")')
    expect(instrumentation).toContain('providedArguments.getString("expected_output_base64")')
    expect(instrumentation).toContain("actual.visibility != View.VISIBLE")
    expect(instrumentation).toContain("actual.importantForAccessibility != View.IMPORTANT_FOR_ACCESSIBILITY_YES")
    expect(instrumentation).toContain("actual.contentDescription != null")
    expect(instrumentation).toContain("activity.recreate()")
  })

  it("binds an arbitrary semantic entry module and distinct namespace/package identities correctly", () => {
    const program = parseProgram({
      entryModule: "application",
      sources: [{
        filename: "application.rb",
        id: "application",
        language: "ruby",
        source: "module Application\n  puts \"ready\"\nend\n"
      }]
    })
    const set = generateProgramArtifactSet({
      configuration: {
        applicationId: "dev.example.install",
        displayName: "Semantifold & Android",
        namespace: "dev.example.resources",
        packageName: "dev.example.source",
        productName: "Semantifold $ App"
      },
      language: "android",
      program,
      role: "application"
    })
    const content = Object.fromEntries(set.artifacts.map(artifact => [artifact.path, String(artifact.content)]))
    const root = "generated/android-app"
    const activity = content[`${root}/app/src/main/kotlin/dev/example/source/MainActivity.kt`]
    const instrumentation = content[`${root}/app/src/androidTest/kotlin/dev/example/source/SemantifoldUiInstrumentation.kt`]

    expect(activity).toContain("import dev.example.resources.R")
    expect(activity).toContain("SemantifoldModuleApplication.semantifoldEntry()")
    expect(content[`${root}/app/src/test/kotlin/dev/example/source/SemantifoldEntryTest.kt`])
      .toContain("SemantifoldModuleApplication.semantifoldEntry()")
    expect(instrumentation).toContain("import dev.example.resources.R")
    expect(content[`${root}/app/src/main/AndroidManifest.xml`])
      .toContain('android:name="dev.example.source.MainActivity"')
    expect(content[`${root}/app/src/androidTest/AndroidManifest.xml`])
      .toContain('android:targetPackage="dev.example.install"')
    expect(content[`${root}/app/build.gradle.kts`]).toContain('testApplicationId = "dev.example.install.test"')
    expect(content[`${root}/settings.gradle.kts`]).toContain('rootProject.name = "Semantifold \\$ App"')
    expect(content[`${root}/app/src/main/res/values/strings.xml`])
      .toContain("<string name=\"app_name\">Semantifold &amp; Android</string>")
  })

  it("records toolchain, ownership, hashes, configuration causality, and all semantic source identities", () => {
    const sources = rubySources()
    const set = generateProgramArtifactSet({
      language: "android",
      program: parseProgram({entryModule: "main", sources}),
      role: "application"
    })
    const manifestArtifact = set.artifacts.find(({path}) => path.endsWith("semantifold-project.json"))

    assert.ok(manifestArtifact && typeof manifestArtifact.content == "string")
    const manifest = JSON.parse(manifestArtifact.content)

    expect(manifest.schema).toEqual("SemantifoldAndroidProject")
    expect(manifest.target).toEqual("android")
    expect(manifest.ownership.ownedRoot).toEqual("generated/android-app")
    expect(manifest.ownership.ownedPaths).toEqual(set.artifacts.map(({path}) => path))
    expect(manifest.toolchain).toEqual({
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
    expect(manifest.provenance.semanticSources).toEqual(sources.map(item => ({
      artifacts: [`generated/android-app/app/src/main/kotlin/dev/semantifold/generated/semantic/${item.id == "main" ? "Main" : "MathTools"}.kt`],
      filename: item.filename,
      language: item.language,
      sha256: sha256(item.source)
    })))
    expect(manifest.semanticProgram.entry.moduleId).toEqual("main")
    expect(manifest.provenance.syntheticScaffolding).toContain(
      "generated/android-app/app/src/main/kotlin/dev/semantifold/generated/MainActivity.kt")
    const applicationIdentity = manifest.provenance.configuration.find(({field}) => field == "applicationId")

    expect(applicationIdentity.manifestPointer).toEqual("/configuration/applicationId")
    expect(applicationIdentity.outputs.length).toBeGreaterThan(0)
    for (const output of applicationIdentity.outputs) {
      const artifact = set.artifacts.find(({path}) => path == output.path)

      assert.ok(artifact && typeof artifact.content == "string")
      for (const range of output.ranges) expect(artifact.content.slice(range.start, range.end)).toEqual("dev.semantifold.generated")
    }
  })

  it("accepts only hashed safe Android resources and assets and snapshots caller bytes", () => {
    const module = parse({filename: "program.kt", language: "kotlin", source})
    const bytes = new Uint8Array([0, 1, 2, 255])
    const set = generateArtifactSet({
      assets: [{content: "fixture", mediaType: "text/plain", path: "fixtures/value.txt", sha256: sha256("fixture")}],
      language: "android",
      module,
      resources: [{content: bytes, mediaType: "image/png", path: "drawable-xhdpi/logo.png", sha256: sha256(bytes)}],
      role: "application"
    })

    bytes[0] = 9
    expect(set.artifacts.map(({path}) => path)).toContain("generated/android-app/app/src/main/assets/fixtures/value.txt")
    expect(set.artifacts.find(({path}) => path.endsWith("fixtures/value.txt"))?.mediaType).toEqual("text/plain")
    const resource = set.artifacts.find(({path}) => path.endsWith("drawable-xhdpi/logo.png"))

    assert.ok(resource && resource.content instanceof Uint8Array)
    expect([...resource.content]).toEqual([0, 1, 2, 255])
    const regenerated = generateArtifactSet({language: "android", module, role: "application"})

    expect(regenerated.artifacts.some(({path}) => path.endsWith("fixtures/value.txt") || path.endsWith("logo.png"))).toBeFalse()
  })

  it("rejects unsafe configuration, permissions, SDK combinations, and public filesystem controls before output", () => {
    const module = parse({filename: "program.kt", language: "kotlin", source})
    const invalid = [
      {configuration: {applicationId: "Bad.Id"}},
      {configuration: {namespace: "dev.example.class"}},
      {configuration: {packageName: "dev.example.when"}},
      {configuration: {activityClassName: "main.activity"}},
      {configuration: {displayName: "two\u2028lines"}},
      {configuration: {productName: "unsafe/name"}},
      {configuration: {compileSdk: 34}},
      {configuration: {minimumSdk: 36}},
      {configuration: {targetSdk: 36}},
      {configuration: {versionCode: 0}},
      {configuration: {versionName: "01.0.0"}},
      {configuration: {versionName: "1.0.0+"}},
      {configuration: {orientation: "landscape"}},
      {configuration: {theme: "custom"}},
      {configuration: {permissions: ["android.permission.INTERNET"]}},
      {configuration: {manifest: {}}},
      {outputDirectory: "/tmp/app"},
      {overwrite: true},
      {sdkPath: "/opt/android-sdk"},
      {keystore: "/tmp/key"},
      {sourcePath: "program.kt"}
    ]

    for (const candidate of invalid) {
      assert.throws(
        () => generateArtifactSet({...candidate, language: "android", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.language == "android" &&
          ["INVALID_APPLICATION_CONFIGURATION", "INVALID_APPLICATION_INPUT"].includes(error.code)
      )
    }
  })

  it("rejects launcher class names that collide with generated Kotlin scaffold symbols before output", () => {
    const module = parse({filename: "program.kt", language: "kotlin", source})

    for (const activityClassName of ["Activity", "SemantifoldModuleMain"]) {
      assert.throws(
        () => generateArtifactSet({configuration: {activityClassName}, language: "android", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.code == "INVALID_APPLICATION_CONFIGURATION" &&
          error.language == "android" && /collides with generated Kotlin symbol/u.test(error.message)
      )
    }
  })

  it("rejects malformed resource paths, qualifiers, checksums, normalization/case collisions, and generated collisions", () => {
    const module = parse({filename: "program.kt", language: "kotlin", source})
    const item = {content: "x", mediaType: "text/plain", path: "raw/value.txt", sha256: sha256("x")}
    const invalid = [
      {resources: [{...item, path: "../raw/value.txt"}]},
      {resources: [{...item, path: "/raw/value.txt"}]},
      {resources: [{...item, path: "values/strings.xml"}]},
      {resources: [{...item, path: "drawable-fr/logo.png", mediaType: "image/png"}]},
      {resources: [{...item, path: "drawable-mdpi/Logo.png", mediaType: "image/png"}]},
      {resources: [{...item, sha256: "0".repeat(64)}]},
      {resources: [item, {...item}]},
      {assets: [{...item, path: "Value.txt"}, {...item, path: "value.txt"}]},
      {assets: [{...item, path: "valué.txt"}, {...item, path: "valué.txt"}]},
      {assets: [{...item, path: "fixtures"}, {...item, path: "fixtures/value.txt"}]}
    ]

    for (const candidate of invalid) {
      assert.throws(
        () => generateArtifactSet({...candidate, language: "android", module, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.language == "android" &&
          ["INVALID_APPLICATION_RESOURCE", "INVALID_APPLICATION_PATH"].includes(error.code)
      )
    }
  })

  it("rejects duplicate Android resource identifiers before returning an artifact set", () => {
    const module = parse({filename: "program.kt", language: "kotlin", source})
    const collisions = [
      [
        {content: "text", mediaType: "text/plain", path: "raw/value.txt", sha256: sha256("text")},
        {content: "json", mediaType: "application/json", path: "raw/value.json", sha256: sha256("json")}
      ],
      [
        {content: "plain", mediaType: "text/plain", path: "raw/value", sha256: sha256("plain")},
        {content: "text", mediaType: "text/plain", path: "raw/value.txt", sha256: sha256("text")}
      ]
    ]

    for (const resources of collisions) {
      assert.throws(
        () => generateArtifactSet({language: "android", module, resources, role: "application"}),
        error => error instanceof SemantifoldDiagnostic && error.code == "INVALID_APPLICATION_RESOURCE" &&
          error.language == "android" && error.message.includes("Android resource identifier 'raw/value'")
      )
    }
  })

  it("reports unsupported semantics as located Android diagnostics without returning partial artifacts", () => {
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
      () => generateArtifactSet({language: "android", module, role: "application"}),
      error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "android" && error.location?.filename == "unsupported.rb"
    )
  })
})
