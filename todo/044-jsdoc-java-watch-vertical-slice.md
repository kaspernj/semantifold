# 044 — JavaScript/JSDoc-to-Java watch vertical slice

- Status: `roadmap`
- Phase/priority: Phase W / P0 product slice
- Dependencies: [043-deterministic-watch-coordinator.md](043-deterministic-watch-coordinator.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Prove the first user-visible TypeScript-like workflow: keep `semantifold watch --check` running, edit JSDoc-typed JavaScript, generate Java automatically, compile the staged Java with real `javac`, and recover from invalid edits without replacing the last successful Java/classes.

## Current evidence and gap

On `v0.7.0`, the component path already works one shot: the 2,648-byte JavaScript/JSDoc compatibility fixture parsed, generated `Main.java`, compiled with `javac 25.0.4`, ran with Java 25.0.4, and emitted the expected nine output lines. Tasks 038–043 add the missing persistent output, project, check-plan, and watch owners. This task integrates those contracts without adding a Java-specific watcher.

## Vertical-slice fixture

Check in a small public-consumer-style project containing:

- `semantifold.json` with explicit JavaScript source, one project publication root, and Java generated/build projection subpaths;
- JSDoc declarations covering representative portable scalar/function/control behavior already supported by both languages;
- expected generated-source/provenance ownership and runtime output;
- no repository-internal imports, generated fixture bytes, shell wrapper, Gradle/Maven project, or network dependency.

## End-to-end behavior

- Starting watch performs and reports cycle 1, stages generated Java and compiled classes inside one immutable project generation, switches the active pointer once, and leaves the watcher ready.
- A semantic source edit produces exactly one later successful generation after event coalescing. Committed Java/classes share the new cycle/source hash.
- A timestamp-only/no-content edit does not rebuild.
- An invalid JSDoc/type/syntax edit reports the located frontend diagnostic, does not invoke `javac`, does not alter the prior active pointer or its Java/classes, and leaves watch mode active.
- A controlled invalid staged-Java check fixture reports real `javac` diagnostics through the generic check boundary, retains the prior active generation, and leaves no compiler process. This does not introduce a production hook that mutates backend output.
- The next valid source edit recovers, reports a successful cycle, and replaces the generation coherently.
- A burst of edits during a controlled active check leads to one latest-state follow-up and no overlapping `javac` processes.
- SIGINT during idle and active-check states closes the watcher and child cleanly with one terminal watcher result.

## Acceptance

Use real filesystem changes and real canonical `javac`/`java`. After each successful check, resolve the active-generation pointer once and execute only that snapshot's committed classes in the acceptance harness to prove source/classes are coherent and produce the expected output. Assert pointer, bytes, hashes, generation manifest, and cycle identity rather than only checking that files exist.

Run the same scenario from a packed, credential-free consumer install so package bin/export boundaries are proven. Missing `javac` fails the declared check instead of silently switching to generation-only.

## Documentation

Add a copy-ready JavaScript/JSDoc-to-Java project example, expected CLI output, compiler requirements, error/recovery explanation, and explicit statement that Java generation/`javac` are implemented by target-neutral watch/check layers. Add a behavior changelog fragment when implemented.

## Non-goals

All-language matrix completion (Task 045), Java incremental compiler daemons, Java annotation processing/dependencies, Gradle/Maven, executing code on each edit, hot class reload, IDE integration, or new JavaScript/Java semantics.

## Completion criteria

- A packed consumer can run one long-lived watcher and observe valid edit → generated Java → real `javac` → coherent committed classes.
- Parse/check failures retain the last good generation and recover on a valid edit without process restart.
- The slice uses only generic project/publisher/check/watcher contracts and passes focused lifecycle, packaging, lint/typecheck, documentation, and changelog gates.
