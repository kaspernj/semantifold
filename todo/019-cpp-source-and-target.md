# 019 — C++ source and target support

- Status: `implemented locally; review corrections verified locally; coordinator verification / exact-head CI / merge pending`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md), [018-c-source-and-target.md](018-c-source-and-target.md)

## Purpose

Add C++ as a separate first-class frontend and native textual backend for the exact Tasks 001–004 subset. Reuse C's staged native acceptance, but define C++ value/ownership, overload, template, exception, and undefined-behavior boundaries independently.

## Semantic and source profile

- Map `integer` to `std::int64_t`, `boolean` to `bool`, and `string` to owned `std::string` values with UTF-8 bytes. Keep the safe-integer literal bound and one explicit deterministic signed-overflow policy; never inherit compiler undefined behavior.
- Semantic string assignment, arguments, and returns are value copies. Generated code may use compiler-visible moves/borrows only when observationally equivalent and provenance marks them as scaffolding. No semantic alias, identity, moved-from state, reference, or lifetime is exposed.
- Accept namespace-scope non-overloaded functions with the current exact two required by-value scalar parameters, explicit return types/returns, initialized typed locals, plain assignment, supported operators, braced conditionals, and canonical `main`.
- Fix one standard/compiler profile (initially C++20 with Clang unless qualification records a different baseline), standard library, execution encoding, warning policy, and exception/RTTI settings. Builds must not change arithmetic or error behavior by optimization mode.

## Frontend strategy

- Use the Task 015-qualified official `tree-sitter-cpp` grammar, not the C grammar or a source-mode guess. Exhaustively traverse translation-unit, declaration/declarator, function, block, and expression children and reject every error/missing/recovery node.
- Recognize only exact generated includes, qualified scalar names, support helpers, and `main` scaffolding. Resolve canonical types structurally; do not run the preprocessor or compiler as a semantic parser.
- Reject templates/concepts, overload sets/operators/conversions, auto/deduction, references/pointers, arrays, classes/structs/unions/enums as user values, constructors/destructors, inheritance, virtual dispatch, namespaces/using directives beyond exact scaffolding, exceptions, RTTI, casts, initializer lists, lambdas, coroutines, ranges, user-defined literals, macros, and unspecified-order constructs. Caller-authored calls nested in operands/arguments remain rejected unless they form the exact generated ordered-expression profile; do not infer left-to-right evaluation from ordinary C++ syntax.
- Standard-library implementation calls emitted for strings/printing are exact backend scaffolding. The frontend may collapse only those exact tree shapes on reparse; similar user calls remain unsupported.

## Backend and artifact strategy

- Emit one deterministic `program.cpp` artifact, using fully qualified standard names and no user build files or dependencies. If a support file becomes technically required, amend the artifact contract explicitly rather than treating it as a semantic module.
- Use owned `std::string` values and byte-counted output so embedded NUL and UTF-8 are exact. Avoid iostream locale/overload behavior in the observable print path.
- Reuse Task 018's backend-only ordered-expression planning algorithm for all expression-bearing statement contexts, eager operands, call arguments, and conditional/short-circuit evaluation. Emit the C++-specific `semantifold:ordered-expression:cpp:v1` region with the same deterministic `semantifold_ordered_` occurrence namespace and collision policy, using exact `std::int64_t`, `bool`, and owned `std::string` temporary types. C++ value moves/copies may optimize this scaffold only when observable order, value semantics, and mapped provenance remain identical.
- The C++ frontend independently recognizes its grammar's complete versioned region and collapses it to the original semantic expression under the same marker/number/type/dependency/short-circuit/final-consumer checks as C. Partial, forged, reordered, escaping, colliding, or C-tagged scaffolding fails as `UNSUPPORTED_SYNTAX`; C++ never delegates parsing to the C adapter.
- Validate target/reserved identifiers, class/function/scaffold collisions, integer and size boundaries, value-copy representability, and complete IR before emission.
- Generated source reparses to equivalent semantics after exact helper/copy/move scaffolding normalization and retains deterministic rich/Source Map v3 provenance.

## Ownership, errors, diagnostics, and rejections

- Library allocation failure and process termination are documented host-resource failures, not semantic exceptions. Generated code neither throws nor catches; frontend `throw`, `try`, exception specifications, and user RAII cleanup effects are rejected.
- No backend may select an overload based on an unmodeled conversion. Every emitted standard call/operator has fixed operand types proven before emission.
- Unsupported syntax/types use located frontend diagnostics. Backend ABI, identifier, integer, ownership, helper, and malformed-IR limitations use `UNSUPPORTED_CAPABILITY` before source is returned.

## Deterministic tests with the real toolchain

- Add C++ fixtures equivalent to Tasks 001–004 with Unicode/embedded-NUL strings, repeated value copies, concatenation, assignment, typed operators, and nested/fallthrough branches.
- Add negative coverage for C syntax accidentally accepted as C++, templates, overloads, implicit conversions, references/pointers, moves exposed by source, exceptions, preprocessor forms, recovered nodes, ambiguous declarators, undefined-overflow boundaries, malformed IR, reserved-prefix collisions, and partial/forged/out-of-order C++ or C-tagged sequencing regions.
- Discover and record real `clang++`; compile/link with the exact standard and warning/error flags in a fresh directory; execute and assert exact output/status. Missing compiler/linker/runtime fails.
- Run the same distinguishable left/right-call fixture and expression-context matrix as Task 018. A supported sanitizer-focused value-lifetime lane supplements mandatory unoptimized/optimized executions; all modes must prove exact left-before-right and short-circuit output as well as equal results.
- Generate/reparse C++ in both directions and cover representative original-five source/target crossings. Task 025 owns the expanded-cohort spanning matrix.

