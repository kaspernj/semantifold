# Android application target

Task 028 adds the target-only `android` application backend. It consumes a parsed semantic module or complete Task 010 program and returns an immutable `GeneratedArtifactSet`; it does not parse Android or Kotlin source, add Android nodes to semantic IR, discover source files, or expose a filesystem writer.

```js
const program = parseProgram({entryModule: "main", sources})
const project = generateProgramArtifactSet({
  language: "android",
  program,
  role: "application"
})
```

Every path is below fixed root `generated/android-app`. The set contains pinned settings/root/app Gradle Kotlin scripts, `gradle.properties`, one allowlisted manifest, mapped per-module semantic Kotlin, a checked scalar/output runtime, one `Activity`, one native XML `TextView`, label/theme resources, one JUnit unit test, a platform-only instrumentation test, and `semantifold-project.json`. There is no Gradle wrapper JAR or distribution, SDK, Maven archive, APK, key, cache, or binary tool in the returned project.

## Application contract

Configuration is a closed plain record. Unknown keys and public filesystem controls such as `outputDirectory`, `overwrite`, `sourcePath`, `sdkPath`, or `keystore` fail with `INVALID_APPLICATION_INPUT` or `INVALID_APPLICATION_CONFIGURATION` before source rendering.

Defaults are:

| Field | Default / accepted baseline |
| --- | --- |
| `applicationId` | `dev.semantifold.generated` |
| `namespace` | application ID |
| `packageName` | namespace |
| `activityClassName` | `MainActivity` |
| `productName`, `displayName` | `Semantifold` |
| `minimumSdk`, `targetSdk`, `compileSdk` | `23`, `35`, `35` |
| `buildToolsVersion` | `35.0.0` |
| `versionCode`, `versionName` | `1`, `1.0.0` |
| `orientation`, `theme` | `unspecified`, `system` |

Application/package segments are lowercase Java/Kotlin identifiers and cannot be keywords. The activity is an ASCII upper-camel identifier and cannot shadow an unqualified symbol used by the generated Activity, unit test, or instrumentation scaffold. Labels are trimmed Unicode-scalar strings of at most 64 characters. SDK values are the qualified fixed matrix, version code is positive and Android-bounded, and version name is canonical. The permission allowlist is empty.

The manifest contains exactly one exported launcher activity and no permissions, services, receivers, providers, deep links, network/storage access, or background work. The activity runs the semantic entry afresh and joins captured output with one LF between printed values. The sole native `TextView` has ID `semantifold_output` and is accessibility-important; its visible text is the accessibility-node text, so no redundant `contentDescription` is generated.

## Semantic and provenance boundary

The Android backend preflights the complete program using the independent Kotlin backend capability profile. It then emits application-owned namespaced Kotlin modules and threads one output sink through resolved calls. The sink is reset for every entry invocation. Kotlin identifiers, literals, operators, calls, functions, parameters, locals, and statements retain rich Task 015 mappings and Source Map v3 projections to all original source identities and filenames. Gradle, Android manifest, resource, activity, lifecycle, and test syntax remains synthetic or configuration-derived.

`SemantifoldAndroidProject` version 1 records exact normalized configuration, the ordered owned path set and hashes, excluded build/cache paths, input hashes, field-to-output ranges, semantic source/module/import/entry identities, synthetic scaffolding, and exact toolchain requirements. Caller resources and assets are detached before return. Binary inputs use full-content byte provenance.

Resources are opt-in closed records `{path, content, mediaType, sha256}`. Supported resource paths are `raw/<safe-name>` and PNG/WebP density drawables under `drawable-mdpi`, `drawable-hdpi`, `drawable-xhdpi`, `drawable-xxhdpi`, or `drawable-xxxhdpi`. Assets use safe portable relative paths below `app/src/main/assets`. Traversal, absolute/NUL/Unicode-ambiguous paths, unsupported qualifiers/types, checksum mismatches, generated-file conflicts, duplicate Android identifiers in one resource configuration, case-fold collisions, and file/directory-prefix collisions fail before any artifact set is returned.

Generation itself is byte-identical and has no filesystem state, so stale files cannot survive inside its returned ownership list. The repository-private acceptance helper writes only to a caller-created empty mode-0700 temporary directory, uses exclusive file creation, verifies every checksum, refuses symlink/non-empty roots, and is not exported or packed. It is not a durable materializer.

## Toolchain and offline acceptance

