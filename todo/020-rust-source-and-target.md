# 020 — Rust source and target support

- Status: `todo`
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

- Use the Task 015-qualified official `tree-sitter-rust` grammar. Exhaustively traverse crate, item, type, block, statement, expression, attribute, and macro children; reject all error/missing/recovery nodes and convert byte ranges to UTF-16 locations.
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
