# 037 — Blocking TCP client stdlib vertical slice

- Status: `todo`
- Phase/priority: Phase S / P1 proof
- Dependencies: [032-condition-controlled-loops-and-break.md](032-condition-controlled-loops-and-break.md), [036-language-compatibility-stdlib-facades.md](036-language-compatibility-stdlib-facades.md)

## Objective

Prove the standard-library portability architecture end to end with versioned canonical blocking TCP client, text-stream, output, and resource capabilities; a Ruby `TCPSocket` language compatibility stdlib/facade; and a PHP target host provider/native binding using genuine `fsockopen`, `fgets`, and `fclose`.

This is one Ruby-source-to-PHP-target vertical slice. It does not promise all languages, arbitrary Ruby socket programs, or a general networking library.

## Current evidence and gap

`semantifold@0.2.0` rejects requires/imports, classes/methods, loops, optional EOF, typed errors, resources, and host APIs. Tasks 032–036 are planned to establish those meanings and the facade/canonical/provider link path. Until all direct and transitive dependencies are delivered, socket-shaped code must continue to fail; a backend shortcut or handwritten Ruby-on-PHP shim would not satisfy this task.

## Canonical v1 capabilities and precise semantics

- `SocketClient.v1_connect(host, port)` is effectful and blocking. `host` is a non-empty Unicode string encoded for the provider's basic host-resolution API; `port` is an integer from 1 through 65535. It returns one open owned byte-stream resource only after a successful connection.
- Basic host resolution is delegated to the documented host resolver. Resolver refusal, timeout, connection refusal, and other connection-stage failures normalize to a typed `ConnectionFailure` category with stable Semantifold data; no native PHP warning, error number, or message is portable, and no resource escapes on failure.
- v1 exposes no configurable connect/read timeout. The acceptance harness uses bounded process/server timeouts to prevent hangs. A source timeout option is unsupported rather than ignored.
- `TextStream.v1_read_line(resource, UTF-8)` blocks until LF, clean EOF, or failure. A line ending in LF is returned as a present string with that LF retained; a preceding CR is also retained. Clean EOF before any bytes returns absent. Bytes followed by clean EOF without LF return one present final string, and the next read returns absent. Invalid UTF-8 is `DecodeFailure`; a non-EOF native read failure is `ReadFailure`, never absent.
- `Output.v1_write(text)` writes the exact string once without adding or removing a newline. This lets retained input newlines remain observable independently of a language's `puts` convention.
- `Resource.v1_close(resource)` explicitly closes the owned socket. The first successful close transitions it to closed and returns normally. A native close failure is typed `CloseFailure`; after either attempted terminal close outcome the resource cannot be used as open. Repeated close and every read after close produce typed `ResourceClosed` before another native `fclose`/`fgets` call.
- Receiver, arguments, effects, reads, writes, and closes evaluate left to right exactly once. A clean EOF is presence information, not a failure; connection/read/decode/close failures are never converted to EOF or printed warnings.

## Ruby language compatibility stdlib/facade

- Resolve only the documented static `require "socket"` identity and genuine Ruby `TCPSocket` symbol. Compile a portable facade preserving the supported `TCPSocket.new(host, port)`, receiver `gets`, and `close` API shape.
- Store the canonical owned resource in private facade state. `new` calls `SocketClient.v1_connect`; `gets` calls the UTF-8 line reader and returns the supported Ruby optional string shape; `close` calls the resource capability and updates closed state.
- Compile the facade with the Ruby application through semantic IR. Generated PHP may retain `TCPSocket` inside a collision-safe compatibility namespace/import alias, but its methods call canonical provider operations rather than PHP APIs directly.
- Reject `TCPSocket.open`, block forms, subclassing/reopening/monkey-patching, constants or methods beyond the exact profile, dynamic require/send, custom resolver hooks, socket options, timeout arguments, native extensions, and user-defined/shadowed `TCPSocket`.

## PHP target host provider/native binding

