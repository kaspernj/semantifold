# Standard-library portability

Status: Task 034's single-module effect/lifetime foundation is delivered through PR #44, Task 035's versioned canonical contract/provider-linking hub is delivered through PR #45 and merge `a2aad9d4932bfc6087adc4ff8bca43678c92413c`, and Task 036's bounded executable facade qualification layer is delivered through PR #46 and merge `9aba48f9d48bcef4fd4c9275aec14bfcc4f0904c`. Task 037 implements the first concrete Ruby-to-PHP blocking TCP slice on its topic branch. None is released in `semantifold@0.3.0`.

## Purpose and boundary

Semantifold will make a deliberately bounded set of familiar source-language standard-library APIs portable without building a library translator for every source/target pair. The architecture is hub-and-spoke: source-language API shape is normalized into versioned canonical capabilities, and target-language native behavior is reached only through providers for those capabilities.

This is an incremental compatibility profile, not a promise to translate arbitrary applications or complete standard libraries. The published `semantifold@0.3.0` release does not resolve standard-library identities or provide compatibility facades, canonical capability calls, host providers, or provider linking. The current source tree has since added bounded project imports, optionals, typed errors, Task 032 condition-controlled loops, and Task 033 single-module bounded reference classes/methods. Task 034, delivered through PR #44, adds explicit unversioned compiler authority, host effects, owned resources, deterministic close, and typed host-failure normalization. Task 035, delivered through PR #45, adds the versioned canonical contract/provider registries, capability negotiation, protected provider linking with tree-shaken artifacts, and transactional link validation. Task 036, delivered through PR #46, adds the neutral qualification facades documented below. Task 037 uses those foundations only for the bounded concrete Ruby-source-to-PHP-target profile documented here.

Task 034 proves the fixed `semantifold.task034.resource-probe` conformance capability on PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java. Its hard-coded compiler-owned native bindings exercise real local file handles so acquisition, clean EOF, read failure, close failure, terminal reuse, and exactly-once order can be tested. In single-module mode the probe is not a portable file API, a provider object, a provider registry, or a canonical standard-library version. Ordinary same-named source declarations do not gain authority. Task 035 now exposes that capability as the versioned canonical contract `semantifold.task034.resource-probe@1.0.0`: program-mode generation negotiates the adopted target's provider, materializes a tree-shaken provider artifact under a protected native binding, and links canonical calls through the generated artifact set.

Task 006's exact collection construction, read, and size spellings are closed surface forms for core immutable-collection IR, not standard-library integrations. Their target emitters select equivalent representation syntax from validated semantic nodes; they do not retain source-library call identities, translate API names, or bypass the facade/canonical-contract/provider path. Standard-library portability remains owned by Tasks 035–037.

## Terminology

These three names are normative:

- A **language compatibility stdlib/facade** is a source-facing, portable implementation of a proved native-library API shape. It is authored in a Semantifold-supported subset and may use only canonical Semantifold capabilities. It contains executable behavior plus public declarations/contracts; it is not a name-only rewrite table.
- A **canonical Semantifold stdlib contract/capability** is a versioned, language-neutral operation and behavior contract. It precisely specifies types, evaluation order, effects, typed failures, EOF and presence, encoding, newline retention, blocking and timeout behavior, resource ownership/lifetime, close behavior, and target dependencies.
- A **target host provider/native binding** implements one or more canonical capabilities using the target language's genuine native standard library. Its protected host-native binding is unavailable to ordinary portable application and facade code.

An integration for a language therefore has two independent sides: its compatibility facade lets that language be a source, and its target host provider lets that language be a target. Both meet only at canonical contracts. There are no Ruby-on-PHP, PHP-on-Ruby, or other pair-specific adapters.

## Compile and link flow

```text
source application ─┐
                    ├─ frontend → semantic IR → target backend ─┐
source compatibility│                                          ├─ linked artifact set
stdlib/facade ───────┘      canonical capability calls ─────────┘
                                                                  │
                          target host provider/native binding ─────┤
                                                                  ▼
                                                    target native stdlib
```

The compiler resolves a proved source stdlib reference, selects the corresponding language compatibility stdlib/facade, and compiles both application and used facade modules through ordinary frontend-to-semantic-to-backend processing. Canonical calls remain explicit link requirements. Artifact assembly selects a compatible target host provider/native binding, validates the complete capability set, and returns the application, facade, provider, and support artifacts transactionally.

