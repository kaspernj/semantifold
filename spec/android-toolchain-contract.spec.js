// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {readFile} from "node:fs/promises"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {parse as parseYaml} from "yaml"
import {generateArtifactSet, parse} from "../index.js"

const executeFile = promisify(execFile)

describe("Android toolchain and TensorBuzz acceptance contract", () => {
  it("pins official bootstrap inputs and separates online cache preparation from the offline build", async () => {
    const [bootstrap, acceptance, implementation] = await Promise.all([
      readFile(new URL("../scripts/bootstrap-android.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/accept-android.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/android-acceptance.js", import.meta.url), "utf8")
    ])

    expect(bootstrap).toContain("gradle-8.13-bin.zip")
    expect(bootstrap).toContain("20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed789")
    expect(bootstrap).toContain("commandlinetools-linux-11076708_latest.zip")
    expect(bootstrap).toContain("2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258")
    expect(bootstrap).toContain("kotlin-compiler-2.2.10.zip")
    expect(bootstrap).toContain("302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc")
    for (const value of ["platforms;android-35", "build-tools;35.0.0", "emulator", "system-images;android-35;google_apis;x86_64"]) {
      expect(bootstrap).toContain(value)
    }
    expect(bootstrap).toContain("SEMANTIFOLD_ANDROID_MODE=prepare")
    expect(acceptance).toContain("SEMANTIFOLD_ANDROID_MODE=offline-build")
    expect(implementation).toContain("--offline")
    expect(implementation).toContain("Offline Gradle cache is incomplete")
    expect(implementation).toContain("is not executable")
    expect(implementation).toContain("lintDebug")
    expect(implementation).toContain("testDebugUnitTest")
    expect(implementation).toContain("assembleDebugAndroidTest")
    expect(implementation).toContain('path.join(root, "debug.keystore")')
    expect(implementation).toContain("SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: root")
    expect(acceptance).not.toMatch(/curl|wget/u)
  })

  it("routes real emulator acceptance only through TensorBuzz KVM without privileged adb or permission changes", async () => {
    const [source, emulator] = await Promise.all([
      readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8"),
      readFile(new URL("../scripts/android-emulator-acceptance.sh", import.meta.url), "utf8")
    ])
    const config = parseYaml(source)
    const lane = config.builds.android

    expect(lane.devices).toEqual(["/dev/kvm:/dev/kvm"])
    expect(lane.script).toEqual(["scripts/bootstrap-android.sh", "scripts/accept-android.sh", "scripts/android-emulator-acceptance.sh"])
    expect(config.environment.SEMANTIFOLD_ANDROID_HOME).toEqual("/opt/semantifold-android-sdk")
    expect(config.environment.SEMANTIFOLD_GRADLE_HOME).toEqual("/opt/gradle-8.13")
    expect(config.environment.SEMANTIFOLD_ANDROID_AVD).toEqual("semantifold-api35")
    expect(config.environment.SEMANTIFOLD_KOTLIN_HOME).toEqual("/opt/kotlinc-2.2.10")
    expect(emulator).toContain("test -c /dev/kvm")
    expect(emulator).toContain("-accel-check")
    expect(emulator).toContain("-accel on")
    expect(emulator).toContain("-no-snapshot")
    expect(emulator).toContain("-wipe-data")
    expect(emulator).toContain("emulator-5580")
    expect(emulator).toContain("ANDROID_ADB_SERVER_PORT=5581")
    expect(emulator).toContain('"$ADB" kill-server')
    expect(emulator).toContain("command -v timeout")
    expect(emulator).toContain('timeout 180 "$ADB"')
    expect(emulator.match(/run_emulator_acceptance/g)?.length).toEqual(3)
    expect(emulator).toContain("uiautomator dump")
    expect(emulator).toContain("screencap -p")
    expect(emulator).toContain("logcat -d")
    expect(emulator).not.toMatch(/adb root|chmod[^\n]*\/dev\/kvm|chown[^\n]*\/dev\/kvm/u)
  })

  it("allows only non-transitive JUnit in test scope and records deterministic runtime/APK leak checks", async () => {
    const module = parse({
      filename: "program.kt",
      language: "kotlin",
      source: `fun choose(value: String, suffix: String): String {
  return value + suffix
}
fun main() {
  println(choose("ok", "!"))
}
`
    })
    const set = generateArtifactSet({language: "android", module, role: "application"})
    const build = String(set.artifacts.find(({path}) => path.endsWith("app/build.gradle.kts"))?.content)
    const properties = String(set.artifacts.find(({path}) => path.endsWith("gradle.properties"))?.content)
    const acceptance = await readFile(new URL("../scripts/android-acceptance.js", import.meta.url), "utf8")

    expect(build.match(/(?:api|compileOnly|implementation|runtimeOnly|testImplementation|androidTestImplementation)\s*\(/gu))
      .toEqual(["testImplementation("])
    expect(build).toContain('testImplementation("junit:junit:4.13.2") {\n    isTransitive = false\n  }')
    expect(properties).toContain("kotlin.stdlib.default.dependency=false")
    expect(build).toContain("libraries.from(files(semantifoldKotlinStdlib))")
    expect(acceptance).toContain("debugRuntimeClasspath")
    expect(acceptance).toContain("debugUnitTestRuntimeClasspath")
    expect(acceptance).toContain("Runtime dependency graph must be empty")
    expect(acceptance).toContain("junit:junit:4.13.2")
    expect(acceptance).toContain("org/junit/")
    expect(acceptance).toContain("org/hamcrest/")
    expect(acceptance).toContain("kotlin/jvm/internal/")
    expect(acceptance).toContain("kotlin/collections/")
  })

  it("fails missing local tools and caches with an infrastructure classification", async () => {
    await assert.rejects(
      executeFile(process.execPath, ["scripts/android-acceptance.js", "--check"], {
        cwd: new URL("../", import.meta.url),
        env: {LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin:/bin"}
      }),
      error => error?.code == 2 && /SEMANTIFOLD_ANDROID_INFRASTRUCTURE:/u.test(String(error.stderr))
    )
  })
})
