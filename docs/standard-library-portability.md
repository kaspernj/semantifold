# Standard-library portability

Status: planned architecture; not implemented in `semantifold@0.2.0`.

## Purpose and boundary

Semantifold will make a deliberately bounded set of familiar source-language standard-library APIs portable without building a library translator for every source/target pair. The architecture is hub-and-spoke: source-language API shape is normalized into versioned canonical capabilities, and target-language native behavior is reached only through providers for those capabilities.

This is an incremental compatibility profile, not a promise to translate arbitrary applications or complete standard libraries. The current release cannot parse imports, classes or methods, loops, optional values, typed errors, resources, host APIs, or any standard-library use. The dependency plan must deliver those semantic prerequisites before the first portability slice.

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

## Ruby-to-PHP example

Consider supported Ruby source that requires `socket`, creates `TCPSocket.new(host, port)`, reads lines with `gets`, and closes the socket. Once the necessary semantic tasks exist, Ruby stdlib resolution can prove that `TCPSocket` refers to the supported native symbol and substitute the Ruby language compatibility stdlib/facade.

The portable facade can be expressed schematically as:

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
```

This is illustrative pseudocode, not syntax accepted by `0.2.0`. The real facade must use explicit types, optional/presence results, typed failures, and ownership rules from the selected contract versions. Its `gets` preserves the supported Ruby behavior, including newline retention and an absent value at EOF, by composing canonical capabilities rather than by recognizing a source read loop.

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
```

The application and Ruby facade compile to PHP. Generated PHP may define a source-compatible `TCPSocket` class in a generated compatibility namespace and alias it at the call site. Its methods call the linked canonical `SocketClient`, text-stream, and resource provider operations, while application output uses the canonical output capability. Those provider operations alone call PHP's genuine native stdlib, including `fsockopen`, `fgets`, and `fclose` for the socket operations.

The path is therefore:

```text
Ruby application + Ruby TCPSocket facade
  → semantic IR
  → generated PHP compatibility class
  → canonical SocketClient/TextStream/Output/Resource calls
  → PHP provider
  → fsockopen/fgets/fclose
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

Facade selection records the proved source symbol identity, facade module/version, and canonical capability requirements in semantic project metadata. That evidence, not a raw source name, authorizes linking.

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

The first planned proof is intentionally narrow: a blocking TCP client, a Ruby `TCPSocket` compatibility facade, and a PHP native provider. It does not imply coverage for every language or every networking API. The dependency sequence is maintained in the [implementation plan](plans/2026-09-05-standard-library-portability.md) and [roadmap](../todo/README.md).

## Acceptance strategy

Every implementation slice requires deterministic parser, semantic, link, generation, and real-toolchain acceptance. The first vertical slice will:

1. start a real local ephemeral TCP server under test control, with no external network dependency;
2. parse supported Ruby source and prove its `socket`/`TCPSocket` identity;
3. compile the application and used Ruby compatibility facade to PHP;
4. link only the required PHP provider/native-binding modules;
5. run the generated artifacts with real `php` and assert exact output, retained newlines, distinct EOF absence, normalized connection failure, deterministic close, repeated-close policy, and use-after-close rejection; and
6. cover unresolved, shadowed, monkey-patched, unsupported, provider-missing, collision, and transactional-failure cases.

Same-language acceptance must additionally prove that the protected native binding bypasses the compatibility facade. Generated artifacts are reparsed where the target frontend supports their profile, generated twice for byte-for-byte determinism, inspected for unused module exclusion, and checked for complete provenance. Snapshots or source-only assertions cannot replace actual execution.
