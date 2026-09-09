# Kotlin/JVM source and target

Task023 adds `kotlin` as a frontend and deterministic single-file Kotlin/JVM text backend for exactly the Tasks001–004 semantic subset. It does not claim Android, Gradle, Kotlin/Native, Kotlin/JS, Wasm, multiplatform projects, compiler plugins, package resolution, or Java interoperability beyond executing the generated JVM bytecode. Android application packaging and lifecycle remain Task028.

## Parser route

The frontend uses root `tree-sitter@0.25.1` with the MIT-licensed `tree-sitter-kotlin@0.4.0` grammar from the Semantifold packaging fork. The exact dependency is `git+https://github.com/kaspernj/tree-sitter-kotlin.git#v0.4.0-semantifold.1`; the tag peels to commit `57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0`, and the lock records that full commit over HTTPS. The fork keeps grammar ABI 14, declares optional peer `tree-sitter@^0.25.1`, ships typed `nodeTypeInfo`, generated parser/scanner sources and the `node-gyp-build` binding, and has no install-time downloader.

The root tarball bundles the grammar so a credential-free consumer never resolves the Git edge. npm removes resolution URLs from bundled lock entries, so root `acceptDependencies` records the exact installed grammar version `0.4.0` beside the unchanged private legacy-runtime acceptance. It does not select or fetch the grammar; the immutable HTTPS dependency remains the sole grammar source. The packed-consumer proof uses empty user/global npm configuration, a fresh cache, the public registry, default `install-links=false`, full dependency listing, ordinary install, clean `npm ci`, strict public API typing, parser loading, and real Kotlin/JVM execution without SSH or credentials.

The adapter exhaustively visits every named, anonymous, extra, error, and missing child, verifies parser indexes through the shared UTF-8-byte-to-UTF-16 converter, rejects lone surrogates and recovery, and never scans source text to recover rejected syntax. The parser route, five fixture hashes, CST corpus, coordinates, lifecycle, package boundary, and exact `kotlinc` differential are recorded in [parser qualification](parser-qualification.md).

## Source profile

Source consists of one or more top-level semantic `fun` declarations followed by exactly one `fun main()`. A semantic function has exactly two ordinary parameters and explicit `Long`, `Boolean`, or `String` parameter and return types. Calls are direct, positional, and have exactly two arguments. `main` has no parameters or return annotation and contains the sequenced entry statements; printing is direct one-argument `println(...)`.

Locals require `val|var name: Long|Boolean|String = expression`. `val` is immutable and `var` is mutable under the shared assignment rules; targets are plain local identifiers. Conditions require semantic `Boolean`. Braced nested and one-armed `if`, `else`, and fallthrough normalize to semantic blocks. Returns are explicit on every reachable function path.

The profile accepts safe canonical decimal integers with an optional uppercase `L`, ordinary noninterpolated strings, Boolean literals, identifiers, calls, integer add/subtract/multiply/negate and ordering, Boolean not/short-circuit and/or, same-type scalar equality/inequality, and string concatenation. Ordinary unescaped identifiers follow the qualified grammar's letters/decimal-digits/underscore profile and NFC requirement; unsupported Unicode identifier forms reject before emission rather than failing generated reparse. Types remain exact: there is no numeric widening, conversion, inference, nullable/platform type, unsigned/arbitrary-width number, boxing, or `null` mapping.

Packages, imports, annotations, classes/interfaces/data/value classes, objects/companions, extensions, overloads, generics, lambdas, local functions, delegation, casts, smart casts, referential equality, arrays/collections, indexing, ranges, loops, `when`, exceptions, reflection, coroutines/`suspend`, interpolation, raw strings, qualified calls, arbitrary APIs, and locale-dependent formatting are outside the profile. Parser recovery uses `PARSE_ERROR`; omitted required types use `MISSING_TYPE`; other parsed Kotlin outside the profile uses located `UNSUPPORTED_SYNTAX`.

## Generated program

The backend emits exactly one LF-normalized `Program.kt`. It preserves explicit scalar types and `val`/`var`, emits uppercase-`L` integer literals, and uses ordinary Kotlin/JVM scalar equality. Native eager operands and call arguments retain left-to-right order, while `&&` and `||` retain native short-circuiting. Private target-only helpers wrap `Math.addExact`, `subtractExact`, `multiplyExact`, and `negateExact`, then check the result against `-9007199254740991L...9007199254740991L`; dynamic overflow therefore cannot silently wrap outside the semantic safe-integer range. Only the complete byte-for-byte helper CST prefix authorizes helper-call collapse during generated reparse. Caller identifiers cannot enter the helper namespace or capture Kotlin/JVM scaffolding.

Rich mappings and Source Map v3 cover semantic names, types, literals, callees, and operators. Runtime helpers, separators, braces, `main`, and `println` plumbing are synthetic and related to semantic origins. Generation validates malformed/cyclic/excessively expanded graphs, types, names, literals, known arithmetic bounds, mutability, and the fixed filename transactionally, then reparses the final source through the registered Kotlin frontend before returning it. Only omitted filenames or exact `Program.kt` are accepted; map directives and alternate map names reject with `UNSUPPORTED_CAPABILITY`.

`generateArtifactSet()` returns one `text/x-kotlin` entry plus detached immutable metadata. Its declared build and run recipe is:

```sh
kotlinc -language-version 2.4 -api-version 2.4 -jvm-target 25 -Werror -include-runtime Program.kt -d Program.jar
java -jar Program.jar
```

No Gradle files or downloaded project dependencies are generated.

## Compiler contract

`kotlinc` discovery accepts only Kotlin/JVM 2.4.20 on the exact OpenJDK 25.0.4+7 Ubuntu builds: `info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-26.04-Ubuntu)` in the Ubuntu26.04 development image or the corresponding `...-1-24.04-Ubuntu` identity in Ubuntu24.04 TensorBuzz. The canonical command is `kotlinc`; `SEMANTIFOLD_KOTLINC` may provide an absolute executable override. Kotlin execution uses the separate `java25` contract, which invokes `java` through `SEMANTIFOLD_JAVA` and accepts only the complete matching OpenJDK25.0.4 runtime and 64-bit Server VM output for one of those two Ubuntu revisions; the broader Java-language `java` contract remains JRE17-29. Missing, ambiguous, non-executable, wrong-compiler, wrong-Kotlin, or wrong-JRE identities fail loudly.

The Dockerfile and TensorBuzz download only the official Kotlin `2.4.20` compiler ZIP from JetBrains and verify SHA-256 `59e9ca74c7904ef2c122b12114937673ccce68de820a663f0ed66ccf8799e0b7` before installation at `/opt/kotlinc`. The development image pins `openjdk-25-jdk-headless=25.0.4+7-1~26.04`; Noble TensorBuzz pins the repository-compatible `25.0.4+7-1~24.04` build. They expose `/opt/kotlinc/bin/kotlinc` through `SEMANTIFOLD_KOTLINC` without shadowing `PATH`. Runtime tests materialize fresh directories, compile original and generated five-profile sources with the exact metadata arguments, execute runnable JARs through the discovered Java25 contract, assert status/stderr/exact UTF-8 stdout bytes, and remove all temporary artifacts.
