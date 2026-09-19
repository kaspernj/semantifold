# Project manifest and one-shot build CLI

Task 039 adds a strict filesystem boundary above the existing `parseProgram`, `generateProgramArtifactSet`, and `GeneratedArtifactPublisher` APIs. A build reads one explicit source graph, parses and links it once, generates every ordered target from that semantic program, and makes the complete immutable generation active with one pointer replacement. It does not discover sources, infer languages, invoke a compiler, or execute generated code.

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

Each target has exactly `id`, `language`, `role`, `sourceProjection`, and optional `buildProjection`. The role is `text`, `binary`, or `application` and must match both the language registry and an implemented complete-program backend. The existing original-five text program backends are supported. A registered single-module target is not automatically a project target; complete-program binary generation is not implemented. Existing application program backends may participate only with the default, asset-free request expressible by this schema. This does not define Task 046 watch/check policy.

`sourceProjection` is required. `buildProjection` reserves the Task-040 compiler-output location but Task 039 does not write to it; when omitted it is `targets/<target-id>/build`. Both are logical paths inside one immutable generation, never separately promoted output roots.

Version 1 has no globs, extension inference, package resolution, environment expansion, configuration callbacks, plugins, shell hooks, commands, target-specific compiler settings, or independent output roots.

## Paths and ownership

Manifest paths use `/`, contain no empty, dot, or dot-dot segment, and are neither absolute nor drive-qualified. Source paths may use valid Unicode scalar filenames; publication and projection paths use the portable ASCII artifact alphabet. Portable case-fold aliases, duplicate module/target IDs, hard-linked source aliases, and colliding or nested projections are rejected.

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

The SHA-256 snapshot hash is length-framed over the exact manifest bytes and ordered source IDs, paths, languages, and UTF-8 content. Absolute host paths and wall-clock values are absent. The generation ID is `g-<snapshot-hash>`.

`ProjectBuilder` parses and links the frozen sources once. It generates targets in manifest order through the existing program backend dispatch. Only after every target succeeds does it give the complete ordered set to `GeneratedArtifactPublisher`. The publisher stages all projections beneath the one generation and replaces `active-generation.json` once. A configuration, read, parse, link, semantic, generation, or pre-pointer publication failure leaves the prior active generation authoritative. Rebuilding identical inputs resolves and verifies the already-active deterministic generation.

## Command and output

The public package installs one executable:

```sh
semantifold build
semantifold build --project path/to/semantifold.json
semantifold build --project path/to/semantifold.json --ndjson
```

The default is `./semantifold.json`. `build`, `--project <path>`, and `--ndjson` are the complete grammar. Options may appear once. Unknown commands/options, missing option values, duplicate options, and positional extras fail with `INVALID_CLI_ARGUMENTS`. The executable passes argument arrays directly to the importable CLI; it does not spawn a shell.

Human mode prints one concise success line only after the active pointer names the committed generation, or one diagnostic line on failure. Exit status is `0` only for that committed or verified deterministic generation and `1` for the first failure.

`--ndjson` writes one `SemantifoldBuildEvent` version-1 JSON object per line. Every record has `cycle: 1`, `project`, and `state`. Successful builds emit these deterministic states in order:

```json
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"state":"project-loaded"}
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"snapshotHash":"<sha256>","state":"snapshot-loaded"}
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"artifactCount":1,"language":"java","role":"text","state":"target-generated","target":"java-main"}
{"cycle":1,"project":"jsdoc-java-example","schema":"SemantifoldBuildEvent","version":1,"exitCode":0,"generationId":"g-<sha256>","snapshotHash":"<sha256>","state":"succeeded","targets":[{"artifactCount":1,"id":"java-main","language":"java","role":"text"}],"terminal":true}
```

There is exactly one record with `terminal: true`. Failure records use `state: "failed"`, `exitCode: 1`, and a stable structured diagnostic. Records contain state rather than nondeterministic elapsed time.

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
```

Resolve `.semantifold/active-generation.json`; its generation contains Java at `targets/java/source/semantifold/generated/main/Main.java`. The reserved `targets/java/build` directory is empty.

Task 039 does not run `javac`, execute Java, check any target with its toolchain, watch files, garbage-collect committed generations, or implement hot reload. Target-owned check plans and Java compilation are Task 040; watch coordination and acceptance remain Tasks 043 and 044.

## Importable API and diagnostics

`ProjectManifestLoader`, `SemantifoldProject`, `ProjectSnapshotBuilder`, `ProjectSnapshot`, `ProjectBuilder`, `ProjectBuildReporter`, `SemantifoldCli`, and `parseSemantifoldCliArguments` are public ESM exports. The executable is only a thin wrapper around `SemantifoldCli`.

Manifest/snapshot diagnostics include `INVALID_PROJECT_MANIFEST`, `INVALID_PROJECT_PATH`, `PROJECT_SOURCE_ALIAS`, `PROJECT_SOURCE_PUBLICATION_OVERLAP`, `PROJECT_PROJECTION_COLLISION`, `PROJECT_SYMLINK_TRAVERSAL`, `PROJECT_MANIFEST_READ_FAILED`, `PROJECT_SOURCE_READ_FAILED`, `INVALID_PROJECT_SOURCE_ENCODING`, `UNSUPPORTED_PROJECT_SOURCE`, `UNSUPPORTED_PROJECT_TARGET`, and `UNSTABLE_PROJECT_SNAPSHOT`. Registry, parser, semantic, backend, artifact, and publication diagnostics retain their existing codes and causes. User output uses project-relative locations and does not print unrelated absolute host paths.