Generated target code uses target syntax. It may retain the source API's class or function names in a collision-safe compatibility namespace or behind an import alias, so source-shaped calls remain readable without claiming those names belong to the target's native stdlib. Namespace allocation and provider symbols must not collide with application names, other facades, or target scaffolding.

Only transitively used compatibility and provider modules enter the artifact set. Tree-shaking happens at declared module/capability boundaries after resolution; it must not remove observable initialization, effects, failure paths, or close behavior.

## Task 036 bounded qualification facades

Task 036 proves this flow without taking Task 037's TCP scope. Each original-five source profile registers a public `semantifold.task036.<language>.probe@1.0.0` facade, one internal `probe-runner` dependency, and an unreferenced `unused` facade used only to prove elimination. The public declaration is exactly one direct function from `string` to `string`, with host effect and no escaping failure; PHP and Ruby spell it `compatibility_probe`, while JavaScript/JSDoc, TypeScript, and Java spell it `compatibilityProbe`.

The exact parser-proved native module identities are `Semantifold\Task036\Probe` for PHP, `semantifold/task036/probe` with the `SemantifoldTask036Probe` module for Ruby, `semantifold:task036/probe` for JavaScript/JSDoc and TypeScript, and `semantifold.task036.Probe` for Java. Registry records include the source/runtime profile, version, public declaration, native symbols, compiler-owned source path/module, facade dependencies, and canonical requirements. The public wrapper delegates to the internal runner; only that runner receives compiler-owned authority for `probeEffect` and `probeTrace` from `semantifold.task034.resource-probe` range `1`. Application code and the public wrapper cannot forge or inherit that authority.

`parseProgram` stores `SemantifoldStdlibFacadeResolution` v1 evidence on the resolved import and a dependency-first `SemantifoldStdlibFacades` v1 descriptor on the program. The selected facade source is parsed and semantically validated through its own language frontend, then every selected module follows the ordinary target backend. Generated paths use the reserved `semantifold/facade/<source-language>/...` compatibility namespace; the internal runner's logical alias is `probe_runner`, which remains a valid collision-checked identifier on Java targets. Facade artifacts have the `support` role and mapped source provenance, while providers retain synthetic protected provenance. The artifact-set `SemantifoldStdlibLink` metadata includes the complete facade descriptor, canonical modules, providers, native entries, and provider carrier.

Resolution rejects unproved modules, unsupported members/forms, local shadowing, reopened modules, assignment/monkey-patching, dynamic imports/requires, reflection, native extensions, caller-owned facade ID/path collisions, and forged capability or facade descriptors with stable located diagnostics. Parser failure is terminal and is never recovered by scanning source text. Before provider planning or writer allocation, generation recompiles the registered facade source through the ordinary parser and semantic pipeline and structurally compares the complete compiler-owned semantic modules; retaining valid source bytes, locations, markers, or requirement names cannot conceal mutated facade IR. Generation also validates the descriptor, identity evidence, canonical/provider versions, target names, and complete artifact paths transactionally. Same-language lanes keep compatibility aliases outside the Task 035 protected provider route, including Java's owner-module provider carrier, so the genuine provider operation executes once without facade recursion.

This corpus remains a neutral architecture fixture by itself: it adds no file, console, socket, `TCPSocket`, `fsockopen`, or other concrete public host behavior. Task 037 separately supplies the first TCP vertical slice.

## Ruby-to-PHP example

Supported Ruby source requires exact literal `require "socket"`, creates `TCPSocket.new(host, port)`, reads lines with zero-argument receiver `gets`, calls `puts line` or `Kernel.puts(line)`, and explicitly calls zero-argument receiver `close`. Within that proved profile, Ruby stdlib resolution proves that `TCPSocket` and exactly one-string `puts` refer to the supported native symbols and selects their executable compiler-owned compatibility facades. The same `puts` spellings outside this profile retain legacy program-mode behavior.

The portable facades can be expressed schematically as:

