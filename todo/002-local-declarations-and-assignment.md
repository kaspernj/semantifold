# 002 — Local declarations and assignment

- Status: `delivered` on `master`
- Phase/priority: Phase 0 / P0
- Dependencies: [001-portable-scalar-values-and-types.md](001-portable-scalar-values-and-types.md)

## Objective

Model explicitly typed, initialized local bindings and later simple assignment to those bindings, with lexical block scope, mutability, declaration-before-use, and type preservation defined independently of source syntax.

## Current evidence and gap

[`../src/semantic/types.js`](../src/semantic/types.js) has parameters and identifier reads but no local declaration, assignment, expression statement, binding identity, or scope. [`../src/semantic/validate.js`](../src/semantic/validate.js) requires a function body of exactly one `IfStatement`; all frontends reject local declarations, and [`../src/backends/shared.js`](../src/backends/shared.js) knows no local statements. [`../spec/java-frontend-validation.spec.js`](../spec/java-frontend-validation.spec.js) explicitly proves that a Java local in `main` is rejected rather than ignored.

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `# @type [Integer]` immediately before `total = 0`; later `total = total + value` | Require a Semantifold local type comment because Ruby source has no local annotation. Reject multiple assignment, destructuring, constants, globals/class/instance variables, and assignment hidden in a condition. |
| JavaScript + JSDoc | `/** @type {number} */ let total = 0`; later `total = total + value` | Accept `const` as immutable and `let` as mutable. Reject `var`, destructuring, uninitialized declarations, implicit globals, compound/update assignment, and mismatched JSDoc. |
| TypeScript | `let total: number = 0`; `const label: string = "x"` | Require an explicit annotation and initializer. Reject inference-only, destructuring, definite-assignment assertions, `var`, compound/update assignment, and reassignment of `const`. |
| PHP | `/** @var int $total */ $total = 0`; later `$total = $total + $value` | Require the immediately associated exact local type comment because PHP has no local declaration type syntax. Reject variable variables, list destructuring, references, globals/statics, compound assignment, and use before declaration. |
| Java | `int total = 0;`, `final String label = "x";` | Accept explicit type with one declarator and initializer. Reject `var`, multiple declarators, arrays here, uninitialized locals, compound/update assignment, and assignment to `final`. |

Ruby/PHP comment carriers are a Semantifold source-profile rule, not native runtime enforcement. Their association and exact type expression must be validated by the frontend.

## Semantic IR, typing, and validation

- Add `LocalDeclaration {name, type, mutable, initializer, location}` and `AssignmentStatement {target, expression, location}`. The target is initially a simple resolved local identifier, not an arbitrary lvalue.
- Add stable binding identity or a resolver-owned symbol table so shadowed spellings cannot be confused. Parameters are immutable for this initial capability; assigning to them is rejected.
- Define lexical scopes for function bodies and nested blocks. Reject duplicate declarations in one scope, use before declaration, unresolved reads/writes, assignment to immutable bindings, and initializer/assignment type mismatch.
- Permit the minimum statement sequence needed for declarations/assignments before the existing terminal conditional/return shape. Task 004 owns general block sequencing, nesting, reachability, and conditional relaxation.
- Preserve evaluation order: initializer/right-hand expression is evaluated before the new value becomes visible. A local is not visible in its own initializer.

## Frontend work

- Prism: convert `LocalVariableWriteNode` as a declaration only when an immediately adjacent supported `# @type [...]` comment establishes a new binding; convert later writes as assignment. Reject operator writes and multi-target nodes.
- Babel: convert `VariableDeclaration` with exactly one identifier declarator and initializer; read JSDoc for JS and `TSTypeAnnotation` for TS. Convert plain `AssignmentExpression` only when used as its own expression statement and operator is `=`.
- `php-parser`: distinguish first simple variable assignment with associated `@var` documentation from later assignment; reject dynamic names and reference/by-ref nodes.
- Lezer: convert `LocalVariableDeclaration` with one `VariableDeclarator`, explicit non-`var` type, and initializer; convert simple `AssignmentExpression` statement with `=`.
- Do not infer a declaration from an arbitrary first assignment without the required language-profile evidence.

## Backend and target validation work

- Emit `let`/`const`, typed TS locals, Java typed/`final` locals, Ruby assignment, and PHP assignment plus the exact type documentation needed for generated source to reparse.
- Preserve the semantic mutability bit even where the target cannot enforce it syntactically; target validation must still reject assignment to immutable bindings.
- Validate target lexical/reserved rules for declarations and every resolved reference before emission.
- Never rename a binding implicitly in this task. A source-valid name that is illegal in a target raises `UNSUPPORTED_CAPABILITY` at the declaration.

## Diagnostics and source locations

- Add or reuse stable semantic diagnostic codes for duplicate binding, unresolved binding, use before declaration, immutable assignment, and type mismatch; do not mislabel these as parser syntax failures.
- Frontend form exclusions use `UNSUPPORTED_SYNTAX` at the declarator/assignment/lvalue. Missing Ruby/PHP/JS local documentation uses `MISSING_TYPE` at the declaration.
- Backend binding/name limitations use `UNSUPPORTED_CAPABILITY` at the original declaration or assignment target.
- Declaration, target, and initializer locations must remain distinct enough for precise diagnostics.

## Tests and acceptance

- Focused equivalence fixtures declare mutable and immutable scalar locals, perform a plain assignment, and return/print a value in all five languages.
- Negative specs cover missing local types, uninitialized/multiple/destructured declarations, `var`/Java `var`, variable variables, references, duplicate/use-before-declaration/unresolved binding, type mismatch, and immutable writes.
- Scope specs cover legal inner shadowing only if deliberately enabled; otherwise reject all shadowing consistently in this first task.
- Generate and reparse each target, compile/run through all five real toolchains, and assert identical output plus equivalent binding/mutability semantics.

## Documentation and changelog

Document the Ruby/PHP local annotation carrier, JS `let`/`const` rule, explicit-type requirement, scope/mutability semantics, and exclusions in `docs/language-support.md` and architecture docs. Add one behavior changelog fragment.

## Non-goals

Destructuring, multiple declaration targets, uninitialized locals, type inference, globals/constants/fields, parameter reassignment, captured variables, closures, compound/update assignment, arbitrary lvalues, definite-assignment analysis across loops, and general statement/control-flow support owned by Task 004.

## Completion criteria

- New local and assignment nodes resolve to typed bindings without parser-specific values in the semantic tree.
- Every frontend enforces its explicit type carrier and rejects ambiguous first-assignment forms.
- Every backend emits reparsable declarations/assignments and validates names, mutability, and types before output.
- Focused diagnostic, scope, round-trip, and real five-runtime tests pass with documentation/changelog updates.
