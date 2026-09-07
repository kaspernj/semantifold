# 018 — C source and target support

- Status: `implementation and initial-review corrections delivered locally; coordinator verification/CI/merge pending`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Packaging prerequisite

Before Task 018 starts C frontend integration, the reviewed and merged root `semantifold@0.2.0` package graph must be verified to physically bundle root `tree-sitter@0.25.1` and the private internal legacy subtree with exact `tree-sitter@0.21.1` and `tree-sitter-c@0.23.2`. The root-tarball consumer proof must pass default npm install, full dependency listing, and clean `npm ci` without consumer-specific settings, resolve distinct runtime paths, and parse modern Go beside legacy C while exposing only recursively frozen parser-neutral data across the boundary. No separately published adapter is a prerequisite, and this task authorizes neither package publication nor C implementation before that packaged-root correction is reviewed, green in TensorBuzz, merged, and verified.

## Purpose

Add C as a first-class frontend and native textual/project backend for the exact Tasks 001–004 subset. C is its own language lane, not a restricted C++ mode. It establishes explicit fixed-width scalar, allocation/ownership, compile/link/run, and no-exception/no-GC contracts.

## Semantic and source profile

- Map `integer` to exact `int64_t`, `boolean` to exact `bool`, and `string` to a generated `SemantifoldString` immutable UTF-8 byte-slice value containing pointer and length. Do not use C `int`, `_Bool` aliases outside the canonical header, locale-dependent wide strings, or NUL-terminated strings as the semantic representation.
- Keep safe-integer literals even though storage is wider. Select one documented deterministic signed-overflow policy consistent with the existing semantic contract and reject any module the backend cannot represent; compiler undefined behavior is never accepted as semantics.
- The string support header owns allocation. Literals use static byte arrays; concatenation allocates checked storage in one generated module-lifetime arena; descriptor assignment and parameter passing borrow immutable slices; the generated entry cleanup frees arena allocations once. Embedded NUL and Unicode are preserved by lengths and UTF-8 bytes.
- Allocation failure has one explicit generated fatal path outside semantic user control. User-visible pointers, allocation/free, mutation, alias tests, ownership transfer, lifetime choice, and FFI do not enter the IR.
- Accept only one semantic translation unit including the exact generated support header, file-local semantic functions with the current two required parameters, explicit scalar returns, initialized typed locals, assignment, supported operators, braced conditionals, and canonical `main`.

## Frontend strategy

- Use the Task 015-qualified official `tree-sitter-c` grammar in C mode. Exhaustively traverse preprocessing, declarations/declarators, functions, blocks, and expressions; reject every error/missing/recovery node with converted UTF-16 spans.
- Recognize and remove only the exact generated include/runtime/main scaffolding and the ordered-expression regions defined below. The support header is a synthetic artifact and known type environment, not an implicitly parsed semantic module.
- Reject macros other than exact generated literal/scaffold forms, conditional compilation, typedef substitution outside the exact support type, implicit declarations/conversions, multiple/complex declarators, arrays, enums/structs/unions as user values, qualifiers beyond the profile, pointers, casts, address/dereference, `sizeof`, comma/ternary, goto/switch/loops, function pointers, variadics, static/global mutable state, and unspecified-order expressions. In particular, caller-authored calls nested in operator operands or call arguments are rejected unless they appear in one complete generated ordered-expression region; ordinary C syntax never proves semantic left-to-right order.
- Tree-sitter is the only source parser. Compiler diagnostics and preprocessed text cannot be used to recover semantic meaning.

## Backend and artifact strategy

