// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse as parseYaml} from "yaml"
import {generateArtifactSet, parse} from "../index.js"

const module = () => parse({
  filename: "program.dart",
  language: "dart",
  source: `void main() {
  print("hé😀!");
}
`
})

describe("Flutter toolchain and TensorBuzz acceptance contract", () => {
  it("pins one official Flutter SDK and restores its exact SDK-owned packages without a generator download", async () => {
    const [bootstrap, acceptance, implementation] = await Promise.all([
      readFile(new URL("../scripts/bootstrap-flutter.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/accept-flutter.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/flutter-acceptance.js", import.meta.url), "utf8")
    ])

    expect(bootstrap).toContain("flutter_linux_3.47.4-stable.tar.xz")
    expect(bootstrap).toContain("1576174568")
    expect(bootstrap).toContain("5b45f0ceda99b9bebdc873e7e69f6450aeb4c30f454b505e2e62fc9255a907d3")
    expect(bootstrap).toContain("9584c6713b324636289d067944a46fd6b49df14b")
    expect(bootstrap).toContain("pub cache preload")
    expect(bootstrap).not.toMatch(/flutter create|flutter precache/u)
    expect(acceptance).not.toMatch(/curl|wget/u)
    expect(implementation).toContain("--offline")
    expect(implementation).toContain("--enforce-lockfile")
    expect(implementation).toContain("--no-pub")
    expect(implementation).toContain("--fatal-infos")
    expect(implementation).toContain("--fatal-warnings")
    expect(implementation).toContain("--set-exit-if-changed")
    expect(implementation).not.toContain("skipDependencyChecks")
    expect(`${bootstrap}\n${acceptance}\n${implementation}`).not.toMatch(/xcode|cocoapods|simulator/iu)
  })

  it("uses the one upgraded shared Android cache and KVM lane for both native and Flutter acceptance", async () => {
    const [source, bootstrap, emulator, uiAssertion] = await Promise.all([
      readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8"),
      readFile(new URL("../scripts/bootstrap-android.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/android-emulator-acceptance.sh", import.meta.url), "utf8"),
      readFile(new URL("../scripts/flutter-ui-assertion.js", import.meta.url), "utf8")
    ])
    const config = parseYaml(source)
    const lane = config.builds.android

    expect(lane.devices).toEqual(["/dev/kvm:/dev/kvm"])
    expect(lane.script).toEqual([
      "scripts/bootstrap-android.sh",
      "scripts/bootstrap-flutter.sh",
      "scripts/accept-android.sh",
      "scripts/accept-flutter.sh",
      "scripts/android-emulator-acceptance.sh"
    ])
    expect(config.environment.SEMANTIFOLD_GRADLE_HOME).toEqual("/opt/gradle-8.14")
    expect(config.environment.SEMANTIFOLD_FLUTTER_HOME).toEqual("/opt/semantifold-flutter-3.47.4")
    expect(bootstrap).toContain("gradle-8.14-bin.zip")
    expect(bootstrap).toContain("61ad310d3c7d3e5da131b76bbf22b5a4c0786e9d892dae8c1658d4b484de3caa")
    expect(emulator).toContain("semantifold-flutter-acceptance")
    expect(emulator).toContain("FLUTTER_APK")
    expect(emulator).toContain("dev.semantifold.generated/.MainActivity")
    expect(emulator).toContain("flutter-ui-assertion.js")
    expect(uiAssertion).toContain("semantifold-output")
    expect(emulator.match(/-wipe-data/gu)?.length).toEqual(1)
    expect(emulator).not.toMatch(/-no-accel|adb root|chmod.*kvm/iu)
  })

  it("records the compatible shared matrix without bypassing Flutter dependency validation", () => {
    const set = generateArtifactSet({language: "flutter", module: module(), role: "application"})
    const manifest = JSON.parse(String(set.artifacts.at(-1)?.content))
    const properties = String(set.artifacts.find(({path}) => path.endsWith("android/gradle.properties"))?.content)

    expect(manifest.toolchain.android).toEqual({
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
    expect(properties).not.toContain("skipDependencyChecks")
    expect(set.artifacts.some(({path}) => path.includes("/ios/"))).toBeFalse()
  })
})
