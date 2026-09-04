# 005 — General required function signatures and calls

- Status: `todo`
- Phase/priority: Phase 1 / P1
- Dependencies: [001-portable-scalar-values-and-types.md](001-portable-scalar-values-and-types.md), [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md), [021-browser-webassembly-target.md](021-browser-webassembly-target.md)

## Objective

Support named synchronous top-level functions with zero or more required positional parameters, exact direct calls of matching arity/types, and explicit value or `void` returns. Resolve call targets semantically instead of carrying only an unchecked callee string.

## Current evidence and gap

[`../src/semantic/validate.js`](../src/semantic/validate.js) and [`../src/backends/shared.js`](../src/backends/shared.js) hard-code two parameters and two call arguments. `CallExpression.callee` in [`../src/semantic/types.js`](../src/semantic/types.js) is a string with no declaration link or signature checking. The frontends already collect multiple top-level functions, but do not reject duplicate names or unresolved/mistyped calls. JS/TS async/generators and Ruby non-required parameters are explicitly rejected by current specs.

## Language matrix

This matrix records the original-five mappings researched for this task. Because Tasks 015–021 are prerequisites, implementation must extend the matrix and focused acceptance to Python, C#, C, C++, and Rust frontends/backends plus the browser Wasm backend. A registered role is either implemented for this capability or has an explicit documented and tested capability rejection; Task 013 remains the original-five aggregate regression gate.

| Language | Representative accepted source | Required constraint/rejection |
| --- | --- | --- |
| Ruby | adjacent typed comments; `def greet(name)` and `greet("Ada")`; `# @return [void]` plus explicit `return`/fallthrough for void | Accept only required positional parameters. Reject optional/rest/post/keyword/block parameters, receiver calls, implicit value returns, blocks, singleton methods, and dynamic dispatch. |
| JavaScript + JSDoc | typed `function ping() { ... }`, `function label(value)`, exact direct calls | Require JSDoc for every parameter and return (`void` allowed). Reject arrow/function expressions, defaults/rest/destructuring, async/generator, optional calls, methods/receivers, spread, `new`, and extra/missing runtime arguments. |
| TypeScript | `function ping(): void`, `function label(value: string): string` | Reject optional/default/rest parameters, overload signatures, generics, methods, callbacks/higher-order functions, inferred return types, and spread arguments. |
| PHP | `function ping(): void`, exact direct call | Reject defaults, variadics, named/unpacked/by-reference arguments/parameters/returns, methods, dynamic/qualified calls, and missing explicit types. |
| Java | supported `static` methods with explicit types; exact unqualified call | Reject overload sets, instance methods/receivers, varargs, generic methods, constructors, qualified/static-import ambiguity, checked throws, and non-static semantic functions. |

## Semantic IR, typing, and validation

- Add semantic `void` only as a function return type; it is not a value, parameter type, variable type, collection element, or union member.
- Permit `Parameter[]` and `CallExpression.arguments` of arbitrary length, including zero.
- Add `ReturnStatement.expression: Expression | undefined`; require a value exactly for non-void functions and forbid one for void functions. Void functions may fall through the end.
- Introduce module symbol resolution: unique function declarations by semantic name, call target binding to a declaration identity/signature, exact argument count, positional type compatibility, and return type propagation.
- Allow direct recursion only after all module function signatures are collected; reject duplicate names and unresolved callees. Mutual recursion may be accepted if complete signature collection makes it unambiguous.
- A void call is valid only as an `ExpressionStatement`; it cannot appear in a value expression, print, initializer, argument, or return value.

## Frontend work

- Remove exact-two checks only after each adapter exhaustively converts every parameter and argument form.
- Prism: keep required positional `RequiredParameterNode` only; require one associated type per name and exact return comment including `void`.
- Babel: accept only identifiers without optional/default/rest syntax, retain flags rejection, and convert direct identifier calls without spread/placeholders.
- `php-parser`: inspect by-reference, variadic/default fields for every parameter/argument and reject non-simple calls.
- Lezer: require supported static method declaration structure, all `FormalParameter` nodes, and receiver-free `MethodInvocation`; reject overload ambiguity at semantic resolution.

## Backend and target validation work

- Emit arbitrary parameter/argument lists and target `void` spellings (`void` in JS JSDoc/TS/PHP/Java, `[void]` in the Ruby comment profile).
- Emit bare `return` only where source syntax needs or permits it, while preserving semantic control flow.
- Validate resolved call signatures again for external IR and target identifier/reserved-word rules for declarations and references.
- Do not emulate optional/default arguments or rename/dispatch overloaded calls. A target conflict is `UNSUPPORTED_CAPABILITY` before source generation.

## Diagnostics and source locations

- Stable semantic diagnostics cover duplicate function, unresolved callee, argument-count mismatch, argument-type mismatch, value returned from void, missing value return, and void used as a value.
- Frontend excluded parameter/call forms use `UNSUPPORTED_SYNTAX` at the parameter, argument, receiver, or function flag.
- Missing annotations remain `MISSING_TYPE` at the parameter/function.
- Call location, callee location if modeled separately, each argument, parameter, and return annotation owner must be available for precise errors.

## Tests and acceptance

- Add equivalence cases for zero-, one-, and three-parameter functions, nested direct calls, recursion with a terminating condition, void helper calls, and multiple functions.
- Negative specs cover duplicate/unresolved names, wrong arity/type, void misuse, missing return values, every excluded parameter form, spread/named arguments, receivers, overloads, and higher-order calls.
- Backend malformed-IR specs prove signature validation occurs before emission.
- Generate/reparse and execute one multi-function fixture through every required registered role with its real toolchain, asserting exact output and equivalent resolved signatures/calls.

## Documentation and changelog

Update semantic schema, language-support signature mapping, Ruby comment profile, call restrictions, recursion policy, and void rules. Add one behavior changelog fragment.

## Non-goals

Optional/default/rest/keyword/named/variadic parameters or arguments, overloads, higher-order functions, closures, lambdas, blocks/callbacks, methods/receivers, constructors, generic functions, async/generators, by-reference passing, and implicit/inferred public signatures.

## Completion criteria

- Function and call arity is no longer hard-coded, and every call resolves to one typed semantic declaration.
- Void is enforced as non-value return semantics across source, IR, and targets.
- Every excluded call/parameter form fails loudly at a useful location.
- Focused signature/diagnostic specs and real registered-runtime round-trip execution pass with docs/changelog updates.
