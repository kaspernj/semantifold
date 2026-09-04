# Semantifold

Semantifold is an early language-neutral semantic code toolkit. This first release candidate proves a deliberately small end-to-end slice: parse equivalent PHP, Ruby, JavaScript with JSDoc, TypeScript, Java, and strictly annotated Python programs into one typed semantic representation, then generate and genuinely execute equivalent programs in every target language.

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

`parse` returns parser-independent discriminated semantic nodes with normalized types, source locations, a versioned source registry, and deterministic node/symbol provenance. `generate` accepts that shared module and returns an independently executable source program with its historical bytes unchanged. `generateArtifact` adds an output filename, an authoritative range-based `SemantifoldMapping` v1, and a Source Map v3 sidecar for every target:

```js
import {generateArtifact, originalPositionFor} from "semantifold"

const artifact = generateArtifact({language: "java", module})
const original = originalPositionFor(artifact.mapping, {offset: artifact.code.indexOf("label")})
```

Generated output always uses LF. Exact original content, including LF, CRLF, lone CR, and astral UTF-16 coordinates, remains in the source registry and `sourcesContent`. Optional inline/external `sourceMappingURL` directives apply only to JavaScript and TypeScript; PHP, Ruby, Java, and Python use the same rich/v3 sidecars without foreign comments. See [source provenance and mappings](docs/source-maps.md) for schemas, lookups, composition, diagnostics, directives, and compatibility.

`supportedLanguages` is the immutable registry-derived list `php`, `ruby`, `javascript`, `typescript`, `java`, and `python`. `languageCapabilities` exposes each ID's independent frontend, text-backend, binary-backend, application-backend, and interoperability roles together with artifact multiplicity, round-trip, mapping, acceptance-stage, and toolchain declarations. Unknown IDs use `UNSUPPORTED_LANGUAGE`; a registered ID missing a requested role uses `UNSUPPORTED_ROLE`; an existing backend that cannot represent a semantic module uses `UNSUPPORTED_CAPABILITY`.

`generateArtifactSet` is the additive single-module artifact API. Original text targets return an entry artifact with the exact legacy bytes and rich/v3 mappings; an external JavaScript-family map directive also returns the referenced serialized mapping sidecar. `createGeneratedArtifactSet` validates future multi-file text, binary, mixed loader/binary, and application shapes transactionally: paths are ordered, unique, safe relative POSIX paths with no file/directory prefix collisions; content is explicitly text or bytes; media type, role, generated ownership, and provenance are required; and exactly one artifact has role `entry`. Binary content is held privately and returned as a fresh detached byte view on every read, so caller mutation cannot change validated bytes or their provenance. Generated helper files do not create semantic modules and are not Task 010 projects.

Binary/resource provenance uses `SemantifoldByteMapping` v1 through `createByteMapping`, `parseByteMapping`, and `stringifyByteMapping`. Generated ranges are ordered, non-overlapping, half-open byte offsets with semantic identities or explicit synthetic reasons. They are never interpreted as UTF-16 positions.

`discoverCanonicalToolchain` and `discoverToolchain` resolve an exact executable from a configured absolute override or one unambiguous canonical PATH command and capture its version. `runAcceptanceStages` materializes a validated artifact set in a unique temporary directory and runs applicable `parse`, `generate`, `compile`, `link`, `validate`, `instantiate`, and `execute` stages with exact argument arrays, a deterministic locale/timezone, bounded per-stage timeouts, captured output, no shell, and normalized stage diagnostics. The canonical overrides are `SEMANTIFOLD_PHP`, `SEMANTIFOLD_RUBY`, `SEMANTIFOLD_NODE`, `SEMANTIFOLD_TSC`, `SEMANTIFOLD_JAVAC`, `SEMANTIFOLD_JAVA`, and `SEMANTIFOLD_PYTHON`; none of these APIs installs or downloads a tool.

This is not general-purpose support for any of the six languages. The implemented subset is a two-parameter function using explicit integer, boolean, or string types; explicitly typed, initialized scalar locals; plain assignment to mutable locals; ordered lexical blocks; strictly boolean, nested `if` statements with optional `else`; explicit scalar returns; typed scalar operations; a two-argument function call; and sequenced printing. Operations cover integer add/subtract/multiply/negate and ordering, Boolean not/short-circuit and/or, same-type scalar value equality/inequality, and string concatenation. Non-void functions must return on every reachable path, and statements after an unconditional return are rejected. See [language support](docs/language-support.md) before using it on other code.

Semantic integers must be JavaScript-safe mathematical integers and have one unsigned zero. Generated JavaScript and TypeScript canonically render scalar output for modules containing negation or multiplication so IEEE-754 `-0` is observed as `0` without folding or rewriting the semantic operation tree. Java generation narrows literals and compile-time-known arithmetic trees further to signed 32-bit `int`; general runtime-overflow equivalence remains outside the portable contract. Strings are parser-decoded Unicode scalar values and are re-escaped for each target without preserving source quotes or escapes. Equality never coerces and never applies to objects or collections. Division, remainder, exponentiation, bitwise/shift/update/compound operations, ternary/nullish forms, casts/assertions, truthiness, implicit returns, loops, switches, exceptions, and constant folding are unsupported. JavaScript and TypeScript functions must be synchronous and non-generator; Ruby annotations must be immediately associated comment blocks; and PHP accepts only an optional exact `declare(strict_types=1)`. Python requires exact `int`/`bool`/`str` annotations on parameters, returns, and initialized locals, treats `bool` and `int` as distinct, and rejects dynamic forms; its exact adjacent `# @semantifold-immutable` carrier preserves immutable-local intent. Frontends reject syntax instead of dropping receivers, arguments, parameters, declarations, or statements. Before emission, each backend recursively validates blocks, flow, scalar types, typed operations, modeled bindings, mutability, target identifiers, and literal representability.

## Development

Use Node.js 24 and install with `npm ci`. Specs use `@velocious/testing@0.0.0` and the standalone `velocious-test` runner. Run a focused spec with `npx velocious-test spec/repository-contract.spec.js`; run the framework-native `spec` directory discovery with `npm test`.

The complete local gate is:

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
npm ls --omit=dev --all
npm pack --dry-run --json
```

The execution specs require PHP CLI, Ruby, Python 3, TypeScript, and a Java JDK in addition to Node; missing tools are failures. The canonical container provides them: `docker compose up --build --detach`, followed by `docker compose exec dev npm ci` and the commands above.

## Documentation

- [Goals](docs/goals.md)
- [Architecture](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Language support](docs/language-support.md)
- [Parser qualification](docs/parser-qualification.md)
- [Testing](docs/testing.md)
- [Source provenance and mappings](docs/source-maps.md)
- [Language feature roadmap](https://github.com/kaspernj/semantifold/blob/master/todo/README.md)
- [Initial toolchain plan](docs/plans/2026-09-02-initial-toolchain.md)

Semantifold is ISC licensed.