- Implement connect with protected native `fsockopen`, line read with protected native `fgets` plus `feof`/error discrimination, and close with protected native `fclose`. Capture/normalize PHP warnings and failure returns at the provider boundary so generated application output and failures are deterministic.
- Wrap the native stream in a provider-owned resource that exposes no PHP handle to portable code and tracks open/closed state. Validate UTF-8 incrementally across native read chunks/lines as required by the canonical contract.
- The protected provider symbols and genuine PHP functions are unreachable by application/facade resolution. Link only the used SocketClient, text-stream, output, resource, and dependency modules.
- Validate PHP/runtime support, provider versions, namespace/path collisions, all facade/canonical calls, and the complete artifact graph before any file is returned.

## Diagnostics and rejections

- Source diagnostics distinguish unresolved/shadowed/modified `socket` or `TCPSocket`, unsupported member/argument/block/option, dynamic behavior, and facade profile mismatch at exact locations.
- Contract/provider diagnostics distinguish invalid host/port, `ConnectionFailure`, `ReadFailure`, `DecodeFailure`, `CloseFailure`, `ResourceClosed`, missing/incompatible provider capability, and protected-binding or linking failure.
- Target-native warning text, platform errno values, DNS ordering, and native exception classes are diagnostic context only, never portable program semantics.
- All parse, capability, provider, and link failures are transactional; no partial PHP artifact set or usable native resource escapes.

## Deterministic real-toolchain acceptance

- Start a real local TCP server on an OS-assigned ephemeral loopback port under test control. Do not contact external networks. Use bounded startup, accept, read, process, and teardown timeouts and deterministic UTF-8 byte sequences.
- Run generated PHP with the real configured `php` CLI. The server sends an LF-terminated line, a CRLF-terminated line, and a final unterminated Unicode line before clean close. Assert exact output bytes prove LF/CRLF retention, final-line presence, then EOF absence.
- Exercise a condition-controlled Ruby `gets` loop through the compiled facade without special read-loop recognition. Assert explicit close occurs once after EOF and the server/process terminate cleanly.
- Use a deterministically closed/rejected ephemeral endpoint or controlled local server action to assert typed connection failure, no leaked resource, and no partial output. Separately force/read-test invalid UTF-8 and provider-observable non-EOF failure where the harness can do so deterministically.
- Assert successful first close, typed repeated close, typed read-after-close, and no second native close/read call. Add a controlled provider seam for deterministic native close-failure normalization while retaining at least one real `fclose` success path.
- Negative acceptance covers dynamic/unresolved/shadowed/monkey-patched Ruby forms, unsupported APIs/options, missing/version-incompatible PHP provider, namespace collision, protected native access, unused-module exclusion, and late transactional failure.
- Generate twice and compare all artifacts/mappings byte-for-byte; reparse generated PHP where its compiler-owned profile is supported. Missing `ruby`, `php`, or any declared real tool fails rather than skips. Source snapshots cannot replace execution.

## Documentation and changelog

When implemented, update the README, architecture, language support, stdlib design, canonical v1 contract reference, Ruby facade profile, PHP provider/runtime requirements, diagnostics, and artifact layout. Add one behavior changelog fragment.

## Non-goals

TCP servers/listeners, TLS, UDP, Unix sockets, nonblocking I/O, async/event loops, configurable timeouts, cancellation, concurrency, DNS policy beyond basic host resolution, proxying, arbitrary socket options, binary framing, writes beyond exact output capability needs, seek, arbitrary encodings, every Ruby `Socket`/`IO` API, other source facades, other target providers, or direct idiomatic lowering.

## Completion criteria

- Proved Ruby `TCPSocket` source compiles with its executable facade to PHP and links canonical v1 capabilities to the native PHP provider with no pair-specific bridge.
- Real ephemeral-server execution proves exact newline, final-line, EOF, connection-failure, output, and close semantics through `fsockopen`/`fgets`/`fclose`.
- Unsupported source behavior, unavailable/incompatible capabilities, provider failures, and collisions fail loudly before partial artifacts or resources escape.
- Only reachable modules are emitted; protected same-language/native boundaries, deterministic artifacts, provenance, focused docs/specs, real tools, and a behavior changelog fragment satisfy repository gates.
