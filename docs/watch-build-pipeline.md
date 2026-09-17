# Watch, build, and target-check pipeline

## Status and verified baseline

This document is a roadmap contract, not an implemented CLI contract.

The inspected baseline is `semantifold@0.7.0`, annotated tag `v0.7.0`, commit `8cd70c5a6c7de98df2d4a183d6555ad4f3d5ba5a`. At that revision:

- JavaScript/JSDoc is a registered source frontend and Java is a registered text backend.
- `parse`, `parseProgram`, `generateArtifactSet`, and `generateProgramArtifactSet` are public, deterministic, in-memory APIs.
- `discoverCanonicalToolchain` finds the configured `javac` and `java` executables.
- `runAcceptanceStages` materializes an artifact set in a temporary directory and runs caller-supplied exact argument arrays with bounded process execution.
- A bounded direct proof parsed the 2,648-byte JSDoc fixture `spec/fixtures/compatibility/program.js`, generated `Main.java`, compiled it with `javac 25.0.4`, executed it with Java 25.0.4, and observed the canonical output `compat\nbranch-ok!\npresent\nabsent\n7\n2\n3\n5\n4\n`.
- `package.json` has no `bin` entry. The public API does not persist generated artifacts, load a project manifest, derive compiler arguments from a target, or watch source files.
- The only repository file-change watcher is a test helper; there is no product watch coordinator, incremental dependency graph, event coalescing policy, or long-lived compiler owner.

The current system therefore already proves **JavaScript/JSDoc → semantic IR → Java → `javac`** as a one-shot composition. The roadmap below turns that composition into a safe project workflow without moving filesystem or process lifecycle concerns into parsers or backends.

## Product outcome

A project can declare explicit source modules, one or more generated targets, owned output directories, and whether each target is checked with its real toolchain. It can then run:

- a planned one-shot `semantifold build`; or
- a planned long-lived `semantifold watch`.

For the first end-to-end slice, changing a JSDoc-typed JavaScript source regenerates Java and compiles the staged candidate with `javac`. A successful cycle publishes one coherent generated-source/compiler-output generation. A parse, semantic, generation, tool-discovery, compiler, or publication failure reports a located diagnostic, keeps the process alive in watch mode, and leaves the previous successful generation usable. A later valid edit recovers without restarting the watcher.

The architecture is target-neutral. Every current text backend eventually supplies one target-owned check plan. Every current source frontend participates through the existing parser/project APIs; the watcher never contains language syntax logic.

## Architecture boundaries

### Project manifest and loader

A versioned, strict manifest declares ordered source modules and target entries. Source language, module identity, entry identity, target language/role, output root, and optional check/build root are explicit. Version 1 uses explicit file paths rather than introducing a glob language or package-manager resolution.

The loader owns path normalization and rejects unknown fields, duplicate module/target identities, ambiguous target roles, source/output overlap, output paths outside the project root, and symlink/path traversal across an owned root. It returns an immutable project request and never parses language syntax.

### Snapshot builder

Each cycle reads a complete content snapshot of every declared source and the project manifest. File events are hints only. Before parsing, the coordinator re-reads and hashes the declared graph in stable order; it never assumes an event filename is complete or authoritative.

A snapshot is immutable for the cycle. Edits arriving during parse/generation/check mark the watcher dirty and cause one immediate follow-up cycle after the current owned work closes. Cycles never overlap.

### Existing semantic compiler core

Frontends, semantic validation, linking, and backends remain pure with respect to the project filesystem. They consume the immutable snapshot and return complete `GeneratedArtifactSet` values. No frontend or backend starts watchers, writes files, spawns a compiler, or reads undeclared project files.

### Transactional artifact publication

A publisher stages complete candidate artifact sets outside their final owned directories. It validates paths, mappings, hashes, collisions, ownership, and manifests before touching the last successful generation.

When checking is enabled, target checks run against the staged candidate. Only a fully generated and successfully checked candidate may be promoted. The publisher owns an explicit versioned manifest of files it created; it never removes an unowned file. Interrupted publication is recoverable deterministically from the journal and last committed manifest. A failed candidate is removed without changing the committed generation.

Compiler by-products use a separate owned build root. The generated-source output and compiler-output generation share one cycle identity so clients never mistake new source plus old classes for one successful cycle.

### Target check-plan registry

The existing language registry remains authoritative for target identity, roles, declared acceptance stages, and required toolchain IDs. A planned target-check capability derives exact stage requests from a validated staged artifact set and isolated build root.

The generic runner owns process lifecycle, locale/timezone normalization, output capture, timeout/cancellation, and close observation. A target check plan owns filenames, exact argv, toolchain IDs, offline/cache policy, and which stages constitute a non-executing developer check. The watcher does not switch on language IDs.

The initial check plan is Java/`javac`. Later tasks add current text targets in two cohorts:

- interpreted/managed: PHP, Ruby, JavaScript, TypeScript, Kotlin/JVM, Python, and C# (Java is supplied by the initial slice);
- native/project: Go, C, C++, Rust, Swift, Dart, and Zig.

A watch check validates or compiles but does not execute generated application code by default. Restore/download behavior is never an implicit per-edit action; targets with project metadata use pinned, offline, isolated state and rerun prerequisite stages only when their declared inputs change.

