# 004 — Statement sequencing and general conditionals

- Status: `todo`
- Phase/priority: Phase 0 / P0
- Dependencies: [002-local-declarations-and-assignment.md](002-local-declarations-and-assignment.md), [003-typed-operators-and-expressions.md](003-typed-operators-and-expressions.md)

## Objective

Generalize function and entry-point bodies into ordered semantic blocks containing supported statements, allow nested `if` statements with optional `else` and multi-statement branches, and validate boolean conditions, reachability, and return completeness without forcing the original fixture shape.

## Current evidence and gap

[`../src/semantic/types.js`](../src/semantic/types.js) gives `IfStatement` only return-statement arrays and gives `EntryPoint` only print statements. [`../src/semantic/validate.js`](../src/semantic/validate.js) and [`../src/backends/shared.js`](../src/backends/shared.js) enforce exactly one function `if`, exactly one return per branch, and exactly one entry print. Each emitter indexes `[0]`, so malformed or richer blocks cannot be represented safely. Language-specific specs protect against silently ignored statements.

## Language matrix

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | sequential assignments/prints; nested `if ... elsif ... else ... end` | Normalize `elsif` as nested alternate `if`. Require semantic boolean despite Ruby truthiness. Reject modifier conditionals, `unless`, `case`, implicit method return, and branch values as expressions. |
| JavaScript + JSDoc | blocks with multiple statements; `if`, `else if`, optional `else` | Require braces for generated source; frontend may accept a single supported statement but normalizes to a block. Reject switch, labeled statements, conditional expressions, ASI-dependent ambiguous forms, and top-level return. |
| TypeScript | same supported statement/block forms as JavaScript | Reject type-only statements inside executable blocks, narrowing constructs not modeled, switch, and conditional expressions. |
| PHP | sequential statements and braced `if`/`elseif`/`else` | Normalize `elseif` to nested alternate. Reject alternative colon syntax initially, switch/match, inline HTML, and truthy conditions. |
| Java | braced blocks, nested `if`/`else if`, multiple statements | Require blocks in the supported profile. Reject switch statement/expression, labels, assertions, synchronized blocks, local classes, and recovered grammar nodes. |

## Semantic IR, typing, and validation

- Add a location-bearing `Block` containing ordered `Statement[]`; use it for function bodies, entry point, conditional branches, and later loop/try bodies.
- Generalize `Statement` to include return, print, local declaration, assignment, conditional, and deliberately supported expression statements. Calls may be expression statements only when Task 005 supports a `void` result.
- Make `IfStatement.alternate` either a `Block` or absent. Represent `else if` as an alternate block containing one `IfStatement`; do not add language-spelled `elsif` nodes.
- Require semantic boolean conditions using Task 003 types.
- Implement conservative control-flow validation: no statements after an unconditional return in the same block; non-void functions must return on every reachable path; entry points cannot return a value. Empty blocks and optional `else` are allowed only where return completeness remains valid.
- Preserve source order and exact evaluation order. Do not flatten nested blocks when that would change scope.

## Frontend work

- Refactor each adapter from dedicated `convertReturnBlock`/single-body checks to exhaustive `convertBlock` and `convertStatement` dispatch.
- Prism: distinguish `StatementsNode`, nested `IfNode`/`ElseNode`, explicit `ReturnNode`, local writes, and `puts`; do not infer implicit final-expression returns.
- Babel: traverse `BlockStatement.body` and supported single substatements; reject directives and every unhandled statement node rather than filtering.
- `php-parser`: traverse block children including `if`, `return`, echo, declarations, and assignments; reject noops only where explicitly harmless and documented.
- Lezer: traverse direct structural block children in order; never use descendant collection where it could hoist nested statements.

## Backend and target validation work

- Replace branch index access with recursive block/statement emitters and exhaustive pre-emission validation.
- Emit braces/indentation or Ruby `end` structure without relying on source formatting. Preserve lexical scopes.
- Validate that every target supports every nested statement and that Java/PHP/Ruby syntax forms remain independently executable.
- Backend validation rechecks return completeness and statement kinds for externally constructed semantic modules; emitters never discover bad shape through missing properties.

## Diagnostics and source locations

- Add stable semantic diagnostics for non-boolean condition, missing return, unreachable statement, illegal return context, and unsupported statement kind.
- Frontend exclusions use `UNSUPPORTED_SYNTAX` at the exact unhandled statement/branch form. Semantic flow errors use the branch/function or unreachable statement location.
- Backend shape/capability errors use `UNSUPPORTED_CAPABILITY` at the offending semantic block/statement.
- Blocks, conditionals, conditions, and each statement retain separate normalized locations.

## Tests and acceptance

- Focused equivalence fixtures include declarations, assignments, nested conditionals, optional `else` in a void/entry context, multiple prints, and multiple returns across exhaustive branches.
- Negative specs cover truthy non-booleans in dynamic languages, missing return paths, unreachable statements, implicit Ruby returns, switch/match/case/unless/modifier syntax, directives, local classes, and ignored nested parser children.
- Backend tests construct malformed blocks to prove validation precedes all emitters.
- Generated source reparses to equivalent nested blocks and compiles/runs in all five real toolchains with exact multi-line output and branch behavior.

## Documentation and changelog

Update architecture diagrams/prose for `Block` and flow validation; update language-support accepted/rejected conditional forms and entry sequencing. Add one behavior changelog fragment.

## Non-goals

Switch/match/case, conditional expressions, pattern matching, loops, breaks/continues, exceptions, defer/ensure/finally, labels/goto, implicit returns, statement values, arbitrary top-level declarations, and advanced data-flow narrowing.

## Completion criteria

- Function, entry, and nested branch blocks hold ordered exhaustive statements with lexical scope preserved.
- Boolean and return-completeness validation is language-neutral and also protects external semantic modules before generation.
- Every parser rejects unhandled statement children at their own locations.
- Focused flow/diagnostic specs and five-runtime round-trip execution pass with documentation/changelog updates.
