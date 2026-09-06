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
| 017 | C# | official [`tree-sitter/tree-sitter-c-sharp`](https://github.com/tree-sitter/tree-sitter-c-sharp) grammar package | passed for exact `tree-sitter-c-sharp@0.23.5`; see the checked-in record below |
| 018 | C | official [`tree-sitter/tree-sitter-c`](https://github.com/tree-sitter/tree-sitter-c) grammar package | legacy pair qualified behind the adapter boundary below; source/target work remains blocked until the adapter is separately published and verified |
| 019 | C++ | official [`tree-sitter/tree-sitter-cpp`](https://github.com/tree-sitter/tree-sitter-cpp) grammar package | blocked until the exact release record above passes |
| 020 | Rust | official [`tree-sitter/tree-sitter-rust`](https://github.com/tree-sitter/tree-sitter-rust) grammar package | blocked until the exact release record above passes |
| 022 | Swift | community [`alex-pinkus/tree-sitter-swift`](https://github.com/alex-pinkus/tree-sitter-swift) candidate plus differential `swiftc` checks | candidate only; blocked until exact release and differential record pass |
| 023 | Kotlin/JVM | community [`fwcd/tree-sitter-kotlin`](https://github.com/fwcd/tree-sitter-kotlin) candidate plus differential `kotlinc` checks | candidate only; blocked until exact release and differential record pass |
| 024 | Go | official [`tree-sitter/tree-sitter-go`](https://github.com/tree-sitter/tree-sitter-go) grammar package | passed for exact `tree-sitter-go@0.25.0`; see the checked-in record below |
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

The C grammar's compatible published runtime line cannot share Semantifold's root Tree-sitter instance. The root remains on exact `tree-sitter@0.25.1` with its Python, C#, and Go grammars. The independently releasable `@kaspernj/semantifold-tree-sitter-legacy@0.1.0` workspace instead owns exact `tree-sitter@0.21.1` and `tree-sitter-c@0.23.2`, whose peer range and grammar ABI agree. A separately tested `tree-sitter@0.22.4` plus `tree-sitter-c@0.24.1` install was rejected because `Parser#setLanguage` failed with an undefined `nodeTypeNamesById`; an installable graph alone is not qualification.

| Evidence | Qualified boundary result |
| --- | --- |
| npm distribution | `tree-sitter@0.21.1`, integrity `sha512-7dxoA6kYvtgWw80265MyqJlkRl4yawIjO7S5MigytjELkX43fV2WsAXzsNfO7sBpPPCF5Gp0+XzHk0DwLCq3xQ==`; `tree-sitter-c@0.23.2`, integrity `sha512-9kADOx31AF94DHcrsMGW0zM/2LS6v7wFkPHPVm7RQU+vYVVZMKZ2FJ9e99pm5feqsAcjUzB9CarqDLgRT1Fe/w==`. The workspace and root development relationship are exact `0.1.0`; no alias, override, forced peer, archive dependency, or copied binding is used. |
| upstream identity | Official [`tree-sitter/node-tree-sitter`](https://github.com/tree-sitter/node-tree-sitter) tag/commit `v0.21.1` / `bbdba663dc0b8487f1212524a83a7c39e8a5c3ca`; official [`tree-sitter/tree-sitter-c`](https://github.com/tree-sitter/tree-sitter-c) tag/commit and npm `gitHead` `v0.23.2` / `6a4ae2e08916fd08e5739250bb64a14392b01c99`. |
| legal and registry provenance | Both upstream packages declare MIT and publish registry signatures. Their exact registry URLs and integrities are recorded in `package-lock.json`; the repository gate verifies installed-package signatures and audits the ordinary dependency graph. The adapter itself uses ISC and is not yet published. |
| ABI and API | `tree-sitter-c@0.23.2` declares language ABI 14; `tree-sitter@0.21.1` accepts ABI 13–14 and the grammar's peer is `^0.21.1`. The legacy binding provides `child(index)` and `fieldNameForChild(index)` but not the newer `fieldNameForNamedChild` convenience API. The adapter therefore traverses every ordered named and anonymous child and copies field names without exposing binding types. |
| runtime isolation | A real packed adapter installed with `tree-sitter@0.25.1` and `tree-sitter-go@0.25.0` resolves the legacy runtime and C grammar below the adapter at distinct paths. One Node `v24.18.1` process parses modern Go and legacy C without a native-module collision. Ordinary npm install and peer resolution are mandatory. |
| public boundary | `parseCst(source)` returns only a recursively frozen `semantifold.parser-cst` version 1 envelope. Nodes contain plain scalar state, UTF-16 indices/row-column positions, and ordered frozen `{field, node}` edges. Parser, tree, syntax-node, language, method, function, parent, circular, and source-text values do not cross the export. The caller retains source ownership and can slice it by the normalized offsets. |
| recovery and coordinates | Astral text before a later definition plus CRLF separates UTF-8 bytes from UTF-16 code units; the snapshot retains exact UTF-16 indices and row/column positions. Comments remain visible as extra nodes. A missing closing brace propagates `hasError` and preserves the missing node rather than recovering through source text. |
| lifecycle and package inputs | Both dependencies use only `install: node-gyp-build` and ship native prebuild/source fallback without a runtime downloader. The adapter tarball contains exactly `package.json`, `README.md`, `LICENSE`, `build/c.js`, `build/c.d.ts`, and `build/c.d.ts.map`; no dependency, native handle, archive, `node_modules`, or source-tree fallback is bundled. |
| task boundary | This record qualifies only the runtime/package boundary. It does not implement or claim the Task 018 C frontend, semantic normalization, backend, registry, toolchain, compiler comparison, or Tasks 001–004 C corpus. `todo/018-c-source-and-target.md` remains `todo`. A later C consumer change is blocked until a separately authorized adapter release is installed and verified from the public registry. |

Reproduce the repository-owned proof on Node 24 with:

```sh
npm ci
npx velocious-test spec/tree-sitter-legacy-adapter.spec.js
npx velocious-test spec/tree-sitter-legacy-packed-consumer.spec.js
npm ls --all
npm pack --workspace=@kaspernj/semantifold-tree-sitter-legacy --dry-run --json
```

The packed-consumer spec creates the tarball and consumer only under unique temporary directories, strips npm token/auth environment entries, installs exact modern Go dependencies beside the tarball, checks the complete npm tree and resolved runtime paths, executes both parsers in one process, and removes the directory in `finally`. Publication is intentionally excluded from this qualification.

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
