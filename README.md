# Semantifold

Task021 adds a [browser-oriented WebAssembly target](docs/webassembly.md): a direct deterministic binary encoder, versioned scalar ABI, fixed linear memory, rich byte provenance, strict-CSP loader/harness artifacts, and mandatory WABT/Node/Chromium acceptance.

Semantifold is an early language-neutral semantic code toolkit. The source tree supports a deliberately small thirteen-language baseline: PHP, Ruby, JavaScript with JSDoc, TypeScript, Java, Kotlin/JVM, strictly annotated Python, canonical C#, bounded Go, C17, C++20, Rust edition 2021, and strict Swift share one typed semantic representation. Browser WebAssembly is an additional target-only ID, not a fourteenth source language. The published baseline remains `semantifold@0.3.0`; Tasks021–023 have not been released. Exact-head TensorBuzz CI, review, merge, and post-merge verification remain delivery gates.

## Current API

```js
import {generate, parse} from "semantifold"

const module = parse({
  filename: "label.ts",
  language: "typescript",
  source: `
    function label(flag: boolean, fallback: string): string {
      if (flag) return "yes"
      else return fallback
    }
    console.log(label(true, "no"))
  `
})

const javaSource = generate({language: "java", module})
```

`parse` returns parser-independent discriminated semantic nodes with normalized types, source locations, a versioned source registry, and deterministic node/symbol provenance. `generate` accepts that shared module and returns an independently executable source program with its historical bytes unchanged. For each single-artifact target, `generateArtifact` adds an output filename, an authoritative range-based `SemantifoldMapping` v1, and a Source Map v3 sidecar:

```js
import {generateArtifact, originalPositionFor} from "semantifold"

const artifact = generateArtifact({language: "java", module})
const original = originalPositionFor(artifact.mapping, {offset: artifact.code.indexOf("label")})
```

Generated text output always uses LF. Exact original content, including LF, CRLF, lone CR, and astral UTF-16 coordinates, remains in the source registry and `sourcesContent`. Optional inline/external `sourceMappingURL` directives apply only to JavaScript and TypeScript; PHP, Ruby, Java, Kotlin, Python, C#, Go, C, CPP, Rust, and Swift use the same rich/v3 model without foreign comments. Wasm instead uses rich byte ranges, a line-zero/byte-column Source Map v3 sidecar, and a relative `sourceMappingURL` custom section. See [source provenance and mappings](docs/source-maps.md) for schemas, lookups, composition, diagnostics, directives, and compatibility.

`supportedLanguages` is the immutable registry-derived list `php`, `ruby`, `javascript`, `typescript`, `java`, `kotlin`, `python`, `csharp`, `go`, `c`, `cpp`, `rust`, and `swift`. `languageCapabilities` additionally includes target-only `wasm` and exposes each ID's independent frontend, text-backend, binary-backend, application-backend, and interoperability roles together with `generalFunctionsAndCalls` and `immutableCollections` feature flags, artifact multiplicity, round-trip, mapping, acceptance-stage, and toolchain declarations. Unknown IDs use `UNSUPPORTED_LANGUAGE`; a registered ID missing a requested role uses `UNSUPPORTED_ROLE`; an existing backend that cannot represent a semantic module uses `UNSUPPORTED_CAPABILITY`.

`generateArtifactSet` is the additive single-module artifact API. Original text targets return an entry artifact with the exact legacy bytes and rich/v3 mappings; an external JavaScript-family map directive also returns the referenced serialized mapping sidecar. C# returns mapped `Program.cs` then synthetic-provenance `Semantifold.csproj`. Go returns exactly two ordered artifacts: fixed synthetic-provenance `go.mod` first, then mapped `main.go`; the fixed module is `example.com/semantifold/generated` with `go 1.26.0` and creates no `go.sum`. C returns mapped `program.c` followed by synthetic `semantifold_runtime.h`. Rust returns synthetic `Cargo.toml`, synthetic Cargo-generated `Cargo.lock`, then mapped `src/main.rs`, with fixed edition 2021 and Rust/Cargo 1.98.1. Wasm binary/application generation returns `program.wasm`, `program.wasm.map`, `semantifold-loader.mjs`, then sole entry `index.html`, plus frozen `semantifold.browser.v1` ABI metadata. Because C#, Go, C, Rust, and Wasm are deliberately multi-artifact, `generate()` and `generateArtifact()` reject them with `UNSUPPORTED_ROLE`. Go accepts only an omitted filename or exact `main.go`, C accepts only omitted or exact `program.c`, Rust only omitted or exact `src/main.rs`, and Wasm only omitted or exact `program.wasm`; these multi-artifact backends reject unsupported mapping options rather than ignoring them. `createGeneratedArtifactSet` validates multi-file text, binary, mixed loader/binary, and application shapes transactionally: paths are ordered, unique, safe relative POSIX paths with no file/directory prefix collisions; content is explicitly text or bytes; media type, role, generated ownership, and provenance are required; exactly one artifact has role `entry`; and optional metadata is detached deeply frozen JSON. Binary content is held privately and returned as a fresh detached byte view on every read, so caller mutation cannot change validated bytes or their provenance. Generated helper files do not create semantic modules and are not Task 010 projects.

