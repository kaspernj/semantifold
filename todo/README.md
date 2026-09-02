# Language feature roadmap

## Purpose and baseline

This folder is the durable, dependency-ordered implementation backlog for expanding Semantifold's language-neutral semantic subset. It is research and planning, not a claim that any listed capability is implemented. The evidence baseline is merged `master` commit `9e85016b927040f8b2a056ad4136ae3c5fa6fae7`; exact repository and external sources are recorded in [SOURCES.md](SOURCES.md).

At that baseline, Semantifold models one `integer` type; safe integer literals; identifiers; `+`, `-`, and `>` binary expressions; unqualified calls; functions with exactly two required integer parameters; a body containing exactly one `if`/`else`; one return in each branch; and an entry point containing exactly one print. PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java frontends normalize that slice, and all five backends generate executable source. This roadmap does not broaden that baseline by documentation alone.

## Guiding principles

1. Model meaning once. Semantic nodes describe values, types, evaluation order, bindings, control flow, and named program structure without embedding parser nodes or target spelling.
2. Keep source and target capabilities separate. A frontend raises `UNSUPPORTED_SYNTAX`, `MISSING_TYPE`, or `PARSE_ERROR` at the best source span; a backend raises `UNSUPPORTED_CAPABILITY` at the originating semantic span before emitting any source.
3. Never recover meaning from source text after an adapter rejects a parser node. Extend the existing Prism, Babel, `php-parser`, and Lezer adapters through their trees.
4. Prefer a precisely portable subset over coincidentally similar syntax. Truthiness, numeric division and overflow, missing map keys, nullability, call binding, equality, exceptions, and concurrency differ and require explicit semantic contracts.
5. Keep source-only rules in frontends (annotation association, declaration forms, parser errors) and target-only rules in backends (identifier legality, representable values, runtime/library availability, file layout).
6. Add a focused spec and matching documentation with each behavior change. When generated execution applies, invoke real `php`, `ruby`, `node`, local `tsc`, `javac`, and `java`; unavailable commands fail rather than skip.
7. Preserve source locations on every new semantic node, type constituent, declaration, binding, branch, argument, member, and import edge. Generated reparses have generated locations; semantic diagnostics retain original locations.
8. Do not replace the current parsers, add a custom parser, expose parser trees publicly, or redesign Semantifold into a compiler framework.

## Prioritized phases

### Phase 0 — semantic foundations (P0)

- [001 — Portable scalar values and types](001-portable-scalar-values-and-types.md)
- [002 — Local declarations and assignment](002-local-declarations-and-assignment.md)
- [003 — Typed operators and richer expressions](003-typed-operators-and-expressions.md)
- [004 — Statement sequencing and general conditionals](004-statement-sequencing-and-conditionals.md)
- [005 — General required function signatures and calls](005-general-function-signatures-and-calls.md)

These tasks remove hard-coded fixture shape while retaining explicit types, synchronous direct calls, and structured control flow.

### Phase 1 — portable data and iteration (P1)

- [006 — Immutable lists and maps](006-immutable-lists-and-maps.md)
- [007 — Optional values and presence narrowing](007-optional-values-and-presence-narrowing.md)
- [008 — Ordered list iteration](008-collection-iteration.md)
- [013 — Five-language compatibility acceptance](013-five-language-compatibility-acceptance.md)

Task 013 is the terminal acceptance task for the selected near-term slice, tasks 001–008. It does not wait for the conditional Phase 2/3 work.

### Phase 2 — named structure and failure (P2, conditional)

- [009 — Closed records and member access](009-closed-records-and-member-access.md)
- [010 — Multi-file modules and names](010-multifile-modules-and-names.md)
- [011 — Typed errors and handling](011-typed-errors-and-handling.md)
- [014 — Ordered map iteration](014-ordered-map-iteration.md)

