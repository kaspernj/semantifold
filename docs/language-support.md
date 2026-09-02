# Language support

## Implemented subset

| Language | Frontend types | Generated entry point |
| --- | --- | --- |
| PHP | `int` parameter and return declarations; optional exact `declare(strict_types=1)` | `echo …, PHP_EOL` |
| Ruby | immediately associated Prism-recognized `# @param name [Integer]` and `# @return [Integer]` block | `puts …` |
| JavaScript | JSDoc `@param {number}` and `@returns {number}` on synchronous, non-generator functions | `console.log(…)` |
| TypeScript | `number` annotations on synchronous, non-generator functions | `console.log(…)` |
| Java | static methods with primitive `int`, plus a one-print `public static void main` | `System.out.println(…)` in `Main` |

Across every language, a module currently contains at least one function with exactly two integer parameters and an integer return. Its body is one comparison-backed `if`/`else`; each branch contains exactly one return whose expression is composed of identifiers, safe integer literals, two-argument calls, `+`, or `-`. The entry point contains exactly one print. The five checked-in fixtures normalize to equivalent meaning and every backend output reparses equivalently.

All semantic integer literals are restricted to JavaScript's safe integer range, `Number.MIN_SAFE_INTEGER` through `Number.MAX_SAFE_INTEGER`; literals are rejected before a lossy conversion can enter the semantic tree. The Java backend additionally requires `-2147483648` through `2147483647` because it emits primitive `int`.

Ruby accepts exactly two required positional parameters. Optional, rest, post, keyword, keyword-rest, and block parameters are unsupported. Its three annotation comments must form the contiguous block immediately before their function, with no blank line or intervening source. PHP rejects every `declare` form other than one optional exact `declare(strict_types=1)`. Java calls in semantic expressions must be unqualified, every argument must itself be supported, and `main` may not contain ignored extra statements.

Backends accept a deliberately narrow ASCII identifier spelling appropriate to their target and reject target reserved words. Validation covers function names, parameter names, call targets, and identifier references before any source is emitted. This means source-valid names can still raise `UNSUPPORTED_CAPABILITY` when they are invalid in the requested target.

## Diagnostics and limitations

`UNSUPPORTED_SYNTAX` reports parsed constructs outside that subset with the best parser-provided source location. `MISSING_TYPE` reports absent or unsupported annotations. Parser failures use `PARSE_ERROR`. Backends validate before emission and report `UNSUPPORTED_CAPABILITY` rather than producing partial source.

There is no general statement/expression support, type inference beyond JS JSDoc normalization, floating-point model, async/generator semantic model, qualified-call model, classes in the semantic representation, imports, mutable bindings, loops, exceptions, overloads, generics, packages, or source-format preservation. Ruby type comments are a deliberately small RBS-style convention, not a full RBS or YARD implementation. Java currently emits the fixed public class/file contract `Main.java`.
