# iOS application target

Task 026 has an implemented Linux-qualified generation and materialization slice and an explicitly deferred Apple-platform acceptance slice. The registered `ios` identity is a target-only application backend: it has no frontend, text backend, binary-backend route, interoperability bridge, provider role, source-discovery behavior, or entry in `supportedLanguages`. Real Xcode, Apple SDK, XCTest, XCUIAutomation, and iOS Simulator proof has not been run, so the task is not delivered and the generated Xcode model is not yet platform-qualified.

## Public route

Callers parse source normally, build an explicit Task 010 program, and request the application role. Omitting `role` retains ordinary text generation. Generation is pure and performs no filesystem access.

```js
import {
  generateProgramArtifactSet,
  materializeGeneratedArtifactSet,
  parseProgram
} from "semantifold"

const program = parseProgram({
  entryModule: "main",
  sources: [{
    filename: "main.rb",
    id: "main",
    language: "ruby",
    source: "module Main\n  puts 7\nend\n"
  }]
})

const artifactSet = generateProgramArtifactSet({
  configuration: {
    bundleIdentifier: "com.example.semantifold",
    deploymentTarget: "18.0",
    displayName: "Semantifold",
    moduleName: "SemantifoldApp",
    organizationPrefix: "com.example",
    productName: "SemantifoldApp"
  },
  language: "ios",
  program,
  role: "application"
})

await materializeGeneratedArtifactSet({
  artifactSet,
  destination: "/absolute/absent/SemantifoldApp"
})
```

`generateArtifactSet` accepts the same application fields for one semantic module and normalizes it to one project module. Both routes validate the entire semantic graph before rendering. The supported semantics are exactly the Tasks 001–004 Swift subset from Task 022: typed scalar values, typed locals/assignment, the closed scalar operators, nested statement blocks/conditionals, exact two-argument scalar-return functions, resolved calls, and deterministic text output. Task 010 owns project modules, source ownership, imports, exports, and dependency order. iOS adds no parser rule or semantic node for SwiftUI, application lifecycle, capture, configuration, resources, signing, or Apple APIs.

Unsupported source or caller-supplied IR produces a located `SemantifoldDiagnostic` with `UNSUPPORTED_CAPABILITY` and target `ios`. The backend never embeds Ruby, invokes a Ruby runtime from the app, translates through JavaScript, emulates dynamic Ruby behavior, or discovers sources/packages.

## Closed configuration and assets

The required configuration fields are `productName`, `moduleName`, `organizationPrefix`, `bundleIdentifier`, `deploymentTarget`, and `displayName`. They are caller-owned; no account, team, certificate, provisioning profile, installed SDK, or host path supplies a default. Product and module names are ASCII upper-camel identifiers. Organization and bundle identities are canonical lowercase reverse DNS, and the bundle must extend the organization prefix. Deployment is a canonical caller-supplied `major.minor` string.

The only defaults are:

| Field | Exact value |
| --- | --- |
| `sourceRoot` | `Sources` |
| `resourceRoot` | `Assets.xcassets` |
| `lifecycle` | `swiftui` |
| `infoPlist` | empty object |
| `permissions` | empty array |
| `entitlements` | empty array |
| `privacyDeclarations` | empty array |
| `capabilities` | empty array |

The schema is closed. Unknown fields, any nonempty plist extension/capability set, alternate lifecycle/root, or invalid identity fails before emission. The baseline creates no entitlements file and does not synthesize an icon.

Every asset is explicit `{path, content, mediaType, sha256}` input. Its path must be safe and below `Assets.xcassets`, its content is a nonempty exact string or `Uint8Array`, and its lowercase SHA-256 must match the exact UTF-8 text or bytes. Assets are defensively copied and sorted. Duplicate, Unicode-normalization/case-fold, and file/directory-prefix collisions fail before an artifact set is returned.

## Deterministic artifact contract

Generation returns one ordered `GeneratedArtifactSet` with exactly one `entry`, `Sources/Application/App.swift`. The fixed categories are:

1. `<Product>.xcodeproj/project.pbxproj` and its shared scheme;
2. `Configuration/Base.xcconfig` and `Configuration/Info.plist`;
3. the shared semantic runtime and one namespace-owned Swift file per project module;
4. `App.swift`, `SemantifoldBridge.swift`, and `SemantifoldOutputView.swift`;
5. base `Assets.xcassets/Contents.json` and exact caller assets;
6. pure-logic XCTest and accessibility-route XCUI test sources;
7. `semantifold-project.json`.

The semantic renderer uses one shared reference-type `SemantifoldOutputSink`. Nested calls receive that same sink, preserving exact evaluation/output order. The semantic entry returns `[String]`; the bridge invokes it; the SwiftUI view joins with one LF and assigns accessibility identifier `semantifold-output`. Per-module Swift lives in deterministic `SemantifoldModule…` namespaces.

