# 031 — Zig source and target support

- Status: `todo`
- Phase/priority: Phase P / P2
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [015-language-expansion-foundation.md](015-language-expansion-foundation.md), [018-c-source-and-target.md](018-c-source-and-target.md), [020-rust-source-and-target.md](020-rust-source-and-target.md)

## Purpose

Add Zig as a later first-class frontend and native project backend for Tasks 001–005. Reuse the already-proven C native ABI/string and Rust ownership/failure-pressure contracts instead of delaying the first semantic expansion with a third low-level lane.

## Semantic, value, and ownership profile

- Map integers and Booleans to explicit `i64` and `bool`. Represent semantic strings as immutable UTF-8 `[]const u8` values with a documented generated lifetime/allocator context; no sentinel termination, mutation, pointer identity, or ownership transfer is semantic.
- Accept explicitly typed `const`/`var` locals, canonical top-level required-arity/void functions, assignment, current operators, strict-Boolean conditionals, explicit returns, direct calls, and a generated standard-output entry shell.
- Preserve safe integers with explicit checked arithmetic behavior that is identical across Debug/ReleaseSafe/ReleaseFast; reject wrapping/saturating operators and target-dependent integer coercion.
- Reject inferred types, `comptime`, `anytype`, generics, optionals, error unions/sets, `try`/`catch`, `defer`/`errdefer`, async/concurrency, user pointers/slices/arrays/structs/unions/enums, allocators, C imports/FFI, inline assembly, reflection/builtins outside the exact generated shell, and undefined/unreachable behavior.

## Frontend strategy and parser qualification

- Treat a pinned `@tree-sitter-grammars/tree-sitter-zig` npm release as a candidate requiring Task 015 qualification: authoritative upstream/provenance/license, package integrity, Node 24/grammar ABI, typed tree access, error/recovery behavior, UTF-16 locations, supported-version coverage, and differential agreement with the selected Zig parser/compiler.
- If the candidate's age, syntax-version coverage, packaging, or maintenance cannot satisfy the gate, block and amend the route. `zig ast-check`, compiler diagnostics, or source scans never substitute for a parser tree.
- Exhaustively traverse root/declaration/type/block/statement/expression/operator/builtin/container children and reject every recovery, doc/directive, and unmodeled child.

## Backend and artifact strategy

- Return a deterministic project with `build.zig`, the minimum supported `build.zig.zon` if required by the pinned Zig release, and `src/main.zig`. Use only the installed standard library and no fetched package/archive.
- Isolate string storage and output in generated helper code whose borrowing/lifetime is statically valid for the complete execution. Validate names, target/options, lifetimes, mutability, calls, result types, arithmetic policy, and the entire artifact set before emission.
- Emit canonical `zig fmt` form and reparse generated source. Preserve rich provenance and the Task 015 Source Map v3 form for semantic code; identify build/allocator/output scaffolding as configuration-derived or synthetic.

## Diagnostics and fail-loud boundaries

- Use located `PARSE_ERROR`, `MISSING_TYPE`, and `UNSUPPORTED_SYNTAX` for recovery, inference, compile-time/error/unsafe/memory features, and other excluded Zig forms.
- Backend failures use `UNSUPPORTED_CAPABILITY` before partial output. Never replace errors with panics, leak caller-controlled allocations, assume null termination, or rely on optimizer-specific overflow/undefined behavior.

## Deterministic real-toolchain tests

- Record exact `zig version` and supported target; a missing/unsupported compiler fails. Use isolated caches and disable network/package fetching.
- Verify `zig fmt --check`, `zig build test`, native build, and execution under Debug, ReleaseSafe, and ReleaseFast with exact stdout/status and equivalent boundary behavior.
- Cover Tasks 001–005, Unicode and embedded-NUL strings, lifetime-sensitive call chains, mutable/immutable values, arithmetic bounds, parser recovery, every rejected low-level feature, generated reparse, all Zig directions, and representative C/Rust/managed crossings.
- Generate twice and compare all project artifacts and provenance byte-for-byte.

## Documentation

Document the exact Zig/compiler profile, project layout, allocator/string lifetime and overflow policy, parser-candidate qualification, offline toolchain use, exclusions, and mappings. Add a behavior changelog fragment when implemented.

## Completion criteria

- A qualified parser route exists and Zig is truthfully registered as frontend/native project backend for Tasks 001–005.
- Generated projects reparse, format, build, test, and run deterministically across required optimization modes without network dependencies or undefined behavior.
- Ownership/string, diagnostics, provenance, cross-language, docs/changelog, and repository gates pass.

## Non-goals

Package fetching, cross-compilation, C ABI/`@cImport`, `comptime`, generics, optionals/error unions, user-managed allocation/pointers/slices, concurrency, inline assembly, reflection/metaprogramming, or arbitrary standard-library APIs.
