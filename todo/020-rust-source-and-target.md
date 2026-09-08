# 020 — Rust source and target support

- Status: `in progress` — local implementation and focused acceptance; coordinator review/CI/merge/post-merge pending
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Rust as a first-class frontend and native Cargo-project backend for the exact Tasks 001–004 subset. Make ownership/borrowing, copy versus move, overflow, panic, and `Result` boundaries explicit rather than encoding them as new semantic meaning.

## Semantic and source profile

- Map `integer` to `i64`, `boolean` to `bool`, and `string` to owned UTF-8 `String`. Retain safe-integer source literals and one build-mode-independent overflow policy documented against the existing semantic contract.
- Semantic strings remain values. Storage uses `String`; reads at semantic copy boundaries generate explicit `.clone()` when required, comparisons/concatenation may borrow internally, and returns transfer an owned result. Generated borrow/clone details are target scaffolding, not semantic references.
- Accept crate-root free functions with the current exact two required by-value scalar parameters, explicit scalar return types/returns, initialized `let`/`let mut` locals matching semantic mutability, simple assignment, current operators, braced `if`/`else if`/`else`, and canonical `fn main()`.
- Reject source references/lifetimes, moves whose later usability changes semantic meaning, destructuring/pattern bindings, implicit tail returns, integer inference/suffix alternatives, traits/generics, user types, and target-dependent method/operator dispatch.

## Frontend strategy

- Use the Task 015-qualified official `tree-sitter-rust` grammar. Exhaustively traverse crate, item, type, block, statement, expression, attribute, and macro children; reject all error/missing/recovery nodes and retain the qualified binding’s UTF-16 ranges without treating them as UTF-8 byte offsets.
- Recognize only exact generated crate/scalar/string/print/clone scaffolding. Rust macro invocations are otherwise rejected; canonical generated printing must have one uniquely validated tree shape.
- Reject `unsafe`, `extern`, references/raw pointers, lifetimes, closures, async/await, const/static items, modules/use, impl/trait/type declarations, attributes except exact generated lint/profile scaffolding, match/loops, ranges, casts, indexing, custom operators, macros, generics, turbofish, and inferred public/local types.
- Compilation/borrow checking validates the output but never supplies parser meaning or repairs a rejected node.

## Backend and generated crate layout

- Emit a deterministic dependency-free Cargo project with `Cargo.toml`, `Cargo.lock`, and `src/main.rs`. Pin the Rust edition and minimum supported toolchain; set explicit dev/release overflow and panic profiles so observable behavior cannot drift by build mode.
- The manifest has no crates.io dependencies, build script, proc macro, workspace, feature, or network resolution. `cargo build/run --offline --locked` must work in a fresh directory.
- Emit owned `String` operations with explicit clone/borrow points, exact byte-preserving output, and no unsafe/runtime allocation helper. Validate identifiers/keywords, crate paths, helper collisions, integer/size/ownership constraints, and full IR before any artifact is returned.
- Generated `src/main.rs` reparses through the frontend to equivalent semantics after exact scaffolding collapse. Manifest/lockfile are deterministic synthetic artifacts; source carries rich/Source Map v3 provenance.

## `Result`, panic, and rejection boundaries

- The initial semantic profile has neither typed failure nor unwinding. Reject source `Result`, `Option`, `?`, `panic!`, `assert!`, `unwrap`/`expect`, explicit `return Err`, `catch_unwind`, and main returning `Result`.
- Generated code must not use panics to approximate a semantic branch, type failure, integer conversion, or unsupported operation. Host out-of-memory/stack exhaustion and the selected fixed overflow behavior are documented separately.
- Borrow-checker rejection of emitted code is a backend defect, not an acceptable capability diagnostic. Unsupported caller IR must be rejected before emission with its originating location.

## Deterministic tests with real toolchains

- Add Rust fixtures equivalent to Tasks 001–004 with Unicode/embedded-NUL strings, repeated reads requiring clones, mutation, concatenation, every operator, and nested/fallthrough branches.
- Add negative coverage for moves/borrows/lifetimes, patterns, inference, macro lookalikes, tail expressions, `Result`/panic, unsafe/extern, modules, attributes, parser recovery, build-mode arithmetic boundaries, and malformed IR.
- Discover real `rustc` and `cargo`, record both versions, generate a fresh crate, then run `cargo check --offline --locked` and debug/release `cargo run --offline --locked --quiet`; assert identical exact output/status. Missing tools or network demand fails.
- Generate/reparse Rust in both directions and cover representative original-five source/target crossings. Task 025 owns the expanded-cohort spanning matrix. Generate twice and compare all crate artifacts/mappings.

