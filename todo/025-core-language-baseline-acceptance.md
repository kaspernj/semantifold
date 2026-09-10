# 025 — Core expanded-language baseline acceptance

- Status: `done — merged as PR 27 at 78ff710081a6385ffc887a14c66f45b918998ff8`
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
- Include functions whose bodies print distinct `left`/`right` markers before returning scalar values, then use their calls as nested operands/arguments across every new backend. C and C++ must use their exact versioned ordered-expression scaffolds, reparse/collapse to the original expression, and produce left-before-right output in every required unoptimized and optimized Clang run; ordinary unspecified-order source forms and malformed scaffolds remain rejected by their owning tasks.
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

## Implementation delivery record — 2026-09-09

- Added one data-driven core acceptance spec for the eight expanded languages and one shared fail-loud diagnostic spec. Existing per-language fixtures and real-toolchain helpers remain the source of language-specific behavior; C# and Go helper logic was extracted for reuse rather than duplicated.
- The initial RED found that the C# base fixture alone represented signed subtraction instead of the shared conditional absolute-difference meaning. Correcting that fixture established the common five-profile corpus without widening semantic IR. A later real ordered-expression RED found that generated Swift `piece(…) + piece(…)` reparsed through the qualified grammar as a trailing-call additive CST shape; the frontend now consumes that parser shape directly, with a focused regression and no source-text fallback.
- Local GREEN evidence is `7/7` core baseline acceptance, `4/4` shared diagnostics, `16/16` Swift frontend validation, `3/3` C# parser qualification, `5/5` C# frontend validation, `4/4` C# cross-language acceptance, and `5/5` Go cross-language acceptance. The core run used Python 3.14.4, .NET SDK 10.0.112, Clang/Clang++ 21.1.8, Rust/Cargo 1.98.1, Swift 6.3.3, Kotlin 2.4.20 on Java 25.0.4, and Go 1.26.0; unavailable tools remain failures.
- Repository gates passed locally: legacy-runtime consistency and ESLint, root/workspace strict typecheck (through `npm run lint`), root/workspace build, high-severity audit with zero vulnerabilities, production and complete dependency listings, package dry-run, and `git diff --check`. No aggregate suite, shard, Wasm/mobile/later-language lane, compiler download, external review, CI, publication, or remote mutation was run.
- Coordinator-owned independent review and exact-head TensorBuzz completed successfully, and PR 27 was merged at `78ff710081a6385ffc887a14c66f45b918998ff8`. That merged commit is the Task 005 base; no Task 005 behavior is retroactively attributed to Task 025.

## Non-goals

An all-pairs matrix, Tasks 005+ semantics, Wasm, mobile applications, compiler installation, benchmarks, performance equivalence, or declaring every registered role complete for every capability.
