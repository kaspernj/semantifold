// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {createByteMapping, parseByteMapping, SemantifoldDiagnostic, stringifyByteMapping} from "../index.js"

const synthetic = (reason) => ({kind: "synthetic", reason, relatedOrigins: []})

describe("binary and resource provenance", () => {
  it("retains ordered non-overlapping half-open byte ranges without text coordinates", () => {
    const mapping = createByteMapping({
      byteLength: 8,
      path: "module.wasm",
      ranges: [
        {generated: {end: 4, start: 0}, origin: synthetic("binary magic and version")},
        {generated: {end: 8, start: 4}, nodeId: "node:0", origin: synthetic("encoded entry body"), role: "body"}
      ]
    })

    expect(mapping.schema).toEqual("SemantifoldByteMapping")
    expect(mapping.version).toEqual(1)
    expect(mapping.coordinateSystem).toEqual("bytes")
    expect(mapping.generated).toEqual({byteLength: 8, path: "module.wasm"})
    expect(Object.isFrozen(mapping)).toBeTrue()
    expect(Object.isFrozen(mapping.ranges)).toBeTrue()
    assert.equal("line" in mapping.ranges[0].generated, false)
    assert.equal(stringifyByteMapping(parseByteMapping(stringifyByteMapping(mapping))), stringifyByteMapping(mapping))
  })

  it("accepts source-derived byte ranges while requiring explicit synthetic reasons", () => {
    const location = {
      end: {column: 5, line: 1, offset: 4},
      filename: "input.ts",
      start: {column: 1, line: 1, offset: 0}
    }
    const mapping = createByteMapping({
      byteLength: 3,
      path: "resource.bin",
      ranges: [{
        generated: {end: 3, start: 0},
        origin: {kind: "source", location, sourceId: "source:0"},
        symbolId: "symbol:0"
      }]
    })

    expect(mapping.ranges[0].origin.kind).toEqual("source")
    expect(mapping.ranges[0].generated).toEqual({end: 3, start: 0})

    expectInvalid(() => createByteMapping({
      byteLength: 1,
      path: "bad.bin",
      ranges: [{generated: {end: 1, start: 0}, origin: {kind: "synthetic", reason: "", relatedOrigins: []}}]
    }))
  })

  it("normalizes malformed, out-of-order, overlapping, and out-of-bounds mappings", () => {
    const base = {byteLength: 4, path: "module.bin"}
    const invalidRanges = [
      [{generated: {end: 1.5, start: 0}, origin: synthetic("fractional")}],
      [{generated: {end: 0, start: 0}, origin: synthetic("empty")}],
      [{generated: {end: 5, start: 0}, origin: synthetic("outside")}],
      [
        {generated: {end: 3, start: 1}, origin: synthetic("first")},
        {generated: {end: 2, start: 0}, origin: synthetic("out of order")}
      ],
      [
        {generated: {end: 3, start: 0}, origin: synthetic("first")},
        {generated: {end: 4, start: 2}, origin: synthetic("overlap")}
      ]
    ]

    for (const ranges of invalidRanges) expectInvalid(() => createByteMapping({...base, ranges}))
    expectInvalid(() => createByteMapping({...base, path: "../module.bin", ranges: []}))
    expectInvalid(() => parseByteMapping("not json"))
    expectInvalid(() => parseByteMapping('{"schema":"SemantifoldByteMapping","version":2}'))
    // @ts-expect-error Deliberately malformed public input.
    expectInvalid(() => createByteMapping(undefined))
  })

  it("rejects sparse byte-range and provenance-origin arrays", () => {
    const location = {
      end: {column: 2, line: 1, offset: 1},
      filename: "source.ts",
      start: {column: 1, line: 1, offset: 0}
    }
    const related = {location, sourceId: "source:0"}
    const range = {generated: {end: 1, start: 0}, origin: synthetic("byte")}
    const sparseRanges = [range]
    const sparseRelatedOrigins = [related]
    const sparseDerivedOrigins = [related]

    Reflect.deleteProperty(sparseRanges, "0")
    Reflect.deleteProperty(sparseRelatedOrigins, "0")
    Reflect.deleteProperty(sparseDerivedOrigins, "0")

    const candidates = [
      {byteLength: 1, path: "ranges.bin", ranges: sparseRanges},
      {
        byteLength: 1,
        path: "synthetic.bin",
        ranges: [{generated: {end: 1, start: 0}, origin: {kind: "synthetic", reason: "byte", relatedOrigins: sparseRelatedOrigins}}]
      },
      {
        byteLength: 1,
        path: "derived.bin",
        ranges: [{generated: {end: 1, start: 0}, origin: {kind: "derived", origins: sparseDerivedOrigins}}]
      }
    ]
    /** @type {number[]} */
    const accepted = []

    for (const [index, candidate] of candidates.entries()) {
      try {
        createByteMapping(candidate)
        accepted.push(index)
      } catch (error) {
        assert.ok(error instanceof SemantifoldDiagnostic)
        expect(error.code).toEqual("INVALID_BYTE_MAPPING")
      }
    }

    expect(accepted).toEqual([])
  })
})

/**
 * Requires a normalized binary-mapping diagnostic.
 * @param {() => unknown} callback - Invalid operation.
 * @returns {void}
 */
function expectInvalid(callback) {
  assert.throws(callback, (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_BYTE_MAPPING")
}