## Documentation

Document edition/minimum toolchain, exact crate layout, scalar/owned-string types, clone/borrow lowering, mutability, overflow/panic profile, offline Cargo commands, and rejected Rust features. Update README/architecture/language/testing docs and add a behavior changelog fragment.

## Completion criteria

- Rust is registered as a frontend and native Cargo-project backend with truthful artifact capabilities.
- Tasks 001–004 round-trip with ownership-safe generated code and no semantic borrow, move, `Result`, or panic leakage.
- Offline locked debug/release builds and real executions agree exactly; missing toolchains fail.
- Cross-language, negative, provenance, diagnostics, docs/changelog, and repository gates pass.

## Non-goals

Crates.io dependencies, workspaces, modules, traits/impls, structs/enums, generics, pattern matching, references/lifetimes as semantics, unsafe/FFI, macros/proc macros, const evaluation, `Result`/`Option`, panics/exceptions, async/concurrency, no-std, or cross-compilation.

## Prerequisite record — 2026-09-08

The exact official Rust 0.23.1 grammar passed fresh credential-free installation, registry signatures, upstream source comparison, strict typed API, exhaustive Tasks001–004/scaffold/recovery traversal, runtime coexistence and UTF-16 qualification before dependency edits. Seven hashed source probes are retained under `spec/fixtures/rust-qualification/`; [parser qualification](../docs/parser-qualification.md) records the complete gate.

The coordinator completed no-cache image builds and network-disabled real Rust/Cargo 1.98.1 qualification on canonical Ubuntu26.04 and actual TensorBuzz Ubuntu24.04: 11 fresh crates and 93 commands per base. Both tool identities and binary hashes matched; exact Cargo-generated format-4 lock and manifest bytes matched. The reversible same-lane image transition preserved the task branch and complete home. [Rust](../docs/rust.md) records the qualified checksums, commits, minimum, edition and build profiles.

## Local implementation record — 2026-09-08

The existing two-runtime distribution now includes official Rust grammar0.23.1 in the private 0.21.1 subtree, refreshed through ordinary npm lock generation and root npm ci. Rust is registered through the shared role/type/provenance tables. Its dedicated all-child frontend validates source ownership separately from exact scalar/clone/borrow/print/overflow scaffold collapse. The backend validates the complete IR and generated length/depth before returning synthetic Cargo manifest/lock and mapped entry artifacts, with no new semantic nodes or generator filesystem/compiler effects.

Focused RED/GREEN evidence covers parser integration, source/backend support, ownership, exact tool discovery, valid-recursion warning behavior and expanded generated-CST bounds. Product execution covers all Tasks001–004 profiles, every operator, owned Unicode/NUL strings, mutation, order/short-circuit divergence, both signed extrema and all four exact overflow failures in debug/release. Real rustc rejects original illegal moves/borrows with E0382/E0505. Adversarial source/IR, deterministic artifacts, rich/V3 Unicode forward/reverse provenance and original-five bidirectional native crossings are covered. Local cold root-tarball install/ci repeats fresh-cache/default-config/runtime/type/native Rust checks.

Raw commands, RED/GREEN counts, native stdout/stderr/status, artifact/map bytes, changed-file hashes and current static/package gate results are retained in `/home/dev/.threadwire/semantifold/task020-20260908T091900Z-evidence/acceptance.json` and its referenced logs. Historical blocked-tool records are retained as history rather than current acceptance. No local aggregate suite is run; exact individual changed/adjacent specs run sequentially.

This remains an uncommitted local candidate, not completed delivery. Bamse owns the source/home/auth-free disposable package boundary, one bounded independent final review, commit/publication, exact-head TensorBuzz full/native CI, merge and post-merge native/package proof. No release/version bump/tag/npm publication is authorized by Task020. The entire task remains the delivery unit; Task021 and the expanded-cohort Task025 matrix are outside scope.
