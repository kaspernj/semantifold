# Parser dependency qualification

Task 015 adds no parser dependency. It freezes the gate that every owning language task must complete before changing `package.json` or `package-lock.json`. Qualification is evidence for one exact candidate release; a package name or upstream reputation alone is not approval.

## Required record

The owning task must add a checked-in table row containing all of the following before its manifest edit:

| Evidence field | Required value |
| --- | --- |
| npm distribution | Exact registry package name and version; no range |
| upstream identity | Repository URL, release tag, and full commit SHA |
| legal/supply chain | SPDX license, npm integrity from the lockfile, and registry provenance checked |
| runtime compatibility | Exact `tree-sitter` Node binding version, grammar ABI/language version, and clean Node 24 install/import result on canonical Linux |
| API/coordinates | Typed Node API availability; parser UTF-8 byte/point behavior; tested conversion to one-based UTF-16 Semantifold locations |
| parser behavior | Comment visibility plus explicit missing/error/recovery-node and malformed-input results |
| Task 001–004 corpus | Every required declaration, block, statement, expression, type, identifier, literal, and call node; complete named/unnamed child traversal |
| differential result | Official compiler command/version and acceptance comparison for community grammars; discrepancies enumerated |
| repository audit | Proof that no generated archive, Git URL/tarball dependency, postinstall download, runtime fetch, or vendored parser binary entered the repository |

The record includes the exact corpus commands and hashes/paths, the installed dependency tree, and the tool output needed to reproduce the result. Any failure blocks that language task. It does not permit a source-text fallback, ignored recovery node, unrecorded parser substitution, runtime download, or softened test.

## Owning-task routes

All Tree-sitter languages use the official `tree-sitter` Node binding. The language task, not Task 015, selects and pins the exact npm versions and records the lockfile integrity after the gate passes.

