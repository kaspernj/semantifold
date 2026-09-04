# 021 — Browser-oriented WebAssembly target

- Status: `todo`
- Phase/priority: Phase P / P1 (non-blocking)
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add WebAssembly as a first-class binary target with deterministic browser execution and JavaScript interoperability for the exact Tasks 001–004 IR. Do not add a Wasm/WAT source frontend or claim that raw Wasm is an ordinary source language.

## Semantic profile and target boundary

- Consume the unchanged semantic module. Wasm types, linear memory, imports, exports, traps, byte offsets, and JavaScript values are backend/ABI concerns and never become semantic nodes.
- Use the portable WebAssembly core integer/control/memory instructions selected and pinned by this task. Semantic integers lower to signed `i64`; booleans lower to canonical `i32` values `0` or `1`; strings lower to immutable UTF-8 bytes addressed by `(i32 pointer, i32 length)` in one exported memory.
- Retain the safe-integer literal contract. Define a single deterministic i64 overflow policy consistent with the documented current semantic boundary; reject unrepresentable constants/module sizes before encoding and never truncate, saturate, or switch behavior by browser/validator.
- No source frontend is registered for `wasm`, `.wat`, or `.wasm`. `parse({language: "wasm"})` continues with a truthful missing-role/unsupported-language diagnostic. Any future source proposal must justify normalization, parser, source profile, and round-trip semantics separately.

## Module ABI, imports, exports, and memory

- Pin and version a `semantifold.browser.v1` ABI in artifact metadata and documentation. Export exactly `memory` and a zero-parameter `run` function; semantic helper functions remain internal and user semantic functions are not ambient browser APIs.
- Import only `semantifold.print_i64(i64)`, `semantifold.print_bool(i32)`, and `semantifold.print_string(i32, i32)`. The loader rejects missing/extra/mistyped imports and validates that Boolean values are canonical.
- Lay out deduplicated immutable UTF-8 string data deterministically after a reserved zero address, with checked pointer/length/page calculations. There is no allocator, free, growth, shared memory, table, reference type, global host state, DOM import, WASI, or component-model binding.
- The JavaScript loader captures the instantiated exported memory, bounds-checks every string pointer/length with overflow-safe arithmetic, decodes with fatal UTF-8, renders integer `bigint` as exact base-10 text, and appends exact lines to a caller-supplied text sink. It must not coerce malformed ABI values.
- `run` performs the semantic entry point exactly once per explicit call. Instantiation has no semantic side effects; no Wasm start section silently runs user code.

## Binary backend and browser artifacts

- Implement a small deterministic encoder directly from already validated IR to the pinned core binary format. It is a backend encoder, not a source parser. Do not shell out to WAT as the production generation path or bundle a compiler archive.
- Emit an ordered artifact set: `program.wasm` (`application/wasm`), `program.wasm.map`, `semantifold-loader.mjs`, and `index.html`. The HTML is a deterministic acceptance harness with no remote scripts, bundler, framework, eval, inline user code, or network dependency.
- The loader requires an `application/wasm` response. It uses `WebAssembly.instantiateStreaming` when that API is available and an explicit `arrayBuffer`/`WebAssembly.instantiate` compatibility path only when streaming is unavailable; a bad MIME response fails instead of selecting the fallback. It never falls back to JavaScript execution of semantic operations.
- Validate the complete IR, ABI limits, section ordering/indexes, stack typing, branch structure, names, memory layout, import/export set, and artifact paths before returning any artifact.

## Provenance and source maps

- Record rich half-open byte ranges for module header, sections, function bodies/instructions, immediates, data segments, and custom sections. Semantic instructions trace to original nodes/operators/symbols; encoding lengths and ABI scaffolding are explicit synthetic ranges.
- Emit Source Map v3 with generated line `1` and generated column equal to the `.wasm` byte offset, per the WebAssembly tool convention, plus a `sourceMappingURL` custom section referring to `program.wasm.map` by relative URL.
- Loader/HTML text have their own text mappings. The external map is interoperable but cannot replace the richer byte provenance. Repeated generation must produce byte-identical module/map/glue/harness artifacts.

## Diagnostics, rejections, and no-approximation rules

- Unsupported IR, out-of-range values, excessive memory/module sizes, invalid ABI names/types, or stack/control shapes raise `UNSUPPORTED_CAPABILITY` at original semantic locations before bytes are exposed.
- Loader failures distinguish fetch/MIME, compile, instantiate/import, memory bounds/UTF-8, invocation/trap, and timeout stages, retain the original error as cause where safe, and never convert a trap into a semantic return or partial success.
- Do not implement strings as JavaScript indexes, booleans as truthy arbitrary integers, integers as lossy JS numbers, print by DOM access from Wasm, exceptions through traps, or unsupported semantic operations through JavaScript glue.

## Deterministic tests, validator, and browser acceptance

- Add binary structure/byte-provenance specs and independent validation with the real installed WABT `wasm-validate` command. The validator must be unavailable-fatal and is not the production encoder.
- Serve the artifact directory from a bounded local HTTP server with correct MIME types and no external access. Launch a real installed headless Chromium through its command-line headless mode with a fixed profile, locale/timezone, virtual-time budget, and timeout; inspect deterministic DOM/stdout sentinel output and browser exit status.
- Acceptance covers every Tasks 001–004 fixture, Unicode and embedded NUL, negative integers/i64 boundary handling, both booleans, nested/fallthrough branches, repeated `run` policy, malformed import signatures, corrupted bytes, bad UTF-8/bounds, traps, map custom-section URL, and no-network behavior.
- Also instantiate generated bytes with Node's standard WebAssembly API as a fast diagnostic lane, but never substitute Node for mandatory real-browser acceptance.

## Documentation

Document that Wasm is target-only, the ABI version, exact imports/exports, memory/string layout, integer/Boolean bridge, artifact serving requirements, loader API, browser/validator versions and overrides, provenance/source-map convention, security limits, and exclusions. Update README/architecture/language/testing docs and add a behavior changelog fragment.

## Completion criteria

- Capability discovery reports browser Wasm as a binary/browser backend and reports no frontend.
- Byte-identical valid modules implement the complete Tasks 001–004 subset through the documented ABI without silent JavaScript/runtime approximation.
- External maps/custom-section references and rich byte provenance validate for every semantic instruction and synthetic region.
- Real `wasm-validate`, Node diagnostic instantiation, local-server loading, and real headless-Chromium execution pass deterministically, while missing tools fail.
- Negative ABI/security/trap tests, docs/changelog, and all repository gates pass.

## Non-goals

WAT or Wasm input, WASI, component model, GC/reference types, threads/shared memory/atomics, SIMD, exceptions, tail calls, multiple memories, memory growth, DOM APIs, filesystem/network imports, package managers/bundlers, direct Rust/C compilation to Wasm, plugin loading, or general browser application generation.
