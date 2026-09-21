# Project manifest and one-shot build CLI

Task 039 adds a strict filesystem boundary above the existing `parseProgram`, `generateProgramArtifactSet`, and `GeneratedArtifactPublisher` APIs. Tasks 040–042 compose the registered developer-check boundary without moving target behavior into the CLI. A build reads one explicit source graph, parses and links it once, generates every ordered target from that semantic program, and makes the complete immutable generation active with one pointer replacement. Ordinary `build` remains generation-only; `build --check` invokes only target-owned non-executing plans. Neither mode executes generated code.

## `semantifold.json` version 1

The manifest is closed JSON: every object rejects unknown fields. The project file's containing directory is the project root.

```json
{
  "schema": "SemantifoldProject",
  "version": 1,
  "id": "jsdoc-java-example",
  "publicationRoot": ".semantifold",
  "sources": [
    {
      "id": "main",
      "path": "src/main.js",
      "language": "javascript",
      "entry": true
    }
  ],
  "targets": [
    {
      "id": "java-main",
      "language": "java",
      "role": "text",
      "sourceProjection": "targets/java/source",
      "buildProjection": "targets/java/build"
    }
  ]
}
```

Root fields are:

- `schema`: exactly `SemantifoldProject`.
- `version`: exactly `1`.
- `id`: a stable lowercase project ID matching `[a-z][a-z0-9-]*`.
- `publicationRoot`: one canonical project-relative portable path owned by the publisher.
- `sources`: a non-empty ordered array of explicit modules.
- `targets`: a non-empty ordered array of explicit generated targets.

Each source has exactly `id`, `path`, `language`, and Boolean `entry`. Module IDs are stable logical Task-010 identities. Paths are project-relative source paths; languages are explicit registered frontends that participate in the complete-program profile. All modules use one source-language compatibility profile, paths and IDs are unique, and exactly one module has `entry: true`. Extensions never select a language.

Each target has exactly `id`, `language`, `role`, `sourceProjection`, and optional `buildProjection`. The role is `text`, `binary`, or `application` and must match both the language registry and an implemented complete-program backend. The existing original-five text program backends are supported. A registered single-module target is not automatically a project target; complete-program binary generation is not implemented. Android and Flutter application backends may participate through their default, asset-free requests. iOS requires caller-supplied application identity and deployment configuration that version 1 cannot express, so an iOS application target fails at manifest loading with `UNSUPPORTED_PROJECT_TARGET`; direct public iOS generation with explicit configuration remains supported. This does not define Task 046 watch/check policy.

`sourceProjection` is required. `buildProjection` owns checker/compiler output and defaults to `targets/<target-id>/build`. Both are logical paths inside one immutable generation, never separately promoted output roots. A generation-only build leaves the build projection empty. PHP, Ruby, JavaScript, TypeScript, Rust, Dart, and Zig developer checks leave it empty; Dart 3.13.3 embeds the candidate's absolute source URI, while Zig Debug output retains its absolute project root, so those real native check outputs are removed. Java and Kotlin record class files, Python records its explicit checked-hash `.pyc`, C# records only final `bin/`, and Go/C/C++/Swift record their linked or compiled developer executable after transient restore/intermediate/cache/home/object/target state is removed.

Version 1 has no globs, extension inference, package resolution, environment expansion, configuration callbacks, plugins, shell hooks, commands, target-specific compiler settings, or independent output roots.

## Paths and ownership

Manifest paths use `/`, contain no empty, dot, or dot-dot segment, and are neither absolute nor drive-qualified. Source paths may use valid Unicode scalar filenames, including spaces; their duplicate, prefix, and Unicode case-fold comparisons remain in that source-path domain. Publication and projection paths separately retain the portable ASCII artifact alphabet. Portable source aliases, duplicate module/target IDs, hard-linked source aliases, and colliding or nested projections are rejected.

The manifest, every source, and every existing publication-root component must be real nonsymlink paths under the canonical project root. The publication root cannot contain a source or be a source. Source files may live directly in the project root because the publisher protects their exact paths rather than treating the entire parent directory as source-owned. `GeneratedArtifactPublisher` rechecks source/publication separation and symlink ownership before publication.

The publisher owns only:

```text
<publicationRoot>/
  active-generation.json
  generations/<generation-id>/
    manifest.json
    <target source projection>/...
    <target build projection>/...
```

Readers resolve `active-generation.json` once and retain the returned immutable generation paths for the whole read. They must not combine paths resolved from separate pointer reads.

## Snapshot and build semantics

`ProjectSnapshotBuilder` reads the exact manifest and all declared source files in manifest order. Descriptor identity, size, modification state, real paths, and exact bytes are checked, and the complete graph is read twice. One inconsistent graph receives one bounded retry. Continued mutation fails with a project-relative `UNSTABLE_PROJECT_SNAPSHOT`; a changed manifest is never combined with the already-validated project value.

