# Language and platform roadmap

## Purpose and current baseline

This folder is Semantifold's durable, dependency-ordered implementation backlog and delivered design record. The released baseline is `semantifold@0.1.1` / `v0.1.1` at merged `master` commit `61990ddffe31eb48ef36201eda1fc25549e8b87f`; repository and external evidence is recorded in [SOURCES.md](SOURCES.md).

Tasks 001–004 and 015 are delivered. Semantifold currently models safe integer, Boolean, and Unicode string scalars; explicitly typed locals and assignment; typed unary/binary expressions; ordered lexical blocks; nested strict-Boolean conditionals; explicit returns; two-argument direct calls; and entry-point printing. PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java are implemented as frontends and source backends with real-runtime and provenance/source-map coverage. Task 015 adds the shared role registry, single-module generated artifact sets, byte provenance, parser qualification policy, and fail-loud staged toolchain acceptance without adding a language or semantic feature. Tasks 005–014 and 016–031 remain roadmap work.

The immediate priority is a bounded language-baseline expansion against this small stable IR. That exposes registration, parser, artifact, toolchain, ownership, and diagnostic flaws before collections, optionals, records, modules, errors, and generics multiply the work. It does not mean every platform, legacy bridge, or later language must block semantic progress.

## Guiding principles

1. Model meaning once. Semantic nodes describe values, types, evaluation order, bindings, control flow, and program structure without parser nodes, target spelling, UI lifecycle, ABI, or signing data.
2. Register roles separately. A language/platform may provide a source frontend, textual backend, binary backend, application-artifact backend, or interoperability bridge; one support list must not imply every role.
3. Fail loudly. Unknown IDs use `UNSUPPORTED_LANGUAGE`; known IDs missing a requested role use `UNSUPPORTED_ROLE`; frontends raise located `UNSUPPORTED_SYNTAX`, `MISSING_TYPE`, or `PARSE_ERROR`; existing backends raise located `UNSUPPORTED_CAPABILITY` before returning any partial artifact.
4. Never recover meaning from source text after a parser rejects a node. Parser integrations traverse typed trees and reject recovery/error nodes and every unmodeled child.
5. Prefer a precise portable profile. Overflow, truthiness, strings/ownership, nullability, exceptions, concurrency, UI lifecycles, host APIs, and signing require explicit contracts.
6. Keep source rules in frontends and target/platform rules in backends. Project manifests, runtime helpers, loaders, UI shells, assets, entitlements, and ABI conventions do not enter the semantic IR.
7. Preserve original source locations and rich provenance. Text targets retain range maps; binary and application artifacts identify semantic, derived, and synthetic regions without inventing source spans.
8. Acceptance uses real installed compilers, runtimes, validators, browsers, and configured simulators/emulators. A declared lane fails rather than skips when its required toolchain is unavailable.
9. Parser/runtime dependencies come from qualified registries or official distributions. Do not bundle generated archives, fetch tools during tests, or add source-text fallbacks.
10. Keep the roadmap bounded. Add languages for distinct semantic, ecosystem, or deployment value; record lower-value candidates with a concrete reason to reconsider rather than creating an endless wishlist.

## Prioritized phases

### Delivered semantic foundation — Tasks 001–004

- [001 — Portable scalar values and types](001-portable-scalar-values-and-types.md)
- [002 — Local declarations and assignment](002-local-declarations-and-assignment.md)
- [003 — Typed operators and richer expressions](003-typed-operators-and-expressions.md)
- [004 — Statement sequencing and general conditionals](004-statement-sequencing-and-conditionals.md)

These are durable design records for the implemented baseline.

### Delivered language-expansion foundation — Task 015

- [015 — Shared language-expansion foundation](015-language-expansion-foundation.md)

Task 015 separates roles/capabilities, defines deterministic single-module project and binary artifact sets, records the parser-distribution qualification gate, standardizes toolchain discovery and native/platform acceptance, and extends provenance beyond one text file. The Phase L1 language tasks may now proceed subject to their own parser qualification and dependency records.

### Phase L1 — immediate stable-IR language cohort (P0)

