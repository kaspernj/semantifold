# 018 — C source and target support

- Status: `todo`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

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
