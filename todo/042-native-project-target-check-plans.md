# 042 — Native and project text-target check plans

- Status: `roadmap`
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
