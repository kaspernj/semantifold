# Language support

## Registered roles

The immutable registry is authoritative for both dispatch and discovery. The current records are deliberately unchanged in language scope:

| ID | Frontend | Text backend | Binary backend | Application backend | Interoperability | Artifacts | Round trip | Mapping | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `php` | yes | yes | no | no | no | single | yes | rich + v3 | parse, generate, execute (`php`) |
| `ruby` | yes | yes | no | no | no | single | yes | rich + v3 | parse, generate, execute (`ruby`) |
| `javascript` | yes | yes | no | no | no | single | yes | rich + v3 | parse, generate, execute (`node`) |
| `typescript` | yes | yes | no | no | no | single | yes | rich + v3 | parse, generate, compile, execute (`tsc`, `node`) |
| `java` | yes | yes | no | no | no | single | yes | rich + v3 | parse, generate, compile, execute (`javac`, `java`) |

`languageCapabilities` exposes this information as frozen data. A role is not inferred from the presence of another role: a future browser binary target need not have a frontend, and a future interoperability bridge need not be a general backend. `supportedLanguages` remains the derived list of records with both frontend and text generation, preserving its original five values.

## Implemented subset

| Language | Exact frontend scalar types | Generated entry point |
| --- | --- | --- |
| PHP | `int`, `bool`, and `string` declarations; local `@var` carriers; optional exact `declare(strict_types=1)` | `echo …, PHP_EOL` |
| Ruby | immediately associated Prism-recognized `[Integer]`, `[bool]`, and `[String]` function/local comments | `puts …` |
| JavaScript | JSDoc `number`, `boolean`, and `string` on synchronous, non-generator functions and locals | `console.log(…)` |
| TypeScript | exact `number`, `boolean`, and `string` keyword annotations on synchronous, non-generator functions and locals | `console.log(…)` |
| Java | primitive `int`/`boolean` and exact `String` or `java.lang.String` declarations, plus a sequenced `public static void main` | `System.out.println(…)` in `Main` |

Across every language, a module contains at least one function with exactly two required parameters and a scalar return. Function bodies, entry points, and conditional branches are ordered lexical blocks. They may contain supported local declarations, plain assignments, nested conditionals, explicit returns, and prints in source order. Conditions require semantic `boolean`. An alternate is optional, and source `else if`/`elsif`/`elseif` normalizes to one nested conditional inside the alternate block. Non-void functions must explicitly return on every reachable path; an optional alternate is therefore accepted only when a later statement completes the fallthrough path. A statement following an unconditional return or an exhaustive returning conditional in the same block is unreachable and rejected. Entry points cannot return values.

Frontend conditional forms remain deliberately bounded:

- JavaScript and TypeScript accept `if` with a block or one supported statement and normalize either to `Block`; directives, switch, labels, conditional expressions, and unmodeled executable/type-only statements are rejected.
- PHP accepts braced `if`/`elseif`/`else`; alternative colon syntax, `switch`, `match`, inline HTML, and truthy conditions are rejected.
- Ruby accepts ordinary `if`/`elsif`/`else` with explicit `return`; modifier conditionals, `unless`, `case`, implicit method returns, and truthy conditions are rejected.
- Java requires braced ordinary branches while accepting a direct `else if`; switch forms, labels, assertions, synchronized blocks, local classes, and recovered grammar nodes are rejected.

Every local is an explicitly typed simple identifier with an initializer. Parameters are immutable. Initializers are checked before their new binding becomes visible; assignment right-hand expressions are checked before the target update. Exact scalar types are preserved. Lexical function, branch, and entry scopes reject duplicate declarations, use before declaration, unresolved reads/writes, assignment to immutable bindings, type mismatch, and all shadowing or repeated local spellings in this initial capability. Module function names participate in the same no-shadowing contract, so no parameter or local may capture a callable name. Destructuring, multiple/uninitialized declarations, inferred types, arbitrary lvalues, compound/update assignment, globals/fields/constants, and parameter reassignment are unsupported.

Local source profiles are exact:

- JavaScript accepts only immediately associated `/** @type {string} */`-style JSDoc followed by one initialized `let` or `const`; `let` is mutable and `const` immutable.
- TypeScript accepts one initialized `let` or `const` identifier with an exact scalar annotation.
- Java accepts one initialized explicit scalar declarator; `final` is immutable and an unmodified local is mutable.
- Ruby requires an immediately associated `# @type [String]`-style comment whose first metadata token is exactly `@type`. Profile-like misspellings such as `@typex` are malformed metadata, not declarations or ordinary comments. Ruby locals default to mutable. An immutable declaration uses the same contiguous carrier block with a separate exact `# @semantifold-immutable` line.
- PHP requires an immediately associated exact `/** @var string $name */` carrier. PHP locals default to mutable. An immutable declaration uses a docblock containing both exact tags:

