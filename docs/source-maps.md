# Source provenance and mappings

Semantifold keeps one authoritative, language-neutral provenance chain:

```text
generated UTF-16 range -> semantic node/symbol -> original UTF-16 range
```

This works for PHP, Ruby, JavaScript, TypeScript, and Java inputs and outputs. It is not limited to JavaScript `sourceMappingURL` comments. `SemantifoldMapping` v1 is the authoritative range model; every generated artifact also includes an ECMA-426/Source Map v3 projection for existing tooling.

## Parsing and semantic provenance

`parse()` preserves the existing `location.filename/start/end` shape. Lines and columns are one-based, ranges are half-open, and offsets and columns count UTF-16 code units. CRLF is one line break, a lone CR is one line break, and astral characters occupy two columns and offsets. A CRLF start-of-line coordinate resolves after both code units; the interior offset remains a unique position on the preceding line rather than aliasing the next line. Source content and its original newlines are preserved exactly.

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

Node IDs follow deterministic semantic occurrence order, node paths are JSON Pointers, and symbol IDs identify validated function, parameter, and local bindings. Reusing one caller-assembled semantic object at multiple paths produces one record and identity per occurrence rather than overwriting earlier paths; generation selects shared type occurrences by their current path. Object-only provenance queries remain intentionally unambiguous and require an ID when the object occurs more than once. Declaration records and resolved identifier/call records share a symbol ID. `ranges` contains parser-owned semantic tokens such as `name`, `type`, `callee`, `literal`, and `operator`. Babel identifier ranges use token offsets, including the complete source spelling of escaped identifiers while excluding TypeScript annotations. Parser AST/CST values never enter the public object.

Each semantic node also carries its own JSON-safe `sourceProvenance` record. That object association—not an array position, old JSON Pointer, or caller-controlled ID—is the source of provenance after a semantic transformation. Reordering, inserting, deleting, serializing, or cloning nodes therefore moves their source ranges with them. Generation rebuilds current paths and registry-local node/symbol IDs; cloned nodes receive distinct generated identities even when they intentionally share one original origin.

Origins are a closed union:

```js
{kind: "source", sourceId: "source:0", location}
{kind: "derived", origins: [{sourceId: "source:0", location, role: "desugared-from"}]}
{kind: "synthetic", reason: "Java class scaffolding", relatedOrigins: []}
```

`primaryLocation(origin)` returns the direct location, the first derived origin, the first related synthetic origin, or `undefined`. `getNodeProvenance(module, nodeOrId)` and `getSymbolProvenance(module, symbolId)` query parsed-module identities.

Provenance is mutable JSON because semantic transformations need ordinary data. Generation therefore treats caller metadata as evidence, never authority: it validates node association, ranges, source bounds, coordinate consistency, and that a claimed `sourceId` actually owns its location, then rebuilds all paths and node/symbol IDs. Aggregate records are never reassigned to nodes merely because an old path and kind happen to match. Missing, malformed, duplicate, or stale metadata falls back safely to semantic `location` values. Legacy caller-authored modules without provenance remain accepted.

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

Default filenames are `program.php`, `program.rb`, `program.js`, `program.ts`, and `Main.java`. Java artifacts may include directories but must retain the basename `Main.java`, matching the generated public class and making the returned filename directly compilable. `sources` may supply exact content for legacy or caller-assembled multi-source IR:

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

All outputs have deterministic LF newlines. Returned rich mappings are detached from caller-owned semantic locations and provenance before they are deeply frozen and internally indexed after trust-boundary validation. Freezing an artifact mapping therefore never freezes the mutable semantic module used to generate it. The rich map's `generated.content` is the exact returned code and its ordered, non-empty spans cover every UTF-16 code unit without gaps or overlaps:

- `exact` maps a generated semantic token to an exact parser token/range.
- `anchor` maps target syntax such as a keyword or delimiter to the owning semantic origin.
- `synthetic` marks formatting, comments, entry wrappers, and target scaffolding, optionally with related origins. Writer context expands every direct, derived, or synthetic-related range from its semantic nodes and removes only deterministic duplicates.

Every span may carry a canonical `nodeId`, `symbolId`, semantic `role`, and Source Map `name`. Sources retain filenames, exact `sourcesContent` when available, and independent registry identity. Rich mappings are the serialization and interchange contract because v3 represents points rather than ranges and cannot retain semantic roles or the closed derived/synthetic model.

