# 039 — Project manifest and one-shot build CLI

- Status: `roadmap`
- Phase/priority: Phase W / P0 foundation
- Dependencies: [010-multifile-modules-and-names.md](010-multifile-modules-and-names.md), [038-transactional-generated-artifact-publication.md](038-transactional-generated-artifact-publication.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Add a strict versioned Semantifold project manifest and a real package CLI that turns an explicit source snapshot into one atomically selected immutable project generation containing one or more generated targets in a one-shot `build` operation.

## Current evidence and gap

`parseProgram({entryModule, sources})` and `generateProgramArtifactSet({language, program})` already accept explicit multi-file projects. Target-only binary/application roles are also available through the generation APIs. `package.json` exposes no `bin`, the package has no project manifest, callers must assemble every API request themselves, and no product path publishes returned artifacts.

## Planned manifest

Define and validate `semantifold.json` version 1 with no unknown fields. It declares:

- an ordered list of source modules with explicit path, registered source language, stable module ID, and exactly one entry module;
- one project-relative publisher-owned publication root;
- an ordered list of targets with registered target ID, explicit role (`text`, `binary`, or `application`), generated-source projection path, and optional compiler/build projection path reserved for Task 040, all relative to one immutable generation;
- project-relative paths only, normalized against the manifest directory;
- no glob syntax, package-manager resolution, arbitrary environment expansion, JavaScript callbacks, shell hooks, or inferred language from extension in version 1.

Reject duplicate module/target identities, unsupported roles, feature-incompatible targets, publication/source overlap, colliding or nested target projections, and any path that escapes or aliases the declared publication root. Independently promoted output/build roots are invalid.

## CLI contract

- Add an executable ESM `semantifold` package bin with a planned `build --project <path>` command. The default project path may be `./semantifold.json`; every other argument and unknown option fails loudly.
- Implement CLI behavior in importable classes/modules. Spawn no shell and hide no durable logic in `node -e` or template strings.
- Load and freeze one complete source snapshot before parsing. Every source read is explicit and ordered; a mid-read mutation causes a bounded retry or a located unstable-snapshot failure, never a mixed parse.
- Parse/link once, generate every declared target from that semantic snapshot, stage all target source/build projections beneath one immutable project generation, and commit it all-or-nothing through Task 038's single active-pointer replacement.
- Emit concise human diagnostics and an optional newline-delimited JSON protocol with project identity, source snapshot hash, cycle `1`, target results, timings, and exactly one terminal record.
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

Document the manifest schema, command, path/ownership rules, diagnostics, exit statuses, examples, and the clear distinction between implemented `build` and future `watch`/`--check`. Add a behavior changelog fragment when implemented.

## Non-goals

Filesystem watching, compiler execution, arbitrary includes/excludes/globs, package resolution, implicit source-language detection, user plugins/hooks, daemon IPC, editor integration, or runtime execution.

## Completion criteria

- A fresh consumer can declare explicit sources/targets and run one deterministic build that publishes one immutable project generation through one atomic active-pointer replacement.
- The CLI composes existing public semantic APIs instead of duplicating parser/backend dispatch.
- Multi-target failure is atomic, protocol/exit behavior is deterministic, and the packed CLI passes focused tests, lint/typecheck, docs, and package gates.
