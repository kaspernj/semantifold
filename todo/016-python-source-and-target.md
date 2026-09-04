# 016 — Python source and target support

- Status: `delivered`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Python as a first-class frontend and textual backend for the exact Tasks 001–004 semantic subset. Use a strict annotation-backed profile so Python's dynamic runtime does not weaken the semantic IR.

## Semantic and source profile

- Map semantic `integer`, `boolean`, and `string` only to exact annotations `int`, `bool`, and `str`. Reject aliases, quoted/forward annotations, unions, `Any`, `object`, `None`, literal/container types, and annotation expressions.
- Require annotations on every parameter, return, and local declaration. The adapter validates them itself; Python does not enforce annotations at runtime and Semantifold does not invoke a third-party type checker to infer meaning.
- Accept only synchronous top-level `def` declarations in the current exact two-required-positional-parameter shape, explicit scalar returns, annotated initialized simple locals, plain assignment, the current typed operators, ordinary `if`/`elif`/`else`, explicit `return`, and the exact entry print profile.
- Conditions are semantic `bool`; reject Python truthiness. Treat `bool` and `int` as distinct despite Python's runtime subclass relationship. Retain the safe-integer literal contract even though Python integers are arbitrary precision.
- Source files are UTF-8 and strings are normalized Unicode scalar values. Reject bytes, f-strings/interpolation, implicit adjacent concatenation if it obscures one semantic node, and invalid/lone-surrogate values.

## Frontend strategy

- Use the qualified official `tree-sitter-python` grammar through the Task 015 binding. Traverse named and anonymous children exhaustively, reject every error/missing/recovery node, and convert grammar byte offsets to exact UTF-16 locations.
- Parse annotations and operators from their tree nodes, never source slices used as a fallback. Preserve distinct spans for names, types, operators, branches, and literals.
- Reject decorators, `async`, generators/yield, lambdas, nested functions, classes, imports, globals/nonlocals, comprehensions, walrus expressions, pattern matching, exceptions, context managers, loops, attributes/method calls, subscripts, keyword/default/positional-only/keyword-only/variadic parameters, keyword/starred calls, and implicit returns.
- Reject executable top-level children outside canonical declarations/entry scaffolding. Comments and docstrings do not carry types and may not cause executable children to be dropped.

## Backend and artifact strategy

- Emit one deterministic `program.py` text artifact with exact annotations and explicit parentheses/control flow. Do not generate a package, virtual environment, requirements file, or dependency metadata.
- Use only Python's standard syntax and `print`; generated code must not inspect annotations or rely on optimization mode.
- Validate Python keywords, soft-keyword contexts, identifier spelling, integer range policy, type/operation compatibility, and complete block shape before emission.
- Generated source reparses through the Python frontend to equivalent semantic meaning and retains rich/Source Map v3 provenance according to Task 015.

## Diagnostics and rejections

- Missing annotations use `MISSING_TYPE`; unsupported annotations and dynamic forms use `UNSUPPORTED_SYNTAX` at the exact annotation/form; grammar failures use `PARSE_ERROR`.
- Reject coercive/mixed Boolean-integer operations even when CPython would execute them. Reject runtime monkey-patching, reflection, `eval`/`exec`, dynamic calls, and exception-based approximations.
- The backend raises `UNSUPPORTED_CAPABILITY` before emission for illegal names, malformed IR, or any node beyond the adopted subset.

## Deterministic tests with the real toolchain

- Add Python fixtures equivalent to the Tasks 001–004 cross-language fixtures, including Unicode strings, locals/mutation, every operator, sequencing, nested/optional branches, and both branch/fallthrough returns.
- Add focused rejection cases for every dynamic/typing boundary above, parser recovery, truthy conditions, `bool`/`int` mixing, ignored children, and malformed caller-owned IR.
- Run the configured real `python3` from Task 015: record `python3 --version`, compile with `python3 -m py_compile`, execute the generated file under a deterministic UTF-8 environment, and assert exact stdout and exit status. Missing Python fails.
- Generate/reparse Python from every original-five fixture and generate every original-five target from Python-derived IR; compare complete location-insensitive semantic meaning and exact runtime behavior.

## Documentation

Update root README, architecture, language support, testing/toolchain documentation, capability tables, annotation/dynamic exclusions, and artifact/mapping behavior. Add a behavior changelog fragment.

## Completion criteria

- Python is registered truthfully as both frontend and text backend.
- Its explicit annotation profile normalizes the complete Tasks 001–004 subset without admitting Python truthiness or dynamic behavior.
- Generated Python reparses equivalently, compiles, and runs with exact behavior on the real configured interpreter.
- Cross-source/target, rejection, diagnostic-location, provenance, docs/changelog, and repository gates pass.

## Delivery record

Delivered by `feature/python-source-target` on 2026-09-04. The implementation pins the qualified official Tree-sitter Node/Python registry pair, adds the exact annotation-backed Tasks 001–004 frontend and deterministic `program.py` backend, registers configured Python 3 discovery and staged compile/execute acceptance, and preserves the original-five `generate()` bytes. Focused coverage exercises parser recovery and coordinates, dynamic-form rejection, annotations, mutability, operators/flow, artifact provenance, Python native execution, and both directions of the original-five/Python matrix. Review, TensorBuzz CI, merge, and publication remain coordinator-owned.

## Non-goals

Duck typing, inference, mypy/pyright integration, arbitrary annotations, packages/imports, classes/protocols/dataclasses, decorators, comprehensions, iterators, exceptions, async/generators, pattern matching, reflection, metaprogramming, native extensions, or dependency management.
