# 009 — Closed records and member access

- Status: `todo`
- Phase/priority: Phase 2 / P2 (conditional)
- Dependencies: [002-local-declarations-and-assignment.md](002-local-declarations-and-assignment.md), [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [006-immutable-lists-and-maps.md](006-immutable-lists-and-maps.md), [007-optional-values-and-presence-narrowing.md](007-optional-values-and-presence-narrowing.md)

## Objective

Add nominal, closed, immutable record declarations with ordered typed fields, construction, and field reads. Establish a portable product-value/member model before considering general classes, methods, inheritance, mutable identity, or arbitrary objects.

## Current evidence and gap

The semantic module contains only functions and an entry point. Calls have no receiver, there are no nominal type declarations, fields, construction, or member expressions, and Java frontend tests deliberately reject method receivers. PHP arrays/JS objects/RBS records can look like records but differ in openness, identity, key coercion, and mutation. The pinned `@lezer/java@1.1.3` grammar has `ClassDeclaration` but no record-declaration node, so Java's `record` syntax cannot be the required source profile.

## Language matrix

This matrix records the original-five mappings researched for this conditional task. Its implementation must first extend the design to Python, C#, C, C++, and Rust frontends/backends and the browser Wasm backend, including explicit value/layout/ownership decisions or a documented and tested target capability rejection. Task 013 remains intentionally original-five-only.

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `class User`; typed `attr_reader :name`; typed `initialize(name)` assigning `@name`; `User.new("Ada").name` | Require exact generated/profile structure and field annotations. Reject open-class reopening, writers, extra instance variables, singleton methods, inheritance/mixins, dynamic send, and reflective access. |
| JavaScript + JSDoc | JSDoc-typed `class User` with constructor assignment and read-only profile; `new User("Ada").name` | Reject object literals as nominal records, post-construction extension, computed/private/static fields, methods beyond constructor/read access, prototypes, inheritance, decorators, and mutation. |
| TypeScript | `class User { constructor(readonly name: string) {} }`; `new User("Ada").name` | Accept one canonical readonly class form. Reject structural lookalikes, interfaces/type aliases as runtime records, optional/index/private/static fields, methods, parameter-property variants outside the profile, and inheritance. |
| PHP | `final readonly class User { public function __construct(public string $name) {} }`; `$user->name` | Require supported runtime version/profile and exact public readonly promoted fields. Reject dynamic properties, magic methods, traits, inheritance, mutable/static/protected/private properties, methods, and object casts. |
| Java | conventional `final class User` with private final fields, constructor, and canonical accessors; `user.name()` (or one documented getter form) | Do not require Java `record` syntax from the pinned Lezer grammar. Reject inheritance/interfaces, mutable/static fields, overloaded constructors, methods beyond canonical accessors, reflection, anonymous/local classes, and reference equality. |

## Semantic IR, typing, and validation

- Add `RecordDeclaration {name, fields, location}`, `RecordField {name, type, location}`, `RecordType {declarationId}`, `RecordConstruction {record, arguments, location}`, and `MemberRead {receiver, field, location}`.
- Records are nominal, closed, immutable product values. Field order defines constructor argument order; names are unique; all fields initialize exactly once; there are no hidden fields.
- Resolve record type/construction/member names to declaration/field identity. Validate exact constructor arity/types and receiver field availability.
- Record equality, hashing, copying, destructuring, methods, and mutation are not implied. Task 003 scalar equality does not automatically extend to records.
- A record field may use supported scalars, containers, optionals, or earlier record types. Reject direct value-recursive cycles unless mediated by `Optional`/container and explicitly proven representable.

## Frontend work

- Each adapter recognizes one canonical declaration shape and accounts for every class/body/constructor child. Any extra method, modifier, base, decorator, member, assignment, or statement is rejected at its node.
- Prism: bind annotated readers, initializer parameters, and instance-variable writes into fields; do not treat arbitrary calls/readers as members.
- Babel: distinguish JS JSDoc from TS annotations; require constructor/member syntax matching the profile and convert `NewExpression`/noncomputed `MemberExpression`.
- `php-parser`: validate `final readonly`, promoted public fields, constructor-only body, and `propertylookup`/`new` nodes.
- Lezer: validate conventional final-class structure and canonical accessor bodies through direct children; reject error nodes and Java record syntax that the pinned grammar cannot faithfully represent.

## Backend and target validation work

- Emit the canonical declaration/construction/read form for each target, including all type documentation required for generated Ruby/JS/PHP to reparse.
- Validate target class/type/field/constructor identifiers and collisions, recursive field types, reserved names, PHP runtime capability, and Java file/class constraints before emission.
- Emit no setters or extra public behavior. Runtime mutability loopholes in dynamic languages are outside accepted operations, but generated syntax should use the strongest practical immutability form.
- Never lower a nominal record to an untyped map/object or erase an inaccessible field.

## Diagnostics and source locations

- Stable diagnostics cover duplicate record/field, invalid canonical record shape, constructor arity/type mismatch, unknown field, invalid receiver type, illegal recursion, and attempted mutation.
- Declaration, field/type, constructor argument, receiver, and member name retain precise locations.
- Frontend shape failures use `UNSUPPORTED_SYNTAX`; semantic resolution/type failures use stable semantic codes; target form/runtime limits use `UNSUPPORTED_CAPABILITY`.

## Tests and acceptance

- Registered-language equivalence fixtures declare two records, construct nested/optional/container fields, read members, pass records through functions, and print scalar projections.
- Negative specs cover all extra class members/modifiers, object/map structural substitutes, mutation, unknown/duplicate fields, wrong constructor signatures, inheritance, methods, reflection/dynamic access, Java record syntax under the pinned grammar, and recursive cycles.
- Backend tests validate complete record shape and target names before emission.
- Generate/reparse and compile/run every required registered target with exact output proving nominal construction and field reads.

## Documentation and changelog

Document nominal/closed/immutable semantics, canonical source forms, the Java pinned-parser constraint, and exclusions from general class support. Add one behavior changelog fragment.

## Non-goals

General classes, inheritance/interfaces/traits/mixins, methods, mutable/static/private state, object/record equality or hashing, destructuring/copy/update, computed/dynamic members, reflection, decorators/attributes/annotations, open structural objects, prototypes, magic methods, and Java `record` syntax until parser support is independently validated.

## Completion criteria

- Record declarations/construction/reads resolve nominally and remain parser-neutral.
- Every frontend accepts exactly one auditable canonical form and rejects all extra class behavior.
- Every backend emits a closed immutable profile or fails before output; no map/object erasure occurs.
- Focused shape/resolution specs and real registered-runtime semantic round trips pass with docs/changelog updates.
