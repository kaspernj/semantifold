# 011 — Typed errors and handling

- Status: `todo`
- Phase/priority: Phase 2 / P2 (conditional)
- Dependencies: [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md), [007-optional-values-and-presence-narrowing.md](007-optional-values-and-presence-narrowing.md), [009-closed-records-and-member-access.md](009-closed-records-and-member-access.md)

## Objective

Add one portable typed unchecked error declaration, construction/raise, and `try` with one typed catch binding. Preserve abrupt completion and unmatched-error propagation without approximating each language's full exception system.

## Current evidence and gap

The semantic IR models only return as abrupt completion. There is no error value/type, throw/raise, try/catch/rescue, handler binding, propagation, or finally semantics. Java checked exceptions, JavaScript arbitrary thrown values, PHP `Throwable`, and Ruby's class hierarchy/default rescue behavior are materially different. Task 009's nominal closed data provides a place for a typed error payload.

## Language matrix

This matrix records the original-five mappings researched for this conditional task. Its implementation names a required cohort and retains explicit tested rejection elsewhere; C's lack of exceptions, Rust's `Result`/panic split, and Wasm traps must never be approximated merely because those roles are registered. Task 013 remains intentionally original-five-only.

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | canonical `class ValidationError < StandardError`; `raise ValidationError, "bad"`; `begin ... rescue ValidationError => error ... end` | Require explicit rescue class/binding. Reject bare raise/re-raise, broad/default rescue, multiple rescue, retry, rescue modifiers, else/ensure, fatal exception classes, and arbitrary payloads. |
| JavaScript + JSDoc | canonical `class ValidationError extends Error`; `throw new ValidationError("bad")`; `try/catch` with generated/recognized `instanceof` guard | JS can throw anything, so require exact construction and typed guard/rethrow profile. Reject raw strings/objects, unguarded catch, multiple logical types, finally, cause/aggregate errors, and promise rejection. |
| TypeScript | same runtime profile with explicit catch narrowing | Catch variables begin unknown under strict behavior; require exact `instanceof` narrowing. Reject annotation assertions, arbitrary throws, and finally/multi-type handling. |
| PHP | `final class ValidationError extends RuntimeException`; `throw new ValidationError("bad")`; `catch (ValidationError $error)` | Reject `Throwable`/multi-catch/broad catches, Error subclasses outside profile, throw expressions in value contexts, finally, previous exceptions, and arbitrary payloads. |
| Java | `final class ValidationError extends RuntimeException`; `throw new ValidationError("bad")`; typed `catch` | Use unchecked error only and no `throws` requirement. Reject checked exceptions, multi-catch, try-with-resources, finally, suppressed exceptions, broad catches, and arbitrary throwable types. |

## Semantic IR, typing, and validation

- Add `ErrorDeclaration` as a nominal semantic declaration with at least an immutable string message field; keep it distinct from ordinary record types if propagation metadata requires it.
- Add `RaiseStatement {error}`, `TryStatement {body, catchType, catchBinding, catchBody}`, and error construction expression or a typed construction form shared with records.
- A raised expression must be the declared semantic error type. Catch matches that exact type initially; unmatched errors propagate. Catch binding is immutable and scoped to the catch block.
- Extend control-flow analysis with abrupt `raise`, handler paths, return completeness, and reachability. A caught raise may resume after the try; an uncaught raise satisfies non-normal completion.
- Define no `finally`/ensure semantics, no checked-effect list on functions, and no error union/result substitution in this task.

## Frontend work

- Recognize one canonical error class declaration shape per language, accounting for every class/body/superclass child.
- Prism: convert exact `RaiseNode`/call and `BeginNode` rescue structure, explicit class and binding only.
- Babel: convert `ThrowStatement`, `TryStatement`, catch clause, and exact `instanceof` guard/rethrow structure into one typed handler rather than preserving boilerplate as semantic statements.
- `php-parser`: convert throw/try/catch nodes with one type/binding and no finally.
- Lezer: convert `ThrowStatement` and `TryStatement`/`CatchClause`; reject try-with-resources and checked/broad types.
- No frontend may turn an arbitrary thrown target value into a semantic error or discard unmatched-handler logic.

## Backend and target validation work

- Emit canonical target error subclasses, construction, raise/throw, and typed handler. JS/TS emission includes an `instanceof` guard that rethrows unmatched values to preserve typed catch meaning.
- Validate error names, inheritance/profile support, message type, handler type/binding, and target class layout before emission.
- Preserve original evaluation order and propagation. Do not translate errors into `null`, optional values, return codes, process exit, or printed messages.
- Generated source must reparse to the semantic handler rather than expose target-only guard boilerplate as different meaning.

## Diagnostics and source locations

- Stable diagnostics cover non-error raise, unknown catch type, incompatible/duplicate handler, catch binding collision, unsupported broad/checked/arbitrary throw, and unreachable handler/body statements.
- Error declaration, raised expression, try body, catch type/binding/body retain separate locations.
- Frontend form errors use `UNSUPPORTED_SYNTAX`; semantic type/control errors use stable semantic codes; target inability uses `UNSUPPORTED_CAPABILITY`.

## Tests and acceptance

- Equivalent fixtures raise/catch one error, inspect/print its message, exercise non-throw and caught paths, and propagate an unmatched nested error to an outer exact handler.
- Negative specs cover arbitrary JS throws, unguarded/broad catches, Ruby default rescue/retry/ensure, PHP multi-catch/finally/throw expressions, Java checked/multi-catch/resources/finally, wrong payloads, and malformed error classes.
- Flow tests cover returns versus raises, statements after raise, catch scope, and malformed externally built IR.
- Generate/reparse and run every required registered target through real toolchains with exact caught/non-caught observable output (without depending on runtime stack-trace text).

## Documentation and changelog

Document exact typed unchecked semantics, canonical class forms, propagation, JS/TS guard lowering, and full exception exclusions. Add one behavior changelog fragment.

## Non-goals

Checked effects/exceptions, arbitrary thrown values, multiple/union/broad catches, finally/ensure/else, retry/rethrow, try-with-resources, suppressed/cause/stack semantics, process errors, async rejection, result types, fatal/system exceptions, and stack-trace normalization.

## Completion criteria

- One nominal error meaning, abrupt raise, exact catch, and propagation are represented and flow-validated language-neutrally.
- Canonical source profiles account for all parser children; arbitrary/broad target exception behavior is rejected.
- Generated JS/TS typed guards and all other target handlers reparse to equivalent semantics.
- Focused flow/diagnostic and real registered-runtime handling tests pass with docs/changelog updates.
