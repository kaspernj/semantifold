# 034 — Effectful capabilities and resource lifetime

- Status: `todo`
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