These are implementation-ready directions, but should start only after the portable slice is green. Task 014 also requires a distinct ordered-map semantic type and a genuinely ordered target representation; ordinary maps from Task 006 remain non-iterable. General inheritance, mutable object identity, arbitrary thrown values, and dependency installation remain excluded.

### Phase 3 — parametric abstraction (P3, conditional)

- [012 — Type parameters and generic declarations](012-type-parameters-and-generics.md)

Generic declarations come after concrete collection and record types. PHP has no native generic declarations, so PHP support remains conditional on an explicit, parser-backed documentation convention; erasing unknown type parameters is not acceptable.

## Feature and language coverage matrix

Legend: **now** is implemented at the baseline; **next** is in the Phase 0/1 portable slice; **later** is a conditional Phase 2/3 task; **reject** is deliberately out of scope for this roadmap.

| Semantic area | Ruby | JavaScript + JSDoc | TypeScript | PHP | Java | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| Integer fixture slice | now | now | now | now | now | Preserve while generalizing shape. |
| Boolean and string values/types | next | next | next | next | next | Task 001; explicit annotations and exact literal preservation. |
| Floating-point values | later | later | later | later | later | Conditional on a written IEEE-754/printing contract and JS/TS `number` disambiguation; exclude NaN, infinities, and negative zero initially. |
| Local declarations and assignment | next | next | next | next | next | Task 002; simple identifiers, explicit types, initializer required. |
| Richer operators | next | next | next | next | next | Task 003; type-directed portable operators, strict boolean conditions. |
| Sequenced blocks and broader `if` | next | next | next | next | next | Task 004; optional `else`, nested branches, multiple statements. |
| Required function signatures/calls of arbitrary arity | next | next | next | next | next | Task 005; optional/rest/keyword/overloaded/higher-order calls later or rejected. |
| Immutable lists and maps | next | next | next | next | next | Task 006; lists preserve order; maps support construction, lookup, and size without a portable iteration-order promise. |
| Optional values | next | next | next | next | next | Task 007; Java maps to `Optional<T>`, not implicit nullable references. |
| Arbitrary unions | later | later | later | later | later | Defer until closed variants can be represented after Task 009; do not emit `Object`, `mixed`, or untyped unions. |
| List iteration | next | next | next | next | next | Task 008; one insertion-ordered list `for-each` semantic operation. |
| Map iteration | later | later | later | later | later | Task 014; defer until ordered maps are distinct in the IR and every target uses a validated ordered representation. Java `Map.of`/`Map.ofEntries` are not ordered representations. |
| Records/member access | later | later | later | later | later | Task 009; immutable closed product values before general classes. |
| Modules/imports/namespaces/packages | later | later | later | later | later | Task 010; explicit multi-file artifact API and name resolution. |
| Exceptions/error handling | later | later | later | later | later | Task 011; one typed unchecked error path before full exception systems. |
| Type parameters/generics | later | later | later | conditional | later | Task 012; no silent PHP erasure. |
| Async/concurrency | reject | reject | reject | reject | reject | No shared scheduling, cancellation, ordering, or memory model is selected. |
| Language-specific dynamic features | reject | reject | reject | reject | reject | No metaprogramming, `eval`, monkey-patching, prototype mutation, variable variables, reflection, dynamic loading, or unchecked casts. |

## Dependency graph

```text
001 portable scalars
├── 002 locals and assignment
│   └── 004 sequencing and conditionals
│       ├── 005 signatures and calls
│       │   ├── 006 lists and maps
│       │   │   ├── 008 ordered list iteration
│       │   │   │   └── 014 ordered map iteration (also 006)
│       │   │   └── 009 closed records
│       │   └── 010 multi-file modules (also 009)
│       └── 011 typed errors (also 007 and 009)
├── 003 operators ───────────────┘
└── 007 optionals (also 003 and 004)

012 type parameters depends on 005, 006, and 009
013 terminal portable acceptance depends on 001 through 008
```

Dependencies in each task file are authoritative. The graph shows the major flow; work on siblings may proceed independently only after their listed dependencies are complete.

