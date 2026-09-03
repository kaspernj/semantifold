# Source provenance and generated mappings

- Add versioned UTF-16 source registries, deterministic semantic node/symbol identities, parser-token subranges, and closed source/derived/synthetic provenance to parsed modules.
- Add `generateArtifact()` with deterministic range-based `SemantifoldMapping` v1 and Source Map v3 sidecars for PHP, Ruby, JavaScript, TypeScript, and Java while preserving `generate()` bytes and legacy modules.
- Add forward/reverse/node/symbol lookup, deterministic parse/stringify, rich and v3 composition, Source Map import, and diagnostic/location remapping.
- Use `@jridgewell/gen-mapping` and `@jridgewell/trace-mapping` for maintained v3 encoding and tracing.
- Recommend a future pre-1.0 minor release (`0.2.0`); this change does not publish a package.
- Keep provenance attached to semantic nodes across transformations, detach immutable artifact metadata from mutable semantic locations, canonicalize CRLF positions, bound mapping validation/lookups near linearly, and correct escaped identifiers, unmapped V3 lines, Java filenames, URL-safe external directive paths, source ownership, retained rich source identities and synthetic reasons, unambiguous V3 intermediates, exact-subrange anchoring, and multi-span composition.
