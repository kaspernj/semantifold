# 046 — Binary and application-target watch policies

- Status: `roadmap; later non-blocking extension`
- Phase/priority: Phase W / P2 later platform policy
- Dependencies: [021-browser-webassembly-target.md](021-browser-webassembly-target.md), [028-android-application-target.md](028-android-application-target.md), [030-flutter-application-target.md](030-flutter-application-target.md), [043-deterministic-watch-coordinator.md](043-deterministic-watch-coordinator.md), [045-all-text-language-watch-check-acceptance.md](045-all-text-language-watch-check-acceptance.md)
- Related deferred boundary: [026-apple-ios-application-target.md](026-apple-ios-application-target.md)
- Design: [Watch, build, and target-check pipeline](../docs/watch-build-pipeline.md)

## Objective

Define and implement explicit watch/check policies for current non-text targets—browser WebAssembly, Android, iOS, and Flutter—without making heavy platform builds the default per-keystroke behavior or reopening deferred Apple acceptance.

## Current evidence and gap

The registry exposes target-only roles with materially different acceptance declarations:

- WebAssembly: generate, validate, instantiate, execute with WABT/Node/Chromium;
- Android: generate, compile, validate, instantiate, execute with the pinned Android lane;
- Flutter: generate, restore, compile, validate, instantiate, execute with Flutter/Android;
- iOS: deterministic generation only; Xcode/iOS Simulator materialization and acceptance remain deferred.

A text-target compiler default would misrepresent these costs and host constraints. The generic watcher may drive generation, but each target needs an explicit policy for developer check depth, debounce, caches, platform availability, and diagnostic truthfulness.

## Planned policies

- **WebAssembly:** provide a bounded developer check using the existing independent validator and safe instantiation contract. Browser execution remains an explicit acceptance profile, not automatic on every edit.
- **Android:** generation watch is supported. Gradle compile/package and emulator/instrumentation checks are explicit opt-in profiles with longer coalescing and the existing pinned offline SDK/Gradle/KVM lane. No store/release signing.
- **Flutter:** generation watch is supported. Offline restore/build and Android device checks are explicit opt-in profiles; plugin/platform-channel discovery remains prohibited.
- **iOS:** generation-only disposition is public and fail-loud when a compile/device check is requested. Do not add `xcodebuild`, Simulator, signing, or Objective-C work until Kasper explicitly resumes the Apple task.
- Application target checks reuse the generic exact-plan/process/reporting contracts but may declare higher cost and host/platform prerequisites. The coordinator still permits only one active child and leaves the last-good project-generation pointer unchanged on failure.

## Tests

- Registry/public capability accurately distinguishes generation-only, validate/check, platform-build, and device-acceptance profiles.
- Real Wasm validation uses the current qualified tools and transactional publication.
- Android/Flutter generation watcher tests are local/focused; configured platform-build/device acceptance runs only in the existing TensorBuzz lanes and fails rather than skips when that lane claims support.
- Requesting iOS compile/check returns the explicit unsupported/deferred diagnostic before tool discovery or output mutation.
- Slow-profile edit bursts, shutdown, cache isolation, and failure/recovery leak no child/emulator/build staging ownership.

## Documentation

Document per-target profile costs/prerequisites, opt-in commands, generation-only versus checked state, CI ownership, and Apple deferral. Add a behavior changelog fragment when implemented.

## Non-goals

Apple/Xcode/iOS Simulator acceptance, Objective-C interoperability, signing/provisioning/store submission, device registration, hot reload, continuous emulator/browser sessions, production deployment, or making slow platform profiles the text-target default.

## Completion criteria

- Each current binary/application target reports a truthful explicit watch/check disposition.
- WebAssembly and supported Android/Flutter profiles reuse the generic watcher while respecting existing real-tool/platform lanes.
- iOS remains explicitly generation-only; no Apple task is reopened or silently claimed.
- Focused lifecycle/registry tests, platform CI where declared, lint/typecheck, docs, and changelog satisfy repository gates.
