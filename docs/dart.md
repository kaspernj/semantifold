# Dart source and target

Task 029 adds `dart` as Semantifold's fourteenth parser-native source/text language. It round-trips the Tasks 001–005 semantic profile through a deterministic dependency-free Dart VM/native package. The implementation and exact Dart 3.13.3 local acceptance are complete; independent review, exact-head TensorBuzz CI, merge, and post-merge verification remain pending.

## Source profile

The frontend accepts one directive-free compilation unit containing synchronous top-level functions followed by exactly one `void main()`. Functions use explicit `int`, `bool`, `String`, or `void` returns and zero or more explicitly typed required positional parameters. Statements are initialized `final Type name = value;` or mutable `Type name = value;` locals, simple identifier assignment, strict-Boolean `if`/`else if`/`else`, explicit value or bare returns, resolved void-call expression statements, and exact `print(value);`. Expressions are scalar literals, identifiers, parentheses, direct resolved calls, and the Tasks 001–005 unary/binary operations. Strings are ordinary noninterpolated quoted strings with the implemented escapes and valid Unicode scalar values.

Every named, anonymous, extra, field, error, and missing CST edge is traversed. Parser recovery is `PARSE_ERROR`; missing explicit types use `MISSING_TYPE`; valid Dart outside the profile uses located `UNSUPPORTED_SYNTAX`. Ordinary comments may be ignored only after complete traversal. Parser trees stay inside `src/frontends/dart.js`.

Inference, `var`, inferred `final`, `const`, `late`, `dynamic`, `Object`, `num`, `double`, user `BigInt`, nullability, named/optional/default parameters or arguments, generics, methods/classes/mixins/extensions/enums/records, closures/tear-offs, casts/type tests, interpolation, raw/multiline strings, collections, loops/switch/assert, exceptions, async/futures/streams/isolates, directives/imports, annotations, external/operator/getter/setter declarations, cascades, and null-aware syntax are rejected. Exact `_` is a Dart 3 wildcard rather than a binding and is rejected for semantic function, parameter, and local names; ordinary identifiers such as `_value` remain available. Exact lowercase `// dart format off` and `// dart format on` comments are rejected as formatter directives, while case or spacing near-misses remain ordinary comments. Flutter and browser/JavaScript Dart are separate work.

## Qualified parser

The exact dependency is public registry `tree-sitter-dart-orchard@0.7.0`, tarball `https://registry.npmjs.org/tree-sitter-dart-orchard/-/tree-sitter-dart-orchard-0.7.0.tgz`, integrity `sha512-dO4hyC6eCz7tnXNWk7ZZ/CVzorvWQKRhxRYUT/uwAnA50m+4Jbogd1Oh33lPcj1/bP9wG1pS3TWQEfs1W3LFbg==`, and MIT license. Immutable annotated tag `v0.7.0` peels to commit/npm `gitHead` `9322cd5e1266c60983ae0ff921fbb4e77e903781`. Its ABI 14 language object, typed 359-entry node metadata, local native source, lifecycle, signatures, complete corpus traversal, recovery, coordinates, clean ordinary install/`npm ci`, and credential-free packed-consumer behavior pass with Node 24 and exact root `tree-sitter@0.25.1`.

