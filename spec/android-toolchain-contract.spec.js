// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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
    expect(bootstrap).toContain("20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78")
    expect(bootstrap).toContain("commandlinetools-linux-11076708_latest.zip")
    expect(bootstrap).toContain("2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258")
    expect(bootstrap).toContain("kotlin-compiler-2.2.10.zip")
    expect(bootstrap).toContain("302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc")
    const androidArchives = [
      ["platform-tools_r37.0.1-linux.zip", "d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1"],
      ["platform-35_r02.zip", "0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0"],
      ["build-tools_r35_linux.zip", "bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88"],
      ["emulator-linux_x64-13610412.zip", "2fe2b56fe93ce75e1d478a40162131381d911c355efeaedb54dd1e0d0897a5cf"],
      ["x86_64-35_r09.zip", "c67b9ba0ff5bc0eb6d046871bfa228af14d4d47b02f0cdae94f048e511b7566e"]
    ]

    for (const [archive, hash] of androidArchives) {
      expect(bootstrap).toContain(archive)
      expect(bootstrap).toContain(hash)
    }
    const directChecksums = [...bootstrap.matchAll(
      /printf '%s {2}%s\\n' '([0-9a-f]+)' \\\n\s+"\$BOOTSTRAP_ROOT\/[^"]+" \| sha256sum --check -/gu
    )].map(match => match[1])
    const helperChecksums = [...bootstrap.matchAll(
      /download_android_archive [^\n]+ \\\n\s+([0-9a-f]+) \\\n\s+https:\/\//gu
    )].map(match => match[1])
    const archiveChecksums = [...directChecksums, ...helperChecksums]

    expect(archiveChecksums.length).toEqual(9)
    for (const checksum of archiveChecksums) expect(checksum).toMatch(/^[0-9a-f]{64}$/u)
    expect(bootstrap).not.toMatch(/\bsdkmanager\b/u)
    expect(bootstrap).toContain("Pkg.Revision=35.6.11")
    expect(bootstrap).toContain("SEMANTIFOLD_ANDROID_MODE=prepare")
    expect(acceptance).toContain("SEMANTIFOLD_ANDROID_MODE=offline-build")
    expect(implementation).toContain("--offline")
    expect(implementation).toContain("Offline Gradle cache is incomplete")
    expect(implementation).toContain("is not executable")
    expect(implementation).toContain("lintDebug")
    expect(implementation).toContain("testDebugUnitTest")
    expect(implementation).toContain("assembleDebugAndroidTest")
    expect(implementation).toContain('system-images/android-35/google_apis/x86_64/system.img')
    expect(implementation).toContain('path.join(root, "debug.keystore")')
    expect(implementation).toContain("SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: root")
    expect(acceptance).not.toMatch(/curl|wget/u)
  })

  it("propagates a verifier failure even when both APK paths already exist", {timeoutMs: 30_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-status-"))
    const binaryDirectory = path.join(root, "bin")
    const acceptanceRoot = path.join(root, "acceptance")

    try {
      await mkdir(binaryDirectory)
      const fakeNode = path.join(binaryDirectory, "node")

      await writeFile(fakeNode, `#!/bin/sh
set -eu
project="$SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT/generated/android-app/app/build/outputs/apk"
mkdir -p "$project/debug" "$project/androidTest/debug"
: > "$project/debug/app-debug.apk"
: > "$project/androidTest/debug/app-debug-androidTest.apk"
printf '%s\\n' '{"invalid":"partial verifier output"}'
exit 23
`)
      await chmod(fakeNode, 0o700)
      await assert.rejects(
        executeFile("sh", ["scripts/accept-android.sh"], {
          cwd: new URL("../", import.meta.url),
          env: {...process.env, PATH: `${binaryDirectory}:/usr/bin:/bin`, SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: acceptanceRoot}
        }),
        error => error?.code == 23
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
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
    expect(emulator).toContain("dev.semantifold.generated.test/dev.semantifold.generated.SemantifoldUiInstrumentation")
    expect(emulator).not.toMatch(/adb root|chmod[^\n]*\/dev\/kvm|chown[^\n]*\/dev\/kvm/u)
  })

  it("keeps Android feature documentation and application-target routing aligned with the registry", async () => {
    const [android, languageSupport, ios] = await Promise.all([
      readFile(new URL("../docs/android.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/language-support.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/ios.md", import.meta.url), "utf8")
    ])
    const androidRow = languageSupport.split("\n").find(line => line.startsWith("| `android` |"))

    assert.ok(androidRow)
    expect(androidRow.split("|")[7].trim()).toEqual("no")
    expect(android).toContain("distribution SHA-256 `20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78`")
    expect(android).toContain("https://dl.google.com/android/repository/repository2-3.xml")
    expect(android).toContain("https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml")
    expect(android).toContain("https://developer.android.com/studio/emulator_archive")
    expect(ios).toContain("currently `ios` and `android`")
    expect(ios).not.toContain("currently only `ios`")
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
