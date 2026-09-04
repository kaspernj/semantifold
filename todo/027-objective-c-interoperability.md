# 027 — Objective-C interoperability bridge

- Status: `todo`
- Phase/priority: Phase P / P2
- Dependencies: [005-general-function-signatures-and-calls.md](005-general-function-signatures-and-calls.md), [026-apple-ios-application-target.md](026-apple-ios-application-target.md)

## Purpose and boundary

Add a bounded target-side compatibility bridge so legacy Objective-C application code can invoke selected generated Swift semantic functions. This is deliberately not an Objective-C frontend or general backend: Swift is the primary Apple implementation language, while Objective-C supplies only a high-value legacy-host boundary.

Objective-C, Objective-C++, Swift, Metal Shading Language, and Apple platform APIs remain separate languages/capabilities. Supporting this bridge advertises none of the others.

## Interoperability profile

- Generate a final `NSObject`-derived Swift facade whose explicitly selected Task 005 functions are exposed with stable `@objc` selectors. Map semantic integers, Booleans, and strings through documented fixed-width/`BOOL`/nonnullable `NSString` representations with checked conversion at the boundary.
- Accept only synchronous required-arity calls and returned scalar values. Generated Objective-C host fixtures import the Xcode-produced `ProductModule-Swift.h`; that derived compatibility header is a compiler build product, not a Semantifold-owned source artifact.
- Reject nullable/implicitly unwrapped values, exceptions, blocks/closures, delegates, selectors as values, variadics, C pointers/arrays/structs, manual memory ownership, generics/protocol existentials, KVC/KVO, categories, method swizzling, runtime reflection/message forwarding, C++ types, Objective-C++, and arbitrary Apple frameworks.
- ARC is mandatory for the host fixture. The bridge defines string copying/lifetime and makes no portable object identity promise.

## Artifact, diagnostics, and provenance strategy

- Extend the Task 026 artifact set with deterministic generated Swift facade source, one bounded `.m` host/acceptance source, and build-setting entries needed for module/header interoperability. Do not emit a standalone Objective-C translation of semantic code.
- Validate selector uniqueness, Objective-C representability, nullability, module/product naming, deployment/compiler constraints, and the complete export surface before returning artifacts. Unsupported constructs fail with located `UNSUPPORTED_CAPABILITY`; unsafe names/collisions receive stable bridge diagnostics.
- Preserve source-to-Swift rich provenance and the applicable Task 015 text source map through facade calls, and record generated selector/conversion/host regions as derived or synthetic. Xcode-generated header line positions are not fabricated as Semantifold source maps.

## Deterministic real-toolchain tests

- In the configured macOS/Xcode lane, record Xcode/Swift/Clang versions, compile the mixed Swift/Objective-C target under ARC with warnings treated as errors, and invoke every accepted facade method from Objective-C.
- Run pure host tests and the iOS Simulator application test with exact results/output. Missing configured tools/simulator fails; no test downloads SDKs or invokes signing/distribution services.
- Test Unicode strings, integer boundaries, Boolean conversion, selector/name collisions, nullability, unsupported pointers/blocks/runtime features, transactional rejection, deterministic artifacts, and provenance.

## Documentation

Document that this is a legacy-host interop bridge, supported ABI/conversions/selectors, generated-header ownership, ARC and Xcode requirements, exclusions, and its separation from Objective-C source translation, Objective-C++, Metal, and application APIs. Add a behavior changelog fragment.

## Completion criteria

- A bounded Objective-C host can call exported generated Swift functions through the official Xcode interoperability mechanism with deterministic scalar behavior.
- Capability discovery reports `interop` only—not Objective-C frontend or general backend—and all excluded behavior fails before partial artifacts.
- Real mixed-language compiler/simulator, diagnostics, provenance, docs/changelog, and repository gates pass.

## Non-goals

Objective-C parsing or general code generation, semantic Objective-C object/runtime behavior, Objective-C++, Swift-to-C++ interop, Metal, manual reference counting, arbitrary framework exposure, header generation outside Xcode, or device/store delivery.
