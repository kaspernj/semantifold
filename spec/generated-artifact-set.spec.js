// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {decodedMappings, encodedMappings, presortedDecodedMap, TraceMap} from "@jridgewell/trace-mapping"
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

  it("deeply detaches and freezes synthetic related origins and location points", () => {
    const relatedOrigin = {
      location: {
        end: {column: 5, line: 1, offset: 4},
        filename: "source.ts",
        start: {column: 1, line: 1, offset: 0}
      },
      nodeId: "node:0",
      role: "generated support",
      sourceId: "source:0",
      symbolId: "symbol:0"
    }
    const set = createGeneratedArtifactSet({
      artifacts: [{
        content: "support\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "support.txt",
        provenance: {kind: "synthetic", reason: "generated support", relatedOrigins: [relatedOrigin]},
        role: "entry"
      }],
      target: "demo"
    })
    const provenance = set.artifacts[0].provenance

    assert.equal(provenance.kind, "synthetic")
    const [returnedOrigin] = provenance.relatedOrigins

    relatedOrigin.location.start.offset = 3
    relatedOrigin.sourceId = "caller-mutated"
    expect(returnedOrigin.location.start.offset).toEqual(0)
    expect(returnedOrigin.sourceId).toEqual("source:0")
    expect(Object.isFrozen(returnedOrigin)).toBeTrue()
    expect(Object.isFrozen(returnedOrigin.location)).toBeTrue()
    expect(Object.isFrozen(returnedOrigin.location.start)).toBeTrue()
    expect(Object.isFrozen(returnedOrigin.location.end)).toBeTrue()
    assert.throws(() => {
      returnedOrigin.location.start.offset = 3
    }, TypeError)
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

  it("rejects malformed encoded Source Map segments and out-of-range source or name references", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifact({filename: "program.js", language: "javascript", module})

    expect(generated.sourceMap.sources.length).toEqual(1)
    assert.ok(generated.sourceMap.names.length > 0)
    const invalidSourceMaps = [
      {...generated.sourceMap, mappings: "!"},
      {...generated.sourceMap, mappings: "AA"},
      {...generated.sourceMap, mappings: "ACAA"},
      {...generated.sourceMap, names: []}
    ]

    for (const sourceMap of invalidSourceMaps) {
      expectInvalid(() => createGeneratedArtifactSet({
        artifacts: [{
          content: generated.code,
          contentKind: "text",
          mediaType: "text/javascript",
          ownership: "generated",
          path: generated.filename,
          provenance: {
            kind: "text",
            mapping: generated.mapping,
            sourceMap,
            sourceMapFilename: generated.sourceMapFilename
          },
          role: "entry"
        }],
        target: "javascript"
      }))
    }
  })

  it("rejects sparse artifact, related-origin, and Source Map metadata arrays", async () => {
    const valid = {
      content: "ok\n",
      contentKind: "text",
      mediaType: "text/plain",
      ownership: "generated",
      path: "program.txt",
      provenance: synthetic(),
      role: "entry"
    }
    const sparseArtifacts = [valid, valid]
    const sparseRelatedOrigins = [{
      location: {
        end: {column: 2, line: 1, offset: 1},
        filename: "source.ts",
        start: {column: 1, line: 1, offset: 0}
      },
      sourceId: "source:0"
    }]

    Reflect.deleteProperty(sparseArtifacts, "0")
    Reflect.deleteProperty(sparseRelatedOrigins, "0")

    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifact({filename: "program.js", language: "javascript", module})
    const sparseNames = [...generated.sourceMap.names]
    const sparseSources = [...generated.sourceMap.sources]
    const sparseSourcesContent = [...generated.sourceMap.sourcesContent]

    Reflect.deleteProperty(sparseNames, "0")
    Reflect.deleteProperty(sparseSources, "0")
    Reflect.deleteProperty(sparseSourcesContent, "0")

    const candidates = [
      {artifacts: sparseArtifacts, target: "demo"},
      {artifacts: [{...valid, provenance: {kind: "synthetic", reason: "support", relatedOrigins: sparseRelatedOrigins}}], target: "demo"},
      {artifacts: [textArtifact(generated, {...generated.sourceMap, names: sparseNames})], target: "javascript"},
      {artifacts: [textArtifact(generated, {...generated.sourceMap, sources: sparseSources})], target: "javascript"},
      {artifacts: [textArtifact(generated, {...generated.sourceMap, sourcesContent: sparseSourcesContent})], target: "javascript"}
    ]
    /** @type {number[]} */
    const accepted = []

    for (const [index, candidate] of candidates.entries()) {
      try {
        createGeneratedArtifactSet(candidate)
        accepted.push(index)
      } catch (error) {
        assert.ok(error instanceof SemantifoldDiagnostic)
        expect(error.code).toEqual("INVALID_ARTIFACT_SET")
        if (index >= 2) expect(error.detail).toEqual("Text artifact 'program.js' has malformed Source Map v3 provenance.")
      }
    }

    expect(accepted).toEqual([])
  })

  it("requires Source Map v3 provenance to match the rich projection including an unmapped directive suffix", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifact({
      filename: "program.js",
      language: "javascript",
      mapDirective: "external",
      module
    })
    const valid = textArtifact(generated, generated.sourceMap)

    expect(createGeneratedArtifactSet({artifacts: [valid], target: "javascript"}).entry).toEqual("program.js")

    const generatedPosition = mutateSourceMap(generated.sourceMap, (lines) => {
      firstMappedSegment(lines)[0] -= 1
    })
    const originalPosition = mutateSourceMap(generated.sourceMap, (lines) => {
      firstMappedSegment(lines)[3] -= 1
    })
    const alternateSource = {
      ...generated.sourceMap,
      sources: [...generated.sourceMap.sources, "alternate.ts"],
      sourcesContent: [...generated.sourceMap.sourcesContent, source]
    }
    const sourceIndex = mutateSourceMap(alternateSource, (lines) => {
      firstMappedSegment(lines)[1] = 1
    })
    const alternateName = {...generated.sourceMap, names: [...generated.sourceMap.names, "alternate"]}
    const nameIndex = mutateSourceMap(alternateName, (lines) => {
      firstNamedSegment(lines)[4] = alternateName.names.length - 1
    })

    for (const sourceMap of [generatedPosition, originalPosition, sourceIndex, nameIndex]) {
      expectInvalid(() => createGeneratedArtifactSet({
        artifacts: [textArtifact(generated, sourceMap)],
        target: "javascript"
      }))
    }
  })

  it("rejects present malformed optional Source Map filename metadata", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifact({filename: "program.js", language: "javascript", module})
    const valid = textArtifact(generated, generated.sourceMap)
    const {sourceMapFilename: _sourceMapFilename, ...provenanceWithoutFilename} = valid.provenance

    expect(createGeneratedArtifactSet({
      artifacts: [{...valid, provenance: provenanceWithoutFilename}],
      target: "javascript"
    }).entry).toEqual("program.js")

    for (const sourceMapFilename of ["", "map\nfile", null, {}, Symbol("map")]) {
      assert.throws(
        () => createGeneratedArtifactSet({
          artifacts: [{...valid, provenance: {...valid.provenance, sourceMapFilename}}],
          target: "javascript"
        }),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_ARTIFACT_SET" &&
          error.detail == "Text artifact 'program.js' has invalid Source Map filename metadata."
      )
    }
  })

  it("validates optional Source Map metadata before projection comparison", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifact({filename: "program.js", language: "javascript", module})

    assert.throws(
      () => createGeneratedArtifactSet({
        artifacts: [textArtifact(generated, {...generated.sourceMap, sourcesContent: null})],
        target: "javascript"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_ARTIFACT_SET" &&
        error.detail == "Text artifact 'program.js' has malformed Source Map v3 provenance."
    )
  })

  it("treats only undefined artifact related-origin identities as omitted", () => {
    const location = {
      end: {column: 2, line: 1, offset: 1},
      filename: "source.ts",
      start: {column: 1, line: 1, offset: 0}
    }
    const valid = {
      content: "support\n",
      contentKind: "text",
      mediaType: "text/plain",
      ownership: "generated",
      path: "support.txt",
      role: "entry"
    }

    for (const property of ["nodeId", "symbolId", "role"]) {
      for (const value of [null, {}, Symbol(property)]) {
        expectInvalid(() => createGeneratedArtifactSet({
          artifacts: [{
            ...valid,
            provenance: {
              kind: "synthetic",
              reason: "support",
              relatedOrigins: [{location, sourceId: "source:0", [property]: value}]
            }
          }],
          target: "demo"
        }))
      }
    }
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

  it("normalizes malformed artifact backend roles without coercing caller values", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const malformedRoles = [Symbol("binary"), "archive", null, 1, {}, []]

    for (const role of malformedRoles) {
      assert.throws(
        // @ts-expect-error Deliberately malformed public artifact role.
        () => generateArtifactSet({language: "typescript", module, role}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_ARTIFACT_SET" &&
          error.language == "typescript" &&
          error.detail == "Artifact backend role must be 'text', 'binary', or 'application'."
      )
    }
  })

  it("normalizes malformed artifact target IDs without coercing caller values", async () => {
    const source = await readFile(new URL("fixtures/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const malformedLanguages = [Symbol("typescript"), "", null, 1, {}, [], new String("typescript")]

    for (const language of malformedLanguages) {
      assert.throws(
        // @ts-expect-error Deliberately malformed public artifact target ID.
        () => generateArtifactSet({language, module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_ARTIFACT_SET" &&
          error.language == "artifact" && error.detail == "Artifact-set generation requires a non-empty string language or target ID."
      )
    }
    assert.throws(
      () => generateArtifactSet({language: "unknown", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" && error.language == "unknown"
    )
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

/**
 * Builds one generated text artifact around a selected Source Map.
 * @param {ReturnType<typeof generateArtifact>} generated - Generated source and rich mapping.
 * @param {import("@jridgewell/gen-mapping").EncodedSourceMap} sourceMap - Selected interoperable mapping.
 * @returns {object} Artifact-set input record.
 */
function textArtifact(generated, sourceMap) {
  return {
    content: generated.code,
    contentKind: "text",
    mediaType: "text/javascript",
    ownership: "generated",
    path: generated.filename,
    provenance: {
      kind: "text",
      mapping: generated.mapping,
      sourceMap,
      sourceMapFilename: generated.sourceMapFilename
    },
    role: "entry"
  }
}

/**
 * Applies one controlled decoded-segment mutation and canonically re-encodes it.
 * @param {import("@jridgewell/gen-mapping").EncodedSourceMap} sourceMap - Valid base map.
 * @param {(lines: import("@jridgewell/trace-mapping").SourceMapSegment[][]) => void} mutation - Segment mutation.
 * @returns {import("@jridgewell/gen-mapping").EncodedSourceMap} Canonically encoded contradictory map.
 */
function mutateSourceMap(sourceMap, mutation) {
  const lines = /** @type {import("@jridgewell/trace-mapping").SourceMapSegment[][]} */ (
    structuredClone(decodedMappings(new TraceMap(sourceMap))))

  mutation(lines)

  return {
    ...sourceMap,
    mappings: encodedMappings(presortedDecodedMap({...sourceMap, mappings: lines}))
  }
}

/**
 * Selects a mapped segment with space to alter its generated column safely.
 * @param {import("@jridgewell/trace-mapping").SourceMapSegment[][]} lines - Decoded lines.
 * @returns {import("@jridgewell/trace-mapping").SourceMapSegment} Mutable mapped segment.
 */
function firstMappedSegment(lines) {
  const segment = lines.flat().find((candidate) => candidate.length >= 4 && candidate[0] > 0 && candidate[3] > 0)

  assert.ok(segment)

  return segment
}

/**
 * Selects the first mapped segment carrying a name index.
 * @param {import("@jridgewell/trace-mapping").SourceMapSegment[][]} lines - Decoded lines.
 * @returns {import("@jridgewell/trace-mapping").SourceMapSegment} Mutable named segment.
 */
function firstNamedSegment(lines) {
  const segment = lines.flat().find((candidate) => candidate.length == 5)

  assert.ok(segment)

  return segment
}
