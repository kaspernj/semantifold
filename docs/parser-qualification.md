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
| repository audit | Proof that no unqualified archive, mutable Git dependency, postinstall download, runtime fetch, or vendored parser binary entered the repository; an explicit parser-route amendment must identify any immutable source-archive exception |

The record includes the exact corpus commands and hashes/paths, the installed dependency tree, and the tool output needed to reproduce the result. Any failure blocks that language task. It does not permit a source-text fallback, ignored recovery node, unrecorded parser substitution, runtime download, or softened test.

## Owning-task routes

All Tree-sitter languages use the official `tree-sitter` Node binding. The language task, not Task 015, selects and pins the exact npm versions and records the lockfile integrity after the gate passes.

| Owning task | Language | Required upstream route | Qualification state before owner starts |
| --- | --- | --- | --- |
| 016 | Python | official [`tree-sitter/tree-sitter-python`](https://github.com/tree-sitter/tree-sitter-python) grammar package | blocked until the exact release record above passes |
| 017 | C# | official [`tree-sitter/tree-sitter-c-sharp`](https://github.com/tree-sitter/tree-sitter-c-sharp) grammar package | passed for exact `tree-sitter-c-sharp@0.23.5`; see the checked-in record below |
| 018 | C | official [`tree-sitter/tree-sitter-c`](https://github.com/tree-sitter/tree-sitter-c) grammar package | legacy pair qualified inside the bundled root distribution below; source/target work remains blocked until that packaging correction is reviewed, green, merged, and verified |
| 019 | C++ | official [`tree-sitter/tree-sitter-cpp`](https://github.com/tree-sitter/tree-sitter-cpp) grammar package | exact 0.23.4 qualified with the existing isolated 0.21.1 runtime; see Task 019 record below |
| 020 | Rust | official [`tree-sitter/tree-sitter-rust`](https://github.com/tree-sitter/tree-sitter-rust) grammar package | exact 0.23.1 grammar qualified below and integrated in the existing private 0.21.1 runtime |
| 022 | Swift | community grammar through the exact Semantifold packaging fork plus differential `swiftc` checks | Node/package/CST qualification and rebuilt-image Swift 6.3.3 compiler differential passed locally at merge commit `2a4515bb1d2d075c4c72a3466fbccb75f5269caf`; delivery gates remain separate |
| 023 | Kotlin/JVM | community grammar through the exact Semantifold packaging fork plus differential `kotlinc` checks | passed for immutable tag `v0.4.0-semantifold.1`, commit `57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0`, ABI 14, Node24, and Kotlin/JVM 2.4.20; see below |
| 024 | Go | official [`tree-sitter/tree-sitter-go`](https://github.com/tree-sitter/tree-sitter-go) grammar package | passed for exact `tree-sitter-go@0.25.0`; see the checked-in record below |
| 029 | Dart | candidate selected and qualified by Task 029 | intentionally deferred |
| 031 | Zig | candidate selected and qualified by Task 031 | intentionally deferred |

Swift or Kotlin qualification failure leaves Task 022 or 023 blocked until its roadmap/source decision is explicitly revised. Parser archives produced by CI or release pages are not an alternative dependency route. Task022 records one narrow amendment: the registry's Swift 0.7.1 package lacks the required install-safe Node24 contract, so Semantifold uses a full-SHA GitHub source archive from its public packaging fork rather than a generated release asset or mutable Git reference.

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

## Task 017 C# qualification

Qualification passed in a credential-free empty `/tmp` package on canonical Node `v24.18.1`, npm `11.16.0`, Linux x64, and .NET SDK `10.0.111` (runtime/`Microsoft.NETCore.App` `10.0.11`, RID `ubuntu.26.04-x64`, `Microsoft.NETCore.App.Ref`/`Microsoft.AspNetCore.App.Ref` targeting packs `10.0.11`). Task 017 therefore uses the existing exact `tree-sitter@0.25.1` binding with official registry grammar `tree-sitter-c-sharp@0.23.5`; neither dependency is a Git/archive path or vendored artifact.

| Evidence | Qualified result |
| --- | --- |
| npm distribution | `tree-sitter-c-sharp@0.23.5`, resolved from `https://registry.npmjs.org/tree-sitter-c-sharp/-/tree-sitter-c-sharp-0.23.5.tgz` with integrity `sha512-xJGOeXPMmld0nES5+080N/06yY6LQi+KWGWV4LfZaZe6srJPtUtfhIbRSN7EZN6IaauzW28v6W4QHFwmeUW6HQ==`; exact peer `tree-sitter@^0.25.0` is satisfied by `0.25.1`. |
| upstream identity | Official [`tree-sitter/tree-sitter-c-sharp`](https://github.com/tree-sitter/tree-sitter-c-sharp) annotated tag `v0.23.5` (tag object `173c15453b733ccde654032fec7103705b5ad04f`), peeled commit and npm `gitHead` `cac6d5fb595f5811a076336682d5d595ac1c9e85`. |
| legal and registry provenance | The grammar declares MIT. In the clean exact installation, `npm audit signatures` verified all four installed-package registry signatures and two attestations. The grammar's registry signature, tag/commit identity, package contents, and lockfile integrity were checked; no credential was exposed or requested. |
| clean Node 24 install/load | With npm auth/token environment variables removed, exact installation and `npm ls --all` passed with zero vulnerabilities. The package has no Node engine declaration, so compatibility was proven empirically: its explicit Node binding import loaded, `Parser#setLanguage` succeeded, and all fixtures parsed through the native binding. |
| ABI, typing, lifecycle, and package inputs | The grammar declares ABI `15`; `tree-sitter@0.25.1` supports ABI `13`–`15`. The grammar ships typed `bindings/node/index.d.ts`, Linux x64/arm64 prebuilds, grammar C source fallback, and only `install: node-gyp-build`; no runtime downloader is declared. Dry-run packs showed normal registry package contents. No tarball, parser source copy, prebuild, `node_modules`, NuGet cache, `bin`, or `obj` entered the repository. |
| coordinates and recovery | `child(index)` traversal covered every named, anonymous, comment, nullable directive, error, and missing node. The Node binding exposes UTF-16 code-unit indexes for JavaScript strings despite Tree-sitter's byte-oriented native contract; astral text before an identifier and CRLF probes separated UTF-16 and UTF-8 offsets. The adapter rejects lone surrogates and verifies every boundary through the shared UTF-8-byte-to-UTF-16 converter. Malformed braces, operands, and missing semicolons produced explicit or propagated `hasError`/`isError`/`isMissing`; propagated ancestor error state is rejected even where no distinct `ERROR` child exists. |
| Tasks 001–004 grammar shapes | The five fixtures proved exact shapes for `preproc_nullable`, file-scoped namespace, class/modifiers, methods/parameters/types, blocks, declarations, carrier comments, assignments, calls/arguments, print member access, checked expressions, all scalar literals/operators, returns, and `if`/`else if`/`else`. Adapter specs retain field and token ranges and reject every unmodeled present child. |
| official compiler comparison | All five fixture projects restored without external packages, built under .NET 10/C# 14 with warnings as errors and no warning output, and executed with exact expected stdout. Restore, build, and execution were separate; the isolated `NUGET_PACKAGES` path was resolved to an absolute path because the SDK rejects a relative global packages folder. The official grammar needs no community-grammar differential exception. |

Reproduce the registry qualification in an empty temporary directory with:

```sh
npm init -y
env -u NODE_AUTH_TOKEN -u NPM_TOKEN -u npm_config__auth -u npm_config_token \
  npm install --save-exact tree-sitter@0.25.1 tree-sitter-c-sharp@0.23.5
npm audit signatures
npm ls --all
npm pack tree-sitter@0.25.1 --dry-run --json
npm pack tree-sitter-c-sharp@0.23.5 --dry-run --json
```

The accepted C# corpus is `spec/fixtures/{Program.cs,scalars/Program.cs,locals/Program.cs,operators/Program.cs,statements/Program.cs}` with SHA-256 values, in that order: `5ca661d09dff2d775094df99b40e5c5604796c9bff4c32c1da11fa1b4c564a00`, `9cefd6d01c5855480629829489945f2f43338b84879c7a26043963151a8439da`, `ee775fea59ee812212ce325152e4e4cb79c20e699aba081bf39cc698b324444d`, `7137f4acc88dbdc1d0bafd6bb8eb57bed9386daf3e6b11c6fbae3831abceae18`, and `ba63cb72490605437e1efaa7d69ce0abdbfbb07c076aec787bc025e7a277468f`.

## Task 018 legacy C parser boundary qualification

The C grammar's compatible published runtime line cannot share Semantifold's root Tree-sitter instance. The one root `semantifold@0.2.0` distribution therefore explicitly bundles root `tree-sitter@0.25.1` for its modern grammars and a private internal package with an isolated exact `tree-sitter@0.21.1` plus `tree-sitter-c@0.23.2` subtree, whose peer range and grammar ABI agree. The renamed private workspace owns source checking and declaration generation but has no export, publication metadata, or release gate. A separately tested `tree-sitter@0.22.4` plus `tree-sitter-c@0.24.1` install was rejected because `Parser#setLanguage` failed with an undefined `nodeTypeNamesById`; an installable graph alone is not qualification.

| Evidence | Qualified boundary result |
| --- | --- |
| npm distribution | `tree-sitter@0.21.1`, integrity `sha512-7dxoA6kYvtgWw80265MyqJlkRl4yawIjO7S5MigytjELkX43fV2WsAXzsNfO7sBpPPCF5Gp0+XzHk0DwLCq3xQ==`; `tree-sitter-c@0.23.2`, integrity `sha512-9kADOx31AF94DHcrsMGW0zM/2LS6v7wFkPHPVm7RQU+vYVVZMKZ2FJ9e99pm5feqsAcjUzB9CarqDLgRT1Fe/w==`. npm's supported `file:` dependency plus repository-local `install-links=true` materializes the private internal package, and root `bundleDependencies` includes that package and modern `tree-sitter`. Root `acceptDependencies` retains the exact private `0.1.0` payload; Task023 separately adds the exact bundled public Kotlin grammar acceptance without changing this legacy source or peer graph. No alias, override, forced peer, archive dependency, copied binding, or custom materialization stage is used. |
| upstream identity | Official [`tree-sitter/node-tree-sitter`](https://github.com/tree-sitter/node-tree-sitter) tag/commit `v0.21.1` / `bbdba663dc0b8487f1212524a83a7c39e8a5c3ca`; official [`tree-sitter/tree-sitter-c`](https://github.com/tree-sitter/tree-sitter-c) tag/commit and npm `gitHead` `v0.23.2` / `6a4ae2e08916fd08e5739250bb64a14392b01c99`. |
| legal and registry provenance | Both upstream packages declare MIT and publish registry signatures. Their exact registry URLs and integrities are recorded in `package-lock.json`; the repository gate verifies installed-package signatures and audits the ordinary dependency graph. The private internal package uses ISC and has no public registry identity. All three dependency licenses remain in the root tarball. |
| ABI and API | `tree-sitter-c@0.23.2` declares language ABI 14; `tree-sitter@0.21.1` accepts ABI 13–14 and the grammar's peer is `^0.21.1`. The legacy binding provides `child(index)` and `fieldNameForChild(index)` but not the newer `fieldNameForNamedChild` convenience API. The adapter therefore traverses every ordered named and anonymous child and copies field names without exposing binding types. |
| runtime isolation | A real root tarball installed into a credential-free consumer with a fresh npm cache resolves modern `tree-sitter@0.25.1` at the root and legacy `tree-sitter@0.21.1` plus `tree-sitter-c@0.23.2` below the private internal package at distinct paths. No workspace is present in the consumer and no registry publication of the internal name is required. One Node `v24.18.1` Linux x64 process parses modern Go and legacy C without a native-module collision. Ordinary npm install and peer resolution are mandatory. |
| private boundary | The internal `parseCst(source)` returns only a recursively frozen `semantifold.parser-cst` version 1 envelope and is absent from Semantifold's public exports. Nodes contain plain scalar state, UTF-16 indices/row-column positions, and ordered frozen `{field, node}` edges. Parser, tree, syntax-node, language, method, function, parent, circular, and source-text values do not cross the boundary. The caller retains source ownership and can slice it by the normalized offsets. |
| recovery and coordinates | Astral text before a later definition plus CRLF separates UTF-8 bytes from UTF-16 code units; the snapshot retains exact UTF-16 indices and row/column positions. Comments remain visible as extra nodes. A missing closing brace propagates `hasError` and preserves the missing node rather than recovering through source text. |
| lifecycle and package inputs | The native dependencies use only `install: node-gyp-build` and have no runtime downloader. The root tarball retains licenses, `binding.gyp`, and native source fallback for both Tree-sitter bindings plus the C grammar's `binding.gyp` and generated parser source. Modern `tree-sitter@0.25.1` includes Darwin, Linux, and Windows x64/arm64 prebuilds; legacy `tree-sitter@0.21.1` includes Darwin arm64/x64, Linux x64, and Windows x64 prebuilds; `tree-sitter-c@0.23.2` includes Darwin, Linux, and Windows x64/arm64 prebuilds. Only Linux x64 native loading and execution were tested. Other listed platforms rely on upstream prebuild selection or source compilation and are packaging-presence claims, not execution claims. Source fallback additionally requires a compatible compiler toolchain and consumer npm policy permitting the upstream `node-gyp-build` install scripts; fallback compilation was not executed here. Accidental `build/Debug` or `build/Release` output is rejected from the pack proof. |
| task boundary | This record qualifies only the runtime/package boundary. It does not implement or claim the Task 018 C frontend, semantic normalization, backend, registry, toolchain, compiler comparison, or Tasks 001–004 C corpus. That prerequisite was completed through https://github.com/kaspernj/semantifold/pull/19 at `9184660a21820b429138f0632c89df956a2e350f`; Task 018 implementation and native acceptance are recorded separately below. No package publication is part of that prerequisite. |

Reproduce the repository-owned proof on Node 24 with:

```sh
npm ci
npx velocious-test spec/tree-sitter-legacy-adapter.spec.js
npx velocious-test spec/tree-sitter-legacy-packed-consumer.spec.js
npm ls --all
npm pack --dry-run --json
```

The packed-consumer spec creates the root tarball, fresh cache, and consumer only under unique temporary directories. It removes all inherited npm configuration and token variables case-insensitively, uses empty user/global npm config files and explicit `https://registry.npmjs.org/`, and asserts default `install-links=false` even when supplied synthetic alternate configuration. Before packing, the source/installed consistency gate rejects stale local-package copies; normal root `npm ci` is the recovery after shipped source edits. The spec compares bundled internal files with source and runs default `npm install` followed by default `npm ci`. After each it checks the complete installed lock/tree and real runtime paths, compiles a root API type consumer, and executes both parsers in one process. Cache inspection rejects internal or retired registry lookups; `finally` removes the fixture. Publication is intentionally excluded from this qualification.

The dependency declaration follows npm's implemented [acceptDependencies contract](https://github.com/npm/rfcs/blob/main/implemented/0023-acceptDependencies.md): an already-present exact package can satisfy the edge, but new resolution uses only `dependencies`, here the local `file:` source. It does not relax either native runtime or grammar version and is not an override. With npm 11.16.0, a direct private-workspace fixture packed the legacy bindings under `packages/internal/node_modules` while placing the workspace payload under `node_modules`, leaving the installed boundary unresolved. The materialized local dependency instead packs the complete subtree under its real module directory; the source-byte gate and default-consumer proof protect both halves of that contract.

## Task 024 Go qualification

Qualification passed in a credential-free empty `/tmp` package on canonical Node `v24.18.1`, npm `11.16.0`, Linux x64, and Go `go1.26.0 linux/amd64` with GOROOT `/usr/lib/go-1.26`. Task 024 therefore uses the existing exact `tree-sitter@0.25.1` binding with official registry grammar `tree-sitter-go@0.25.0`; neither dependency is a Git/archive path or vendored artifact.

| Evidence | Qualified result |
| --- | --- |
| npm distribution | `tree-sitter-go@0.25.0`, resolved from `https://registry.npmjs.org/tree-sitter-go/-/tree-sitter-go-0.25.0.tgz` with integrity `sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw==`; peer `tree-sitter@^0.25.0` is satisfied by exact `tree-sitter@0.25.1` with integrity `sha512-mrcEdkYtHfrK1A6fs3O6FxkBo0Qig5XUXqHhxUOQu0bmPo00QF4XaSx4edpazdHwxnSCjlGKGgIqWdaN4dvTLA==`. |
| upstream identity | Official [`tree-sitter/tree-sitter-go`](https://github.com/tree-sitter/tree-sitter-go) annotated tag `v0.25.0` (tag object `6048bfc6e5238eaf062c2221bd934489c39fbb61`), peeled commit and npm `gitHead` `1547678a9da59885853f5f5cc8a99cc203fa2e2c`. The binding is official tag `v0.25.1`, npm `gitHead` `75a0eccfedc491e26843bd744bb6806f8a8bfff4`. |
| legal and registry provenance | Both packages declare MIT. `npm audit signatures` verified all four installed-package registry signatures and two attestations with no invalid or missing signature. The binding publishes npm SLSA provenance; the grammar has a verified registry signature but did not advertise an npm attestation, so tag/commit identity and registry integrity were checked independently. |
| clean install/load | With npm auth/token environment variables removed, `npm install --save-exact tree-sitter@0.25.1 tree-sitter-go@0.25.0` succeeded from the registry in a fresh package with zero vulnerabilities. `npm ls --all` resolved only `node-addon-api@8.9.2`, `node-gyp-build@4.8.4`, the exact binding, and the exact grammar. The explicit ESM import loaded on Node 24, `Parser#setLanguage` succeeded, and typed `nodeTypeInfo` exposed 188 grammar entries. |
| ABI, typing, lifecycle, and package inputs | The shipped grammar declares ABI `15`; `tree-sitter@0.25.1` accepts ABI `13` through `15`. The grammar declaration exposes its language handle and `NodeInfo[]` metadata. Both packages use only `install: node-gyp-build`, with no downloader URL or extra lifecycle dependency. Dry-run packs contained 80 binding files (1,594,590-byte archive) and 25 grammar files (558,540-byte archive), including declarations, licenses, platform prebuilds, and source fallback. No archive, prebuild, generated parser, native binary, `node_modules`, or qualification output entered Semantifold. |
| coordinates, comments, and recovery | The Node binding exposed UTF-16 code-unit indexes: after astral text and CRLF, one literal occupied indexes 61–65 while raw UTF-8 byte boundaries were 63–69; both round-tripped through `utf8ByteOffsetToUtf16Offset()`. Lone surrogates were rejected before parsing. Ordinary and `//go:`, `// +build`, and `//line` directive comments remained visible nodes. Malformed package clauses, parameter lists, missing operands, braces, semicolons, and incomplete strings all exposed `hasError`, `isError`, or `isMissing`. |
| Tasks 001–004 tree corpus | Exhaustive `child(index)` traversal covered every named and anonymous child, token, comment, and `fieldNameForChild` edge in all five fixtures. Observed shapes include the exact package/import/function/parameter/type/result/block scaffold; variable declarations/specs; assignment/expression lists; returns, calls, arguments, and selectors; parentheses; every accepted scalar/operator node; and nested `if`/`else if`/`else`. No source scan supplied missing structure. |
| official-tool differential | Matching `/usr/lib/go-1.26/bin/gofmt -d` produced no diff for all five fixtures. In separate dependency-free modules with fixed `go.mod`, every fixture passed offline/local, cgo-disabled `go build`, mandatory `go vet`, and `go run` with exact output. A no-import sample passed `go tool compile`. All six malformed samples were rejected by both `gofmt` and `go tool compile`. A slice/range/short-declaration sample parsed, formatted, built, vetted, and ran under official Go, establishing the intentional valid-but-`UNSUPPORTED_SYNTAX` differential boundary. No `go.sum`, `go.work`, vendor tree, or source mutation appeared. |
| toolchain isolation | Every Go process used `GOTOOLCHAIN=local`, `GOPROXY=off`, `GOSUMDB=off`, `GOVCS=off`, `CGO_ENABLED=0`, `GOENV=off`, `GOWORK=off`, `GOOS=linux`, `GOARCH=amd64`, and separate absolute cache/module/GOPATH/temp/home paths. `/usr/bin/gofmt` resolved to `/usr/lib/go-1.26/bin/gofmt`, the same verified GOROOT as `go`. |

Reproduce the registry qualification in a fresh empty temporary directory with:

```sh
npm init -y
env -u NODE_AUTH_TOKEN -u NPM_TOKEN -u npm_config__auth -u npm_config_token \
  npm install --save-exact tree-sitter@0.25.1 tree-sitter-go@0.25.0
npm audit signatures
npm ls --all
npm pack tree-sitter@0.25.1 --dry-run --json
npm pack tree-sitter-go@0.25.0 --dry-run --json
```

The accepted Go corpus is `spec/fixtures/{program.go,scalars/program.go,locals/program.go,operators/program.go,statements/program.go}` with SHA-256 values, in that order: `5f4ad40a233d8728c90ca885d4bfe6f018f1d7a5e6f2e2cfb97b4b9db4887f1c`, `6d4251def8b1bccdff177df901bf9fe109a8a01ae1514cb8d5aaf364298669b9`, `a7b6eb2f5eae0a20d7cd4982e4d26cc6653760ad03e8b21ff5c360239861dd6f`, `4a263413830a41a59b6d8326a78067826853e3491e65d52559e5acea0d9cf56c`, and `d64f083d70697d25d2ea7f5c7a44cada0ab13a878640fd10bc547df185fa7bba`.

## Task 018 C integration

The C frontend consumes the unchanged frozen parser-neutral legacy boundary qualified above. It adds no native dependency, archive, copied parser, workspace identity, consumer flag or override. Complete C child/field/token traversal, recovery rejection, exact generated-region reconstruction and full canonical-CST comparison are covered by `spec/c-frontend-validation.spec.js` and `spec/c-ordered-expressions.spec.js`. The five checked-in `program.c` fixture profiles pass generated-source round trips and original-five bidirectional execution. Unicode/NUL, every operation/consumer, eager/short-circuit effects and arena/fatal paths run through real separate Clang compile/link/native execution at O0/O2, ordinary and sanitized. The ordinary packed-root consumer now additionally exercises public C parse/generate/reparse and C API typing after both default install and clean npm ci; it preserves the existing credential-free configuration and cache proof. This is implementation regression coverage, not another packaging review. See [C semantics and scaffolds](c.md), [toolchain qualification](testing.md) and [the delivery record](../todo/018-c-source-and-target.md).

## Task 019 C++ grammar qualification — 2026-09-08

This record precedes the dependency manifest change. The official C++ grammar is selected explicitly inside the existing private runtime; the C grammar is not a C++ parser. The root distribution and both existing Tree-sitter versions remain unchanged.

| Evidence | Qualified result |
| --- | --- |
| Official npm release | `tree-sitter-cpp@0.23.4`, registry URL `https://registry.npmjs.org/tree-sitter-cpp/-/tree-sitter-cpp-0.23.4.tgz`, integrity `sha512-qR5qUDyhZ5jJ6V8/umiBxokRbe89bCGmcq/dk94wI4kN86qfdV8k0GHIUEKaqWgcu42wKal5E97LKpLeVW8sKw==`. Latest registry tag at qualification was 0.23.4. |
| Upstream identity and license | Official [tree-sitter/tree-sitter-cpp](https://github.com/tree-sitter/tree-sitter-cpp/tree/v0.23.4), tag `v0.23.4` and npm gitHead both `f41e1a044c8a84ea9fa8577fdd2eab92ec96de02`; MIT license present in the registry package. `git ls-remote` verified the tag. |
| Ordinary peer graph | Optional peer `tree-sitter@^0.21.1`, grammar ABI 14; exact existing binding 0.21.1 accepts ABI 13–14. Grammar dependency `tree-sitter-c@^0.23.1` dedupes to the existing exact 0.23.2. Clean install and `npm ls --all` resolved these three packages plus node-addon-api 8.9.2 and node-gyp-build 4.8.4, without overrides, force, peer bypass, aliases or a third runtime. |
| Node and supply chain | Node v24.18.1, npm 11.16.0, Linux x64 as UID1000. Fresh run-local package/cache, empty user/global npm configuration, explicit public registry, inherited npm configuration/token variables removed. Ordinary exact installation succeeded with zero vulnerabilities. `npm audit signatures` verified five registry signatures and one attestation. |
| Native and typed API | Actual ESM import, `new Parser()`, `setLanguage(CPP)`, parse and exhaustive `child(index)` / `fieldNameForChild(index)` traversal passed beside C in the same process. The declaration's `setLanguage` returns void and fields are nullable; a strict NodeNext typed consumer passed without casts or skipLibCheck, using the repository's Node types. The grammar includes typed `nodeTypeInfo`. |
| Corpus and coordinates | Five source probes traversed 390 named/anonymous/comment nodes, including qualified scalar types, initialized const/mutable locals, assignment, returns, calls, literals, typed operators, nested/fallthrough branches and main. CPP uses `condition_clause`, independently of C's shape. Astral comment plus CRLF put the next definition at UTF-16 index 10 / UTF-8 byte 12, row 1 column 0. Comments remain explicit extras. |
| Malformed input and limits | Missing brace and operand produce missing nodes; malformed parameters/string produce ERROR nodes; all four propagate hasError. CPP rejects the same source through the C grammar while CPP accepts it. The binding accepts 32767 UTF-16 units and throws at 32768; adapters must preflight this limit. |
| Lifecycle and packaged inputs | Only install lifecycle is `node-gyp-build`; no runtime network downloader. Dry-run registry pack reports 27 files, 3,208,986 compressed / 42,392,814 unpacked bytes, including MIT license, declarations, grammar source, native source fallback, Darwin/Linux/Windows x64/arm64 prebuilds and upstream WASM. Only Linux x64 native loading was executed. No archive, vendored grammar/binary or additional publication identity is added to this repository. |

Reproduce in an empty temporary package using Node24 and credential-free public npm configuration:

```sh
npm init -y
npm install --save-exact tree-sitter@0.21.1 tree-sitter-c@0.23.2 tree-sitter-cpp@0.23.4
npm ls --all
npm audit signatures
npm pack tree-sitter-cpp@0.23.4 --dry-run --json
node --input-type=module - <<'JS'
import Parser from 'tree-sitter'
import CPP from 'tree-sitter-cpp'
const parser = new Parser()
parser.setLanguage(CPP)
const source = '/* 😀 */\r\nstd::string copy(std::string a, std::string b) { return a; }\n'
const root = parser.parse(source).rootNode
function visit(node) {
  if (node.hasError || node.isError || node.isMissing) throw new Error(node.type)
  for (let i = 0; i < node.childCount; i++) {
    console.log(node.fieldNameForChild(i), node.child(i).type)
    visit(node.child(i))
  }
}
visit(root)
console.log(root.namedChildren[1].startIndex, root.namedChildren[1].startPosition)
JS
```

The complete initial corpus, source SHA-256 values, typed consumer, tree/ABI/package inventory and command logs are retained in the Task019 implementation run's `qualification/` and `evidence/` directories. The repository's private-boundary and CPP behavior specs retain executable regression coverage. Grammar qualification does not claim frontend/backend acceptance, packed-consumer success or CI completion.

The initial qualification corpus is now retained verbatim in the repository (these hashes were recorded before dependency edits):

| Corpus path | SHA-256 |
| --- | --- |
| `spec/fixtures/cpp-qualification/corpus-1.cpp` | `6e5763ff158809f0c750011765421c688978e755598cf1c738bd6e9863ccb6e5` |
| `spec/fixtures/cpp-qualification/corpus-2.cpp` | `0a57ddb7fa84e7f1522452f520898d8e3d99ced6857e85b00d4e6dd327c15835` |
| `spec/fixtures/cpp-qualification/corpus-3.cpp` | `b9be8da90243dbd9bdcebe3ee9569f2933ba24ddae38b342220183f6c72cf3e7` |
| `spec/fixtures/cpp-qualification/corpus-4.cpp` | `ec88c7a47a7167b0ad4d2d07744e8d71404551b91a9db927c8d476f6de23a110` |
| `spec/fixtures/cpp-qualification/corpus-5.cpp` | `a7524580af4881083d2fbf95f9a7b9f940320c2d2c35d3b188094598cca27f59` |

Reproduce exhaustive frozen-edge traversal, coordinate and recovery checks with `npx velocious-test spec/cpp-parser-qualification.spec.js`. The generated Tasks001–004 fixtures are independently accepted by `spec/cpp-cross-language-acceptance.spec.js`; the small grammar probes above qualify CST coverage, not semantic acceptance or native compilation of a complete supported program.

## Task 020 Rust grammar qualification — 2026-09-08

This record precedes all Rust dependency edits. Qualification ran in an isolated scratch package on the canonical Ubuntu 26.04 container as UID/GID 1000:1000, Node v24.18.1 and npm 11.16.0. No repository manifest, lockfile, installed dependency payload, parser boundary or public language registry was changed. That historical grammar gate completed before integration; the subsequent qualified compiler and product contracts are recorded in [Rust](rust.md).

| Evidence | Qualified result |
| --- | --- |
| Official registry release | `tree-sitter-rust@0.23.1`, `https://registry.npmjs.org/tree-sitter-rust/-/tree-sitter-rust-0.23.1.tgz`, integrity `sha512-wrMptzUAfbl3DbNrldZveyNM2CWmRw2VvEo2j/855qQbMMz4dlCF+TBwRN/1FL1S6cYvAEAJaCMesGqhocFJhQ==`. The scratch lock matches registry integrity and resolved identity exactly. |
| Official upstream | [tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust/tree/v0.23.1), lightweight tag `v0.23.1` and npm gitHead both `48eef06e8d806413d9a617f4a3f4d3168c4e5918`. `git ls-remote` returned the tag directly at that commit. Installed LICENSE, grammar, parser/scanner C sources, binding.gyp and Node JavaScript/declaration files matched those seven upstream files byte-for-byte. |
| License and signatures | MIT, with the license retained in the registry package. Fresh `npm audit signatures` verified six package signatures and one attestation across the installed graph. The Rust grammar advertises a registry signature, no npm attestation; its upstream identity and source bytes were therefore checked independently. |
| Ordinary isolated graph | Exact Tree-sitter 0.21.1, C 0.23.2, CPP 0.23.4 and Rust 0.23.1 coexist, with node-addon-api 8.9.2 and node-gyp-build 4.8.4. Rust's peer `^0.21.1` is satisfied without override, force, alias, peer bypass or third runtime. Fresh ordinary install and `npm ls --all` passed. Empty user/global configs, fresh cache, public registry and removal of inherited npm configuration/token variables produced default `install-links=false`. |
| ABI and actual Node API | Grammar ABI 14; the existing binding accepts ABI 13–14. Real ESM import, `setLanguage`, parse, every `child(index)` and `fieldNameForChild(index)` edge passed. Rust provides 273 node-type metadata entries. A strict NodeNext TypeScript consumer passed without casts or skipLibCheck. The binding declaration says absent fields are null, but native calls return undefined; the existing frozen schema already normalizes either absence to null. |
| Lifecycle and package audit | Native packages declare only `install: node-gyp-build`; the relevant load/install JavaScript has no downloader. npm 11.16.0 reported unapproved install-script notices; actual loading used shipped Linux x64 prebuilds successfully. Source fallback was inspected, not compiled. The dry-run package inventory contains 27 files, 1,295,963 compressed / 14,096,588 unpacked bytes, including MIT license, declarations, native source fallback, platform prebuilds and upstream WASM. No parser archive, binary or vendored source entered this repository. |
| Complete corpus | The seven checked-in probes below cover Tasks 001–004, all 18 typed operations' source shapes, exact typed free functions and main, initialized mutable/immutable locals, assignment, returns, braced nested/fallthrough/empty branches, direct and nested calls, `String::from`, clones, concatenation borrowing and exact print macro payloads. The support probe includes the candidate overflow methods, tuple/flag locals, exit calls and lint attributes strictly as proposed private support. Those shapes do not authorize arbitrary user tuples, attributes, macros or references. |
| Traversal and rejection visibility | The accepted probes, six malformed samples and 15 excluded-syntax samples traversed 2,638 nodes (1,450 named / 1,188 anonymous), six extras, three ERROR nodes and three missing nodes. Every ordered child, field, token, node text and index boundary was recorded, including every nested macro token tree. The excluded samples retain references/lifetimes/pointers, patterns, traits/impl/types, modules/use, unsafe/extern, async/closures, const/static, match/loops/ranges/casts/indexing, turbofish, Result/Option/question-mark, panic/assert/unwrap/expect and custom macros for later fail-closed frontend validation. |
| Coordinates and bounds | Every node boundary round-tripped through the existing UTF-8-byte-to-UTF-16 converter and independently matched native UTF-16 row/column coordinates. `/* 😀 */` plus CRLF places the next definition at UTF-16 10, UTF-8 12, native row 1 / column 0, semantic line 2 / column 1. Raw astral/BMP text, NUL/control/Unicode escapes and nested comments remain visible. Parsing succeeds at 32,767 UTF-16 units and throws `Invalid argument` at 32,768. |
| Isolation and compiler status | One Node process parsed legacy Rust/C/CPP alongside modern Tree-sitter 0.25.1 / Go successfully. This is an official grammar, so no community-grammar compiler exception applies. At the initial grammar gate rustc/Cargo were absent. Subsequent coordinator no-cache builds qualified Rust/Cargo 1.98.1 on Ubuntu 26.04 and actual TensorBuzz Ubuntu 24.04 (11 crates/93 commands each, network disabled). Public integration now uses that pair and the exact Cargo-generated manifest/lock bytes; focused source/target, compiler differential and local cold-package tests are recorded in [Rust](rust.md). |

| Corpus path | SHA-256 |
| --- | --- |
| `spec/fixtures/rust-qualification/base.rs` | `2388b7b1829e00300a7052141936800e5267cb61dba4ca910322434085618236` |
| `spec/fixtures/rust-qualification/scalars.rs` | `690c59fec3f1f89b1c9ead6698b4395f87a062b98ed5ba4bfa5cc43b212254bb` |
| `spec/fixtures/rust-qualification/locals.rs` | `9a7c52db338d0edaba8ecdc533c219b04dcbd05eb330c8e4c3c5ab822c788f2b` |
| `spec/fixtures/rust-qualification/operators.rs` | `f039dc4c11a9f443dacd4a97d877411c49aaf3d7ff88d44147da3ae03fa899f2` |
| `spec/fixtures/rust-qualification/statements.rs` | `415ef2ea7504108b518483e5c488ffc6c2f71b37bbc5da5e7058f5462f2a7743` |
| `spec/fixtures/rust-qualification/scaffolds.rs` | `c4b71afd1cb30ec44161cea0dacfa74933110951096a24ac02e7978077e07dd4` |
| `spec/fixtures/rust-qualification/coordinates.rs` | `57b2a3d893b987c9ca1751f56380039e20f6ca79880c364172dc4f56c5f66822` |

Reproduce the supply-chain gate in an empty scratch package with credential-free public npm configuration:

```sh
npm install --save-exact tree-sitter@0.21.1 tree-sitter-c@0.23.2 tree-sitter-cpp@0.23.4 tree-sitter-rust@0.23.1
npm config get install-links
npm ls --all
npm audit signatures
npm pack tree-sitter-rust@0.23.1 --dry-run --json
git ls-remote https://github.com/tree-sitter/tree-sitter-rust.git refs/tags/v0.23.1 'refs/tags/v0.23.1^{}'
```

The complete reproducible probe, typed consumer, fresh npm configuration, source comparisons, tree inventories and raw command results are retained under `/home/dev/.threadwire/semantifold/task020-20260908T091900Z-evidence/parser-probe` and its parent evidence directory. `probe.mjs`, `supply-chain.mjs` and `typed-api.mts` are qualification programs outside the shipped package. The first probe correctly failed its assumption that the native field API returned null; the corrected probe records the actual undefined result and the existing schema normalization. That investigation failure is not a production RED test. Focused public Rust specs subsequently recorded RED before runtime integration, source/backend behavior, ownership, tool discovery and generated-depth fixes. The original probe inventories remain unchanged; public integration preserves the same frozen schema and typed Node boundary.

## Task 022 Swift grammar qualification — 2026-09-09

The upstream community 0.7.1 grammar was retained, but its registry artifact did not provide the complete install-safe modern Node binding required by this repository. The parser route was therefore amended to the public Semantifold packaging fork at one immutable merge commit. This is a source archive identified by full SHA, not a mutable Git dependency, CI artifact, release-page archive, vendored parser, or runtime download.

| Evidence | Qualified result |
| --- | --- |
| Distribution and integrity | Manifest URL `https://github.com/kaspernj/tree-sitter-swift/archive/2a4515bb1d2d075c4c72a3466fbccb75f5269caf.tar.gz`; root lock integrity `sha512-MoaFzZrwF8mYIiKbTcU4lUpIOXLz9NAuKZKUcM4xOYOgGIbQuP+jdeX5428pz0l7p8ggfiDeoY+yAv2krt4MRg==`. The installed package retains name/version `tree-sitter-swift@0.7.1`. |
| Upstream and fork identity | Community upstream `alex-pinkus/tree-sitter-swift` 0.7.1 grammar; public packaging fork `kaspernj/tree-sitter-swift`, merge commit `2a4515bb1d2d075c4c72a3466fbccb75f5269caf`, human tag `v0.7.1-semantifold.1`. The full-SHA archive is the sole installation identity. |
| License and lifecycle | MIT license retained. The package uses only `node-gyp-build`; package scripts contain no URL, fetch, curl, or wget route. No parser archive, generated source, native module, or `node_modules` payload is checked into Semantifold. |
| ABI, payload, and typing | Grammar ABI 14 with peer `tree-sitter@^0.25.1`, satisfied by exact root 0.25.1. The package exposes `bindings/node/index.d.ts` and `nodeTypeInfo`; shipped inputs include `src/parser.c` (18,224,272 bytes), `src/scanner.c` (29,892 bytes), declaration (452 bytes), and loaded Linux x64 native binding (3,370,896 bytes). |
| Node24 loading and CST | On Node24, ESM import, `Parser#setLanguage`, and deterministic exhaustive `child(index)` traversal pass. The five fixtures cover functions, unlabeled parameters, scalar annotations/literals, initialized `let`/`var`, assignment, calls, print, returns, every typed operator, and nested/one-armed/fallthrough conditionals. |
| Recovery and coordinates | Malformed operands, braces, parameters, and strings expose propagated error, explicit error, or missing nodes. Conditional compilation and directive-bearing comments remain visible. Astral/CRLF probes distinguish UTF-8 bytes from binding indexes; every boundary is verified through the shared converter before one-based UTF-16 locations are emitted. Lone surrogates reject before parser adaptation. |
| Compiler differential | Exact Swift 6.3.3 release for target `x86_64-unknown-linux-gnu` typechecked the original and generated five-profile corpus and ran generated artifacts in debug and `-O` modes after the canonical-image rebuild. |

The accepted fixture hashes, in base/scalars/locals/operators/statements order, are `6b5548a722da3a94a7f26bf0590e6a7811c8b13b242dae328007471eac2fa075`, `5bc1fd210fb93ebf26abc7ed9d10c9d5c531d3d1c94e134b4215afa0ebc88a45`, `86bf2e710b19c1aeee55a65004e05af8cfde93fa4431408a606b30a22ed4d9f8`, `98a757c6c97a319e4a340beda099a826d3da6dda75917deb17a2dedc2224bb63`, and `abbf5a47fbebf3bee95fbdc06de23d22ca910cc3db5d423cd5fd556ceab2e936`. Run `npx velocious-test spec/swift-parser-qualification.spec.js` for the retained package/CST proof and `npx velocious-test spec/swift-native-execution.spec.js` for the compiler boundary.

## Task 023 Kotlin/JVM grammar qualification - 2026-09-09

The community grammar required an install-safe modern Node package boundary, so qualification selected the public Semantifold packaging fork at one immutable annotated tag. The dependency is a normal Git dependency over HTTPS, not a source archive, mutable branch, vendored parser, CI artifact, or runtime download.

| Evidence | Qualified result |
| --- | --- |
| Distribution and immutable identity | Manifest `git+https://github.com/kaspernj/tree-sitter-kotlin.git#v0.4.0-semantifold.1`; annotated tag object `d3ad223359b8258294a5b3981f7e730d1d674210`, peeled commit `57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0`. The lock records `git+https://github.com/kaspernj/tree-sitter-kotlin.git#57c35ad1a80ccd2a0ebd8fffe852f0d13a20acd0` and rejects any `git+ssh` entry. |
| License, package, and lifecycle | Installed `tree-sitter-kotlin@0.4.0` retains MIT. Its sole install action is `node-gyp-build`; package scripts contain no URL/curl/wget/fetch route. It ships `binding.gyp`, typed Node binding, `src/parser.c`, `src/scanner.c`, queries, and grammar metadata. No parser source, archive, native binary, or tool payload is checked into Semantifold. |
| ABI and Node24 API | Grammar ABI 14 and optional peer `tree-sitter@^0.25.1` match exact root binding 0.25.1. ESM import, `Parser#setLanguage`, the real native binding, typed `nodeTypeInfo`, deterministic parse, and exhaustive `child(index)` traversal pass on Node 24.18.1. |
| Coordinates and recovery | The binding reports UTF-16 code-unit indexes for JavaScript strings. Astral/CRLF probes distinguish them from UTF-8 bytes; the adapter verifies every boundary through the shared converter. Malformed operands and strings expose propagated error/missing nodes. Package headers and file annotations remain visible. Lone surrogates reject before adaptation. |
| Tasks001-004 CST corpus | Five fixtures cover top-level functions/main, parameters and explicit scalar types, `val`/`var`, assignment, calls/arguments/printing, returns, all scalar literals/operators, nested/one-armed/fallthrough conditionals, comments, and named/anonymous leaves. Every modeled shape and every excluded child is consumed or rejected; no source scan supplies missing structure. |
| Compiler differential | Exact development identity `info: kotlinc-jvm 2.4.20 (JRE 25.0.4+7-1-26.04-Ubuntu)` compiled original and regenerated fixtures with `-language-version 2.4 -api-version 2.4 -jvm-target 25 -Werror -include-runtime`, and OpenJDK 25.0.4+7 executed every JAR with exact output. TensorBuzz admits only the corresponding Noble `...-1-24.04-Ubuntu` build and exact `openjdk version "25.0.4" 2026-07-21` runtime. Valid Kotlin outside the profile is deliberately rejected by the adapter. |
| Packed consumer | The root tarball bundles the exact grammar because consumer lock generation removes resolution metadata from bundles. Exact `acceptDependencies` value `0.4.0` validates only that already bundled payload; new source resolution remains the immutable HTTPS Git edge. A fresh credential-free consumer passes install, full listing, clean `npm ci`, strict API typing, grammar loading, Kotlin round trip, and real JAR execution with no SSH lock entry. |

The accepted base/scalars/locals/operators/statements hashes are `b843c4672a3175fe75297f3692003cec0131eaee39e65ba1867f61e6184b0f05`, `42fd2c427a31d3d0b9427faf7781a7e7604399c370701203d06d2d54ceaea7f5`, `52b74e0e8dcca0f2baff9cddf1b035b0e31afa85edd5b7bf1e2dfb220967d615`, `90def0da9e20025e079d72b50722533d1f7223b1ba3cdbffa630b41c5fc9bc72`, and `bf4b05a00eafb1dbeaaabf7c2e7fea0cd8e034f4d3ff3b6e9fea177c31162aeb`. Run `npx velocious-test spec/kotlin-parser-qualification.spec.js`, `npx velocious-test spec/kotlin-native-execution.spec.js`, and the packed-consumer spec for the retained proof.
