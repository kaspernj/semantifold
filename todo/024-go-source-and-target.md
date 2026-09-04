# 024 — Go source and target support

- Status: `todo`
- Phase/priority: Phase L1 / P0
- Dependencies: [015-language-expansion-foundation.md](015-language-expansion-foundation.md)

## Purpose

Add Go as a first-class frontend and native module backend for exactly Tasks 001–004. Use its official Tree-sitter grammar and installed Go toolchain while explicitly containing Go's mutable variables, machine/native toolchain, and garbage-collected string model.

## Semantic and source profile

- Map scalars to explicit `int64`, `bool`, and `string`. Require `var name type = value`; reject `:=`, untyped declarations, aliases/defined types, inferred result types, and architecture-sized `int`.
- Accept one `main` package, canonical two-parameter top-level functions, initialized locals, assignment only to mutable semantic bindings, current operators, strict-Boolean conditionals, explicit returns, and a canonical `fmt.Println` entry shell.
- Because Go has no immutable local keyword, accept frontend variables as mutable only when assignments occur; carry the semantic binding's mutability independently and emit a stable Semantifold metadata comment for immutable generated locals. Reject assignment to an immutable semantic binding even though Go syntax permits it.
- Treat strings as immutable Unicode/UTF-8 values with no portable object identity. Reject byte/rune indexing and conversion, slices/arrays/maps/structs/interfaces, methods, multiple returns, named results, variadics, closures, `defer`, `panic`/`recover`, goroutines/channels/select, pointers, `unsafe`, cgo, reflection, init functions, and user imports.

## Frontend strategy

- Qualify and pin the official `tree-sitter-go` npm grammar under Task 015. Verify Node 24/grammar ABI, integrity/license, typed tree access, error/recovery nodes, directive/comments, UTF-8-byte to UTF-16 conversion, and all supported forms.
- Exhaustively traverse source/package/import/function/type/block/expression/operator children. Only the canonical generated `fmt` import and entry shell are scaffolding; caller source imports or build directives are rejected. No `go/parser` subprocess or source scan substitutes for a rejected tree.
- Differential fixtures must agree with `gofmt` and `go tool compile`/`go build` acceptance; compiler tools validate syntax but never supply semantic nodes.

## Backend and artifact strategy

- Return a deterministic artifact set containing `go.mod` and `main.go`, with a pinned module identity and declared minimum Go version. Use the standard library only and no `go.sum` when no dependency requires it.
- Validate module/path safety, identifiers, imports, mutability, literal ranges, types, complete returns, and unsupported capabilities before returning either artifact.
- Run `gofmt` deterministically or emit its canonical form and verify it is unchanged. Preserve rich provenance and the Task 015 Source Map v3 form for `main.go`; mark package/import/entry/metadata scaffolding synthetic and associate `go.mod` fields with artifact configuration provenance.

## Diagnostics and rejections

- Use exact located `PARSE_ERROR`, `MISSING_TYPE`, and `UNSUPPORTED_SYNTAX` diagnostics for malformed trees, inferred declarations, build directives, concurrency, panic, unsupported imports, and other excluded forms.
- Backends return `UNSUPPORTED_CAPABILITY` before partial output and never simulate immutability, exceptions, concurrency, overflow, or ownership with hidden runtime behavior.

## Deterministic real-toolchain tests

- Record `go version` and `go env` fields needed for reproducibility. Run with `GOTOOLCHAIN=local`, `GOPROXY=off`, `CGO_ENABLED=0`, and isolated caches/workspaces; a missing or unsupported Go toolchain fails.
- Verify `gofmt`, `go vet` where applicable without network, `go build`, and execution with exact stdout/status. Compile/run overflow-sensitive fixtures under the documented target architecture.
- Cover Tasks 001–004, Unicode, mutable/immutable behavior, all operators/branches, parser recovery/directives, excluded forms, generated reparse, every Go direction, and representative original-five crossings.
- Generate twice and compare ordered artifacts and mappings byte-for-byte.

## Documentation

Document the Go profile, module/artifact layout, environment/toolchain pins, immutability metadata, GC/string boundary, exclusions, and provenance. Add a behavior changelog fragment when implemented.

## Completion criteria

- Go is registered as a frontend and native module backend for Tasks 001–004 with truthful capabilities.
- Generated modules reparse, format, build, and execute deterministically with the real installed offline toolchain.
- Parser qualification, rejection/location, mutability, cross-language, artifact/provenance, docs/changelog, and repository gates pass.

## Non-goals

Third-party modules, workspaces, package discovery, cgo, architecture-dependent integers, collections, structs/interfaces/methods, generics, pointers/unsafe, errors/panics, goroutines/channels, reflection, build tags, or cross-compilation.
