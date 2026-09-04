# Roadmap research sources

Access date for existing semantic-roadmap sources: **2026-09-02**. Language-expansion sources were checked **2026-09-04**.

## Repository baseline and inspected evidence

- Original roadmap baseline: `9e85016b927040f8b2a056ad4136ae3c5fa6fae7` (`docs/language-feature-todos`, identical to merged `master` when the semantic roadmap was researched).
- Language-expansion baseline: `de60a179ea5d3d320ad1323c36dbb0b31e0857d6` (`master`, with Tasks 001–004 implemented). The current public language IDs and closed frontend/backend dispatch were re-inspected at this commit.
- Product scope and documentation: [`../README.md`](../README.md), [`../docs/goals.md`](../docs/goals.md), [`../docs/architecture.md`](../docs/architecture.md), [`../docs/language-support.md`](../docs/language-support.md), [`../docs/testing.md`](../docs/testing.md), and [`../docs/plans/2026-09-02-initial-toolchain.md`](../docs/plans/2026-09-02-initial-toolchain.md).
- Public/semantic boundary: [`../index.js`](../index.js), [`../src/semantic/types.js`](../src/semantic/types.js), [`../src/semantic/validate.js`](../src/semantic/validate.js), [`../src/semantic/location.js`](../src/semantic/location.js), and [`../src/diagnostic.js`](../src/diagnostic.js).
- Parser adapters: [`../src/frontends/javascript-typescript.js`](../src/frontends/javascript-typescript.js), [`../src/frontends/php.js`](../src/frontends/php.js), [`../src/frontends/ruby.js`](../src/frontends/ruby.js), and [`../src/frontends/java.js`](../src/frontends/java.js).
- Backend capability and emission: [`../src/backends/shared.js`](../src/backends/shared.js), [`../src/backends/identifiers.js`](../src/backends/identifiers.js), and all five emitters in [`../src/backends/`](../src/backends/).
- Fixtures/specs: all files in [`../spec/fixtures/`](../spec/fixtures/) and [`../spec/`](../spec/), especially frontend equivalence, numeric/flag rejection, language-specific frontend validation, backend execution, identifier/shape validation, diagnostics, and repository contracts.
- Packaging/tooling: [`../package.json`](../package.json), [`../package-lock.json`](../package-lock.json), [`../tsconfig.json`](../tsconfig.json), [`../Dockerfile`](../Dockerfile), [`../compose.yml`](../compose.yml), and [`../tensorbuzz.yml`](../tensorbuzz.yml).

Evidence note: the original schema had only `integer` and the minimal fixture shape. By the language-expansion baseline it also has Boolean/string scalars, typed locals/assignment, typed operators, ordered blocks, nested/optional conditionals, explicit flow validation, and rich provenance, while functions/calls still have exact two-parameter/two-argument shape. Frontends enumerate or structurally select accepted parser children; backend validation separately enforces shape, identifiers, scalar payloads, flow, safe literals, and Java `int` range.

## Selected parser-distribution route for expansion