## Task index

| Task | Phase | Priority | Capability | Direct dependencies |
| --- | --- | --- | --- | --- |
| [001](001-portable-scalar-values-and-types.md) | 0 | P0 | Boolean/string scalar foundation and numeric contract | none |
| [002](002-local-declarations-and-assignment.md) | 0 | P0 | Typed locals and simple assignment | 001 |
| [003](003-typed-operators-and-expressions.md) | 0 | P0 | Type-directed unary/binary expressions | 001 |
| [004](004-statement-sequencing-and-conditionals.md) | 0 | P0 | General blocks and conditionals | 002, 003 |
| [005](005-general-function-signatures-and-calls.md) | 0 | P0 | Arbitrary required arity and void/direct calls | 001, 004 |
| [006](006-immutable-lists-and-maps.md) | 1 | P1 | Homogeneous immutable lists/maps and reads | 002, 003, 005 |
| [007](007-optional-values-and-presence-narrowing.md) | 1 | P1 | Explicit optional values and narrowing | 001, 003, 004 |
| [008](008-collection-iteration.md) | 1 | P1 | Ordered list iteration | 002, 004, 006 |
| [009](009-closed-records-and-member-access.md) | 2 | P2 | Immutable records, construction, members | 002, 005, 006, 007 |
| [010](010-multifile-modules-and-names.md) | 2 | P2 | Multi-file symbols and target artifacts | 005, 009 |
| [011](011-typed-errors-and-handling.md) | 2 | P2 | Typed raise/try/catch | 004, 007, 009 |
| [012](012-type-parameters-and-generics.md) | 3 | P3 | Generic declarations and applications | 005, 006, 009 |
| [013](013-five-language-compatibility-acceptance.md) | 1 | P1 | Terminal near-term compatibility proof | 001–008 |
| [014](014-ordered-map-iteration.md) | 2 | P2 | Distinct ordered maps and insertion-order iteration | 006, 008 |

## Definition of done

A task is complete only when all of its completion criteria are met and the following repository-wide rules hold:

- semantic public values use only discriminated types from `src/semantic/types.js`; parser values remain inside `src/frontends/` and target syntax remains inside `src/backends/`;
- every accepted source child is converted and every unmodeled child fails loudly at its own location;
- shared semantic validation checks well-formedness and symbol/type rules, while every backend validates its own complete capability before emission;
- stable diagnostic codes and source locations are asserted for representative frontend, semantic, and backend failures;
- focused fixtures prove equivalent modeled meaning across all five languages, and applicable generation specs compile/run real PHP, Ruby, JavaScript, TypeScript, and Java programs with exact behavior rather than snapshots;
- generated source reparses to equivalent modeled meaning wherever the feature is intended to round-trip;
- README and `docs/language-support.md` distinguish implemented behavior, source constraints, target constraints, and remaining exclusions, and a changelog fragment accompanies the behavior change;
- `npm test`, lint, typecheck, build, packaging/audit gates, and `git diff --check` pass as required by `AGENTS.md`.

## Explicit exclusions

This roadmap does not authorize production changes by itself. It excludes parser replacement, source-text parsing fallbacks, a custom grammar, parser AST exposure, lossless formatting, macro systems, project dependency installation, package-manager resolution, reflection, runtime code evaluation, native/Wasm/JVM-bytecode backends, an interpreter, optimizer, or compiler-framework rewrite.

Async functions, promises/futures as effects, generators, threads, fibers, ractors, event loops, locks, atomics, Java virtual threads, and cancellation are non-goals until a separate proposal defines shared effect, scheduling, cancellation, ordering, error, and resource-lifetime semantics. Ruby metaprogramming and monkey-patching, JavaScript prototype mutation and coercive dynamic calls, PHP variable variables/magic methods, TypeScript `any`/unchecked assertions, and Java reflection/dynamic class loading are likewise explicit non-goals. Source-valid occurrences must continue to fail loudly rather than be approximated.
