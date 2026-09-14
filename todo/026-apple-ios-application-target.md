# 026 — Apple/iOS application artifact target

- Status: `in progress — generation/materialization implemented; Apple acceptance deferred`
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

## Partial implementation record — 2026-09-14

The authorized non-macOS scope is implemented on the Task 026 topic branch. The `ios` registry identity is application-only; it consumes Task 010 programs or normalized modules, enforces the Task 022 Tasks 001–004 Swift subset, lowers deterministic per-module captured Swift, and generates the unsigned SwiftUI/project/configuration/test/asset/manifest artifact set. Closed configuration/assets, exact hashes, rich Ruby-to-Swift provenance, deterministic Xcode IDs, byte-identical regeneration, and fail-loud diagnostics have focused coverage.

The separate public `materializeGeneratedArtifactSet` operation is create-only. It requires an absent absolute destination, performs full portable/symlink preflight, writes exclusively in an adjacent private stage, publishes by atomic rename, cleans only that stage on failure, and never implements regeneration/adoption/overwrite. Fresh packed-consumer checks repeat generation, materialization, dependency listing, and strict typing after ordinary install and clean `npm ci` with empty npm configs, fresh caches, the public registry, and no inherited credentials. Real Ruby output equals generated semantic Swift output under exact Swift 6.3.3 Linux debug and optimized builds.

Kasper's 2026-09-14 direction, “Lets skip OSX stuff for now and continue with the others,” explicitly defers the mandatory macOS/Xcode/Apple SDK/Swift/XCTest/XCUIAutomation/iOS Simulator lane and real `xcodebuild`/simulator acceptance. No TensorBuzz, Docker, or Compose infrastructure was changed to manufacture that proof. No Apple runtime was downloaded and no signing/account/team/certificate/provisioning route was used.

AC12–AC14 remain deferred: no qualified Xcode build/list/test result exists, no official named iOS Simulator has booted/installed/launched the app, and XCUIAutomation has not observed exact `semantifold-output` text. The generated Xcode format therefore remains platform-unqualified. Task 026 must not be marked delivered until those proofs and the remaining coordinator-owned review/CI/merge steps complete. Task 027 remains dependent on Task 026; Task 028 remains a separate Android lane.

## Non-goals

Running Ruby on iOS, arbitrary Ruby programs, UIKit parity, storyboard generation, device/App Store delivery, credential or provisioning management, arbitrary entitlements/assets, CocoaPods/SwiftPM dependencies, plugins, platform APIs, background modes, Objective-C bridging, Objective-C++, Metal, or non-iOS Apple platforms.
