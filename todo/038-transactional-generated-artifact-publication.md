# 038 — Transactional generated-artifact publication

- Status: `roadmap`
- Phase/priority: Phase W / P0 foundation
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Add a public, filesystem-safe publisher for one complete generated project generation. It stages and validates immutable `GeneratedArtifactSet` values, records exact ownership, and promotes only a complete candidate while retaining the previous successful generation on any failure.

## Current evidence and gap

Task 015 delivered deterministic immutable artifact sets, rich provenance, exact toolchain discovery, and an acceptance runner that materializes artifacts only in a private temporary directory. Application backends separately validate their logical artifact paths before returning in-memory sets. There is no public persistent materializer, output ownership manifest, staged promotion contract, or interrupted-publication recovery path.

Writing each returned artifact directly with `writeFile` would expose mixed generations, leave stale generated files, and risk deleting caller-owned files. The publisher belongs above every backend; individual language emitters must remain filesystem-pure.

## Planned contract

- Introduce one importable JavaScript class/module that accepts already validated artifact sets plus explicit project/target/output identity. Do not embed implementation in a CLI string or backend.
- Require a canonical project root and a target-owned output directory. Reject absolute artifact paths, `..`, empty/non-canonical segments, separator aliases, case-fold collisions where relevant, source/output overlap, symlink traversal, and any resolved path outside the owned root.
- Stage every artifact, mapping, and versioned ownership manifest under a unique sibling staging root. Verify bytes, declared media type/role, stable order, provenance/mapping references, and cryptographic content hashes before promotion.
- The committed manifest records schema version, target ID/role, cycle/generation identity, ordered owned paths, byte lengths, and hashes. It is the sole authority for later stale-file removal; unlisted files are never deleted or overwritten.
- Promote a complete directory generation transactionally with a recovery journal. A failed preflight, stage write, check callback, rename, or cleanup retains/restores the last committed generation and reports the exact recovery state.
- Support a validator callback over the staged candidate so Task 040 can compile/check before promotion. The callback receives exact staged paths and no mutation authority outside the declared build root.
- Support coordinated source-output and compiler-output ownership under one cycle identity without presenting a half-new pair as successful.
- Reconcile abandoned task-owned staging/journal state on the next invocation. Fail closed on ambiguous ownership or a malformed/tampered manifest.

## Diagnostics

Use stable diagnostics for invalid output roots/paths, collision, source/output overlap, symlink escape, unowned overwrite/delete, malformed ownership manifest, stage write/hash mismatch, validation failure, promotion failure, and unrecoverable journal state. Preserve the underlying filesystem error as `cause` without leaking unrelated environment data.

## Tests

- Publish a multi-artifact candidate, read back exact bytes/manifest/order, and publish an updated candidate that removes one previously owned stale file.
- Prove unowned files remain untouched and collisions, traversal, symlink escape, malformed manifests, and output/source overlap fail before mutation.
- Inject failure at each stage/write/validation/promotion boundary and assert the previous generation remains byte-for-byte usable.
- Simulate interruption states described by the journal and prove deterministic forward completion or rollback without deleting ambiguous data.
- Generate twice and assert deterministic manifest content apart from an explicitly modeled generation identity.
- Exercise real temporary directories on supported host filesystems; do not replace behavior proof with source-string assertions.

## Documentation

Document the ownership manifest, output-root constraints, publication state machine, recovery procedure, and caller obligations in the public API/architecture docs. Add a behavior changelog fragment when implemented.

## Non-goals

Project configuration, source discovery, CLI commands, filesystem watching, compiler argument planning, package restore, runtime execution, cache eviction policy, signing, and application deployment.

## Completion criteria

- A caller can safely persist any existing generated artifact set without language-specific filesystem code.
- Failed validation or publication cannot replace or corrupt the last committed generation.
- Stale generated files are removed only through an authenticated prior ownership manifest; caller-owned files remain untouched.
- Recovery, path safety, deterministic output, focused tests, lint/typecheck, documentation, and changelog satisfy repository gates.
