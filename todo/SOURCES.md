# Roadmap research sources

Access date for every external source below: **2026-09-02**.

## Repository baseline and inspected evidence

- Exact baseline: `9e85016b927040f8b2a056ad4136ae3c5fa6fae7` (`docs/language-feature-todos`, identical to merged `master` when this roadmap was researched).
- Product scope and documentation: [`../README.md`](../README.md), [`../docs/goals.md`](../docs/goals.md), [`../docs/architecture.md`](../docs/architecture.md), [`../docs/language-support.md`](../docs/language-support.md), [`../docs/testing.md`](../docs/testing.md), and [`../docs/plans/2026-09-02-initial-toolchain.md`](../docs/plans/2026-09-02-initial-toolchain.md).
- Public/semantic boundary: [`../index.js`](../index.js), [`../src/semantic/types.js`](../src/semantic/types.js), [`../src/semantic/validate.js`](../src/semantic/validate.js), [`../src/semantic/location.js`](../src/semantic/location.js), and [`../src/diagnostic.js`](../src/diagnostic.js).
- Parser adapters: [`../src/frontends/javascript-typescript.js`](../src/frontends/javascript-typescript.js), [`../src/frontends/php.js`](../src/frontends/php.js), [`../src/frontends/ruby.js`](../src/frontends/ruby.js), and [`../src/frontends/java.js`](../src/frontends/java.js).
- Backend capability and emission: [`../src/backends/shared.js`](../src/backends/shared.js), [`../src/backends/identifiers.js`](../src/backends/identifiers.js), and all five emitters in [`../src/backends/`](../src/backends/).
- Fixtures/specs: all files in [`../spec/fixtures/`](../spec/fixtures/) and [`../spec/`](../spec/), especially frontend equivalence, numeric/flag rejection, language-specific frontend validation, backend execution, identifier/shape validation, diagnostics, and repository contracts.
- Packaging/tooling: [`../package.json`](../package.json), [`../package-lock.json`](../package-lock.json), [`../tsconfig.json`](../tsconfig.json), [`../Dockerfile`](../Dockerfile), [`../compose.yml`](../compose.yml), and [`../tensorbuzz.yml`](../tensorbuzz.yml).

Evidence note: the baseline semantic schema has only `integer`, four expression variants, two function-statement variants, exact two-parameter/two-argument checks, one `if` with one return per branch, and one entry print. Frontends enumerate or structurally select the accepted parser children; backend validation separately enforces shape, identifiers, safe literals, and Java `int` range.

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

## Disposition evidence

- Boolean/string scalars, simple typed locals, explicit typed operators, structured blocks, direct required calls, immutable container construction/reads, explicit optionals, and ordered list iteration have precise mappings in every language and are the near-term slice. Portable map iteration is deferred to Task 014 because Java's convenient immutable map factories do not specify iteration order.
- Floating point is deferred because JavaScript/TypeScript `number` does not distinguish the existing semantic integer contract, and NaN, infinity, negative zero, formatting, equality, and integer/float promotion need a written cross-target contract.
- General unions are deferred because Java and Ruby runtime source do not express the same closed alternatives as TypeScript/PHP type unions; lowering to `Object`, `untyped`, or `mixed` would discard modeled meaning. Explicit optionals are handled separately.
- Records precede modules, typed errors, and generic declarations because they supply a closed nominal product and member model without committing to inheritance or dynamic object identity.
- Async/concurrency is excluded: the official language materials expose materially different promise/event-loop, thread/fiber/ractor, and JVM concurrency models. No portable cancellation, scheduling, memory, or failure contract is established here.
