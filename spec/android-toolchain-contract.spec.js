// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {chmod, mkdir, mkdtemp, readFile, rm, truncate, writeFile} from "node:fs/promises"
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

    expect(bootstrap).toContain("gradle-8.14-bin.zip")
    expect(bootstrap).toContain("61ad310d3c7d3e5da131b76bbf22b5a4c0786e9d892dae8c1658d4b484de3caa")
    expect(bootstrap).toContain("commandlinetools-linux-11076708_latest.zip")
    expect(bootstrap).toContain("2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258")
    expect(bootstrap).toContain("kotlin-compiler-2.2.10.zip")
    expect(bootstrap).toContain("302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc")
    const androidArchives = [
      ["platform-tools_r37.0.1-linux.zip", "d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1"],
      ["platform-35_r02.zip", "0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0"],
      ["build-tools_r35_linux.zip", "bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88"],
      ["emulator-linux_x64-13610412.zip", "2fe2b56fe93ce75e1d478a40162131381d911c355efeaedb54dd1e0d0897a5cf"],
      ["x86_64-35_r09.zip", "c67b9ba0ff5bc0eb6d046871bfa228af14d4d47b02f0cdae94f048e511b7566e"],
      ["android-ndk-r27-linux.zip", "2f17eb8bcbfdc40201c0b36e9a70826fcd2524ab7a2a235e2c71186c302da1dc"],
      ["cmake-3.22.1-linux.zip", "9196644852a978012caf7a4067ba1898debf6cc204c3341562771e31080d6869"]
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

    expect(archiveChecksums.length).toEqual(11)
    for (const checksum of archiveChecksums) expect(checksum).toMatch(/^[0-9a-f]{64}$/u)
    expect(bootstrap).not.toMatch(/\bsdkmanager\b/u)
    expect(bootstrap).toContain("Pkg.Revision=35.6.11")
    const emulatorVersionAssertion = bootstrap.match(
      /test "\$\("\$ANDROID_HOME\/emulator\/emulator" -version [^\n]+\)" = ([0-9.]+)$/mu
    )

    expect(emulatorVersionAssertion?.[1]).toEqual("35.6.11.0")
    expect(bootstrap).toContain("SEMANTIFOLD_ANDROID_MODE=prepare")
    expect(acceptance).toContain("SEMANTIFOLD_ANDROID_MODE=offline-build")
    expect(implementation).toContain("--offline")
    expect(implementation).toContain("Offline Gradle cache is incomplete")
    expect(implementation).toContain("is not executable")
    expect(implementation).toContain("lintDebug")
    expect(implementation).toContain("testDebugUnitTest")
    expect(implementation).toContain("assembleDebugAndroidTest")
    expect(implementation).toContain('system-images/android-35/google_apis/x86_64/system.img')
    expect(bootstrap).toContain(
      'sudo mv "$BOOTSTRAP_ROOT/system-image/x86_64" "$ANDROID_HOME/system-images/android-35/google_apis/x86_64"'
    )
    expect(implementation).toContain('path.join(root, "debug.keystore")')
    expect(implementation).toContain("SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: root")
    expect(acceptance).not.toMatch(/curl|wget/u)
  })

  it("registers the pinned standalone emulator archive before creating the AVD", async () => {
    const bootstrap = await readFile(new URL("../scripts/bootstrap-android.sh", import.meta.url), "utf8")
    const installCommand = 'install -m 0644 scripts/android-emulator-package.xml "$ANDROID_HOME/emulator/package.xml"'

    expect(bootstrap).toContain(installCommand)
    const registration = await readFile(new URL("../scripts/android-emulator-package.xml", import.meta.url), "utf8")
    const documentation = await readFile(new URL("../docs/android.md", import.meta.url), "utf8")
    const installIndex = bootstrap.indexOf(installCommand)
    const createIndex = bootstrap.indexOf('avdmanager" create avd')

    assert.ok(installIndex >= 0 && createIndex > installIndex)
    expect(registration).toContain('<localPackage path="emulator" obsolete="false">')
    expect(registration).toContain('xsi:type="generic:genericDetailsType"')
    expect(registration).toContain("<revision><major>35</major><minor>6</minor><micro>11</micro></revision>")
    expect(registration).toContain("<display-name>Android Emulator</display-name>")
    expect(documentation).toContain("checked-in exact local-package descriptor")
  })

  it("checks the installed API-35 system image without loading its multi-gigabyte payload", {timeoutMs: 30_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-system-image-"))
    const androidHome = path.join(root, "android")
    const gradleHome = path.join(root, "gradle")
    const gradleUserHome = path.join(root, "gradle-cache")
    const javaHome = path.join(root, "java")
    const kotlinHome = path.join(root, "kotlin")

    try {
      const executableSources = new Map([
        [path.join(gradleHome, "bin/gradle"), "printf 'Gradle 8.14\\n'"],
        [path.join(javaHome, "bin/java"), "printf 'openjdk version \"21.0.8\"\\n' >&2"],
        [path.join(javaHome, "bin/keytool"), ":"],
        [path.join(kotlinHome, "bin/kotlinc"), "printf 'info: kotlinc-jvm 2.2.10\\n' >&2"],
        [path.join(androidHome, "platform-tools/adb"), ":"],
        [path.join(androidHome, "emulator/emulator"), "printf 'Android emulator version 35.6.11.0\\n'"],
        [path.join(androidHome, "build-tools/35.0.0/aapt2"), ":"]
      ])

      for (const [filename, source] of executableSources) {
        await mkdir(path.dirname(filename), {recursive: true})
        await writeFile(filename, `#!/bin/sh\n${source}\n`)
        await chmod(filename, 0o700)
      }
      await mkdir(gradleUserHome)
      await writeFile(path.join(gradleUserHome, "cache-marker"), "prepared\n")
      await mkdir(path.join(kotlinHome, "lib"))
      await writeFile(path.join(kotlinHome, "lib/kotlin-stdlib.jar"), "")
      await mkdir(path.join(androidHome, "platforms/android-35"), {recursive: true})
      await writeFile(path.join(androidHome, "platforms/android-35/android.jar"), "")
      const systemImageDirectory = path.join(androidHome, "system-images/android-35/google_apis/x86_64")
      const systemImage = path.join(systemImageDirectory, "system.img")

      await mkdir(systemImageDirectory, {recursive: true})
      await writeFile(systemImage, "")
      await truncate(systemImage, 3_576_692_736)
      await writeFile(path.join(androidHome, "platform-tools/source.properties"), "Pkg.Revision=37.0.1\n")
      await writeFile(path.join(androidHome, "platforms/android-35/source.properties"),
        "Pkg.Revision=2\nAndroidVersion.ApiLevel=35\n")
      await writeFile(path.join(androidHome, "build-tools/35.0.0/source.properties"), "Pkg.Revision=35.0.0\n")
      await writeFile(path.join(androidHome, "emulator/source.properties"),
        "Pkg.Revision=35.6.11\nPkg.BuildId=13610412\n")
      await writeFile(path.join(systemImageDirectory, "source.properties"),
        "Pkg.Revision=9\nAndroidVersion.ApiLevel=35\nSystemImage.Abi=x86_64\nSystemImage.TagId=google_apis\n")

      await executeFile(process.execPath, ["scripts/android-acceptance.js", "--check"], {
        cwd: new URL("../", import.meta.url),
        env: {
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          PATH: "/usr/bin:/bin",
          SEMANTIFOLD_ANDROID_HOME: androidHome,
          SEMANTIFOLD_GRADLE_HOME: gradleHome,
          SEMANTIFOLD_GRADLE_USER_HOME: gradleUserHome,
          SEMANTIFOLD_KOTLIN_HOME: kotlinHome,
          JAVA_HOME: javaHome
        }
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
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

  it("prints bounded captured emulator diagnostics without replacing the original failure status", {timeoutMs: 30_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-emulator-diagnostics-"))
    const androidHome = path.join(root, "android")
    const adb = path.join(androidHome, "platform-tools/adb")
    const acceptanceRoot = "/tmp/semantifold-android-acceptance"
    const artifacts = path.join(acceptanceRoot, "emulator-artifacts")
    let ownsAcceptanceRoot = false

    try {
      await mkdir(acceptanceRoot, {mode: 0o700})
      ownsAcceptanceRoot = true
      await mkdir(artifacts)
      await mkdir(path.dirname(adb), {recursive: true})
      await writeFile(adb, `#!/bin/sh
if [ "\${1:-}" = devices ]; then
  printf '%s\\n' 'List of devices attached' 'emulator-5580 offline product:semantifold'
elif [ "\${3:-}" = logcat ]; then
  printf '%s\\n' 'bounded fake logcat evidence'
fi
`)
      await chmod(adb, 0o700)
      await writeFile(path.join(artifacts, "accel-check.txt"),
        `ACCEL_PREFIX_MUST_BE_TRUNCATED\n${"x".repeat(20_000)}\nacceleration-tail-evidence\n`)
      const header = "SEMANTIFOLD_ANDROID_EMULATOR_FAILURE: KVM character device is unavailable (exit status 2)"

      await assert.rejects(executeFile("sh", ["scripts/android-emulator-acceptance.sh"], {
        cwd: new URL("../", import.meta.url),
        env: {...process.env, SEMANTIFOLD_ANDROID_HOME: androidHome}
      }), error => {
        const stderr = String(error?.stderr)

        return error?.code == 2 && stderr.split(header).length == 2 &&
          stderr.includes("--- accel-check.txt (last 16384 bytes) ---") &&
          stderr.includes("acceleration-tail-evidence") && !stderr.includes("ACCEL_PREFIX_MUST_BE_TRUNCATED") &&
          stderr.includes("--- adb-state.txt (last 16384 bytes) ---") &&
          stderr.includes("emulator-5580 offline product:semantifold")
      })
    } finally {
      if (ownsAcceptanceRoot) await rm(acceptanceRoot, {force: true, recursive: true})
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
    expect(lane.script).toEqual([
      "scripts/bootstrap-android.sh", "scripts/bootstrap-flutter.sh", "scripts/accept-android.sh",
      "scripts/accept-flutter.sh", "scripts/android-emulator-acceptance.sh"
    ])
    expect(config.environment.SEMANTIFOLD_ANDROID_HOME).toEqual("/opt/semantifold-android-sdk")
    expect(config.environment.SEMANTIFOLD_GRADLE_HOME).toEqual("/opt/gradle-8.14")
    expect(config.environment.SEMANTIFOLD_ANDROID_AVD).toEqual("semantifold-api35")
    expect(config.environment.SEMANTIFOLD_KOTLIN_HOME).toEqual("/opt/kotlinc-2.2.10")
    expect(emulator).toContain("test -c /dev/kvm")
    expect(emulator).toContain("-accel-check")
    expect(emulator).toContain("-accel on")
    expect(emulator).toContain("-no-snapshot")
    expect(emulator).toContain("-wipe-data")
    expect(emulator).toContain("emulator-5580")
    const consolePortMatch = emulator.match(/^PORT=(\d+)$/mu)
    const adbServerPortMatch = emulator.match(/^ANDROID_ADB_SERVER_PORT=(\d+)$/mu)

    assert.ok(consolePortMatch && adbServerPortMatch)
    const consolePort = Number(consolePortMatch[1])
    const transportPort = consolePort + 1
    const adbServerPort = Number(adbServerPortMatch[1])

    expect(adbServerPort).not.toEqual(consolePort)
    expect(adbServerPort).not.toEqual(transportPort)
    const lockMatch = emulator.match(/^LOCK=\/tmp\/semantifold-android-(\d+)-(\d+)-(\d+)\.lock$/mu)

    assert.ok(lockMatch)
    expect(lockMatch.slice(1).map(Number)).toEqual([consolePort, transportPort, adbServerPort])
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
    expect(android).toContain("distribution SHA-256 `61ad310d3c7d3e5da131b76bbf22b5a4c0786e9d892dae8c1658d4b484de3caa`")
    expect(android).toContain("https://dl.google.com/android/repository/repository2-3.xml")
    expect(android).toContain("https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml")
    expect(android).toContain("https://developer.android.com/studio/emulator_archive")
    expect(ios).toContain("currently `ios` and `android`")
    expect(ios).not.toContain("currently only `ios`")
  })

  it("keeps unit dependencies exact and packages only the pinned instrumentation runtime", async () => {
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

    expect(build.match(
      /(?:api|compileOnly|implementation|runtimeOnly|testImplementation|testRuntimeOnly|androidTestImplementation)\s*\(/gu
    )).toEqual(["testRuntimeOnly(", "androidTestImplementation(", "testImplementation("])
    expect(build).toContain('testImplementation("junit:junit:4.13.2") {\n    isTransitive = false\n  }')
    expect(build).toContain('testRuntimeOnly("org.hamcrest:hamcrest-core:1.3") {\n    isTransitive = false\n  }')
    expect(properties).toContain("kotlin.stdlib.default.dependency=false")
    expect(build).toContain("libraries.from(files(semantifoldKotlinStdlib))")
    expect(build).toContain("androidTestImplementation(files(semantifoldKotlinStdlib))")
    expect(acceptance).toContain("debugRuntimeClasspath")
    expect(acceptance).toContain("debugUnitTestRuntimeClasspath")
    expect(acceptance).toContain("Runtime dependency graph must be empty")
    expect(acceptance).toContain("junit:junit:4.13.2")
    expect(acceptance).toContain("org.hamcrest:hamcrest-core:1.3")
    expect(acceptance).toContain("org/junit/")
    expect(acceptance).toContain("org/hamcrest/")
    expect(acceptance).toContain("kotlin/jvm/internal/")
    expect(acceptance).toContain("kotlin/collections/")
    expect(acceptance).toContain('requireApkDependency(testApk, "kotlin/jvm/internal/Intrinsics")')
  })

  it("validates exact dependency reports and the required instrumentation runtime payload", {timeoutMs: 30_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-dependency-report-"))
    const androidHome = path.join(root, "android")
    const binaryDirectory = path.join(root, "bin")
    const gradleHome = path.join(root, "gradle")
    const gradleUserHome = path.join(root, "gradle-cache")
    const javaHome = path.join(root, "java")
    const kotlinHome = path.join(root, "kotlin")

    try {
      const executableSources = new Map([
        [path.join(gradleHome, "bin/gradle"), `if [ "\${1:-}" = --version ]; then
  printf 'Gradle 8.14\\n'
elif printf ' %s ' "$*" | grep -q ' lintDebug '; then
  project="$SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT/generated/android-app/app/build/outputs/apk"
  mkdir -p "$project/debug" "$project/androidTest/debug"
  : > "$project/debug/app-debug.apk"
  : > "$project/androidTest/debug/app-debug-androidTest.apk"
elif printf ' %s ' "$*" | grep -q ' debugUnitTestRuntimeClasspath '; then
  printf '%s\\n' "+--- \${SEMANTIFOLD_FAKE_PROJECT_ENTRY:-project :app (*)}" '+--- junit:junit:4.13.2' '\\--- org.hamcrest:hamcrest-core:1.3'
fi`],
        [path.join(javaHome, "bin/java"), "printf 'openjdk version \"21.0.8\"\\n' >&2"],
        [path.join(javaHome, "bin/keytool"), `while [ "$#" -gt 0 ]; do
  if [ "$1" = -keystore ]; then shift; destination=$1; fi
  shift
done
: > "$destination"`],
        [path.join(kotlinHome, "bin/kotlinc"), "printf 'info: kotlinc-jvm 2.2.10\\n' >&2"],
        [path.join(androidHome, "platform-tools/adb"), ":"],
        [path.join(androidHome, "emulator/emulator"), "printf 'Android emulator version 35.6.11.0\\n'"],
        [path.join(androidHome, "build-tools/35.0.0/aapt2"), ":"],
        [path.join(binaryDirectory, "unzip"), `case "\${2:-}" in
  *androidTest*)
    if [ "\${SEMANTIFOLD_FAKE_TEST_APK_STDLIB:-present}" = present ]; then
      printf '%s\\n' 'kotlin/jvm/internal/Intrinsics'
    fi
    ;;
esac`]
      ])

      for (const [filename, source] of executableSources) {
        await mkdir(path.dirname(filename), {recursive: true})
        await writeFile(filename, `#!/bin/sh\nset -eu\n${source}\n`)
        await chmod(filename, 0o700)
      }
      await mkdir(gradleUserHome)
      await writeFile(path.join(gradleUserHome, "cache-marker"), "prepared\n")
      await mkdir(path.join(kotlinHome, "lib"))
      await writeFile(path.join(kotlinHome, "lib/kotlin-stdlib.jar"), "")
      await mkdir(path.join(androidHome, "platforms/android-35"), {recursive: true})
      await writeFile(path.join(androidHome, "platforms/android-35/android.jar"), "")
      const systemImageDirectory = path.join(androidHome, "system-images/android-35/google_apis/x86_64")

      await mkdir(systemImageDirectory, {recursive: true})
      await writeFile(path.join(systemImageDirectory, "system.img"), "")
      await writeFile(path.join(androidHome, "platform-tools/source.properties"), "Pkg.Revision=37.0.1\n")
      await writeFile(path.join(androidHome, "platforms/android-35/source.properties"),
        "Pkg.Revision=2\nAndroidVersion.ApiLevel=35\n")
      await writeFile(path.join(androidHome, "build-tools/35.0.0/source.properties"), "Pkg.Revision=35.0.0\n")
      await writeFile(path.join(androidHome, "emulator/source.properties"),
        "Pkg.Revision=35.6.11\nPkg.BuildId=13610412\n")
      await writeFile(path.join(systemImageDirectory, "source.properties"),
        "Pkg.Revision=9\nAndroidVersion.ApiLevel=35\nSystemImage.Abi=x86_64\nSystemImage.TagId=google_apis\n")
      const environment = {
        LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: `${binaryDirectory}:/usr/bin:/bin`,
        SEMANTIFOLD_ANDROID_HOME: androidHome, SEMANTIFOLD_ANDROID_MODE: "offline-build",
        SEMANTIFOLD_GRADLE_HOME: gradleHome, SEMANTIFOLD_GRADLE_USER_HOME: gradleUserHome,
        SEMANTIFOLD_KOTLIN_HOME: kotlinHome, JAVA_HOME: javaHome
      }
      const acceptedRoot = path.join(root, "accepted")
      const accepted = await executeFile(process.execPath, ["scripts/android-acceptance.js"], {
        cwd: new URL("../", import.meta.url), env: {...environment, SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: acceptedRoot}
      })

      expect(JSON.parse(accepted.stdout).projectDirectory)
        .toEqual(path.join(acceptedRoot, "generated/android-app"))
      const missingRuntimeRoot = path.join(root, "missing-runtime")

      await assert.rejects(executeFile(process.execPath, ["scripts/android-acceptance.js"], {
        cwd: new URL("../", import.meta.url), env: {...environment,
          SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: missingRuntimeRoot, SEMANTIFOLD_FAKE_TEST_APK_STDLIB: "missing"}
      }), error => error?.code == 1 &&
        String(error.stderr).includes("Instrumentation APK is missing required runtime marker 'kotlin/jvm/internal/Intrinsics'."))
      const rejectedEntries = ["project :", "project :forbidden", "project :app", "project :forbidden (*)"]

      for (const [index, projectEntry] of rejectedEntries.entries()) {
        const rejectedRoot = path.join(root, `rejected-${index}`)

        await assert.rejects(executeFile(process.execPath, ["scripts/android-acceptance.js"], {
          cwd: new URL("../", import.meta.url), env: {...environment, SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT: rejectedRoot,
            SEMANTIFOLD_FAKE_PROJECT_ENTRY: projectEntry}
        }), error => error?.code == 1 && String(error.stderr).includes(projectEntry))
      }
    } finally {
      await rm(root, {force: true, recursive: true})
    }
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
