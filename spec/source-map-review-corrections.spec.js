// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {originalPositionFor as traceOriginalPositionFor, TraceMap} from "@jridgewell/trace-mapping"
import {
  composeMappings,
  generateArtifact,
  generatedPositionFor,
  getNodeProvenance,
  mappingFromSourceMap,
  originalPositionFor,
  parse
} from "../index.js"

const execFileAsync = promisify(execFile)
const baseSource = `function difference(left: number, right: number): number {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(difference(4, 9))
`

describe("reviewed source-map corrections", () => {
  it("keeps caller-owned semantic locations mutable after freezing generated mappings", () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})
    const declaration = module.functions[0]
    const provenance = declaration.sourceProvenance

    assert.equal(provenance.origin.kind, "source")
    const locations = [declaration.location, provenance.origin.location, provenance.ranges.name]
    const artifact = generateArtifact({language: "javascript", module})
    const mappedDeclaration = artifact.mapping.nodes.find((node) => node.path == "/functions/0")

    expect(locations.flatMap((location) => [location, location.start, location.end]).map(Object.isFrozen))
      .toEqual(Array(9).fill(false))
    const mappedStart = mappedDeclaration.ranges.name.start.offset

    provenance.ranges.name.start.offset++
    expect(provenance.ranges.name.start.offset).toEqual(mappedStart + 1)
    expect(mappedDeclaration.ranges.name.start.offset).toEqual(mappedStart)
  })

  it("emits an external map URL relative to a nested generated artifact", () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})
    const artifact = generateArtifact({filename: "dist/program.js", language: "javascript", mapDirective: "external", module})
    const directive = artifact.code.match(/\/\/# sourceMappingURL=(.+)\n$/u)

    expect(artifact.sourceMapFilename).toEqual("dist/program.js.map")
    assert.ok(directive)
    expect(directive[1]).toEqual("program.js.map")
    expect(new URL(directive[1], "https://example.invalid/dist/program.js").pathname).toEqual("/dist/program.js.map")
  })

  it("rejects every ECMAScript line terminator in external map names and executes normal directives", async () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})

    for (const terminator of ["\u2028", "\u2029"]) {
      assert.throws(() => generateArtifact({
        filename: "program.js",
        language: "javascript",
        mapDirective: "external",
        module,
        sourceMapFilename: `safe.map${terminator}globalThis.injected=true`
      }), /single-line/u)

      const artifact = generateArtifact({
        filename: "program.js",
        language: "javascript",
        mapDirective: "external",
        module,
        sourceMapFilename: "program.js.map"
      })
      const directory = await mkdtemp(path.join(tmpdir(), "semantifold-directive-"))

      try {
        const filename = path.join(directory, artifact.filename)

        await writeFile(filename, artifact.code)
        assert.equal((await execFileAsync(process.execPath, [filename])).stdout, "5\n")
      } finally {
        await rm(directory, {force: true, recursive: true})
      }
    }
  })

  it("keeps imported V3 unmapped lines and prefixes synthetic like TraceMap", () => {
    const lineMap = {file: "out.js", mappings: "AAAA;", names: [], sources: ["in.js"], sourcesContent: ["x"], version: 3}
    const lineTrace = new TraceMap(lineMap)
    const importedLine = mappingFromSourceMap(lineMap, {content: "a\nb", filename: "out.js", language: "javascript"})
    const traceLineTwo = traceOriginalPositionFor(lineTrace, {column: 0, line: 2})
    const richLineTwo = originalPositionFor(importedLine, {line: 2, column: 1})

    assert.equal(traceLineTwo.source, null)
    assert.equal(richLineTwo.location, undefined)
    assert.equal(richLineTwo.mappingKind, "synthetic")

    const prefixMap = {file: "prefix.js", mappings: "CAAA", names: [], sources: ["in.js"], sourcesContent: ["x"], version: 3}
    const prefixTrace = new TraceMap(prefixMap)
    const importedPrefix = mappingFromSourceMap(prefixMap, {content: "za", filename: "prefix.js", language: "javascript"})

    assert.equal(traceOriginalPositionFor(prefixTrace, {column: 0, line: 1}).source, null)
    assert.equal(originalPositionFor(importedPrefix, {offset: 0}).location, undefined)
    assert.equal(traceOriginalPositionFor(prefixTrace, {column: 1, line: 1}).source, "in.js")
    assert.equal(originalPositionFor(importedPrefix, {offset: 1}).location.filename, "in.js")
  })

  it("uses canonical CRLF positions in rich forward and reverse lookups", () => {
    const source = `\r\n${baseSource}`
    const module = parse({filename: "crlf.ts", language: "typescript", source})
    const artifact = generateArtifact({language: "javascript", module})
    const forward = originalPositionFor(artifact.mapping, {offset: 0})
    const reverse = generatedPositionFor(artifact.mapping, {filename: "crlf.ts", line: 2, column: 1})

    assert.equal(forward.location.start.offset, 2)
    assert.equal(forward.location.start.line, 2)
    assert.equal(forward.location.start.column, 1)
    assert.ok(reverse.some((result) => result.generatedLocation.start.offset == 0))
  })

  it("rejects Java artifact filenames that cannot compile their public Main class", async () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})
    const artifact = generateArtifact({filename: "generated/Main.java", language: "java", module})
    const directory = await mkdtemp(path.join(tmpdir(), "semantifold-java-filename-"))

    assert.equal(artifact.filename, "generated/Main.java")
    assert.throws(() => generateArtifact({filename: "Program.java", language: "java", module}), /Main\.java/u)
    try {
      const advertisedFilename = path.join(directory, artifact.filename)

      await mkdir(path.dirname(advertisedFilename), {recursive: true})
      await writeFile(advertisedFilename, artifact.code)
      await execFileAsync("javac", [artifact.filename], {cwd: directory})
      assert.equal((await execFileAsync("java", ["-cp", path.dirname(advertisedFilename), "Main"])).stdout, "5\n")
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("uses Babel token offsets for escaped JavaScript and TypeScript identifiers", () => {
    for (const language of ["javascript", "typescript"]) {
      const typedFlag = language == "typescript" ? ": boolean" : ""
      const typedFallback = language == "typescript" ? ": string" : ""
      const typedReturn = language == "typescript" ? ": string" : ""
      const docs = language == "javascript" ? `/**
 * @param {boolean} flag
 * @param {string} fallback
 * @returns {string}
 */
` : ""
      const source = `${docs}function ch\\u006fose(fl\\u0061g${typedFlag}, fallback${typedFallback})${typedReturn} {
  if (fl\\u0061g) {
    return fallback
  } else {
    return fallback
  }
}

console.log(ch\\u006fose(true, "no"))
`
      const module = parse({filename: `escaped.${language == "typescript" ? "ts" : "js"}`, language, source})
      const declaration = module.functions[0]
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body[0])
      const condition = branch.condition
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body[0].expression)
      const artifact = generateArtifact({language: "ruby", module})

      assert.equal(slice(source, getNodeProvenance(module, declaration).ranges.name), "ch\\u006fose")
      assert.equal(slice(source, getNodeProvenance(module, declaration.parameters[0]).ranges.name), "fl\\u0061g")
      assert.equal(slice(source, getNodeProvenance(module, condition).ranges.name), "fl\\u0061g")
      assert.equal(slice(source, getNodeProvenance(module, call).ranges.callee), "ch\\u006fose")
      assert.ok(artifact.mapping.spans.some((span) => span.name == "choose" && span.role == "name" &&
        slice(source, span.origin.location) == "ch\\u006fose"))
      assert.ok(artifact.mapping.spans.some((span) => span.name == "choose" && span.role == "callee" &&
        slice(source, span.origin.location) == "ch\\u006fose"))
    }
  })

  it("does not trace an unrelated same-named source through an intermediate mapping", () => {
    const inner = mappingFromSourceMap({
      file: "middle.js",
      mappings: "AAAA",
      names: [],
      sources: ["original.js"],
      sourcesContent: ["xy"],
      version: 3
    }, {content: "ab", filename: "middle.js", language: "javascript"})
    const outer = structuredClone(mappingFromSourceMap({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["middle.js"],
      sourcesContent: ["ab"],
      version: 3
    }, {content: "Z", filename: "final.js", language: "javascript"}))
    const outerOrigin = outer.spans[0].origin

    outer.sources.push({content: "zz", filename: "middle.js", id: "source:1", language: "javascript"})
    assert.equal(outerOrigin.kind, "source")
    outerOrigin.sourceId = "source:1"
    const composed = composeMappings(outer, inner)
    const composedOrigin = composed.spans[0].origin

    assert.equal(composedOrigin.kind, "source")
    expect(composedOrigin.sourceId).toEqual("source:1")
    expect(composed.sources.find((source) => source.id == composedOrigin.sourceId)?.content).toEqual("zz")
    expect(originalPositionFor(composed, {offset: 0}).location.filename).toEqual("middle.js")
  })

  it("anchors an exact outer subrange that cannot adopt a whole exact inner origin", () => {
    const inner = structuredClone(mappingFromSourceMap({
      file: "middle.js",
      mappings: "AAAA",
      names: [],
      sources: ["original.js"],
      sourcesContent: ["xy"],
      version: 3
    }, {content: "ab", filename: "middle.js", language: "javascript"}))
    const outer = structuredClone(mappingFromSourceMap({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["middle.js"],
      sourcesContent: ["ab"],
      version: 3
    }, {content: "Z", filename: "final.js", language: "javascript"}))
    const innerOrigin = inner.spans[0].origin
    const outerOrigin = outer.spans[0].origin

    assert.equal(innerOrigin.kind, "source")
    assert.equal(outerOrigin.kind, "source")
    inner.spans[0].mappingKind = "exact"
    innerOrigin.location.end = {column: 3, line: 1, offset: 2}
    const wholeOuter = structuredClone(outer)
    const wholeOrigin = wholeOuter.spans[0].origin

    assert.equal(wholeOrigin.kind, "source")
    wholeOuter.spans[0].mappingKind = "exact"
    wholeOrigin.location.end = {column: 3, line: 1, offset: 2}
    expect(originalPositionFor(composeMappings(wholeOuter, inner), {offset: 0}).mappingKind).toEqual("exact")

    outer.spans[0].mappingKind = "exact"
    outerOrigin.location = {
      end: {column: 3, line: 1, offset: 2},
      filename: "middle.js",
      start: {column: 2, line: 1, offset: 1}
    }
    const composed = composeMappings(outer, inner)
    const result = originalPositionFor(composed, {offset: 0})

    expect({end: result.location.end.offset, mappingKind: result.mappingKind, start: result.location.start.offset})
      .toEqual({end: 2, mappingKind: "anchor", start: 0})
  })

  it("splits exact outer ranges across every overlapping inner mapping", () => {
    const inner = mappingFromSourceMap({
      file: "middle.js",
      mappings: "AAAA,CAAC",
      names: [],
      sources: ["original.js"],
      sourcesContent: ["xy"],
      version: 3
    }, {content: "ab", filename: "middle.js", language: "javascript"})
    const outer = structuredClone(mappingFromSourceMap({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["middle.js"],
      sourcesContent: ["ab"],
      version: 3
    }, {content: "UV", filename: "final.js", language: "javascript"}))
    const outerOrigin = outer.spans[0].origin

    assert.equal(outerOrigin.kind, "source")
    outerOrigin.location.end = {column: 3, line: 1, offset: 2}
    outer.spans[0].mappingKind = "exact"
    const composed = composeMappings(outer, inner)

    assert.equal(originalPositionFor(composed, {offset: 0}).location.start.offset, 0)
    assert.equal(originalPositionFor(composed, {offset: 1}).location.start.offset, 1)
  })
})

/**
 * Extracts source text for a location.
 * @param {string} source - Source text.
 * @param {import("../src/semantic/types.js").SourceLocation} location - Location.
 * @returns {string} Source slice.
 */
function slice(source, location) {
  return source.slice(location.start.offset, location.end.offset)
}
