# 025 — Core expanded-language baseline acceptance

- Status: `todo`
- Phase/priority: Phase L1 / P0 gate
- Dependencies: [016-python-source-and-target.md](016-python-source-and-target.md), [017-csharp-source-and-target.md](017-csharp-source-and-target.md), [018-c-source-and-target.md](018-c-source-and-target.md), [019-cpp-source-and-target.md](019-cpp-source-and-target.md), [020-rust-source-and-target.md](020-rust-source-and-target.md), [022-swift-source-and-target.md](022-swift-source-and-target.md), [023-kotlin-source-and-target.md](023-kotlin-source-and-target.md), [024-go-source-and-target.md](024-go-source-and-target.md)

## Purpose

Prove that Python, C#, C, C++, Rust, Swift, Kotlin/JVM, and Go all implement the same delivered Tasks 001–004 meaning before Tasks 005 and 007 expand the IR. This is a bounded spanning acceptance gate, not a promise of every source/target pair or any new semantic behavior.

## Acceptance profile and dependencies

- Freeze a canonical, location-neutral Tasks 001–004 semantic fixture corpus: scalars, explicit locals/mutation, every operator, sequencing, nested/two- and one-armed conditionals, explicit return, direct two-argument functions, and entry printing.
- Require each new frontend to normalize its equivalent fixture to that corpus and each new backend to execute it exactly. Require one same-language generation/reparse round trip per language.
- Add a small deterministic set of cross-family paths that exercises registry composition: dynamic-to-native, managed-to-native, native-to-managed, and original-five-to-each-new-backend. Do not create a quadratic all-pairs matrix.
- Task 025 adds tests, fixtures, documentation, and truthful capability checks only. It does not widen Tasks 001–004 or gate Browser Wasm/application/later-language tasks into Task 005.

## Artifact, toolchain, and provenance strategy

- Exercise the exact artifact envelope and toolchain manifest from Task 015 for every language: single text for Python/Swift, managed projects or JARs for C#/Kotlin, native project/artifact sets for C/C++/Rust/Go.
- Compile and run with every real interpreter/compiler/runtime mandated by Tasks 016–020 and 022–024. Missing configured tools fail; tests never download compilers, SDKs, parser binaries, or dependencies.
- Compare runtime output, exit status, semantic evaluation order, and documented overflow behavior. Generate every selected artifact set twice and compare ordered filenames, bytes, rich mappings, Source Map v3 where applicable, and semantic/synthetic provenance.
- Reparse generated sources with their registered frontend. Generated helpers and entry shells must be identified as synthetic rather than assigned false input spans.

## Diagnostics and fail-loud coverage

- Maintain a shared rejection corpus for parse recovery, missing types, truthiness, numeric/Boolean coercion, overflow, unsupported dynamic/reflection/concurrency/exception forms, illegal target names, and malformed caller-owned IR. Assert `UNSUPPORTED_ROLE` when a known registered ID lacks the requested role and located `UNSUPPORTED_CAPABILITY` when an existing role lacks the requested semantic feature.
- Assert stable diagnostic code, responsible source filename/range, and source-language context. Backends must validate complete capability before returning an artifact set; no target may obtain passing output through a hidden approximation.
- Query the public registry/capability API and assert that every language advertises exactly the frontend/backend/artifact features it passed. Unimplemented Task 005+ capabilities and platform roles remain explicit rejections.

## Deterministic tests

- Keep fixture generation data-driven, but invoke actual Python, .NET, C, C++, Rust, Swift, Kotlin/JVM, and Go commands rather than snapshots or source-only assertions.
- Run native and managed optimized/unoptimized variants required by owning tasks; isolate caches and force offline/local-toolchain modes. Record exact tool versions in failure output.
- Include non-ASCII identifiers where allowed, Unicode strings, boundary integer values, and repeated generation from multiple source filenames to verify UTF-8/UTF-16 mapping and collision behavior.
- The canonical Linux lane covers tools supported there; a platform-specific lane may be declared only when a language's supported compiler requires it. Missing a declared lane is failure, never a skip.

## Documentation

Update language-support/capability and testing documentation with the core cohort, exact spanning matrix, toolchain prerequisites, artifact shapes, known exclusions, and the distinction from original-five Task 013. Add a behavior changelog fragment.

## Completion criteria

- Every dependency task is complete and every language passes normalization, backend execution, same-language round trip, and the selected spanning crossings for Tasks 001–004.
- All real toolchain, diagnostic, rejection, deterministic artifact, and provenance assertions pass with truthful registry discovery.
- Task 005 and Task 007 may rely on one verified small IR without inheriting Browser Wasm, mobile app, Objective-C, Dart/Flutter, or Zig as prerequisites.

## Non-goals

An all-pairs matrix, Tasks 005+ semantics, Wasm, mobile applications, compiler installation, benchmarks, performance equivalence, or declaring every registered role complete for every capability.
