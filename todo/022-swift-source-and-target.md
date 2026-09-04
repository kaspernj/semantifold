# 022 — Swift source and target support

- Status: `todo`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Swift as a first-class frontend and native textual backend for exactly the Tasks 001–004 semantic subset. This language lane is independent of Apple UI frameworks; Task 026 later composes its backend into an iOS application target.

## Semantic and source profile

- Map semantic `integer`, `boolean`, and `string` to explicitly annotated `Int64`, `Bool`, and `String`. Accept `let` for immutable locals and `var` only where the semantic binding is assignable.
- Accept synchronous top-level functions in the current exact two-parameter form, initialized scalar locals, assignment, the current operators, strict-Boolean `if`/`else`, explicit scalar returns, and a canonical entry point/print shell.
- Preserve the safe-integer contract. Reject Swift overflow operators, target-width `Int`, implicit numeric conversion, overloaded/custom operators, interpolation, and locale-dependent formatting.
- Reject type inference, optionals/implicitly unwrapped optionals, tuples, collections, enums, structs, classes, protocols, extensions, generics, closures, property wrappers, result builders, macros, throwing functions, `async`/actors, Objective-C exposure, reflection, unsafe pointers, and Foundation/UIKit/SwiftUI APIs.

## Frontend strategy

- Qualify a pinned `tree-sitter-swift` npm release under Task 015 before adoption. Qualification must establish provenance/license, Node 24 loading, grammar ABI, shipped parser contents, typed access, error/recovery behavior, UTF-8-byte to UTF-16 conversion, complete profile coverage, and differential agreement with the selected `swiftc` parser.
- Treat that community grammar as a candidate, not approved infrastructure. If it fails, stop this task and record an explicit parser-route amendment; do not scan source text or use compiler diagnostics as an AST fallback.
- Exhaustively traverse source-file, declaration, type, statement, expression, operator, and trivia/directive-bearing children. Reject every error, missing, recovery, conditional-compilation, attribute, and unmodeled child at its converted source span.

## Backend and artifact strategy

- Emit one deterministic UTF-8 `program.swift` artifact using fully explicit `Int64`, `Bool`, and `String` spelling and a synthetic entry shell isolated in provenance.
- Validate Swift identifiers, keywords, complete returns, mutability, operand/result types, scalar ranges, and the whole module before emission. Do not import Apple frameworks or add a package manager/project file in this task.
- Reparse generated Swift to equivalent semantic meaning. Preserve rich mappings and Source Map v3 ranges for semantic tokens; mark braces, entry scaffolding, and print plumbing as synthetic.

## Diagnostics and rejections

- Grammar failures use `PARSE_ERROR`; missing required types use `MISSING_TYPE`; valid Swift outside the profile uses located `UNSUPPORTED_SYNTAX`.
- Backend capability, illegal-name, or malformed-IR failures use `UNSUPPORTED_CAPABILITY` before an artifact is returned. Never approximate optionals, errors, concurrency, overflow, or value/reference identity at runtime.

## Deterministic real-toolchain tests

- Record the exact installed `swiftc --version`. Missing or unsupported Swift fails the declared language acceptance lane.
- Run compiler parse/typecheck, compile a native executable, execute it, and assert exact UTF-8 stdout and status in isolated temporary directories. Run generated sources in debug and optimized modes to expose overflow or evaluation-order divergence.
- Cover every Tasks 001–004 construct, Unicode, mutable/immutable locals, every operator, nested/one-armed branches, fallthrough, parser recovery, every boundary above, generated reparse, every Swift frontend/backend direction, and representative original-five crossings.
- Generate twice and compare the complete artifact and provenance map byte-for-byte. No test downloads an SDK, parser, or package.

## Documentation

Document the exact Swift profile, supported compiler versions/discovery, artifact name, mappings, exclusions, and the distinction between general Swift support and the later Apple/iOS application lane. Add a behavior changelog fragment when implemented.

## Completion criteria

- Swift is truthfully registered as both frontend and text backend for Tasks 001–004 only.
- The parser candidate passes Task 015 qualification, and parser/compiler differential fixtures reveal no accepted-tree ambiguity.
- Generated Swift reparses equivalently and passes deterministic real-compiler/runtime, diagnostics, cross-language, provenance, and repository gates.

## Non-goals

Swift packages, Apple frameworks, iOS apps, Objective-C interoperability, macros, protocols, generics, optionals, errors, concurrency, reflection, FFI, unsafe memory, or dependency resolution.
