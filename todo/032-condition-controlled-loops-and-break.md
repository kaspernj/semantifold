# 032 — Condition-controlled loops and break/continue

- Status: `todo`
- Phase/priority: Phase S / P1
- Dependencies: [004-statement-sequencing-and-conditionals.md](004-statement-sequencing-and-conditionals.md), [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md)

## Objective

Add general condition-controlled loops with strict-Boolean conditions and explicit `break` and `continue` where the source and target profiles can represent them directly. Establish reusable control-flow semantics for later iterative programs without coupling loops to standard-library calls or truthiness.

## Current evidence and gap

[`../src/semantic/types.js`](../src/semantic/types.js) and [`../src/semantic/validate.js`](../src/semantic/validate.js) model blocks, conditionals, and returns but no back edges or loop-local control transfer. Every current frontend rejects loops, and backend flow analysis assumes an acyclic statement tree. The first standard-library vertical slice eventually needs a read-until-EOF loop, but recognizing `gets` or another API as special loop syntax would mix library knowledge into the control-flow foundation.

## Semantic and control-flow contract

- Add one condition-controlled loop node with an explicit `boolean` condition, ordered body `Block`, and source location. The condition is evaluated before every iteration; a false first condition executes the body zero times.
- Preserve evaluation order and effects in the condition and body. No backend may hoist, duplicate, cache, or invert an effectful condition unless a later proven-safe optimization establishes equivalence.
- `break` exits the nearest enclosing loop. `continue` transfers to the nearest enclosing loop's next condition evaluation. Both are statements with precise locations and cannot carry values.
- Extend reachability analysis for loop-local abrupt completion. Statements after an unconditional `break`, `continue`, or `return` in the same block are unreachable. A loop does not by itself satisfy a non-void function's all-path return requirement unless finite exit and return behavior are statically proven by an explicitly bounded rule.
- Resolve each `break`/`continue` to a semantic loop identity; reject unresolved or cross-function control transfer in caller-owned IR.
- Conditions remain strict semantic Boolean values. Truthiness and implicit optional/presence testing are not introduced.

## Frontend strategy

- Each adopted frontend converts only its ordinary pre-condition loop form (`while` or the documented exact equivalent), accounts for every parser child, and rejects alternative modifiers/forms it cannot normalize exactly.
- Convert only unlabeled `break` and `continue` with no value. Reject labels, levels/counts, loop `else`, post-condition loops, infinite-loop shorthand, iterator/collection loops, comprehensions, and language-specific nonlocal control.
- Keep stdlib resolution entirely out of the adapter: a condition may contain any already-supported Boolean expression/call, but `gets`, EOF, sentinel, or read-loop spellings receive no special recognition.
- Never scan source text after a parser node is rejected or ambiguous.

## Backend and target validation

- Emit the target's direct pre-condition loop and nearest-loop `break`/`continue` forms, preserving nested-loop identity and exact condition/body order.
- Validate condition type, body shape, control-target identity, reachability, target syntax support, and all nested statements before returning source or artifacts.
- A registered target that has not adopted this semantic node returns located `UNSUPPORTED_CAPABILITY` before exposing output. Implementing the task must name the required adoption cohort rather than assuming every registered role supports loops.

## Diagnostics and rejections

- Use `NON_BOOLEAN_CONDITION` for any loop condition not typed `boolean`.
- Add stable semantic diagnostics for `break` or `continue` outside a loop, invalid loop target identity, cross-function target, and unreachable statements after unconditional loop control.
- Frontend-only excluded forms use located `UNSUPPORTED_SYNTAX`; malformed external IR or target inability uses located `UNSUPPORTED_CAPABILITY`.
- Reject truthy values, optional-as-condition forms, labeled/multi-level exits, and unmodeled parser recovery without approximating them.

## Deterministic real-toolchain tests

- Cover zero, one, and multiple iterations; condition-side effects; nested conditionals and loops; nearest-loop break/continue; return from a loop; and fallthrough after a loop.
- Negative specs cover truthiness, invalid control placement/identity, labels/levels/values, alternate loop kinds, unreachable statements, malformed blocks, and unsupported target roles.
- Generate, reparse where supported, compile if applicable, and execute canonical fixtures with every real toolchain in the task's declared adoption cohort. A missing command fails rather than skips; exact stdout/status and semantic meaning must agree.
- Generate twice and compare code/artifact sets and mappings deterministically. Source snapshots alone are not acceptance.

## Documentation and changelog

When implemented, document the exact loop source profiles, strict-Boolean and evaluation-order rules, flow analysis, adopted language roles, and all exclusions. Add one behavior changelog fragment.

## Non-goals

Truthiness, stdlib-specific read-loop recognition, iterator/collection loops, `for`/`foreach`, post-condition or infinite-loop syntax, loop expressions/values/`else`, labels, multi-level exits, comprehensions, recursion elimination, termination proof, async iteration, generators, parallel loops, or optimization.

## Completion criteria

- One parser-neutral strict-Boolean condition-controlled loop and resolved nearest-loop control semantics exist.
- Flow validation correctly handles reachability, return, nested break, and continue without inferring truthiness or library meaning.
- Every adopted frontend/backend accounts for the bounded profile and every other role fails loudly before output.
- Focused diagnostic, round-trip, deterministic artifact, and real-toolchain execution coverage passes with documentation and a changelog fragment.
