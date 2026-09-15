# 029 — Dart source and target support

- Status: `implemented and accepted locally — exact-head review/CI/merge pending`
- Phase/priority: Phase P / P1
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Dart as a first-class frontend and Dart VM/native textual package backend for Tasks 001–005. This supplies the typed language basis for Task 030 without making Flutter widgets, browsers, or mobile lifecycle part of Dart language semantics.

## Amended parser route

The first attempted registry route, `@driftlog/tree-sitter-dart@1.0.4`, passes Node 24 loading and CST checks but fails the required clean-install contract because `npm ls --all --json` reports generated extraneous `@driftlog/node-addon-api` residue. Kasper authorized research and qualification of a different immutable public package on 2026-09-15.

Exact registry `tree-sitter-dart-orchard@0.7.0` is the amended route. Its immutable annotated `v0.7.0` tag peels to npm `gitHead` `9322cd5e1266c60983ae0ff921fbb4e77e903781`; its MIT source/release workflow, ABI 14 parser, typed Node binding, Task 001–005 CST, recovery and coordinate behavior, clean isolated install/`npm ci` dependency trees, and credential-free packed-consumer behavior pass locally. The rebuilt canonical lane also passes exact Dart 3.13.3 offline pub, formatter, fatal analyzer, VM, native compilation, and native execution checks. No gate was relaxed and no cleanup hook, source-text fallback, vendored parser, copied build, Git/archive dependency, or private package was introduced.

## Semantic and source profile

- Map semantic scalars to explicitly annotated `int`, `bool`, and `String`; use `final` for immutable locals and typed mutable declarations otherwise. Every parameter, result, and local has an explicit type.
- Accept synchronous top-level functions with Task 005 required arity/void, initialized locals, assignment, current operators, strict-Boolean conditionals, explicit returns, direct calls, and a canonical `main`/print shell.
- Reject exact `_` as Dart 3 wildcard syntax for semantic function, parameter, and local bindings, plus exact official `// dart format off`/`on` control comments; retain ordinary underscore-prefixed identifiers and ordinary comments.
- Target the installed Dart VM/native executable profile only. Define and enforce the portable safe-integer range before execution; browser JavaScript numeric behavior is not part of this task.
- Reject `dynamic`, `Object`/`Object?`, nullable types, `late`, inference, `num`/`double`/`BigInt`, casts/type tests, named/optional parameters, tear-offs/closures, classes/mixins/extensions/enums/records, collections, generics, operator overloading, exceptions, `async`/futures/streams/isolates, mirrors, FFI, imports other than the generated SDK-only shell, and interpolation.

## Frontend strategy and parser qualification

- Use exact public registry `tree-sitter-dart-orchard@0.7.0`, whose immutable source, license, shipped parser integrity, Node 24/grammar ABI, typed tree access, recovery/error behavior, UTF-8-byte-to-UTF-16 conversion, complete profile coverage, and Dart SDK differential are recorded above and in `docs/parser-qualification.md`. The unscoped and Driftlog candidates remain rejected for their documented compatibility and clean-tree failures.
- If the selected parser's provenance, maintenance, packaging, or syntax contract later fails, block and require an explicit route amendment. Do not silently call a compiler as an AST parser and never recover meaning from source text.
- Exhaustively traverse compilation-unit, declaration/type/parameter, statement, expression/operator, directive, metadata, and comment children; reject all parser recovery and every unmodeled child.

## Backend and artifact strategy

- Return exactly ordered dependency-free `pubspec.yaml`, deterministic generated `pubspec.lock`, and mapped `bin/program.dart` artifacts.
- Emit over-width formal parameter lists in exact Dart 3.13.3 formatter-canonical multiline form and authenticate their trailing comma only through the complete generated runtime CST prefix.
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

Local acceptance on 2026-09-15 passes all six Dart profiles, representative PHP/Ruby/JavaScript/TypeScript/Java inputs into Dart, every Dart profile into all compatible Task-005 targets, and the Unicode/eager-order/recursion/void-call/short-circuit/safe-integer boundary. Each real Dart run owns fresh absolute HOME, PUB_CACHE, project/output, and TMPDIR paths; uses an unreachable hosted URL with analytics suppressed; executes offline restore, formatter verification, fatal analysis, VM, native compilation, and native execution; compares VM/native output; and proves all three emitted artifacts remain byte-identical. Exact-head review, TensorBuzz CI, merge, and post-merge verification remain pending.

## Documentation

The strict Dart VM/native profile, selected and rejected parser routes, SDK/offline package requirements, artifact layout, numeric/nullability exclusions, mappings, and separation from Flutter are recorded in `docs/dart.md` and the Task 029 changelog fragment.

## Completion criteria

- A qualified parser route exists and Dart is truthfully registered as frontend and VM/native textual package backend for Tasks 001–005.
- Generated packages reparse, analyze, compile, and execute deterministically with the real installed Dart SDK without network dependencies.
- Dynamic-feature rejection, diagnostics, provenance, cross-language, docs/changelog, and repository gates pass.

## Non-goals

Flutter, browser/JavaScript Dart, nullable/dynamic types, classes/mixins/extensions, collections/generics, async/isolates, exceptions, reflection/FFI, packages from pub.dev, build_runner/macros, or cross-compilation.
