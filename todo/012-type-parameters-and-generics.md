# 012 — Type parameters and generic declarations

- Status: `implemented locally; final coordinator acceptance correction complete; exact-head TensorBuzz CI / merge pending`
- Phase/priority: Phase 3 / P3 (conditional)
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [006-immutable-lists-and-maps.md](006-immutable-lists-and-maps.md), [009-closed-records-and-member-access.md](009-closed-records-and-member-access.md)

## Objective

Add invariant unbounded type parameters to functions and records, generic type application, and deterministic first-order call inference. Require explicit parser-backed documentation in languages without native runtime generic syntax; never erase unresolved semantic parameters to untyped top types.

## Current evidence and gap

Task 006 introduces concrete recursive type applications but not declaration-scoped variables. TypeScript and Java have native generic syntax, JS JSDoc supports `@template`, RBS defines class/method type variables, and PHP has no native generic declarations. The current comment handling is deliberately bounded and no semantic scope resolves type variables.

## Language matrix

This matrix records the original-five mappings researched for this conditional task. Its implementation names a required cohort and keeps explicit tested rejection elsewhere; no registered role may silently erase generic meaning to appear supported. Task 013 remains intentionally original-five-only.

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | adjacent `# @template T`, parameter `[T]`, return `[T]`; record `[Box[T]]` profile | Treat comments as the Semantifold carrier for bounded RBS type expressions. Reject runtime type reflection, variance, bounds, overloads, higher-kinded types, and untyped variables. |
| JavaScript + JSDoc | `@template T`, `@param {T} value`, `@returns {T}`; `@template T` class docs | Require TypeScript-supported JSDoc shapes. Reject Closure-only ambiguity, unconstrained use sites, conditional/mapped/imported generic tricks, constructors outside Task 009, and `*`/`?`/`any`. |
| TypeScript | `function identity<T>(value: T): T`; `class Box<T>` canonical record | Reject constraints/defaults/variance markers, conditional/mapped/indexed/keyof/infer types, generic overloads, explicit instantiations needing unsupported syntax, and structural substitution. |
| PHP | exact adjacent PHPDoc profile `@template T`, `@param T $value`, `@return T` | Native PHP cannot enforce generics; accept only if parser-extracted docs exactly preserve the semantic contract and generated docs reparse. Reject missing docs, `mixed`, tool-specific variance/bounds, and silent erasure. |
| Java | `static <T> T identity(T value)`; `final class Box<T>` canonical record | Reject bounds, wildcards, raw types, variance/capture, generic arrays/varargs, overloaded inference, intersection bounds, and reflection. |

## Semantic IR, typing, and validation

- Add `TypeParameter {id, name, location}`, `TypeVariableReference {parameterId, location}`, and generic parameter lists on supported function/record declarations. Existing recursive named types accept type arguments with exact arity.
- Type parameters are invariant, unbounded, declaration-scoped, unique, and usable only in types. No runtime type value/reification is implied.
- Implement deterministic first-order unification of call argument types against parameter types. All type variables must resolve from arguments alone; reject conflicting, missing, recursive, expected-return-only, or ambiguous inference.
- Instantiate return/record field types with the resolved substitution and validate applications recursively. Do not accept raw applications.
- Keep backend runtime erasure distinct from semantic erasure: generated JS/Ruby/PHP must retain complete type documentation so reparse restores the same generic declaration/application.

## Frontend work

- Extend the bounded type-expression converter with scoped identifiers and applications; reject unknown/free type variables and unsupported type operators.
- Prism: parse exact adjacent template/type comments while Prism remains the Ruby source parser; no source-text fallback for Ruby syntax.
- Babel: convert TS `TSTypeParameterDeclaration`/references and exact JSDoc `@template`; enumerate all children/options and reject constraints/defaults.
- `php-parser`: consume parser-extracted documentation through the existing documentation parser/profile; native source syntax remains authoritative for PHP code structure.
- Lezer: convert `TypeParameters`, `TypeParameter`, type applications, and generic method/class shapes structurally; reject error nodes, bounds, raw use, and wildcard nodes.

## Backend and target validation work

