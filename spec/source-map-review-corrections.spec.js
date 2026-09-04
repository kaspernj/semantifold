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
  composeSourceMaps,
  generateArtifact,
  generatedPositionFor,
  getNodeProvenance,
  mappingFromSourceMap,
  originalPositionFor,
  parse
} from "../index.js"
import {SourceWriter} from "../src/backends/writer.js"

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

  it("URL-encodes significant characters in nested external map filenames", () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})
    const artifact = generateArtifact({
      filename: "dist/program.js",
      language: "javascript",
      mapDirective: "external",
      module,
      sourceMapFilename: "dist/maps/program.js.map#v1?copy"
    })
    const directive = artifact.code.match(/\/\/# sourceMappingURL=(.+)\n$/u)

    expect(artifact.sourceMapFilename).toEqual("dist/maps/program.js.map#v1?copy")
    assert.ok(directive)
    expect(directive[1]).toEqual("maps/program.js.map%23v1%3Fcopy")
    const resolved = new URL(directive[1], "https://example.invalid/dist/program.js")

    expect({hash: resolved.hash, pathname: resolved.pathname, search: resolved.search}).toEqual({
      hash: "",
      pathname: "/dist/maps/program.js.map%23v1%3Fcopy",
      search: ""
    })
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

  it("prefers an exact source-content override over suffix candidates", () => {
    const mapping = importedSourceMap(["foo.js", "nested/foo.js"], [
      {content: "exact override", filename: "foo.js", language: "javascript"}
    ])

    expect(mapping.sources.map(({content, filename}) => ({content, filename}))).toEqual([
      {content: "exact override", filename: "foo.js"},
      {content: "map content 1", filename: "nested/foo.js"}
    ])
  })

  it("applies a uniquely identifying suffix source-content override", () => {
    const mapping = importedSourceMap(["nested/foo.js", "other.js"], [
      {content: "suffix override", filename: "foo.js", language: "javascript"}
    ])

    expect(mapping.sources.map(({content, filename}) => ({content, filename}))).toEqual([
      {content: "suffix override", filename: "foo.js"},
      {content: "map content 1", filename: "other.js"}
    ])
  })

  it("rejects an ambiguous suffix source-content override", () => {
    assert.throws(() => importedSourceMap(["a/foo.js", "b/foo.js"], [
      {content: "ambiguous override", filename: "foo.js", language: "javascript"}
    ]), /ambiguous.*foo\.js/iu)
  })

  it("imports source-rooted V3 mappings through resolved source names", () => {
    const mapping = mappingFromSourceMap({
      file: "generated.js",
      mappings: "AAAA",
      names: [],
      sourceRoot: "../src",
      sources: ["input.ts"],
      sourcesContent: ["x"],
      version: 3
    }, {content: "x", filename: "generated.js", language: "javascript"})
    const original = originalPositionFor(mapping, {offset: 0})

    expect(mapping.sources.map(({content, filename}) => ({content, filename}))).toEqual([
      {content: "x", filename: "../src/input.ts"}
    ])
    expect(original.location?.filename).toEqual("../src/input.ts")
  })

  it("maps aliased semantic nodes by occurrence path deterministically", () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})
    const declaration = module.functions[0]
    const sharedType = /** @type {import("../src/semantic/types.js").TypeReference} */ ({
      kind: "TypeReference",
      name: "integer"
    })

    declaration.parameters[0].type = sharedType
    declaration.parameters[1].type = sharedType
    declaration.returnType = sharedType
    const first = generateArtifact({language: "typescript", module})
    const second = generateArtifact({language: "typescript", module})
    const records = first.mapping.nodes.filter((record) => record.kind == "TypeReference")
    const expected = [
      ["/functions/0/parameters/0/type", declaration.parameters[0].location.start.offset],
      ["/functions/0/parameters/1/type", declaration.parameters[1].location.start.offset],
      ["/functions/0/returnType", declaration.location.start.offset]
    ]

    expect(records.map((record) => [record.path, primaryOffset(record.origin)])).toEqual(expected)
    const recordPaths = new Map(records.map((record) => [record.id, record.path]))
    const typeSpans = first.mapping.spans.filter((span) => span.role == "type" && recordPaths.has(span.nodeId))

    expect(typeSpans.map((span) => [recordPaths.get(span.nodeId), primaryOffset(span.origin)])).toEqual(expected)
    expect(JSON.stringify(first.mapping)).toEqual(JSON.stringify(second.mapping))
  })

  it("maps shared local TypeReferences by occurrence in all five backends", () => {
    const source = `function choose(flag: boolean, fallback: string): string {
  const first: string = "yes"
  let second: string = fallback
  if (flag) {
    return first
  } else {
    return second
  }
}

console.log(choose(true, "no"))
`
    const module = parse({filename: "locals.ts", language: "typescript", source})
    const declaration = module.functions[0]
    const first = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (declaration.body.statements[0])
    const second = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (declaration.body.statements[1])
    const sharedType = /** @type {import("../src/semantic/types.js").TypeReference} */ ({
      kind: "TypeReference",
      name: "string"
    })
    const expectedPaths = ["/functions/0/body/statements/0/type", "/functions/0/body/statements/1/type"]

    first.type = sharedType
    second.type = sharedType
    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const artifact = generateArtifact({language, module})
      const records = artifact.mapping.nodes.filter((record) => expectedPaths.includes(record.path))
      const nodeIds = new Set(records.map((record) => record.id))

      expect(records.map((record) => record.path)).toEqual(expectedPaths)
      expect(artifact.mapping.spans.filter((span) => span.role == "type" && nodeIds.has(span.nodeId))
        .map((span) => span.nodeId)).toEqual(records.map((record) => record.id))
    }
  })

  it("retains and deduplicates every transformed origin in synthetic context", () => {
    const module = parse({filename: "program.ts", language: "typescript", source: baseSource})
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
    const provenance = branch.sourceProvenance

    assert.ok(provenance)
    provenance.origin = {
      kind: "derived",
      origins: [
        {location: branch.condition.location, role: "condition", sourceId: "source:0"},
        {location: branch.location, role: "branch", sourceId: "source:0"}
      ]
    }
    const writer = new SourceWriter({filename: "generated.js", language: "javascript", module})

    writer.synthetic("  ", "transformed indentation", [branch, branch])
    const mapping = writer.finish()
    const origin = mapping.spans[0].origin

    assert.equal(origin.kind, "synthetic")
    expect(origin.relatedOrigins.map(({location, role, sourceId}) => ({
      end: location.end.offset,
      role,
      sourceId,
      start: location.start.offset
    }))).toEqual([
      {
        end: branch.condition.location.end.offset,
        role: "condition",
        sourceId: "source:0",
        start: branch.condition.location.start.offset
      },
      {
        end: branch.location.end.offset,
        role: "branch",
        sourceId: "source:0",
        start: branch.location.start.offset
      }
    ])
    expect(generatedPositionFor(mapping, {
      offset: branch.location.end.offset - 1,
      sourceId: "source:0"
    }).length).toEqual(1)
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
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.statements[0])
      const condition = branch.condition
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (module.entryPoint.body.statements[0].expression)
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

  it("preserves custom inner source IDs used by retained node origins", () => {
    const module = parse({filename: "original.ts", language: "typescript", source: baseSource})
    const artifact = generateArtifact({filename: "intermediate.ts", language: "typescript", module})
    const inner = structuredClone(artifact.mapping)
    const priorSourceId = inner.sources[0].id
    const customSourceId = "input:typescript"

    inner.sources[0].id = customSourceId
    inner.nodes.forEach((node) => renameOriginSourceId(node.origin, priorSourceId, customSourceId))
    inner.spans.forEach((span) => renameOriginSourceId(span.origin, priorSourceId, customSourceId))
    const outer = mappingFromSourceMap({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["intermediate.ts"],
      sourcesContent: [artifact.code],
      version: 3
    }, {content: "Z", filename: "final.js", language: "javascript"})
    const composed = composeMappings(outer, inner)
    const retained = composed.nodes.find((node) => node.path == "/functions/0")

    assert.equal(retained.origin.kind, "source")
    expect(composed.sources[0].id).toEqual(customSourceId)
    expect(retained.origin.sourceId).toEqual(customSourceId)
    expect(originalPositionFor(composed, {offset: 0}).location.filename).toEqual("original.ts")
  })

  it("preserves synthetic scaffolding while composing its related provenance", () => {
    const module = parse({filename: "original.ts", language: "typescript", source: baseSource})
    const intermediate = generateArtifact({filename: "intermediate.ts", language: "typescript", module})
    const reparsed = parse({filename: "intermediate.ts", language: "typescript", source: intermediate.code})
    const outer = generateArtifact({filename: "final.js", language: "javascript", module: reparsed})
    const outerSpan = outer.mapping.spans.find((span) => span.mappingKind == "synthetic" &&
      span.origin.kind == "synthetic" && span.origin.reason == "indentation" && span.origin.relatedOrigins.length > 0)

    assert.ok(outerSpan)
    assert.equal(outerSpan.origin.kind, "synthetic")
    expect(outerSpan.origin.relatedOrigins[0].location.filename).toEqual("intermediate.ts")
    const composed = composeMappings(outer.mapping, intermediate.mapping)
    const composedSpan = composed.spans.find((span) => span.generated.start.offset == outerSpan.generated.start.offset &&
      span.generated.end.offset == outerSpan.generated.end.offset)

    assert.ok(composedSpan)
    assert.equal(composedSpan.origin.kind, "synthetic")
    expect({mappingKind: composedSpan.mappingKind, reason: composedSpan.origin.reason}).toEqual({
      mappingKind: "synthetic",
      reason: "indentation"
    })
    const related = composedSpan.origin.relatedOrigins[0]

    expect({filename: related.location.filename, role: related.role}).toEqual({filename: "original.ts", role: "context"})
    assert.ok(related.nodeId)
    expect(composed.nodes.some((node) => node.id == related.nodeId)).toEqual(true)
  })

  it("composes every inner span covered by synthetic context", () => {
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
    }, {content: "Z", filename: "final.js", language: "javascript"}))
    const intermediate = outer.spans[0].origin

    assert.equal(intermediate.kind, "source")
    const fullIntermediate = {
      ...intermediate.location,
      end: {column: 3, line: 1, offset: 2}
    }

    outer.spans[0].mappingKind = "synthetic"
    outer.spans[0].origin = {
      kind: "synthetic",
      reason: "generated wrapper",
      relatedOrigins: [{location: fullIntermediate, role: "context", sourceId: intermediate.sourceId}]
    }
    const composed = composeMappings(outer, inner)
    const span = composed.spans[0]

    assert.equal(span.origin.kind, "synthetic")
    expect({mappingKind: span.mappingKind, reason: span.origin.reason}).toEqual({
      mappingKind: "synthetic",
      reason: "generated wrapper"
    })
    expect(span.origin.relatedOrigins.map((related) => related.location.start.offset)).toEqual([0, 1])
    expect(generatedPositionFor(composed, {filename: "original.js", offset: 1}).length).toEqual(1)
  })

  it("indexes every related origin once for reverse lookup", () => {
    const module = parse({filename: "original.ts", language: "typescript", source: baseSource})
    const artifact = generateArtifact({language: "javascript", module})
    const spanIndex = artifact.mapping.spans.findIndex((span) => span.origin.kind == "source" && span.role == "name")
    const span = artifact.mapping.spans[spanIndex]

    assert.ok(span)
    assert.equal(span.origin.kind, "source")
    const secondarySourceId = "source:secondary"
    const primary = {location: span.origin.location, role: "primary", sourceId: span.origin.sourceId}
    const secondary = {location: {...span.origin.location, filename: "secondary.ts"}, role: "secondary", sourceId: secondarySourceId}
    const covering = {location: {...module.location, filename: "secondary.ts"}, role: "covering", sourceId: secondarySourceId}
    /** @type {import("../src/semantic/types.js").SemanticOrigin[]} */
    const origins = [
      {kind: "derived", origins: [primary, secondary, covering]},
      {kind: "synthetic", reason: "multi-source context", relatedOrigins: [primary, secondary, covering]}
    ]

    for (const origin of origins) {
      const mapping = structuredClone(artifact.mapping)

      mapping.sources.push({content: baseSource, filename: "secondary.ts", id: secondarySourceId, language: "typescript"})
      mapping.spans[spanIndex].origin = origin
      if (origin.kind == "synthetic") mapping.spans[spanIndex].mappingKind = "synthetic"
      const results = generatedPositionFor(mapping, {offset: span.origin.location.start.offset, sourceId: secondarySourceId})

      expect(results.length).toEqual(1)
      expect(results[0].generatedLocation).toEqual(span.generated)
    }
  })

  it("composes derived intermediate provenance before unrelated provenance", () => {
    const {inner, intermediate, outer, unrelated} = mixedCompositionFixture()

    outer.spans[0].origin = {kind: "derived", origins: [intermediate, unrelated]}
    const composed = composeMappings(outer, inner)
    const origin = composed.spans[0].origin

    assert.equal(origin.kind, "derived")
    expect(origin.origins.map((related) => ({
      filename: related.location.filename,
      registeredFilename: composed.sources.find((source) => source.id == related.sourceId)?.filename,
      role: related.role
    }))).toEqual([
      {filename: "original.js", registeredFilename: "original.js", role: "intermediate"},
      {filename: "unrelated.js", registeredFilename: "unrelated.js", role: "unrelated"}
    ])
  })

  it("composes synthetic intermediate provenance after unrelated provenance", () => {
    const {inner, intermediate, outer, unrelated} = mixedCompositionFixture()

    outer.spans[0].mappingKind = "synthetic"
    outer.spans[0].origin = {
      kind: "synthetic",
      reason: "mixed scaffolding",
      relatedOrigins: [unrelated, intermediate]
    }
    const composed = composeMappings(outer, inner)
    const span = composed.spans[0]

    assert.equal(span.origin.kind, "synthetic")
    expect({mappingKind: span.mappingKind, reason: span.origin.reason}).toEqual({
      mappingKind: "synthetic",
      reason: "mixed scaffolding"
    })
    expect(span.origin.relatedOrigins.map((related) => ({
      filename: related.location.filename,
      registeredFilename: composed.sources.find((source) => source.id == related.sourceId)?.filename,
      role: related.role
    }))).toEqual([
      {filename: "unrelated.js", registeredFilename: "unrelated.js", role: "unrelated"},
      {filename: "original.js", registeredFilename: "original.js", role: "intermediate"}
    ])
  })

  it("does not trace an unrelated suffix-matched V3 source", () => {
    const composed = composeSourceMaps({
      file: "final.js",
      mappings: "AAAA",
      names: [],
      sources: ["vendor/intermediate.ts"],
      sourcesContent: ["unrelated"],
      version: 3
    }, {
      file: "intermediate.ts",
      mappings: "AAAA",
      names: [],
      sources: ["original.ts"],
      sourcesContent: ["original"],
      version: 3
    })
    const traced = traceOriginalPositionFor(new TraceMap(composed), {column: 0, line: 1})
    const tracedSourceIndex = composed.sources.indexOf(traced.source)

    expect({source: traced.source, sourceContent: composed.sourcesContent?.[tracedSourceIndex]}).toEqual({
      source: "vendor/intermediate.ts",
      sourceContent: "unrelated"
    })
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

/**
 * Rewrites one source registry identity in a mutable closed origin.
 * @param {import("../src/semantic/types.js").SemanticOrigin} origin - Origin to update.
 * @param {string} priorSourceId - Existing source identity.
 * @param {string} sourceId - Replacement source identity.
 * @returns {void}
 */
function renameOriginSourceId(origin, priorSourceId, sourceId) {
  if (origin.kind == "source") {
    if (origin.sourceId == priorSourceId) origin.sourceId = sourceId
    return
  }

  const relatedOrigins = origin.kind == "derived" ? origin.origins : origin.relatedOrigins

  for (const related of relatedOrigins) {
    if (related.sourceId == priorSourceId) related.sourceId = sourceId
  }
}

/**
 * Builds a rich composition fixture with one intermediate and one unrelated origin.
 * @returns {{
 *   inner: import("../src/semantic/types.js").SemantifoldMapping,
 *   intermediate: import("../src/semantic/types.js").RelatedOrigin,
 *   outer: import("../src/semantic/types.js").SemantifoldMapping,
 *   unrelated: import("../src/semantic/types.js").RelatedOrigin
 * }} Mutable mappings and related origins.
 */
function mixedCompositionFixture() {
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
  const origin = outer.spans[0].origin

  assert.equal(origin.kind, "source")
  outer.sources.push({content: "u", filename: "unrelated.js", id: "source:unrelated", language: "javascript"})

  return {
    inner,
    intermediate: {location: origin.location, role: "intermediate", sourceId: origin.sourceId},
    outer,
    unrelated: {
      location: {
        end: {column: 2, line: 1, offset: 1},
        filename: "unrelated.js",
        start: {column: 1, line: 1, offset: 0}
      },
      role: "unrelated",
      sourceId: "source:unrelated"
    }
  }
}

/**
 * Imports a minimal V3 map with caller source-content overrides.
 * @param {string[]} sources - V3 source names.
 * @param {{filename: string, content: string, language?: import("../src/semantic/types.js").SemanticLanguage}[]} overrides - Overrides.
 * @returns {import("../src/semantic/types.js").SemantifoldMapping} Imported rich mapping.
 */
function importedSourceMap(sources, overrides) {
  return mappingFromSourceMap({
    file: "generated.js",
    mappings: "AAAA",
    names: [],
    sources,
    sourcesContent: sources.map((_, index) => `map content ${index}`),
    version: 3
  }, {content: "x", filename: "generated.js", language: "javascript", sources: overrides})
}

/**
 * Returns the first closed origin offset.
 * @param {import("../src/semantic/types.js").SemanticOrigin} origin - Closed provenance.
 * @returns {number} Primary offset.
 */
function primaryOffset(origin) {
  if (origin.kind == "source") return origin.location.start.offset
  if (origin.kind == "derived") return origin.origins[0].location.start.offset

  return origin.relatedOrigins[0].location.start.offset
}