- Emit deterministic `program.c` and `semantifold_runtime.h` artifacts. The header contains only namespaced scalar/string helpers and arena state required by the current IR; it must be warning-clean, deterministic, and collision-validated.
- Compile as one pinned standard profile (initially C17 unless qualification selects and documents a newer portable baseline) with Clang and explicit strict warning/error, optimization, overflow, execution-character-set, and locale-independent flags.
- Use `fwrite` plus explicit byte lengths for strings and canonical ASCII formatting for integers/booleans. Never use a string as a format or depend on current locale.
- After semantic validation and before writing C, run a backend-only ordered-expression planning pass that leaves the public IR unchanged. Treat every semantic `CallExpression` as potentially observable because its callee may contain `PrintStatement`. Recursively plan operands and call arguments in semantic left-to-right order, assigning each call result and each enclosing nontrivial result to typed generated temporaries before a pure final C expression consumes them.
- Apply that plan in the smallest enclosing block for local initializers, assignment right-hand sides, returns, print arguments, call arguments, and every conditional test; recursively lower nested expressions and branch statements. For eager unary/binary operations, emit the left prelude before the right prelude. For `BooleanAnd`/`BooleanOr`, emit an exact generated conditional region so the right prelude remains conditional and short-circuit behavior is preserved. String-concat helper calls receive already-sequenced temporary operands.
- Wrap each lowered semantic statement in paired, versioned parser-visible `semantifold:ordered-expression:c:v1` comment nodes. Allocate deterministic six-digit occurrence names under the reserved `semantifold_ordered_` prefix, with exact semantic result types (`int64_t`, `bool`, or `SemantifoldString`). Reject that prefix in caller C identifiers and reject any external IR/helper collision before emission; never choose a different name opportunistically.
- Validate target identifiers/reserved names, all integer operations, helper collisions, maximum object/memory sizes, control-flow shape, and string byte lengths before returning artifacts.
- On reparse, the C frontend may collapse only a complete ordered region whose marker version/language, consecutive occurrence numbers, temporary types, dependency order, short-circuit shape, final consumer, and enclosing block position exactly match the backend profile. It reconstructs the original nested semantic expression/statement and discards only those recognized temporaries. A missing/duplicate/reordered marker or temporary, extra read/write, wrong type/operator/consumer, escape outside the region, or prefix use outside an exact region is `UNSUPPORTED_SYNTAX`; no name-only heuristic or source-text fallback is allowed.
- Generated `program.c` reparses through the C frontend to equivalent semantic meaning after that exact scaffold recognition. Original operators/calls/final consumers retain rich/v3 source mappings; generated declarations, names, markers, and short-circuit control are synthetic with related operand/call origins.

## Diagnostics and rejections

- Missing/unsupported source types, declarator shapes, preprocessing, pointers, or ownership forms fail as located `MISSING_TYPE`/`UNSUPPORTED_SYNTAX`/`PARSE_ERROR` diagnostics.
- Backend integer, identifier, memory-size, ABI, helper, and IR limitations fail as `UNSUPPORTED_CAPABILITY` before either artifact is exposed.
- Do not simulate exceptions, garbage collection, dynamic strings, undefined signed overflow, unchecked allocation, or platform-width integer behavior.

## Deterministic tests with the real toolchain

- Add C fixtures equivalent to Tasks 001–004, including Unicode and embedded-NUL strings, repeated string copies/concatenations, assignment, every operator, and nested/fallthrough branches.
- Add rejection corpora for every pointer/preprocessor/declarator/ownership boundary, caller-authored unspecified-order expression, recovered tree, extra child, name collision, arithmetic boundary, allocation-size boundary, and malformed IR. Include forged, partial, duplicate, out-of-order, wrong-type, wrong-consumer, escaping, and reserved-prefix ordered scaffolds.
- Discover real `clang`; record its version; compile and link with explicit C profile flags in a fresh temporary directory; run the native executable; assert exact bytes/stdout/status. Missing compile, linker, or runtime execution capability fails.
- Add nested fixtures where left and right callees print distinguishable markers before returning values, and exercise them in initializers, assignments, returns, print arguments, call arguments, eager operators, conditional tests, and short-circuit operators. Compile/run at the required unoptimized and optimized levels and assert exact left-before-right output, skipped short-circuit effects, result, and exit status.
- Run an available sanitizer-enabled focused ownership lane where the canonical platform supports it, while retaining ordinary real execution as mandatory. Sanitizers supplement rather than replace deterministic assertions.
- Generate/reparse C in both directions and cover representative original-five source/target crossings. Task 025 owns the expanded-cohort spanning matrix.

## Documentation

Document the C standard/compiler baseline, exact scalar spellings, support-header profile, UTF-8 byte-slice ABI, arena ownership/cleanup, overflow policy, artifact shape, flags, and exclusions. Update README/architecture/language/testing docs and add a behavior changelog fragment.

## Completion criteria

- C is registered independently as frontend and native text/project backend.
- Tasks 001–004 normalize and execute with semantic left-to-right/short-circuit order and without pointer, ownership, NUL, locale, undefined-overflow, exception, or GC leakage.
- Real Clang compile/link/run ordering and focused ownership tests pass across required optimization modes; generated source reparses equivalently with deterministic artifacts/provenance and strict scaffold rejection.
- Cross-language, negative, diagnostics, docs/changelog, and repository gates pass.

## Non-goals