- Emit native TS/Java generic declarations and exact JSDoc/Ruby/PHP documentation profiles; emit concrete application syntax appropriate to each target.
- Validate target type-parameter identifiers, shadowing/collisions, representable applications, and complete substitutions before emitting any declaration/call.
- Do not generate runtime type tests, casts, wrapper objects, specialization copies, `mixed`, `Object`, `untyped`, or raw Java types to cover unsupported generics.
- Generated source must reparse with equivalent declaration IDs modulo regenerated identity and equivalent substitutions.

## Diagnostics and source locations

- Stable diagnostics cover duplicate/free/unknown type parameter, wrong type-argument arity, raw generic use, inference conflict/failure/recursion, and unsupported bound/variance/operator.
- Template declaration, type parameter, every type-variable occurrence/application, and conflicting call argument retain locations.
- Missing language-profile docs use `MISSING_TYPE`; source form exclusions use `UNSUPPORTED_SYNTAX`; semantic inference errors use stable semantic codes; target failures use `UNSUPPORTED_CAPABILITY`.

## Tests and acceptance

- Equivalent fixtures cover identity, `Box<T>`, nested `List<T>`, two independent type parameters, and inference from multiple consistent arguments across every required registered language role.
- Negative specs cover PHP/Ruby/JS missing template docs, raw Java types, free/duplicate variables, wrong arity, conflicts, expected-return-only inference, bounds/defaults/wildcards/variance, higher-kinded/conditional/mapped types, and runtime reflection.
- Backend tests prove no type-documentation erasure in dynamic targets and no raw/Object/mixed fallback.
- Generate/reparse and execute concrete string/integer instantiations through every required real toolchain with exact output and equivalent generic semantic structure.

## Documentation and changelog

Document invariance, unbounded parameters, inference algorithm, dynamic-language comment profiles, PHP conditional status, erasure distinction, and excluded advanced type systems. Add one behavior changelog fragment.

## Non-goals

Bounds/constraints/defaults, variance/wildcards/capture, higher-kinded types, associated types, conditional/mapped/indexed/intersection types, overload-driven or bidirectional inference, specialization/reification/reflection, generic arrays/varargs, runtime type tests, and raw/untyped fallback.

## Completion criteria

- Scoped semantic type variables and applications validate without parser-specific or target-specific representations.
- First-order inference is deterministic, complete for the accepted profile, and fails loudly on ambiguity/conflict.
- Every dynamic target preserves the full contract in reparsable documentation; PHP is not marked supported until that proof passes.
- Focused generic/inference diagnostics and real registered-runtime round trips pass with docs/changelog updates.

## Implementation delivery record — 2026-09-12

The local implementation adds invariant unbounded declaration-scoped parameters, scoped type-variable references, closed generic record applications, exact arity and recursive validation, deterministic first-order argument-only inference, complete substitutions in resolved calls/returns/record fields, module-qualified identities, and full provenance/mapping symbols. TypeScript and Java use native generics; JavaScript/JSDoc, Ruby, and PHP use exact parser-associated documentation that regenerates and reparses without semantic loss. Every other registered target advertises the capability as false and rejects generic modules transactionally.

Focused semantic, frontend, backend, project, provenance/mapping, and real-runtime specs cover nested `List<T>`, independent and repeated parameters, string/integer instantiations, present and whole-optional argument evidence, order-independent contextual validation after empty and recursively evidence-free list/map arguments, closed optional record construction/member substitution, recursively documented optional type variables and applied records, exact direct and presence-proven PHP getter receivers, carrier-free PHP `Optional<T>` getters, exact fixed nullable PHP scalar carriers and their mismatch diagnostics, parser-known instantiated call results, explicit TypeScript/Java construction applications, native application syntax, missing/free/duplicate/raw/wrong-arity types, forbidden arguments on non-generic records, sparse outer/nested inferred type-argument identities, inference conflict/failure/recursion, bounds/defaults/variance/wildcards, casts/reflection/operators, malformed external IR, and imported generic declarations. The bounded independent review, terminal re-review correction, final coordinator acceptance correction, and bounded automatic-review correction are complete locally; exact-head TensorBuzz CI and merge remain pending. No standard-library facade/provider behavior, pairwise rewrite, fallback type, wrapper, specialization, release, publication, deployment, review automation, or external-system mutation is included.

The package version remains `0.3.0`. Exact-head TensorBuzz CI, merge, and any later publication remain pending and coordinator-owned.
