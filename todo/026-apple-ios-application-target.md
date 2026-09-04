# 026 — Apple/iOS application artifact target

- Status: `todo`
- Phase/priority: Phase P / P1
- Dependencies: [010-multifile-modules-and-names.md](010-multifile-modules-and-names.md), [022-swift-source-and-target.md](022-swift-source-and-target.md)

## Purpose

Add an application-artifact backend that lowers a Semantifold semantic project to deterministic Swift sources and an Xcode-compatible iOS application project. The first showcase is a narrow Ruby source project compiled through the shared IR into a Swift application; no Ruby interpreter or Ruby runtime behavior is embedded in the app.

## Source/project and application profile

- Accept any Task 010 semantic project whose nodes are supported by the selected Swift backend. The initial mandatory Ruby fixture contains only explicitly typed portable pure logic plus deterministic text output; Ruby `eval`, reflection, monkey-patching, open classes, metaprogramming, threads, process/file/network APIs, gems, FFI, and native extensions are rejected by the Ruby frontend or application capability check.
- Lower portable logic to generated Swift. A generated SwiftUI shell invokes the semantic entry function, captures its deterministic output as `[String]`, and displays joined text in a stable accessibility-labelled view. UI lifecycle and output capture are backend scaffolding, not semantic nodes.
- Validate product/module name, organization prefix, reverse-DNS bundle identifier, deployment target, app display name, and source/resource paths. Supply documented deterministic defaults; never infer identity from credentials or a developer account.
- Baseline permissions and entitlements are empty. `Info.plist` keys and lifecycle configuration are explicit and allowlisted. Caller assets are opt-in inputs copied by exact path with content hashes; no app icon, privacy entitlement, capability, or permission is silently synthesized.

## Artifact and ownership strategy

- Return an ordered artifact set containing a deterministic `.xcodeproj/project.pbxproj`, shared scheme, generated semantic Swift files, `App.swift`, the view/output bridge, explicit `Info.plist`/configuration artifacts, `Assets.xcassets` metadata, UI test source, and a Semantifold project manifest recording generator version, inputs, toolchain constraints, and owned paths. Generate no entitlements file in the baseline; a future allowlisted entitlement must be explicit, deterministic, and manifest-owned.
- Derive stable Xcode object identifiers from normalized artifact identities with collision checks, sort groups/build phases/settings, normalize line endings, and avoid absolute workspace paths. Generate twice from identical inputs and require byte-identical pre-build artifacts.
- The manifest declares exactly which files are generator-owned. Refuse path traversal, symlink escape, case-fold collisions, unknown pre-existing files at owned paths, and overwriting caller-owned edits unless a separately designed explicit regeneration protocol proves the prior manifest/hash.
- Rich provenance and Task 015's applicable text source-map form map semantic Swift tokens to original modules (including Ruby locations), and mark UI/lifecycle/project syntax synthetic. Derived resource/configuration fields cite their configuration input. Build products, code signatures, and Xcode-mutated user data are not generated artifacts or reproducibility claims.

## Diagnostics and semantic boundaries

- Preflight the entire project, Swift capability set, names, bundle/configuration, asset graph, deployment target, and Xcode layout before returning artifacts. Use located `UNSUPPORTED_CAPABILITY` for unsupported semantic/Ruby behavior and stable application diagnostics for unsafe paths, identifiers, plist values, assets, entitlements, and project collisions.
- Do not translate unsupported Ruby behavior to JavaScript, embed a Ruby VM, shell out from the app, or emulate Ruby truthiness/exceptions/dynamic dispatch in Swift. Do not silently approximate UI, host APIs, storage, networking, concurrency, or runtime failures.
- iOS, macOS, watchOS, tvOS, visionOS, Catalyst, Objective-C, Objective-C++, Metal, and Apple APIs are distinct capabilities. This task initially supports one iOS SwiftUI application profile only.

## Deterministic simulator acceptance

- Run acceptance in a declared macOS/Xcode lane. Record `xcodebuild -version`, installed SDK, `swiftc --version`, and the exact simulator runtime/device. Missing Xcode or configured simulator fails that lane; Linux does not pretend to validate it.
- Use `xcodebuild` to list/validate the project and build/test a named local iOS Simulator destination with signing disabled where supported. Boot/install/launch via official Simulator tooling and assert the accessibility-labelled exact text through an XCTest UI test, plus exact pure-logic unit results.
- Local simulator acceptance requires no Apple distribution certificate, provisioning profile, registered device, or App Store credentials. Physical-device builds, automatic signing, Developer Program authentication, notarization, archives/export, TestFlight, App Store submission, and store metadata are outside baseline and cannot be discovered or automated silently.
- Include the Ruby-to-iOS fixture, a Swift-originating equivalent, Unicode/multi-module sources, invalid bundle/plist/asset/path cases, unsupported Ruby constructs, deterministic regeneration, source-to-Swift provenance, and target-capability rejection before partial output.

## Documentation

Document Ruby-to-iOS as semantic translation, exact project ownership/layout, configurable identities, UI/output contract, lifecycle/plist/assets/entitlements, provenance, Xcode/simulator prerequisites, regeneration rules, and signing/distribution exclusions. Add a behavior changelog fragment.

## Completion criteria

- A supported Ruby semantic project deterministically produces Xcode-compatible Swift application sources/artifacts, builds, launches, and displays the expected text in a real configured iOS Simulator without distribution credentials.
- No Ruby interpreter, gem, extension, or unsupported dynamic/runtime behavior is included or approximated.
- Artifact ownership/safety, simulator tests, real Xcode build, diagnostics, provenance, documentation/changelog, and repository gates pass.

## Non-goals

Running Ruby on iOS, arbitrary Ruby programs, UIKit parity, storyboard generation, device/App Store delivery, credential or provisioning management, arbitrary entitlements/assets, CocoaPods/SwiftPM dependencies, plugins, platform APIs, background modes, Objective-C bridging, Objective-C++, Metal, or non-iOS Apple platforms.
