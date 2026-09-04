# 001 — Portable scalar values and types

- Status: `delivered` on `master`
- Phase/priority: Phase 0 / P0
- Dependencies: none

## Objective

Add semantic `boolean` and `string` types and literals beside the existing `integer` capability, with explicit source annotations and lossless target escaping. Keep floating-point values deferred until their representation, promotion, equality, and printing rules are separately specified.

## Current evidence and gap

[`../src/semantic/types.js`](../src/semantic/types.js) defines `SemanticTypeName` as only `"integer"` and has only `IntegerLiteral`. Each frontend has a local `integerType` singleton and accepts one source spelling; each backend hard-codes its integer spelling and [`../src/backends/shared.js`](../src/backends/shared.js) rejects every other type. [`../docs/architecture.md`](../docs/architecture.md) acknowledges that JS/TS `number` is narrowed to semantic integer, and [`../spec/frontend-numeric-and-flags.spec.js`](../spec/frontend-numeric-and-flags.spec.js) protects safe-integer admission.

Boolean and string literals/types have direct representations in all five languages. Floating point does not: JS/TS `number` is also the current integer annotation, Java and PHP distinguish integral/floating declarations, and exceptional values/negative zero/formatting differ. This task must not reinterpret current `number` annotations as floating point.

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `# @param flag [bool]`, `# @return [String]`, `true`, `"yes"` | Keep the immediately adjacent annotation block. Reject `boolish`, symbols, interpolation, mutable encoding tricks, and untyped parameters. |
| JavaScript + JSDoc | `@param {boolean} flag`, `@returns {string}`, `false`, `"no"` | Continue mapping `number` to integer only. Reject template literals with substitutions, boxed `Boolean`/`String`, inferred/missing JSDoc, bigint, symbol, and regex literals. |
| TypeScript | `flag: boolean`, return `: string`, `true`, `"yes"` | Reject literal-only, enum, boxed, `any`, `unknown`, inferred, and union annotations in this task. Continue mapping `number` to integer. |
| PHP | `function label(bool $flag): string`, `true`, `"yes"` | Require exact `bool`/`string`; reject aliases such as `boolean`, coercive/missing types, interpolated strings, heredoc/nowdoc initially, and non-scalar values. |
| Java | `static String label(boolean flag)`, `true`, `"yes"` | Accept primitive `boolean` and `java.lang.String`/unqualified `String`; reject boxed `Boolean`, `char`, text blocks, `null`, and other primitive widths here. |

String semantic value is the parser-decoded Unicode string. Backends must escape that value without changing code points or creating interpolation. Source spelling, quote choice, and escapes are not preserved.

## Semantic IR, typing, and validation

- Extend `SemanticTypeName` with `boolean` and `string`; keep type references parser-neutral.
- Add location-bearing `BooleanLiteral {value: boolean}` and `StringLiteral {value: string}` expression variants.
- Centralize supported source-type-to-semantic-type conversion enough to avoid inconsistent spellings while keeping parser-specific node checks in adapters.
- Validate literal JavaScript values (`typeof`, finite string data) and type agreement for parameters, returns, identifiers, call arguments, and branch results. A minimal symbol/type environment is required; do not trust annotations without checking modeled uses.
- Preserve the existing safe-integer rule and Java signed-32-bit target validation. Document integer overflow as unresolved beyond the accepted runtime cases; do not bundle a numeric-model redesign here.
- Do not add `float`, `double`, `decimal`, `bigint`, `char`, `symbol`, `bytes`, or `void` in this task.

## Frontend work

- Prism: accept `TrueNode`, `FalseNode`, and non-interpolated `StringNode`; parse the established adjacent comment carrier with exact RBS expressions `bool` and `String` inside brackets.
- Babel JS/TS: accept `BooleanLiteral` and `StringLiteral`; extend exact JSDoc and TS keyword conversion while retaining attached-comment and async/generator checks.
- `php-parser`: accept `boolean` and non-interpolated `string` AST nodes and exact `bool`/`string` declaration identifiers.
- Lezer Java: accept `BooleanLiteral` and `StringLiteral`; recognize primitive `boolean` and `String` type nodes without accepting recovered `⚠` trees.
- Every adapter rejects interpolation/template substitutions and unmodeled literal variants at the literal/type span rather than falling through to a later shape error.

## Backend and target validation work

- Emit native `boolean`/`bool`/`boolean` and `String`/`string`/Ruby comment spellings appropriate to each target.
- Add target-specific string literal escapers. They must prevent interpolation in Ruby/PHP/JS template contexts, preserve control characters and Unicode, and never concatenate raw source fragments.
- Validate that every semantic type/literal is supported before emission and report target identifier/type restrictions at its original location.
- Keep Java's class/file contract and existing entry-point strategy. PHP boolean printing differences must not be treated as equivalent output; cross-language execution fixtures should print a returned string.

## Diagnostics and source locations

- Retain `MISSING_TYPE` for absent or unsupported explicit scalar annotations and update its integer-only message.
- Use `UNSUPPORTED_SYNTAX` for parsed but excluded literal/type forms, with the literal or annotation-owning declaration span.
- Use `UNSUPPORTED_CAPABILITY` if a backend receives a scalar type/literal it cannot emit, at the type owner or literal location.
- Add stable diagnostic detail strings for unsupported scalar type and interpolated string; tests assert code, language, filename, and start line without freezing complete prose.

## Tests and acceptance

- Add focused scalar frontend fixtures/specs that normalize equivalent boolean/string functions across all five languages after removing locations.
- Add negative specs for missing annotations, boxed types, interpolation/substitution, `boolish`, PHP aliases, Java `char`, TS/JS `bigint`, and unchanged unsafe integer rejection.
- Add backend shape/type mismatch tests and string escaping cases containing quotes, backslashes, newlines, dollar/hash characters, and non-ASCII text.
- Generate, reparse, compile/run all five targets from one semantic fixture such as a boolean-controlled string label, and assert identical string output through real `php`, `ruby`, `node`, local `tsc`+`node`, and `javac`+`java` commands.

## Documentation and changelog

Update the root README example/limitations only if the public example changes; update `docs/architecture.md` and `docs/language-support.md` with exact scalar mappings and string exclusions. Add one behavior changelog fragment.

## Non-goals

Floating point, decimal arithmetic, big integers, characters, symbols, byte strings, interpolation, template expressions, encoding conversion, truthiness, optional values, general unions, inferred public types, and source quote/escape preservation.

## Completion criteria

- Boolean/string types and literals are parser-independent, type-checked, location-bearing, and round-trip through all five targets.
- No current integer acceptance or rejection regresses.
- Every excluded scalar form fails with the correct stable diagnostic class at a useful source location.
- Focused specs and the real five-runtime execution proof pass, and user-facing support docs/changelog describe only implemented behavior.
