# 012 — Type parameters and generic declarations

- Status: `todo`
- Phase/priority: Phase 3 / P3 (conditional)
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [006-immutable-lists-and-maps.md](006-immutable-lists-and-maps.md), [009-closed-records-and-member-access.md](009-closed-records-and-member-access.md)

## Objective

Add invariant unbounded type parameters to functions and records, generic type application, and deterministic first-order call inference. Require explicit parser-backed documentation in languages without native runtime generic syntax; never erase unresolved semantic parameters to untyped top types.

## Current evidence and gap

Task 006 introduces concrete recursive type applications but not declaration-scoped variables. TypeScript and Java have native generic syntax, JS JSDoc supports `@template`, RBS defines class/method type variables, and PHP has no native generic declarations. The current comment handling is deliberately bounded and no semantic scope resolves type variables.

## Language matrix

This matrix records the original-five mappings researched for this conditional task. Its implementation must extend the design to Python, C#, C, C++, and Rust frontends/backends and state an exact browser Wasm monomorphization/erasure rejection policy; no role may silently erase generic meaning. Task 013 remains intentionally original-five-only.

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