The SHA-256 snapshot hash is length-framed over the exact manifest bytes and ordered source IDs, paths, languages, and UTF-8 content. Absolute host paths and wall-clock values are absent. The generation-only ID is `g-<snapshot-hash>`. Each checked invocation uses `g-<snapshot-hash>-checked-<uuid>` for its fresh candidate, so generation-only and compiler-bearing manifests never alias and compiler output produced by one validation run is never mistaken for a later run.

`ProjectBuilder` parses and links the frozen sources once. It generates targets in manifest order through the existing program backend dispatch. With `check: true`, each target must advertise an immutable developer-check capability. The builder discovers exactly that capability's toolchains and attaches a publisher validator; the validator constructs the target-owned plan only after generated artifacts exist in the candidate source subtree. The generic `TargetCheckRunner` validates the complete plan before spawning, owns timeout/cancellation and bounded output, and settles on child `close`. The builder propagates the same cancellation authority through publication, where it is rechecked immediately before the atomic pointer replacement. Only after every target succeeds and cancellation remains inactive does the publisher replace `active-generation.json` once. A configuration, read, parse, link, semantic, generation, discovery, plan, check, cancellation, or pre-pointer publication failure leaves the prior active generation authoritative.

Java's target-owned plan declares only stage `compile` and toolchain `javac`, even though full acceptance metadata also declares later `java` execution. It passes `-d <candidate-build-root>` followed by every staged `.java` artifact. Task 041 adds target-owned PHP `-n -l`, Ruby `--disable=gems -c`, Node `--check`, TypeScript no-emit, Kotlin/JVM class compilation, isolated checked-hash Python bytecode, and offline-isolated C# restore/build plans. Task 042 adds target-owned Go build/vet, strict C/C++ compile/link, Cargo locked/offline build/check, Swift type-check/compile, Dart offline lock verification/compile/format/analyze, and Zig build/format plans. The generic plan declares every staged input, every argv/environment path owner, optional restore-input SHA-256, nullable output ownership, and candidate source/build transient directories that the runner removes only after children close. It publishes the last declared compiler/linker output even when a later non-producing validator succeeds. No generic builder, runner, reporter, CLI, or watcher branch switches on a language ID.

The version-1 project manifest continues to support complete-program text generation only for PHP, Ruby, JavaScript, TypeScript, and Java. Consequently `build --check` can select all five original-language targets immediately; the Task 041–042 Kotlin/Python/C#/Go/C/C++/Rust/Swift/Dart/Zig plans are public and use the same runner for existing generated single-module artifact sets, but do not expand semantic program generation. C# accepts only the exact producer-owned `Semantifold.csproj`, disables ancestor directory-build imports through global properties at restore and compile, and supplies the complete sorted `.cs` set through the manifest's closed compile-item property. Its restore declares a length-framed hash of ordered project/lock content, uses only the staged source root as its package source, and writes packages, HTTP cache, CLI home, user home, temp, and MSBuild intermediates under the candidate build root. Those transient paths are deleted after compile or failure. Dart similarly accepts only its exact dependency-free package/lock, length-frames that restore identity, and removes `.dart_tool`, isolated pub state, and its native check output before publication. Zig removes its root-dependent Debug prefix with the same post-close transient cleanup. An unchanged watch reconciliation admits no cycle, so it cannot perform a restore.

Rebuilding identical generation-only inputs uses the same exact candidate comparison as retained-generation reactivation. If the same deterministic generation is retained but another generation is active, the publisher requires its canonical manifest bytes to equal the validator-free candidate exactly and revalidates the complete inventory, hashes, provenance, symlink boundaries, and hard-link identities before one atomic pointer replacement reactivates it. Task 038 intentionally forbids reactivation requests that carry validators, so a retained same-ID candidate with validators fails with `PUBLICATION_UNOWNED_CONFLICT` instead of trusting previously produced compiler output. Checked builds therefore submit a fresh immutable identity on every invocation and actually rerun every target check, including unchanged and reverted snapshots. A mismatched or malformed retained generation is neither overwritten nor removed, and the previous pointer remains authoritative.

## Command and output

The public package installs one executable:

```sh
semantifold build
semantifold build --check
semantifold build --project path/to/semantifold.json
semantifold build --project path/to/semantifold.json --check --ndjson
```

The default is `./semantifold.json`. `build`, `--project <path>`, `--check`, and `--ndjson` are the complete grammar. Options may appear once. Unknown commands/options, missing option values, duplicate options, and positional extras fail with `INVALID_CLI_ARGUMENTS`. The executable passes argument arrays directly to the importable CLI; it does not spawn a shell.

Human mode prints one concise success line only after the active pointer names the committed generation. Failures retain the outer build/publication diagnostic and render each nested Semantifold cause. A check-process failure then prints labeled project/target, tool, stage, exit/signal, duration, and bounded stdout/stderr evidence without repeating its cause line; tool discovery failures instead retain actionable missing, ambiguous, executable, and version details from their nested diagnostics. SIGINT or SIGTERM after a checker closes but before pointer replacement produces one failure terminal record, never a success record. Exit status is `0` only for a committed generation and `1` for the first failure.

