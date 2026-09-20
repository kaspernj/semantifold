# 040 — Target check-plan contract and Java javac slice

- Status: `delivered through PR #57 at merge commit 6af0c371a2d904ba502df915cbd42e9aacd82904`
- Phase/priority: Phase W / P0 compiler foundation
- Dependencies: [039-project-manifest-and-build-cli.md](039-project-manifest-and-build-cli.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Define a registry-driven target check-plan contract and integrate the first concrete Java plan so `semantifold build --check` stages Java, compiles it with real `javac`, and publishes generated source plus compiler outputs only after the check succeeds.

## Starting evidence and implemented result

The starting language registry declared Java acceptance stages `parse`, `generate`, `compile`, and `execute` with toolchains `javac` and `java`, while compiler argument construction remained duplicated in specs. Task 040 now adds the immutable public `check` capability, `createTargetCheckPlan`, lifecycle-owning `TargetCheckRunner`, Java's target-owned compiler plan, transactional `ProjectBuilder` composition, strict CLI `--check`, and structured human/NDJSON evidence. Generation-only targets advertise unsupported checks rather than execution.

A direct baseline proof on `v0.7.0` parsed the 2,648-byte JavaScript/JSDoc compatibility fixture, generated `Main.java`, compiled it with `javac 25.0.4`, executed it with Java 25.0.4, and produced `compat\nbranch-ok!\npresent\nabsent\n7\n2\n3\n5\n4\n`. This task productizes the compile boundary; it does not redesign Java generation.

## Implemented check-plan contract

- Extend the authoritative target capability model with an explicit immutable check-plan factory/capability. Public descriptors must distinguish generation-only from check-capable targets without claiming execution.
- A plan receives only a validated staged artifact set, its isolated generation-scoped target build subtree, exact project/target identity, and discovered immutable tool records. It returns ordered stage requests with exact executable/argv/cwd/environment/output ownership and no shell strings.
- Validate that plan stages/toolchain IDs agree with the target's declared acceptance metadata and that every artifact argument resolves inside the candidate generation's staged source/build subtrees.
- The generic runner owns spawn, stdout/stderr capture, locale/timezone, deadline/cancellation, first-failure preservation, signal forwarding, and settlement on child `close`. The Java plan owns Java filenames and `javac` arguments.
- A developer check does not execute generated code. Execution remains a separate acceptance-test concern.

## Java slice

- Add Java text-target check capability using the configured canonical `javac` identity and the repository's already qualified Java profile.
- Compile every staged `.java` artifact together into the candidate generation's isolated Java build subtree; never emit `.class` files beside generated source.
- Match the existing accepted Java compiler profile and diagnostics. Do not silently add a different language release or warning policy.
- Add `build --check` and manifest generated/build projection configuration. A successful cycle publishes one coherent source/class project generation through one active-pointer replacement; missing/ambiguous `javac`, spawn failure, timeout, cancellation through the pointer-commit boundary, non-zero close, or pre-pointer publication failure leaves the prior generation active.
- Give every checked invocation a fresh immutable candidate identity so unchanged and reverted snapshots rerun their declared checks; retain deterministic same-ID verification/reactivation for generation-only builds.
- Report tool identity, exact stage, exit status/signal, bounded stdout/stderr, timing, and structured Semantifold context without flattening compiler diagnostics.

## Tests

- Check-plan schema/immutability and rejection of undeclared toolchains, invalid stage order, path escape, mutable argv/environment, and execution stages in developer-check mode.
- Real JavaScript/JSDoc-to-Java `build --check` with `javac`, followed by execution of committed classes only in acceptance code to prove the compiled output is usable.
- Deliberately invalid staged Java at the check boundary produces a compiler failure and leaves the previous active generation's Java/class outputs byte-for-byte unchanged; a later valid candidate succeeds.
- Repeated unchanged and A→B→A checked builds each run real `javac`; the reverted committed source/class bytes exactly match A without mutating or trusting its retained generation.
- Spawn failure, non-zero close, timeout/cancellation, late stdout/stderr, and signal handling settle only after the child closes and leak no process or staging root. Deterministic CLI coverage cancels after checker close but before pointer replacement and proves the prior exact source/class bytes remain authoritative.
- JSON/human reporting and exit status remain truthful and deterministic; human failures retain outer publication context plus actionable nested tool-discovery diagnostics without duplicating compiler-process evidence.

## Documentation

Document target check capabilities, Java requirements, generation-scoped build ownership, diagnostics, `build --check`, and the difference between check and execute. Add a behavior changelog fragment when implemented.

## Non-goals

Filesystem watch mode, Java incremental compilation servers, Gradle/Maven, annotation-processor downloads, execution on build, non-Java check plans, application targets, or changes to Java semantic support.

## Completion criteria

- The Java compiler command comes from a target-owned plan rather than a Java branch in the CLI.
- `build --check` uses real `javac` and makes source/classes visible together only through the successful project-generation pointer switch.
- Compiler failure/recovery, process lifecycle, diagnostics, focused tests, lint/typecheck, docs, changelog, and packed-consumer behavior satisfy repository gates.

The implementation satisfied these criteria and was delivered through PR #57 at merge commit `6af0c371a2d904ba502df915cbd42e9aacd82904`. Focused coverage proves plan validation, owned process lifecycle, real multi-unit `javac`, repeated/reverted checked transactions, explicit post-publication `java` execution, last-good preservation/recovery, nested human/NDJSON diagnostics, CLI reporting, and the credential-free packed consumer.
