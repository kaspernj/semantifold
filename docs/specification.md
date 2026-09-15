# Application artifact specification

Application targets are target-only registry roles over semantic IR. They consume exactly one semantic module or one complete Task 010 program, validate their entire configuration/capability/path graph before rendering, and return one immutable in-memory `GeneratedArtifactSet`. Platform lifecycle, UI, build, resource, signing, and host syntax never enter semantic nodes.

The delivered Android profile is specified in [Android application target](android.md). Its fixed `generated/android-app` ownership root, closed input records, mapped semantic Kotlin, synthetic native Activity/view, no-permission manifest, toolchain pins, offline build, JUnit test-only exception, and KVM emulator proof are normative. The partial Apple profile remains specified separately in [iOS application target](ios.md).
