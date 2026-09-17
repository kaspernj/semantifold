# Flutter application target

Task 030 adds the target-only `flutter` application backend. Flutter is not a source language: callers parse any existing source language into a semantic module or Task 010 program, then request an application artifact set.

```js
const program = parseProgram({entryModule: "main", sources})
const project = generateProgramArtifactSet({
  language: "flutter",
  program,
  role: "application"
})
```

The current qualified slice is Android-only. Every generated path is below `generated/flutter-app`; no iOS runner is emitted. macOS, Xcode, Apple SDK, CocoaPods, signing, iOS Simulator build/launch, and iOS UI proof remain explicitly deferred by owner direction. The registry and project manifest report that boundary rather than treating an absent Apple toolchain as a skip or claiming dual-platform completion.

## Application and package contract

The backend accepts exactly the semantic subset already supported by the Dart backend. It emits mapped, namespaced Dart parts plus a synthetic stateless Material shell. Each invocation creates a fresh output sink, executes the semantic entry, joins printed values with LF, and displays the exact result below `Key('semantifold-output')` and the `semantifold-output` semantics label. Widget lifecycle and platform-runner behavior do not enter semantic IR.

The emitted template is owned and versioned by Semantifold; generation never invokes `flutter create`. Its Android configuration excludes the inactive profile-installer optimization and removes the SDK embedding's dynamic-receiver permission and startup provider; final-APK acceptance requires zero permissions, providers, receivers, or services. Its package manifest has only direct Flutter-SDK dependencies:

- `flutter` from the SDK;
- `flutter_test` from the SDK as a development dependency.

The exact lockfile records the transitive test/runtime packages shipped in the checksum-qualified Flutter archive. Restore is always offline from the archive's preload cache and uses `--enforce-lockfile`; application generation and tests never download a pub package. There are no plugins, platform channels, permissions, external packages, embedded source runtimes, network/storage/background behavior, navigation, or mutable widget state.

Configuration is a closed record. Defaults are `semantifold_generated`, organization `dev.semantifold`, application ID `dev.semantifold.generated`, activity `MainActivity`, display name `Semantifold`, version `1.0.0+1`, minimum SDK 23, target/compile SDK 35, and Build Tools 35.0.0. Package and reverse-DNS identities, Java activity name, Unicode display name, version values, the empty permission set, and the exact Android matrix are validated before rendering. A root package name cannot collide with any SDK or hosted package in the owned lockfile, and the launcher class cannot collide with its imported `FlutterActivity` base class.

Assets are explicit closed records `{path, content, mediaType, sha256}` below `assets/`. Content is detached before return. Traversal, absolute or unsafe paths, Unicode/case collisions, file-prefix collisions, generated-path conflicts, malformed media types, empty content, and checksum mismatches fail transactionally.

## Ownership and provenance

`SemantifoldFlutterProject` version 1 records every owned path and SHA-256, excluded cache/build/local-configuration paths, normalized configuration and exact output ranges, asset hashes, semantic source/module/import/entry identities, synthetic scaffolding, platform status, and toolchain identity. Dart semantic tokens—including ordinary source `print` syntax—preserve rich mappings and Source Map v3 projections to all original source files. The Flutter output sink, Material widgets, tests, Android runner, Gradle files, manifests, resources, and template metadata are synthetic or configuration-derived. Generated zero-argument declarations and calls retain the pinned Dart formatter's multiline layout before toolchain validation.

The private acceptance materializer writes only to one caller-created empty, real, mode-0700 directory. It uses exclusive creation, reads every file back, verifies checksums, removes partial generated output on failure, and is neither exported nor packed. Generated `android/local.properties`, caches, debug keys, Gradle outputs, and APKs belong only to disposable acceptance state.

## Exact Android qualification

Flutter is pinned to stable `3.47.4`, framework revision `9584c6713b324636289d067944a46fd6b49df14b`, bundled Dart `3.13.3`, archive size `1576174568`, and SHA-256 `5b45f0ceda99b9bebdc873e7e69f6450aeb4c30f454b505e2e62fc9255a907d3`. The generated Android project reuses Task 028's API-35/Build-Tools-35.0.0, AGP 8.11.1, JDK 21.0.8, emulator 35.6.11, private signing root, and sole TensorBuzz `/dev/kvm` topology. Its engine build pins Kotlin Gradle plugin 2.2.20, NDK 27.0.12077973, and CMake 3.22.1; Kotlin's implicit standard-library dependency remains disabled and generated applications contain no Kotlin source or user native code. The shared Gradle baseline advances to checksum-pinned 8.14 because Flutter 3.47.4 rejects 8.13; dependency validation is not bypassed and no second Gradle/cache topology is introduced.

Online bootstrap downloads only the exact Flutter archive, validates it before installation, seeds the isolated pub cache from its 186 included preload archives, and warms the already-shared Gradle cache with a disposable project. Offline acceptance then enforces the lockfile, checks formatter canonicality, runs analyzer with fatal warnings/information, runs real Flutter unit/widget tests, and runs Android lint and debug assembly. It verifies the exact package graph, SDK-owned Flutter embedding, empty declared permission surface, and produced APK.

The existing Android emulator script remains the only device lane and still performs exactly two fresh hardware-accelerated API-35 boots. Each boot retains the native Task 028 proof, then installs and launches the Flutter APK, captures UI XML and a screenshot, and requires exactly one `semantifold-output` Android semantics descriptor with exactly one descendant descriptor containing the exact Unicode output. Native same-node text and the previously owned combined descriptor remain accepted exact forms. Failure diagnostics report the observed descriptor/text values without accepting unrelated UI text. Missing KVM, SDK artifacts, cached dependencies, tools, label, output, or clean teardown fails loudly. Local environments without KVM do not substitute software emulation.

## Deferred and excluded work

No result from this slice establishes iOS support. Dual-platform Task 030 completion remains blocked on separately authorized real Apple toolchain and iOS Simulator proof. Web/desktop Flutter, arbitrary widgets/state/navigation, plugins, platform channels, host APIs, external pub packages, native extensions, physical devices, release signing, store upload, and deployment remain outside the baseline.