Unscoped `tree-sitter-dart@1.0.0` is rejected because its language object is incompatible with the root binding. `@driftlog/tree-sitter-dart@1.0.4` is rejected because a clean install leaves undeclared extraneous `@driftlog/node-addon-api` residue. No cleanup hook, Git/archive dependency, copied or vendored parser, source-text fallback, compiler-output AST, or private package replaces either failure. See [parser qualification](parser-qualification.md#task-029-dart-grammar-qualification--2026-09-15).

## Generated package and public API

Use `generateArtifactSet({language: "dart", module})`. The ordered result is exactly:

1. `pubspec.yaml` — `manifest`, `application/yaml`, synthetic configuration provenance;
2. `pubspec.lock` — `manifest`, `application/yaml`, deterministic synthetic provenance;
3. `bin/program.dart` — sole `entry`, `text/x-dart`, rich mapping and Source Map v3 provenance.

The fixed package is named `semantifold_generated`, has `publish_to: none`, declares exact SDK `3.13.3`, has no dependencies, and emits the deterministic empty-package lockfile. `.dart_tool/`, SDK files, caches, and compiled executables are never artifacts. Omitted `filename` selects `bin/program.dart`; any other filename or any map-directive/source-map filename option fails transactionally with `UNSUPPORTED_CAPABILITY`. Because Dart is multi-artifact, `generate()` and `generateArtifact()` reject it with `UNSUPPORTED_ROLE`.

Generation validates the whole module before writer allocation, including types, required arity, complete call resolutions, identifiers, compiler-owned name collisions, safe known arithmetic, graph bounds, and Task 006+ exclusions. Over-width signatures use Dart 3.13.3's canonical one-parameter-per-line form with a trailing comma while preserving parameter type/name mappings. Repeated generation is byte-identical across paths, contents, mappings, Source Map v3, and metadata.

## Safe integers and generated support

Semantic integers remain within `[-9007199254740991, 9007199254740991]`. Literals and statically known arithmetic outside that range fail before artifact allocation. Dynamic integer add, subtract, multiply, and negate use exact private compiler-owned helpers that calculate in `BigInt`, range-check, and convert to `int`. A private Boolean identity helper prevents Dart analyzer constant folding from reporting valid short-circuit branches as dead code; it does not change left-to-right or short-circuit evaluation.

The frontend recognizes these calls only after recursively matching the complete canonical runtime CST—node type, named/extra state, child count, field names, and leaf text. Partial, reordered, renamed, duplicated, or token-modified support fails. User source cannot name the helpers, `BigInt`, `RangeError`, or runtime constants. Formatter-required trailing commas in generated formal parameter and call lists are accepted only behind this authenticated generated-runtime route.

## Mappings

`bin/program.dart` maps function names, parameter/local types and names, assignments, operators, calls and arguments, literals, print, returns, and entry statements to semantic/source origins. Formatting, the runtime prefix, manifest content, lockfile content, and fixed main shell are explicitly synthetic with related origins. Its embedded Source Map v3 names `bin/program.dart`; Dart emits no source-map directive or `.map` artifact. See [source provenance and mappings](source-maps.md).

## Exact toolchain and offline acceptance

The canonical Docker and TensorBuzz lanes install the official stable Linux x64 Dart SDK 3.13.3 ZIP under `/opt/dart-sdk-3.13.3`, verify SHA-256 `549c182cffbdc6864df7509c16fec646c73fe6cb8a18c2cb572db1292f300cd7`, and require:

```text
Dart SDK version: 3.13.3 (stable) (Tue Sep 1 01:07:17 2026 -0700) on "linux_x64"
```

`SEMANTIFOLD_DART` may select only an executable matching that identity. Each acceptance run owns fresh absolute HOME, PUB_CACHE, project, native-output, and TMPDIR paths; sets `CI=true`, `DART_SUPPRESS_ANALYTICS=true`, `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, and `TZ=UTC`; and points `PUB_HOSTED_URL` at an unreachable loopback endpoint. It runs without credentials or ambient Dart/pub configuration:

```sh
dart pub get --offline --no-precompile
dart format --output=none --set-exit-if-changed bin/program.dart
dart analyze --fatal-infos --fatal-warnings
dart run bin/program.dart
dart compile exe bin/program.dart -o semantifold-dart
./semantifold-dart
```

All three generated artifact hashes remain unchanged after every command; only disposable `.dart_tool/` state and the native executable appear. The six Tasks 001–005 Dart fixtures translate to every compatible target and execute identically on Dart VM/native. Representative PHP, Ruby, JavaScript, TypeScript, and Java fixtures translate into Dart. Additional acceptance proves Unicode, eager argument ordering, direct recursion, void calls, Boolean short-circuiting, and the safe-integer boundary with exact empty stderr and identical VM/native stdout.
