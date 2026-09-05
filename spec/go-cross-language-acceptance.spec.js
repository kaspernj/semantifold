// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generateArtifactSet, parse, runAcceptanceStages} from "../index.js"

describe("Go cross-language native acceptance", () => {
  it("builds, vets, and executes one original-five source through the native Go backend", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const artifacts = generateArtifactSet({language: "go", module})
    const go = await discoverCanonicalToolchain(/** @type {any} */ ("go"))
    const result = await runAcceptanceStages({
      artifacts,
      environment: {CGO_ENABLED: "0", GOPROXY: "off", GOTOOLCHAIN: "local", PATH: process.env.PATH},
      stages: [
        {
          arguments: ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", "semantifold-go", "."],
          stage: "compile",
          tool: go
        },
        {arguments: ["vet", "-mod=readonly", "."], stage: "validate", tool: go},
        {arguments: ["run", "-mod=readonly", "-trimpath", "-buildvcs=false", "."], stage: "execute", tool: go}
      ],
      target: "go",
      timeoutMs: 30_000
    })

    expect(result.stages.map(({stage}) => stage)).toEqual(["compile", "validate", "execute"])
    expect(result.stages.at(-1)?.stdout).toEqual("5\n")
  })
})