```ruby
# Public compatibility declaration: Ruby-compatible supported profile.
class TCPSocket
  def initialize(host, port)
    @client = Semantifold::SocketClient.v1_connect(host, port)
  end

  def gets
    Semantifold::TextStream.v1_read_line(@client)
  end

  def close
    Semantifold::Resource.v1_close(@client)
  end
end

module Kernel
  def self.puts(value)
    Semantifold::Output.v1_write_line(value)
  end
end
```

The sketch shows the source-visible shape. The compiler-owned facades use explicit types, optional/presence results, exact canonical failure declarations, and the selected contract ownership rules. `TCPSocket#gets` preserves newline retention and an absent value at EOF by composing canonical capabilities rather than by recognizing a source read loop. The bounded `puts` facade accepts exactly one string and calls `Output.v1_write_line(text)`, which outputs the string once and appends LF only when the string does not already end in LF. Multiple arguments, arrays or recursive output, implicit string conversion, custom output separators, and every other Ruby `puts` behavior are outside this profile.

The PHP target host provider/native binding can be expressed schematically as:

```php
// Protected provider code; not callable as a portable application API.
function socket_client_v1_connect(string $host, int $port): SocketResource {
    $handle = fsockopen($host, $port, $errorCode, $errorMessage);
    return checked_socket_resource($handle, $errorCode, $errorMessage);
}

function text_stream_v1_read_line(SocketResource $socket): ?string {
    return checked_fgets($socket->nativeHandle);
}

function resource_v1_close(SocketResource $socket): void {
    checked_fclose_once($socket->nativeHandle);
}

function output_v1_write_line(string $text): void {
    $output = str_ends_with($text, "\n") ? $text : $text . "\n";
    checked_fwrite_all(STDOUT, $output);
}
```

The application and Ruby facades compile to PHP. Generated PHP may define a source-compatible `TCPSocket` class and `puts` compatibility function in a generated compatibility namespace and alias them at their call sites. The class methods call the linked canonical `SocketClient`, text-stream, and resource provider operations; the `puts` facade calls the canonical output operation. The PHP target host provider/native binding writes the canonical line output to native `STDOUT` without duplicating an existing LF, while `fsockopen`, `fgets`, and `fclose` remain the genuine native socket operations.

The path is therefore:

```text
Ruby application + Ruby TCPSocket/puts facades
  → semantic IR
  → generated PHP compatibility class/function
  → canonical SocketClient/TextStream/Output/Resource calls
  → PHP provider
  → native stdout + fsockopen/fgets/fclose
```

There is no handwritten Ruby-on-PHP library, pair-specific bridge, embedded Ruby runtime, or whole-program intelligent refactor. Syntax becomes PHP syntax while the supported Ruby library shape and behavior remain in the compiled facade.

## Resolution and symbol identity

Compatibility substitution is permitted only when the frontend and semantic module resolver can prove both the referenced native library and symbol identity from parser-backed constructs and the configured supported profile. A recognized `require`, `import`, package path, qualified name, or declaration binding must resolve to the exact catalogued stdlib symbol and version range.

The following never qualify by spelling alone:

- a user-defined class, function, constant, module, or package with the same name;
- a monkey-patched or reopened native type;
- reflective or dynamic lookup, computed imports/requires, `eval`, dynamic dispatch, or unresolved aliases;
- behavior supplied by a native extension, package-manager dependency, preload hook, or runtime mutation; or
- a parser-rejected or ambiguous construct.

Such programs are rejected with a located diagnostic or remain explicitly outside the supported profile. A frontend must never scan source text as a fallback after its parser adapter or resolver rejects a construct.

Facade selection records the proved source symbol identity, facade module/version, and canonical capability requirements in semantic project metadata. That evidence, not a raw source name, authorizes linking. When a program selects more than one facade profile, each compiler-owned module receives authority under its requirement's owning canonical capability name; combining the Task 036 resource probe with the Task 037 socket/output facades neither renames nor propagates either profile's authority to public facade or application modules.

## Protected native boundary and recursion isolation

Ordinary portable application and facade code can call canonical capabilities but cannot access raw target-native bindings. Provider modules are compiler-owned artifacts with a protected role and symbols that the normal source resolver will not expose. Backend/provider validation is the only route from a canonical call to a native API.

