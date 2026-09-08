# Browser WebAssembly target

The registered `wasm` ID is a target only. It has binary and browser-application backend roles, but no frontend, text backend, ordinary source-language status, or round trip. Use `generateArtifactSet({language: "wasm", module, role: "binary"})` or role `application`; both roles produce the same deterministic browser artifact set. `parse({language: "wasm", ...})` fails with `UNSUPPORTED_ROLE` for `frontend`, while an unknown ID still uses `UNSUPPORTED_LANGUAGE`. The filename is fixed to `program.wasm`; alternate filenames and explicit map directive/filename options fail instead of being ignored. WAT input, Wasm input, WASI, components, reference types, tables, shared memory, threads, SIMD, exceptions, memory growth, DOM imports, and general browser application generation are excluded.

## Artifact set

Generation returns these artifacts in order:

| Path | Media type | Role | Provenance |
| --- | --- | --- | --- |
| `program.wasm` | `application/wasm` | resource | `SemantifoldByteMapping` v1 |
| `program.wasm.map` | `application/json` | mapping | Source Map v3 projection |
| `semantifold-loader.mjs` | `text/javascript` | loader | rich JavaScript text mapping |
| `index.html` | `text/html` | entry | rich HTML text mapping |

The encoder writes the portable core binary format directly from the validated Tasks 001–004 semantic module. Production generation does not emit WAT, invoke a compiler, access the filesystem, or return a partial set. A bounded graph pass rejects cyclic or excessively nested caller IR before recursive shared validation. Node's standard WebAssembly validator checks the completed bytes before artifact construction; repository acceptance independently invokes WABT's real `wasm-validate` command.

The entry HTML is a strict-CSP acceptance harness with only same-origin module and Wasm loading. Serve all four files over HTTP, preserving `application/wasm` for `program.wasm`; opening the HTML from `file:` or serving the module as a generic binary type is unsupported. The loader exports `loadSemantifold(url, {sink, fetch, timeoutMs})`. `sink` receives exact LF-terminated scalar lines. `fetch` is an optional explicit fetch implementation for controlled hosts/tests, and `timeoutMs` is an integer from 1 through 2,147,483,647. There is no semantic JavaScript fallback.

## ABI

Artifact-set `metadata` carries the deeply frozen JSON contract `SemantifoldBrowserWasmABI` version 1 and ABI identity `semantifold.browser.v1`. The module imports only:

```text
semantifold.print_i64(i64) -> ()
semantifold.print_bool(i32) -> ()
semantifold.print_string(i32 pointer, i32 length) -> ()
```

It exports exactly one fixed-size `memory` and a zero-parameter `run() -> ()`. Semantic functions and helpers remain internal. Instantiation has no start section and no semantic side effects; one explicit non-reentrant loader `run()` call invokes the semantic entry point exactly once.

Semantic integers lower to signed `i64`. Safe integer literals remain the source contract; compile-time-known i64 overflow rejects generation in every function and branch, including unused functions and statically unreachable branches, while dynamic add, subtract, multiply, and negate overflow traps. Scratch analysis remains entry-reachable and path-sensitive. The loader receives integers as JavaScript `bigint` and renders exact base-10 text. Booleans lower only to canonical `i32` zero or one; any other imported print value is rejected rather than treated as truthy. Wasm name validation accepts the JavaScript/TypeScript `$` identifier character while retaining invalid, duplicate, and reserved-name rejection.

Strings are immutable UTF-8 byte sequences represented by `(i32 pointer, i32 length)` without terminators. Address zero is reserved. Deduplicated literal bytes occupy deterministic data segments, followed by a 16-byte-aligned private 1,048,576-byte scratch arena. Initial and maximum memory page counts are equal and `memory.grow` is absent. Every concatenation uses an overflow-checked private bump allocation and copies left bytes before right bytes. The loader checks pointer/length arithmetic and memory bounds, decodes with fatal UTF-8 while preserving a leading U+FEFF byte-order mark as data, and never exposes an allocator.

