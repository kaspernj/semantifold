# 034 — Effectful capabilities and resource lifetime

- Status: `implemented locally; independent review, TensorBuzz CI, and merge remain coordinator-owned`
- Phase/priority: Phase S / P1
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [007-optional-values-and-presence-narrowing.md](007-optional-values-and-presence-narrowing.md), [011-typed-errors-and-handling.md](011-typed-errors-and-handling.md), [033-reference-classes-methods-and-constructors.md](033-reference-classes-methods-and-constructors.md)

## Objective

Represent explicit effectful host operations, resource/reference ownership, deterministic explicit close, typed failure boundaries, and validation in the semantic model. Establish lifetime meaning needed by later canonical stdlib capabilities without silently claiming async, concurrency, `finally`, or RAII semantics.

## Current evidence and gap

Current expressions are pure scalar computations except entry printing, which is a special statement rather than a general effect contract. There are no resource types, ownership states, host-operation declarations, optional EOF values, or typed failure edges. Task 033 supplies reference identity but not external resource lifetime; Task 011 supplies bounded typed errors but not the native-error normalization boundary.

## Semantic, effect, and lifetime contract

- Add explicit declarations and invocations for effectful operations. Each operation has resolved identity, exact argument/result types, ordered effects, declared typed failures, and a capability authority supplied by compilation rather than a freely forgeable source name.
- Model owned resource references separately from ordinary references and immutable values. Construction/acquisition yields one valid owned handle only on success; no handle escapes on acquisition failure.
- Define moves, permitted borrows/aliases, scope escape, and call transfer explicitly for the initial profile. Validation tracks the semantic resource identity through locals, arguments, receiver state, and supported returns without relying on target garbage collection.
- Deterministic explicit `close` consumes or transitions an open resource to closed according to the operation contract. Every subsequent use, double-close behavior, and close failure is typed and validated; silently ignoring a native close result is forbidden.
- Effects and arguments evaluate left to right exactly once. Optimizers and backends cannot duplicate, remove, reorder, or speculate an effectful call.
- Optional/presence remains distinct from failure: clean absence such as EOF is not an exception, and a failed read is not EOF. Typed host failures normalize at the declared boundary and do not expose accidental target exception/message/code details.
- Require validation that every owned resource is closed or explicitly transferred on every reachable supported path. This task uses structured path analysis; it does not add `finally`, implicit cleanup, destructors, RAII, or garbage-collector finalization guarantees.

## Frontend and capability strategy

- Frontends convert only explicit compiler-authorized capability calls and the bounded resource operations/source profiles selected by the implementation. Ordinary functions with similar spelling do not gain host authority.
- Preserve locations for acquisition, each resource use, ownership transfer, close, optional/presence branch, and typed failure boundary.
- Reject implicit conversions from files, sockets, streams, pointers, integer descriptors, or arbitrary native objects into semantic resources.
- Parser rejection, dynamic lookup, reflection, native extensions, and source spelling never provide a fallback authority path.

## Backend and native-boundary strategy

- Backends validate the entire effect graph, target capability, ownership/lifetime state, failure normalization, and all artifact needs before emission. The target-native implementation mechanism remains protected and is formalized as provider linking in Task 035.
- Emit explicit target operations that preserve one-call evaluation, resource identity, absence versus failure, and close transitions. Garbage collection may manage memory but cannot substitute for semantic close.
- A target without a sound representation for the required ownership/failure profile returns `UNSUPPORTED_CAPABILITY` transactionally.

## Diagnostics and rejections

- Stable diagnostics cover missing capability authority, undeclared effect/failure, use after move/close, double close where forbidden, leaked owned resource, invalid borrow/escape, resource type mismatch, failure/absence conflation, and effect reordering in malformed IR.
- Frontend excluded host objects or implicit cleanup forms use located `UNSUPPORTED_SYNTAX`; semantic ownership and failure errors identify the exact acquisition/use/transfer/close path; backend inability uses located `UNSUPPORTED_CAPABILITY`.
- No diagnostic path may permit partial artifact exposure or replace a typed failure with `null`, `false`, a sentinel integer, printed text, or process exit.

## Deterministic real-toolchain tests

