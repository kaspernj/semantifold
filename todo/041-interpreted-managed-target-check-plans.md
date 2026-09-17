# 041 — Interpreted and managed text-target check plans

- Status: `roadmap`
- Phase/priority: Phase W / P1 target adoption
- Dependencies: [040-target-check-plan-and-java-javac.md](040-target-check-plan-and-java-javac.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Adopt the generic target check-plan contract for the remaining current interpreted and managed text targets: PHP, Ruby, JavaScript, TypeScript, Kotlin/JVM, Python, and C#.

## Current evidence and gap

Each target already declares real acceptance stages/toolchain IDs and has focused specs that construct exact commands. PHP, Ruby, and JavaScript currently declare execute-only acceptance after generation; Python uses `py_compile`; TypeScript, Kotlin, and C# compile through their real toolchains. These recipes are test-owned and cannot be selected by `build --check`.

## Target mappings

- **PHP:** syntax-check every generated PHP artifact with the configured PHP CLI; do not execute application behavior.
- **Ruby:** syntax-check generated Ruby with the configured Ruby CLI; do not load user gems or execute the application.
- **JavaScript:** parse/check generated JavaScript with the configured Node CLI without running program logic.
- **TypeScript:** compile/type-check the complete generated set using the exact installed TypeScript compiler profile and an isolated output/no-emit policy appropriate to the generated artifact contract.
- **Kotlin/JVM:** compile all generated Kotlin together to an isolated class/JAR root using the qualified `kotlinc`/JVM profile, without executing the JAR.
- **Python:** run the configured interpreter's real compile check with bytecode/cache output redirected to the owned build root; never write `__pycache__` beside generated source.
- **C#:** restore only in isolated offline state when declared project/lock inputs require it, then build with the qualified .NET profile. Ordinary unchanged watch cycles must not perform network access or unconditional restore.

Every plan uses exact arrays, isolated homes/caches/output roots where applicable, deterministic locale, no shell, no implicit PATH fallback beyond canonical tool discovery, and the same transactional publication callback from Task 040.

## Diagnostics and lifecycle

Normalize plan/tool/stage ownership but preserve native compiler output. Missing configured tools fail rather than skip. Restore/cache failures are distinct from compile failures. No target may execute generated code, discover user-global dependencies, mutate the source/output staging tree, or leave background compiler daemons/processes unowned.

## Tests

- One focused real-tool check per target from a generated supported fixture.
- Invalid generated-source fixtures at each plan boundary produce non-zero structured results and leave last-good generated/build roots untouched.
- Multi-artifact/project targets pass all generated files in deterministic order and place by-products only under the owned build root.
- C# restore-input hashing/offline isolation and Python bytecode isolation are explicit regressions.
- Repeated checks are deterministic and no child, cache lock, temporary home, or staging root leaks.
- Registry descriptors accurately report check support for exactly the adopted targets.

## Documentation

Update target/language support and testing docs with checker identities, offline/cache policy, output ownership, and explicit non-execution behavior. Add one behavior changelog fragment for the cohort.

## Non-goals

Filesystem watch orchestration, Java (Task 040), native/project targets (Task 042), hot reload, package installation, user dependencies, application targets, or runtime equivalence execution.

## Completion criteria

- All seven named targets produce target-owned generic check plans consumable by the same runner/CLI.
- Real tools check staged candidates offline/isolated where required; failures retain prior output and leave no residue.
- Focused real-tool specs, registry contracts, lint/typecheck, docs, changelog, and package gates pass.
