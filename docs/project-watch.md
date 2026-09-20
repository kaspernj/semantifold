# Deterministic project watch

Task 043 adds one language-neutral, long-lived coordinator above the existing project snapshot, build/check, and transactional publication contracts. Task 044 proves its first packed checked vertical slice from JavaScript/JSDoc through generated Java and real `javac`. The coordinator accepts filesystem events only as hints, re-reads the complete explicit manifest/source graph, serializes complete cycles, and never executes generated programs.

## Commands

```sh
semantifold watch
semantifold watch --project config/semantifold.json
semantifold watch --check
semantifold watch --check --ndjson
```

`watch` accepts the same single `--project`, `--check`, and `--ndjson` options as `build`. Generation-only watch works for every target accepted by the version-1 project manifest. `--check` additionally requires every configured target to advertise a target-owned non-executing developer-check plan. PHP, Ruby, JavaScript, TypeScript, and Java are check-capable among the manifest's existing complete-program text targets; the registry also exposes Kotlin/JVM, Python, and C# plans for their existing generated single-module artifact sets. Neither command runs generated application code.

The coordinator installs `SIGINT` and `SIGTERM` handlers before loading the initial graph and immediately performs cycle 1. Invalid startup configuration or a failed initial build terminates watch with status 1. Once the initial cycle succeeds, an ordinary source, semantic, generation, discovery, check, or pre-commit publication failure emits a failed cycle and keeps watch alive. The next successful candidate is reported as recovered. Clean signal shutdown returns status 0.

## Events, reconciliation, and cycle ownership

The native backend subscribes to every declared source file, the manifest, and their distinct parent directories. Exact parent-event filenames are mapped to declared graph paths, unknown non-publication events conservatively request a complete reconciliation, and writes identified beneath the publisher-owned root are ignored. Parent subscriptions make deletion, recreation, rename, and editor-style atomic replacement observable without relying on recursive Linux watching.

If initial subscription, live watching, or topology resubscription fails, the coordinator closes the complete native subscription set, reports the transition, and switches once to bounded polling. A 1,000 ms reconciliation interval also backs native subscriptions so event loss can be detected. It compares mutation-sensitive state only to decide when to re-read the complete graph and never treats timestamps as build identity; after an invalid graph, the first successful recovery probe preserves one existing quiet timer instead of postponing it on every shorter polling interval. A changed hint starts a 50 ms quiet window. The public `ProjectWatchCoordinator` constructor permits bounded `quietPeriodMs` values from 1 through 10,000 and `pollIntervalMs` values from 1 through 60,000 for embedding and focused tests. The CLI uses the defaults.

After the quiet window, `ProjectManifestLoader` and `ProjectSnapshotBuilder` re-read the complete graph in stable manifest order. The versioned complete content/configuration hash is authoritative. A touch or event burst whose final hash is unchanged does not admit a cycle. Create, change, delete, rename, and replacement hints never select a partial event filename as the compilation input.

Only one cycle and one checker child can be owned at a time. A hint during a cycle sets one dirty marker; it does not terminate a healthy compiler. After every target checker has closed, the builder invokes a complete-snapshot currentness guard at the publisher's pre-pointer boundary. Changed content supersedes and cleans the staged candidate without replacing `active-generation.json`; one immediate follow-up then owns the latest complete state. A hint in the narrow interval after that guard cancels publication before pointer replacement. After a pointer commit, mutation-sensitive state is compared with the pre-cycle polling baseline: a newer state marks the active cycle dirty and is never absorbed as a clean baseline merely because its native event was lost. A committed pointer still selects exactly one immutable generation, and readers continue to resolve it once.

In NDJSON mode, the first hint admitted while a cycle remains active emits nonterminal `state: "cycle-dirty"`. This acknowledges that the coordinator owns one latest-state follow-up; it does not claim that an event filename is a complete input or that its bytes have already been snapshotted. Further hints in the same active cycle collapse into that one dirty generation.

