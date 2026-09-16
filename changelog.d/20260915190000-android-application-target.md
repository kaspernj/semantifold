# Android application artifact target

- Add deterministic target-only Android/Kotlin application generation below `generated/android-app`, with closed configuration/resources, exact ownership hashes, and rich multi-module semantic provenance.
- Add a dependency-minimal native Activity/TextView shell, exact non-transitive test-implementation JUnit and test-runtime Hamcrest Core exceptions, checksum-pinned direct official Android SDK archives, strict lint with exact icon/latest-target exceptions for the owner-pinned API-35 matrix, offline Gradle checks, and a hardware-accelerated TensorBuzz API-35 emulator/relaunch lane.
- Keep generation in memory and expose no public materializer, signing, device, account, Play, permission, network, storage, service, Compose, WebView, NDK, or embedded-runtime behavior.
