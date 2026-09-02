# 003 — Typed operators and richer expressions

- Status: `todo`
- Phase/priority: Phase 0 / P0
- Dependencies: [001-portable-scalar-values-and-types.md](001-portable-scalar-values-and-types.md)

## Objective

Replace the untyped three-symbol binary expression subset with type-directed semantic operations for portable integer arithmetic, scalar comparison/equality, boolean logic, unary operations, and string concatenation, while preserving left-to-right evaluation and rejecting coercive or target-divergent operators.

## Current evidence and gap

[`../src/semantic/types.js`](../src/semantic/types.js) stores source-like `">" | "-" | "+"` on `BinaryExpression` without an expression result type. Every frontend matches only those parser operators. [`../src/backends/shared.js`](../src/backends/shared.js) emits the stored symbol directly, which cannot work for PHP string concatenation and cannot express Java string value equality. Current validation recursively checks shape but not operand types, boolean conditions, call signatures, or identifier resolution.

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | `-count`, `left * right`, `a == b`, `ready && valid`, `first + last` for strings | Accept only operands whose explicit types select the semantic operation. Reject truthy non-booleans, `and`/`or` precedence variants, operator overloading on objects, `/`, `%`, `**`, ranges, and safe-navigation. |
| JavaScript + JSDoc | `-count`, `a * b`, `a === b`, `ready && valid`, `first + last` | Require strict `===`/`!==`; reject coercive `==`/`!=`, implicit string/number coercion, `&&` value-return idioms, bitwise numeric coercion, division/remainder, optional chaining, and update operators. |
| TypeScript | Same operators with explicitly typed operands | Babel parsing does not replace semantic type validation. Reject `any`/`unknown`, assertions, enums, overloaded object operators, division/remainder, and nullish operators here. |
| PHP | `-$count`, `$a * $b`, `$a === $b`, `$ready && $valid`, `$first . $last` | Map `.` to semantic string concatenation; reject loose `==`/`!=`, `and`/`or`, numeric-string coercion, `<=>`, division/remainder, concatenation assignment, and suppression operator. |
| Java | `-count`, `a * b`, `a == b`, `ready && valid`, `first + last` | Map string equality to `.equals` in generated Java while accepting supported source `.equals` form; reject reference `==`, division/remainder, overflow-dependent cases, boxing/coercion, shifts, and ternary here. |

## Semantic IR, typing, and validation

- Replace raw operator intent with closed semantic operations such as `IntegerAdd`, `IntegerSubtract`, `IntegerMultiply`, `IntegerNegate`, `BooleanNot`, `BooleanAnd`, `BooleanOr`, `ScalarEqual`, `ScalarNotEqual`, ordered integer comparisons, and `StringConcat`.
- Either use distinct discriminated expression nodes or an `operation` discriminator plus an explicit result `type`; do not let backend emitters infer meaning from a source symbol.
- Type-check operands and results through resolved identifiers/calls. Boolean operations and conditional consumers require semantic boolean, even in truthy Ruby/PHP/JS.
- Define short-circuit semantics for boolean `and`/`or` and left-to-right evaluation for all operands. Backends must use constructs with the same order.
- Define equality only for operands of the same supported scalar type. It is value equality, not object identity or coercive equality.
- Keep integer `/`, `%`, exponentiation, shifts/bitwise operations, increment/decrement, ternary/null-coalescing, and floating operators excluded. Their negative, overflow, coercion, or evaluation semantics are not portable by symbol substitution.

## Frontend work

- Extend Prism `CallNode` operator recognition and exact node/receiver/argument cardinality; distinguish unary from binary calls and reject redefined-object operator cases when operand types are not supported scalars.
- Extend Babel `UnaryExpression`, `BinaryExpression`, and `LogicalExpression` conversion. Require strict equality source spelling in JS/TS and use semantic operand types to distinguish integer addition from string concatenation.
- Extend `php-parser` unary/bin nodes, mapping `.` separately and refusing loose comparisons.
- Extend Lezer `UnaryExpression`, `BinaryExpression`, and supported `MethodInvocation` for string equality; check structural children rather than text parsing.
- Preserve nested expression locations and reject unsupported operands at the smallest parser-provided span.

## Backend and target validation work

- Emit target-specific symbols/methods by semantic operation: PHP `.` for concatenation, Java `.equals` for strings, strict equality where available, and native short-circuit boolean operators.
- Parenthesize conservatively so generated precedence cannot change the semantic tree; reparsing must reconstruct the same operations.
- Validate operation/type pairs exhaustively before emission. An unknown operation or target inability raises `UNSUPPORTED_CAPABILITY`, never a default operator string.
- Retain Java integer literal bounds and add documented rejection for compile-time-known operations outside the selected accepted range. Do not promise general overflow equivalence in this task.

## Diagnostics and source locations

- Stable semantic diagnostics distinguish unsupported operator syntax, invalid operand type, mismatched equality types, and non-boolean condition.
- Source-form exclusions are `UNSUPPORTED_SYNTAX` at the operator expression. Type errors point to the offending operand where possible.
- Backend unsupported operations are `UNSUPPORTED_CAPABILITY` at the semantic operation's location.
- Tests assert nested operand/operator locations survive conversion and are used after cross-language generation requests.

## Tests and acceptance

- Add table-driven frontend specs for every accepted operation in all five parser trees and normalized result types.
- Negative coverage includes JS/PHP loose equality, truthy operands, mixed scalar addition, Java reference equality, unsupported division/remainder/bitwise/update/ternary forms, and malformed parser children.
- Backend specs exercise target-specific concatenation and string equality emission, short-circuit behavior with a side-effect-free observable call sequence, and exhaustive unknown-operation rejection.
- Generate/reparse and compile/run real five-language fixtures whose output proves arithmetic, ordered comparisons, boolean logic, scalar equality, and string concatenation agree.

## Documentation and changelog

Document the semantic-operation table, strict boolean/equality policy, target spellings, integer caveat, and excluded operators in architecture/language-support docs. Add one behavior changelog fragment.

## Non-goals

Floating arithmetic, division, remainder/modulo, exponentiation, bitwise/shift/update/compound operators, ternary/null-coalescing, regular-expression matching, collection/object equality, operator overloading, implicit coercion, truthiness, casts/assertions, and constant folding.

## Completion criteria

- Every accepted operator has a single typed semantic meaning and an exhaustive five-target mapping.
- Invalid operand/coercive forms fail at their source spans, and unsupported IR fails before emission.
- Precedence/evaluation order survives semantic and generated round trips.
- Focused tests and real five-runtime exact-behavior tests pass with updated documentation/changelog.
