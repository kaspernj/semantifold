# Semantifold

Semantifold is an early language-neutral semantic code toolkit. The current source tree proves a deliberately small eight-language end-to-end baseline: parse equivalent PHP, Ruby, JavaScript with JSDoc, TypeScript, Java, strictly annotated Python, canonical C#, and bounded Go programs into one typed semantic representation, then generate and genuinely execute equivalent programs in every target language. The published package remains `semantifold@0.2.0`; Task 024 does not publish a release.

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

Generated output always uses LF. Exact original content, including LF, CRLF, lone CR, and astral UTF-16 coordinates, remains in the source registry and `sourcesContent`. Optional inline/external `sourceMappingURL` directives apply only to JavaScript and TypeScript; PHP, Ruby, Java, Python, C#, and Go use the same rich/v3 model without foreign comments. See [source provenance and mappings](docs/source-maps.md) for schemas, lookups, composition, diagnostics, directives, and compatibility.

`supportedLanguages` is the immutable registry-derived list `php`, `ruby`, `javascript`, `typescript`, `java`, `python`, `csharp`, and `go`. `languageCapabilities` exposes each ID's independent frontend, text-backend, binary-backend, application-backend, and interoperability roles together with artifact multiplicity, round-trip, mapping, acceptance-stage, and toolchain declarations. Unknown IDs use `UNSUPPORTED_LANGUAGE`; a registered ID missing a requested role uses `UNSUPPORTED_ROLE`; an existing backend that cannot represent a semantic module uses `UNSUPPORTED_CAPABILITY`.

`generateArtifactSet` is the additive single-module artifact API. Original text targets return an entry artifact with the exact legacy bytes and rich/v3 mappings; an external JavaScript-family map directive also returns the referenced serialized mapping sidecar. C# returns mapped `Program.cs` then synthetic-provenance `Semantifold.csproj`. Go returns exactly two ordered artifacts: fixed synthetic-provenance `go.mod` first, then mapped `main.go`; the fixed module is `example.com/semantifold/generated` with `go 1.26.0` and creates no `go.sum`. Because C# and Go are deliberately multi-artifact, `generate()` and `generateArtifact()` reject them with `UNSUPPORTED_ROLE`. Go accepts only an omitted filename or exact `main.go`; both multi-artifact backends reject mapping options rather than ignoring them. `createGeneratedArtifactSet` validates multi-file text, binary, mixed loader/binary, and application shapes transactionally: paths are ordered, unique, safe relative POSIX paths with no file/directory prefix collisions; content is explicitly text or bytes; media type, role, generated ownership, and provenance are required; and exactly one artifact has role `entry`. Binary content is held privately and returned as a fresh detached byte view on every read, so caller mutation cannot change validated bytes or their provenance. Generated helper files do not create semantic modules and are not Task 010 projects.

Binary/resource provenance uses `SemantifoldByteMapping` v1 through `createByteMapping`, `parseByteMapping`, and `stringifyByteMapping`. Generated ranges are ordered, non-overlapping, half-open byte offsets with semantic identities or explicit synthetic reasons. They are never interpreted as UTF-16 positions.

`discoverCanonicalToolchain` and `discoverToolchain` resolve an exact executable from a configured absolute override or one unambiguous canonical PATH command and capture its version. `runAcceptanceStages` materializes a validated artifact set in a unique temporary directory and runs applicable `parse`, `generate`, `restore`, `compile`, `link`, `validate`, `instantiate`, and `execute` stages with exact argument arrays, a deterministic locale/timezone, bounded per-stage timeouts, captured output, no shell, and normalized stage diagnostics. The canonical overrides are `SEMANTIFOLD_PHP`, `SEMANTIFOLD_RUBY`, `SEMANTIFOLD_NODE`, `SEMANTIFOLD_TSC`, `SEMANTIFOLD_JAVAC`, `SEMANTIFOLD_JAVA`, `SEMANTIFOLD_PYTHON`, `SEMANTIFOLD_DOTNET`, and `SEMANTIFOLD_GO`; none of these APIs installs or downloads a tool. C# requires .NET SDK major 10, while Go requires Go 1.26.x on Linux/amd64 with matching-GOROOT `gofmt`.

This is not general-purpose support for any of the eight languages. The implemented subset is a two-parameter function using explicit integer, boolean, or string types; explicitly typed, initialized scalar locals; plain assignment to mutable locals; ordered lexical blocks; strictly boolean, nested `if` statements with optional `else`; explicit scalar returns; typed scalar operations; a two-argument function call; and sequenced printing. Operations cover integer add/subtract/multiply/negate and ordering, Boolean not/short-circuit and/or, same-type scalar value equality/inequality, and string concatenation. Non-void functions must return on every reachable path, and statements after an unconditional return are rejected. See [language support](docs/language-support.md) before using it on other code.

