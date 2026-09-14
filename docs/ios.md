# iOS application target

Task 026 has an implemented Linux-qualified deterministic generation/provenance slice, with materialization and Apple-platform acceptance explicitly deferred. The registered `ios` identity is a target-only application backend: it has no frontend, text backend, binary-backend route, interoperability bridge, provider role, source-discovery behavior, filesystem writer, or entry in `supportedLanguages`. Real Xcode, Apple SDK, XCTest, XCUIAutomation, and iOS Simulator proof has not been run, so the task is not delivered and the generated Xcode model is not yet platform-qualified.

## Public route

Callers parse source normally, build an explicit Task 010 program, and request the application role. Omitting `role` retains ordinary text generation. Generation is pure and performs no filesystem access.

```js
import {generateProgramArtifactSet, parseProgram} from "semantifold"

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
```

`generateArtifactSet` accepts the same application fields for one semantic module and normalizes it to one project module. Both routes validate the entire semantic graph before rendering. The supported semantics are exactly the Tasks 001–004 Swift subset from Task 022: typed scalar values, typed locals/assignment, the closed scalar operators, nested statement blocks/conditionals, exact two-argument scalar-return functions, resolved calls, and deterministic text output. Task 010 owns project modules, source ownership, imports, exports, and dependency order. iOS adds no parser rule or semantic node for SwiftUI, application lifecycle, capture, configuration, resources, signing, or Apple APIs.

Program-shaped application dispatch is limited to program-capable application targets, currently only `ios`. The separate Wasm application backend remains available through the single-module `generateArtifactSet` route and is rejected with `UNSUPPORTED_ROLE` when requested through `generateProgramArtifactSet`; a program object is never passed to that module backend.

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

Every asset is explicit `{path, content, mediaType, sha256}` input. Its path must use only ASCII letters, digits, `.`, `_`, and `-` in nonempty relative POSIX components below `Assets.xcassets`; this closed alphabet has complete ASCII case-fold comparison. Sharp-S, sigma, composed/decomposed non-ASCII names, traversal, duplicates, case-fold collisions, and file/directory-prefix collisions fail at input validation before an artifact set is returned. This path restriction does not alter Unicode semantic source filenames, source text, string values, or generated Swift content. Asset content is a nonempty exact string or `Uint8Array`, and its lowercase SHA-256 must match the exact UTF-8 text or bytes. Assets are defensively copied and sorted.

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

Xcode object IDs are the uppercase first 24 hexadecimal digits of built-in SHA-256 over normalized, collision-checked full identities. Project sections, groups, build phases, build settings, paths, configuration JSON, and assets have canonical ordering; text uses LF and relative paths. Signing is disabled and no entitlement/team/account/certificate/provision data is emitted. Two generations from the same validated input return byte-identical artifacts. The generated Xcode source/project syntax is deterministic but remains platform-unqualified.

## Manifest and provenance

`semantifold-project.json` is `SemantifoldIosProject` version 1. It records generator identity/version, target, the complete normalized configuration, caller source and asset hashes, exact ordered owned paths, explicit excluded path patterns, and Apple tool requirements whose status is `deferred`. Its `SemantifoldIosSemanticProgram` version 1 section preserves caller-order source IDs, filenames, hashes and ownership; dependency-order caller module IDs and import dependencies; source-to-module ownership links; generated namespaces/artifacts; and the selected entry module, generated function, bridge, and application artifact linkage.

Mapped semantic Swift retains rich UTF-16 range provenance and Source Map v3 projection through every originating module, including Ruby. Synthetic runtime, SwiftUI, project, configuration, asset-catalog base metadata, and test scaffolding carry explicit synthetic provenance. Each owning renderer records causal configuration spans while emitting a specific field-derived token; the manifest groups only those ranges with their JSON pointers and never reconstructs ownership through substring scans. Equal module/product values, an organization prefix embedded in a bundle ID, and synthetic text matching the display name therefore cannot create false citations. Exact assets record path, media type, representation, and SHA-256; binary artifact provenance spans every byte.

