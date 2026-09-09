// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import DockerfileAst from "dockerfile-ast"
import {parse as parseYaml} from "yaml"

const {DockerfileParser} = DockerfileAst
const archive = "https://github.com/JetBrains/kotlin/releases/download/v2.4.20/kotlin-compiler-2.4.20.zip"
const checksum = "59e9ca74c7904ef2c122b12114937673ccce68de820a663f0ed66ccf8799e0b7"
const executable = "/opt/kotlinc/bin/kotlinc"
const developmentJdkPackage = "openjdk-25-jdk-headless=25.0.4+7-1~26.04"
const tensorbuzzJdkPackage = "openjdk-25-jdk-headless=25.0.4+7-1~24.04"
const compilerReadback = `KOTLIN_VERSION_OUTPUT="$(${executable} -version 2>&1)"`
const compilerVersionPattern = String.raw`^info: kotlinc-jvm 2\.4\.20 \(JRE 25\.0\.4\+7-1-(24|26)\.04-Ubuntu\)$`
const compilerVersionProbe = `printf '%s\\n' "$KOTLIN_VERSION_OUTPUT" | grep --extended-regexp --quiet '${compilerVersionPattern}'`

describe("Kotlin canonical compiler and JVM image contract", () => {
  it("admits only the qualified Ubuntu packaging suffix variation", () => {
    const accepted = new RegExp(compilerVersionPattern, "u")

    for (const release of ["24.04", "26.04"]) {
      expect(`info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-${release}-Ubuntu)`).toMatch(accepted)
    }
    for (const output of [
      "info: kotlinc-jvm 2.4.10 (JRE 25.0.4+7-1-24.04-Ubuntu)",
      "info: kotlinc-jvm 2.4.20 (JRE 24.0.2+12-1-24.04-Ubuntu)",
      "info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-25.04-Ubuntu)",
      "info: kotlinc-js 2.4.20 (JRE 25.0.4+7-1-24.04-Ubuntu)"
    ]) expect(output).not.toMatch(accepted)
  })

  it("pins and probes the official Kotlin 2.4.20 compiler without shadowing PATH", async () => {
    const source = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const instructions = DockerfileParser.parse(source).getInstructions()
    const runs = instructions.filter((instruction) => instruction.getKeyword() == "RUN")
      .map((instruction) => instruction.getArgumentsContent()).join("\n")

    expect(source).toContain(archive)
    expect(source).toContain(checksum)
    expect(source).toContain(developmentJdkPackage)
    expect(source).toContain(`ENV SEMANTIFOLD_KOTLINC=${executable}`)
    expect(runs).toContain(compilerReadback)
    expect(runs).toContain(compilerVersionProbe)
    expect(runs).toContain("openjdk version \"25.0.4\"")
    expect(source).not.toMatch(/ENV PATH=.*kotlinc|ln --symbolic .*kotlinc/u)
  })

  it("installs the same checksummed compiler and the exact Noble JDK build in TensorBuzz", async () => {
    const source = await readFile(new URL("../tensorbuzz.yml", import.meta.url), "utf8")
    const config = parseYaml(source)
    const beforeInstall = config.before_install.join("\n")

    expect(beforeInstall).toContain(archive)
    expect(beforeInstall).toContain(checksum)
    expect(beforeInstall).toContain(tensorbuzzJdkPackage)
    expect(beforeInstall).toContain(compilerReadback)
    expect(beforeInstall).toContain(compilerVersionProbe)
    expect(beforeInstall).toContain("openjdk version \"25.0.4\"")
    expect(config.environment.SEMANTIFOLD_KOTLINC).toEqual(executable)
    expect(config.environment.PATH).toEqual(undefined)
  })
})
