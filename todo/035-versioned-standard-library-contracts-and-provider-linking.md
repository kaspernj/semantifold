# 035 — Versioned standard-library contracts and provider linking

- Status: `todo`
- Phase/priority: Phase S / P1
- Dependencies: [010-multifile-modules-and-names.md](010-multifile-modules-and-names.md), [034-effectful-capabilities-and-resource-lifetime.md](034-effectful-capabilities-and-resource-lifetime.md)

## Objective

Add versioned canonical Semantifold stdlib contract/capability modules, a distinct target provider role and registry, capability negotiation, deterministic artifact linking/tree-shaking, a protected host-native binding, and transactional failure. This is the hub through which source facades and target native libraries will connect.

## Current evidence and gap

Task 010 plans caller-supplied semantic projects/modules, while Task 015's current registry separates frontend and backend roles and its artifact-set validator is transactional. Neither defines canonical stdlib modules, provider identities, version compatibility, link requirements, or protected native access. Task 034 will define effect/resource semantics, but without provider linking a target-native call would either leak into portable IR or be embedded pairwise in a backend.

## Canonical contract and capability model

- Define canonical Semantifold stdlib modules with stable module/capability identities and explicit semantic versions. References resolve by identity plus a declared compatible version range, never by an unqualified source spelling.
- Each operation contract precisely declares types, receiver/resource role, evaluation order, effects, typed failures, optional/presence and EOF meaning, text encoding/decoding, newline retention, blocking and timeout behavior, resource ownership/lifetime, close/repeated-close/use-after-close behavior, and canonical dependencies.
- Versioning is incremental. Compatible additions and incompatible semantic changes follow a documented rule; no provider or facade may infer support for an undeclared operation from a module name.
- Contracts are public declarations consumed by portable code. They contain no parser AST, target syntax, native handle, target exception, ABI, package-manager lookup, or target-specific error message/code.

## Provider role, registry, and native binding

- Add a registry role for a target host provider/native binding, separate from text/binary/application backends and interoperability bridges. A provider record names its target/runtime constraints, exact canonical versions/operations, provider dependencies, protected native entry points, and generated artifact contribution.
- Provider selection is derived from the same authoritative registry used for generation. Duplicate identities, ambiguous providers, malformed versions, cycles, missing dependencies, or role overstatement fail deterministically.
- Capability negotiation computes the complete transitive requirement set and selects one compatible provider set for the requested target. It reports exact missing or conflicting identities/versions before generation.
- A protected host-native binding is compiler-owned and unavailable to ordinary portable application/facade module resolution. Provider code alone may invoke genuine target-native stdlib APIs. Same-language compatibility names cannot capture or recurse into this binding.

## Linking, tree-shaking, and artifacts

- Resolve the graph from application modules through canonical capability calls to providers and provider dependencies. Include only transitively used canonical declarations, provider modules, and support artifacts.
- Tree-shaking operates at validated semantic module/capability boundaries. It preserves observable initialization, evaluation order, effects, failures, ownership, close paths, and required public declarations; it never guesses purity from target source.
- Allocate collision-safe internal names and artifact paths independently of source-visible compatibility aliases. Preserve rich source/semantic provenance and mark provider/native scaffolding with explicit derived or synthetic provenance.
- Validate module graph closure, versions, provider compatibility, names, artifacts, backend capabilities, and mappings before returning anything. A late failure discards the entire candidate artifact set.

## Frontend/backend/provider strategy

- Frontends may parse canonical calls only from compiler-owned portable modules or another explicitly authorized source profile; ordinary user code cannot forge provider/native authority.
- Backends emit canonical calls in a linkable internal form and compile portable modules with normal target syntax. Providers emit or supply only the minimum target-owned modules required by negotiated capabilities.
- Direct idiomatic lowering is outside the correctness path. A later optimization may replace a canonical/provider call only after proving complete contract equivalence.
- Language compatibility stdlib/facade selection and native-symbol import substitution belong to Task 036, not this provider foundation.

## Diagnostics and rejections

- Stable diagnostics cover unknown canonical module/capability, incompatible version, missing/ambiguous provider, provider dependency cycle, undeclared operation, protected-binding access, name/path collision, unsafe tree-shake, invalid registry shape, and link/artifact failure.
- Capability diagnostics identify the required identity/version and target provider constraint. Portable attempts to access a native binding identify the offending reference without revealing or accepting a usable internal name.
- Every failure is transactional. No partial source, provider file, mapping, or registry-derived claim escapes; no runtime fallback chooses a “closest” host API.

## Deterministic real-toolchain tests

- Registry/negotiation specs cover exact and compatible versions, incompatible versions, missing/ambiguous providers, transitive dependencies, cycles, protected authority, stable selection, and truthful public descriptors.
- Artifact specs prove unused capabilities/providers are absent, used graphs are closed, names/paths are collision-safe, provider/source provenance is complete, late failure returns nothing, and repeated generation is byte-for-byte stable.
- Small deterministic test capabilities execute through real compilers/runtimes for the task's adopted targets and prove effects, typed failures, presence, and close semantics traverse the provider boundary. Missing tools fail; source-only assertions are insufficient.
- Same-language tests deliberately create a compatibility-name collision and prove provider native lookup uses only the protected binding.

## Documentation and changelog

When implemented, document contract schemas/version rules, provider registry and negotiation, protected binding authority, linking/tree-shaking, artifact/provenance shape, target constraints, diagnostics, and public capability inspection. Add one behavior changelog fragment.

## Non-goals

Language-specific compatibility facades, broad stdlib coverage, pairwise adapters, package-manager resolution, runtime provider downloads/plugins, dynamic provider selection after generation, ABI/FFI exposure, automatic semantic shims, direct idiomatic lowering, whole-program refactoring, or the concrete TCP capability.

## Completion criteria

- Canonical stdlib contracts and provider records are versioned, resolved by identity, and publicly inspectable without overstating support.
- Negotiation selects a complete compatible provider graph or fails precisely before emission.
- Protected native access, collision-safe deterministic linking, safe module-level tree-shaking, provenance, and transactional artifacts are enforced.
- Focused negotiation/link diagnostics and real-toolchain provider execution pass with documentation and a behavior changelog fragment.
