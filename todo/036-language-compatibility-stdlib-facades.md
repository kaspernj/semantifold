# 036 — Language compatibility stdlib/facades

- Status: `delivered through PR #46; merged as 9aba48f9d48bcef4fd4c9275aec14bfcc4f0904c`
- Phase/priority: Phase S / P1
- Dependencies: [035-versioned-standard-library-contracts-and-provider-linking.md](035-versioned-standard-library-contracts-and-provider-linking.md)

## Objective

Add source-language native-looking portable compatibility stdlib/facades as executable definitions with public declarations. Substitute them only for parser- and resolver-proved stdlib identities, compile their source syntax through the ordinary semantic pipeline, retain collision-safe source API names in target output, and isolate same-language providers from facade recursion.

## Current evidence and gap

The published `semantifold@0.3.0` release rejects the required imports/requires and host APIs. Task 035 now provides canonical capabilities and target providers but intentionally not the source API shapes users write. A name rewrite such as `TCPSocket` to `fsockopen` would erase constructor/method/resource behavior, confuse user-defined names with stdlib symbols, and create one implementation per language pair.

## Facade contract and executable behavior

- A language compatibility stdlib/facade is a versioned compiler-owned source module authored in that language's documented Semantifold-supported subset. It exposes exact native-looking supported declarations and implements their behavior only with semantic constructs and versioned canonical Semantifold stdlib contract/capability calls.
- Public declarations describe the accepted source signatures, types, effects, failures, optional/presence results, and ownership. Executable bodies define sequencing, state, branching, and composition. A facade is never a name-only rewrite table or backend emitter special case.
- Each facade records its source language/runtime profile, exact proved native module and symbol identities, supported API members/forms, canonical capability requirements, and compatibility version.
- Unsupported members remain unsupported even if a target provider exposes a related operation. Facades cannot call target APIs, protected bindings, reflection, dynamic dispatch, native extensions, or unversioned host behavior.

## Import/require resolution and symbol identity

- Extend Task 010 module resolution with catalogued source stdlib identities. Substitute a facade only when the frontend and resolver prove the exact native library/module plus referenced symbol identity from parser-backed import/require/name bindings.
- Same spelling is insufficient. Reject or leave outside the supported profile user-defined/shadowed symbols, monkey-patches/class reopening, reflective or computed lookup, dynamic imports/requires, unresolved aliases, preload hooks, native extensions, and package-provided replacements.
- Preserve source locations and identity evidence for the import/require, resolved symbol, member, and call. A parser adapter that rejects or cannot resolve a construct never scans source text to recover it.
- Resolution chooses one facade version compatible with both the proved source profile and its canonical contract requirements before any facade code is compiled.

## Compilation, target naming, and recursion isolation

- Compile the application and only its reachable facade modules through the normal source frontend, semantic validation, and selected target backend. Source syntax always becomes valid target syntax; library behavior remains in the compiled executable facade.
- Generated target code may retain source API class/function names inside a reserved collision-safe compatibility namespace or expose them through a compiler-owned import alias. Validate collisions with application, other facade, provider, and target-scaffolding names.
- Link only the required target providers and facade/provider modules under Task 035's transaction and tree-shaking rules.
- For same-language generation, the target host provider/native binding resolves the genuine host-native stdlib symbol through a protected compiler-owned route. It cannot resolve the generated compatibility alias and recurse into the facade.

## Frontend/facade/provider strategy

- Each language integration separates its facade role from its provider role. A language may implement one side without claiming the other, though an end-to-end lane needs both a source facade and selected target provider.
- Frontends own exact native import/require syntax and identity proof. Facade modules own source-visible compatibility behavior. Canonical contracts own portable semantics. Providers own genuine target-native access. Backends own target syntax and collision-safe emission.
- Never add a handwritten source-on-target library, pair-specific bridge, or direct behavior-changing rewrite. Direct idiomatic lowering may be a separately proven-safe later optimization only.

## Diagnostics and rejections

- Stable diagnostics cover unproved/unresolved stdlib identity, facade version mismatch, unsupported source API/member/form, shadowing, reopening/monkey-patching, dynamic/reflection/native-extension behavior, forged facade/provider authority, compatibility-name collision, and same-language isolation failure.
- Frontend/resolution diagnostics point to the exact import/require, binding, member, or dynamic construct. Missing target capability/provider diagnostics retain canonical identity/version detail. All link failures occur before partial artifacts escape.
- A rejected facade body is a normal parser/semantic failure; compiler ownership does not authorize source-text fallback or bypass validation.

