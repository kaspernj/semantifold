# 023 — Kotlin/JVM source and target support

- Status: `todo`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Kotlin/JVM as a first-class frontend and JVM textual backend for exactly Tasks 001–004. Keep Android packaging/lifecycle concerns in Task 028 and make no claim about Kotlin/Native, Kotlin/JS, or multiplatform projects.

## Semantic and source profile

- Map semantic scalars to explicitly declared `Long`, `Boolean`, and `String`. Use `val` for immutable bindings and `var` only for assignable semantic bindings.
- Accept canonical top-level functions in the current exact two-parameter shape, initialized typed locals, assignment, current operators, strict-Boolean conditionals, explicit returns, and a generated `main`/printing shell.
- Reject type inference, nullable/platform types, smart casts, numeric widening/coercion, unsigned or arbitrary-width numbers, string templates, locale-dependent formatting, referential equality, user overloads, extensions, classes/interfaces/data/value classes, objects/companions, generics, lambdas, local functions, exceptions, reflection, annotations, delegation, and coroutines/`suspend`.
- Preserve safe integer and evaluation-order semantics independently of JVM overflow. Do not map semantic absence to Kotlin `null` before Task 007 is adopted deliberately.

## Frontend strategy

- Qualify a pinned community `tree-sitter-kotlin` npm release under Task 015 for provenance/license, Node 24/grammar ABI, packaged parser, typed access, recovery nodes, UTF-16 spans, profile coverage, and differential agreement with the supported `kotlinc` parser.
- If that candidate cannot pass, block and amend the parser decision. Compiler output or source scanning is not a fallback AST.
- Exhaustively consume file, declaration, modifier, type, statement, expression, operator, annotation, and trivia children. Reject parser error/missing/recovery nodes, implicit constructs, imports/packages outside the canonical artifact shell, and every unmodeled child.

## Backend and artifact strategy

- Emit deterministic `Program.kt` plus a declared runnable-JAR build artifact recipe. The public source artifact contains no Gradle project and uses only the Kotlin/JVM standard runtime supplied with the configured compiler.
- Pin explicit language/API versions and JVM target in the artifact metadata/tool invocation; never silently inherit user configuration. Validate names, types, returns, mutability, literal ranges, and target capability transactionally.
- Reparse generated Kotlin and compare semantic meaning. Preserve rich provenance and the Task 015 Source Map v3 form for source text; record synthetic `main`, printing, and file-level scaffolding separately.

## Diagnostics and rejections

- Use located `PARSE_ERROR`, `MISSING_TYPE`, and `UNSUPPORTED_SYNTAX` for parse recovery, omitted types, and excluded Kotlin features. Distinguish `null`/platform-type and coroutine/overload boundaries in stable reasons.
- Use `UNSUPPORTED_CAPABILITY` before emission for backend limits or malformed caller IR. Never approximate nullability, thrown failures, concurrency, or overload dispatch.

## Deterministic real-toolchain tests

- Record exact `kotlinc -version` and `java -version`; a missing or unsupported command fails the Kotlin/JVM lane.
- Compile with explicit language/API/JVM target settings to a runnable JAR, execute with the configured Java runtime, and assert exact output/status without Gradle, network, or downloaded dependencies.
- Cover all Tasks 001–004 behavior and boundaries, parser recovery, annotations, overflow-sensitive fixtures in debug-equivalent and optimized JVM runs where available, generated reparse, every Kotlin direction, and representative original-five crossings.
- Generate twice and compare source, tool metadata, and maps byte-for-byte.

## Documentation

Document Kotlin/JVM-only scope, compiler/JDK discovery and version pins, artifact/run commands, semantic exclusions, mappings, and the separation from Android. Add a behavior changelog fragment when implemented.

## Completion criteria

- Kotlin/JVM is registered accurately as frontend and textual/JVM backend for Tasks 001–004.
- The grammar passes qualification and differential fixtures; generated code reparses, compiles, and runs deterministically on real `kotlinc` and Java.
- Rejection, location, provenance, cross-language, documentation, changelog, and repository gates pass.

## Non-goals

Android, Gradle projects, Kotlin/Native/JS/Wasm/multiplatform, nullability, classes, extensions, generics, reflection, exceptions, coroutines, compiler plugins, package resolution, or Java interoperability beyond running generated JVM bytecode.
