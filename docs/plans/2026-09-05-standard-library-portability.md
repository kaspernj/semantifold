# Standard-library portability implementation plan

Date: 2026-09-05

Status: dependency-ordered plan; Tasks 032–036 are delivered, with Task 035 merged through PR #45 as `a2aad9d4932bfc6087adc4ff8bca43678c92413c` and Task 036 through PR #46 as `9aba48f9d48bcef4fd4c9275aec14bfcc4f0904c`. Task 037 implements its bounded Ruby-to-PHP TCP slice on the current topic branch; review, exact-head CI, and merge remain.

## Goal and architecture reference

Deliver the first bounded proof of the [standard-library portability architecture](../standard-library-portability.md): language compatibility stdlib/facades and target host providers/native bindings meet only through versioned canonical Semantifold stdlib contracts/capabilities. Pair-specific adapters and direct behavior-changing rewrites are excluded.

## Why semantic prerequisites come first

The published `semantifold@0.3.0` package cannot express the full set of imports, receiver calls, reference classes, condition-controlled loops, optional EOF, typed failures, resource identities, ownership, and close effects required by this plan. The current source tree has since delivered Task 032's general loop/control foundation, Task 033's bounded single-module reference classes and receiver calls, Task 034's compiler-authorized effect/resource foundation, Task 035's versioned canonical contracts, target provider registry, negotiation, protected linking, and tree-shaken artifacts, and Task 036's generic facade-resolution layer with neutral test definitions. Task 037 now implements the concrete bounded socket behavior on its topic branch.

The sequence therefore establishes general language semantics first, then defines capability/provider infrastructure, and only then adds a facade and concrete network slice. Numerical task order records this dependency flow; it is not a promise that the work is complete or immediately scheduled.

## Dependency-ordered sequence

1. [Task 004](../../todo/004-statement-sequencing-and-conditionals.md), [Task 005](../../todo/005-general-function-signatures-and-calls.md), and [Task 032 — condition-controlled loops and break/continue](../../todo/032-condition-controlled-loops-and-break.md) are delivered. Task 032 supplies a general strict-Boolean loop model without recognizing stdlib-specific read-loop idioms.
2. [Task 009](../../todo/009-closed-records-and-member-access.md) is delivered. Task 033 was delivered through PR #43 at exact head `98a9fa5bb1048fbe44e798acdefd65b9d6d2560e` and merge commit `f2e7f44aa8065f785c314b66e1f1d55992b7c998`. Its bounded nominal reference identity, private state, construction, and receiver calls are single-module semantics; immutable records alone are insufficient for executable facades.
3. [Task 034 — effectful capabilities and resource lifetime](../../todo/034-effectful-capabilities-and-resource-lifetime.md) is delivered through PR #44, merged as `c15e0874c054b6c462304eb29538d72ed43829d6`. It defines explicit compiler-authorized host effects, resource ownership, deterministic close, and typed failure boundaries without claiming async, concurrency, `finally`, RAII, versioned canonical contracts, or provider linking.
4. [Task 035 — versioned standard-library contracts and provider linking](../../todo/035-versioned-standard-library-contracts-and-provider-linking.md) is delivered through PR #45 and merge `a2aad9d4932bfc6087adc4ff8bca43678c92413c`. It owns canonical capability modules, the provider registry, negotiation, protected native bindings, transactional linking, and tree-shaking.
5. [Task 036 — language compatibility stdlib/facades](../../todo/036-language-compatibility-stdlib-facades.md) is delivered through PR #46 and merge `9aba48f9d48bcef4fd4c9275aec14bfcc4f0904c` with a bounded neutral original-five qualification corpus. It owns proved stdlib identity, executable source-language facades, collision-safe target names, and same-language recursion isolation without taking Task 037 behavior.
6. [Task 037 — blocking TCP client stdlib vertical slice](../../todo/037-blocking-tcp-client-stdlib-vertical-slice.md) implements the first concrete Ruby-source-to-PHP-target proof on its topic branch. It is not a general networking or all-language milestone.

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

## Delivery discipline

Each behavior task must add focused specs, exact public contracts, documentation, and a changelog fragment. Runtime-generation coverage must invoke the real required tools and a real local socket; source snapshots are insufficient. Implementations must validate and return deterministic complete artifact sets, retain semantic/synthetic provenance, and fail if a required tool is unavailable.

The plan itself adds no compiler/runtime behavior or implementation authority. Tasks 032–036 are delivered, and Task 037's implementation candidate is recorded by its owning task and documentation. Neither this plan nor those implementations trigger release, CI-topology changes, external task mutation, or expansion beyond the bounded TCP slice.
