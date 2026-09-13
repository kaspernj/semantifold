# Standard-library portability implementation plan

Date: 2026-09-05

Status: dependency-ordered plan; Tasks 032 and 033 are delivered, Task 034 is implemented locally with independent review, TensorBuzz CI, and merge remaining coordinator-owned, and Tasks 035–037 remain planned.

## Goal and architecture reference

Deliver the first bounded proof of the [standard-library portability architecture](../standard-library-portability.md): language compatibility stdlib/facades and target host providers/native bindings meet only through versioned canonical Semantifold stdlib contracts/capabilities. Pair-specific adapters and direct behavior-changing rewrites are excluded.

## Why semantic prerequisites come first

The published `semantifold@0.3.0` package cannot express the full set of imports, receiver calls, reference classes, condition-controlled loops, optional EOF, typed failures, resource identities, ownership, and close effects required by this plan. The current source tree has since delivered Task 032's general loop/control foundation and Task 033's bounded single-module reference classes and receiver calls for the original five. The local Task 034 implementation adds compiler-authorized unversioned effect operations, owned-resource lifetime, explicit close, optional EOF separation, and typed host-failure normalization for that cohort. Versioned canonical contracts, facade resolution, provider registries/negotiation/linking, and provider artifacts remain absent and owned by Tasks 035–037. Encoding a socket facade before those layers exist would push language behavior into parser adapters, emitters, or handwritten source-to-target bridges.

The sequence therefore establishes general language semantics first, then defines capability/provider infrastructure, and only then adds a facade and concrete network slice. Numerical task order records this dependency flow; it is not a promise that the work is complete or immediately scheduled.

## Dependency-ordered sequence

1. [Task 004](../../todo/004-statement-sequencing-and-conditionals.md), [Task 005](../../todo/005-general-function-signatures-and-calls.md), and [Task 032 — condition-controlled loops and break/continue](../../todo/032-condition-controlled-loops-and-break.md) are delivered. Task 032 supplies a general strict-Boolean loop model without recognizing stdlib-specific read-loop idioms.
2. [Task 009](../../todo/009-closed-records-and-member-access.md) is delivered. Task 033 was delivered through PR #43 at exact head `98a9fa5bb1048fbe44e798acdefd65b9d6d2560e` and merge commit `f2e7f44aa8065f785c314b66e1f1d55992b7c998`. Its bounded nominal reference identity, private state, construction, and receiver calls are single-module semantics; immutable records alone are insufficient for executable facades.
3. [Task 034 — effectful capabilities and resource lifetime](../../todo/034-effectful-capabilities-and-resource-lifetime.md) is implemented locally. It defines explicit compiler-authorized host effects, resource ownership, deterministic close, and typed failure boundaries without claiming async, concurrency, `finally`, RAII, versioned canonical contracts, or provider linking.
4. Build project/module and effect foundations into [Task 035 — versioned standard-library contracts and provider linking](../../todo/035-versioned-standard-library-contracts-and-provider-linking.md). This owns canonical capability modules, provider registry/negotiation, protected native bindings, transactional linking, and tree-shaking.
5. Add [Task 036 — language compatibility stdlib/facades](../../todo/036-language-compatibility-stdlib-facades.md). It owns proved stdlib identity, executable source-language facades, collision-safe target names, and same-language recursion isolation.
6. Combine the loop and facade branches in [Task 037 — blocking TCP client stdlib vertical slice](../../todo/037-blocking-tcp-client-stdlib-vertical-slice.md). This is the first concrete proof, not a general networking or all-language milestone.

The direct dependency chain is also recorded in the [roadmap graph and task index](../../todo/README.md). Phase S stays non-blocking until its prerequisite tasks are delivered; it must not distort the existing language/platform lanes.

## First end-to-end proof

Task 037 provides only these initial integrations:

- canonical versioned blocking `SocketClient`, text-stream line-read, output, and resource-close capabilities;
- Ruby language compatibility stdlib/facades preserving the supported `TCPSocket.new(host, port)`, `gets`, and `close` shape plus bounded one-string `puts(string)`/`Kernel.puts(string)`;
- a canonical output operation that writes the string once and appends LF only when it does not already end in LF;
- a PHP target host provider/native binding implemented with genuine `fsockopen`, `fgets`, and `fclose` for socket operations plus native stdout output without a duplicate LF; and
- generated PHP that can retain `TCPSocket` and the bounded `puts` function in a collision-safe compatibility namespace/import alias while they call canonical provider operations.

Acceptance starts a real local ephemeral TCP server controlled by the test. Generated PHP runs with the real PHP CLI and must prove exact output, retained input newlines, one appended LF for a final unterminated string, no duplicate LF, an absent result only at clean EOF, normalized connection error before a usable resource escapes, deterministic successful close, the specified repeated-close result, and a typed use-after-close failure. The server and client tests use bounded timeouts so blocking behavior cannot hang the lane.

Negative acceptance covers unresolved or shadowed `TCPSocket` or `puts`, monkey-patching/reopening, dynamic require/lookup, unsupported APIs/options, excluded multi-argument/array/coercive/custom-separator `puts` behavior, missing provider capabilities, namespace collisions, version mismatch, and late provider/link failure. Every failure occurs before partial artifact exposure.

## Delivery discipline for future implementation

Each behavior task must add focused specs, exact public contracts, documentation, and a changelog fragment. Runtime-generation coverage must invoke the real required tools and a real local socket; source snapshots are insufficient. Implementations must validate and return deterministic complete artifact sets, retain semantic/synthetic provenance, and fail if a required tool is unavailable.

The plan itself adds no compiler/runtime behavior or implementation authority. Tasks 032 and 033 are delivered. Task 034 is implemented locally as an unversioned, single-module semantic/effect/lifetime foundation; Tasks 035–037 remain unimplemented. Neither this plan nor those semantic prerequisites trigger release, CI-topology changes, external task mutation, or expansion into later facade/provider tasks.
