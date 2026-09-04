# 015 — Shared language-expansion foundation

- Status: `todo`
- Phase/priority: Phase L0 / P0
- Dependencies: [001-portable-scalar-values-and-types.md](001-portable-scalar-values-and-types.md), [002-local-declarations-and-assignment.md](002-local-declarations-and-assignment.md), [003-typed-operators-and-expressions.md](003-typed-operators-and-expressions.md), [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md)

## Purpose

Establish one shared contract for adding Python, C#, C, C++, Rust, Swift, Kotlin, Go, later Dart/Zig, and application/binary targets without duplicating dispatch, artifact, toolchain, provenance, or acceptance policy. This task changes infrastructure only; it adds no language, platform, or semantic capability.

## Current evidence and gap

[`../index.js`](../index.js), [`../src/frontends/index.js`](../src/frontends/index.js), and [`../src/backends/index.js`](../src/backends/index.js) use closed conditionals and one `SemanticLanguage` union. `supportedLanguages` implies that every listed language has both a frontend and textual backend. Generation returns one text artifact, although managed/native projects, browser Wasm, and later mobile apps require project/helper/binary/application artifacts. Runtime specs know the original five commands directly. Rich mappings model generated text coordinates, not binary byte offsets or project resources. Task 010 is intentionally later and concerns semantic multi-file modules, so it cannot be used to hide single-module artifact needs.

## Semantic and source profile

- Freeze the initial adoption schema at the exact Tasks 001–004 IR. Do not add types, expressions, statements, function arities, modules, ownership nodes, ABI nodes, or runtime effects.
- Keep `SemanticLanguage` (or its replacement name) a provenance/diagnostic source identity, not proof of frontend or backend support.
- Define separate, inspectable capability descriptors for frontend parsing, text generation, binary generation, application generation, interoperability bridging, artifact multiplicity, round-trip support, source-map form, and acceptance runner.
- Preserve the current public APIs for the original five. Any new project-artifact API must be additive and must give deterministic ordered filenames, media/type metadata, bytes or text, mappings, and one declared entry artifact.

## Frontend, backend, and artifact strategy

- Replace closed dispatch with explicit internal registries whose entries are immutable and reject duplicate IDs. Public capability inspection must be derived from the same records; no hand-maintained list may drift from actual dispatch.
- A frontend consumes exactly caller-supplied source and returns only semantic types. A textual backend emits source. A binary backend emits bytes. A browser lane may add loader/harness files, but is not thereby a source language.
- Define `GeneratedArtifactSet` for one semantic module: stable language/target ID, ordered unique relative paths, `text` or `binary` content, media type, role (`entry`, `source`, `manifest`, `support`, `mapping`, `resource`, or `loader`), ownership (`generated` only at this stage), and provenance. Reject absolute paths, traversal, duplicates, platform separators, empty content where invalid, and multiple entries.
- Preserve `generate`/`generateArtifact` for single-text targets. Multi-artifact or binary targets must require the artifact-set API rather than returning a misleading string.
- Generated helper headers, project manifests, lockfiles, loaders, and HTML are synthetic target artifacts. They neither create semantic modules nor satisfy Task 010.

## Parser and dependency qualification

Select the official Tree-sitter Node binding plus official grammar packages for Python, C#, C, C++, Rust, and Go as the parser route for Tasks 016–020 and 024. Swift and Kotlin use separately identified community grammar candidates only if this same qualification gate and differential checks against `swiftc`/`kotlinc` pass; Task 022 or 023 stays blocked otherwise. Dart and Zig candidates are qualified in their later tasks. Before any manifest change, record a reproducible qualification table covering:

- exact npm registry package/version, upstream repository/tag/commit, license, integrity/lockfile entry, Tree-sitter ABI compatibility, and Node 24 install/load behavior on the canonical Linux lane;
- typed Node API availability, UTF-8-byte versus Semantifold UTF-16 offset conversion, comments, missing/error/recovery nodes, malformed-input behavior, and every syntax node needed by Tasks 001–004;
- a small corpus per grammar proving complete child traversal and precise locations, differential parse acceptance against the official compiler where the grammar is community-maintained, plus an explicit check that no generated archive, Git URL/tarball dependency, postinstall download, or vendored parser binary enters the repository.

