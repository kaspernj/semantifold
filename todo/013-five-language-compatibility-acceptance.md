# 013 — Five-language compatibility acceptance

- Status: `todo` (legacy original-five acceptance)
- Phase/priority: Phase 1 / P1 legacy terminal acceptance
- Dependencies: [001-portable-scalar-values-and-types.md](001-portable-scalar-values-and-types.md), [002-local-declarations-and-assignment.md](002-local-declarations-and-assignment.md), [003-typed-operators-and-expressions.md](003-typed-operators-and-expressions.md), [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md), [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [006-immutable-lists-and-maps.md](006-immutable-lists-and-maps.md), [007-optional-values-and-presence-narrowing.md](007-optional-values-and-presence-narrowing.md), [008-collection-iteration.md](008-collection-iteration.md)

## Objective

Prove the selected near-term roadmap slice (Tasks 001–008) as one coherent compatibility contract across the original five source and target languages: PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java. Consolidate their fixtures, capability validation, diagnostics, semantic round trips, and real execution without adding Phase 2/3 features.

## Current evidence and gap

[`../spec/frontend-equivalence.spec.js`](../spec/frontend-equivalence.spec.js) and [`../spec/backend-execution.spec.js`](../spec/backend-execution.spec.js) already prove the original two-integer difference fixture across all five languages and real runtimes. Focused correction specs cover unsafe integers, function flags, parser-child dropping, annotations, strict types, target identifiers, Java range, and branch shape. After eight independent expansions, a terminal fixture is needed to catch interactions that focused task specs cannot prove.

Tasks 015–021 are completed transitively before this task through Tasks 005 and 007, but they do not expand this task's acceptance matrix. Python, C#, C, C++, and Rust acceptance belongs to their language tasks and later per-capability matrix updates; browser Wasm acceptance belongs to Task 021 and later backend-capability updates. Keeping this file original-five-only preserves its historical contract instead of falsely treating a target-only Wasm lane as a sixth source language.

## Language matrix

| Language | Representative accepted acceptance project | Required rejection/capability proof |
| --- | --- | --- |
| Ruby | Adjacent explicit scalar/container/optional comments; locals; typed operators; nested blocks; required functions; list iteration plus hash lookup/size | Prove annotations stay associated, truthiness and hash iteration are not admitted, `.each` is recognized only for lists, and all excluded parameter/dynamic forms still fail. |
| JavaScript + JSDoc | Fully JSDoc-typed synchronous functions, `let`/`const`, strict operators, readonly arrays/maps, `null` optional, list-only `for...of` | Prove no Map iteration, inference/undefined/coercive equality/spread/optional chain/async/generator/method/dynamic-object leakage. |
| TypeScript | Strict explicit types, readonly containers, `T|null`, required direct functions, list-only `for...of` | Prove Map iteration, `any`, optional/rest/overload, wider unions, assertions, and unsupported narrowing remain rejected by Semantifold. |
| PHP | Exact strict-types file profile plus Semantifold local/container docs, native scalars/nullable, braced blocks, list-only `foreach` | Prove no map/key iteration, loose comparison, key coercion, mixed PHP array, by-ref/named/variadic call, nullsafe, alternative syntax, or ignored declaration enters the IR. |
| Java | Explicit primitive/String/collection/Optional types, conventional blocks, required static functions, enhanced list iteration | Prove `Map.of` order is never observed; reject map/`entrySet()` iteration, and continue proving `int` bounds, exact boolean conditions, no raw/nullable/receiver/basic-for/unsupported grammar recovery, and pre-emission name/layout validation. |

## Semantic IR, typing, and validation

- Add no new semantic capability. Freeze and document the combined schema produced by Tasks 001–008.
- Audit exhaustive switches/dispatch in semantic validation and all five backends for every selected node/type/operation.
- Audit resolver/type/control-flow interaction: scopes, mutability, call signatures, void, recursive container/optional types, narrowing invalidation, loop bindings, return completeness, and abrupt loop control.
- Define a canonical location-insensitive comparator used only by specs. It may remove locations/ephemeral resolved IDs but must not drop any modeled meaning.
- Ensure externally constructed malformed semantic modules fail deterministically before any backend emits partial source.

## Frontend work

- Build one substantial fixture per language expressing equivalent meaning with idiomatic accepted syntax from Tasks 001–008.
- Audit every top-level and nested parser child in each fixture and paired rejection corpus; no filter/map pipeline may silently discard an unrecognized node.
- Preserve parser-specific source locations through the full combined constructs, including nested type constituents, entries, optional tests, loop bindings, and call arguments.
- Do not broaden accepted syntax while making fixtures convenient; any necessary new form belongs in its owning task first.

## Backend and target validation work

- Generate each of five targets from each of five source-derived semantic modules (25 source→target combinations), validating before emission.
- Reparse every generated artifact and compare full modeled meaning, excluding only locations/resolution identities documented as regenerated.
- Compile/run every distinct generated target with its real command. Deduplication may reduce identical executions only if source equality is asserted; missing commands remain failures.
- Audit escaping, parentheses, statement indentation/braces, target identifiers/reserved words, Java ranges/types, PHP key/profile rules, and generated annotation association.

## Diagnostics and source locations

- Assemble a compatibility diagnostic table covering parse failure, unsupported source form, missing type, semantic resolution/type/flow failure, and unsupported backend capability for every language.
- Assert stable code, language, filename, and useful start location; avoid brittle whole-message snapshots.
- Include nested and cross-target failures proving the original source semantic location survives until backend validation.
- Verify no raw parser exception or emitter `TypeError` escapes for covered invalid inputs.

## Tests and acceptance

- The canonical program must use booleans/strings/integers, mutable and immutable locals, arithmetic/equality/logic/concatenation, multi-statement/nested conditionals, zero/one/many-argument and void functions, immutable list/map construction, lookup, and size, present/absent optionals with safe narrowing, and ordered list iteration with break/continue. It must not iterate a map.
- Retain the original minimal fixture as backward-compatibility coverage.
- Add a compact rejection corpus for every explicit Phase 0/1 non-goal and regression previously protected by the baseline specs.
- Run real `php`, `ruby`, `node`, local `tsc` then `node`, `javac`, and `java`, asserting exact stdout for present/absent and branch/iteration cases. Do not snapshot source instead of executing it.
- Run the complete repository gates required by `AGENTS.md`, including audit/package checks and `git diff --check`.

## Documentation and changelog

Reconcile root README, `docs/goals.md`, `docs/architecture.md`, `docs/language-support.md`, and `docs/testing.md` against the actual combined implementation. Mark Tasks 001–008 complete only after their own criteria pass; leave Tasks 009–012 and 014 described as future/conditional. Add one compatibility changelog fragment.

## Non-goals

Acceptance claims for Python, C#, C, C++, Rust, or browser Wasm; any new feature or syntax beyond Tasks 001–008, including ordered map iteration from Task 014, floating point, arbitrary unions, records/classes, multi-file modules, exceptions, generics, async/concurrency, dynamic features, parser/tool upgrades, source formatting preservation, performance benchmarks, and loosening a rejection merely to simplify the acceptance fixture.

## Completion criteria

- All five source fixtures normalize to equivalent complete semantic meaning for the selected slice.
- All 25 source→target combinations validate, emit, reparse equivalently, and their distinct target programs compile/run with exact behavior using map construction/lookup/size and list-only ordered iteration.
- The backward-compatibility and rejection corpora pass with stable located diagnostics and no silent parser-child loss.
- All documentation states the implemented subset accurately, all repository gates pass, and no Phase 2/3 capability is accidentally claimed or introduced.