```php
/**
 * @var string $name
 * @semantifold-immutable
 */
$name = "value";
```

The Ruby/PHP tags are Semantifold source-profile metadata, not native runtime immutability. Their adapters validate the exact tag shape, semantic validation rejects later writes, and generators reproduce the metadata so mutability round-trips.

Expressions contain parameter/local identifiers, scalar literals, two-argument unqualified calls, and the following typed operations. Every operation node records its result type, and identifier/call operands are resolved before an operation is selected.

| Meaning | Ruby | JavaScript / TypeScript | PHP | Java |
| --- | --- | --- | --- | --- |
| Integer add, subtract, multiply | `+`, `-`, `*` | `+`, `-`, `*` | `+`, `-`, `*` | `+`, `-`, `*` |
| Integer negate | unary `-` | unary `-` | unary `-` | unary `-` |
| Boolean not, short-circuit and/or | `!`, `&&`, `\|\|` | `!`, `&&`, `\|\|` | `!`, `&&`, `\|\|` | `!`, `&&`, `\|\|` |
| Same-type scalar equality/inequality | `==`, `!=` | `===`, `!==` | `===`, `!==` | `==`, `!=` for integer/Boolean; `.equals` and `!…equals` for strings |
| Integer ordering | `<`, `<=`, `>`, `>=` | `<`, `<=`, `>`, `>=` | `<`, `<=`, `>`, `>=` | `<`, `<=`, `>`, `>=` |
| String concatenation | `+` | `+` | `.` | `+` |

Operands evaluate left to right, and Boolean and/or short-circuit. Conditions require semantic `boolean`; Ruby, PHP, and JavaScript truthiness is not normalized. Equality is scalar value equality only, requires matching operand types, and never coerces. Java reference `==`/`!=` on strings is rejected; generated Java uses `.equals`. Return values, call arguments, initializers, assignments, and explicit operation result types must exactly match their declared scalar types. Generated operations are parenthesized so reparsing preserves the expression tree rather than relying on coincident target precedence.

Integer literals are restricted to JavaScript's safe integer range, `Number.MIN_SAFE_INTEGER` through `Number.MAX_SAFE_INTEGER`, and semantic integers have one unsigned mathematical zero. JavaScript and TypeScript can form IEEE-754 `-0` through negation or multiplication, so generated modules containing either operation stringify their scalar print argument to render both zero signs as `0`; the parser recognizes and removes only this exact entry-point scaffold during reparse. Supported operations cannot otherwise observe a zero sign, and the semantic expression tree is neither rewritten nor folded. Java generation additionally requires primitive-`int` literals and rejects compile-time-known add/subtract/multiply/negate results outside `-2147483648` through `2147483647`. This validation uses exact arithmetic without replacing the semantic expression tree. Runtime arithmetic overflow for non-literal expressions is not a portable guarantee.

String literals normalize to their parser-decoded Unicode scalar value. Original quotes and escapes are not retained. PHP and Ruby interpolation, JavaScript/TypeScript template substitution, Java text blocks, PHP heredoc/nowdoc, invalid source encodings, and lone surrogate values are rejected. Backends use target-specific escaping for quotes, backslashes, controls, Unicode, and interpolation introducers. Generated source reparses to the same value.

Ruby accepts exactly two required positional parameters. Optional, rest, post, keyword, keyword-rest, and block parameters remain unsupported. Its three annotation comments must form the contiguous block immediately before their function. PHP rejects every `declare` form other than one optional exact `declare(strict_types=1)`. Java calls remain unqualified and `main` may not contain ignored statements.

