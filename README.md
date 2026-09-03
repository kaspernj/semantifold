# Semantifold

Semantifold is an early language-neutral semantic code toolkit. This first release candidate proves a deliberately small end-to-end slice: parse equivalent PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java programs into one typed semantic representation, then generate and genuinely execute equivalent programs in every target language.

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

`parse` returns parser-independent discriminated semantic nodes with normalized types and source locations. `generate` accepts that shared module and returns an independently executable source program. `supportedLanguages` lists the five exact language identifiers, and `SemantifoldDiagnostic` exposes stable error codes for unsupported syntax, missing types, parse failures, binding/type failures, and backend capabilities.

This is not general-purpose support for any of the five languages. The implemented subset is a two-parameter function using explicit integer, boolean, or string types; explicitly typed, initialized scalar locals; plain assignment to mutable locals; a strictly boolean `if`/`else`; one return per branch; integer `+`, `-`, and `>`; a two-argument function call; and entry-point printing. Declarations and assignments may form a restricted prefix before the existing terminal function `if`, branch return, or entry print. See [language support](docs/language-support.md) before using it on other code.

Semantic integers must be JavaScript-safe integers. Java generation narrows literals further to signed 32-bit `int`; arithmetic-result overflow remains outside the portable contract. Strings are parser-decoded Unicode scalar values and are re-escaped for each target without preserving source quotes or escapes. Interpolation, lone surrogates, nullability, floating point, wrapper types, inferred public types, and unions remain unsupported. JavaScript and TypeScript functions must be synchronous and non-generator; Ruby annotations must be immediately associated comment blocks; and PHP accepts only an optional exact `declare(strict_types=1)`. Ruby and PHP local carriers default to mutable and use the exact `@semantifold-immutable` profile tag for immutable locals. Frontends reject syntax instead of dropping receivers, arguments, parameters, declarations, or statements. Before emission, each backend validates shape, scalar types, modeled bindings, mutability, target identifiers, and literal representability.

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

The execution specs require PHP CLI, Ruby, TypeScript, and a Java JDK in addition to Node; missing tools are failures. The canonical container provides them: `docker compose up --build --detach`, followed by `docker compose exec dev npm ci` and the commands above.

## Documentation

- [Goals](docs/goals.md)
- [Architecture](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Language support](docs/language-support.md)
- [Testing](docs/testing.md)
- [Language feature roadmap](https://github.com/kaspernj/semantifold/blob/master/todo/README.md)
- [Initial toolchain plan](docs/plans/2026-09-02-initial-toolchain.md)

Semantifold is ISC licensed.
