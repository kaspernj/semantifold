# 033 — Reference classes, methods, and constructors

- Status: `delivered through PR #43 at exact head 98a9fa5bb1048fbe44e798acdefd65b9d6d2560e; merged as f2e7f44aa8065f785c314b66e1f1d55992b7c998`
- Phase/priority: Phase S / P1
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [009-closed-records-and-member-access.md](009-closed-records-and-member-access.md)

## Objective

Add bounded nominal reference classes with exact constructors, private instance state, receiver method calls, and reference identity. Supply the executable object model needed by language compatibility stdlib/facades without admitting inheritance, open classes, reflection, or arbitrary host objects.

## Current evidence and gap

The current IR has functions and scalar locals only. Task 009 is planned to add closed immutable product records and member reads, but a socket-shaped facade needs a stable object identity, private mutable resource state, initialization, receiver dispatch, and methods such as `gets` and `close`. Existing frontends reject classes, construction, receiver calls, and instance state; treating these as records would erase identity and mutation semantics.

## Semantic and reference contract

- Add nominal class declarations with unique resolved identities, a closed ordered set of private typed instance fields, exactly one constructor signature/body, and a closed set of instance methods with explicit required parameter and return types.
- Add reference types, construction expressions, receiver method-call expressions/statements, private-field reads/writes inside the declaring class, and a semantic receiver binding. Constructor arguments and method calls evaluate left to right, with the receiver evaluated before arguments.
- Construction allocates one fresh identity, initializes every field exactly once before the reference escapes, and returns that nominal reference. No partially initialized instance may be observed.
- Assignment and parameter passing copy references, not object state. Identity remains stable for lifetime/ownership validation, but public identity equality, hashing, ordering, serialization, cloning, and copying are not introduced by this task.
- Method resolution is nominal and closed by declaration identity and exact signature. There is no overload selection, virtual dispatch, inheritance, duck typing, method missing, or structural substitution.
- Private state is accessible only through the semantic receiver inside the declaring class. Facade public API shape is later work in Task 036; this task is general object semantics.

## Frontend strategy

- Each adopted frontend recognizes one explicit canonical class, constructor, private-state, and method profile and accounts for every parser child, modifier, annotation, and body statement.
- Require explicit type carriers wherever the source language does not enforce them. Reject class reopening, monkey-patching, prototype mutation, decorators, mixins/traits, inheritance/interfaces, static/singleton methods, computed method names, dynamic sends, reflection, and metaprogramming.
- Convert `new`/constructor and direct receiver calls only after resolving the nominal declaration and method. Reject arbitrary host classes and native constructors even when their spelling matches a supported class.
- Never infer a class/member from source-text patterns after parser or resolver rejection.

## Backend and target validation

- Emit one collision-safe canonical class form per adopted target, including explicit private fields, initialization, and receiver methods. Preserve freshness, reference aliasing, receiver-before-argument order, and private access.
- Validate declaration/method/field names, collisions, field initialization, receiver types, exact method signatures, visibility, method bodies, and target reference representation before emitting any artifact.
- Dynamic targets must not weaken the accepted profile merely because runtime mutation is possible. Generated code exposes no setters, reopen hooks, or reflective dispatch.
- Registered roles outside the declared adoption cohort return located `UNSUPPORTED_CAPABILITY`; this task does not promise simultaneous support in every language.

## Diagnostics and rejections

- Stable diagnostics cover duplicate class/field/method identities, uninitialized or multiply initialized fields, illegal private access, invalid receiver, unknown method, wrong constructor/method arity or types, and reference/value mismatch.
- Frontends locate excluded inheritance, extra members/modifiers, arbitrary host class references, dynamic dispatch, reopening, reflection, and recovered syntax as `UNSUPPORTED_SYNTAX`.
- Backends reject invalid visibility/layout/name/capability before artifact exposure. No unsupported object behavior is rewritten as a map, record, global table, or free function if that changes identity or encapsulation.

## Deterministic real-toolchain tests

- Canonical fixtures construct multiple instances, prove independent private state and reference aliasing, call value- and void-returning methods, mutate state through methods, pass references through functions, and preserve receiver/argument evaluation order.
- Negative cases cover incomplete initialization, private escape/access, wrong receiver/signature, inheritance, reopening/monkey-patching, arbitrary host objects, reflection, static/dynamic calls, and malformed external IR.
- Generate/reparse where supported and compile/execute the task's declared target cohort with the real installed runtimes/compilers. Missing tools fail; exact output and observable identity/state behavior agree.
- Generate twice and compare all text/artifact/provenance output. Snapshots cannot replace native execution.

## Documentation and changelog

When implemented, document the reference model, canonical source profiles, initialization and evaluation order, privacy, adopted roles, and exclusions. Add one behavior changelog fragment.

## Non-goals

Inheritance, interfaces, traits/mixins, abstract or virtual dispatch, overloading, metaprogramming, reflection, monkey-patching/open classes, prototypes, arbitrary host classes, static/singleton members, public mutable fields, object identity equality/hashing, destructors/finalizers, weak references, cloning, serialization, generics, async methods, or concurrency.

## Completion criteria

- Nominal class, construction, private state, receiver call, and reference identity semantics are parser- and target-independent.
- Complete initialization, visibility, resolution, type, and evaluation-order validation occurs before generation.
- Adopted source/target profiles execute deterministically on real toolchains; excluded/dynamic/host behavior fails loudly.
- Focused diagnostics, semantic round trips, docs, and a behavior changelog fragment are complete.

## Local implementation record — 2026-09-12

The candidate adds parser-neutral nominal `ClassDeclaration`, `ReferenceType`, exact constructor and method signatures, semantic receiver expressions, private field reads/writes, construction, and resolved receiver calls. Class, constructor, method, and field identities are deterministic. Construction initializes every ordered field exactly once before escape, each allocation is fresh, and local assignment and parameter passage preserve reference aliasing. Receiver evaluation precedes left-to-right argument evaluation.

The smallest correct adoption cohort is PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java: these are the existing general-function, record, optional, generic, and loop cohort and all have parser-backed canonical class forms plus real runtime/compiler acceptance. The other eight source roles and browser Wasm advertise `referenceClasses: false` and reject the capability transactionally. This task remains single-module; both Task 010 program APIs reject class-bearing modules before resolution or output. Constructors and methods may handle Task 011 errors internally but cannot expose unchecked-error effects through receiver calls, and target lifecycle/protocol hooks remain reserved.

Focused semantic, frontend, backend-validation, backend/round-trip, provenance/mapping, registry, cross-language behavior, and real-toolchain specs pass individually. They cover fresh independent state, aliasing, value- and void-returning methods, reference passage, receiver-before-argument and constructor argument order, complete initialization, privacy, exact resolution/signatures, deterministic output, unsupported roles, inheritance/reopening/reflection exclusions, and malformed caller IR.

Task 033 was delivered through PR #43 at exact head `98a9fa5bb1048fbe44e798acdefd65b9d6d2560e` and merge commit `f2e7f44aa8065f785c314b66e1f1d55992b7c998`. Exact-head TensorBuzz group `9e842b5e-30d2-493a-8f6d-051ee631077d` succeeded; the sole automatic Codex review completed, all material threads were resolved, all PR routes were retired, and post-merge acceptance completed 24/24 focused checks plus 11/11 registry checks.
