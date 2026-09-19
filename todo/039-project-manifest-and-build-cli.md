# 039 — Project manifest and one-shot build CLI

- Status: `implemented locally; focused and package acceptance pass; coordinator review / exact-head TensorBuzz CI / merge pending`
- Phase/priority: Phase W / P0 foundation
- Dependencies: [010-multifile-modules-and-names.md](010-multifile-modules-and-names.md), [038-transactional-generated-artifact-publication.md](038-transactional-generated-artifact-publication.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Add a strict versioned Semantifold project manifest and a real package CLI that turns an explicit source snapshot into one atomically selected immutable project generation containing one or more generated targets in a one-shot `build` operation.

## Starting evidence and delivered result

The released `semantifold@0.9.0` starting point provided `parseProgram({entryModule, sources})`, `generateProgramArtifactSet({language, program})`, and Task 038 transactional publication but exposed no package bin or project manifest. Task 039 now adds the strict loader and immutable project value, bounded stable snapshot builder, one-shot builder, reporter, strict CLI, and packaged executable. The builder composes the existing semantic/backend dispatch and publishes all ordered targets through one deterministic immutable generation.

## Implemented manifest

Define and validate `semantifold.json` version 1 with no unknown fields. It declares:

- an ordered list of source modules with explicit path, registered source language, stable module ID, and exactly one entry module;
- one project-relative publisher-owned publication root;
- an ordered list of targets with registered target ID, explicit role (`text`, `binary`, or `application`), generated-source projection path, and optional compiler/build projection path reserved for Task 040, all relative to one immutable generation;
- project-relative paths only, normalized against the manifest directory;
- no glob syntax, package-manager resolution, arbitrary environment expansion, JavaScript callbacks, shell hooks, or inferred language from extension in version 1.

Reject duplicate module/target identities, unsupported roles, feature-incompatible targets, publication/source overlap, colliding or nested target projections, and any path that escapes or aliases the declared publication root. Independently promoted output/build roots are invalid.

## Implemented CLI contract

- The executable ESM `semantifold` package bin implements `build`, defaults to `./semantifold.json`, accepts one `--project <path>` and one `--ndjson`, and rejects every other argument or duplicate.
- Implement CLI behavior in importable classes/modules. Spawn no shell and hide no durable logic in `node -e` or template strings.
- Load and freeze one complete source snapshot before parsing. Every source read is explicit and ordered; a mid-read mutation causes a bounded retry or a located unstable-snapshot failure, never a mixed parse.
- Parse/link once, generate every declared target from that semantic snapshot, stage all target source/build projections beneath one immutable project generation, and commit it all-or-nothing through Task 038's single active-pointer replacement.
- Emit concise human diagnostics and an optional deterministic newline-delimited JSON state protocol with project identity, source snapshot hash, cycle `1`, ordered target results, and exactly one terminal record.
- Return exit `0` only after the active-generation pointer names the committed candidate. Configuration, source-read, parse, semantic, generation, check, or pre-pointer publication failure returns non-zero and leaves the prior pointer authoritative.
- Package the bin in the public tarball and prove a fresh credential-free packed consumer can run it.

## Tests

- Strict manifest acceptance/rejection, including unknown keys, duplicate IDs, role mismatch, path aliases/escapes, source/publication overlap, independent-root configuration, and target-projection nesting.
- One-file and Task 010 multi-file builds through real public frontends/backends, including JavaScript/JSDoc to Java and at least one multi-artifact target.
- Multiple target entries stage from one source hash under one generation and become visible through one pointer switch; one late target failure leaves the prior active generation unchanged.
- Snapshot mutation during load cannot mix source revisions.
- Human and JSON output contain one truthful terminal result; exit status preserves the first failure.
- Packed-consumer execution proves shebang/mode/bin mapping and no repository-relative imports.

## Documentation

[Project manifest and one-shot build CLI](../docs/project-build-cli.md) documents the schema, command, path/ownership rules, snapshot and transaction semantics, human/NDJSON output, diagnostics, exit statuses, importable API, and copy-ready JavaScript/JSDoc-to-Java example. It distinguishes implemented generation/publication from later compiler/check and watch tasks.

## Non-goals

Filesystem watching, compiler execution, arbitrary includes/excludes/globs, package resolution, implicit source-language detection, user plugins/hooks, daemon IPC, editor integration, or runtime execution.

## Completion criteria

- A fresh consumer can declare explicit sources/targets and run one deterministic build that publishes one immutable project generation through one atomic active-pointer replacement.
- The CLI composes existing public semantic APIs instead of duplicating parser/backend dispatch.
- Multi-target failure is atomic, protocol/exit behavior is deterministic, and the packed CLI passes focused tests, lint/typecheck, docs, and package gates.

The implementation and focused real-filesystem/packed-consumer coverage satisfy these criteria locally. Independent review, exact-head TensorBuzz CI, merge, and release remain coordinator-owned.