C++, arbitrary headers/includes/macros, user structs/unions/enums, pointer/reference semantics, manual allocation, arrays, function pointers, volatile/atomics, threads, signals, setjmp/longjmp, platform APIs, FFI, inline assembly, dynamic/shared libraries, or user build systems.

## Implementation delivery record — 2026-09-07

This section records the initial candidate before independent C review. The correction record below supersedes its pending-review status and gives validation of the corrected candidate.

The uncommitted candidate on `feature/c-source-target`, based on `9184660a21820b429138f0632c89df956a2e350f`, implements the criteria above. The packaging prerequisite is merged and verified at [PR 19](https://github.com/kaspernj/semantifold/pull/19); its review is closed. Local implementation delivery does not claim an independent C review, exact-head TensorBuzz result, merge, or publication. Those delivery steps remain coordinator-owned. This session made no commit, push, PR, review request, version, tag, or release, and ran no aggregate suite locally.

### Delivered acceptance

| Criterion | Implementation and focused evidence |
| --- | --- |
| Independent C frontend and native text backend | Ninth language registration, C17 Clang discovery, ordered compile/link/execute stages, fixed `program.c` entry plus synthetic `semantifold_runtime.h`; legacy single-artifact APIs reject C. `c-registry-toolchain` and `c-backend-validation` specs. |
| Exact scalar and arithmetic contract | `int64_t`, `bool`, immutable UTF-8 pointer/length descriptors; safe-integer literals, checked add/subtract/multiply/negate, known overflow rejected before artifacts. Native signed-64-bit extrema and all dynamic arithmetic failures execute at both optimization levels with and without sanitizers. |
| Arena allocation, ownership and failure | Static literal bytes; checked size addition, metadata and cumulative arena accounting; borrowed copies/parameters/returns; one module-lifetime cleanup. Real native linker instrumentation verifies exact allocation/free counts, second-allocation failure, no duplicate/foreign frees, and cleanup on normal/overflow/allocation-failure exits. Direct header probes reject invalid sizes before memory access. |
| Complete frontend boundaries | Unchanged root-bundled frozen parser-neutral C CST; complete child/field/declarator/preprocessor validation, recovery rejection and UTF-16 locations. Negative corpora cover pointers, qualifiers, ownership, conversions, macros, implicit forward declarations, unspecified-order nested calls, trigraphs, invalid Unicode/UTF-8, and unmodeled statements. |
| Ordered expressions and exact inverse | Backend-only occurrence planning sequences eager operands and arguments left to right, keeps short-circuit RHS effects conditional, and covers every statement consumer. Paired versioned comments and six-digit typed temporaries are validated through the complete CST, use/consumer/type checks and comparison with regenerated canonical CST. Missing, forged, reordered, duplicate, wrong-type, dead, reused, escaping and wrong-consumer regions reject before a module is returned. |
| Determinism and provenance | Stable program/header text, exact generated-source reparses, original operator/callee/consumer token origins, rich/v3 mappings, synthetic scaffolding/header related to source, shared-occurrence identities, stale metadata repair and UTF-16/CRLF coverage. |
| Tasks 001–004 and original-five crossings | Five C fixture profiles generate/reparse/execute all PHP, Ruby, JavaScript, TypeScript and Java targets; each original frontend also reaches generated C. Real PHP/Ruby/Node/tsc/javac/java commands are mandatory. Separate ordered-effect fixtures prove distinguishable left/right printing and skipped short-circuit calls. |
| Toolchain and repository integration | Coordinator's pinned Dockerfile changes preserved; TensorBuzz requires Clang/version/target/compiler-rt probes and labels nine-language O0/O2/sanitizer acceptance. No parser payload, dependency manifest, archive, consumer flag, public semantic operation, or API lifecycle change. README, architecture, language, mapping, parser qualification, operational testing, C profile and changelog updated. |

### RED/GREEN evidence

Commands below use the released standalone runner. Counts are passed/total; RED entries describe observed behavioral failures before their implementation or correction. Fixture/assertion setup corrections are not counted as behavioral RED evidence.

| Exact command | Behavioral RED | GREEN |
| --- | --- | --- |
| `npx velocious-test spec/c-registry-toolchain.spec.js` | 0/2: C registration/Clang tool ID unavailable | 3/3 after missing-tool coverage |
| `npx velocious-test spec/c-frontend-validation.spec.js` | 0/5: C frontend unsupported; later 6/8 for print-helper/Unicode boundaries and 8/9 for implicit forward calls | 11/11 |
| `npx velocious-test spec/c-backend-validation.spec.js` | 0/4: C backend unsupported; later 4/6 for size/cycle rejection, then malformed-location and literal/type-reference boundaries | 11/11 |
| `npx velocious-test spec/c-native-execution.spec.js` | 0/4: C backend unsupported; later 6/7 for compile/link/execute failure evidence | 10/10 |
| `npx velocious-test spec/c-ordered-expressions.spec.js` | 1/4: conditional consumer reconstruction and short-circuit operator mapping; later 3/4 for generated semantic-error normalization | 4/4 |
| `npx velocious-test spec/c-runtime-ownership.spec.js` | 1/4: fatal stderr omitted its required newline | 5/5 after allocation-count coverage |
| `npx velocious-test spec/c-frontend-validation.spec.js spec/c-backend-validation.spec.js` | 20/22: input-size error escaped as parser failure and oversized generated source was accepted | 22/22 |
| `npx velocious-test spec/repository-contract.spec.js` | 6/7: missing C environment/profile gates and label | 7/7 |

Final C coverage is **51 distinct tests across eight named files**: registry/toolchain 3, frontend 11, backend 11, ordered expressions 4, provenance 4, native execution 10, runtime ownership 5, and original-five crossings 3. Additional acceptance commands passed `npx velocious-test spec/c-provenance.spec.js` (4/4) and `npx velocious-test spec/c-cross-language-acceptance.spec.js` (3/3). After exact-size preflight refactoring, `npx velocious-test spec/c-backend-validation.spec.js spec/c-ordered-expressions.spec.js spec/c-provenance.spec.js` passed 19/19; native execution and crossings also passed on the final implementation.

Affected existing coverage passed **139 distinct tests across 15 named files**, bringing local focused coverage to **190 distinct tests**. These commands were executed sequentially, one/few files per invocation:

| Exact command | Result |
| --- | --- |
| `npx velocious-test spec/c-registry-toolchain.spec.js spec/language-registry.spec.js spec/public-api.spec.js` | 15/15, including the three C registry tests counted above |
| `npx velocious-test spec/go-registry-toolchain.spec.js spec/toolchain-acceptance.spec.js` | 31/31 |
| `npx velocious-test spec/backend-shape-validation.spec.js spec/backend-identifier-validation.spec.js spec/typed-operator-validation.spec.js` | 41/41 |
| `npx velocious-test spec/generated-artifact-set.spec.js spec/source-provenance.spec.js spec/source-mapping.spec.js` | 33/33 |
| `npx velocious-test spec/repository-contract.spec.js` | 7/7 |
| `npx velocious-test spec/tree-sitter-legacy-adapter.spec.js` | 3/3 |
| `npx velocious-test spec/tree-sitter-legacy-packed-consumer.spec.js` | 2/2; repeated on final production code |
| `npx velocious-test spec/mapping-language-matrix.spec.js spec/typed-operators-and-expressions.spec.js` | 10/10 |

### Native and package evidence

Actual installed versions are `clang=1:21.1.6-71`, `clang-21=1:21.1.8-6ubuntu1`, and `libclang-rt-21-dev=1:21.1.8-6ubuntu1`; discovery returns Ubuntu Clang 21.1.8, `x86_64-pc-linux-gnu`. [docs/testing.md](../docs/testing.md) records portable image/CI qualification commands and every strict C17, optimization, encoding, overflow and sanitizer flag. Each C program compiles, links and executes separately in a fresh directory; cleanup failures remain failures.

One complete execution of the three C native/ownership/crossing spec files performs **106 native program launches**: 69 expected status-zero results, 36 deterministic fatal status-70 results, and one intentional status-7 execution-stage failure. This includes O0 and O2, each ordinary and ASan/UBSan with leak detection; all expected stdout/stderr/status assertions pass. Three intentional compile failures and one intentional link failure separately verify stage evidence. C-to-original-five coverage executes another **25 real target programs**. No compiler, runtime or sanitizer skip/fallback substitutes for these checks.

`npm run verify:legacy-runtime` passed before focused testing and packing. `npm run lint`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high` (zero vulnerabilities), `npm ls --omit=dev --all`, `npm ls --all`, `npm pack --dry-run --json`, and `git diff --check` passed. Lint and prepack include the unchanged private workspace gates. The packed-consumer spec verifies public C parse/generate/reparse and type usage after ordinary install and clean `npm ci`, while preserving fresh-cache, credential-free ordinary npm defaults and both isolated bundled runtimes. Aggregate `npm test` remains a TensorBuzz-only gate for the coordinator's exact candidate head.

### Changed file groups and remaining limits

New production files are `src/frontends/c.js`, `src/frontends/c-parser.js`, `src/backends/c.js`, `src/backends/c-ordered-expressions.js`, `src/backends/c-runtime.js`, and `src/backends/c-validation.js`. Existing scalar/identifier/shared validation, language/toolchain registration, semantic language/provenance and mapping files adopt C. Eight C specs, `spec/support/c-toolchain.js`, six C fixtures and the ordered TypeScript fixture provide direct coverage. Existing registration, public API, toolchain, repository-contract and packed-consumer specs cover the integration. Documentation, the task/roadmap record, the changelog fragment, Dockerfile and TensorBuzz configuration complete the candidate.

The canonical native ABI is qualified Linux x86-64; the header statically rejects an incompatible byte/int64/size/pointer-difference ABI. Checked dynamic overflow and allocation/output failures terminate with status 70 after arena cleanup. The immutable arena retains concatenations until module exit. These are documented C target capabilities, with no new user-visible ownership operations.

The frozen parser was measured to accept at most **32,767 UTF-16 code units** per source, including comments/whitespace; 32,768 fails in the unchanged parser. Frontend input validation and exact backend output-size preflight enforce that boundary before exposing artifacts. Strict C17 additionally limits each decoded string literal to **4,095 bytes**; larger runtime concatenations are supported. Cycles, traversal depth above 512, and expanded occurrence plans above 999,999 reject with located capability diagnostics. These limits are explicit in [docs/c.md](../docs/c.md); no parser buffer override, dependency modification, compiler-capacity flag, or consumer setting is used to evade them. All task non-goals remain excluded.

## Initial independent review and correction record — 2026-09-07

The single independent C review of frozen candidate `f8a41d82d805718931f841076d50197ed9052702` completed as a source-only review and identified four material findings. The original implementation session reproduced all four with public API regressions and real Clang evidence before production edits, then completed one narrow correction pass. This is local correction evidence; coordinator verification, exact-head TensorBuzz, publication of the C candidate and merge remain pending. No additional review or routine re-review was launched. Packaging [PR 19](https://github.com/kaspernj/semantifold/pull/19) remains merged, closed and unchanged.

| Finding | Reproduction and causal correction | Failing regressions closed |
| --- | --- | --- |
| P1 preprocessing-sensitive comments | Inserting a line comment followed by actual lone CR and a print into generated main made Clang print `99\n13\n`, while the public frontend discarded the extra statement. Parser-backed comments now reject line splices and line-comment content after a bare CR before extraction or canonical comparison. Split block-comment terminators also reject. A split opener already produced `PARSE_ERROR` and retains that rejection. Ordinary line/block comments, exact markers and CRLF still reparse and execute. | 3: frontend, ordered comparison and native differential |
| P1 split hexadecimal escapes | Native `"\x000041"` prints bytes `41 0a`; the parser divides it into escape `\x0000` and content `41`. Adjacent parser-owned node types, spellings and spans now reject a continued hex digit rather than constructing different bytes. Bounded escapes, nonhex suffixes, octal, embedded NUL and Unicode remain supported before and after generation. | 2: frontend and native differential |
| P2 uppercase Boolean spellings | Undeclared `TRUE`/`FALSE` were accepted as constants; legal native bindings with those names returned their actual arguments instead. Exact lowercase literal spelling is now required, and both uppercase names are reserved consistently for C expressions, parameters, locals and functions. Target collisions fail before artifacts. Native tests also prove undeclared uppercase expressions fail compilation. | 5: two frontend, two backend and one native differential |
| P2 `MB_LEN_MAX` collision | Generated parameter spelling collided with the macro from the real included `<limits.h>` and failed native compilation. The shared C identifier boundary now reserves that exact macro in both frontend and backend, with located diagnostics before artifacts. | 3: frontend, backend and native compilation |

The clean behavioral RED commands below ran before production changes. Every listed failure was a missing expected public diagnostic; initial fixture/assertion setup corrections are excluded from these counts. GREEN reran the same commands with unchanged rejection assertions:

| Exact command | RED | GREEN |
| --- | --- | --- |
| `npx velocious-test spec/c-frontend-validation.spec.js spec/c-backend-validation.spec.js spec/c-ordered-expressions.spec.js` | 27 passed, 9 failed, 36 total | 36 passed, 0 failed |
| `npx velocious-test spec/c-native-execution.spec.js` | 12 passed, 4 failed, 16 total; real native comparisons had passed before the public rejection assertions failed | 16 passed, 0 failed |

This adds 16 focused tests: 13 rejection regressions and three positive preservation tests. Final C coverage is **67/67 across all eight C spec files**: frontend 17, backend 14, ordered expressions 5, native execution 16, registry/toolchain 3, provenance 4, runtime ownership 5, and original-five crossings 3. The remaining focused commands ran sequentially:

| Exact command | GREEN |
| --- | --- |
| `npx velocious-test spec/c-registry-toolchain.spec.js spec/c-provenance.spec.js` | 7/7 |
| `npx velocious-test spec/c-runtime-ownership.spec.js` | 5/5 |
| `npx velocious-test spec/c-cross-language-acceptance.spec.js` | 3/3 |
| `npx velocious-test spec/backend-identifier-validation.spec.js spec/mapping-language-matrix.spec.js spec/typed-operators-and-expressions.spec.js` | 18/18 |
| `npx velocious-test spec/tree-sitter-legacy-adapter.spec.js spec/repository-contract.spec.js` | 10/10 |
| `npx velocious-test spec/tree-sitter-legacy-packed-consumer.spec.js` | 2/2 |

The correction pass therefore validated **97 distinct tests in 14 explicit named files**, including all 67 C tests. The three C native/ownership/crossing files now perform **134 native program launches** per complete execution: 97 expected successes, 36 deterministic fatal status-70 exits, and one intentional status-7 stage failure. Six intentional compile failures and one intentional link failure verify rejection evidence separately. O0/O2 ordinary and ASan/UBSan/leak profiles remain mandatory and pass exact output/status checks, with byte assertions for NUL/Unicode and the hex mismatch. The 25 C-to-original-five target executions also pass with real PHP/Ruby/Node/tsc/javac/java. No flags, timeouts, capacities, toolchain versions, runtime helpers, ownership rules, parser payloads or dependencies changed during correction.

Required gates passed again: `npm run verify:legacy-runtime` first, `npm run lint`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high` (zero vulnerabilities), `npm ls --omit=dev --all`, `npm ls --all`, `npm pack --dry-run --json` and `git diff --check`. Packed-consumer install and clean `npm ci` retain ordinary npm defaults and verify the shipped C API and both bundled runtimes. Aggregate tests/directories/shards remain TensorBuzz-only.

Correction edits are limited to ten existing candidate files: `src/frontends/c.js`, `src/backends/identifiers.js`, the four `spec/c-{frontend-validation,backend-validation,ordered-expressions,native-execution}.spec.js` files, `docs/c.md`, `changelog.d/20260907135939-c-source-and-target.md`, this task record and `todo/README.md`. All changes remain uncommitted on `feature/c-source-target` at base `9184660a21820b429138f0632c89df956a2e350f`. No local technical blocker remains; the documented C profile limits still apply. Coordinator verification and external delivery are outstanding, and no CI, merge or release result is claimed.


### Exact-head CI setup correction — PR 20

The first PR20 generation at `460a0083bdae154eebdfaa031f034e14fb883b8c` failed both checks before tests: the standard CI base uses Ubuntu 24.04 Noble while `tensorbuzz.yml` incorrectly carried the development image's Ubuntu 26.04 Clang pins. The coordinator had already qualified official signed LLVM Noble packages on the standard CI base, but that requirement was not carried into the candidate before publication.

This directly causal operational correction applies the previously qualified LLVM Noble source, exact compiler/compiler-rt versions, checksum-pinned signing key and explicit `/usr/bin/clang-21` selection only to CI; it updates the existing configuration contract and the two-environment qualification documentation. No C production source, parser, runtime, public contract, dependency, capacity, timeout, runner or development-image change is included. The existing repository-contract test reproduced the mismatched compiler path (6 passed, 1 failed) before the CI correction. Exact-head CI remains the aggregate acceptance gate; no merge, npm publication, release or tag is claimed by this historical record.

The corrected CI setup subsequently passed a fresh standard Noble base installation using the exact checked-in signed-repository commands, followed by generated C arithmetic and Unicode/NUL compile/link/execute as UID1000 in all four O0/O2 ordinary/sanitized profiles. Compiler 21.1.8, native target and installed package versions matched. Repository contract 7/7, C registry/toolchain 3/3, native execution 16/16 and packed-consumer 2/2 passed, as did lint, typecheck, build and diff checks. These are local qualification results; the corrected-head TensorBuzz aggregate verdict is still required.
