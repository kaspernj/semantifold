# Standard-library portability implementation plan

Date: 2026-09-05

Status: dependency-ordered future plan; no implementation is claimed.

## Goal and architecture reference

Deliver the first bounded proof of the [standard-library portability architecture](../standard-library-portability.md): language compatibility stdlib/facades and target host providers/native bindings meet only through versioned canonical Semantifold stdlib contracts/capabilities. Pair-specific adapters and direct behavior-changing rewrites are excluded.

## Why semantic prerequisites come first

The current `semantifold@0.2.0` IR cannot express imports, general signatures, receiver calls, classes, loops, optional EOF, typed failures, resource identities, ownership, or close effects. Encoding a socket facade before those meanings exist would push language behavior into parser adapters, emitters, or handwritten source-to-target bridges. That would make evaluation order, EOF, failure, and lifetime accidental and prevent other facades/providers from sharing the work.

The sequence therefore establishes general language semantics first, then defines capability/provider infrastructure, and only then adds a facade and concrete network slice. Numerical task order records this dependency flow; it is not a promise that the work is complete or immediately scheduled.

## Dependency-ordered sequence

1. Complete existing prerequisites [Task 004](../../todo/004-statement-sequencing-and-conditionals.md) and [Task 005](../../todo/005-general-function-signatures-and-calls.md), then add [Task 032 — condition-controlled loops and break/continue](../../todo/032-condition-controlled-loops-and-break.md). This supplies a general strict-Boolean loop model without recognizing stdlib-specific read-loop idioms.
2. Complete [Task 009](../../todo/009-closed-records-and-member-access.md), then add [Task 033 — reference classes, methods, and constructors](../../todo/033-reference-classes-methods-and-constructors.md). Executable facades need bounded nominal reference identity, private state, construction, and receiver calls; immutable records alone are insufficient.
3. Build on optionals, typed failures, and reference classes with [Task 034 — effectful capabilities and resource lifetime](../../todo/034-effectful-capabilities-and-resource-lifetime.md). It defines explicit host effects, resource ownership, deterministic close, and typed failure boundaries without claiming async, concurrency, `finally`, or RAII.
4. Build project/module and effect foundations into [Task 035 — versioned standard-library contracts and provider linking](../../todo/035-versioned-standard-library-contracts-and-provider-linking.md). This owns canonical capability modules, provider registry/negotiation, protected native bindings, transactional linking, and tree-shaking.
5. Add [Task 036 — language compatibility stdlib/facades](../../todo/036-language-compatibility-stdlib-facades.md). It owns proved stdlib identity, executable source-language facades, collision-safe target names, and same-language recursion isolation.
6. Combine the loop and facade branches in [Task 037 — blocking TCP client stdlib vertical slice](../../todo/037-blocking-tcp-client-stdlib-vertical-slice.md). This is the first concrete proof, not a general networking or all-language milestone.

The direct dependency chain is also recorded in the [roadmap graph and task index](../../todo/README.md). Phase S stays non-blocking until its prerequisite tasks are delivered; it must not distort the existing language/platform lanes.

## First end-to-end proof

Task 037 provides only these initial integrations:

- canonical versioned blocking `SocketClient`, text-stream line-read, output, and resource-close capabilities;
- a Ruby language compatibility stdlib/facade preserving the supported `TCPSocket.new(host, port)`, `gets`, and `close` shape;
- a PHP target host provider/native binding implemented with genuine `fsockopen`, `fgets`, and `fclose`; and
- generated PHP that can retain `TCPSocket` in a collision-safe compatibility namespace/import alias while its methods call canonical provider operations.

Acceptance starts a real local ephemeral TCP server controlled by the test. Generated PHP runs with the real PHP CLI and must prove exact output, newline retention, an absent result only at clean EOF, normalized connection error before a usable resource escapes, deterministic successful close, the specified repeated-close result, and a typed use-after-close failure. The server and client tests use bounded timeouts so blocking behavior cannot hang the lane.

Negative acceptance covers unresolved or shadowed `TCPSocket`, monkey-patching/reopening, dynamic require/lookup, unsupported APIs/options, missing provider capabilities, namespace collisions, version mismatch, and late provider/link failure. Every failure occurs before partial artifact exposure.

## Delivery discipline for future implementation

Each behavior task must add focused specs, exact public contracts, documentation, and a changelog fragment. Runtime-generation coverage must invoke the real required tools and a real local socket; source snapshots are insufficient. Implementations must validate and return deterministic complete artifact sets, retain semantic/synthetic provenance, and fail if a required tool is unavailable.

This planning change itself adds no compiler/runtime behavior, dependency, generated output, spec, or changelog fragment. It does not trigger release, CI topology, external task mutation, or implementation of the listed tasks.
