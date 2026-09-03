# Source provenance and mappings

Semantifold keeps one authoritative, language-neutral provenance chain:

```text
generated UTF-16 range -> semantic node/symbol -> original UTF-16 range
```

This works for PHP, Ruby, JavaScript, TypeScript, and Java inputs and outputs. It is not limited to JavaScript `sourceMappingURL` comments. `SemantifoldMapping` v1 is the authoritative range model; every generated artifact also includes an ECMA-426/Source Map v3 projection for existing tooling.

## Parsing and semantic provenance

`parse()` preserves the existing `location.filename/start/end` shape. Lines and columns are one-based, ranges are half-open, and offsets and columns count UTF-16 code units. CRLF is one line break, a lone CR is one line break, and astral characters occupy two columns and offsets. Source content and its original newlines are preserved exactly.

Parsed modules additionally have a JSON-safe `provenance` value:

```js
const module = parse({
  filename: "choose.ts",
  language: "typescript",
  source
})

module.provenance // {
//   schema: "SemantifoldProvenance",
//   version: 1,
//   coordinateSystem: "utf16",
//   sources: [{id: "source:0", filename: "choose.ts", content: source, language: "typescript"}],
//   nodes: [{id: "node:0", path: "", kind: "Module", origin, ranges: {}}],
//   symbols: [{id: "symbol:0", kind: "function", declarationNodeId: "node:1", ...}]
// }
```

Node IDs follow deterministic semantic traversal order, node paths are JSON Pointers, and symbol IDs identify validated function, parameter, and local bindings. Declaration records and resolved identifier/call records share a symbol ID. `ranges` contains parser-owned semantic tokens such as `name`, `type`, `callee`, `literal`, and `operator`. Parser AST/CST values never enter the public object.

Origins are a closed union:

```js
{kind: "source", sourceId: "source:0", location}
{kind: "derived", origins: [{sourceId: "source:0", location, role: "desugared-from"}]}
{kind: "synthetic", reason: "Java class scaffolding", relatedOrigins: []}
```

`primaryLocation(origin)` returns the direct location, the first derived origin, the first related synthetic origin, or `undefined`. `getNodeProvenance(module, nodeOrId)` and `getSymbolProvenance(module, symbolId)` query parsed-module identities.

Provenance is mutable JSON because semantic transformations need ordinary data. Generation therefore treats caller metadata as evidence, never authority: it validates paths, ranges, source bounds, and coordinate consistency, then rebuilds all node and symbol IDs. Missing, malformed, duplicate, or stale metadata falls back safely to semantic `location` values. Legacy caller-authored modules without `provenance` remain accepted.

## Generated artifacts

`generate()` remains the compatibility API and returns exactly the same source bytes as before this feature. `generateArtifact()` is additive:

```js
const artifact = generateArtifact({
  filename: "Main.java",
  language: "java",
  module
})

artifact.code
artifact.filename
artifact.language
artifact.mapping       // SemantifoldMapping v1
artifact.sourceMap     // encoded Source Map v3 object
artifact.sourceMapFilename
```

Default filenames are `program.php`, `program.rb`, `program.js`, `program.ts`, and `Main.java`. `sources` may supply exact content for legacy or caller-assembled multi-source IR:

```js
generateArtifact({
  language: "ruby",
  module: assembledModule,
  sources: [
    {filename: "first.ts", language: "typescript", content: firstSource},
    {filename: "second.java", language: "java", content: secondSource}
  ]
})
```

This single-artifact envelope is intentionally reusable as an element in task 010's future ordered artifact set. Generation never writes files.

All outputs have deterministic LF newlines. The rich map's `generated.content` is the exact returned code and its ordered, non-empty spans cover every UTF-16 code unit without gaps or overlaps:

- `exact` maps a generated semantic token to an exact parser token/range.
- `anchor` maps target syntax such as a keyword or delimiter to the owning semantic origin.
- `synthetic` marks formatting, comments, entry wrappers, and target scaffolding, optionally with related origins.

Every span may carry a canonical `nodeId`, `symbolId`, semantic `role`, and Source Map `name`. Sources retain filenames, exact `sourcesContent` when available, and independent registry identity. Rich mappings are the serialization and interchange contract because v3 represents points rather than ranges and cannot retain semantic roles or the closed derived/synthetic model.

## Source Map v3 and directives

`artifact.sourceMap` exists for all five targets and is generated with `@jridgewell/gen-mapping`; lookup and import use `@jridgewell/trace-mapping`. Semantifold does not hand-code VLQ or tracing. The v3 map contains deterministic `file`, `sources`, `sourcesContent`, `names`, and `mappings` fields.

Directives are opt-in and only valid for JavaScript and TypeScript:

```js
generateArtifact({language: "javascript", module, mapDirective: "external"})
generateArtifact({language: "typescript", module, mapDirective: "inline"})
```

`external` appends `//# sourceMappingURL=<sourceMapFilename>`. `inline` appends a UTF-8 base64 data URL. The default is `none`. PHP, Ruby, and Java still receive sidecar map objects but never receive non-native map comments. Native Java debugger mapping such as JSR-45 would require class-file/toolchain integration and is not part of v1.

The directive itself is an unmapped synthetic rich-map span. `artifact.sourceMap` is computed for the program before that self-referential comment is appended; this is required for a stable inline data URL and is the conventional v3 behavior. Use the rich mapping when the directive span itself matters. Rich registries may distinguish same-named sources by `sourceId`; Source Map v3 identifies sources by filename, so callers should use unique filenames when exporting such an assembled registry to v3.

## Queries, serialization, composition, and diagnostics

```js
const original = originalPositionFor(artifact.mapping, {offset: generatedOffset})
const generated = generatedPositionFor(artifact.mapping, {filename: "choose.ts", offset: originalOffset})
const unambiguous = generatedPositionFor(artifact.mapping, {sourceId: "source:0", offset: originalOffset})
const nodeSpans = spansForNode(artifact.mapping, original.nodeId)
const symbolSpans = spansForSymbol(artifact.mapping, original.symbolId)

const json = stringifyMapping(artifact.mapping)
const restored = parseMapping(json)
```

Rich positions accept zero-based UTF-16 offsets or one-based line/column pairs. Serialization recursively sorts object keys and preserves semantically ordered arrays. Parsing rejects the wrong schema/version, malformed identities, unknown source references, stale source coordinates, non-LF generated content, and span gaps/overlaps.

`composeMappings(outer, inner)` composes generated ranges through an intermediate rich mapping. `mappingFromSourceMap(v3, generated)` imports a point map as anchor/synthetic ranges. `composeSourceMaps(outerV3, innerV3)` composes v3 maps using the maintained mapping libraries. The test suite compiles a generated TypeScript artifact with real `tsc`, then verifies both JavaScript -> generated TypeScript -> original Ruby compositions.

`remapLocation(generatedLocation, mapping)` returns the complete lookup result. `remapDiagnostic(diagnostic, mapping)` returns a `SemantifoldDiagnostic` at the original location while preserving the prior range as `generatedLocation` and the original diagnostic as `cause`.

## Compatibility and release recommendation

The feature is source-compatible and additive: `generate()` bytes are characterized for both existing fixture profiles, legacy semantic modules remain valid, and existing `location` fields are unchanged. Parsed modules now serialize an additional enumerable `provenance` property, so consumers that compare or persist entire module JSON should consciously include or omit it.

Semantifold is pre-1.0. The recommended release is a minor bump from `0.1.x` to `0.2.0`, with no npm publication as part of this implementation. A future incompatible provenance or mapping representation must use a new schema version rather than reinterpret version 1.
