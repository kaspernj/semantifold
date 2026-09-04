# 029 — Dart source and target support

- Status: `todo`
- Phase/priority: Phase P / P1
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Dart as a first-class frontend and Dart VM/native textual package backend for Tasks 001–005. This supplies the typed language basis for Task 030 without making Flutter widgets, browsers, or mobile lifecycle part of Dart language semantics.

## Semantic and source profile

- Map semantic scalars to explicitly annotated `int`, `bool`, and `String`; use `final` for immutable locals and typed mutable declarations otherwise. Every parameter, result, and local has an explicit type.
- Accept synchronous top-level functions with Task 005 required arity/void, initialized locals, assignment, current operators, strict-Boolean conditionals, explicit returns, direct calls, and a canonical `main`/print shell.
- Target the installed Dart VM/native executable profile only. Define and enforce the portable safe-integer range before execution; browser JavaScript numeric behavior is not part of this task.
- Reject `dynamic`, `Object`/`Object?`, nullable types, `late`, inference, `num`/`double`/`BigInt`, casts/type tests, named/optional parameters, tear-offs/closures, classes/mixins/extensions/enums/records, collections, generics, operator overloading, exceptions, `async`/futures/streams/isolates, mirrors, FFI, imports other than the generated SDK-only shell, and interpolation.

## Frontend strategy and parser qualification

- Treat the pinned `tree-sitter-dart` registry package only as an unqualified community candidate. Before manifest adoption, establish maintained upstream provenance, license, shipped parser integrity, Node 24/grammar ABI, typed tree access, recovery/error behavior, UTF-8-byte to UTF-16 conversion, and complete profile coverage; differentially compare it with `dart analyze`/compiler parsing.
- If provenance, maintenance, packaging, or syntax coverage cannot be established, block and record an explicit route amendment (for example, a separately designed official analyzer protocol). Do not silently call a compiler as an AST parser and never recover meaning from source text.
- Exhaustively traverse compilation-unit, declaration/type/parameter, statement, expression/operator, directive, metadata, and comment children; reject all parser recovery and every unmodeled child.

## Backend and artifact strategy

- Return an ordered dependency-free Dart package with deterministic `pubspec.yaml` and `bin/program.dart`; include a lockfile only if the supported SDK deterministically requires one for a no-dependency package.
- Pin the supported SDK constraint and reject ambient package configuration, user imports, platform selection, or dependency solving. Validate names, types, calls, returns, mutability, ranges, and target capabilities before returning artifacts.
- Reparse generated Dart and preserve rich provenance plus the Task 015 Source Map v3 form. Mark package metadata and `main`/printing scaffolding synthetic or configuration-derived.

## Diagnostics and rejections

- Use located `PARSE_ERROR`, `MISSING_TYPE`, and `UNSUPPORTED_SYNTAX` for recovery, inference/dynamic/nullability, directives, and excluded language/runtime forms.
- Use `UNSUPPORTED_CAPABILITY` before partial artifact output for target limits or malformed IR. Never approximate optionals, arbitrary integers, exceptions, async, or isolate behavior.

## Deterministic real-toolchain tests

- Record exact `dart --version`; a missing/unsupported SDK fails. Use isolated package/cache locations and offline mode without fetching packages.
- Run formatting verification, `dart analyze`, VM execution, and `dart compile exe` plus native execution; assert exact output/status and safe-integer behavior. Do not claim Dart-to-JavaScript or browser acceptance.
- Cover Tasks 001–005, Unicode, void/value calls, parser recovery, every dynamic/nullability/concurrency boundary, generated reparse, all Dart directions, and representative existing-language crossings.
- Generate twice and compare all package files and provenance byte-for-byte.

## Documentation

Document the strict Dart VM/native profile, parser-candidate status, SDK/offline package requirements, artifact layout, numeric/nullability exclusions, mappings, and separation from Flutter. Add a behavior changelog fragment when implemented.

## Completion criteria

- A qualified parser route exists and Dart is truthfully registered as frontend and VM/native textual package backend for Tasks 001–005.
- Generated packages reparse, analyze, compile, and execute deterministically with the real installed Dart SDK without network dependencies.
- Dynamic-feature rejection, diagnostics, provenance, cross-language, docs/changelog, and repository gates pass.

## Non-goals

Flutter, browser/JavaScript Dart, nullable/dynamic types, classes/mixins/extensions, collections/generics, async/isolates, exceptions, reflection/FFI, packages from pub.dev, build_runner/macros, or cross-compilation.
