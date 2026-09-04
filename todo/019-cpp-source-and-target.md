# 019 — C++ source and target support

- Status: `todo`
- Phase/priority: Phase L2 / P0
- Dependencies: [018-c-source-and-target.md](018-c-source-and-target.md)

## Purpose

Add C++ as a separate first-class frontend and native textual backend for the exact Tasks 001–004 subset. Reuse C's staged native acceptance, but define C++ value/ownership, overload, template, exception, and undefined-behavior boundaries independently.

## Semantic and source profile

- Map `integer` to `std::int64_t`, `boolean` to `bool`, and `string` to owned `std::string` values with UTF-8 bytes. Keep the safe-integer literal bound and one explicit deterministic signed-overflow policy; never inherit compiler undefined behavior.
- Semantic string assignment, arguments, and returns are value copies. Generated code may use compiler-visible moves/borrows only when observationally equivalent and provenance marks them as scaffolding. No semantic alias, identity, moved-from state, reference, or lifetime is exposed.
- Accept namespace-scope non-overloaded functions with the current exact two required by-value scalar parameters, explicit return types/returns, initialized typed locals, plain assignment, supported operators, braced conditionals, and canonical `main`.
- Fix one standard/compiler profile (initially C++20 with Clang unless qualification records a different baseline), standard library, execution encoding, warning policy, and exception/RTTI settings. Builds must not change arithmetic or error behavior by optimization mode.

## Frontend strategy

- Use the Task 015-qualified official `tree-sitter-cpp` grammar, not the C grammar or a source-mode guess. Exhaustively traverse translation-unit, declaration/declarator, function, block, and expression children and reject every error/missing/recovery node.
- Recognize only exact generated includes, qualified scalar names, support helpers, and `main` scaffolding. Resolve canonical types structurally; do not run the preprocessor or compiler as a semantic parser.
- Reject templates/concepts, overload sets/operators/conversions, auto/deduction, references/pointers, arrays, classes/structs/unions/enums as user values, constructors/destructors, inheritance, virtual dispatch, namespaces/using directives beyond exact scaffolding, exceptions, RTTI, casts, initializer lists, lambdas, coroutines, ranges, user-defined literals, macros, and unspecified-order constructs.
- Standard-library implementation calls emitted for strings/printing are exact backend scaffolding. The frontend may collapse only those exact tree shapes on reparse; similar user calls remain unsupported.

## Backend and artifact strategy

- Emit one deterministic `program.cpp` artifact, using fully qualified standard names and no user build files or dependencies. If a support file becomes technically required, amend the artifact contract explicitly rather than treating it as a semantic module.
- Use owned `std::string` values and byte-counted output so embedded NUL and UTF-8 are exact. Avoid iostream locale/overload behavior in the observable print path.
- Validate target/reserved identifiers, class/function/scaffold collisions, integer and size boundaries, value-copy representability, and complete IR before emission.
- Generated source reparses to equivalent semantics after exact helper/copy/move scaffolding normalization and retains deterministic rich/Source Map v3 provenance.

## Ownership, errors, diagnostics, and rejections

- Library allocation failure and process termination are documented host-resource failures, not semantic exceptions. Generated code neither throws nor catches; frontend `throw`, `try`, exception specifications, and user RAII cleanup effects are rejected.
- No backend may select an overload based on an unmodeled conversion. Every emitted standard call/operator has fixed operand types proven before emission.
- Unsupported syntax/types use located frontend diagnostics. Backend ABI, identifier, integer, ownership, helper, and malformed-IR limitations use `UNSUPPORTED_CAPABILITY` before source is returned.

## Deterministic tests with the real toolchain

- Add C++ fixtures equivalent to Tasks 001–004 with Unicode/embedded-NUL strings, repeated value copies, concatenation, assignment, typed operators, and nested/fallthrough branches.
- Add negative coverage for C syntax accidentally accepted as C++, templates, overloads, implicit conversions, references/pointers, moves exposed by source, exceptions, preprocessor forms, recovered nodes, ambiguous declarators, undefined-overflow boundaries, and malformed IR.
- Discover and record real `clang++`; compile/link with the exact standard and warning/error flags in a fresh directory; execute and assert exact output/status. Missing compiler/linker/runtime fails.
- Run a supported sanitizer-focused value-lifetime lane in addition to mandatory ordinary execution. Compare debug/optimized observable output to prove build mode does not change the selected contract.
- Generate/reparse C++ from every registered frontend and generate all applicable targets from C++-derived IR.

## Documentation

Document why C++ is not the C lane, selected standard/toolchain/standard-library profile, scalar/value mappings, copy/move/borrow boundaries, overflow/error behavior, exact scaffolding, compile flags, and exclusions. Update README/architecture/language/testing docs and add a behavior changelog fragment.

## Completion criteria

- C++ has independent frontend/backend registrations and cannot be selected through C.
- The complete Tasks 001–004 subset has deterministic value behavior without template, overload, reference, exception, or undefined-behavior leakage.
- Real Clang C++ compile/link/run, optimized parity, focused lifetime tests, equivalent reparse, and deterministic provenance pass.
- Cross-language, negative, diagnostics, docs/changelog, and all repository gates pass.

## Non-goals

C compatibility mode, templates/concepts/generics, overload resolution, classes/records, references/pointers, custom allocators, exception semantics, RAII as semantic behavior, STL containers, ranges/iterators, modules/headers, coroutines, RTTI, undefined behavior, ABI interoperability, or user build systems.