Tasks 016–020 select the official Tree-sitter Node binding and the language grammar maintained in the official `tree-sitter` GitHub organization: [Node binding documentation](https://tree-sitter.github.io/node-tree-sitter/), [parser-use overview](https://tree-sitter.github.io/tree-sitter/using-parsers/), [Python grammar](https://github.com/tree-sitter/tree-sitter-python), [C# grammar](https://github.com/tree-sitter/tree-sitter-c-sharp), [C grammar](https://github.com/tree-sitter/tree-sitter-c), [C++ grammar](https://github.com/tree-sitter/tree-sitter-cpp), and [Rust grammar](https://github.com/tree-sitter/tree-sitter-rust).

This is a selected integration route, not approval of unpinned future dependencies. Task 015 must qualify exact npm releases and lockfile integrity before any manifest edit: compatible Tree-sitter language ABI, Node 24 install/load behavior on the canonical lane, typed APIs, licenses, UTF-8 byte locations converted to Semantifold UTF-16 locations, comments/error/recovery nodes, complete Tasks 001–004 syntax coverage, and absence of postinstall downloads or bundled/generated archives. Dependencies must be ordinary npm registry packages; GitHub tarball/archive dependencies and vendored parser binaries are forbidden. A failed qualification blocks the task and requires an explicit roadmap/source amendment rather than a parser or source-text fallback.

Registry metadata observed on 2026-09-04 identifies the following candidates. These are evidence that the selected route is distributed, not version pins or an ABI-compatibility conclusion:

| Package | Observed latest | Upstream/license metadata |
| --- | --- | --- |
| [`tree-sitter`](https://registry.npmjs.org/tree-sitter/0.25.1) | `0.25.1` | official `tree-sitter/node-tree-sitter`, MIT |
| [`tree-sitter-python`](https://registry.npmjs.org/tree-sitter-python/0.25.0) | `0.25.0` | official `tree-sitter/tree-sitter-python`, MIT |
| [`tree-sitter-c-sharp`](https://registry.npmjs.org/tree-sitter-c-sharp/0.23.5) | `0.23.5` | official `tree-sitter/tree-sitter-c-sharp`, MIT |
| [`tree-sitter-c`](https://registry.npmjs.org/tree-sitter-c/0.24.1) | `0.24.1` | official `tree-sitter/tree-sitter-c`, MIT |
| [`tree-sitter-cpp`](https://registry.npmjs.org/tree-sitter-cpp/0.23.4) | `0.23.4` | official `tree-sitter/tree-sitter-cpp`, MIT |
| [`tree-sitter-rust`](https://registry.npmjs.org/tree-sitter-rust/0.24.0) | `0.24.0` | official `tree-sitter/tree-sitter-rust`, MIT |

## Pinned parser and tool versions

Resolved versions come from `package-lock.json`; manifest ranges come from `package.json`.

| Tool | Manifest constraint | Resolved/observed version | Evidence |
| --- | --- | --- | --- |
| `@babel/parser` | `^7.28.4` | `7.29.8` | [Babel parser docs](https://babeljs.io/docs/babel-parser), [7.29.8 package source](https://github.com/babel/babel/tree/v7.29.8/packages/babel-parser), [exact registry record](https://registry.npmjs.org/%40babel%2Fparser/7.29.8) |
| `@babel/types` | `^7.28.4` | `7.29.8` | [Babel types docs](https://babeljs.io/docs/babel-types) |
| `comment-parser` | `^1.4.1` | `1.4.8` | [exact registry record](https://registry.npmjs.org/comment-parser/1.4.8), [project repository](https://github.com/syavorsky/comment-parser) |
| `@ruby/prism` | `^1.9.0` | `1.9.0` | [exact registry record](https://registry.npmjs.org/%40ruby%2Fprism/1.9.0), [official JavaScript binding docs](https://ruby.github.io/prism/rb/docs/javascript_md.html) |
| `php-parser` | `^3.7.0` | `3.7.0` | [tagged 3.7.0 source/readme](https://github.com/glayzzle/php-parser/tree/v3.7.0), [exact registry record](https://registry.npmjs.org/php-parser/3.7.0) |
| `@lezer/java` | `^1.1.3` | `1.1.3` | [exact registry record](https://registry.npmjs.org/%40lezer%2Fjava/1.1.3), [Lezer system guide](https://lezer.codemirror.net/docs/guide/) |
| `@lezer/common` | `^1.2.3` | `1.5.2` | [Lezer reference](https://lezer.codemirror.net/docs/ref/) |
| TypeScript compiler | `^7.0.0` | `7.0.2` | [exact registry record](https://registry.npmjs.org/typescript/7.0.2), [compiler options](https://www.typescriptlang.org/docs/handbook/compiler-options.html) |
| Node.js | Docker/TensorBuzz exact | `24.18.1` | `Dockerfile`, `tensorbuzz.yml` |
| PHP CLI | Ubuntu package, not exact-pinned | locally observed `8.5.4` | `Dockerfile`, `tensorbuzz.yml` |
| Ruby | Ubuntu package, not exact-pinned | locally observed `3.3.8` | `Dockerfile`, `tensorbuzz.yml` |
| Java compiler/runtime | Ubuntu default JDK, not exact-pinned | locally observed OpenJDK `25.0.4` | `Dockerfile`, `tensorbuzz.yml` |

Parser evidence note: Babel documents attached comments, offsets/locations, TypeScript syntax plugins, and its AST deviations. Prism's JavaScript API exposes a parse result containing a typed AST, comments, errors, warnings, and node locations. `php-parser` 3.7.0 documents positional ASTs and extracted documentation. Lezer documents compact concrete syntax trees and error recovery/error nodes; Semantifold must continue rejecting a `⚠` node rather than treating a recovered tree as valid. Inspection of the installed `@lezer/java@1.1.3` grammar confirmed nodes for locals, assignments, arrays, field access, calls, loops, packages/imports, classes, type parameters, and try/throw, but no Java record-declaration grammar; Task 009 therefore uses a conventional final-class mapping for Java.

## Ruby and RBS

- [Ruby 3.3 syntax index](https://docs.ruby-lang.org/en/3.3/syntax_rdoc.html) — official index for literals, assignment, control, methods/calls, classes/modules, exceptions, precedence, and operators.
- [Ruby literals](https://docs.ruby-lang.org/en/3.3/syntax/literals_rdoc.html) — strings, arrays, hashes, booleans, `nil`, and numeric literal forms.
- [Ruby 3.3 `Hash`](https://docs.ruby-lang.org/en/3.3/Hash.html) — entry creation order and ordered `each`/`each_pair` iteration evidence for deferred Task 014.
- [Ruby assignment](https://docs.ruby-lang.org/en/3.3/syntax/assignment_rdoc.html) — local binding and assignment behavior.
- [Ruby control expressions](https://docs.ruby-lang.org/en/3.3/syntax/control_expressions_rdoc.html) — `if`/`elsif`, truthiness, sequencing, loops, `break`, and `next`.
- [Ruby method definitions](https://docs.ruby-lang.org/en/3.3/syntax/methods_rdoc.html) and [method calls](https://docs.ruby-lang.org/en/3.3/syntax/calling_methods_rdoc.html) — required, optional, rest, keyword, and block parameters/calls.
- [Ruby modules and classes](https://docs.ruby-lang.org/en/3.3/syntax/modules_and_classes_rdoc.html) — constants, nesting, classes, inheritance, and modules.
- [Ruby exception syntax](https://docs.ruby-lang.org/en/3.3/syntax/exceptions_rdoc.html) — `raise`, `rescue`, `else`, `ensure`, and retry behavior.
- [RBS syntax](https://github.com/ruby/rbs/blob/master/docs/syntax.md) — `bool`, `nil`, optional `T?`, unions, records, tuples, generic applications, type variables, and method parameter forms.
- [Prism overview](https://ruby.github.io/prism/) and [Prism JavaScript API](https://ruby.github.io/prism/rb/docs/javascript_md.html) — authoritative parser/binding behavior.

Evidence note: Ruby truthiness accepts every value except `false` and `nil`, which is broader than the proposed semantic boolean condition. RBS distinguishes `bool`, `nil`, optional/union types, and parameter kinds. Semantifold's current adjacent `# @param name [Integer]` carrier is a project convention inspired by documentation syntax, not a claim to parse an RBS file; roadmap tasks keep that carrier explicit and use RBS type expressions inside it until a separate signature-file design exists.

## JavaScript with JSDoc and Babel

- [MDN JavaScript guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) and [language overview](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Language_overview) — primitives, control, functions, arrays/maps, objects/classes, modules, promises, and dynamic behavior.
- [MDN grammar and types](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types), [expressions/operators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_operators), [control/error handling](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Control_flow_and_error_handling), and [loops/iteration](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Loops_and_iteration) — syntax and runtime semantics relevant to Tasks 001–008 and 011.
- [MDN indexed collections](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Indexed_collections), [keyed collections](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Keyed_collections), [classes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_classes), and [modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — container, record/class, and module mapping evidence.
- [MDN `Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) — insertion-order iteration evidence for the deferred native-map profile in Task 014.
- [JSDoc `@type`](https://jsdoc.app/tags-type), [`@param`](https://jsdoc.app/tags-param), [`@returns`](https://jsdoc.app/tags-returns), and [`@template`](https://jsdoc.app/tags-template) — official annotation syntax.
- [TypeScript's JSDoc reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html) — the checker semantics Semantifold's JavaScript-with-JSDoc profile should follow for arrays, objects, unions, imports, and templates.
- [Babel parser documentation](https://babeljs.io/docs/babel-parser) — parser options, attached comments, locations, TypeScript plugin, AST shape, and syntax errors.

Evidence note: JavaScript `number` covers integers and floating-point values, missing arguments become `undefined`, extra arguments are accepted at runtime, objects are dynamic, and equality/coercion differ from the other targets. The roadmap therefore requires explicit types, exact semantic call arity, closed map/record shapes, strict typed equality, and no coercive or prototype-dynamic approximation.

## TypeScript

- [Everyday types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) — primitives, arrays, object types, unions, `null`, and `undefined`.
- [Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html) — required, optional, rest, overload, and generic call signatures.
- [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), [classes](https://www.typescriptlang.org/docs/handbook/2/classes.html), and [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) — structural records, members, and type parameters.
- [Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html) and [module reference](https://www.typescriptlang.org/docs/handbook/modules/reference) — ESM syntax, type-only edges, and resolution concerns.
- [`strictNullChecks`](https://www.typescriptlang.org/tsconfig/strictNullChecks.html), [`noImplicitAny`](https://www.typescriptlang.org/tsconfig/noImplicitAny.html), and [TSConfig reference](https://www.typescriptlang.org/tsconfig/) — required strict profile evidence.

Evidence note: the repository already has `strict: true`, but Babel only parses TypeScript; it does not type-check frontend source. Each adapter task must therefore explicitly validate the supported annotation and tree shapes instead of assuming `tsc` has done so. General unions, overload resolution, conditional/mapped types, and `any` are not part of the portable slice.

## PHP and `php-parser`

- [PHP language reference](https://www.php.net/manual/en/langref.php) — official index for types, variables, expressions/operators, control, functions, classes, namespaces, and exceptions.
- [Type declarations](https://www.php.net/manual/en/language.types.declarations.php) — scalar names, nullable types, unions/intersections, and declaration constraints.
- [Arrays](https://www.php.net/manual/en/language.types.array.php) — PHP's single ordered-map runtime type and key coercions.
- [Control structures](https://www.php.net/manual/en/language.control-structures.php), [`foreach`](https://www.php.net/manual/en/control-structures.foreach.php), and [functions](https://www.php.net/manual/en/language.functions.php) — statement, iteration, and call behavior.
- [Classes and objects](https://www.php.net/manual/en/language.oop5.php), [namespace definition](https://www.php.net/manual/en/language.namespaces.definition.php), and [namespace basics](https://www.php.net/manual/en/language.namespaces.basics.php) — named structure and resolution.
- [Exceptions](https://www.php.net/manual/en/language.exceptions.php) — `Throwable`, `throw`, `try`, `catch`, and `finally`.
- [`php-parser` 3.7.0 tagged documentation](https://github.com/glayzzle/php-parser/tree/v3.7.0) and [3.7.0 release](https://github.com/glayzzle/php-parser/releases/tag/v3.7.0) — exact parser API/AST evidence.

Evidence note: PHP `array` intentionally combines list and map behavior and coerces some keys, while Semantifold must keep `ListType` and `MapType` distinct. PHP supports native nullable/union declarations but not native generic declarations. Task 012 consequently forbids silently emitting `mixed` or erasing a semantic type parameter.

## Java, JLS, and Lezer

- [JLS SE 25 index](https://docs.oracle.com/javase/specs/jls/se25/html/) — specification matching the locally observed JDK major version.
- [JLS Chapter 4: types, values, variables](https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html), [Chapter 5: conversions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html), and [Chapter 15: expressions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html) — primitive/reference/null types, assignment compatibility, operators, calls, creation, and member access.
- [JLS Chapter 8: classes](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html), [Chapter 10: arrays](https://docs.oracle.com/javase/specs/jls/se25/html/jls-10.html), and [Chapter 14: blocks/statements](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html) — declarations, records/classes, arrays, locals, branches, loops, returns, throw, and try.
- [JLS Chapter 7: packages/modules](https://docs.oracle.com/javase/specs/jls/se25/html/jls-7.html), [Chapter 11: exceptions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-11.html), and [Chapter 18: type inference](https://docs.oracle.com/javase/specs/jls/se25/html/jls-18.html) — name organization, checked exceptions, and generic inference.
- [Java 25 `List`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html), [`Map`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html), [`LinkedHashMap`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/LinkedHashMap.html), [`Collections`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html), and [`Optional`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html) — proposed standard-library mappings and ordered-map constraints.
- [`@lezer/java` 1.1.3 registry record](https://registry.npmjs.org/%40lezer%2Fjava/1.1.3), [Lezer guide](https://lezer.codemirror.net/docs/guide/), and [Lezer reference](https://lezer.codemirror.net/docs/ref/) — pinned grammar identity, recovery behavior, tree offsets, and traversal APIs.

Evidence note: Java requires boolean conditions, distinguishes primitives from references, has fixed-width numeric behavior, checks call signatures, has checked exceptions, and has nominal generic types. `Optional<T>` is the selected portable absence mapping because bare Java reference types do not declare non-nullability and the roadmap does not assume third-party annotations. Fully qualified `java.util` names avoid creating an import dependency before Task 010. The `Map` API explicitly states that the iteration order of `Map.of`, `Map.ofEntries`, and `Map.copyOf` results is unspecified and subject to change. Task 006 may therefore use those factories only for non-iterated construction, lookup, and size; Task 008 is list-only. Deferred Task 014 requires an insertion-ordered `LinkedHashMap` backing hidden behind `Collections.unmodifiableSequencedMap` (or another separately proven ordered representation) before map iteration is accepted or emitted.

## Python

- [Python language reference](https://docs.python.org/3/reference/index.html), [lexical analysis](https://docs.python.org/3/reference/lexical_analysis.html), [simple statements](https://docs.python.org/3/reference/simple_stmts.html), [compound statements and annotations](https://docs.python.org/3/reference/compound_stmts.html), and [expressions](https://docs.python.org/3/reference/expressions.html) — official syntax and runtime rules for literals, annotations, assignment, functions, conditions, calls, and operators.
- [Python typing specification](https://typing.python.org/en/latest/spec/index.html) and [`typing` documentation](https://docs.python.org/3/library/typing.html) — distinction between annotation metadata/static tooling and runtime enforcement, plus dynamic/wider type forms excluded by Task 016.
- [Python Unicode text](https://docs.python.org/3/library/stdtypes.html#text-sequence-type-str), [integer numeric types](https://docs.python.org/3/library/stdtypes.html#numeric-types-int-float-complex), and [Boolean values](https://docs.python.org/3/library/stdtypes.html#boolean-type-bool) — arbitrary-precision integers, `bool`'s runtime relationship to `int`, and Unicode string behavior.
- [`py_compile`](https://docs.python.org/3/library/py_compile.html) and [Python command-line interface](https://docs.python.org/3/using/cmdline.html) — real compiler/runtime acceptance commands.

Evidence note: Python annotations do not enforce types at runtime, conditions are truthy, `bool` is a subclass of `int`, and integers do not have the repository's safe/fixed-width boundary. Task 016 therefore parses exact `int`/`bool`/`str` annotations itself, keeps the types distinct in the IR, rejects dynamic forms and truthiness, and retains the existing safe-integer contract.

## C# and .NET

- [C# language specification](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/), especially [types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/types), [variables](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/variables), [expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions), and [statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — value/reference types, conversions, operators, calls, blocks, and control flow.
- [Nullable reference types](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references), [nullable compiler option](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language#nullable), and [integral numeric types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/integral-numeric-types) — exact nullable-analysis and signed `long` boundaries.
- [.NET project SDK overview](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview), [`dotnet restore`](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-restore), [`dotnet build`](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-build), and [`dotnet run`](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-run) — deterministic project artifact and real managed compile/runtime lane.

Evidence note: C# `long` and `bool` are value types, while `string` is a sealed immutable reference type; nullable reference annotations are compile-time metadata backed by flow warnings, not distinct runtime types. Task 017 requires a pinned SDK/target framework, nullable enabled with warnings as errors, exact scalar types, and no boxing, `dynamic`, overload, identity, or nullable approximation.

## C and Clang

- [WG14 document log](https://www.open-std.org/jtc1/sc22/wg14/www/wg14_document_log.htm) and [C23 working draft N3096](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n3096.pdf) — ISO working-group language/types/expressions/declaration/control/library evidence. The implementation task must state the exact selected C standard rather than assuming the newest draft.
- [Clang command-line reference](https://clang.llvm.org/docs/ClangCommandLineReference.html), [language compatibility](https://clang.llvm.org/compatibility.html), [diagnostics reference](https://clang.llvm.org/docs/DiagnosticsReference.html), and [UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) — compiler profile, warning/error flags, and focused native validation.
- [Tree-sitter C grammar](https://github.com/tree-sitter/tree-sitter-c) — selected parser grammar, subject to Task 015 qualification.

Evidence note: standard C exposes fixed-width types only through the implementation-provided `<stdint.h>` contract, signed overflow can be undefined, strings conventionally use NUL termination, and the language has neither exceptions nor garbage collection. Task 018 therefore selects `int64_t`, length-bearing immutable UTF-8 slices, explicit generated arena ownership/cleanup, strict Clang flags, and no pointers/preprocessor/user allocation in the source profile.

## C++ and Clang

- [ISO C++ working draft source](https://github.com/cplusplus/draft) and [WG21 papers index](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/) — working-group evidence for values, references, object lifetime, overloads, templates, exceptions, expressions, and the standard library.
- [Clang C++ language status](https://clang.llvm.org/cxx_status.html), [Clang command-line reference](https://clang.llvm.org/docs/ClangCommandLineReference.html), and [AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html) — selected standard support, compiler flags, and focused lifetime validation.
- [Tree-sitter C++ grammar](https://github.com/tree-sitter/tree-sitter-cpp) — selected parser grammar, distinct from C and subject to Task 015 qualification.

Evidence note: C++ parsing and semantics include overload resolution, templates, value categories, references, object lifetime, exceptions, and undefined behavior that cannot be inferred from C. Task 019 therefore remains a separate adapter/backend with owned `std::string` values, fixed scalar types, no source references/templates/overloads/exceptions, and a fixed build-mode-independent overflow policy.

## Rust and Cargo

- [Rust Reference](https://doc.rust-lang.org/reference/), especially [types](https://doc.rust-lang.org/reference/types.html), [expressions](https://doc.rust-lang.org/reference/expressions.html), [statements](https://doc.rust-lang.org/reference/statements.html), and [items/functions](https://doc.rust-lang.org/reference/items/functions.html) — official language structure and semantics.
- [Ownership](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html), [references and borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html), [`Result` error handling](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html), and [panic reference](https://doc.rust-lang.org/reference/panic.html) — value moves/clones/borrows and the failure boundaries Task 020 must make explicit.
- [Cargo manifest](https://doc.rust-lang.org/cargo/reference/manifest.html), [package layout](https://doc.rust-lang.org/cargo/guide/project-layout.html), [lockfile](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html), and [offline option](https://doc.rust-lang.org/cargo/commands/cargo-build.html#manifest-options) — deterministic dependency-free generated crate and real toolchain acceptance.
- [Tree-sitter Rust grammar](https://github.com/tree-sitter/tree-sitter-rust) — selected parser grammar, subject to Task 015 qualification.

Evidence note: Rust ownership can move a `String`, source references introduce lifetime/borrow meaning, debug/release overflow defaults can differ, and `Result`/panic are distinct failure mechanisms. Task 020 uses owned strings with explicit generated clones/borrows, fixed Cargo profiles, no dependencies, and rejects source ownership/failure constructs beyond the initial IR.

## WebAssembly and browser interoperability

- [WebAssembly Core Specification](https://webassembly.github.io/spec/core/), [binary format](https://webassembly.github.io/spec/core/binary/index.html), [validation](https://webassembly.github.io/spec/core/valid/index.html), and [execution](https://webassembly.github.io/spec/core/exec/index.html) — normative module, instruction, binary, validation, memory, and trap behavior.
- [WebAssembly JavaScript Interface](https://www.w3.org/TR/wasm-js-api-1/) and [Web API](https://www.w3.org/TR/wasm-web-api-1/) — standard browser compilation, instantiation, streaming, exports, memory, and error mapping.
- [MDN WebAssembly JavaScript API](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface), [`instantiateStreaming`](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiateStreaming_static), and [loading and running Wasm](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Loading_and_running) — durable browser integration and MIME/streaming behavior documentation.
- [WebAssembly tool conventions](https://github.com/WebAssembly/tool-conventions), especially [debugging/source maps](https://github.com/WebAssembly/tool-conventions/blob/main/Debugging.md) — a Wasm source map uses generated line 1 with the column as binary byte offset and a `sourceMappingURL` custom section.
- [WABT repository and command documentation](https://github.com/WebAssembly/wabt) — official `wasm-validate` implementation used as an independent installed validator, not as the production encoder.
- [Chrome Headless mode](https://developer.chrome.com/docs/chromium/headless) — official real-browser command-line lane for deterministic local HTTP acceptance.

Evidence note: core Wasm is a low-level binary instruction/module format with no ambient browser access or string type. Browser interaction is supplied through explicit imports and the JavaScript API. Task 021 is therefore target-only: an internal deterministic binary encoder, versioned imports/exports, exported memory with UTF-8 pointer/length strings, a JavaScript loader/HTML harness, byte-offset provenance, external source map/custom section, independent validation, and mandatory real headless-browser execution. It does not claim WAT or `.wasm` source normalization.

## Disposition evidence

- Boolean/string scalars, simple typed locals, explicit typed operators, structured blocks, direct required calls, immutable container construction/reads, explicit optionals, and ordered list iteration have precise mappings in every language and are the near-term slice. Portable map iteration is deferred to Task 014 because Java's convenient immutable map factories do not specify iteration order.
- Floating point is deferred because JavaScript/TypeScript `number` does not distinguish the existing semantic integer contract, and NaN, infinity, negative zero, formatting, equality, and integer/float promotion need a written cross-target contract.
- General unions are deferred because Java and Ruby runtime source do not express the same closed alternatives as TypeScript/PHP type unions; lowering to `Object`, `untyped`, or `mixed` would discard modeled meaning. Explicit optionals are handled separately.
- Records precede modules, typed errors, and generic declarations because they supply a closed nominal product and member model without committing to inheritance or dynamic object identity.
- Async/concurrency is excluded: the official language materials expose materially different promise/event-loop, thread/fiber/ractor, and JVM concurrency models. No portable cancellation, scheduling, memory, or failure contract is established here.