Generation performs path-sensitive worst-case scratch analysis from `run`, substitutes computed call-argument bounds, adds sequential demand, takes reachable conditional alternatives, and unrolls recursion through the published maximum of 64 active semantic calls. Unknown bounds, arithmetic overflow, more than 1,048,576 scratch bytes, or a possible 65th active call fail with a located `UNSUPPORTED_CAPABILITY`. Each run starts with a clean cursor/depth state. Successful repeated runs are deterministic; reentrant calls are rejected, and a trapped loader instance is poisoned permanently.

## Failures and security

The loader validates the module's import signatures, fixed memory, absent start section, exact export set, and zero-parameter `run` signature before returning an instance. Its `SemantifoldBrowserError.stage` distinguishes `fetch/MIME`, `compile`, `instantiate/import`, `memory bounds/UTF-8`, `invocation/trap`, and `timeout`. Malformed bytes are `compile`; a structurally valid module with an unsupported ABI value type is `instantiate/import`. Deadline-triggered aborts remain `timeout` during fetch, body reads, streaming instantiation, and compatibility instantiation, while unrelated abort-like failures retain their phase. The original error is retained as `cause` when safe.

Bad MIME never selects the non-streaming path. When `WebAssembly.instantiateStreaming` exists, the loader starts it immediately and reads a cloned response in parallel for ABI inspection instead of requiring the full body first. Host import behavior remains locked until that inspection succeeds, so a forbidden start section cannot reach the sink. The original response is read into an `arrayBuffer` and passed to `WebAssembly.instantiate` only in the compatibility path when streaming is unavailable.

The checked-in browser acceptance server binds only `127.0.0.1`, serves only generated paths with `nosniff`, no-store, strict CSP, and exact media types, and owns a bounded shutdown. The CSP permits same-origin modules and the narrow `'wasm-unsafe-eval'` source required by Chromium for WebAssembly compilation; it does not permit JavaScript `'unsafe-eval'`, inline scripts, or external connections. Chromium runs headlessly with a fresh explicit profile, `en-US`, `C.UTF-8`, UTC, a fixed virtual-time budget, external hostname resolution disabled, bounded output, and process-group timeout cleanup. The DOM exposes pass/fail and exact UTF-8 output-hex sentinels so Unicode and embedded NUL output remain unambiguous.

## Provenance

`program.wasm` has contiguous rich half-open byte ranges for its header, section IDs and lengths, types, imports, functions, memory, globals, exports, bodies, instructions, immediates, data, names, and custom sections. Semantic opcode/immediate, literal-data, identifier, callee, operator, and function-name bytes use the exact parser-owned `literal`, `name`, `callee`, or `operator` range when available. Name-length LEB128 prefixes, section framing, temporary locals, and encoder/ABI scaffolding have explicit synthetic origins. `program.wasm.map` follows the WebAssembly Source Map convention: every generated position is line zero and its column is the corresponding module byte offset. Synthetic regions remain unmapped. The binary contains a `sourceMappingURL` custom section whose payload is the relative URL `program.wasm.map`. See [source provenance and mappings](source-maps.md).

## Qualified tools

The canonical validator is WABT `wasm-validate` 1.0.36, overridable with `SEMANTIFOLD_WASM_VALIDATE`. The canonical browser command is `chromium`, backed by Google Chrome Stable 152.0.7977.82 and overridable with `SEMANTIFOLD_CHROMIUM`. The Ubuntu 26.04 development image pins WABT package `1.0.36+dfsg+~cs1.0.36-2ubuntu1`; Ubuntu 24.04 TensorBuzz uses the checksum-qualified Ubuntu revision `1.0.36+dfsg+~cs1.0.36-2ubuntu1`. Both install the exact Chrome `152.0.7977.82-1` amd64 package with SHA-256 `4d25e4a028c78a7ae910683551c2f234792cc5595e7e3e34939f599342ada446` and expose `/usr/local/bin/chromium`. The image probes remove only the package's observed single trailing ASCII space before exact version equality. Toolchain discovery likewise trims Chrome's non-empty stdout before the same anchored version policy and keeps package-launcher stderr separate rather than treating it as version text. Missing or mismatched tools fail acceptance; tests never download them.
