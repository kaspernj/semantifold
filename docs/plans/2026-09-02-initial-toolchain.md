# Initial toolchain plan

Date: 2026-09-02

## Narrow release-candidate scope

Build one honest vertical slice: a module containing a typed two-integer function, a comparison with two return branches, integer arithmetic and a call from an entry point that prints the result. PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java fixtures must normalize to the same semantic meaning. Anything outside the explicitly modeled nodes fails with an unsupported-syntax or unsupported-capability diagnostic.

## Architecture and files

- `src/semantic/`: JSDoc-typed discriminated semantic nodes, validation, and diagnostics. Parser-specific AST values never cross this boundary.
- `src/frontends/`: one adapter per language plus a registry. Mature parsers provide syntax trees and source locations; adapters normalize only the release-candidate subset.
- `src/backends/`: one source generator per language plus a registry. Each backend declares and checks its supported semantic capabilities.
- `index.js`: small public API for parsing, validation, generation, and language discovery.
- `spec/fixtures/`: equivalent source programs in all five languages.
- `spec/`: focused frontend-equivalence, diagnostics, backend-generation/execution, public API, and repository-contract specs; each file has one top-level `describe`.
- Root package/build/lint/container/CI files and project documentation describe the implemented subset separately from roadmap goals.

## Strict TDD order

1. RED: fixtures parsed through the public API cannot yet produce one location-bearing shared semantic module.
2. GREEN: implement the semantic model and five parser-backed frontend adapters; REFACTOR shared traversal and diagnostics without exposing parser ASTs.
3. RED: one shared semantic module cannot yet generate and execute exact-output programs in all five target languages.
4. GREEN: implement capability-checked source backends and isolated temporary-directory execution tests; REFACTOR shared emitter helpers only where semantics stay obvious.
5. RED/GREEN: add explicit unsupported-syntax, public API, package, TensorBuzz-only, and development-environment contracts.

Exact focused RED commands and their observed failures will be retained for the final handoff.

## Validation

Run focused specs while iterating, then `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`, `npm ls --omit=dev --all`, `npm pack --dry-run --json`, `git diff --check`, and available Dockerfile/Compose static validation. Runtime tests must invoke `php`, `ruby`, `node`, `tsc` plus `node`, and `javac` plus `java`; a missing executable is a test failure, never a skip.

## Risks and controls

- Parser ASTs differ significantly: keep traversal local to each adapter and cover fixtures plus unsupported nodes.
- Language type systems do not align perfectly: use the single semantic `integer` type now and document lossy normalization and generation.
- Source locations have different coordinate conventions: normalize to one-based line/column spans and preserve the originating filename/language.
- Ruby lacks enforced parameter/return annotations in the chosen subset: accept explicit RBS-style `# @param`/`# @return` comments in the fixture and reject missing declarations.
- Generated Java needs a class/file contract: emit `Main.java`; other backends use fixed documented filenames.
- Tool availability can hide false confidence: execute real toolchains and fail with the missing command named in the diagnostic.

## Deliberate non-goals

No general-purpose parsing, comments/formatting round trips, classes, mutable variables, loops, exceptions, imports/packages, overloads, optimization, interpreter, LLVM, Wasm, JVM bytecode, or publication. Semantic round-trip means equivalent modeled meaning, not reproduction of original source text.

## Bounded correction status

The 2026-09-02 independent correction pass tightened the frozen candidate without broadening the semantic model:

- Frontends now reject non-safe integer literals before construction, JS/TS async or generator flags, Java syntax that would otherwise be filtered, non-local Ruby annotations and non-required parameter forms, and PHP declarations other than optional exact `strict_types=1`.
- Backends now validate target lexical/reserved identifiers at every semantic name use, Java signed 32-bit integer bounds, exactly one return per branch, exactly one entry print, and two arguments per call before emitters run.
- The Velocious-compatible inline-JSDoc-cast ESLint plugin is pinned to immutable commit `441b6c5ca335a115a75d9f050134357ddb0a61d1`, with package and lockfile contract coverage.

Each accepted review finding has a focused regression spec. The complete original fixture-equivalence and real five-runtime execution coverage remains the release gate.
