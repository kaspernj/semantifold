# 030 — Dart/Flutter application artifact target

- Status: `todo`
- Phase/priority: Phase P / P2
- Dependencies: [010-multifile-modules-and-names.md](010-multifile-modules-and-names.md), [028-android-application-target.md](028-android-application-target.md), [029-dart-source-and-target.md](029-dart-source-and-target.md)

## Purpose

Add a Flutter application-artifact backend that lowers a supported semantic project to generated Dart logic and a deterministic Flutter widget/application project for Android and iOS simulator acceptance. Flutter is an application lane, not a new source language; Task 029 owns Dart syntax and runtime semantics.

## Project and application profile

- Accept any Task 010 project supported by the Dart backend, including a Ruby-originating project after normalization. A generated widget shell invokes portable logic, captures deterministic output, and displays exact joined text under a stable `Key` and semantics label.
- Support one stateless, SDK-only Material application profile. Widget lifecycle, layout, platform runners, test bindings, and output capture are synthetic artifacts and never semantic IR nodes.
- Validate Dart package name, organization/application IDs, display name, Android/iOS deployment settings, version metadata, and resource paths. Use deterministic documented defaults.
- Baseline has no plugins, platform channels, network/storage, permissions, background work, arbitrary navigation/state, or host API access. Caller assets/fonts are explicit path-safe hash-recorded inputs with allowlisted `pubspec.yaml` entries.

## Artifact and ownership strategy

- Return a deterministic Flutter project containing pinned SDK constraints, `pubspec.yaml`, generated Dart semantic/widget sources, unit/widget/integration tests, Android and iOS runner/project/configuration sources, resources, and a Semantifold ownership/toolchain manifest.
- Depend only on packages shipped by the qualified Flutter SDK. Do not fetch pub packages, copy SDK archives, bundle CocoaPods/Gradle distributions, or execute `flutter create` as an unreviewed source of changing files; the owning task must version and test the exact emitted template.
- Declare every owned path/hash and reject traversal, symlink escape, case/resource collisions, or unsafe overwrite. Pre-build files are byte-identical; caches, pods, Gradle/Xcode output, APK/app bundles, and signatures are excluded from deterministic generation claims.
- Map generated Dart logic to all input source locations through rich provenance and the applicable Task 015 text source map; record widget, runner, manifest, plist, Gradle/Xcode, and resource metadata as synthetic or configuration-derived. Preserve compiler diagnostic correlation where toolchains expose it.

## Diagnostics and fail-loud boundaries

- Preflight semantic/Dart capabilities, project identities, manifests/plists, platform versions, resources, and complete layout before returning artifacts. Unsupported meaning uses located `UNSUPPORTED_CAPABILITY`; unsafe configuration/artifacts use stable application diagnostics.
- Never approximate unsupported source behavior through a plugin, WebView, embedded runtime, platform channel, exception handler, isolate, native code, or network service.

## Deterministic simulator/emulator acceptance

- Record exact Flutter/Dart, Java/Gradle/Android SDK/emulator, Xcode/Swift, and iOS Simulator versions in their declared jobs. Missing required tools/images fails the platform lane.
- Run offline Dart analysis and unit/widget tests, build/install/launch on a clean configured Android emulator, and assert the labelled exact output through integration testing. Reuse Task 028's emulator/toolchain isolation contract.
- In the configured macOS job, build/test/launch the same project on a named iOS Simulator without distribution credentials and assert the same labelled output. Both platform jobs are required before the task claims both application targets.
- Debug/simulator signing is isolated and local. Device builds, release signing/provisioning, credential discovery, app-store upload/submission, and automatic plugin/native dependency installation remain outside baseline.
- Cover Unicode/multi-module projects, Ruby- and Dart-originating logic, lifecycle relaunch, identifier/manifest/plist/asset failures, deterministic regeneration, provenance, and transactional capability rejection.

## Documentation

Document the project/template ownership, supported Flutter SDK and offline caches, Dart/application split, UI contract, assets and identities, Android/iOS test setup, signing/store exclusions, mappings, and regeneration rules. Add a behavior changelog fragment.

## Completion criteria

- A supported semantic project deterministically produces an SDK-only Flutter project with equivalent Dart logic and exact UI output on real configured Android emulator and iOS Simulator lanes.
- No plugin, external package, embedded source runtime, permission, credential, or unsupported semantic behavior is introduced silently.
- Toolchain/platform tests, artifact safety, diagnostics, provenance, docs/changelog, and repository gates pass.

## Non-goals

Arbitrary Flutter widgets/state/navigation, plugins/platform channels, web/desktop Flutter, host APIs, external pub packages, CocoaPods dependencies, physical devices, release signing, or App Store/Play Store delivery.
