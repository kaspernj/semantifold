// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"

describe("Go backend validation", () => {
  it("returns the deterministic manifest-first Go module artifact shape", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifactSet({language: "go", module})

    expect({
      entry: generated.entry,
      paths: generated.artifacts.map(({path}) => path),
      roles: generated.artifacts.map(({role}) => role),
      target: generated.target
    }).toEqual({entry: "main.go", paths: ["go.mod", "main.go"], roles: ["manifest", "entry"], target: "go"})
  })
})