The qualified application lane is independent of the generic Kotlin/JVM compiler lane:

- Gradle `8.13`, distribution SHA-256 `20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78`
- Android Gradle Plugin `8.11.1`
- Kotlin Gradle plugin and command-line compiler `2.2.10`, compiler ZIP SHA-256 `302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc`
- Eclipse Temurin JDK `21.0.8+9`, archive SHA-256 `f2dc5418092c43003db8f9005c4a286e1c0104fea96ccdd49e8ebd037cac9219`
- command-line tools build `11076708`, archive SHA-256 `2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258`
- platform/target API `35`, Build Tools `35.0.0`
- emulator `35.6.11` build `13610412` and `system-images;android-35;google_apis;x86_64` revision `9`

Every Android SDK payload is a direct immutable official archive verified before extraction; no mutable package channel participates:

| SDK input | Exact archive | SHA-256 |
| --- | --- | --- |
| command-line tools | `commandlinetools-linux-11076708_latest.zip` | `2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258` |
| platform-tools 37.0.1 | `platform-tools_r37.0.1-linux.zip` | `d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1` |
| Android Platform 35 revision 2 | `platform-35_r02.zip` | `0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0` |
| Build Tools 35.0.0 | `build-tools_r35_linux.zip` | `bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88` |
| Emulator 35.6.11 build 13610412 | `emulator-linux_x64-13610412.zip` | `2fe2b56fe93ce75e1d478a40162131381d911c355efeaedb54dd1e0d0897a5cf` |
| Google APIs x86_64 API-35 revision 9 | `x86_64-35_r09.zip` | `c67b9ba0ff5bc0eb6d046871bfa228af14d4d47b02f0cdae94f048e511b7566e` |

The Android repository archives above come from Google's official [`repository2-3.xml`](https://dl.google.com/android/repository/repository2-3.xml) and [`sys-img2-3.xml`](https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml) package metadata; the emulator build and published SHA-256 come from the official [Android Emulator download archive](https://developer.android.com/studio/emulator_archive). `scripts/bootstrap-android.sh` is the only online preparation stage. It verifies immutable archives, installs them directly, verifies their embedded exact revision metadata, creates the named API-35 AVD, and warms the fixed Gradle cache with a disposable project. `scripts/accept-android.sh` generates a fresh project, creates its ephemeral debug key only inside the private acceptance root, and runs lint, JUnit, debug application assembly, and instrumentation assembly with Gradle `--offline` plus pinned UTF-8, English, UTC, heap, no-daemon, no-parallel, no-build-cache settings. Missing tools, package revisions, or cache content fail with `SEMANTIFOLD_ANDROID_INFRASTRUCTURE` rather than skipping.

The only declared Gradle library dependency is non-transitive `testImplementation("junit:junit:4.13.2")`. Kotlin's implicit stdlib dependency is disabled. Compilation reads the checksum-pinned compiler distribution's `kotlin-stdlib.jar` directly as a compiler task input, not as a Gradle dependency; generated bytecode uses JVM/Android platform facilities and the file is never placed on a runtime configuration or packaging input. Acceptance requires an empty debug runtime dependency graph, exact JUnit alone in the unit-test runtime graph, and no JUnit, Hamcrest, `kotlin/jvm/internal`, or `kotlin/collections` payload in the application APK.

Real emulator acceptance runs only in TensorBuzz with `/dev/kvm:/dev/kvm`. It fails before startup unless `/dev/kvm` is usable and `emulator -accel-check` affirms acceleration, exclusively locks fixed `emulator-5580` plus its private adb server on port `5581`, never invokes `adb root` or changes KVM permissions, boots with `-accel on -wipe-data -no-snapshot`, installs both APKs, launches the app, and invokes the runner through the explicit `<applicationId>.test` test application ID. Exact UTF-8 output is passed as base64 to platform instrumentation. The test checks the native labelled view, exact text, visibility, class, accessibility importance, absent content description, and activity recreation. CI then stops that emulator, boots a second fresh emulator, reinstalls/relaunches, and repeats. Screenshots/UI XML are always produced; failure also records logcat, adb state, emulator command line, and an exact reason.

Local environments without KVM do not attempt software emulation. Release signing, physical devices, accounts, Play Console, publication, Compose, fragments/navigation, WebView, platform channels, NDK/JNI, reflection, permissions, services, storage/networking, and background behavior are outside Task 028.
