# Transactional generated-artifact publication

`GeneratedArtifactPublisher` persists one complete, already-validated project generation without moving filesystem behavior into a frontend or backend. It publishes all targets through one active-generation pointer; it never presents multiple file renames as project-level atomicity.

## Public API

```js
import {GeneratedArtifactPublisher} from "semantifold"

const publisher = new GeneratedArtifactPublisher({
  projectId: "example-project",
  projectRoot: "/workspace/example",
  publicationRoot: "/workspace/example/.semantifold-output",
  sourceRoots: ["/workspace/example/src"]
})

const published = await publisher.publish({
  generationId: "cycle-0001",
  targets: [{
    id: "java-main",
    role: "text",
    artifactSet: generatedJava,
    sourceProjection: "targets/java/source",
    buildProjection: "targets/java/build",
    validators: [async ({sourcePath, buildPath, targetId}) => {
      // Run a caller-owned checker/compiler with exact arguments and these exact paths.
      // Return metadata for every regular file it produced below buildPath.
      return [{
        path: "Main.class",
        mediaType: "application/java-vm",
        role: "compiler-output"
      }]
    }]
  }]
})
```

The constructor requires a stable lowercase project ID, one canonical absolute project root, one dedicated canonical publication directory strictly beneath that project root, and at least one canonical absolute source directory (`sourceRoots`) or exact source file (`sourceFiles`) within the project. Publication and declared source paths must remain disjoint both lexically and after real-path resolution. Task 039 uses exact source files so a source such as `<project>/main.js` does not falsely make every other path below the project source-owned. Absolute paths use the active host's native separator and reject its non-native separator alias; target-relative artifact and projection paths remain portable POSIX-style paths. The publication directory must be on a filesystem that supports atomic same-directory regular-file replacement and directory synchronization, and must not be changed concurrently by an untrusted process.

Each publication request supplies an explicit generation ID and a complete ordered target array. A fresh ID stages a new generation. An existing retained ID may be reactivated only for a validator-free request whose canonical manifest bytes exactly match the retained manifest; the publisher then revalidates the full immutable filesystem inventory before switching the pointer. It never invokes validators against, deletes, or overwrites a retained directory. A target has its own stable ID, explicit language-neutral `text`, `binary`, or `application` role, immutable `GeneratedArtifactSet`, and disjoint normalized source/build projections. Empty, absolute, dot, dot-dot, separator-alias, duplicate, portable case-fold, nested, manifest-reserved, escaping, and symlink-traversing paths fail before reachability. The class serializes calls made through one instance; callers must ensure there is only one project publication writer across instances and processes.

Validators receive one frozen object containing only `targetId`, the exact generation-scoped `sourcePath`, and the exact generation-scoped `buildPath`. The publisher does not grant a project root, publication root, command runner, or general filesystem capability. A validator may create regular files below its build path and must return ordered `{path, mediaType, role}` metadata for every such file. The publisher inventories the complete generation namespace, including all intermediate directories, and allows only the manifest plus declared source/build projections and files. Every projection root and descended directory is checked without following symbolic links before its entries are read. Undeclared siblings or directories, missing files, symlinks, special nodes, hard-linked files, duplicate reported device/inode identities, collisions, invalid metadata, callback failures, or generated-source mutation reject the candidate.

## Owned layout and manifests

The publisher owns these reserved entries beneath the caller-supplied root:

```text
<publication-root>/
  active-generation.json
  generations/
    <generation-id>/
      manifest.json
      <target source projection>/...
      <target build projection>/...
  .semantifold-publication-journal/
    <generation-id>.json
```

Generation directories are immutable after publication. `SemantifoldGenerationManifest` version 1 records the project and generation identities plus every ordered target ID and language-neutral role, backend target IDs, source/build projections, target metadata, generated artifacts, and validator/compiler outputs. Each generated-artifact record includes its relative path, exact UTF-8 or binary byte length, media type, role, SHA-256 hash, and complete rich/byte/synthetic provenance. Each build-artifact record includes its relative path, exact byte length, media type, language-neutral role, and SHA-256 hash.

The publisher synchronizes staged files, validator outputs, the manifest, and candidate directories. It then reads and hashes every referenced file and reconstructs every `GeneratedArtifactSet` from the staged bytes plus persisted provenance. This revalidates mapping filenames, generated content, Source Map projections, byte ranges, roles, target metadata, ordering, and entry identity before the generation can become active. Manifest JSON is deterministic apart from the explicit generation identity and the deterministic input content.

`active-generation.json` is a `SemantifoldActiveGeneration` version-1 record containing the project ID, generation ID, and SHA-256 manifest hash. The manifest intentionally contains no timestamps or ambient host paths.

## Commit and reader state machine

Fresh publication uses this order:

1. Validate identities, roots, projections, portable collisions, existing state, and the host replacement contract.
2. Write and synchronize an ownership journal, then create one unique candidate generation.
3. Stage, synchronize, validate, hash, and re-read every generated and build artifact plus the versioned manifest.
4. Write and synchronize a sibling temporary active pointer.
5. Atomically rename that regular file over `active-generation.json` in the same directory.
6. Synchronize the publication-root directory, then clean the no-longer-needed journal and synchronize the journal directory.

There is no copy, truncate, live-pointer rewrite, per-target promotion, or source/build directory rename fallback. Before step 5, the prior pointer remains authoritative. A publication transaction may supply an `AbortSignal`; the publisher checks it before filesystem work and again immediately before step 5, so cancellation after validation but before pointer replacement removes the journal-owned candidate and leaves the prior source/build bytes authoritative with `PUBLICATION_CANCELLED`. Once step 5 succeeds, the new complete generation is the visible authority; a later directory-sync failure is reported as `PUBLICATION_POINTER_FAILED` without deleting that generation. A journal-cleanup failure returns the committed result with `cleanupPending: true` and cannot roll the pointer back.

Retained-generation reactivation performs the same root, existing-pointer, atomic-replacement, temporary-pointer, rename, synchronization, and cleanup checks. Before writing its journal, it derives the exact validator-free candidate manifest in memory, requires byte equality with the retained canonical manifest, and verifies every retained file and directory. Its version-2 `reactivate` journal owns only the temporary pointer and journal, never the retained generation. Any failure before pointer replacement preserves the prior authority and the retained bytes.

Readers call `resolveActive()`. It reads the pointer exactly once, verifies the selected manifest, complete filesystem inventory, and all referenced bytes/provenance, then validates journal state without consulting the pointer again. It returns frozen `generationPath`, `manifestPath`, manifest, target ID/role plus `sourcePath`/`buildPath` values, and truthful `cleanupPending` state for a committed journal. Malformed or ambiguous journal state fails closed. A reader must retain that resolved result for its whole operation and must not re-read the active pointer between files. Old committed generations remain present because an existing reader may still hold their paths. Retention and garbage collection are deliberately outside Task 038.

## Recovery

The version-1 journal proves publisher ownership of a fresh candidate and its sibling temporary pointer; the version-2 `reactivate` journal proves ownership only of its sibling temporary pointer. Neither journal is the commit mechanism. Before a later valid publication starts, reconciliation first validates any active pointer and selected generation. It then:

- removes a journal-proven candidate and temporary pointer when another generation is active or no pointer exists;
- retains a journal-proven candidate when the active pointer selects it, removing only its stale temporary pointer and journal;
- removes version-2 reactivation temporary state without ever removing the retained generation; and
- leaves every unjournaled, committed, or otherwise ambiguous generation untouched.

Every candidate-directory deletion is followed by synchronization of `generations/`, and every temporary-pointer deletion is followed by synchronization of the publication directory, before the journal may be removed and its own directory synchronized. An interruption therefore cannot durably retain an orphan after durably losing its only ownership proof.

Malformed pointers, manifests, hashes, journals, symlinks, special nodes, project mismatches, and ambiguous reserved entries fail closed with `SemantifoldDiagnostic`. Filesystem failures are preserved as `cause`; stable diagnostic details avoid embedding unrelated ambient environment data.

The main diagnostic families are `INVALID_PUBLICATION_REQUEST`, `INVALID_PUBLICATION_ROOT`, `INVALID_PUBLICATION_PROJECTION`, `PUBLICATION_SOURCE_OVERLAP`, `PUBLICATION_PATH_COLLISION`, `PUBLICATION_PROJECTION_OVERLAP`, `PUBLICATION_PATH_ESCAPE`, `PUBLICATION_SYMLINK_TRAVERSAL`, `PUBLICATION_HARD_LINK`, `PUBLICATION_GENERATION_INVENTORY_MISMATCH`, `PUBLICATION_GENERATION_VERIFICATION_FAILED`, `PUBLICATION_UNOWNED_CONFLICT`, `PUBLICATION_ATOMIC_REPLACE_UNSUPPORTED`, `PUBLICATION_STAGE_WRITE_FAILED`, `PUBLICATION_STAGE_HASH_MISMATCH`, `PUBLICATION_VALIDATION_FAILED`, `PUBLICATION_CANCELLED`, `PUBLICATION_POINTER_FAILED`, `PUBLICATION_RECOVERY_FAILED`, `MALFORMED_ACTIVE_GENERATION`, `ACTIVE_GENERATION_MISSING`, and `MALFORMED_GENERATION_MANIFEST`.

Task 038 itself does not load a project manifest, discover sources, derive compiler arguments, start a CLI or watcher, invoke language-specific tools, delete committed generations, or implement retention. Task 039 composes its public publisher for a strict project manifest and one-shot generation CLI. Task 040 supplies registry-derived validators for checked Java candidates: `javac` writes only under the already-isolated build path, returned class metadata enters the same generation manifest, and the existing single pointer remains the sole publication boundary. Other target plans, watching, and retention remain later tasks.