This separation is essential for same-language generation. When Ruby source using the portable `TCPSocket` facade targets Ruby, the Ruby provider's native binding must reach the genuine host `TCPSocket`, not resolve the compatibility name and enter the facade again. Providers use reserved internal symbols or an equivalent compiler-controlled binding captured outside the compatibility namespace. Facade names, native provider names, and application aliases remain distinct even if their user-visible spellings coincide.

## Canonical contract semantics

Every canonical capability version is a closed public contract. At minimum it declares:

- exact input, output, reference/resource, optional/presence, and typed-failure types;
- left-to-right evaluation order and which operations are effectful;
- whether an operation blocks, its timeout units and defaults, and the behavior of unsupported timeout modes;
- text encoding and decoding, invalid-sequence policy, newline recognition and retention, and whether EOF is an absent value or a failure;
- ownership transfer or borrowing, allowed aliases, resource lifetime, deterministic explicit close, repeated-close behavior, and use-after-close rejection;
- failure categories and the point at which native errors are normalized, without depending on target-specific messages or codes; and
- provider dependencies, supported target/runtime versions, and any capability dependencies.

Task 037's exact v1 contract set is normative:

| Canonical module | Operation | Parameters | Result/resource flow | Dependencies | Declared failures |
| --- | --- | --- | --- | --- | --- |
| `semantifold.socket-client@1.0.0` | `v1_connect` | `host: string`, `port: integer` | acquired owned `semantifold.resource.ByteStream` | `semantifold.resource@1` | `InvalidHost`, `InvalidPort`, `ConnectionFailure` |
| `semantifold.text-stream@1.0.0` | `v1_read_line` | borrowed `semantifold.resource.ByteStream` | `optional:string`; borrow remains with owner | `semantifold.resource@1` | `ReadFailure`, `DecodeFailure`, `semantifold.resource.ResourceClosed` |
| `semantifold.output@1.0.0` | `v1_write_line` | `text: string` | `void`; no resource flow | none | `WriteFailure` |
| `semantifold.resource@1.0.0` | `v1_close` | owned `ByteStream` | `void`; terminal consume | none | `CloseFailure`, `ResourceClosed` |

All four operations are synchronous, host-effectful, and evaluate receiver, arguments, and effects left to right exactly once. `v1_connect` accepts a non-empty Unicode host without stream-wrapper scheme syntax and an integer port from 1 through 65535; the provider rejects wrapper-style hosts before native connection so the contract can select only TCP transport. It exposes no resource unless native connection succeeds and offers no timeout parameter. `v1_read_line` incrementally validates UTF-8, retains LF and a preceding CR, returns a final unterminated line once, uses absence only for clean EOF before bytes, and distinguishes non-EOF read failure. `v1_write_line` writes all canonical UTF-8 bytes and appends one LF only when the input does not already end in LF. Either success or failure of the first `v1_close` attempt is terminal; later reads or closes fail as `ResourceClosed` before another native operation.

The only Task 037 provider profile is PHP 8.2 or newer with core streams, recorded as `php82-core-streams-v1`. Its separately tree-shaken protected artifacts are `providers/php/semantifold/socket-client.php`, `providers/php/semantifold/text-stream.php`, `providers/php/semantifold/output.php`, and `providers/php/semantifold/resource.php`. The PHP provider owns the native handle and captures warnings only within each native call before normalizing them to the typed categories above; native messages and errno values are not portable. The only compatibility artifacts are `semantifold/facade/ruby/socket.php` and `semantifold/facade/ruby/output.php`.

Contracts do not inherit accidental behavior from the first facade or provider. A provider advertises exact versions and constraints. Capability negotiation succeeds only when one provider set satisfies every used canonical requirement without incompatible versions or semantics.

Capabilities evolve incrementally. A new operation or incompatible semantic rule receives an explicit version boundary; availability of `SocketClient` v1, for example, does not imply TCP server, TLS, UDP, async I/O, or arbitrary socket options.

## Facades, providers, and artifacts

Language compatibility stdlib/facades are normal executable portable definitions under stricter authority rules. Their public declarations define the source-visible supported signatures, and their bodies may use semantic language features and canonical calls only. They cannot invoke target syntax, a protected native binding, reflection, or unversioned host behavior.

Target host providers/native bindings are target-owned modules selected from a validated registry. They may use genuine target stdlib APIs and the minimum generated support needed to implement the canonical contract. They cannot weaken types, EOF distinctions, failure categories, ownership, or blocking behavior merely because the host API differs.

