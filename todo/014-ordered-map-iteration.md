# 014 — Ordered map iteration

- Status: `todo`
- Phase/priority: Phase 2 / P2 (deferred, conditional)
- Dependencies: [006-immutable-lists-and-maps.md](006-immutable-lists-and-maps.md), [008-collection-iteration.md](008-collection-iteration.md)

## Objective

Add insertion-ordered iteration over immutable maps as a capability distinct from Task 006's unordered `MapType`. Accept it only when the source form establishes insertion order and the backend can preserve that order with a genuinely ordered target representation. In particular, Java `Map.of`, `Map.ofEntries`, and `Map.copyOf` remain valid only for Task 006 construction, lookup, and size; their unspecified iteration order can never satisfy this task.

## Current evidence and gap

Task 006 deliberately gives ordinary maps no observable iteration order, and Task 008 accepts only ordered list iteration. The baseline [`../src/semantic/types.js`](../src/semantic/types.js) has neither map types nor loops, so it cannot distinguish an ordered map from an unordered association. Ruby `Hash`, JavaScript `Map`, and PHP arrays document insertion order, while Java's `Map` convenience factories explicitly do not. Java's `LinkedHashMap` supplies insertion encounter order, and `Collections.unmodifiableSequencedMap` can expose an unmodifiable ordered view, but the mutable backing map must not escape. The exact official evidence is recorded in [SOURCES.md](SOURCES.md).

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | a typed string-key `Hash` literal followed by `values.each do |key, value| ... end` | Require the exact `Hash` profile whose literal establishes creation order. Reject subclasses, default/default-proc behavior, key/value-only iteration, mutation, destructuring beyond two simple bindings, and arbitrary enumerable receivers. |
| JavaScript + JSDoc | `/** @type {ReadonlyMap<string, number>} */ const values = new Map([["b", 2], ["a", 1]]); for (const [key, value] of values) { ... }` | Require native `Map`, a dense ordered entry list, a `const` two-identifier binding, and no mutation. Reject object properties, custom iterables, weak maps, spread, callback iteration, and overwritten duplicate keys. |
| TypeScript | `const values: ReadonlyMap<string, number> = new Map([["b", 2], ["a", 1]]); for (const [key, value] of values) { ... }` | Require the same native runtime representation and exact compatible key/value types. Reject structural map-like objects, mutable aliases, assertions, inferred/`any` constituents, custom iterators, and unordered sources. |
| PHP | `/** @var array<string,int> $values */ $values = ["b" => 2, "a" => 1]; foreach ($values as $key => $value) { ... }` | Require the exact string-key ordered-map profile. Reject list/mixed arrays, implicit keys, numeric-string key coercion, references, mutation, unpacking, and value-only iteration for this pair-binding capability. |
| Java | an exact `LinkedHashMap<K,V>` insertion sequence, immediately sealed as `java.util.SequencedMap<K,V>` with `java.util.Collections.unmodifiableSequencedMap`, then enhanced iteration over `sequencedEntrySet()` | Require insertion-order mode, exact generic types, unique supported keys, and proof that the backing map has no use or alias outside the recognized construction sequence. Reject `Map.of`/`Map.ofEntries`/`Map.copyOf`, `HashMap`, access-ordered `LinkedHashMap`, sorted/concurrent maps, raw types, streams, and any leaked mutable backing. |

## Semantic IR, typing, and validation

- Retain Task 006 `MapType {keyType, valueType}` as unordered and non-iterable. Add a distinct `OrderedMapType {keyType, valueType, order: "insertion"}` and `OrderedMapLiteral` with ordered entry nodes; do not infer order merely because one current backend happens to enumerate an ordinary map predictably.
- Add `ForEachMapStatement {map, keyBinding, valueBinding, body, location}` rather than overloading Task 008's list-only `ForEachStatement` ambiguously. Both bindings are immutable and scoped to the body.
- Define insertion order as first insertion of each unique key. Evaluate the map expression once, then visit each entry once in that order. Evaluate literal key/value expressions left-to-right in source entry order before iteration.
- Validate an ordered-map operand, exact key/value binding types, duplicate keys, supported string-key profile, binding scope/shadowing, no mutation or alias escape, legal `break`/`continue`, and Task 004 abrupt completion rules.
- Ordinary Task 006 maps remain valid for construction, lookup, and size and cannot be implicitly promoted to `OrderedMapType`. Conversion from an unordered map is excluded because it cannot reconstruct insertion order.

## Frontend work

