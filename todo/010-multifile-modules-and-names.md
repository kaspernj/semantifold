# 010 — Multi-file modules and names

- Status: `todo`
- Phase/priority: Phase 2 / P2 (conditional)
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [009-closed-records-and-member-access.md](009-closed-records-and-member-access.md)

## Objective

Introduce a multi-file semantic program with explicit module identities, exports/imports, qualified symbol resolution, entry-module selection, and multi-artifact generation. Map the same dependency graph to Ruby modules/requires, ESM, PHP namespaces/requires, and Java packages/imports without implementing package managers.

## Current evidence and gap

The public `parse` API accepts one filename/source and returns one `SemanticModule`; `generate` returns one source string. Java always emits `Main.java`, Babel parses with `sourceType: "script"`, and frontends reject imports/packages/namespaces. [`../docs/goals.md`](../docs/goals.md) lists multi-file modules as a candidate, while architecture currently promises only a single executable program. File layout and resolution cannot be hidden in a target emitter string.

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `require_relative "math_tools"`; `module MathTools`; qualified `MathTools.difference(...)` under one canonical module-function profile | Reject load-path/gem resolution, autoload, dynamic require, include/extend/prepend, reopening, top-level constant fallback, and cyclic initialization. |
| JavaScript + JSDoc | ESM named `export`/`import {difference} from "./math.js"` | Switch parser profile deliberately to modules. Reject CommonJS, default/star/dynamic imports, re-exports, top-level await, bare package specifiers, import attributes, and side-effect-only imports. |
| TypeScript | ESM value imports/exports; `import type` only for semantic type edges where needed | Reject namespaces/internal modules, CommonJS/export assignment, path aliases, ambient modules, declaration merging, and type/value ambiguity. |
| PHP | canonical `namespace App\Math;`, `use function App\Math\difference;`, and explicit `require_once` artifact edge | Reject include-path/composer/autoload resolution, dynamic include/require, grouped/wildcard alias complexity, multiple namespace blocks per file, fallback name resolution, and side-effect imports. |
| Java | `package app.math; import app.model.User;` with one public top-level class per generated file | Reject JPMS `module-info`, wildcard/static imports initially, unnamed-package mixing, multiple public classes per artifact, classpath discovery, annotation processing, and split packages. |

## Semantic IR, typing, and validation

- Add `SemanticProgram {modules, entryModule, location?}` and enrich `SemanticModule` with stable logical identity, source filename, declarations, imports, exports, and optional entry point.
- Add explicit symbol namespaces/kinds for functions, records/types, and later errors. Imports bind a remote exported declaration to a local name; references resolve to declaration identity, not concatenated strings.
- Validate unique module identities, exports, local bindings, import targets/kinds, visibility, entry-module uniqueness, dependency cycles, and deterministic initialization order. Initially reject all cycles.
- Define a public multi-source parse request and generation result such as ordered `{filename, source}` artifacts. Preserve backwards-compatible single-module behavior only if it stays unambiguous; document any API versioning decision.
- Paths/specifiers are logical metadata. Do not read transitive source files implicitly or invoke a package manager.

## Frontend work

- Add an explicit multi-file request that supplies every filename/language/source; dispatch each to its existing parser adapter and resolve imports only after adaptation.
- Prism: recognize only canonical module/require-relative structure with parser nodes and literal paths.
- Babel: parse JS/TS module sources with `sourceType: "module"`; exhaustively convert named value/type imports/exports and reject every unmodeled specifier.
- `php-parser`: convert namespace/use/require nodes with exact literal artifact paths; retain strict-types placement rules.
- Lezer: convert direct `PackageDeclaration`/`ImportDeclaration` children and class/file structure; error nodes remain parse failures.

## Backend and target validation work

- Change generation to plan all target artifacts before emitting any, including deterministic filenames, directories, module/package declarations, imports/requires, and one executable entry artifact.
- Validate target-qualified identifiers, case/collision rules, reserved names, path traversal, filename/public-class contracts, import cycles, and unavailable target representation before writing/returning artifacts.
- Return artifacts to the caller; do not write files as a hidden side effect. Tests may materialize them in isolated temporary directories.
- No backend may flatten modules into one global file if that changes visibility or name resolution.

## Diagnostics and source locations

- Stable diagnostics cover duplicate module/export/import binding, unresolved/private import, kind mismatch, ambiguous symbol, import cycle, invalid entry selection, unsafe target path, and target filename/name collision.
- Import declaration, specifier/path, imported/exported name, declaration, and reference each retain source locations and source filenames.
- Target layout conflicts are `UNSUPPORTED_CAPABILITY` at the responsible module/declaration/import.

## Tests and acceptance

- Add three-file equivalent projects for all five source languages with shared record/type and function modules plus one entry module.
- Negative specs cover unresolved/private/wrong-kind imports, duplicate aliases, cycles, dynamic/default/star/CommonJS/bare-package forms, Composer/gem/classpath discovery, path traversal, and target case/name collisions.
- Generated artifact sets are reparsed as a program and compared by resolved declaration identity after locations/artifact-specific spelling are removed.
- Materialize every generated target project in a temporary directory and run real PHP/Ruby/Node, local `tsc`+Node, and `javac`+Java commands with exact output; missing commands fail.

## Documentation and changelog

Document the multi-source/public artifact API, logical resolution, canonical layouts per target, entry selection, and package-manager exclusions. Add migration notes if the public API changes and one behavior changelog fragment.

## Non-goals

Package-manager/network resolution, dependency installation, implicit filesystem discovery, Ruby gems/load paths, npm/CommonJS/bundlers/path aliases, Composer/autoload, Java classpath/module-path discovery or JPMS, cyclic initialization, re-exports/star/default/dynamic imports, resource files, and source maps back to original artifacts.

## Completion criteria

- One semantic program resolves explicit cross-file symbols without parser AST or target-path leakage.
- Public generation returns a deterministic safe artifact set and preserves the documented single-file path if retained.
- Every adapter/backend rejects unsupported resolution/layout forms before partial output.
- Multi-file diagnostic, semantic round-trip, and real five-toolchain project execution pass with docs/changelog/API notes.
