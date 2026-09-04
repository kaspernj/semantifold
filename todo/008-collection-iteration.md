# 008 — Ordered list iteration

- Status: `todo`
- Phase/priority: Phase 1 / P1
- Dependencies: [002-local-declarations-and-assignment.md](002-local-declarations-and-assignment.md), [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md), [006-immutable-lists-and-maps.md](006-immutable-lists-and-maps.md)

## Objective

Add one structured, ordered `for-each` semantic loop over immutable lists, with a typed iteration binding, `break`/`continue`, lexical scope, and deterministic evaluation. Map iteration is explicitly deferred to Task 014 because Task 006 does not model map order and Java `Map.of`/`Map.ofEntries` do not specify iteration order.

## Current evidence and gap

No loop or abrupt loop-control statement exists in [`../src/semantic/types.js`](../src/semantic/types.js). Task 004 supplies reusable blocks and Task 006 supplies ordered lists. Official language syntax differs sharply: Ruby commonly uses `each` blocks (and `for` has different scope), JS/TS use `for...of`, PHP uses `foreach`, and Java uses enhanced `for`. All can preserve list order. Map loops are rejected here because the Task 006 Java representation may use factories whose iteration order is unspecified.

## Language matrix

This matrix records the original-five mappings researched for this task. Tasks 015–021 complete transitively first; implementation must add Python, C#, C, C++, and Rust frontend/backend loop mappings and the browser Wasm structured-control lowering or an explicit documented and tested target capability rejection. Task 013 remains intentionally original-five-only.

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `items.each do |item| ... end` | Use `each` block only on a resolved semantic list. Reject `Hash#each`, `for` scope difference, arbitrary block calls, `while`/`until`, `times`, ranges, nonlocal block return, redo/retry, and iterator mutation. |
| JavaScript + JSDoc | `for (const item of items) { ... }` | Require one `const` simple binding over a semantic list. Reject Map iteration, `for...in`, classic/await loops, destructuring, labels, iterators/generators, and collection mutation. |
| TypeScript | typed/inferred loop binding from an explicitly typed list using `for...of` | The list type supplies the binding type; reject Map iteration, explicit incompatible annotations, `for...in`, iterator customization, and async iteration. |
| PHP | `foreach ($items as $item) { ... }` | Require the resolved PHP array to be a semantic list. Reject key bindings/map iteration, by-reference iteration, destructuring, alternative syntax, mutation, and ambiguous arrays. |
| Java | `for (Integer item : items) { ... }` | Require an explicit compatible binding type over semantic `List<T>`. Reject Map/`entrySet()` iteration, basic `for`, arrays, streams/lambdas, raw types, labels, and concurrent mutation. |

## Semantic IR, typing, and validation

- Add `ForEachStatement {list, valueBinding, body, location}`. The binding is immutable and scoped only to the loop body.
- Add `BreakStatement` and `ContinueStatement` with nearest-loop meaning only; no values or labels.
- Evaluate the list expression exactly once before iteration and visit its elements in list order.
- Validate list type, exact binding type, loop-control context, duplicate/shadowing policy, and no assignment to iteration bindings. A map operand is a type error/unsupported source form, not an unordered loop.
- Define normal/abrupt block completion with Task 004 flow analysis. Non-void function return completeness cannot assume a loop executes.

## Frontend work

- Prism: recognize only exact receiver `.each` calls with one supported block shape and one required block parameter on a resolved list; reject Hash receivers and two-binding blocks.
- Babel: convert `ForOfStatement` with one `const` identifier over a resolved list; reject `await`, destructuring, Map operands, non-block bodies if the profile requires blocks, and every other loop.
- `php-parser`: convert `foreach`, rejecting a key binding and checking the value variable, `byref`, body block, and resolved list kind.
- Lezer: convert `EnhancedForStatement` only over a resolved `List<T>`; reject `.entrySet()` and every map/entry extraction profile.
- Rejected nested children point to themselves; no adapter may filter update clauses, labels, destructuring elements, or block statements.

## Backend and target validation work

- Emit the canonical target loop form above, preserving one-time collection evaluation (introduce a generated temporary only if the semantic expression is not a simple binding and name generation is collision-safe).
- Emit Ruby `.each`, JS/TS `for...of`, PHP `foreach`, and Java enhanced `for` with exact list element binding types.
- Validate list/binding support, target identifiers, `break`/`continue` context, and target list-order guarantee before any emission.
- Generated source must reparse to the same `ForEachStatement`, not to a language-specific callback/call semantic node.

## Diagnostics and source locations

- Stable diagnostics cover non-iterable source, binding arity/type mismatch, illegal break/continue, mutable/by-reference/async loop form, and unsupported iteration order.
- Collection expression, each binding, loop body, break, and continue retain individual locations.
- Frontend exclusions are `UNSUPPORTED_SYNTAX`; semantic context/type failures use stable semantic diagnostics; target limitations use `UNSUPPORTED_CAPABILITY`.

## Tests and acceptance

- Registered-language equivalence fixtures iterate lists in deterministic order, use nested conditionals, continue one item, break later, and accumulate/print scalar results.
- Negative specs cover map iteration in every language, Ruby `for`/arbitrary blocks, JS/TS `for...in`/classic/await/destructuring, PHP key binding/by-reference/alternative syntax, Java `entrySet`/basic-for/array/stream/raw types, illegal controls, and mutation.
- Test collection expression evaluation exactly once and iteration binding scope/immutability.
- Generate/reparse and execute every required registered target through real toolchains, asserting exact ordered output and equivalent loop/control nodes.

## Documentation and changelog

Document ordered list `for-each` meaning, canonical source forms, binding scope, abrupt control, explicit map-iteration deferral, and excluded iteration models. Add one behavior changelog fragment.

## Non-goals

Map iteration/entry bindings (deferred to [014-ordered-map-iteration.md](014-ordered-map-iteration.md)), while/do/basic-for/until/range loops, numeric ranges, reverse iteration, indices, async/parallel iteration, generators/iterators, callbacks/higher-order iteration, streams, labels, break values, redo/retry, mutation during iteration, and nonlocal returns.

## Completion criteria

- One parser-neutral loop node represents list iteration with exact order, scope, and one-time evaluation; map operands are rejected.
- All five adapters exhaustively recognize only their canonical forms; all backends validate and emit reparsable equivalents.
- Loop-control/type/location diagnostics are focused and stable.
- Ordered real registered-runtime execution and semantic round-trip specs pass with docs/changelog updates.
