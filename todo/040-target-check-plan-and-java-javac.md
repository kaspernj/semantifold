# 040 — Target check-plan contract and Java javac slice

- Status: `roadmap`
- Phase/priority: Phase W / P0 compiler foundation
- Dependencies: [039-project-manifest-and-build-cli.md](039-project-manifest-and-build-cli.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Define a registry-driven target check-plan contract and integrate the first concrete Java plan so `semantifold build --check` stages Java, compiles it with real `javac`, and publishes generated source plus compiler outputs only after the check succeeds.

## Current evidence and gap

The language registry declares Java acceptance stages `parse`, `generate`, `compile`, and `execute` with toolchains `javac` and `java`. `discoverCanonicalToolchain` and `runAcceptanceStages` are public and already prove caller-supplied `javac` argument arrays. Compiler argument construction is duplicated in specs, no registry capability creates a developer check plan, and the current runner's private temporary materialization cannot publish a checked generation.

A direct baseline proof on `v0.7.0` parsed the 2,648-byte JavaScript/JSDoc compatibility fixture, generated `Main.java`, compiled it with `javac 25.0.4`, executed it with Java 25.0.4, and produced `compat\nbranch-ok!\npresent\nabsent\n7\n2\n3\n5\n4\n`. This task productizes the compile boundary; it does not redesign Java generation.

## Planned check-plan contract

- Extend the authoritative target capability model with an explicit immutable check-plan factory/capability. Public descriptors must distinguish generation-only from check-capable targets without claiming execution.
- A plan receives only a validated staged artifact set, isolated owned build root, exact project/target identity, and discovered immutable tool records. It returns ordered stage requests with exact executable/argv/cwd/environment/output ownership and no shell strings.
- Validate that plan stages/toolchain IDs agree with the target's declared acceptance metadata and that every artifact argument resolves inside the staged/build roots.
- The generic runner owns spawn, stdout/stderr capture, locale/timezone, deadline/cancellation, first-failure preservation, signal forwarding, and settlement on child `close`. The Java plan owns Java filenames and `javac` arguments.
- A developer check does not execute generated code. Execution remains a separate acceptance-test concern.

## Java slice

- Add Java text-target check capability using the configured canonical `javac` identity and the repository's already qualified Java profile.
- Compile every staged `.java` artifact together into the isolated target build root; never emit `.class` files beside generated source.
- Match the existing accepted Java compiler profile and diagnostics. Do not silently add a different language release or warning policy.
- Add `build --check` and manifest check/build-root configuration. A successful cycle publishes one coherent source/class generation; missing/ambiguous `javac`, spawn failure, timeout, non-zero close, or publication failure leaves both prior roots unchanged.
- Report tool identity, exact stage, exit status/signal, bounded stdout/stderr, timing, and structured Semantifold context without flattening compiler diagnostics.

## Tests

- Check-plan schema/immutability and rejection of undeclared toolchains, invalid stage order, path escape, mutable argv/environment, and execution stages in developer-check mode.
- Real JavaScript/JSDoc-to-Java `build --check` with `javac`, followed by execution of committed classes only in acceptance code to prove the compiled output is usable.
- Deliberately invalid staged Java at the check boundary produces a compiler failure and leaves previous generated/class outputs byte-for-byte unchanged; a later valid candidate succeeds.
- Spawn failure, non-zero close, timeout/cancellation, late stdout/stderr, and signal handling settle only after the child closes and leak no process or staging root.
- JSON/human reporting and exit status remain truthful and deterministic.

## Documentation

Document target check capabilities, Java requirements, build-root ownership, diagnostics, `build --check`, and the difference between check and execute. Add a behavior changelog fragment when implemented.

## Non-goals

Filesystem watch mode, Java incremental compilation servers, Gradle/Maven, annotation-processor downloads, execution on build, non-Java check plans, application targets, or changes to Java semantic support.

## Completion criteria

- The Java compiler command comes from a target-owned plan rather than a Java branch in the CLI.
- `build --check` uses real `javac` and commits source/classes together only on success.
- Compiler failure/recovery, process lifecycle, diagnostics, focused tests, lint/typecheck, docs, changelog, and packed-consumer behavior satisfy repository gates.
