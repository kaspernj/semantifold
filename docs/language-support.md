# Language support

## Implemented subset

| Language | Exact frontend scalar types | Generated entry point |
| --- | --- | --- |
| PHP | `int`, `bool`, and `string` declarations; local `@var` carriers; optional exact `declare(strict_types=1)` | `echo …, PHP_EOL` |
| Ruby | immediately associated Prism-recognized `[Integer]`, `[bool]`, and `[String]` function/local comments | `puts …` |
| JavaScript | JSDoc `number`, `boolean`, and `string` on synchronous, non-generator functions and locals | `console.log(…)` |
| TypeScript | exact `number`, `boolean`, and `string` keyword annotations on synchronous, non-generator functions and locals | `console.log(…)` |
| Java | primitive `int`/`boolean` and exact `String` or `java.lang.String` declarations, plus a one-print `public static void main` | `System.out.println(…)` in `Main` |

Across every language, a module contains at least one function with exactly two required parameters and a scalar return. A function body is zero or more local declarations/plain assignments followed by one terminal `if`/`else`; each branch is the same restricted local prefix followed by one terminal return. The entry point is a local prefix followed by one terminal print. This is not the general block sequencing, nesting, reachability, or conditional relaxation reserved for roadmap task 004.

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

Expressions contain parameter/local identifiers, scalar literals, two-argument unqualified calls, or the integer operators `+`, `-`, and `>`. The `>` result and every condition are strictly boolean. Return values, call arguments, initializers, and assignments must exactly match their declared scalar types.

Integer literals are restricted to JavaScript's safe integer range, `Number.MIN_SAFE_INTEGER` through `Number.MAX_SAFE_INTEGER`; Java generation additionally requires literals from `-2147483648` through `2147483647` because it emits primitive `int`. Runtime arithmetic overflow is not yet a portable guarantee.

String literals normalize to their parser-decoded Unicode scalar value. Original quotes and escapes are not retained. PHP and Ruby interpolation, JavaScript/TypeScript template substitution, Java text blocks, PHP heredoc/nowdoc, invalid source encodings, and lone surrogate values are rejected. Backends use target-specific escaping for quotes, backslashes, controls, Unicode, and interpolation introducers. Generated source reparses to the same value.

Ruby accepts exactly two required positional parameters. Optional, rest, post, keyword, keyword-rest, and block parameters remain unsupported. Its three annotation comments must form the contiguous block immediately before their function. PHP rejects every `declare` form other than one optional exact `declare(strict_types=1)`. Java calls remain unqualified and `main` may not contain ignored statements.

Backends retain narrow ASCII identifier rules and reject target reserved words for function names, parameter names, local declarations, assignment targets, call targets, and identifier references before emission. Bindings are never renamed. TypeScript rejects `arguments` and `eval` for function, parameter, local-declaration, and assignment-target bindings because generated modules are strict mode. PHP rejects exact `GLOBALS`, `_SERVER`, `_GET`, `_POST`, `_FILES`, `_COOKIE`, `_SESSION`, `_REQUEST`, `_ENV`, and `this` parameter bindings; only exact `GLOBALS` and `this` are also rejected for local declarations and assignment targets. PHP function/call names, lowercase near-collisions, assignable non-`GLOBALS` superglobals, and ordinary predefined variables retain their legal roles. Ruby rejects exact `_1` through `_9` function, parameter, local-declaration, and assignment-target bindings while retaining `_10`; references and callees keep their general target identifier policy. JavaScript and other targets retain their own identifier policies. Names owned by generated entry scaffolding are role-specific: entry locals cannot be `console` in JavaScript/TypeScript or `args`/`System` in Java, while module functions cannot be `console` in JavaScript/TypeScript or `puts` in Ruby. Ruby locals named `puts` and PHP locals named `PHP_EOL` remain valid because the generated print forms do not resolve them as local bindings. Java method names and PHP function names occupy namespaces that do not capture their entry scaffolding. PHP boolean printing differs from the other targets; the cross-language execution contract therefore compares a string result rather than claiming portable boolean display formatting.

## Diagnostics and limitations

`UNSUPPORTED_SYNTAX` reports parsed constructs outside the subset with the best parser-provided source location. `MISSING_TYPE` reports missing or unsupported atomic annotations and identifies integer, boolean, and string as the supported scalar set. Parser failures use `PARSE_ERROR`. Semantic resolution/type failures use `DUPLICATE_BINDING`, `UNRESOLVED_BINDING`, `USE_BEFORE_DECLARATION`, `IMMUTABLE_ASSIGNMENT`, and `TYPE_MISMATCH`. Backends validate complete shape, scalar payloads, binding/type agreement, mutability, identifiers, and target bounds before emission. Missing or structurally invalid task-002 statement lists, prefix elements, declaration names, mutability, type references, initializers, assignment targets/names, assigned expressions, and call-expression fields in caller-supplied IR use their nearest owning node location and report `UNSUPPORTED_CAPABILITY` rather than leaking a native error or producing partial source.

Boxed or coercive types, inferred public types, TypeScript literal/enum/`any`/`unknown`/union types, PHP aliases/nullable declarations, Ruby `boolish`, Java `Boolean`/`char`, null values, floating point, decimal, bigint, symbols, regex values, byte strings, and interpolation are unsupported. There is no general statement/expression support, truthiness, optional-value model, async/generator model, qualified calls, classes in the semantic representation, imports, loops, exceptions, overloads, generics, packages, or source-format preservation. Ruby type comments remain a bounded RBS-style convention rather than a full signature parser, and Java generation retains the fixed `Main.java` contract.
