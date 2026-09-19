# 038 — Transactional generated-artifact publication

- Status: `delivered in semantifold@0.9.0`
- Phase/priority: Phase W / P0 foundation
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Add a public, filesystem-safe publisher for one complete generated project generation. It stages and validates immutable `GeneratedArtifactSet` values beneath one owned publication root, records exact ownership, and commits only a complete candidate through one atomic active-generation pointer replacement.

## Delivered implementation

Task 015 delivered deterministic immutable artifact sets, rich provenance, exact toolchain discovery, and an acceptance runner that materializes artifacts only in a private temporary directory. Task 038 adds the public language-neutral `GeneratedArtifactPublisher` above those pure backends. It persists complete role-bearing target sets and validator/compiler by-products beneath a dedicated publication directory inside one canonical project root, verifies a deterministic versioned manifest, complete filesystem inventory, hard-link safety, and SHA-256 hashes, and makes exactly one immutable generation active through a synchronized same-directory regular-file pointer replacement.

The implementation includes pointer-once reader resolution and journal-bounded recovery. Pre-replacement failures retain the prior generation; post-replacement failures retain the new truthful authority; cleanup never deletes committed or ambiguous generations. Backends remain filesystem-pure. The public contract, layout, reader obligation, diagnostics, and single-writer/retention boundaries are documented in [transactional generated-artifact publication](../docs/generated-artifact-publication.md).

## Delivered contract

- Introduce one importable JavaScript class/module that accepts a complete set of already validated artifact sets plus explicit project/target identity and one project publication root. Do not embed implementation in a CLI string or backend.
- Require a canonical project root and a dedicated publisher-owned publication directory on one filesystem. Generated-source and compiler-output locations are normalized target-relative subpaths inside each project generation, never absolute or independently promoted authorities. Reject `..`, empty/non-canonical segments, separator aliases, case-fold collisions where relevant, source/publication overlap, projection overlap/nesting, symlink traversal, and any resolved path outside the owned root.
- Stage every target artifact, mapping, compiler by-product, and versioned generation manifest under a unique `<publication-root>/generations/<generation-id>/...` candidate. Verify bytes, declared media type/role, stable order, provenance/mapping references, and cryptographic content hashes before the generation becomes reachable.
- The immutable generation manifest records schema version, all target IDs/roles, cycle/generation identity, ordered generated/build projection paths, byte lengths, and hashes. A separately stored active-generation pointer is the sole mutable publication authority. Stale files disappear by selecting a new immutable generation rather than by in-place deletion.
- Commit the complete project generation with exactly one same-directory active-pointer replacement after the candidate and pointer temporary have been synced, then sync the pointer's parent directory before reporting success. Require a host filesystem with atomic same-directory regular-file replacement and fail before publication when that contract is unavailable; never fall back to copying, truncating, or rewriting the live pointer in place. An interruption before replacement leaves the prior pointer authoritative; after replacement recovery may observe the old or new complete pointer, never a composite state. Never claim a sequence of source-root, build-root, or target-root renames is atomic.
- Support validator callbacks over the staged candidate so Task 040 can compile/check before publication. Each callback receives exact generation-scoped source/build paths and no mutation authority outside that candidate generation.
- Publish every target's generated source and compiler output under the same generation identity and active pointer, so a reader that resolves the pointer once cannot observe a half-new pair or mixed targets.
- Reconcile abandoned unpublished candidates and temporary-pointer cleanup on the next invocation. Recovery may delete only a task-owned candidate proven never to have been committed; publication never deletes a committed generation because a reader may already hold that resolved snapshot. Retention/garbage collection for committed generations remains a separate explicit policy, and the journal is not the commit mechanism. Fail closed on ambiguous ownership or a malformed/tampered manifest.

## Diagnostics

Use stable diagnostics for invalid publication roots/projections, collision, source/publication overlap, symlink escape, unowned overwrite/delete, malformed generation manifest or active pointer, stage write/hash mismatch, validation failure, pointer publication failure, and unrecoverable journal state. Preserve the underlying filesystem error as `cause` without leaking unrelated environment data.

## Tests

- Publish a multi-target, multi-artifact candidate, resolve the active pointer once, read back exact generated/build bytes and manifest order from that generation, then publish an updated generation that omits one previously owned stale file.
- Prove unowned files outside the publication root remain untouched and collisions, traversal, symlink escape, malformed manifests/pointers, and publication/source overlap fail before commit.
- Inject failure at each stage/write/validation/pointer-publication boundary. Before pointer replacement the previous generation remains authoritative and byte-for-byte usable; after replacement the new generation is authoritative and cleanup failure cannot roll it back.
- Run a concurrent-reader regression that repeatedly resolves one active pointer and reads source plus compiler outputs while publication occurs; every read set must come entirely from the old or new immutable generation, never a mixture.
- Simulate interruption states described by the cleanup journal and prove deterministic reconciliation without deleting any committed or ambiguous generation.
- Generate twice and assert deterministic generation-manifest content apart from an explicitly modeled generation identity.
- Exercise real temporary directories on supported host filesystems; do not replace behavior proof with source-string assertions.

## Documentation

Document the generation manifest, single publication-root/projection constraints, active-pointer state machine, reader snapshot obligation, recovery procedure, and caller obligations in the public API/architecture docs. Add a behavior changelog fragment when implemented.

## Non-goals

Project configuration, source discovery, CLI commands, filesystem watching, compiler argument planning, package restore, runtime execution, cache eviction policy, signing, and application deployment.

## Completion criteria

- A caller can safely persist any existing generated artifact set without language-specific filesystem code.
- Failed validation or pre-commit publication cannot replace or corrupt the active generation; once the single pointer replacement succeeds, that new immutable generation is the truthful committed state.
- Every reader can resolve the active pointer once and obtain all target generated/build paths from exactly one immutable generation.
- Stale generated files disappear from the active view only by selecting an authenticated new generation; prior committed generations remain immutable until a separately specified safe-retention policy, and caller-owned files outside the publication root remain untouched.
- Recovery, path safety, deterministic output, focused tests, lint/typecheck, documentation, and changelog satisfy repository gates.

## Implementation delivery record

- Implementation branch: `feature/task038-transactional-publication`, based on released `v0.8.0` commit `2e21976656a1ffd534f5146d9ee9cb14c676be39`.
- Public surface: `GeneratedArtifactPublisher` with `publish(request)` and pointer-once `resolveActive()`.
- Focused real-filesystem coverage: initial/update publication, stale omission, unowned-file preservation, deterministic manifests with target roles, rich mapping persistence, complete generation inventory, hard-link rejection, concurrent old/new readers, native-path identity/projection/collision/symlink/overlap failures, normalized committed-state filesystem failures, durable cleanup ordering, truthful pending cleanup, byte tampering, stage/validator/pointer/cleanup failures, malformed state, and interrupted-state reconciliation.
- Pull request: [#55](https://github.com/kaspernj/semantifold/pull/55). Coordinator-owned review, TensorBuzz CI, merge, and release remain pending.