## Source Map v3 and directives

`artifact.sourceMap` exists for all five targets and is generated with `@jridgewell/gen-mapping`; lookup and import use `@jridgewell/trace-mapping`. Semantifold does not hand-code VLQ or tracing. The v3 map contains deterministic `file`, `sources`, `sourcesContent`, `names`, and `mappings` fields.

Directives are opt-in and only valid for JavaScript and TypeScript:

```js
generateArtifact({language: "javascript", module, mapDirective: "external"})
generateArtifact({language: "typescript", module, mapDirective: "inline"})
```

`external` appends `//# sourceMappingURL=<relative-map-url>`. `artifact.sourceMapFilename` remains the map artifact's literal logical filename, while the directive is relative to `artifact.filename`'s directory and URL-encodes each filesystem path segment without encoding structural slashes. For example, `dist/program.js` advertises `dist/program.js.map` and emits `sourceMappingURL=program.js.map`; a literal `#` or `?` in the sidecar filename is emitted as `%23` or `%3F`. Names containing any ECMAScript line terminator—LF, CR, U+2028, or U+2029—are rejected before emission. `inline` appends a UTF-8 base64 data URL. The default is `none`. PHP, Ruby, and Java still receive sidecar map objects but never receive non-native map comments. Native Java debugger mapping such as JSR-45 would require class-file/toolchain integration and is not part of v1.

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

Reverse lookup indexes every source range in direct, derived, and synthetic-related origins. When multiple containing ranges associate the same span with one queried position, that generated span is returned once.

Rich positions accept zero-based UTF-16 offsets or one-based line/column pairs. Serialization recursively sorts object keys and preserves semantically ordered arrays. Parsing rejects the wrong schema/version, malformed identities, unknown source references, stale source coordinates, non-LF generated content, and span gaps/overlaps.

`composeMappings(outer, inner)` composes generated ranges through an intermediate rich mapping. It preserves the inner source registry IDs used by retained node, symbol, and span origins. Every related origin is resolved independently by `sourceId`: origins whose registered source has the inner artifact's filename, exact generated content, and no contradictory known language are traced, while unrelated origins are retained in deterministic order. Derived origins remain derived; outer synthetic spans remain synthetic, retain their stable reason/context, and translate intermediate context into related original provenance instead of falsely mapping scaffolding as an anchor. Exact equal-length outer ranges are split at every inner mapping boundary. A strict subrange that cannot carry a correspondingly sliced inner origin is conservatively anchored, as are other ranges without a provable one-to-one subdivision. `mappingFromSourceMap(v3, generated)` imports a point map as anchor/synthetic ranges, terminates each segment at its generated line end, and explicitly represents unmapped prefixes, newlines, and lines as synthetic. Caller source-content overrides prefer exact V3 source names; a suffix override is accepted only when it identifies one map source, and ambiguous suffixes fail loudly before any registry entry is renamed. `composeSourceMaps(outerV3, innerV3)` composes v3 maps using the maintained mapping libraries. Because v3 has filenames but no rich registry IDs or generated content identity, V3 composition traces only when exactly one resolved outer source equals the inner map's `file`; basename or suffix matches are not inferred. The test suite compiles a generated TypeScript artifact with real `tsc`, then verifies both JavaScript -> generated TypeScript -> original Ruby compositions.

Validation constructs source line starts once, verifies ranges in linear passes, and creates binary-search/interval indexes for generated and original positions. Immutable mappings produced by Semantifold reuse that validated index for subsequent queries. Mutable caller mappings are deliberately revalidated on every public operation so cache reuse never weakens the trust boundary.

`remapLocation(generatedLocation, mapping)` returns the complete lookup result. `remapDiagnostic(diagnostic, mapping)` returns a `SemantifoldDiagnostic` at the original location while preserving the prior range as `generatedLocation` and the original diagnostic as `cause`.

## Compatibility and release recommendation

The feature is source-compatible and additive: `generate()` bytes are characterized for both existing fixture profiles, legacy semantic modules remain valid, and existing `location` fields are unchanged. Parsed modules now serialize an additional enumerable `provenance` property, so consumers that compare or persist entire module JSON should consciously include or omit it.

Semantifold is pre-1.0. The recommended release is a minor bump from `0.1.x` to `0.2.0`, with no npm publication as part of this implementation. A future incompatible provenance or mapping representation must use a new schema version rather than reinterpret version 1.
