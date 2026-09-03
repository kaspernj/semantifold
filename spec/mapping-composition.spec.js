// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, it} from "@velocious/testing"
import {TraceMap, originalPositionFor as traceOriginalPositionFor} from "@jridgewell/trace-mapping"
import {
  composeMappings,
  composeSourceMaps,
  generateArtifact,
  mappingFromSourceMap,
  originalPositionFor,
  parse,
  remapDiagnostic,
  SemantifoldDiagnostic
} from "../index.js"

const execFileAsync = promisify(execFile)

describe("mapping composition and diagnostic remapping", () => {
  it("composes real tsc JavaScript through generated TypeScript to the original source", async () => {
    const source = await readFile(new URL("fixtures/locals/program.rb", import.meta.url), "utf8")
    const module = parse({filename: "original.rb", language: "ruby", source})
    const intermediate = generateArtifact({filename: "intermediate.ts", language: "typescript", module})
    const directory = await mkdtemp(path.join(tmpdir(), "semantifold-tsc-map-"))

    try {
      const typescriptFilename = path.join(directory, "intermediate.ts")
      const compiler = path.resolve("node_modules/.bin/tsc")

      await writeFile(typescriptFilename, intermediate.code)
      await execFileAsync(compiler, [typescriptFilename, "--ignoreConfig", "--target", "ES2024", "--module", "nodenext", "--sourceMap", "--inlineSources"])

      const javascript = await readFile(path.join(directory, "intermediate.js"), "utf8")
      const tscMap = JSON.parse(await readFile(path.join(directory, "intermediate.js.map"), "utf8"))
      const composedV3 = composeSourceMaps(tscMap, intermediate.sourceMap)
      const functionOffset = javascript.indexOf("select")
      const beforeFunction = javascript.slice(0, functionOffset)
      const traced = traceOriginalPositionFor(new TraceMap(composedV3), {
        column: beforeFunction.length - beforeFunction.lastIndexOf("\n") - 1,
        line: beforeFunction.split("\n").length
      })

      assert.equal(traced.source, "original.rb")
      assert.equal(traced.name, "select")

      const outer = mappingFromSourceMap(tscMap, {
        content: javascript,
        filename: "intermediate.js",
        language: "javascript",
        sources: [{content: intermediate.code, filename: "intermediate.ts", language: "typescript"}]
      })
      const composedRich = composeMappings(outer, intermediate.mapping)
      const rich = originalPositionFor(composedRich, {offset: functionOffset})

      assert.equal(rich.location.filename, "original.rb")
      assert.equal(rich.name, "select")
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("remaps diagnostics while retaining their generated location", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const artifact = generateArtifact({filename: "program.php", language: "php", module})
    const generatedOffset = artifact.code.lastIndexOf("difference")
    const generatedLocation = artifact.mapping.spans.find((span) => span.generated.start.offset == generatedOffset).generated
    const diagnostic = new SemantifoldDiagnostic({
      code: "RUNTIME_ERROR",
      language: "php",
      location: generatedLocation,
      message: "Generated call failed."
    })
    const remapped = remapDiagnostic(diagnostic, artifact.mapping)

    assert.equal(remapped.location.filename, "program.ts")
    assert.deepEqual(remapped.generatedLocation, generatedLocation)
    assert.equal(remapped.code, diagnostic.code)
    assert.equal(remapped.cause, diagnostic)
  })
})
