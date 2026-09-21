# 042 — Native and project text-target check plans

- Status: `implemented on feature branch; focused and static/package validation complete; review, CI, merge, and release pending`
- Phase/priority: Phase W / P1 target adoption
- Dependencies: [040-target-check-plan-and-java-javac.md](040-target-check-plan-and-java-javac.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Adopt the generic target check-plan contract for the current native/project text targets: Go, C, C++, Rust, Swift, Dart, and Zig.

## Current evidence and gap

These targets already generate deterministic source/project artifact sets and prove real compiler/validator/runtime paths in focused acceptance specs. Their exact stage arguments, isolated homes/caches, optimization/sanitizer profiles, restore rules, and output locations are currently assembled by tests rather than an importable target capability.

## Target mappings

- **Go:** use the qualified local Go toolchain with generated module files, cgo disabled, isolated caches, and deterministic build/vet checks without executing the program.
- **C:** compile/link the complete generated C/header set with the existing strict Clang C17 profile into the candidate generation's isolated target build subtree; preserve required ordinary/sanitizer qualification in CI without making every watch edit run every expensive profile.
- **C++:** compile/link generated C++ with the existing Clang/C++20/libstdc++ profile and isolated outputs.
- **Rust:** use the generated dependency-free Cargo project and lockfile with isolated `CARGO_HOME`/target output and offline locked check/build behavior; do not fetch crates.
- **Swift:** compile/type-check generated Swift with the qualified `swiftc` profile and isolated output, without running the executable.
- **Dart:** format verification/analyze plus the selected VM/native compile check in isolated pub/cache/build state; restore only when declared generated package/lock inputs change and never contact the network.
- **Zig:** invoke the generated project through the qualified Zig build/check profile with isolated global/local cache and a generation-scoped target build subtree.

Plans use the same exact-array, immutable-plan, canonical-discovery, single-pointer project-publication, diagnostic, cancellation, and child-close contracts as Task 040. Platform-specific optimization/sanitizer variants stay explicit CI profiles rather than hidden watcher branches.

## Diagnostics and lifecycle

Distinguish unavailable toolchain, invalid plan, offline dependency/restore violation, compile/link/validate failure, timeout/cancellation, and publication failure. Preserve compiler output and exact target context. A failed process must close before another cycle begins; no daemon, descendant, cache lock, native executable, or staging root may leak.

## Tests

- One focused real-tool check per target from generated Tasks 001–004-compatible source.
- Invalid staged source/project fixtures prove failure reporting and an unchanged last-good active generation.
- Generated manifests/lockfiles are consumed offline and no command resolves a user-global dependency or writes outside owned roots.
- C/C++ compile+link, Go vet/build, Rust locked/offline, Swift compile, Dart analyze/compile, and Zig build/check use the repository's qualified versions/profiles.
- Repeated checks are deterministic; registry descriptors report check support exactly.

## Documentation

Update native target/testing docs with exact developer-check profiles, isolated caches/output, expensive CI-only variants, and non-execution policy. Add one behavior changelog fragment for the cohort.

## Non-goals

Filesystem watch orchestration, runtime execution on every edit, cross-compilation beyond existing qualified profiles, package downloads, user dependencies, application targets, benchmarking, or changing target semantics.

## Completion criteria

- All seven named targets provide generic check plans without language switches in the CLI/runner.
- Real tools run offline and write only inside declared candidate-generation subtrees; failure preserves the prior active generation and leaks no resources.
- Focused real-tool specs, registry contracts, lint/typecheck, docs, changelog, and package gates pass.

## Implemented result

All seven targets now publish immutable target-owned plans through the unchanged public factory and language-neutral runner. Go performs a cgo-disabled, network/workspace/VCS-disabled trimmed build and read-only vet with isolated home/path/cache/temp state. C and C++ compile every translation unit and link through the strict Clang C17 or C++20/libstdc++ ordinary `-O0` developer profile while leaving sanitizer/optimization variants explicit acceptance/CI work. Rust accepts only the exact dependency-free Cargo manifest/lock, qualifies both Rustc and Cargo, binds Cargo to the exact discovered compiler, and runs locked offline build/check with all Cargo state transient. Swift type-checks and compiles with exact driver mode and warnings as errors. Dart accepts only its exact dependency-free package/lock, hashes only those restore inputs, performs an enforced offline dry run, compiles natively, verifies formatting, and analyzes fatally while removing `.dart_tool`, pub state, and its absolute-source-URI-bearing native check output. Zig accepts only its exact standard-library-only project, builds Debug with isolated caches and an owned transient prefix, and verifies canonical formatting.

The generic runner now retains the last declared compiler/linker output when later non-producing validators follow it, and declared candidate-source transient state is cleaned with the same post-close ownership rules as build transient state. No developer plan executes generated application code. `spec/native-project-target-check-plans.spec.js` covers exact capabilities, argv, immutability, offline/cache ownership, non-execution, and Dart restore identity. `spec/native-project-target-check-real-tools.spec.js` invokes all seven qualified real tools twice, injects invalid staged source for each target, preserves native diagnostics and exact target context, proves the prior active pointer/bytes remain authoritative, and checks that failed candidates and transient state do not leak. Task 045's terminal matrix and Task 046's binary/application policy remain untouched.
