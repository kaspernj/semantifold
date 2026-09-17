# 043 — Deterministic watch coordinator

- Status: `roadmap`
- Phase/priority: Phase W / P0 lifecycle foundation
- Dependencies: [039-project-manifest-and-build-cli.md](039-project-manifest-and-build-cli.md), [040-target-check-plan-and-java-javac.md](040-target-check-plan-and-java-javac.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Add a long-lived `semantifold watch` command whose language-neutral coordinator turns filesystem hints into serialized complete build/check cycles, keeps the last successful generation usable after failures, and shuts down without overlapping or leaking compiler work.

## Current evidence and gap

The product has no watcher. One test helper waits for a file change, but it is not a project snapshot, build scheduler, process owner, or public CLI. TypeScript and Node document that filesystem events differ by platform and can be incomplete; directly rebuilding from event filenames would be incorrect.

## Watch contract

- Add one lifecycle-aware class owning subscriptions, immutable source snapshots, cycle numbers, dirty state, the active build/check operation, reporting, and shutdown.
- Perform a real initial build on startup. Startup/configuration failure exits; an ordinary later parse/generation/check failure records a failed cycle and keeps watching.
- Treat events as hints. After a bounded quiet period, re-read the full explicit manifest/source graph in stable order and hash content. Skip a cycle when the complete content/config hash is unchanged.
- Watch declared files plus required parent directories so deletion/atomic-save/recreation can be observed. Provide a documented polling fallback/reconciliation path. Do not depend on recursive `fs.watch` being reliable on Linux.
- Reject a publication root or generated/build projection that overlaps watched sources and never subscribe to owned publication state, preventing feedback loops.
- Permit only one cycle at a time. Events during an active cycle set one dirty marker; after the owned checker child closes, immediately snapshot once more and run at most one follow-up for the latest state.
- Do not terminate a healthy in-flight compiler merely because a new edit arrived in version 1. Superseded work may finish but cannot replace the active-generation pointer if its source snapshot is no longer current; the follow-up owns the latest candidate.
- Reuse Tasks 038–040 unchanged: the watcher asks the project builder for a staged cycle and never parses syntax, selects a compiler, or writes artifacts itself.

## Process and shutdown lifecycle

- Install SIGINT/SIGTERM handlers before beginning the initial cycle.
- On shutdown, stop admitting cycles, close subscriptions/timers, request cancellation of the exact active child when present, await child `close`, remove task-owned staging state, emit one terminal watcher record, and then exit.
- Distinguish spawn failure from post-spawn failure. Preserve the first error, capture late output through `close`, and never start another check while a prior child or descendant remains owned.
- Human output identifies successful/failed/recovered cycles. JSON mode emits deterministic state records with project/target/cycle/source hash, changed paths, tool/stage, duration, and one terminal result per cycle.

## Tests

- Real temporary-directory create/change/delete/rename and editor-style atomic replacement; every event causes a full snapshot rather than partial event-driven compilation.
- Burst coalescing, no-op touch suppression, dirty-during-build single follow-up, and stale completed candidate refusal.
- Failed parse/generation/check leaves the last-good generation pointer and immutable outputs unchanged, the process stays alive, and a later valid edit recovers.
- Publication writes do not self-trigger. Source/publication overlap and unsupported watch topology fail at startup.
- Event-backend failure exercises fallback/reconciliation without busy looping.
- Real child fixtures prove spawn failure, non-zero close, late output, ignored TERM/forced bounded cleanup where required, Ctrl-C during compile, exactly-once terminal reporting, and no leaked child/watcher/timer/staging root.
- Tests synchronize on events/markers rather than production sleeps; every fixture has unconditional cleanup.

## Documentation

Document `watch`, initial-build behavior, event/hash/coalescing semantics, fallback mode, failure/recovery states, signals, human/JSON output, and tuning boundaries. Add a behavior changelog fragment when implemented.

## Non-goals

Language-aware incremental parsing, dependency-subgraph recompilation, daemon/background service mode, editor/LSP integration, remote watching, runtime execution/hot reload, arbitrary ignore/glob syntax, or platform application rebuild policy.

## Completion criteria

- One watcher implementation safely drives every configured source/target through existing build/check contracts.
- Event loss/bursts, failure/recovery, stale cycles, and signals cannot publish mixed state or overlap compiler children.
- Focused real-filesystem/real-child tests, lint/typecheck, docs, changelog, and packed CLI behavior satisfy repository gates.