## Failure, reporting, and shutdown

Human output identifies succeeded, failed, recovered, superseded, and cancelled cycles. NDJSON uses `SemantifoldWatchEvent` version 1. State records carry the project, cycle, complete snapshot hash when available, stable changed paths, ordered target/check evidence, and durations. Every admitted cycle emits exactly one record with `terminal: true` and `terminalScope: "cycle"`; shutdown emits exactly one separate watcher terminal with `terminalScope: "watch"`.

Parse or generation failure never starts a checker. Tool/check failure and stale-candidate refusal never switch the active pointer. Failed candidates are removed through the existing publication ownership journal, while all committed generations remain immutable and retention remains an external policy.

On `SIGINT`, `SIGTERM`, or `ProjectWatchCoordinator.stop(reason)`, the coordinator stops admitting cycles, closes every subscription and timer, awaits any in-progress startup read before terminal settlement, aborts the exact active build/check authority, waits for the owned child process group to reach `close`, waits for publisher staging cleanup, emits the watcher terminal once, and resolves. Startup rechecks stop ownership after each asynchronous boundary, so it cannot subscribe, schedule, or report after terminal shutdown. Generated programs are not started, hot-reloaded, or stopped because watch never executes them.

## Importable API and boundaries

`ProjectWatchCoordinator` and `ProjectWatchReporter` are public ESM exports. The coordinator composes `ProjectManifestLoader`, `ProjectSnapshotBuilder`, `ProjectBuilder`, target-owned check plans, and `GeneratedArtifactPublisher`; it contains no language IDs, parser logic, compiler argument construction, or artifact writes.

The coordinator and generic check runner contain no target-language switch. Target-owned modules construct exact PHP, Ruby, Node, TypeScript, Java, Kotlin/JVM, Python, and C# requests; the runner owns their processes and transient candidate state. Native/project text-target plans remain Task 042, their terminal matrix remains Task 045, and binary/application watch policy remains Task 046. Watch adds no globs, ignore language, daemon mode, editor protocol, runtime execution, hot reload, arbitrary hooks, network access, or package installation.

## Copy-ready JavaScript/JSDoc-to-Java watch

The npm package includes [`examples/jsdoc-java-watch`](../examples/jsdoc-java-watch/). Copy that directory outside `node_modules`, enter it, and run:

```sh
npx semantifold watch --check
```

The example manifest explicitly selects `src/main.js`, JavaScript, one Java text target, `targets/java/source`, and `targets/java/classes`. Its JSDoc-typed functions cover numeric and Boolean/string control behavior, and `expected-output.txt` records the output used by acceptance. Cycle 1 prints a line of this form only after real `javac` has closed successfully and the pointer has switched:

```text
Watch cycle 1 succeeded: project 'jsdoc-java-watch' published generation 'g-<snapshot-sha256>-checked-<uuid>'.
```

An unambiguous supported `javac` must be available on `PATH`, or `SEMANTIFOLD_JAVAC` must name its absolute configured executable. Missing `javac` fails the declared check; watch never silently changes to generation-only operation. Real `java` is not required by watch because watch does not execute generated code. The Task 044 acceptance harness separately discovers real `java`, resolves `active-generation.json` once, verifies the selected manifest/source/class hashes, and executes only that committed class snapshot.

Saving a valid edit produces a later successful generation. Touching the source without changing content reports no cycle. A located JavaScript/JSDoc parse or semantic error never invokes `javac`; a real compiler error at the generic staged check boundary never switches the pointer. Both failures keep a previously successful watcher alive, and the next valid edit reports recovery. Edits admitted during an active check emit `cycle-dirty` in NDJSON, allow the owned child to close, refuse its stale candidate, and run one latest-state follow-up without overlapping compiler processes. `SIGINT` or `SIGTERM` during idle or checking closes subscriptions and the exact checker process before the sole watcher terminal.
