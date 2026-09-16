# 028 — Kotlin/Android application artifact target

- Status: `implemented locally — TensorBuzz offline build/KVM emulator acceptance and merge pending`
- Phase/priority: Phase P / P1
- Dependencies: [010-multifile-modules-and-names.md](010-multifile-modules-and-names.md), [023-kotlin-source-and-target.md](023-kotlin-source-and-target.md)

## Purpose

Add an Android application-artifact backend that lowers a supported semantic project to Kotlin logic and a deterministic Gradle/Android application shell. Kotlin/JVM language support remains independent; Android lifecycle, SDK, resources, packaging, and emulator behavior stay in this task.

## Project and application profile

- Accept any Task 010 project supported by the Kotlin backend. A generated activity invokes the semantic entry, captures deterministic output, and renders exact text in one accessibility-labelled Android view; lifecycle and UI plumbing remain synthetic backend artifacts.
- Validate application ID/namespace, package/class/product names, minimum/target/compile SDK levels, version metadata, orientation/theme choices, and resource paths. Use documented deterministic defaults and no ambient Gradle/Android Studio settings.
- Emit no baseline permissions, services, receivers, providers, deep links, network/storage access, background work, or platform API nodes. Manifest entries are explicit and allowlisted, including the launcher activity and required exported state.
- Caller resources/assets are opt-in, path-safe, hash-recorded inputs. Density/resource qualifier and name collisions fail rather than being renamed or selected implicitly.

## Artifact and ownership strategy

- Return an ordered, deterministic project: pinned `settings.gradle.kts`, root/app Gradle Kotlin scripts, `gradle.properties`, Android manifest, Kotlin semantic/activity sources, resources, instrumentation test, and a Semantifold ownership/toolchain manifest.
- Do not bundle a Gradle distribution/wrapper JAR, Android SDK, Maven artifact, archive, keystore, or binary dependency. The task must record qualified compatible Gradle, Android Gradle Plugin, Kotlin, JDK, build-tools, and SDK versions; builds use installed/cached official artifacts in an offline acceptance environment.
- Sort declarations/resources, avoid absolute paths, derive stable identities, and reject traversal, symlink escape, case/resource collisions, or unsafe overwrites. Pre-build generation is byte-identical; Gradle caches, APK metadata/signatures, and build outputs are not claimed as deterministic source artifacts.
- Map Kotlin semantic tokens back to all input modules in rich provenance and the applicable Task 015 text source map; mark activity/lifecycle/resource/Gradle syntax synthetic or configuration-derived. Preserve source filenames through compiler diagnostics where supported.

## Diagnostics and fail-loud boundaries

- Preflight semantic/Kotlin capabilities, all identifiers/SDK settings, manifest, resources, and complete layout transactionally. Unsupported semantic behavior is `UNSUPPORTED_CAPABILITY`; unsafe application configuration and resource errors use stable application diagnostics.
- Do not implement unsupported behavior with reflection, generated platform channels, embedded source runtimes, WebViews, network services, or exception/concurrency approximations.

## Deterministic emulator acceptance

- Record exact Java, Kotlin, Gradle, Android SDK/build-tools, emulator, and system-image versions. Missing declared tools or the configured emulator image fails the Android lane.
- Build offline with Gradle, run Android lint/unit checks, assemble a debug/simulator-only APK, boot a named clean emulator, install/launch with `adb`, and assert exact labelled UI text through an instrumentation/UI assertion. Capture deterministic logs on failure.
- Debug/emulator signing may use an isolated ephemeral debug key managed only inside the test directory. Release signing keys, real devices, account credentials, Play Console/upload/submission, store metadata, and production rollout are outside baseline and never discovered or automated.
- Cover multi-module/Unicode logic, lifecycle relaunch, invalid app IDs/manifests/resources/SDK combinations, missing caches/tools, artifact regeneration, provenance, and rejection before partial output.

## Documentation

Document project ownership/layout, version pins and offline caches, application identity/manifest/resources, UI/lifecycle profile, emulator setup, provenance, regeneration, debug-signing boundary, and Play/device exclusions. Add a behavior changelog fragment.

## Completion criteria

- A supported semantic project deterministically generates a Kotlin Android project, builds offline with the declared real toolchain, installs/launches on the configured emulator, and displays exact expected text.
- No platform permission, credential, dependency, runtime behavior, or semantic approximation is silently introduced.
- Artifact safety, emulator/toolchain tests, diagnostics, provenance, docs/changelog, and repository gates pass.

## Implementation record — 2026-09-15

The topic implementation registers application-only target `android` through the existing artifact APIs. Complete configuration/program/resource/path preflight precedes mapped Kotlin rendering; the fixed `generated/android-app` set contains pinned Gradle scripts, a closed manifest, resettable semantic output capture, one native Activity/TextView, tests, and `SemantifoldAndroidProject` ownership/toolchain/provenance metadata. No public filesystem materializer is exported.

The qualified matrix is Gradle 8.13, Android Gradle Plugin 8.11.1, Kotlin plugin 2.2.10, Temurin JDK 21.0.8, compile/target API 35, minimum API 23, Build Tools 35.0.0, command-line tools 11076708, immutable emulator 35.6.11 build 13610412, and immutable `system-images;android-35;google_apis;x86_64` revision 9. Online bootstrap checksum-verifies every direct official archive and is separate from the actual offline lint/unit/assemble/dependency/APK checks. The sole library exceptions are exact non-transitive `testImplementation("junit:junit:4.13.2")` and `testRuntimeOnly("org.hamcrest:hamcrest-core:1.3")`, with empty application runtime and APK leakage rejection.

TensorBuzz owns the real acceptance route with exactly `/dev/kvm:/dev/kvm`: it requires hardware acceleration, boots a clean fixed-port emulator, installs/launches/asserts exact accessible Unicode output, captures UI diagnostics, stops it, then repeats on a second fresh emulator. Local environments without KVM do not substitute software emulation. Final delivered status remains coordinator-owned after exact-head CI and merge.

## Non-goals

General Android API modeling, Compose parity, fragments/navigation, services/background work, permissions, network/storage, NDK/JNI, third-party Gradle dependencies beyond the approved exact non-transitive test-scope JUnit and Hamcrest Core exceptions, release/device signing, Play Store delivery, or Kotlin multiplatform.