Xcode object IDs are the uppercase first 24 hexadecimal digits of built-in SHA-256 over normalized, collision-checked full identities. Project sections, groups, build phases, build settings, paths, configuration JSON, and assets have canonical ordering; text uses LF and relative paths. Signing is disabled and no entitlement/team/account/certificate/provision data is emitted. Two generations from the same validated input are byte-identical before any Apple build tool can mutate a materialized project.

## Manifest and provenance

`semantifold-project.json` is `SemantifoldIosProject` version 1. It records generator identity/version, target, the complete normalized configuration, caller source and asset hashes, exact ordered owned paths, explicit excluded path patterns, and Apple tool requirements whose status is `deferred`.

Mapped semantic Swift retains rich UTF-16 range provenance and Source Map v3 projection through every originating module, including Ruby. Synthetic runtime, SwiftUI, project, configuration, asset-catalog base metadata, and test scaffolding carry explicit synthetic provenance. The manifest contains configuration-field citations with JSON pointers and exact output ranges when the caller scalar appears literally. Exact assets record path, media type, representation, and SHA-256; binary artifact provenance spans every byte.

Build products, `DerivedData`, Xcode user data, code signatures, and caller files outside the owned path list are excluded. The manifest is not permission to overwrite or adopt a project.

## Create-only materialization

`materializeGeneratedArtifactSet({artifactSet, destination})` is a separate explicit filesystem operation. `destination` must be a normalized absolute absent path below an existing real directory. Existing files, directories, symlinks, case-fold-equivalent siblings, symlinked parent components, unsafe artifact paths, duplicates, portable case-fold collisions, and file/directory-prefix collisions are refused.

The materializer revalidates the complete set and destination before creating anything. It creates an adjacent private stage, makes directories in deterministic parent-first order, writes each file exclusively, rejects symlinks/non-files in the stage, rechecks the destination, and publishes with one same-filesystem atomic directory rename. Failure removes only that private stage. It never overwrites, adopts, or removes the requested destination or another caller path. Regeneration and merge-into-existing-project behavior are not implemented; callers must choose a new absent destination.

## Acceptance status

| Criterion | Status | Evidence or remaining boundary |
| --- | --- | --- |
| AC01 | implemented | Complete Task 010 graph preflight and Tasks 001–004 lowering are focused-spec covered. |
| AC02 | partial | SwiftUI shell/bridge/view and capture are generated; real Apple compilation is deferred. |
| AC03 | implemented | Closed caller configuration and identity validation are covered. |
| AC04 | implemented | Empty capabilities and exact hashed assets are covered. |
| AC05 | partial | Canonical project, IDs, paths, LF, and double generation are covered; `xcodebuild` validation is deferred. |
| AC06 | partial | Unit/UI sources and Linux semantic execution exist; real XCTest/XCUI execution is deferred. |
| AC07 | implemented | Create-only preflight, exclusive staging, refusal, cleanup, and atomic publication are covered. |
| AC08 | implemented | Ruby/Swift semantic, synthetic, configuration, ownership, and asset provenance are covered. |
| AC09 | implemented | Located capability and stable application/materialization diagnostics are covered. |
| AC10 | implemented | Real Ruby output equals generated Swift output in debug and optimized Linux execution. |
| AC11 | implemented | No VM, runtime emulation, credentials, entitlements, dependencies, signing, or host leakage is emitted. |
| AC12 | deferred | No qualified macOS/Xcode/Apple SDK/Swift compiler lane has listed or built the project. |
| AC13 | deferred | No named iOS Simulator has been booted, installed to, or launched. |
| AC14 | deferred | No XCTest/XCUIAutomation run has observed exact `semantifold-output` text. |
| AC15 | implemented locally | Focused generation/materialization/packing and repository gates are required; coordinator review/CI remains external. |
| AC16 | implemented for this partial scope | Public contract, boundaries, safety, provenance, testing, changelog, task, and roadmap are documented without claiming delivery. |

Linux acceptance runs real Ruby and exact Swift 6.3.3 on x86_64 Linux. Generated semantic Swift is typechecked, compiled, and run in debug and optimized modes with exact Unicode/output assertions. The packed proof uses a fresh cache, empty npm configurations, explicit public registry, default `install-links=false`, ordinary install and clean `npm ci`, full dependency listings, repeated runtime generation/materialization, and strict type consumption. Missing Ruby or Swift commands fail.

Per Kasper's 2026-09-14 direction to skip OSX work for now, no `xcodebuild`, Apple SDK, signing, runtime download, simulator, XCTest, or XCUIAutomation command was run, and TensorBuzz configuration was not changed to manufacture a lane. AC12–AC14 remain deferred. Task 026 and its roadmap row therefore remain in progress rather than delivered.

## Non-goals

The profile does not support arbitrary Ruby or Swift, UIKit parity, storyboards, platform APIs, storage, networking, concurrency, background modes, package dependencies, CocoaPods/SwiftPM resolution, non-iOS Apple targets, Objective-C/Objective-C++/Metal bridges, signing, physical devices, archives/export, TestFlight, App Store submission, deployment, release, or publication.
