# 017 — C# source and target support

- Status: `todo`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add C# as a first-class frontend and managed textual/project backend for the exact Tasks 001–004 subset. It may proceed alongside other Task 015 language adopters and focuses on compiler, project, nullable, and value/reference contracts.

## Semantic and source profile

- Map semantic `integer` to exact C# `long`/`System.Int64`, `boolean` to `bool`/`System.Boolean`, and `string` to non-null `string`/`System.String`. Choose one spelling per generated profile; aliases are equivalent only where the adapter resolves them unambiguously without imports.
- Require `#nullable enable` and treat nullable warnings as errors. Reject `null`, nullable value/reference types, the null-forgiving operator, disabled/restored nullable contexts, oblivious metadata, and boxed `object`/`dynamic` values.
- Accept one canonical static program class, synchronous static methods with the current exact two required positional parameters, explicit return types/returns, explicitly typed initialized locals, simple assignment, current operators, braced `if`/`else if`/`else`, and one canonical `Main` entry point.
- `long` and `bool` are value types. `string` is an immutable reference type but represents a semantic value; reject reference identity, mutation, interning observations, culture-sensitive operations, user conversions, and overload-dependent behavior.
- Keep the semantic safe-integer literal limit. The target uses explicit `checked` or `unchecked` arithmetic only after the task records how it matches the existing documented target-specific overflow boundary; it must not silently switch by build configuration.

## Frontend strategy

- Use the Task 015-qualified official `tree-sitter-c-sharp` grammar. Exhaustively traverse compilation-unit, class, method, block, expression, and trivia/directive-bearing children; reject every error/missing/recovery node and retain UTF-16 spans.
- Recognize only the exact generated namespace/class/entry scaffolding and semantic static methods. Do not ignore attributes, using aliases, top-level statements, fields, properties, constructors, nested types, or additional members.
- Reject inferred `var`, constants/fields, ref/out/in/scoped parameters or locals, optional/named/params arguments, generics, overload sets, extension/instance/qualified/dynamic calls, lambdas/delegates, async/iterators, unsafe/pointers, casts, checked-context changes, interpolation, pattern matching, exceptions, and LINQ.
- Parser nodes, not Roslyn/compiler output or source scanning, remain authoritative for frontend normalization. Compilation is an acceptance check, not a parsing fallback.

## Backend and artifact strategy

- Emit a deterministic artifact set containing `Program.cs` and `Semantifold.csproj`. Pin a documented supported .NET target framework and C# language major selected during implementation; set nullable enabled, warnings as errors, deterministic build, invariant globalization where appropriate, and an explicit overflow-checking policy.
- Use no NuGet packages, restore-time network dependency, implicit SDK analyzers beyond the pinned SDK contract, or generated source tools. Restore/build must succeed offline after the SDK is installed.
- Emit fully qualified runtime names where that avoids Task 010 imports. Use invariant, exact scalar output and target escaping; do not approximate semantic strings through culture-sensitive formatting.
- Validate reserved/contextual identifiers, `Main`/class scaffolding collisions, `long` range, malformed IR, and every unsupported node before returning either artifact.
- Generated `Program.cs` reparses through the frontend to equivalent meaning after exact synthetic project/entry scaffolding is removed. Both artifacts carry deterministic provenance; the project file is synthetic with related module origins.

## Compiler/runtime, diagnostics, and rejections

- Discover a supported `dotnet` SDK with Task 015, record `dotnet --info`, and reject unsupported or mismatched SDK/target-framework combinations explicitly. Do not download an SDK or package during tests.
- Frontend missing types use `MISSING_TYPE`; unsupported syntax uses `UNSUPPORTED_SYNTAX`; grammar failures use `PARSE_ERROR`. Compiler diagnostics never replace Semantifold's located frontend diagnostics.
- Backend name, value/reference/nullability, range, or project limitations use `UNSUPPORTED_CAPABILITY` before partial artifacts. No nullable suppression, boxing, exception wrapper, reflection, or dynamic dispatch may make an unsupported module run.

## Deterministic tests with the real toolchain

- Add C# fixtures equivalent to every Tasks 001–004 fixture and negative coverage for nullable/value distinctions, `bool` versus `long`, `var`, overloads, instance calls, directives, interpolation, compiler recovery, ignored members, and malformed external IR.
- Generate/reparse C# in both directions and cover representative original-five source/target crossings. Task 025 owns the expanded-cohort spanning matrix.
- In a fresh temporary artifact directory run real offline `dotnet restore` and `dotnet build`, then execute the compiled program with exact invariant environment/stdout assertions. Missing `dotnet`, warnings, restore network demand, or nondeterministic outputs fail.
- Build the same artifact set twice and compare text, ordered paths, mappings, and reproducibility-relevant compiler outputs.

## Documentation

Document the selected SDK/C# major, target framework, class/entry profile, exact scalar spellings, nullable policy, overflow boundary, artifact set, tool override, and all exclusions. Update README/architecture/language/testing docs and add a behavior changelog fragment.

## Completion criteria

- C# is registered as a frontend and managed text/project backend with truthful capabilities.
- The complete Tasks 001–004 subset round-trips without nullability, boxing, overload, or dynamic leakage.
- The deterministic project restores offline, builds without warnings, and runs with exact output on the real supported SDK/runtime.
- Cross-language, negative, provenance, diagnostic, docs/changelog, and repository gates pass.

## Non-goals

NuGet/user dependencies, solution files, multiple semantic source files, records/classes as semantic values, generics, LINQ, overload resolution, nullable values, exceptions, async/tasks, iterators, delegates/events, reflection, unsafe code, platform invocation, checked-conversion semantics, or AOT publication.