- Use deterministic local fake/test capabilities first to cover successful acquisition/use/close, acquisition failure, operation failure, clean optional absence, transfer, every branch close obligation, close failure, repeated close, use after close, and leaked resources.
- Instrument effect order and call counts so native execution proves left-to-right exactly-once behavior and no implicit finalizer is needed.
- Generate/reparse where supported and compile/execute the declared adoption cohort with real toolchains; missing commands fail. Target adapters exercise real resource primitives selected by focused adoption specs, not snapshots or source inspection alone.
- Verify generation determinism, complete provenance, transactional late failures, and no exposed raw native handle/exception.

## Documentation and changelog

When implemented, document the effect authority model, resource/reference distinction, move/borrow/transfer profile, explicit close obligations, typed failure normalization, adopted targets, and exclusions. Add one behavior changelog fragment.

## Non-goals

Async operations, promises/futures, event loops, concurrency, threads, cancellation, nonblocking I/O, `finally`/`ensure`/`defer`, RAII, destructors/finalizers, garbage-collector close guarantees, automatic retry, general effect polymorphism, unsafe pointers/descriptors, shared mutable resources, distributed transactions, or specific socket/file APIs.

## Completion criteria

- Effectful operations and authority are explicit and cannot be confused with ordinary pure calls.
- Resource identity, ownership/transfer, typed absence/failure, exactly-once ordering, and deterministic close validate on all supported paths.
- Real adopted targets preserve the contract or fail before any artifacts are returned.
- Focused lifetime/failure diagnostics, deterministic real-toolchain coverage, documentation, and a behavior changelog fragment are complete.

## Local implementation record — 2026-09-12

The local implementation adds the frozen `SemantifoldCapabilityAuthority` v1 input and parser-neutral capability/resource/failure/operation declarations with deterministic identities. Calls become compiler-authorized `EffectCallExpression` nodes only after ordinary source declarations have won name resolution. Each site records its exact operation, ordered parameter/result identities, closed `host` effect, ordered nominal failures, resource transition, deterministic `effect:N` identity, source location, and provenance. The authority payload is unversioned with respect to future standard-library contracts: Task 035 still owns versioned canonical contracts, provider registries, negotiation, linking, protected provider artifacts, and tree-shaking.

`OwnedResourceType` and `OwnedReferenceType` remain distinct from ordinary reference/value types. Parser normalization introduces explicit moves for local, parameter, constructor, and return transfer and immediate shared/exclusive borrows for use/close. Structured path analysis retains normal, return, raise, break, and continue states separately; acquisition succeeds with one owner or fails with none, borrows preserve the open owner on operation failure, a close attempt is terminal on success and declared close failure, and every scope/branch/catch/loop exit must close or transfer each owner. Resource-owning classes contain one direct private resource field and transfer the complete owner through the reference. Nested/container ownership, copying, reassignment, escaping borrows, path-dependent states, use after move/close, forbidden double close, and absence/failure conflation fail with stable located diagnostics.

The bounded conformance authority `semantifold.task034.resource-probe` is adopted only by PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java. Each target has one hard-coded compiler-owned probe binding around a real local file primitive. It is not a public file API or provider registry. Backend preflight validates the complete graph, lifetime state, effect-site order, target support, and excluded short-circuit/repeated-condition contexts before writer allocation. Nested eager effects are materialized into collision-safe statement-local temporaries in receiver/argument left-to-right order, exactly once. Native failures are caught and normalized to nominal probe failures; clean EOF alone is optional absence; close failure is terminal; repeated use detects `ProbeResourceClosed` before another native operation.

Focused contract, lifetime, frontend, backend, provenance/mapping, public API, registry, and real-toolchain specs pass individually. The real-runtime proof generates deterministically, reparses under the same authority, compiles, and executes with real `php`, `ruby`, `node`, `tsc`, `javac`, and `java`. Async/concurrency/cancellation, `finally`/`ensure`/`defer`, RAII/destructors/finalizers/GC cleanup, retry, general effect polymorphism, unsafe native handles, shared mutable resources, distributed transactions, sockets/files as public APIs, standard-library facades, provider linking, release, and deployment remain excluded.