### Watch coordinator

One lifecycle-aware class owns filesystem subscriptions, content snapshots, cycle state, the active checker child, reporting, and shutdown. Its state machine is:

```text
starting -> building -> ready
                 |       |
                 v       v
               failed <- rebuilding
                 |       |
                 +-- valid edit --+

any live state -- SIGINT/SIGTERM --> stopping --> stopped
```

`failed` means the last candidate failed; it does not discard the last successful output or terminate watch mode. A watcher event during `building`/`rebuilding` sets one dirty generation marker. The coordinator starts exactly one follow-up after the owned child closes. It never starts a retry while prior compiler work is still live.

Native filesystem events require a bounded reconciliation strategy because Node and TypeScript both document platform-dependent watcher behavior. Version 1 watches the explicit manifest/source files and relevant parent directories, re-scans the declared graph after each hint, supports a documented polling fallback, and suppresses no-op cycles by content hash. Generated and build roots are rejected as source roots and are never watched.

### Reporting contract

Human output is concise and stable. A machine-readable mode emits one JSON record per state transition with at least project identity, monotonically increasing cycle number, source snapshot hash, target ID/role, state, timing, changed paths, tool identity, exit status, and a structured diagnostic when present.

Exactly one terminal cycle record is emitted per cycle. Process exit is non-zero for failed one-shot builds, but ordinary watch-cycle failures keep the watcher process alive. Startup/configuration failure exits. Signal-driven shutdown forwards cancellation to an active owned child, waits for `close`, removes subscriptions and staging state, and exits once.

## Generation and failure semantics

1. Initial watch startup performs a real build; it does not wait for the first edit.
2. Event bursts coalesce into one snapshot rebuild after a bounded quiet period.
3. Content hashes, not timestamps alone, decide whether a cycle is a no-op.
4. Parse/generation failure never starts a target checker and never publishes.
5. Tool discovery/check failure never publishes the staged generated source or build products.
6. Publication failure restores or retains the previous committed manifest and reports recovery state.
7. A valid edit after failure performs a fresh complete cycle and may publish normally.
8. Deleted or renamed declared sources are ordinary invalid snapshots until the manifest is updated; stale owned outputs are not silently treated as current.
9. Multiple target entries are staged from one source snapshot. The manifest defines whether the project requires all targets to pass before the cycle is committed; version 1 defaults to one all-or-nothing project generation.
10. No shell command strings, compiler-specific branches in the watcher, implicit network access, or arbitrary user hooks are introduced.

## Cross-language scope

“Works for all languages” means:

- every registered frontend can be an explicitly declared watched source when the selected semantic features are supported;
- every current text backend has an explicit real-toolchain check plan or a fail-loud reason it cannot be checked;
- the same watcher/materializer/runner code handles every source/target pairing;
- acceptance uses a bounded matrix: all frontends and all text targets are covered, with the JavaScript/JSDoc-to-Java path plus representative cross-family paths, not a quadratic promise that every semantic feature works for every pair.

Binary and application targets use the same generation watcher only after explicit target policy is defined. Browser Wasm can validate/instantiate in its own lane. Android and Flutter checks are heavier platform builds and must be opt-in rather than an automatic keystroke default. iOS remains generation-only until the separately deferred Apple/Xcode acceptance work is authorized; this roadmap does not reopen Tasks 026 or 027.

## Test strategy

- Unit contracts cover strict manifest validation, snapshot hashing, event coalescing, dirty-during-build behavior, no-op suppression, ownership manifests, staged publication, recovery journals, and exact check-plan construction.
- Real temporary-directory tests cover create/change/delete/rename behavior and ensure generated roots do not self-trigger.
- Real-child lifecycle tests cover spawn failure, non-zero compiler close, late output, signal forwarding, shutdown during an active check, and no leaked child/staging directory.
- Real `javac` acceptance proves the initial JavaScript/JSDoc-to-Java cycle, compiler failure reporting at the check boundary, unchanged last-good outputs, recovery after a valid edit, and class execution from the committed generation.
- The terminal text-target matrix invokes every declared real checker/compiler in CI and fails rather than skips when a configured tool is unavailable.
- Focused local tests remain small; full language/toolchain matrices run only in the existing CI lanes.

## Dependency order

```text
015 artifact/toolchain foundation
        |
        038 transactional publication
        |
010 ----+---- 039 project manifest + one-shot build CLI
                   |
                   040 generic check plans + Java/javac
                   |                    |
             041 managed cohort    043 watcher coordinator
             042 native cohort          |
                   |                    044 JS/JSDoc -> Java watch slice
                   +--------------------+
                              |
                  045 terminal all-text-language matrix
                              |
                  046 later binary/application policies
```

Tasks 038–045 are the selected text-language delivery chain. Task 045 is the single terminal acceptance task for that chain. Task 046 is a non-blocking later extension.

## Non-goals

This roadmap does not implement language-server/editor protocols, incremental semantic-IR invalidation, daemon IPC, remote/distributed builds, arbitrary compiler flags, shell hooks, package installation, source discovery by glob, runtime execution on every edit, hot reload into a running application, production deployment, signing, store submission, or Apple/Xcode acceptance. It does not change semantic language support or claim all-pairs feature compatibility.