| Owning task | Language | Required upstream route | Qualification state before owner starts |
| --- | --- | --- | --- |
| 016 | Python | official [`tree-sitter/tree-sitter-python`](https://github.com/tree-sitter/tree-sitter-python) grammar package | blocked until the exact release record above passes |
| 017 | C# | official [`tree-sitter/tree-sitter-c-sharp`](https://github.com/tree-sitter/tree-sitter-c-sharp) grammar package | blocked until the exact release record above passes |
| 018 | C | official [`tree-sitter/tree-sitter-c`](https://github.com/tree-sitter/tree-sitter-c) grammar package | blocked until the exact release record above passes |
| 019 | C++ | official [`tree-sitter/tree-sitter-cpp`](https://github.com/tree-sitter/tree-sitter-cpp) grammar package | blocked until the exact release record above passes |
| 020 | Rust | official [`tree-sitter/tree-sitter-rust`](https://github.com/tree-sitter/tree-sitter-rust) grammar package | blocked until the exact release record above passes |
| 022 | Swift | community [`alex-pinkus/tree-sitter-swift`](https://github.com/alex-pinkus/tree-sitter-swift) candidate plus differential `swiftc` checks | candidate only; blocked until exact release and differential record pass |
| 023 | Kotlin/JVM | community [`fwcd/tree-sitter-kotlin`](https://github.com/fwcd/tree-sitter-kotlin) candidate plus differential `kotlinc` checks | candidate only; blocked until exact release and differential record pass |
| 024 | Go | official [`tree-sitter/tree-sitter-go`](https://github.com/tree-sitter/tree-sitter-go) grammar package | blocked until the exact release record above passes |
| 029 | Dart | candidate selected and qualified by Task 029 | intentionally deferred |
| 031 | Zig | candidate selected and qualified by Task 031 | intentionally deferred |

Swift or Kotlin qualification failure leaves Task 022 or 023 blocked until its roadmap/source decision is explicitly revised. Parser archives produced by CI or release pages are not an alternative dependency route.

## Task 016 Python qualification

Qualification passed on the canonical Node `v24.18.1`, npm `11.16.0`, Linux lane with Python `3.14.4`. Task 016 therefore uses exact registry dependencies `tree-sitter@0.25.1` and the official `tree-sitter-python@0.25.0`; neither dependency is a Git URL, tarball path, copied archive, or vendored repository artifact.

| Evidence | Qualified result |
| --- | --- |
| npm distribution | `tree-sitter@0.25.1`, integrity `sha512-mrcEdkYtHfrK1A6fs3O6FxkBo0Qig5XUXqHhxUOQu0bmPo00QF4XaSx4edpazdHwxnSCjlGKGgIqWdaN4dvTLA==`; `tree-sitter-python@0.25.0`, integrity `sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==` |
| upstream identity | Official [`tree-sitter/node-tree-sitter`](https://github.com/tree-sitter/node-tree-sitter) tag `v0.25.1`, commit `75a0eccfedc491e26843bd744bb6806f8a8bfff4`; official [`tree-sitter/tree-sitter-python`](https://github.com/tree-sitter/tree-sitter-python) annotated tag `v0.25.0` (`d326e4cad262cf681656e130960e49dfc04c03ea`), peeled commit/npm `gitHead` `293fdc02038ee2bf0e2e206711b69c90ac0d413f` |
| legal and registry provenance | Both packages declare MIT. `npm audit signatures` verified all four installed-package registry signatures and two attestations. The binding publishes npm SLSA provenance; the grammar release has a verified registry signature but did not advertise an npm attestation. The exact official tag/commit and registry integrity were therefore checked independently. |
| clean install/load | Credential-free `npm install --save-exact tree-sitter@0.25.1 tree-sitter-python@0.25.0` succeeded in an empty temporary package. ESM default imports loaded both CommonJS packages, `new Parser().setLanguage(Python)` succeeded, and `npm ls --all` resolved only `node-addon-api@8.9.2`, `node-gyp-build@4.8.4`, the exact binding, and the exact grammar. |
| ABI and typed API | The shipped grammar parser declares ABI `15`; the binding headers accept language ABI `13` through `15`. The binding ships `tree-sitter.d.ts`; the grammar ships `bindings/node/index.d.ts` with its language handle and node-type metadata. |
| lifecycle and packaged inputs | Each package has only `install: node-gyp-build`; there is no network-download lifecycle. Registry contents include Linux/macOS/Windows prebuilds plus binding/grammar C sources, grammar/node-type JSON, declarations, and licenses. No package archive, prebuild, generated parser, native binary, or `node_modules` content is checked into Semantifold. Cold installs may select the registry prebuild or compile the shipped sources, so the canonical image retains its native build prerequisites. |
| coordinates and recovery | The native grammar contract is byte-based, but `node-tree-sitter@0.25.1` feeds JavaScript strings to Tree-sitter as UTF-16LE and exposes normalized UTF-16 code-unit indexes (`src/parser.cc`; an astral prefix shifted bytes and code units differently). The adapter rejects lone surrogates and routes every binding boundary through the shared UTF-8-byte-to-UTF-16 converter for exact verification. Comments are visible named nodes. Malformed parameters, conditions, and incomplete expressions set `hasError` and expose `ERROR`; the adapter also checks `isMissing` exhaustively even though the malformed probes recovered with `ERROR`. |
| Tasks 001-004 tree corpus | Exhaustive `child(index)` traversal observed named and anonymous nodes/tokens for modules, definitions, exact annotations, parameters, blocks, initialized assignments, plain assignment, returns, calls/arguments, scalar literals, unary/binary/Boolean/comparison operators, comments, `if`/`elif`/`else`, and entry expression statements. Adapter specs cover rejected dynamic/recovery nodes and exact token spans. |
| official-runtime comparison | `python3 -m py_compile` accepted all five Python fixtures under deterministic UTF-8. Python is the official implementation and the grammar is official, so no community-grammar differential exception applies. |

Reproduce the install/supply-chain gate in an empty temporary directory with:

```sh
npm init -y
env -u NODE_AUTH_TOKEN -u NPM_TOKEN -u npm_config__auth -u npm_config_token \
  npm install --save-exact tree-sitter@0.25.1 tree-sitter-python@0.25.0
npm audit signatures
npm ls --all
npm pack tree-sitter@0.25.1 --dry-run --json
npm pack tree-sitter-python@0.25.0 --dry-run --json
```

The accepted Python corpus is `spec/fixtures/{program.py,scalars/program.py,locals/program.py,operators/program.py,statements/program.py}` with SHA-256 values, in that order: `045ac897756dde15066878b56e40c84ee1aabdbd6fd32bddb9d0058ad512972a`, `b4acdda8c4c096ef7d76f83aec7dc148e049a0cd33583c55a79fd18ab1d6f6a6`, `123bb06c0833786168722ad7dfdcb47b95d37b502f6240fde4c12cd60f8e6715`, `35dce1aef96e5dc381baa1b2c39b58232d76b9e14350f0e81c4dd296da77df1e`, and `4907b25568006f65ce749f4c57b4b1eb9c7e6f655ad6be6e014d94c84885ada4`. Run `PYTHONPYCACHEPREFIX="$(mktemp -d)" python3 -m py_compile` over those paths so bytecode remains outside the checkout.