Qualification failure blocks the owning language task. It does not authorize a source-text fallback or an unrecorded parser substitution; change the roadmap/source decision explicitly first.

## Toolchain discovery and native/browser acceptance

- Add one discovery layer with configured override plus documented canonical command for each runtime/compiler/validator/browser. Resolve an exact executable, capture version output, and include it in failure diagnostics.
- Discovery never installs tools, searches the network, or silently skips. Missing, ambiguous, unsupported-version, compile, link, validation, launch, timeout, and nonzero-exit failures are distinct.
- Run builds in unique temporary project directories with explicit argument arrays, deterministic environment/locale/timezone, bounded timeouts, captured stdout/stderr, and no shell interpolation.
- Model parse, generate, compile, link, validate, instantiate, and execute as separate acceptance stages. A task may use only the stages applicable to its target.
- Implementation must update the canonical Dockerfile and TensorBuzz environments with distribution/toolchain sources deliberately. Platform-only toolchains such as Xcode remain in a declared TensorBuzz macOS lane rather than pretending to run in the Linux container. This planning task does not choose or install packages.

## Provenance and source maps

- Every generated text range continues to trace to original semantic provenance or an explicit synthetic reason. Artifact-set manifests and scaffolding carry related origins where useful.
- Add a binary/resource mapping form with half-open generated byte ranges, ordered/non-overlapping validation, originating semantic nodes/symbols, and synthetic-byte reasons. Never reinterpret byte offsets as UTF-16 text columns. Generated project resources without semantic text carry explicit synthetic/related provenance.
- Define how a target exposes standard Source Map v3 data when its ecosystem supports it. The rich Semantifold mapping remains authoritative and lossless even when an interoperable map is coarser.
- Reproducibility tests generate the same ordered paths, bytes/text, and normalized maps twice from the same module.

## Diagnostics and rejections

- Keep `UNSUPPORTED_LANGUAGE` for unknown IDs; add a stable role/capability diagnostic when a known ID lacks the requested frontend/backend/artifact operation.
- Registry shape, artifact path/content, tool discovery, and runner configuration failures must be normalized rather than leaking a native `TypeError` or subprocess exception.
- Backend capability validation completes before the first artifact is exposed. Artifact-set construction is transactional: a late unsupported node returns no partial files.

## Deterministic tests

- Registry specs prove each role independently, duplicate/unknown/missing-role rejection, stable ordering, feature-level support/rejection, and public discovery agreement.
- Compatibility specs prove all original `parse`, `generate`, `generateArtifact`, `supportedLanguages`, diagnostics, and mappings remain unchanged.
- Artifact specs cover one-file text, multi-file text, binary, mixed loader/binary, invalid paths, deterministic generation, and transactionality.
- Runner specs use small real programs with the already-required toolchains, plus controlled fake executables only for discovery/error-path tests. Real acceptance is never replaced with snapshots.
- Mapping specs cover Unicode sources, binary byte boundaries, synthetic scaffolding, and multiple artifacts.

## Documentation

Document language roles, capability inspection, artifact-set schema, tool overrides, required toolchain versions, failure stages, mapping coordinate systems, and the difference between generated project files and semantic multi-file programs. Add a behavior changelog fragment.

## Completion criteria

- One registry is the source of truth for dispatch and public role/capability discovery.
- Single-module text, project, binary, and browser artifact shapes are representable without implementing Task 010.
- Parser qualification is recorded per owning language; each official/community route passes its stated gate before that adapter may merge, without forcing later platform candidates into this foundation task.
- Tool discovery and real staged acceptance fail loudly and deterministically.
- Text and binary provenance contracts are tested, the original five APIs remain compatible, docs/changelog are updated, and every repository gate passes.

## Non-goals

Any new language adapter/backend, application target, semantic feature, user dependency resolution, implicit file reads, package installation, remote compiler service, plugin architecture, runtime download, parser bundling, Task 010 modules, mobile signing, or platform ABI.
