# 006 — Immutable lists and maps

- Status: `todo`
- Phase/priority: Phase 1 / P1
- Dependencies: [002-local-declarations-and-assignment.md](002-local-declarations-and-assignment.md), [003-typed-operators-and-expressions.md](003-typed-operators-and-expressions.md), [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md)

## Objective

Add distinct homogeneous immutable list and map semantic values, parameterized concrete types, literals, size, indexed/key lookup, and presence-aware map reads without conflating PHP arrays, JavaScript objects, or target mutability.

## Current evidence and gap

The semantic schema has no compound values or type arguments. Every frontend rejects array/object/hash/map literals and member/index access. PHP's official `array` is an ordered map serving list and map roles, while JavaScript has both arrays/objects/`Map`, Ruby has `Array`/`Hash`, and Java has arrays plus `List`/`Map`. Treating all of them as one node would lose modeled meaning.

## Language matrix

This matrix records the original-five mappings researched for this task. Its implementation names the required cohort and tests explicit capability rejection for other registered roles; language or platform registration alone does not make collection support a prerequisite. Task 013 remains intentionally original-five-only.

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `[1, 2]` with `[Array[Integer]]`; `{"a" => 1}` with `[Hash[String, Integer]]`; `items[index]`, `values.fetch(key)` | Require homogeneous explicit container type. Use `fetch` for total map lookup; reject default procs, symbols as keys initially, splats, mutation, ranges, and missing-key `[]` ambiguity. |
| JavaScript + JSDoc | `/** @type {ReadonlyArray<number>} */ const xs = [1, 2]`; `ReadonlyMap<string, number>` with `new Map([["a", 1]])` | Reject object literals as maps, sparse arrays, spreads, mutation, computed/dynamic keys, weak collections, and `map.get` as a total value (it is optional and belongs with Task 007). |
| TypeScript | `const xs: readonly number[] = [1, 2]`; `ReadonlyMap<string, number>` | Reject tuples, mutable-only APIs, object index signatures, spreads, inference-only containers, assertions, sets, and unchecked optional map reads. |
| PHP | `/** @var list<int> $xs */ $xs = [1, 2]`; `/** @var array<string,int> $m */ $m = ["a" => 1]` | Use an exact Semantifold PHPDoc profile. Reject mixed/list-map shapes, implicit or numeric-string map keys, key coercions, unpacking, references, mutation, and unchecked missing keys. |
| Java | `java.util.List<Integer> xs = java.util.List.of(1, 2)`; `java.util.Map<String,Integer> m = java.util.Map.of("a", 1)` | Use fully qualified names until Task 010. `Map.of`/`Map.ofEntries` are acceptable only because this task exposes lookup and size, not iteration order. Reject arrays as semantic lists, raw types, mutable implementations, null elements/keys/values, duplicate map keys, and unsupported factory arities only if the chosen emitter cannot use `ofEntries`. |

## Semantic IR, typing, and validation

- Replace flat type-name assumptions with recursive `ListType {elementType}` and `MapType {keyType, valueType}` type references while retaining scalar references.
- Add `ListLiteral`, `MapLiteral` with source-ordered entry nodes, `ListIndexExpression`, `MapLookupExpression`, and `CollectionSizeExpression`, all location-bearing. Map entry order preserves initializer evaluation and diagnostic order only; it is not an observable map-iteration contract.
- Lists are finite, zero-based, ordered, duplicate-preserving, homogeneous immutable values. Maps are finite key/value associations with no modeled iteration order; initial keys are nonnumeric strings only and duplicate keys are invalid.
- Distinguish total lookup (statically/literally proven key or explicit source operation that fails on absence) from optional lookup. Task 007 owns optional results; until then, only literal-known/validated total reads are accepted.
- Validate element/key/value types, integer index type, duplicate keys, and known literal index bounds. Runtime out-of-range/missing behavior must not be claimed portable unless lowered to one explicit semantic failure in Task 011.
- Container values are immutable semantically even if a target runtime object is mutable. No alias-visible mutation may be accepted.

## Frontend work

- Prism: convert `ArrayNode`, `HashNode`/association nodes, supported index/fetch calls, and size calls only with explicit adjacent type comments/parameter annotations.
- Babel: convert dense `ArrayExpression`, `NewExpression` for exact `Map`, computed list access, and exact `.length`/`.size`/`.get` profiles; reject holes/spreads/object-as-map and arbitrary receivers.
- `php-parser`: classify array AST as list or string-key map from explicit type plus all entries; reject implicit mixed keys and coercible numeric-string keys.
- Lezer: recognize exact fully qualified `List.of`/`Map.of` (or supported imported forms only after Task 010), type applications, method invocation, and array access only for semantic list mappings selected by the task.
- Do not parse generic type expressions with ad hoc source regexes; use parser/comment-parser structures and a bounded type-expression converter.

## Backend and target validation work

- Emit immutable/read-only target profiles: frozen semantics are guaranteed by accepted operations, not necessarily runtime deep freezing. Prefer `List.of`/`Map.ofEntries`, JS/TS `ReadonlyArray`/`ReadonlyMap` annotations, and generated documentation for Ruby/PHP reparsing.
- Emit target-specific list/map read and size syntax while preserving key type and initializer evaluation order. Java may use `Map.of`/`Map.ofEntries` only while map iteration remains unavailable.
- Validate Java factory null/arity restrictions, PHP key safety, target type spellings, and recursively supported element types before emitting anything.
- A backend that cannot guarantee the semantic operation rejects it; it must not substitute an object, associative array, raw type, or mutable API with different lookup semantics.

## Diagnostics and source locations

- Stable diagnostics cover heterogeneous element/entry type, duplicate map key, invalid map key, sparse/spread collection, invalid index type, known out-of-bounds index, and missing/unparseable container type.
- Frontend errors point to the hole/spread/key/entry/access node. Type mismatch points to the offending element or entry value.
- Backend limitations use `UNSUPPORTED_CAPABILITY` at the collection/type/entry that cannot be emitted.
- Preserve locations on recursive type arguments and every list element/map entry.

## Tests and acceptance

- Equivalent registered-language fixtures cover empty/nonempty lists/maps, duplicates in lists, string-key lookup, list indexing, size, nesting one supported container level, and passage through functions.
- Negative specs cover sparse/spread/mixed containers, numeric-string PHP keys, duplicate keys, raw/missing types, mutable operations, object-as-map, Java arrays/raw types/null factory elements, and unchecked missing reads.
- Backend tests cover recursive capability validation and factory limits before emission.
- Generate/reparse and run every required registered target with its real toolchain and exact output proving list order, indexing, map lookup, size, and nested type preservation.

## Documentation and changelog

Document semantic list/map contracts, target syntax, PHP distinction, JS object exclusion, immutability boundary, lookup restrictions, type syntax, and the absence of any portable map-iteration order. Add one behavior changelog fragment.

## Non-goals

Map iteration or observable map order (deferred to [014-ordered-map-iteration.md](014-ordered-map-iteration.md)), mutation, sets, tuples, records/objects, heterogeneous containers, arbitrary key types, sparse arrays, slices/ranges, comprehensions, sorting, deep immutability guarantees, cyclic structures, lazy/infinite collections, and general missing-key exception semantics.

## Completion criteria

- Lists and maps are distinct recursive semantic types/values with exhaustive validation and no parser-specific leakage; map construction, lookup, and size expose no iteration-order promise.
- Five frontends reject shape/coercion ambiguities and five backends emit equivalent reads without silently changing container kind.
- Recursive type/entry locations drive stable diagnostics.
- Focused specs and real registered-runtime round-trip behavior pass with docs/changelog updates.