## Documentation

Document why C++ is not the C lane, selected standard/toolchain/standard-library profile, scalar/value mappings, copy/move/borrow boundaries, overflow/error behavior, exact scaffolding, compile flags, and exclusions. Update README/architecture/language/testing docs and add a behavior changelog fragment.

## Completion criteria

- C++ has independent frontend/backend registrations and cannot be selected through C.
- The complete Tasks 001–004 subset has deterministic left-to-right/short-circuit and value behavior without template, overload, reference, exception, or undefined-behavior leakage.
- Real Clang C++ compile/link/run, optimized parity, focused lifetime tests, equivalent reparse, and deterministic provenance pass.
- Cross-language, negative, diagnostics, docs/changelog, and all repository gates pass.

## Non-goals

C compatibility mode, templates/concepts/generics, overload resolution, classes/records, references/pointers, custom allocators, exception semantics, RAII as semantic behavior, STL containers, ranges/iterators, modules/headers, coroutines, RTTI, undefined behavior, ABI interoperability, or user build systems.

## Local implementation record — 2026-09-08

Task019 is implemented on `feature/cpp-source-target`, based on unchanged HEAD `8efbcab36078265765aad35ba38052dc187a7979`. The initial delivery recorded local acceptance only; the correction record below supersedes its pending-review state. No commit, push, PR mutation, tag, release or publication was performed.

The independent `cpp` frontend consumes official `tree-sitter-cpp@0.23.4` through the existing private frozen CST boundary. [The reproducible qualification](../docs/parser-qualification.md#task-019-c-grammar-qualification--2026-09-08) records ordinary npm resolution with exact Tree-sitter 0.21.1 and C 0.23.2, upstream identity, integrity, MIT license, ABI 14, strict typed API, Node24 loading, 390-node corpus traversal, UTF-16 coordinates, recovery and the 32,767-unit input limit. The single root distribution bundles the grammar; there is no new package identity or public adapter export.

Generation produces only `program.cpp` using the [C++20/Clang21/libstdc++ profile](../docs/cpp.md). Owned strings preserve UTF-8/NUL bytes and value copies; checked signed-64 operations exit 70 on dynamic overflow. The shared backend-only `ordered-expressions.js` planner retains C's occurrence algorithm and diagnostics. CPP independently validates complete versioned CPP CST regions, then reconstructs equivalent semantics with rich/v3 provenance. Semantic IR and the stdlib architecture are unchanged.

Local acceptance passed **256 distinct focused tests**, including **43 CPP tests** across nine files. Native acceptance exercised O0/O2 both ordinarily and under ASan/UBSan/leak detection; it covered every distinguishable C expression consumer, short-circuit path, value-copy/return path, signed extrema and four overflow operations. Five CPP fixture profiles execute into the original five targets, reparse/execute as CPP, and receive representative original-five source crossings. C regression coverage includes its 17 native tests, parser/backend rejection, ordered regions, ownership, provenance and crossings.

The private build/typecheck, normal `npm ci` payload refresh and consistency gate, credential-free packed-consumer proof (2/2), root lint/typecheck/build, audit (zero vulnerabilities), both complete dependency listings, package dry run and diff check pass. Tests ran through named focused files; no local full suite, shard or directory selection ran. TensorBuzz now installs the CPP Noble prerequisites using the existing signed Clang21 route and selects `SEMANTIFOLD_CLANGPP=/usr/bin/clang++-21`; the Noble CPP executions and full suite await coordinator CI.

Detailed plan, initial grammar qualification, original failing and passing TDD logs, command exits/counts, and final path inventory are in `/home/dev/.threadwire/semantifold/task019-cpp-20260908T061555Z-implementation/implementation-result.json`. Continuation handle: `01a07fa8-fdf8-7800-b7eb-688ee231874d`. The initial missing-lane tests and subsequent string-operator, literal-width, CST-depth, artifact-option and native compilation corrections have retained RED/GREEN evidence; added characterization coverage is not presented as previously failing behavior.

## Bounded review corrections — 2026-09-08

The one independent source review is complete. Its three material findings are corrected: Go's exact discovery assertion includes CPP while preserving Go's position and roles; CPP reserves the actual `<string>` header names `WEOF`/`wint_t` before artifacts; raw CR/LF in ordinary string-content nodes receives a located rejection. Clang reproduced both header collisions and the raw-CR parser/compiler mismatch before the production corrections. Escaped CR/LF, Unicode/NUL, supported source whitespace, ordinary CPP names and C's distinct include environment pass real native preservation tests.

The correction pass passed 129 focused tests across 16 explicitly named files, including mandatory O0/O2 sanitizer profiles, C native preservation (17/17) and the ordinary credential-free packed consumer (2/2). Lint, root/private typechecks and builds, audit (zero vulnerabilities), dependency listings, package dry run and diff check pass. No private runtime, dependency, architecture, other todo implementation or graph-depth behavior changed. No additional review or local aggregate suite ran. The coordinator previously verified 24 Noble native executions for the initial candidate; correction verification and exact-head CI/merge remain coordinator-owned.

Per-finding RED/GREEN commands, native compiler diagnostics, all final gate logs and complete current changed-path hashes are retained in `/home/dev/.threadwire/semantifold/task019-cpp-review-repair-20260908T071616Z-repair/repair-result.json`.