Resolution produces a dependency graph from application symbols through facade modules and canonical capabilities to provider modules. Before returning anything, the linker validates graph closure, versions, target availability, namespaces, artifact paths, and every backend capability. It then returns one deterministic artifact set containing only reachable modules, declarations, mappings, and required support. Every generated range retains source/semantic provenance or an explicit synthetic/provider reason.

## Failure and diagnostic policy

Portability is transactional and fail-loud. No source or artifact subset is exposed when validation fails. Diagnostics distinguish at least:

- unresolved or unproved stdlib module/symbol identity;
- a recognized stdlib symbol outside the facade's supported API profile;
- dynamic, monkey-patched, reflective, native-extension, or otherwise non-portable source behavior;
- a missing or version-incompatible canonical capability;
- a target provider that cannot meet required encoding, EOF, timeout, failure, ownership, or close semantics;
- same-language native-binding isolation or generated-name collisions; and
- invalid provider dependency, linking, or artifact graphs.

Source/resolution failures point to the import/require, symbol, call, or unsupported construct. Contract failures identify the capability and required version; target failures identify the target/provider constraint. A semantic mismatch is never hidden with a best-effort rewrite, partial artifact set, runtime warning, or source-text fallback.

## Optimization boundary

The executable facade plus canonical capability plus provider path is the correctness baseline. A backend may later lower a known facade operation directly to idiomatic target code only when the optimizer proves the replacement preserves the selected contract version, evaluation order, effects, failures, EOF/presence, encoding, blocking/timeouts, and resource lifetime. The unoptimized path must remain valid and covered. Direct lowering cannot authorize a pair-specific behavior change or broaden accepted source identity.

## Supported-subset promise

Each facade publishes the exact source APIs and forms it supports. Each canonical module publishes exact capability versions. Each provider publishes its target/runtime constraints. Unsupported operations remain unsupported even when a target happens to expose a similarly named native function.

Task 036's delivered qualification proof remains intentionally neutral and original-five-only. Task 037 adds only the concrete blocking TCP client proof with Ruby `TCPSocket` and bounded one-string `puts` compatibility facades targeting the PHP native provider. Neither implies coverage for complete standard libraries, every language, every networking API, or general Ruby output behavior. The dependency sequence is maintained in the [implementation plan](plans/2026-09-05-standard-library-portability.md) and [roadmap](../todo/README.md).

## Acceptance strategy

Every implementation slice requires deterministic parser, semantic, link, generation, and real-toolchain acceptance. Task 037's vertical slice does all of the following:

1. start a real local ephemeral TCP server under test control, with no external network dependency;
2. parse supported Ruby source and prove its `socket`/`TCPSocket` and `puts`/`Kernel.puts` identities;
3. compile the application and used Ruby compatibility facades to PHP;
4. link only the required PHP provider/native-binding modules;
5. run the generated artifacts with real `php` and assert exact output, retained input newlines, exactly one appended LF for a final unterminated string, no duplicate LF, distinct EOF absence, normalized connection failure, deterministic close, repeated-close policy, and use-after-close rejection; and
6. cover unresolved, shadowed, monkey-patched, unsupported, provider-missing, collision, and transactional-failure cases.

The acceptance uses separate fresh loopback server instances for the source Ruby reference and generated PHP, explicit event/deadline coordination, and cleanup of tracked sockets, listeners, and child processes. Protected generator-only PHP seams deterministically exercise split multibyte reads, false/non-EOF reads, close warning/failure, and short/zero/false stdout writes with real PHP; a real refused connection and genuine successful `fclose` remain required. Generated portable PHP is reparsed where supported, protected provider PHP is checked with real `php -l` and execution, repeated generation is byte-for-byte deterministic across every artifact/mapping/provenance/metadata field, and snapshots or source-only assertions never replace execution.

TCP servers/listeners, TLS, UDP, Unix sockets, nonblocking I/O, async/event loops, configurable timeouts, cancellation, concurrency, custom DNS policy, proxies, arbitrary socket options, binary framing, output beyond one-string `puts`, arbitrary encodings, other Ruby `Socket`/`IO` APIs, other source facades, other target providers, and direct idiomatic lowering remain explicit non-goals.
