# 007 — Optional values and presence narrowing

- Status: `todo`
- Phase/priority: Phase 1 / P1
- Dependencies: [001-portable-scalar-values-and-types.md](001-portable-scalar-values-and-types.md), [003-typed-operators-and-expressions.md](003-typed-operators-and-expressions.md), [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md)

## Objective

Model explicit `Optional<T>` presence/absence, construction, presence tests, and branch-local unwrapping without equating Ruby `nil`, JavaScript `null`/`undefined`, PHP `null`, and Java nullable references. Defer arbitrary unions until a closed variant representation exists.

## Current evidence and gap

There is no null literal, recursive optional type, union, flow narrowing, or presence operation in the current IR. TypeScript/PHP/RBS can write optional/union types, Java reference types are implicitly nullable, Java `Optional<T>` is explicit, and JavaScript has two absence values. Mapping all source nullish behavior to one unchecked literal would lose declaration intent and target safety.

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | adjacent type `[String?]`; `nil`; `value.nil?`; guarded use after `unless value.nil?` or normalized `if` | Treat only `nil` as absent. Reject general truthiness, safe-navigation, `||` defaults, `nil` in non-optional types, and arbitrary unions. |
| JavaScript + JSDoc | `{string|null}` using `null`; `value !== null` | Select `null` as the sole generated/source absence sentinel. Reject `undefined`, omitted arguments, optional properties/chaining, loose null checks, `??`, and `string|number`. |
| TypeScript | `string | null`; `null`; strict `value !== null` | Require the exact two-member optional form under strict semantics. Reject `undefined`, optional parameters/properties, non-null assertions, optional chaining, wider unions, and disabled-null-check assumptions. |
| PHP | `?string` or canonical `string|null`; `null`; `$value !== null` | Canonicalize one source profile and reject redundant/wider unions, omitted nullable types, loose checks, nullsafe access, and `??` in this task. |
| Java | `java.util.Optional<String>`; `Optional.empty/of`; `isPresent()` and guarded `get()` | Do not use bare nullable references or third-party annotations. Reject `Optional.ofNullable` unless its input is already modeled optional, unchecked `get`, nested optionals, and `null` inside `Optional`. |

## Semantic IR, typing, and validation

- Add recursive `OptionalType {valueType}` and expressions `OptionalNone`, `OptionalSome`, `OptionalIsPresent`, and a guarded `OptionalUnwrap` (or an equivalent binding-producing presence pattern).
- Absence is a semantic variant, not a freely assignable `null` literal. Only `Optional<T>` contains `None`; `Some` requires exactly `T` and cannot wrap semantic void.
- Define flow-sensitive narrowing for one simple identifier: the present branch exposes a non-optional binding/value; the absent branch does not. Invalidation after assignment must be handled conservatively.
- Require explicit optional annotations at declarations/parameters/returns. No inference from a null literal or default argument.
- General `UnionType`, intersection types, truthiness narrowing, and arbitrary discriminants are excluded. Reconsider closed finite unions only after Task 009 supplies records/nominal variants.

## Frontend work

- Extend bounded type-expression conversion for exact RBS `T?`, JSDoc/TS `T|null`, PHP nullable, and Java `Optional<T>` shapes.
- Prism: convert `NilNode` only in an optional context and exact `nil?` tests; recognize a supported guarded unwrap source pattern without treating arbitrary calls as presence operations.
- Babel: convert `NullLiteral` and strict null comparisons; reject undefined identifiers/void expressions and optional-chain nodes.
- `php-parser`: convert null keyword and strict comparisons with exact nullable declarations.
- Lezer: structurally recognize fully qualified/unqualified supported Optional construction and access; reject recovered trees and bare-null references.

## Backend and target validation work

- Emit `nil`, `null`, and `java.util.Optional` mappings from semantic operations, not by printing a universal literal.
- Generate branch guards and unwrap only where semantic narrowing proves presence. Java may use `.get()` only under that proof; dynamic targets use the narrowed binding/value without broad truthiness.
- Validate target type recursion and optional operation support before emission. Preserve fully qualified Java names until Task 010.
- Never lower arbitrary unions to `Object`, `mixed`, `untyped`, or unchecked casts.

## Diagnostics and source locations

- Stable diagnostics cover absence in non-optional context, invalid optional constituent, unchecked unwrap, invalidated narrowing, unsupported undefined/nullish form, and arbitrary union.
- Type constituent, absence literal, presence test, and unwrap each retain source locations.
- Frontend excluded forms use `UNSUPPORTED_SYNTAX`/`MISSING_TYPE`; semantic flow errors use a stable semantic diagnostic; backend representation failures use `UNSUPPORTED_CAPABILITY`.

## Tests and acceptance

- Equivalent fixtures return optional strings, branch on presence, unwrap safely, and produce the same present/absent output in all five languages.
- Negative specs cover JS/TS `undefined`, omitted/optional parameters, non-null assertions, safe/optional/nullsafe chaining, PHP/Ruby loose/truthy checks, Java bare null/unchecked `get`, nested optional policy, and arbitrary unions.
- Flow tests cover both branches, reassignment invalidation, shadowing, return completeness, and externally constructed malformed IR.
- Generate/reparse and execute present and absent cases through all five real toolchains with exact output.

## Documentation and changelog

Document the semantic variant model, exact source type spellings, Java `Optional`, JS `null`-only profile, narrowing rules, and arbitrary-union deferral. Add one behavior changelog fragment.

## Non-goals

Arbitrary unions/intersections, `undefined`, optional/default parameters or properties, nullable Java references/third-party annotations, nested optionals unless deliberately accepted, truthiness, Elvis/null-coalescing operators, safe/optional/nullsafe chaining, unchecked unwrap, result/error types, and pattern matching.

## Completion criteria

- Presence/absence has one parser-neutral variant meaning with explicit recursive typing.
- All unwrapping is statically guarded, and every language mapping round-trips without relying on implicit nullability.
- Arbitrary unions and nullish shortcuts fail loudly rather than erase meaning.
- Focused flow/diagnostic specs and real present/absent five-runtime execution pass with docs/changelog updates.
