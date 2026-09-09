# Swift source and target

Task022 adds `swift` as a frontend and deterministic single-file text backend for the Tasks001–004 semantic subset. This is general Swift language support only. Apple frameworks, Objective-C interoperability, Xcode projects, signing, simulators, devices, and iOS application artifacts remain separate later tasks.

## Parser route

The frontend uses root `tree-sitter@0.25.1` with the MIT-licensed `tree-sitter-swift@0.7.1` grammar from the Semantifold packaging fork. The dependency is the immutable HTTPS archive for merge commit `2a4515bb1d2d075c4c72a3466fbccb75f5269caf`; human tag `v0.7.1-semantifold.1` identifies that commit. The root lock records integrity `sha512-MoaFzZrwF8mYIiKbTcU4lUpIOXLz9NAuKZKUcM4xOYOgGIbQuP+jdeX5428pz0l7p8ggfiDeoY+yAv2krt4MRg==`.

The fork supplies the install-safe Node binding/package boundary needed by the otherwise unchanged 0.7.1 grammar. It ships a typed binding, generated parser and scanner, source fallback, and a native Node module; installation uses only `node-gyp-build` and has no downloader. Grammar ABI 14 is accepted by the exact binding. The adapter exhaustively visits every named, anonymous, extra, directive, error, and missing node, verifies parser indexes through the shared UTF-8-byte to UTF-16 converter, and rejects recovery rather than scanning source text.

The parser packaging, Node24 loading, CST corpus, recovery, coordinates, and five profile hashes are qualified in `spec/swift-parser-qualification.spec.js`. The rebuilt canonical image passed compiler differential typechecks for the original and generated five-profile corpus and native debug/optimized execution with the selected compiler. The independent review completed with one bounded local correction; exact-head TensorBuzz CI, merge, and post-merge verification remain delivery gates.

## Source profile

Functions are synchronous top-level `func` declarations with exactly two unlabeled parameters, explicit `Int64`, `Bool`, or `String` parameter and return types, a braced body, and explicit scalar returns on every reachable path. Semantic functions precede executable top-level entry statements. Calls are direct, unlabeled, and have exactly two arguments.

Locals use an explicit scalar annotation and initializer. `let` is immutable; `var` is accepted only when semantic assignment rules permit writes. Assignment targets are plain local identifiers. Conditions are strict `Bool`; nested and one-armed `if`, `else if`, `else`, and fallthrough normalize to semantic blocks. Entry printing is exactly one-argument `print(...)`.

The profile accepts safe canonical decimal integers, `true`/`false`, ordinary noninterpolated Unicode-scalar strings, direct identifiers and calls, integer add/subtract/multiply/negate and ordering, Boolean not/short-circuit and/or, integer/Boolean equality/inequality, and string concatenation. Ordinary Swift String `==`/`!=` are rejected because their canonical-equivalence semantics differ from semantic scalar-sequence equality. Source integer spelling never uses target-width `Int`, overflow operators, separators, alternate radices, floating point, or implicit conversion.

Type inference, optionals, tuples, collections, nominal declarations, extensions, generics, closures, property wrappers, result builders, macros, throwing/async/actor behavior, imports, Objective-C exposure, reflection, unsafe pointers, Foundation, UIKit, SwiftUI, loops, switches, error handling, interpolation, qualified calls, arbitrary standard-library dispatch, and custom operators are outside this profile. Parser recovery uses `PARSE_ERROR`; missing required types use `MISSING_TYPE`; other valid Swift outside the profile uses located `UNSUPPORTED_SYNTAX`.

## Generated program

The backend emits exactly one LF-normalized UTF-8 `program.swift`. Functions retain explicit scalar types and unlabeled parameters; locals retain `let`/`var`; entry statements remain in Swift's canonical top-level executable shell. Each generated mutable local receives an exact synthetic no-op `inout` marker to remain warning-clean without changing semantic mutability; the frontend collapses only its canonical adjacent shape. Rich mappings and Source Map v3 cover semantic names, types, literals, callees, and operators. Helper definitions, braces, separators, entry layout, and print plumbing are synthetic with related semantic origins. Before an artifact is returned, its final emitted source passes the registered Swift frontend, including its CST traversal limit. Only an omitted filename or exact `program.swift` is accepted, and Swift rejects source-map directive and alternate-map options with `UNSUPPORTED_CAPABILITY`.

Swift `String.==` applies canonical Unicode equivalence, while semantic string equality compares the exact scalar sequence. Ordinary source `==`/`!=` on Strings therefore reject after parser-backed type resolution. Generated equality and inequality use two fixed private `semantifold_` helpers backed by `unicodeScalars.elementsEqual`; only their complete canonical definitions and calls have authority. A helper-looking name or partial/modified definition has no authority.

Swift value types preserve Boolean, integer, and string copies without ownership scaffolding. Native function/operator evaluation supplies the required left-to-right and short-circuit behavior. Ordinary Swift `Int64` arithmetic remains overflow-checked in the required debug and `-O` modes; overflow operators are never emitted. Compile-time-known values outside signed 64-bit reject before emission. Generation also rejects malformed/cyclic or excessively expanded graphs, invalid scalar payloads, non-NFC or unsupported target identifiers, Swift keywords, scalar/entry names, and the private `semantifold_` namespace before a public artifact is returned.

## Compiler contract

The sole accepted compiler identity is:

```text
Swift version 6.3.3 (swift-6.3.3-RELEASE)
Target: x86_64-unknown-linux-gnu
```

Discovery uses canonical command `/usr/bin/swiftc` after image construction or absolute override `SEMANTIFOLD_SWIFTC`. Because discovery retains the executable's exact resolved identity, version and compilation invocations explicitly pass `--driver-mode=swiftc`; this preserves compiler mode when an installed `swiftc` is a symlink to the multi-call `swift-driver`. Missing, ambiguous, non-executable, wrong-release, development-snapshot, or foreign-target tools fail loudly. No generation or test downloads a compiler.

The Dockerfile selects official image `swift:6.3.3-noble@sha256:56ef1be2c1ca36f4c52440357dc1fcdfdb5e113587134fcadeef57c225c71b54`; its Linux/amd64 child manifest is `sha256:4e0fc24f0f93a5cf9a91bfcf182534bbc0571d70d757389c04ff1f616c1c460f`. A source stage probes the identity and copies only Swift executable/resource paths into the unchanged final `ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb` stage. It does not copy project source or replace the final `/usr` tree wholesale.

Real acceptance independently materializes each original parser fixture and regenerated `program.swift` in a fresh directory, runs `swiftc -warnings-as-errors -typecheck`, compiles once without optimization and once with `-O`, executes both binaries, checks exact UTF-8 stdout/stderr/status, verifies source bytes are unchanged, and removes the directory. Its deterministic PATH places the resolved compiler directory first, the canonical host-tool directory `/usr/bin` second, and the isolated caller PATH last with first-occurrence deduplication, so archive Swift selects its own compiler companions while Clang can launch the host linker. The rebuilt canonical image passed this exact Swift 6.3.3 x86_64 contract; `spec/swift-native-execution.spec.js` is 6/6.