Binary/resource provenance uses `SemantifoldByteMapping` v1 through `createByteMapping`, `parseByteMapping`, and `stringifyByteMapping`. Generated ranges are ordered, non-overlapping, half-open byte offsets with semantic identities or explicit synthetic reasons. They are never interpreted as UTF-16 positions.

`discoverCanonicalToolchain` and `discoverToolchain` resolve an exact executable from a configured absolute override or one unambiguous canonical PATH command and capture its version. `runAcceptanceStages` materializes a validated artifact set in a unique temporary directory and runs applicable `parse`, `generate`, `restore`, `compile`, `link`, `validate`, `instantiate`, and `execute` stages with exact argument arrays, a deterministic locale/timezone, bounded per-stage timeouts, captured output, no shell, and normalized stage diagnostics. The canonical overrides are `SEMANTIFOLD_PHP`, `SEMANTIFOLD_RUBY`, `SEMANTIFOLD_NODE`, `SEMANTIFOLD_TSC`, `SEMANTIFOLD_JAVAC`, `SEMANTIFOLD_JAVA`, `SEMANTIFOLD_KOTLINC`, `SEMANTIFOLD_PYTHON`, `SEMANTIFOLD_DOTNET`, `SEMANTIFOLD_GO`, `SEMANTIFOLD_CLANG`, `SEMANTIFOLD_CLANGPP`, `SEMANTIFOLD_RUSTC`, `SEMANTIFOLD_CARGO`, `SEMANTIFOLD_SWIFTC`, `SEMANTIFOLD_WASM_VALIDATE`, and `SEMANTIFOLD_CHROMIUM`; none of these APIs installs or downloads a tool. Kotlin requires exact 2.4.20 on the pinned OpenJDK 25.0.4+7 Ubuntu runtime. Swift requires exact 6.3.3 on Linux x86-64. Browser Wasm requires WABT 1.0.36 and Chrome/Chromium 152.0.7977.82 in addition to Node 24.

This is not general-purpose support for any of the thirteen languages. PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java implement Task 005 general required functions/calls and Task 006 recursive immutable lists/maps. Collection support covers homogeneous literals, zero-based list indexing, total string-key map lookup, size, one-level-or-deeper recursive typing, and function passage. PHPDoc distinguishes `list<T>` from `array<string,T>`; JavaScript objects are never maps. Immutability is the accepted semantic operation boundary, not a deep-freezing promise, and maps expose no portable iteration order. Optional or unchecked lookup remains unsupported. The other eight source languages and browser Wasm remain on the Tasks 001–004 two-parameter/scalar-return profile and reject later-feature modules transactionally. See [language support](docs/language-support.md) before using it on other code.

Semantic integers must be JavaScript-safe mathematical integers and have one unsigned zero. Generated JavaScript and TypeScript canonically render scalar output for modules containing negation or multiplication so IEEE-754 `-0` is observed as `0` without folding or rewriting the semantic operation tree. Java generation narrows literals and compile-time-known arithmetic trees further to signed 32-bit `int`. C# uses checked signed-64-bit arithmetic. Go uses exact decimal `int64` literals, rejects compile-time-known results outside signed 64-bit, and otherwise preserves native runtime wrap outside the portable guarantee. Strings are parser-decoded Unicode scalar values and are re-escaped for each target without preserving source quotes or escapes. Equality never coerces and never applies to objects or collections. Division, remainder, exponentiation, bitwise/shift/update/compound operations, ternary/nullish forms, general casts/assertions, truthiness, implicit returns, loops, switches, exceptions, and constant folding are unsupported. Task 006's exact TypeScript `Map#get(...)!` round-trip wrapper is the sole assertion exception and does not establish lookup totality. JavaScript and TypeScript functions must be synchronous and non-generator; Ruby annotations must be immediately associated comment blocks; and PHP accepts only an optional exact `declare(strict_types=1)`. Python requires exact `int`/`bool`/`str` annotations and its exact adjacent immutable carrier. C# requires its exact generated namespace/class shell. Go requires `package main`, at most the exact `fmt` import, explicit `int64`/`bool`/`string` types, final zero-argument `func main()`, and direct `fmt.Println`; assignment occurrence determines source-local mutability, while generated immutable locals carry exact adjacent `// @semantifold-immutable`. Frontends reject syntax instead of dropping receivers, arguments, parameters, declarations, or statements. Before emission, each backend recursively validates blocks, flow, scalar types, typed operations, modeled bindings, mutability, target identifiers, and literal representability.