## Deterministic real-toolchain tests

- Use small test facades first to prove exact identity substitution, executable behavior, public declaration checks, transitive facade selection, target syntax conversion, unused-facade elimination, and collision-safe names.
- Negative cases cover user-defined same names, shadowing, alias ambiguity, dynamic require/import, reflective calls, monkey-patching/reopening, native extensions, unsupported members, forged native access, and version/provider failures.
- Generate/reparse and execute supported source-to-target and same-language lanes through real installed toolchains. Missing commands fail; exact behavior must come from compiled facade plus provider, not snapshots or source-name assertions.
- Same-language tests prove the provider reaches the genuine native symbol once without recursive facade calls. Generate twice and compare complete artifacts and provenance.

## Documentation and changelog

When implemented, document each facade's source/runtime profile, public API subset, canonical dependencies, resolution evidence, target namespace/alias rules, same-language isolation, supported lanes, and exclusions. Add one behavior changelog fragment.

## Non-goals

Complete standard libraries, arbitrary applications, pairwise source-target adapters, spelling-only rewrites, user/package facade injection, monkey-patching or open classes, reflection/metaprogramming, dynamic import/require/dispatch, native extensions, arbitrary host classes, embedded source runtimes, whole-program intelligent refactoring, or direct idiomatic lowering as the baseline.

## Completion criteria

- Facades are versioned executable portable definitions with matching public contracts and canonical-only dependencies.
- Parser-backed resolution substitutes only proved native stdlib symbols and rejects every dynamic, shadowed, unresolved, or modified case precisely.
- Compiled target syntax preserves collision-safe source API shape and links only reachable facade/provider modules.
- Same-language protected binding isolation, real-toolchain behavior, diagnostics, provenance, documentation, and changelog coverage pass.

## Implementation record — 2026-09-13

Task 036 adds `createStdlibFacadeRegistry`, `listStdlibFacades`, and `resolveStdlibFacade` with detached immutable `1.0.0` records for PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java. Each language has a public neutral qualification facade, an internal runner dependency, and an unreachable facade used to prove elimination. Records close the runtime profile, exact native module and symbol identities, public direct-call declaration, compiler-owned executable source, versioned facade dependencies, and canonical-only requirements. The public function accepts one string and returns the Task 034 trace after the runner calls `probeEffect`; only the runner receives compiler-derived range-`1` authority for `semantifold.task034.resource-probe`. No facade calls a target API or protected provider name.

`parseProgram` recognizes only exact parser-backed qualification identities. It selects a dependency-first closure, adds only reachable facade sources, compiles every facade with its ordinary source frontend and semantic validation, and records `SemantifoldStdlibFacadeResolution` v1 import evidence plus the complete `SemantifoldStdlibFacades` v1 program descriptor. Source provenance distinguishes `application` and `facade` ownership. Dynamic or computed import, unresolved identity/member, source binding mutation, PHP shadowing, Ruby reopening, reflection, native extension loading, caller path/module collision, and caller-supplied canonical authority fail with stable located `STDLIB_FACADE_*` diagnostics; parser failure remains terminal without source scanning.

Program generation validates registry versions, descriptor bytes, semantic module markers, compiler-owned source, and native identity evidence before allocating a writer. Selected facades compile through every ordinary original-five backend under the reserved `semantifold/facade/<source-language>/...` artifact namespace, use collision-checked target identifiers, carry mapped source provenance and the `support` role, and extend `SemantifoldStdlibLink` metadata with the full facade closure. Task 035 provider selection and protected-role/version rules remain unchanged. Same-language PHP, Ruby, JavaScript, TypeScript, and Java lanes prove the provider carrier does not contain or resolve the public compatibility alias.

Focused acceptance covers immutable registry definitions, exact and compatible lookup, public declarations, transitive selection, same-spelling non-substitution, negative resolution forms, collision and descriptor failures, unused elimination, complete deterministic artifacts, mappings/metadata, all 25 original-five source-to-target real-toolchain routes, and five same-language isolation routes. The fixture is deliberately neutral: no TCP, `TCPSocket`, `fsockopen`, networking, or other concrete Task 037 API is implemented.

## Delivery record — 2026-09-14

Task 036 was delivered through PR #46 and merged into `master` as `9aba48f9d48bcef4fd4c9275aec14bfcc4f0904c` (`Merge pull request #46 from kaspernj/codex/task-036-language-compatibility-stdlib-facades`). Its topic parent is `639d7931d6a084805ff13b60456c423c0bb552fd`. Publication was not part of that delivery.