Build products, `DerivedData`, Xcode user data, code signatures, and caller files outside the owned path list are excluded. The manifest is an ownership description, not a filesystem mutation or permission to overwrite or adopt a project.

## Deferred filesystem publication

Materialization is deferred and this release exposes no public project writer. Node's public filesystem API does not provide the combination required by the accepted contract: genuine atomic no-replace publication of a complete directory plus descriptor-relative no-follow anchoring for staging, publication, and cleanup. A path preflight followed by ordinary rename can replace a raced empty directory or follow an exchanged ancestor, so it is not retained as best effort.

A future materializer requires a separately authorized, reviewed, and platform-qualified native boundary. Until then, generation returns only an immutable in-memory artifact set; no transactional filesystem, regeneration, adoption, merge, or overwrite claim is made.

## Acceptance status

| Criterion | Status | Evidence or remaining boundary |
| --- | --- | --- |
| AC01 | implemented | Complete Task 010 graph preflight and Tasks 001–004 lowering are focused-spec covered. |
| AC02 | partial | SwiftUI shell/bridge/view and capture are generated; real Apple compilation is deferred. |
| AC03 | implemented | Closed caller configuration and identity validation are covered. |
| AC04 | implemented | Empty capabilities, exact hashed assets, and the complete portable ASCII path boundary are covered. |
| AC05 | partial | Canonical project, IDs, paths, LF, and double generation are covered; `xcodebuild` validation is deferred. |
| AC06 | partial | Unit/UI sources and Linux semantic execution exist; real XCTest/XCUI execution is deferred. |
| AC07 | deferred | No public materializer ships; atomic no-replace plus descriptor-relative no-follow publication requires a separately authorized native boundary. |
| AC08 | implemented | Ruby/Swift mapping, renderer-owned configuration spans, stable semantic program identities/linkage, ownership, and asset provenance are covered. |
| AC09 | partial | Located capability and stable application diagnostics are covered; filesystem safety diagnostics remain deferred with materialization. |
| AC10 | implemented | Real Ruby output equals generated Swift output in debug and optimized Linux execution. |
| AC11 | implemented | No VM, runtime emulation, credentials, entitlements, dependencies, signing, or host leakage is emitted. |
| AC12 | deferred | No qualified macOS/Xcode/Apple SDK/Swift compiler lane has listed or built the project. |
| AC13 | deferred | No named iOS Simulator has been booted, installed to, or launched. |
| AC14 | deferred | No XCTest/XCUIAutomation run has observed exact `semantifold-output` text. |
| AC15 | implemented locally for generator scope | Focused generation and packed-generator proofs are required; materializer/Apple proof and coordinator CI remain deferred or external. |
| AC16 | implemented for this reduced scope | Public generator contract, provenance, path boundary, deferrals, testing, changelog, task, and roadmap are documented without claiming delivery. |

Linux acceptance runs real Ruby and exact Swift 6.3.3 on x86_64 Linux. Generated semantic Swift is typechecked, compiled, and run in debug and optimized modes with exact Unicode/output assertions. The packed proof uses a fresh cache, empty npm configurations, explicit public registry, default `install-links=false`, ordinary install and clean `npm ci`, full dependency listings, repeated deterministic generation/manifest checks, strict type consumption, and proof that no materializer implementation/declaration is shipped. Missing Ruby or Swift commands fail.

Kasper separately selected “Defer the materializer and ship the generator/provenance scope,” so AC07 remains deferred without weakening its transaction guarantee. Per Kasper's 2026-09-14 direction to skip OSX work for now, no `xcodebuild`, Apple SDK, signing, runtime download, simulator, XCTest, or XCUIAutomation command was run, and TensorBuzz configuration was not changed to manufacture a lane. AC12–AC14 also remain deferred. Task 026 and its roadmap row therefore remain in progress rather than delivered.

## Non-goals

The profile does not support arbitrary Ruby or Swift, UIKit parity, storyboards, platform APIs, storage, networking, concurrency, background modes, package dependencies, CocoaPods/SwiftPM resolution, non-iOS Apple targets, Objective-C/Objective-C++/Metal bridges, signing, physical devices, archives/export, TestFlight, App Store submission, deployment, release, or publication.
