# Semantifold

Semantifold is an early language-neutral semantic code toolkit. This first release candidate proves a deliberately small end-to-end slice: parse equivalent PHP, Ruby, JavaScript with JSDoc, TypeScript, and Java programs into one typed semantic representation, then generate and genuinely execute equivalent programs in every target language.

## Current API

```js
import {generate, parse} from "semantifold"

const module = parse({
  filename: "difference.ts",
  language: "typescript",
  source: `
    function difference(left: number, right: number): number {
      if (left > right) return left - right
      else return right - left
    }
    console.log(difference(4, 9))
  `
})

const javaSource = generate({language: "java", module})
```

`parse` returns parser-independent discriminated semantic nodes with normalized types and source locations. `generate` accepts that shared module and returns an independently executable source program. `supportedLanguages` lists the five exact language identifiers, and `SemantifoldDiagnostic` exposes stable error codes for unsupported syntax, missing types, parse failures, and backend capabilities.

This is not general-purpose support for any of the five languages. The implemented subset is a typed two-integer function, comparison, `if`/`else` returns, integer `+`/`-`, a function call, and entry-point printing. See [language support](docs/language-support.md) before using it on other code.

Semantic integers must be JavaScript-safe integers. Java generation narrows them further to signed 32-bit `int`. JavaScript and TypeScript functions must be synchronous and non-generator; Ruby annotations must be the immediately associated comment block; and PHP accepts only an optional exact `declare(strict_types=1)`. Frontends reject syntax instead of dropping receivers, arguments, parameters, declarations, or statements. Before emission, each backend validates exact one-return branch shape plus target lexical and reserved-word rules for every function, parameter, callee, and identifier reference.

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
