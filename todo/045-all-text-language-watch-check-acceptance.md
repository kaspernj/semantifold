# 045 — All-text-language watch/check terminal acceptance

- Status: `roadmap`
- Phase/priority: Phase W / P1 terminal acceptance
- Dependencies: [041-interpreted-managed-target-check-plans.md](041-interpreted-managed-target-check-plans.md), [042-native-project-target-check-plans.md](042-native-project-target-check-plans.md), [044-jsdoc-java-watch-vertical-slice.md](044-jsdoc-java-watch-vertical-slice.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Close the selected text-language delivery chain by proving that the same manifest, publisher, check runner, and watcher support every current source frontend and every current text backend without language branches in the coordinator or a quadratic all-pairs promise.

This is the single terminal acceptance task for Tasks 038–045.

## Current cohort

At the `v0.7.0` baseline, the current source+text IDs are PHP, Ruby, JavaScript/JSDoc, TypeScript, Java, Kotlin/JVM, Python, C#, Go, C, C++, Rust, Swift, Dart, and Zig. Java is proved first by Task 044; Tasks 041 and 042 provide the remaining target check plans.

## Registry contract

- Every current text backend explicitly reports check capability and produces an immutable target-owned plan. Registration/public discovery may distinguish check-capable and generation-only targets, but none of the current fifteen text backends may remain implicitly unchecked at completion.
- Every current frontend can participate in a watched explicit source snapshot when the selected fixture uses semantic features that frontend/target both support.
- Future language registration must declare its watch/check disposition explicitly; it cannot inherit capability from a filename extension or the presence of an execute-stage acceptance test.

## Bounded matrix

Avoid 225 source/target pairs. The terminal CI matrix proves:

1. every current frontend through one watched source change into a compatible checked text target (diagonal where practical);
2. every current text target through one real check-plan invocation from a common Tasks 001–004-compatible semantic fixture;
3. JavaScript/JSDoc-to-Java as the required cross-family product journey;
4. representative additional dynamic-to-native, managed-to-dynamic, and project-to-project paths to catch registry composition mistakes;
5. multi-file Task 010 source snapshots and multi-artifact target publication in representative lanes.

The matrix records exact target/tool identity and fails rather than skips when a configured tool is unavailable. Full matrix execution belongs to TensorBuzz CI, not routine local validation.

## Failure/recovery acceptance

- For every target family, a failed real check leaves the prior active generation's source/build outputs unchanged and a later valid change recovers in the same watcher process.
- Representative frontend parse/semantic failures prove the checker is not started.
- Multi-target projects stage from one source snapshot under one immutable project generation and become visible all-or-nothing through one active-pointer replacement.
- Deleted/recreated source, no-op touch, edit burst during a check, and signal shutdown preserve the generic cycle/lifecycle contract.
- Toolchain restore/cache policies stay offline and isolated; no lane discovers user-global packages or writes outside owned roots.
- Machine-readable cycle records are schema-validated and contain one terminal record per cycle across every lane.

## Documentation and compatibility

Update README, architecture, language-support/testing docs, package CLI help, manifest schema, and examples to distinguish source-watch support, generation roles, check capability, runtime execution, and platform-specific exclusions. Add one behavior changelog fragment when implemented.

Preserve all existing public parse/generate/toolchain/acceptance APIs unless a separately documented additive evolution is required. The CLI/watch layer must not become the only way to use Semantifold.

## Non-goals

Every source/target feature combination, all-pairs testing, application/binary target policy (Task 046), incremental semantic dependency invalidation, runtime equivalence on every edit, editor/LSP integration, package downloads, arbitrary user build hooks, or Apple/Xcode work.

## Completion criteria

- All fifteen current source frontends and all fifteen current text backends are covered by the bounded real-tool watch/check matrix.
- JavaScript/JSDoc-to-Java remains the explicit product journey, while the implementation is demonstrably registry-driven and target-neutral.
- Failure/recovery, transactional publication, process cleanup, packed-consumer behavior, docs/changelog, lint/typecheck, package gates, and exact-head TensorBuzz matrix are green.
- No current text backend is silently generation-only and no claim exceeds the tested semantic feature intersection.