`--ndjson` writes one `SemantifoldBuildEvent` version-1 JSON object per line. Every record has `cycle: 1`, `project`, and `state`. Successful builds emit these deterministic states in order:

```json
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"state":"project-loaded"}
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"snapshotHash":"<sha256>","state":"snapshot-loaded"}
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"artifactCount":1,"language":"java","role":"text","state":"target-generated","target":"java-main"}
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"exitCode":0,"generationId":"g-<sha256>","snapshotHash":"<sha256>","state":"succeeded","targets":[{"artifactCount":1,"id":"java-main","language":"java","role":"text"}],"terminal":true}
```

There is exactly one record with `terminal: true`. Failure records use `state: "failed"`, `exitCode: 1`, and a stable structured diagnostic. Generation-only records remain deterministic; checked-stage records add the observed lifecycle duration required for process reporting.

Checked builds insert one `target-checked` record per successful stage after `target-generated`. It contains the exact `argv`, target and language, stage, canonical tool ID/command/executable/source/version, exit code or signal, bounded stdout/stderr, and duration. The terminal record includes `checked: true`. Check failures retain the outer publication context and a nested compiler diagnostic rather than flattening away stage/tool/process evidence.

## JavaScript/JSDoc to Java example

Create `src/main.js`:

```js
/**
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
function add(left, right) {
  return left + right
}

console.log(add(2, 3))
```

Copy the manifest above to `semantifold.json`, then run:

```sh
npx semantifold build
npx semantifold build --check
```

Resolve `.semantifold/active-generation.json` once; the checked generation from this manifest contains Java at `targets/java/source/semantifold/generated/main/Main.java` and compiler output at `targets/java/build/semantifold/generated/main/Main.class`. The two paths belong to the same immutable generation and are never promoted separately. Omitting `buildProjection` instead selects `targets/<target-id>/build`.

`build --check` checks or compiles but never runs generated application behavior. Acceptance code may explicitly invoke committed output afterward. Tasks 043–044 compose the same builder through the packed `semantifold watch --check` JavaScript/JSDoc-to-Java workflow; see [deterministic project watch](project-watch.md) and the shipped [`examples/jsdoc-java-watch`](../examples/jsdoc-java-watch/) project. The terminal all-text acceptance matrix remains Task 045. No build or watch mode garbage-collects committed generations or implements hot reload.

## Importable API and diagnostics

`ProjectManifestLoader`, `SemantifoldProject`, `ProjectSnapshotBuilder`, `ProjectSnapshot`, `ProjectBuilder`, `ProjectBuildReporter`, `ProjectWatchCoordinator`, `ProjectWatchReporter`, `SemantifoldCli`, `parseSemantifoldCliArguments`, `createTargetCheckPlan`, and `TargetCheckRunner` are public ESM exports. `languageCapabilities[].check` truthfully exposes immutable `supported`, `stages`, and `toolchains` fields without claiming execution. The executable is only a thin wrapper around `SemantifoldCli`.

Plan and lifecycle failures use `UNSUPPORTED_TARGET_CHECK`, `INVALID_TARGET_CHECK_PLAN`, `TARGET_CHECK_PREPARATION_FAILURE`, `TARGET_CHECK_LAUNCH_FAILURE`, `TARGET_CHECK_OUTPUT_LIMIT`, `TARGET_CHECK_TIMEOUT`, `TARGET_CHECK_CANCELLED`, `TARGET_CHECK_SIGNAL`, `TARGET_CHECK_NONZERO_EXIT`, `TARGET_CHECK_CLEANUP_FAILURE`, and `TARGET_CHECK_OUTPUT_INVALID`. Restore failures retain stage `restore`; compiler failures retain stage `compile`. Discovery retains `TOOL_NOT_FOUND`, `TOOL_AMBIGUOUS`, and version diagnostics. Publisher validation remains the transaction boundary and preserves the check diagnostic as its structured cause.

Manifest/snapshot diagnostics include `INVALID_PROJECT_MANIFEST`, `INVALID_PROJECT_PATH`, `PROJECT_SOURCE_ALIAS`, `PROJECT_SOURCE_PUBLICATION_OVERLAP`, `PROJECT_PROJECTION_COLLISION`, `PROJECT_SYMLINK_TRAVERSAL`, `PROJECT_MANIFEST_READ_FAILED`, `PROJECT_SOURCE_READ_FAILED`, `INVALID_PROJECT_SOURCE_ENCODING`, `UNSUPPORTED_PROJECT_SOURCE`, `UNSUPPORTED_PROJECT_TARGET`, and `UNSTABLE_PROJECT_SNAPSHOT`. Registry, parser, semantic, backend, artifact, and publication diagnostics retain their existing codes and causes. User output uses project-relative locations and does not print unrelated absolute host paths.
