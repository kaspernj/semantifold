# Testing

Specs use the released `@velocious/testing@0.0.0` framework and standalone `velocious-test` runner with one top-level `describe` per file. Direct value checks use the framework's `expect` API where it improves clarity; predicate-rich diagnostic assertions retain `node:assert/strict`. Frontend tests load real fixtures through Babel, php-parser, Prism, and Lezer and compare the resulting semantic modules after removing only source locations. They separately assert normalized JSDoc and TypeScript types and verify locations exist.

Backend tests start from one parsed semantic module, generate every target, parse each generated program back to equivalent modeled meaning, and work in isolated `mkdtemp` directories. They invoke real commands and assert exact `5\n` output:

- `php program.php`
- `ruby program.rb`
- `node program.js`
- local lockfile-installed `tsc program.ts`, then `node program.js`
- `javac Main.java`, then `java -cp … Main`

Cleanup runs in `finally`. A missing tool raises the process error and fails the spec; there are no skip branches or mocked compilers. Diagnostic specs cover unsupported syntax, missing JSDoc types, and backend capability rejection.

Focused correction specs prove that unsafe numeric literals never enter the semantic tree; async/generator flags are rejected; Java receivers, unsupported arguments, and extra entry statements cannot disappear; Ruby annotations and parameter forms stay function-local; and PHP accepts only its precise strict-types declaration. Backend specs cover target reserved identifiers, Java's signed 32-bit range, and exact one-return branch cardinality. Repository-contract specs parse package metadata, Compose/TensorBuzz YAML, and the Dockerfile AST; they prove the custom ESLint plugin uses an immutable commit and TensorBuzz is the sole CI topology.

Run `npx velocious-test spec/repository-contract.spec.js` for the focused repository contract and `npm test` for framework-native discovery of `.spec.js` files under `spec`. An empty selection is a framework failure and exits nonzero. Run `npm run lint`, `npm run typecheck`, and `npm run build` for source quality and declaration generation. Packaging validation is documented in the root README and `AGENTS.md`.