Backends retain narrow ASCII identifier rules and reject target reserved words for function names, parameter names, local declarations, assignment targets, call targets, and identifier references before emission. Bindings are never renamed. TypeScript rejects `arguments` and `eval` for function, parameter, local-declaration, and assignment-target bindings because generated modules are strict mode. PHP rejects exact `GLOBALS`, `_SERVER`, `_GET`, `_POST`, `_FILES`, `_COOKIE`, `_SESSION`, `_REQUEST`, `_ENV`, and `this` parameter bindings; only exact `GLOBALS` and `this` are also rejected for local declarations and assignment targets. PHP function/call names, lowercase near-collisions, assignable non-`GLOBALS` superglobals, and ordinary predefined variables retain their legal roles. Ruby rejects exact `_1` through `_9` function, parameter, local-declaration, and assignment-target bindings while retaining `_10`; references and callees keep their general target identifier policy. JavaScript and other targets retain their own identifier policies. Names owned by generated scaffolding are role-specific: entry locals cannot be `console` in JavaScript/TypeScript or `args`/`System` in Java; function parameters and locals cannot be the generated print receiver `console` in JavaScript/TypeScript or `System` in Java; and module functions cannot be `console` in JavaScript/TypeScript or `puts` in Ruby. Ruby locals named `puts` and PHP locals named `PHP_EOL` remain valid because the generated print forms do not resolve them as local bindings. Java method names and PHP function names occupy namespaces that do not capture their entry scaffolding. PHP boolean printing differs from the other targets; the cross-language execution contract therefore compares a string result rather than claiming portable boolean display formatting.

## Diagnostics and limitations

All five frontends preserve exact input content and parser-backed semantic token ranges in module provenance. All 25 input-to-output combinations produce range-based rich maps and Source Map v3 sidecars with UTF-16 coordinates and symbol names. Output code uses LF deterministically. Only JavaScript and TypeScript may opt into inline or external `sourceMappingURL` directives; other targets consume sidecars through Semantifold APIs. Mapping does not imply lossless formatting or support for syntax outside the semantic subset. See [source provenance and mappings](source-maps.md).

`UNSUPPORTED_LANGUAGE` is exclusive to unknown or misspelled IDs. `UNSUPPORTED_ROLE` reports a known ID without the requested frontend, text/binary/application backend, artifact, or interoperability role. `UNSUPPORTED_CAPABILITY` reports a role that exists but cannot represent the requested semantic module or target feature. `UNSUPPORTED_SYNTAX` reports parsed constructs outside the subset with the best parser-provided source location. `MISSING_TYPE` reports missing or unsupported atomic annotations and identifies integer, boolean, and string as the supported scalar set. Parser failures use `PARSE_ERROR`. Semantic resolution/type failures use `DUPLICATE_BINDING`, `UNRESOLVED_BINDING`, `USE_BEFORE_DECLARATION`, `IMMUTABLE_ASSIGNMENT`, and `TYPE_MISMATCH`; flow failures use `NON_BOOLEAN_CONDITION`, `MISSING_RETURN`, `UNREACHABLE_STATEMENT`, `ILLEGAL_RETURN_CONTEXT`, and `UNSUPPORTED_STATEMENT`. Backends validate complete recursive block shape, flow, scalar payloads, binding/type agreement, mutability, identifiers, target bounds, and Java's fixed `Main.java` artifact basename before emission. Missing or structurally invalid blocks, statement arrays/elements, declaration names, mutability, type references, initializers, assignment targets/names, assigned expressions, conditional branches, and call-expression fields in caller-supplied IR use their nearest owning node location and report `UNSUPPORTED_CAPABILITY` rather than leaking a native error or producing partial source. A non-`Main.java` Java basename uses the same located capability diagnostic contract. Artifact-set generation accepts only the explicit `text`, `binary`, and `application` backend-role strings; any other value reports `INVALID_ARTIFACT_SET` without coercing caller input, while a valid role absent from a known registry record reports `UNSUPPORTED_ROLE`. Invalid registry, artifact-set, byte-map, discovery, and runner inputs have their own normalized diagnostics rather than leaking native type or subprocess errors.

Boxed or coercive types, inferred public types, TypeScript literal/enum/`any`/`unknown`/union types, PHP aliases/nullable declarations, Ruby `boolish`, Java `Boolean`/`char`, null values, floating point, decimal, bigint, symbols, regex values, byte strings, and interpolation are unsupported. Division, remainder, exponentiation, bitwise/shift/update/compound operations, Ruby/PHP `and`/`or`, loose equality, ternary/nullish forms, optional/safe navigation, ranges, casts/assertions, collection/object equality, operator overloading, implicit coercion, and constant folding are also excluded. There is no truthiness, implicit-return or statement-value model, void call statement (roadmap task 005), optional-value model, async/generator model, qualified calls other than Java string `.equals`, classes in the semantic representation, imports, loops, switches, exceptions, overloads, generics, packages, or source-format preservation. Ruby type comments remain a bounded RBS-style convention rather than a full signature parser, and Java generation retains the fixed `Main.java` contract.