Semantic integers must be JavaScript-safe mathematical integers and have one unsigned zero. Generated JavaScript and TypeScript canonically render scalar output for modules containing negation or multiplication so IEEE-754 `-0` is observed as `0` without folding or rewriting the semantic operation tree. Java generation narrows literals and compile-time-known arithmetic trees further to signed 32-bit `int`. C# uses checked signed-64-bit arithmetic. Go uses exact decimal `int64` literals, rejects compile-time-known results outside signed 64-bit, and otherwise preserves native runtime wrap outside the portable guarantee. Strings are parser-decoded Unicode scalar values and are re-escaped for each target without preserving source quotes or escapes. Equality never coerces and never applies to objects or collections. Division, remainder, exponentiation, bitwise/shift/update/compound operations, ternary/nullish forms, casts/assertions, truthiness, implicit returns, loops, switches, exceptions, and constant folding are unsupported. JavaScript and TypeScript functions must be synchronous and non-generator; Ruby annotations must be immediately associated comment blocks; and PHP accepts only an optional exact `declare(strict_types=1)`. Python requires exact `int`/`bool`/`str` annotations and its exact adjacent immutable carrier. C# requires its exact generated namespace/class shell. Go requires `package main`, at most the exact `fmt` import, explicit `int64`/`bool`/`string` types, final zero-argument `func main()`, and direct `fmt.Println`; assignment occurrence determines source-local mutability, while generated immutable locals carry exact adjacent `// @semantifold-immutable`. Frontends reject syntax instead of dropping receivers, arguments, parameters, declarations, or statements. Before emission, each backend recursively validates blocks, flow, scalar types, typed operations, modeled bindings, mutability, target identifiers, and literal representability.

## Standard-library portability direction

Standard-library portability is planned and is not implemented in `semantifold@0.2.0`. The design is hub-and-spoke, with two integrations per language: a source-facing **language compatibility stdlib/facade** preserves that language's familiar supported API shape in portable executable definitions, while a **target host provider/native binding** implements versioned **canonical Semantifold stdlib contracts/capabilities** with the target's genuine native standard library.

For example, planned Ruby-to-PHP compilation would compile a Ruby application with portable Ruby `TCPSocket` and bounded one-string `puts`/`Kernel.puts` compatibility facades through the semantic IR. The generated PHP could retain those source-compatible names in a collision-safe compatibility namespace, call canonical `SocketClient`, text-stream, output, and resource capabilities, and link only the required PHP provider modules. That provider would use native `fsockopen`, `fgets`, and `fclose` for socket operations and native stdout output without adding a duplicate LF. This requires no handwritten Ruby-on-PHP bridge, source-specific loop recognition, or whole-program intelligent refactor. See the [authoritative standard-library portability design](docs/standard-library-portability.md) and [dependency-ordered implementation plan](docs/plans/2026-09-05-standard-library-portability.md).

## Development

Use Node.js 24 and install with `npm ci`. Specs use `@velocious/testing@0.0.0` and the standalone `velocious-test` runner. Run a focused spec with `npx velocious-test spec/repository-contract.spec.js`; run the framework-native `spec` directory discovery with `npm test`.

The aggregate suite includes direct real-toolchain specs that inherit the outer test process locale, so repository validation requires `LANG=C.UTF-8` and `LC_ALL=C.UTF-8`. The canonical container currently exports neither variable. This outer-suite requirement is separate from `runAcceptanceStages`, which normalizes the locale and timezone of every child it owns and does not depend on ambient locale.

The complete local gate is:

```sh
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
npm test
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
npm ls --omit=dev --all
npm ls --all
npm pack --dry-run --json
npm pack --workspace=@kaspernj/semantifold-tree-sitter-legacy --dry-run --json
git diff --check
```

The `packages/tree-sitter-legacy` workspace is an independently releasable adapter, not a runtime dependency of the root `semantifold` package. Its C export returns frozen parser-neutral CST data while isolating an exact legacy Tree-sitter runtime. Repository tests pack and install its real tarball beside the modern Go parser in a temporary consumer. A future Semantifold C frontend may depend on it only after a separately authorized registry publication and live-package verification.

The execution specs require PHP CLI, Ruby, Python 3, TypeScript, a Java JDK, .NET 10, and Go 1.26 with matching `gofmt` in addition to Node; missing tools are failures. The canonical container provides them: `docker compose up --build --detach`, followed by `docker compose exec dev npm ci` and the commands above.

## Documentation

- [Goals](docs/goals.md)
- [Architecture](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Language support](docs/language-support.md)
- [Parser qualification](docs/parser-qualification.md)
- [Testing](docs/testing.md)
- [Source provenance and mappings](docs/source-maps.md)
- [Standard-library portability design](docs/standard-library-portability.md)
- [Standard-library portability implementation plan](docs/plans/2026-09-05-standard-library-portability.md)
- [Language feature roadmap](https://github.com/kaspernj/semantifold/blob/master/todo/README.md)
- [Initial toolchain plan](docs/plans/2026-09-02-initial-toolchain.md)

Semantifold is ISC licensed.
