// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import DockerfileAst from "dockerfile-ast"

const {DockerfileParser} = DockerfileAst
const swiftImage = "swift:6.3.3-noble@sha256:56ef1be2c1ca36f4c52440357dc1fcdfdb5e113587134fcadeef57c225c71b54"
const swiftAmd64Manifest = "sha256:4e0fc24f0f93a5cf9a91bfcf182534bbc0571d70d757389c04ff1f616c1c460f"
const ubuntuImage = "ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb"

describe("Swift canonical development-image contract", () => {
  it("extracts only the exact official Swift 6.3.3 toolchain into the unchanged final Ubuntu base", async () => {
    const source = await readFile(new URL("../Dockerfile", import.meta.url), "utf8")
    const instructions = DockerfileParser.parse(source).getInstructions()
    const from = instructions.filter((instruction) => instruction.getKeyword() == "FROM")
    const copies = instructions.filter((instruction) => instruction.getKeyword() == "COPY")
    const runInstructions = instructions.filter((instruction) => instruction.getKeyword() == "RUN")
      .map((instruction) => instruction.getArgumentsContent())
    const runs = runInstructions.join("\n")
    const finalAptInstall = runInstructions.find((instruction) => instruction.startsWith("apt-get update"))

    expect(from.map((instruction) => instruction.getArgumentsContent())).toEqual([
      `${swiftImage} AS swift-toolchain`, ubuntuImage
    ])
    expect(source).toContain(swiftAmd64Manifest)
    expect(source).not.toContain("sha256:56ef1be5")
    assert.ok(copies.length > 0)
    for (const instruction of copies) {
      expect(instruction.getFlags().map((flag) => [flag.getName(), flag.getValue()])).toEqual([["from", "swift-toolchain"]])
      expect(instruction.getArgumentsContent()).not.toContain("/home/dev")
      expect(instruction.getArgumentsContent()).not.toMatch(/(?:^|\s)\.\/?(?:\s|$)/u)
    }
    expect(source).not.toMatch(/COPY\s+--from=swift-toolchain\s+\/usr\s+\/usr/u)
    assert.ok(finalAptInstall)
    expect(finalAptInstall.match(/\blib(?:ncurses|xml2)[A-Za-z0-9.+-]*/gu) ?? []).toEqual(["libncurses6", "libxml2-dev"])
    expect(runs).toContain("swiftc --version")
    expect(runs).toContain("Swift version 6.3.3 (swift-6.3.3-RELEASE)")
    expect(runs).toContain("x86_64-unknown-linux-gnu")
  })
})