- Prism: recognize an exact typed `Hash` literal as `OrderedMapLiteral` only in this profile and an exact `.each` block with two simple parameters; continue mapping Task 006 hashes to ordinary maps when no ordered capability is declared.
- Babel for JavaScript and TypeScript: recognize exact native `new Map` construction from dense two-element entry arrays plus `for...of` two-identifier array binding. Prove JSDoc/TypeScript readonly generic types and reject object/custom-iterable lookalikes and all mutations.
- `php-parser`: recognize an explicitly documented string-key ordered array and key/value `foreach`; validate every entry/key and reject coercible, implicit, unpacked, referenced, or mutated forms.
- Lezer: recognize one bounded Java construction sequence: fresh insertion-ordered `LinkedHashMap`, ordered `put` statements, immediate `unmodifiableSequencedMap` sealing, and enhanced iteration over `sequencedEntrySet`. Consume every statement in that sequence into the ordered literal or loop node, preserve each location, and reject any intervening use, alias, branch, reassignment, or backing escape. Never recover this meaning from source text.
- Every adapter must reject an ordinary Task 006 map operand with `UNSUPPORTED_SYNTAX` at the iteration expression rather than treating observed parser/runtime enumeration as semantic order.

## Backend and target validation work

- Emit Ruby `Hash#each`, JavaScript/TypeScript native `Map` `for...of`, PHP key/value `foreach`, and their exact ordered construction forms. Preserve one-time operand evaluation and two-binding scope.
- For Java, lower each ordered literal to a collision-safe local construction sequence using a fresh `LinkedHashMap`, left-to-right `put` calls, and `Collections.unmodifiableSequencedMap`; expose only the sealed `SequencedMap`. Insert temporaries before the containing statement without reordering surrounding expressions, and make the generated sequence recognizable by the Lezer adapter for semantic round-trip.
- Java target validation must reject the `Map.of` family, `HashMap`, sorted/access-ordered/concurrent maps, unsupported JDK APIs, backing alias escape, generated-name collision, and any context where safe statement-level lowering cannot preserve expression evaluation order.
- Validate target key equality/coercion restrictions, ordered representation, binding types, identifiers, and loop-control context before emitting any source. No backend may approximate order by sorting keys or relying on undocumented hash enumeration.

## Diagnostics and source locations

- Stable diagnostics cover unordered-map iteration, unsupported ordered representation, invalid key/value binding shape or type, duplicate/coercible key, backing alias escape, mutation, and unsafe Java expression lowering.
- `UNSUPPORTED_SYNTAX` points to the source map/loop form that fails to establish order; semantic type failures point to the map expression or offending entry/binding; `UNSUPPORTED_CAPABILITY` points to the originating ordered-map literal or loop before target emission.
- Preserve locations for ordered-map type constituents, every entry key/value, construction boundary, map operand, both loop bindings, body, `break`, and `continue`. Java statements folded into one literal retain child locations for precise failures.

## Tests and acceptance

- Add equivalent five-language fixtures whose entry order (`"b"`, then `"a"`, then `"c"`) differs from lexical/sorted order. Iterate key/value pairs, use `continue` and `break`, and assert exact output proving insertion rather than hash or sorted order.
- Cover empty, singleton, and multi-entry ordered maps; one-time operand evaluation; immutable binding scope; lookup/size compatibility; and generated semantic round-trip.
- Negative specs cover ordinary Task 006 map iteration in every language, duplicate/coercible keys, mutation/aliasing, unsupported binding forms, and each language-specific unordered/dynamic form. Java negatives must include every `Map.of` family, `HashMap`, access-ordered `LinkedHashMap`, sorted maps, and leaked backings.
- Generate/reparse and execute all five targets using real `php`, `ruby`, `node`, local `tsc`, `javac`, and `java`. Assert the Java source uses insertion-ordered backing plus an unmodifiable sequenced view and never relies on a `Map.of`-family iteration order; source assertions supplement rather than replace runtime proof.

## Documentation and changelog

Document the `MapType`/`OrderedMapType` distinction, insertion-order contract, canonical source profiles, Java construction/sealing rule, alias/mutation restrictions, and fail-loud behavior for ordinary maps. Update the roadmap matrix only when the capability is implemented and add one behavior changelog fragment.

## Non-goals

Adding map iteration to Task 008 or Task 013; assigning order to Task 006 `MapType`; relying on `Map.of`, `Map.ofEntries`, `Map.copyOf`, `HashMap`, object-property order, or incidental hash order; conversion from unordered maps; mutable maps; key-only/value-only iteration; entry objects outside the loop binding; sorting; reverse/access order; concurrent iteration; mutation during iteration; custom equality/hash policies; arbitrary key types; lazy/async/parallel iteration; streams, callbacks, generators, and custom iterators.

## Completion criteria

- A distinct ordered-map semantic type and loop node define insertion order, pair bindings, one-time evaluation, immutability, and scope without changing ordinary Task 006 map meaning.
- All five frontends accept only parser-proven ordered construction/iteration profiles and reject unordered or alias-unsafe forms with stable located diagnostics.
- All five backends validate and emit a genuinely ordered representation; Java uses a non-escaping insertion-ordered backing behind an unmodifiable sequenced view and never depends on `Map.of`-family iteration order.
- Focused negative/equivalence specs and real five-runtime generated execution prove non-lexical insertion order, control flow, and semantic round-trip, with documentation and changelog updated.
