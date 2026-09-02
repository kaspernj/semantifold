# Language support

## Implemented subset

| Language | Exact frontend scalar types | Generated entry point |
| --- | --- | --- |
| PHP | `int`, `bool`, and `string` declarations; optional exact `declare(strict_types=1)` | `echo …, PHP_EOL` |
| Ruby | immediately associated Prism-recognized `[Integer]`, `[bool]`, and `[String]` parameter/return comments | `puts …` |
| JavaScript | JSDoc `number`, `boolean`, and `string` on synchronous, non-generator functions | `console.log(…)` |
| TypeScript | exact `number`, `boolean`, and `string` keyword annotations on synchronous, non-generator functions | `console.log(…)` |
| Java | primitive `int`/`boolean` and exact `String` or `java.lang.String`, plus a one-print `public static void main` | `System.out.println(…)` in `Main` |

Across every language, a module contains at least one function with exactly two required parameters and a scalar return. Its body is one `if`/`else`; each branch contains exactly one return. Expressions contain parameter identifiers, scalar literals, two-argument unqualified calls, or the integer operators `+`, `-`, and `>`. The `>` result and every condition are strictly boolean. Return values and call arguments must exactly match their declared scalar types. The entry point contains exactly one print.

Integer literals are restricted to JavaScript's safe integer range, `Number.MIN_SAFE_INTEGER` through `Number.MAX_SAFE_INTEGER`; Java generation additionally requires literals from `-2147483648` through `2147483647` because it emits primitive `int`. Runtime arithmetic overflow is not yet a portable guarantee.

String literals normalize to their parser-decoded Unicode scalar value. Original quotes and escapes are not retained. PHP and Ruby interpolation, JavaScript/TypeScript template substitution, Java text blocks, PHP heredoc/nowdoc, invalid source encodings, and lone surrogate values are rejected. Backends use target-specific escaping for quotes, backslashes, controls, Unicode, and interpolation introducers. Generated source reparses to the same value.

Ruby accepts exactly two required positional parameters. Optional, rest, post, keyword, keyword-rest, and block parameters remain unsupported. Its three annotation comments must form the contiguous block immediately before their function. PHP rejects every `declare` form other than one optional exact `declare(strict_types=1)`. Java calls remain unqualified and `main` may not contain ignored statements.

Backends retain narrow ASCII identifier rules and reject target reserved words for function names, parameter names, call targets, and identifier references before emission. PHP boolean printing differs from the other targets; the cross-language execution contract therefore compares a string result rather than claiming portable boolean display formatting.

## Diagnostics and limitations

`UNSUPPORTED_SYNTAX` reports parsed constructs outside the subset with the best parser-provided source location. `MISSING_TYPE` reports missing or unsupported atomic annotations and identifies integer, boolean, and string as the supported scalar set. Parser failures use `PARSE_ERROR`. Backends validate complete shape, scalar payloads, symbol/type agreement, identifiers, and target bounds before emission and report `UNSUPPORTED_CAPABILITY` rather than producing partial source.

Boxed or coercive types, inferred public types, TypeScript literal/enum/`any`/`unknown`/union types, PHP aliases/nullable declarations, Ruby `boolish`, Java `Boolean`/`char`, null values, floating point, decimal, bigint, symbols, regex values, byte strings, and interpolation are unsupported. There is no general statement/expression support, truthiness, optional-value model, async/generator model, qualified calls, classes in the semantic representation, imports, mutable bindings, loops, exceptions, overloads, generics, packages, or source-format preservation. Ruby type comments remain a small RBS-style convention rather than a full signature parser, and Java generation retains the fixed `Main.java` contract.
