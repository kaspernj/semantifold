// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  generate,
  generateArtifact,
  generateArtifactSet,
  parse,
  SemantifoldDiagnostic
} from "../index.js"

const synthetic = (reason = "test scaffolding") => ({kind: "synthetic", reason, relatedOrigins: []})

describe("generated artifact sets", () => {
  it("wraps every original single-text target without changing its bytes or rich mappings", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const set = generateArtifactSet({language, module})
      const repeated = generateArtifactSet({language, module})
      const legacy = generateArtifact({language, module})
      const [artifact] = set.artifacts

      assert.deepEqual(set, repeated)
      expect(set.schema).toEqual("GeneratedArtifactSet")
      expect(set.version).toEqual(1)
      expect(set.target).toEqual(language)
      expect(set.entry).toEqual(artifact.path)
      expect(set.artifacts.length).toEqual(1)
      expect(artifact.contentKind).toEqual("text")
      expect(artifact.content).toEqual(generate({language, module}))
      expect(artifact.content).toEqual(legacy.code)
      expect(artifact.role).toEqual("entry")
      expect(artifact.ownership).toEqual("generated")
      expect(artifact.provenance.kind).toEqual("text")
      assert.deepEqual(artifact.provenance.mapping, legacy.mapping)
      assert.deepEqual(artifact.provenance.sourceMap, legacy.sourceMap)
    }
  })

  it("represents deterministic multi-file text, binary, and mixed loader artifacts for one module", () => {
    const wasm = new Uint8Array([0, 97, 115, 109])
    const set = createGeneratedArtifactSet({
      artifacts: [
        {
          content: "export const ready = true\n",
          contentKind: "text",
          mediaType: "text/javascript",
          ownership: "generated",
          path: "loader/program.js",
          provenance: synthetic("generated browser loader"),
          role: "loader"
        },
        {
          content: wasm,
          contentKind: "binary",
          mediaType: "application/wasm",
          ownership: "generated",
          path: "program.wasm",
          provenance: {
            kind: "bytes",
            mapping: {
              coordinateSystem: "bytes",
              generated: {byteLength: 4, path: "program.wasm"},
              ranges: [{
                generated: {end: 4, start: 0},
                origin: synthetic("WebAssembly header")
              }],
              schema: "SemantifoldByteMapping",
              version: 1
            }
          },
          role: "entry"
        },
        {
          content: "{\"private\":true}\n",
          contentKind: "text",
          mediaType: "application/json",
          ownership: "generated",
          path: "package.json",
          provenance: synthetic("generated package manifest"),
          role: "manifest"
        }
      ],
      target: "browser-wasm"
    })

    expect(set.artifacts.map(({path}) => path)).toEqual(["loader/program.js", "program.wasm", "package.json"])
    expect(set.entry).toEqual("program.wasm")
    assert.deepEqual(set.artifacts[1].content, wasm)
    expect(Object.isFrozen(set)).toBeTrue()
    expect(Object.isFrozen(set.artifacts)).toBeTrue()
  })

  it("keeps validated binary bytes immutable through the public artifact boundary", () => {
    const set = createGeneratedArtifactSet({
      artifacts: [{
        content: new Uint8Array([0, 97, 115, 109]),
        contentKind: "binary",
        mediaType: "application/wasm",
        ownership: "generated",
        path: "program.wasm",
        provenance: {
          kind: "bytes",
          mapping: {
            coordinateSystem: "bytes",
            generated: {byteLength: 4, path: "program.wasm"},
            ranges: [{generated: {end: 4, start: 0}, origin: synthetic("WebAssembly header")}],
            schema: "SemantifoldByteMapping",
            version: 1
          }
        },
        role: "entry"
      }],
      target: "browser-wasm"
    })
    const firstRead = set.artifacts[0].content

    assert.ok(firstRead instanceof Uint8Array)
    firstRead[0] = 255

    const secondRead = set.artifacts[0].content

    assert.ok(secondRead instanceof Uint8Array)
    assert.notStrictEqual(secondRead, firstRead)
    assert.deepEqual(secondRead, new Uint8Array([0, 97, 115, 109]))
    expect(set.artifacts[0].provenance.kind).toEqual("bytes")
  })

  it("includes the serialized sidecar referenced by an external map directive", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const legacy = generateArtifact({
      filename: "dist/program.js",
      language: "javascript",
      mapDirective: "external",
      module,
      sourceMapFilename: "maps/program.js.map"
    })
    const set = generateArtifactSet({
      filename: "dist/program.js",
      language: "javascript",
      mapDirective: "external",
      module,
      sourceMapFilename: "maps/program.js.map"
    })
    const repeated = generateArtifactSet({
      filename: "dist/program.js",
      language: "javascript",
      mapDirective: "external",
      module,
      sourceMapFilename: "maps/program.js.map"
    })
    const [entry, mapping] = set.artifacts

    assert.deepEqual(set, repeated)
    expect(set.entry).toEqual("dist/program.js")
    expect(set.artifacts.map(({path}) => path)).toEqual(["dist/program.js", "maps/program.js.map"])
    expect(entry.content).toEqual(legacy.code)
    assert.ok(typeof entry.content == "string")
    expect(entry.content.endsWith("//# sourceMappingURL=../maps/program.js.map\n")).toBeTrue()
    expect(mapping.contentKind).toEqual("text")
    expect(mapping.mediaType).toEqual("application/json")
    expect(mapping.role).toEqual("mapping")
    expect(mapping.content).toEqual(`${JSON.stringify(legacy.sourceMap)}\n`)
    assert.deepEqual(JSON.parse(/** @type {string} */ (mapping.content)), JSON.parse(JSON.stringify(legacy.sourceMap)))
    expect(mapping.provenance.kind).toEqual("synthetic")
  })

  it("rejects unsafe paths, duplicates, malformed content, ownership, and entry declarations transactionally", () => {
    const valid = {
      content: "ok\n",
      contentKind: "text",
      mediaType: "text/plain",
      ownership: "generated",
      path: "src/program.txt",
      provenance: synthetic(),
      role: "entry"
    }
    const invalidSets = [
      {...valid, path: ""},
      {...valid, path: "/tmp/program.txt"},
      {...valid, path: "C:/program.txt"},
      {...valid, path: "../program.txt"},
      {...valid, path: "src/../program.txt"},
      {...valid, path: "src\\program.txt"},
      {...valid, path: "src//program.txt"},
      {...valid, content: ""},
      {...valid, content: new Uint8Array([1])},
      {...valid, mediaType: "text/plain\nunsafe"},
      {...valid, ownership: "caller"},
      {...valid, role: "unknown"}
    ]

    for (const artifact of invalidSets) expectInvalid(() => createGeneratedArtifactSet({artifacts: [artifact], target: "demo"}))
    expectInvalid(() => createGeneratedArtifactSet({artifacts: [], target: "demo"}))
    expectInvalid(() => createGeneratedArtifactSet({artifacts: [{...valid, role: "source"}], target: "demo"}))
    expectInvalid(() => createGeneratedArtifactSet({artifacts: [valid, {...valid, path: "other.txt"}], target: "demo"}))
    expectInvalid(() => createGeneratedArtifactSet({artifacts: [valid, {...valid, role: "support"}], target: "demo"}))
    for (const artifacts of [
      [{...valid, path: "program"}, {...valid, path: "program/data.bin", role: "support"}],
      [{...valid, path: "program/data.bin", role: "support"}, {...valid, path: "program"}]
    ]) {
      expectInvalid(() => createGeneratedArtifactSet({artifacts, target: "demo"}))
    }
    expectInvalid(() => createGeneratedArtifactSet({artifacts: [{
      ...valid,
      provenance: {
        kind: "text",
        mapping: {generated: {content: "ok\n", filename: "src/program.txt"}, schema: "SemantifoldMapping"},
        sourceMap: {}
      }
    }], target: "demo"}))
    // @ts-expect-error Deliberately malformed public generation input.
    expectInvalid(() => generateArtifactSet(undefined))
  })

  it("requires the artifact-set API for unavailable binary and application roles", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const role of ["binary", "application"]) {
      assert.throws(
        () => generateArtifactSet({language: "typescript", module, role}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "typescript"
      )
    }
  })
})

/**
 * Requires a normalized artifact diagnostic.
 * @param {() => unknown} callback - Invalid construction.
 * @returns {void}
 */
function expectInvalid(callback) {
  assert.throws(callback, (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_ARTIFACT_SET")
}