C17 support uses exact `int64_t`, `bool` and immutable UTF-8 byte slices. Its deterministic `program.c`/header pair preserves left-to-right and short-circuit effects through checked ordered-expression regions, uses checked signed-64-bit arithmetic, and owns concatenation storage until main cleanup. Reparse verifies the complete generated CST before collapsing temporary values. The qualified toolchain is Ubuntu Clang 21.1.8 on Linux x86-64 with mandatory O0/O2 ordinary and sanitizer execution. See the [C source/target profile](docs/c.md) and [portable toolchain commands](docs/testing.md).

Rust accepts explicitly typed two-parameter free functions, `let`/`let mut`, scalar assignments, explicit returns and braced conditionals. Exact print, string, clone, borrow and overflow scaffolding collapses into existing semantic nodes. Source move validation rejects use-after-move and overlapping borrow/move expressions; generated clones preserve semantic copies at storage, call and print boundaries. Native operands retain left-to-right evaluation and short-circuiting. Dynamic integer overflow exits 70 with a fixed diagnostic in both Cargo modes. See the [complete Rust contract](docs/rust.md).

Swift accepts explicitly typed two-parameter unlabeled functions, `let`/`var`, scalar assignments, explicit returns, braced conditionals, and top-level printing. It emits one mapped `program.swift`; ordinary Swift String `==`/`!=` reject because exact target-only helpers preserve Unicode-scalar equality instead of Swift's canonical-equivalence behavior. Generated mutable locals carry synthetic warning-clean scaffolding. Exact Swift 6.3.3 debug/optimized acceptance passed after the canonical-image rebuild. See the [complete Swift contract](docs/swift.md).

Kotlin accepts top-level two-parameter functions with explicit `Long`, `Boolean`, or `String`, typed `val`/`var`, scalar assignments, explicit returns, braced conditionals, final `fun main()`, and direct `println`. It emits one mapped `Program.kt` plus immutable Kotlin 2.4/JVM 25 runnable-JAR metadata; private checked helpers preserve the semantic safe-integer range. Android, Gradle, Kotlin/Native, Kotlin/JS, and multiplatform projects remain excluded. See the [complete Kotlin/JVM contract](docs/kotlin.md).

Browser Wasm lowers the unchanged subset to signed `i64`, canonical Boolean `i32`, and UTF-8 pointer/length strings in one fixed exported memory. A private 1 MiB scratch arena supports checked runtime concatenation, and generation rejects unprovable allocation, more than 64 active semantic calls, or compile-time-known i64 overflow before returning bytes. The strict loader has no DOM/WASI allocator imports or semantic JavaScript fallback. See the [complete browser Wasm contract](docs/webassembly.md).

## Standard-library portability direction

Standard-library portability is planned and is not implemented in `semantifold@0.3.0`. The design is hub-and-spoke, with two integrations per language: a source-facing **language compatibility stdlib/facade** preserves that language's familiar supported API shape in portable executable definitions, while a **target host provider/native binding** implements versioned **canonical Semantifold stdlib contracts/capabilities** with the target's genuine native standard library.

For example, planned Ruby-to-PHP compilation would compile a Ruby application with portable Ruby `TCPSocket` and bounded one-string `puts`/`Kernel.puts` compatibility facades through the semantic IR. The generated PHP could retain those source-compatible names in a collision-safe compatibility namespace, call canonical `SocketClient`, text-stream, output, and resource capabilities, and link only the required PHP provider modules. That provider would use native `fsockopen`, `fgets`, and `fclose` for socket operations and native stdout output without adding a duplicate LF. This requires no handwritten Ruby-on-PHP bridge, source-specific loop recognition, or whole-program intelligent refactor. See the [authoritative standard-library portability design](docs/standard-library-portability.md) and [dependency-ordered implementation plan](docs/plans/2026-09-05-standard-library-portability.md).