- [016 — Python source and target support](016-python-source-and-target.md)
- [017 — C# source and target support](017-csharp-source-and-target.md)
- [018 — C source and target support](018-c-source-and-target.md)
- [019 — C++ source and target support](019-cpp-source-and-target.md)
- [020 — Rust source and target support](020-rust-source-and-target.md)
- [022 — Swift source and target support](022-swift-source-and-target.md)
- [023 — Kotlin/JVM source and target support](023-kotlin-source-and-target.md)
- [024 — Go source and target support](024-go-source-and-target.md)
- [025 — Core expanded-language baseline acceptance](025-core-language-baseline-acceptance.md)

Tasks 016–020, 022–024 adopt exactly Tasks 001–004 after Task 015; only C++ waits for C's native/string boundary. They otherwise need not serialize. Task 025 is the single gate before tasks 005 and 007. Its acceptance is spanning rather than a quadratic all-pairs matrix: every new frontend reaches the same IR, every new backend executes the canonical modules, every new language round-trips once, and representative cross-family paths prove registry composition.

Swift is in this cohort because it is a modern general-purpose language independently of iOS. Kotlin/JVM adds a major JVM language without making Android tooling part of the gate. Go adds a distinct garbage-collected native/package/toolchain model. Dart and Zig remain concrete planned languages but are intentionally later: Flutter supplies most of Dart's requested platform value, while C/C++/Rust already cover the first native contract pressure that Zig would repeat.

### Phase 1 — portable semantic expansion (P1, after Task 025)

- [005 — General required function signatures and calls](005-general-function-signatures-and-calls.md)
- [006 — Immutable lists and maps](006-immutable-lists-and-maps.md)
- [007 — Optional values and presence narrowing](007-optional-values-and-presence-narrowing.md)
- [008 — Ordered list iteration](008-collection-iteration.md)
- [013 — Five-language compatibility acceptance](013-five-language-compatibility-acceptance.md)

Tasks 005 and 007 depend on Task 025; their descendants inherit that gate. New-language registration does not make every later semantic feature mandatory everywhere. Each feature names its required cohort and leaves other roles explicitly unsupported until a focused adoption task supplies a correct mapping. Task 013 remains the historical aggregate proof for Tasks 001–008 across PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java only.

### Phase 2 — named structure and failure (P2, conditional)

- [009 — Closed records and member access](009-closed-records-and-member-access.md)
- [010 — Multi-file modules and names](010-multifile-modules-and-names.md)
- [011 — Typed errors and handling](011-typed-errors-and-handling.md)
- [014 — Ordered map iteration](014-ordered-map-iteration.md)

Task 010 owns the shared semantic project model: multiple caller-supplied source modules, resolved identities, and ordered target artifacts. Project/helper files for one semantic module from Task 015 are not Task 010 modules. Application lanes below depend on Task 010 when they consume a source project rather than one module.

### Phase 3 — parametric abstraction (P3, conditional)

- [012 — Type parameters and generic declarations](012-type-parameters-and-generics.md)

Generic declarations follow concrete collection and record types. No frontend/backend may erase a semantic type parameter into `mixed`, `object`, a raw type, pointer, or dynamic value.

### Phase P — non-blocking deployment and later-language lanes

- [021 — Browser-oriented WebAssembly target](021-browser-webassembly-target.md)
- [026 — Apple/iOS application artifact target](026-apple-ios-application-target.md)
- [027 — Objective-C interoperability bridge](027-objective-c-interoperability.md)
- [028 — Kotlin/Android application artifact target](028-android-application-target.md)
- [029 — Dart source and target support](029-dart-source-and-target.md)
- [030 — Dart/Flutter application artifact target](030-flutter-application-target.md)
- [031 — Zig source and target support](031-zig-source-and-target.md)

These tasks do not gate Task 005. Browser Wasm depends only on Task 015 and remains target-only. iOS and Android app artifacts require their language backend plus Task 010's project model. Objective-C is a lower-priority Swift interoperability/legacy-host bridge, not a full frontend/backend. Dart follows Task 005 and supplies the typed language backend required by Flutter. Flutter then reuses the Android emulator lane and shared project model. Zig follows the initial native cohort and Task 005 without delaying either.

## Language and artifact role matrix

Legend: **implemented** describes the baseline, **core** gates Task 025, **later** is concrete non-blocking work, and **none** is an intentional role exclusion.

| Language/platform | Source frontend | Target role | Artifact profile | Parser/tool route | Initial scope |
| --- | --- | --- | --- | --- | --- |
| Ruby | implemented | implemented text | `.rb` | Prism | Tasks 001–004 |
| JavaScript + JSDoc | implemented | implemented text | `.js` | Babel + comment parser | Tasks 001–004 |
| TypeScript | implemented | implemented text | `.ts` | Babel | Tasks 001–004 |
| PHP | implemented | implemented text | `.php` | `php-parser` | Tasks 001–004 |
| Java | implemented | implemented text | `Main.java` | Lezer Java | Tasks 001–004 |
| Python | core 016 | core text 016 | `program.py` | qualified Tree-sitter Python | Tasks 001–004 |
| C# | core 017 | core managed project 017 | `.cs`, `.csproj` | qualified Tree-sitter C# | Tasks 001–004 |
| C | core 018 | core native project 018 | `.c`, support header | qualified Tree-sitter C | Tasks 001–004 |
| C++ | core 019 | core native text 019 | `.cpp` | qualified Tree-sitter C++ | Tasks 001–004 |
| Rust | core 020 | core Cargo project 020 | manifest, lockfile, `.rs` | qualified Tree-sitter Rust | Tasks 001–004 |
| Swift | core 022 | core native text 022 | `.swift` | qualified Swift grammar + `swiftc` | Tasks 001–004 |
| Kotlin/JVM | core 023 | core JVM text 023 | `.kt` (runnable JAR acceptance) | qualified Kotlin grammar + `kotlinc` | Tasks 001–004 |
| Go | core 024 | core native module 024 | `go.mod`, `.go` | official Tree-sitter Go + Go toolchain | Tasks 001–004 |
| Browser WebAssembly | none | later binary/browser 021 | `.wasm`, map, loader, HTML | internal encoder + validator/browser | Tasks 001–004 |
| Apple/iOS | Ruby and any registered project frontend | later application target 026 | Swift/Xcode-compatible app project | Swift/Xcode/iOS Simulator | Task 010 project to UI shell |
| Objective-C | none | later interop bridge 027 | `.m` host + generated Swift interface | Clang/Xcode interoperability | bounded legacy host bridge |
| Android | any registered project frontend | later application target 028 | Kotlin/Gradle Android app | Android SDK/emulator | Task 010 project to UI shell |
| Dart | later frontend 029 | later VM/native text 029 | Dart package | qualified Dart grammar + Dart SDK | Tasks 001–005 |
| Flutter | Dart and any registered project frontend | later application target 030 | Flutter app project | Flutter SDK + simulator/emulator | Task 010 project to widget shell |
| Zig | later frontend 031 | later native project 031 | `.zig`, `build.zig` | qualified Zig grammar + Zig toolchain | Tasks 001–005 |

An application target consumes semantic projects; it does not make Ruby, Python, or another source runtime part of the app. In particular, Ruby-to-iOS means Ruby source is parsed by Semantifold, normalized to the shared project IR, and lowered to generated Swift plus Xcode-compatible app artifacts. No Ruby interpreter, gems, native extensions, `eval`, monkey-patching, or other rejected Ruby behavior ships in or runs on iOS.

## Coverage and gating matrix

| Capability | Required before Task 005 | May proceed later/in parallel | Does not imply |
| --- | --- | --- | --- |
| Shared registration/artifacts/toolchains | Task 015 | extended by each platform task | support for every role |
| Tasks 001–004 language baseline | Tasks 016–020, 022–025 | Dart 029, Zig 031 | later semantic features |
| Browser binary execution | none | Task 021 | Wasm source support or WASI |
| General calls/void | Task 025 then Task 005 | adopted per language capability | every platform lane must block 005 |
| Semantic source projects | Task 010 | iOS 026, Android 028, Flutter 030 | package-manager resolution |
| Apple application delivery | none | Swift 022 then iOS 026 | embedded Ruby runtime or App Store delivery |
| Objective-C compatibility | none | iOS 026 then bridge 027 | Objective-C frontend/backend or Objective-C++ |
| Android/Flutter delivery | none | Kotlin 023/Android 028 and Dart 029/Flutter 030 | automatic signing/store submission |
| Task 013 compatibility | original five only | new-language acceptance stays in 025/owning tasks | expanded all-pairs coverage |

## Dependency graph

```text
001 + 002 + 003 + 004
          │
          015 shared language-expansion foundation
          ├── 016 Python ─────────────────────┐
          ├── 017 C# ─────────────────────────┤
          ├── 018 C ── 019 C++ ───────────────┤
          ├── 020 Rust ───────────────────────┤
          ├── 022 Swift ──────────────────────┤
          ├── 023 Kotlin/JVM ─────────────────┤
          └── 024 Go ─────────────────────────┤
                                              025 core baseline acceptance
                                                ├── 005 calls
                                                └── 007 optionals

005 ── 006 lists/maps ── 008 list iteration ── 014 ordered-map iteration
005 + 006 + 007 ── 009 records ── 010 semantic projects/modules
004 + 007 + 009 ── 011 typed errors
005 + 006 + 009 ── 012 generics
001–008 ── 013 original-five acceptance

015 ── 021 browser Wasm (parallel, non-blocking)
022 + 010 ── 026 iOS ── 027 Objective-C bridge
023 + 010 ── 028 Android ─┐
015 + 005 ── 029 Dart ────┴── 030 Flutter (also 010)
015 + 005 + 018 + 020 ── 031 Zig
```

Dependencies in task files are authoritative. Existing IDs remain stable; numerical order does not override dependency order.

## Task index

| Task | Phase | Priority | Capability | Direct dependencies |
| --- | --- | --- | --- | --- |
| [001](001-portable-scalar-values-and-types.md) | delivered | — | Scalar foundation | none |
| [002](002-local-declarations-and-assignment.md) | delivered | — | Typed locals/assignment | 001 |
| [003](003-typed-operators-and-expressions.md) | delivered | — | Typed expressions | 001 |
| [004](004-statement-sequencing-and-conditionals.md) | delivered | — | Blocks/conditionals | 002, 003 |
| [015](015-language-expansion-foundation.md) | delivered | — | Roles, artifacts, parser/toolchain qualification, provenance | 001–004 |
| [016](016-python-source-and-target.md) | L1 | P0 | Python frontend/backend | 015 |
| [017](017-csharp-source-and-target.md) | L1 | P0 | C# frontend/backend/project | 015 |
| [018](018-c-source-and-target.md) | L1 | P0 | C frontend/backend/ownership | 015 |
| [019](019-cpp-source-and-target.md) | L1 | P0 | C++ frontend/backend/value boundaries | 015, 018 |
| [020](020-rust-source-and-target.md) | L1 | P0 | Rust frontend/backend/crate | 015 |
| [022](022-swift-source-and-target.md) | L1 | P0 | Swift frontend/backend | 015 |
| [023](023-kotlin-source-and-target.md) | L1 | P0 | Kotlin/JVM frontend/backend | 015 |
| [024](024-go-source-and-target.md) | L1 | P0 | Go frontend/backend/module | 015 |
| [025](025-core-language-baseline-acceptance.md) | L1 | P0 gate | Spanning Tasks 001–004 acceptance | 016–020, 022–024 |
| [005](005-general-function-signatures-and-calls.md) | 1 | P1 | Required arity/void/direct calls | 001, 004, 025 |
| [006](006-immutable-lists-and-maps.md) | 1 | P1 | Immutable lists/maps | 002, 003, 005 |
| [007](007-optional-values-and-presence-narrowing.md) | 1 | P1 | Optionals/narrowing | 001, 003, 004, 025 |
| [008](008-collection-iteration.md) | 1 | P1 | Ordered list iteration | 002, 004, 006 |
| [009](009-closed-records-and-member-access.md) | 2 | P2 | Closed records/members | 002, 005, 006, 007 |
| [010](010-multifile-modules-and-names.md) | 2 | P2 | Semantic projects/modules | 005, 009 |
| [011](011-typed-errors-and-handling.md) | 2 | P2 | Typed errors | 004, 007, 009 |
| [012](012-type-parameters-and-generics.md) | 3 | P3 | Generics | 005, 006, 009 |
| [013](013-five-language-compatibility-acceptance.md) | 1 | P1 legacy | Original-five compatibility | 001–008 |
| [014](014-ordered-map-iteration.md) | 2 | P2 | Ordered maps | 006, 008 |
| [021](021-browser-webassembly-target.md) | P | P1 | Browser Wasm binary target | 015 |
| [026](026-apple-ios-application-target.md) | P | P1 | Swift/Xcode iOS application artifacts | 010, 022 |
| [027](027-objective-c-interoperability.md) | P | P2 | Objective-C legacy-host bridge | 005, 026 |
| [028](028-android-application-target.md) | P | P1 | Kotlin Android application artifacts | 010, 023 |
| [029](029-dart-source-and-target.md) | P | P1 | Dart frontend/backend/package | 005, 015 |
| [030](030-flutter-application-target.md) | P | P2 | Flutter application artifacts | 010, 028, 029 |
| [031](031-zig-source-and-target.md) | P | P2 | Zig frontend/backend/project | 005, 015, 018, 020 |

## Researched candidates deliberately deferred

This is the complete candidate holding set for this roadmap revision, not an invitation to append languages without a distinct use case:

- **Scala**: deferred because Java and Kotlin cover the JVM platform value; Scala's implicits/givens, higher-kinded types, pattern matching, and effect ecosystems need semantics beyond the current IR.
- **Lua**: deferred because Python, Ruby, and JavaScript already exercise dynamic-language annotation boundaries, while Lua has no standard static annotation contract to prefer.
- **Elixir and Gleam**: deferred together until Semantifold has an actor/message/effect model. Gleam's static types are attractive, but BEAM deployment alone does not justify ignoring its concurrency/failure semantics.
- **Julia and R**: deferred until floating point, vectors/arrays, missing values, broadcasting, and numeric coercion have portable definitions; their primary practical value is not the scalar-only subset.
- **Haskell and OCaml**: deferred until algebraic data types, pattern matching, closures/higher-order functions, immutable recursion, and explicit effect boundaries exist.
- **Shader languages**: Metal Shading Language, WGSL, GLSL, and HLSL are deferred until a GPU/kernel IR defines vectors/matrices, address spaces, resource bindings, entry stages, and host/device synchronization. Metal is not Swift, Objective-C, Objective-C++, or a general Apple application language.

Reconsider a candidate only when the cited missing semantic/platform contract exists or a concrete deployment requirement outweighs overlap with selected lanes.

## Definition of done

A task is complete only when its own criteria and these repository-wide rules hold:

- public semantic values use only discriminated types from `src/semantic/types.js`; parser values stay in `src/frontends/`, target syntax/encoding stays in `src/backends/`, and project/UI/ABI/signing scaffolding stays outside the IR;
- one registry is authoritative for frontend, text, binary, application-artifact, interop, mapping, and acceptance capabilities; public discovery never overstates a role or feature;
- every accepted parser child is converted and every unmodeled/recovered child fails at its location; no adapter scans source text to recover rejected meaning;
- every backend validates complete semantic and target/platform capability before transactionally returning artifacts; unsupported behavior is never implemented with a lossy runtime approximation;
- Tasks 016–020 and 022–025 prove Tasks 001–004 for the immediate cohort. Later semantic tasks state their required cohort; other registered roles remain explicit tested rejections until focused adoption, without blocking the semantic task merely because they exist;
- text, binary, and application artifacts are deterministic before signing/build-system mutation and preserve rich semantic/synthetic provenance plus interoperable maps where the ecosystem defines them;
- applicable tests invoke every real compiler/runtime/validator/browser/simulator/emulator declared by the task. Platform-specific jobs fail when their configured tools are unavailable; Linux tests do not pretend to execute Xcode/iOS Simulator;
- generated projects declare ownership of exact files and reject unsafe overwrite/path traversal. Credentials, provisioning profiles, stores, and caller assets are never discovered, mutated, uploaded, or silently synthesized;
- README and `docs/language-support.md` distinguish implemented behavior, per-feature roles, artifact shapes, platform constraints, and exclusions; each behavior change has focused specs and a changelog fragment, while this planning-only change needs none;
- `npm test`, lint, typecheck, build, audit/dependency/package gates, and `git diff --check` pass as required by `AGENTS.md`.

## Explicit exclusions

This planning change implements no adapter, backend, runtime, dependency, app, or semantic behavior. It excludes source-text fallbacks, parser AST exposure, bundled parser/tool archives, runtime downloads during tests, user package-manager resolution, lossless formatting, macro/preprocessor systems, reflection, FFI/unsafe code, native extensions, automatic credentials/signing/provisioning, device registration, TestFlight/App Store/Play Store submission, and a compiler-framework rewrite.

Ruby-to-iOS is semantic translation into generated Swift application code, never an embedded Ruby VM. Objective-C++ and Metal remain outside the Objective-C bridge. Android and Flutter lanes do not make platform APIs semantic nodes. Browser Wasm remains distinct from WASI and Wasm source input.

Async functions, actors, promises/futures, generators, goroutines/channels, isolates, coroutines, threads, shared memory, atomics, event loops, cancellation, and general host I/O remain excluded until separate proposals define portable scheduling, memory, failure, and resource-lifetime semantics.