## Development

Use Node.js 24 and install with `npm ci`. Specs use `@velocious/testing@0.0.0` and the standalone `velocious-test` runner. Run a focused spec with `npx velocious-test spec/repository-contract.spec.js`. Task021 local validation runs explicitly named changed/affected spec files sequentially; aggregate `npm test` discovery runs only in TensorBuzz.

The aggregate suite includes direct real-toolchain specs that inherit the outer test process locale, so repository validation requires `LANG=C.UTF-8` and `LC_ALL=C.UTF-8`. The canonical container currently exports neither variable. This outer-suite requirement is separate from `runAcceptanceStages`, which normalizes the locale and timezone of every child it owns and does not depend on ambient locale.

The local quality/package gate follows the named focused specs documented in [testing](docs/testing.md):

```sh
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
npm run verify:legacy-runtime
npx velocious-test spec/repository-contract.spec.js
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
npm ls --omit=dev --all
npm ls --all
npm pack --dry-run --json
git diff --check
```

The root distribution explicitly bundles root `tree-sitter@0.25.1` and a private internal package containing an isolated exact `tree-sitter@0.21.1` plus `tree-sitter-c@0.23.2`, `tree-sitter-cpp@0.23.4`, and `tree-sitter-rust@0.23.1` dependency subtree. The immutable Kotlin grammar remains an ordinary full-SHA HTTPS source-archive dependency. The private `packages/tree-sitter-legacy` workspace owns source checking and declaration generation, but has no export or publication identity. Its serializer returns only recursively frozen parser-neutral CST data; native parser, tree, node, and language handles stay inside the legacy runtime. The packed-consumer spec installs the real root tarball with a fresh npm cache and proves modern Kotlin/Go and legacy C/CPP/Rust parsing together without a workspace, SSH route, or registry fallback for the internal package.

Because `install-links=true` installs a copy of the private runtime, run `npm ci` again after editing its shipped files under `packages/tree-sitter-legacy/runtime/`. Tests, lint, and `npm pack` reject a stale installed payload with that recovery instruction. The gate compares npm's source file inventory and every file's bytes, including the manifest, serializer, README, and license; it never copies or repairs dependencies itself.

Consumers need no Semantifold-specific npm settings: default `npm install`, `npm ls --all`, and subsequent `npm ci` work with `install-links=false`. The repository alone uses `install-links=true` to materialize the local source. Root `acceptDependencies` accepts only the exact private `0.1.0` package already present in the bundle; npm resolves the Kotlin grammar from its integrity-locked full-SHA HTTPS source archive. The cold-consumer proof isolates user/global configuration, verifies the public registry and ordinary default, rejects SSH lock entries, and repeats dependency, parser, TypeScript, Rust, and Kotlin/JVM checks after both install and clean reinstall.

The execution specs require PHP CLI, Ruby, Python 3, TypeScript, a Java JDK, Kotlin/JVM 2.4.20, .NET 10, Clang 21.1.8 with compiler-rt, Go 1.26 with matching `gofmt`, the exact qualified Rust/Cargo 1.98.1 pair, Swift 6.3.3, WABT 1.0.36, and headless Chrome/Chromium 152.0.7977.82 in addition to Node; missing tools are failures. The canonical container contract installs Kotlin and Java during image construction; runtime tests never download a compiler or dependency.

## Documentation

- [Goals](docs/goals.md)
- [Architecture](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Language support](docs/language-support.md)
- [Rust source and Cargo target](docs/rust.md)
- [Swift source and target](docs/swift.md)
- [Kotlin/JVM source and target](docs/kotlin.md)
- [Browser WebAssembly target](docs/webassembly.md)
- [Parser qualification](docs/parser-qualification.md)
- [Testing](docs/testing.md)
- [Source provenance and mappings](docs/source-maps.md)
- [Standard-library portability design](docs/standard-library-portability.md)
- [Standard-library portability implementation plan](docs/plans/2026-09-05-standard-library-portability.md)
- [Language feature roadmap](https://github.com/kaspernj/semantifold/blob/master/todo/README.md)
- [Initial toolchain plan](docs/plans/2026-09-02-initial-toolchain.md)

Semantifold is ISC licensed.
