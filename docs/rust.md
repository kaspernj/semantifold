# Rust source and Cargo target

Task020 registers `rust` as a frontend and a three-artifact native text backend for Tasks001–004. The official grammar passed [isolated qualification](parser-qualification.md#task-020-rust-grammar-qualification--2026-09-08) before dependency integration. The compiler pair subsequently passed real offline qualification on both the canonical development image and TensorBuzz's actual Linux base. Local product acceptance is recorded separately below; review, exact-head TensorBuzz CI, merge and post-merge verification remain coordinator-owned delivery gates.

## Qualified build-time toolchain

The repository Dockerfile and TensorBuzz setup select the official Rust **1.98.1** distribution dated **2026-09-03**, host **x86_64-unknown-linux-gnu**, installed under `/opt/rust-1.98.1`. They install only the compiler, host standard library and matching Cargo components using the upstream standalone installers. `/usr/local/bin/rustc` and `/usr/local/bin/cargo` point into that prefix. There is no rustup, home installation, automatic toolchain selection, project dependency installation or runtime download.

| Component | Official distribution SHA-256 |
| --- | --- |
| `rustc-1.98.1-x86_64-unknown-linux-gnu.tar.xz` | `e974f036b28565f37c0f3bd92ddefa809bee16c04f9dcf07b9ed96e05aaaf7c4` |
| `rust-std-1.98.1-x86_64-unknown-linux-gnu.tar.xz` | `fa3ff450172a16c026944030230c5069947af93c728d9179971d44e5e0cfb561` |
| `cargo-1.98.1-x86_64-unknown-linux-gnu.tar.xz` | `ea1de9f9e23107d97ee2b41a72c552f34064a593da503789218387aee59f3ba4` |

All URLs use `https://static.rust-lang.org/dist/2026-09-03/` followed by the filename above. Hashes agree between the official component sidecars and [versioned channel manifest](https://static.rust-lang.org/dist/channel-rust-1.98.1.toml). The manifest SHA-256 is `a7c8774a5fd8441c997d94c029776cbc5eb111e9d72ab5d256fa69866644347e`, independently checked against its official sidecar. Image setup checks archive bytes before extraction and requires the exact executable identities below.

| Identity | Observed qualified identity |
| --- | --- |
| rustc | `rustc 1.98.1 (48a229cea 2026-09-01)`; full commit `48a229ceaefd4985c50990b14116b6d856af0985` |
| Cargo | `cargo 1.98.1 (797e8a9bc 2026-08-05)`; full commit `797e8a9bca276c1c9f9f738d2a20f484fa4eea9d` |
| host | Both verbose version reports must identify `x86_64-unknown-linux-gnu` |
| sysroot | `/opt/rust-1.98.1` |

The Rust annotated tag `1.98.1` is object `18ed059b1465ce6195154de3250a668f1dd3b1fa`, peeled to the compiler commit above. Its Cargo submodule points to the Cargo commit above. The channel manifest's Cargo library version `0.99.0` is not the executable version: [Cargo's version implementation](https://github.com/rust-lang/cargo/blob/797e8a9bca276c1c9f9f738d2a20f484fa4eea9d/src/cargo/version.rs) uses the bootstrap release identity for the CLI. Both image probes confirmed these actual executable versions and commits.

Rust and Cargo are distributed under `MIT OR Apache-2.0`, with third-party notices described by the [Rust COPYRIGHT record](https://github.com/rust-lang/rust/blob/1.98.1/COPYRIGHT). Upstream installers retain their distribution license files. Only checked-in configuration and evidence text enter Semantifold; compiler distributions are image build inputs, never npm dependencies or repository archives. See [official standalone installation guidance](https://forge.rust-lang.org/infra/other-installation-methods.html).

The development base remains the existing pinned Ubuntu 26.04 image. The retained actual TensorBuzz qualification identifies `peakflow/base-ubuntu-24-04@sha256:9b23d3d5f82a8babb312b7ce549e02d60a6f32344b0088b90d3f486a9d8207a5` (Ubuntu 24.04 Noble). The coordinator verified that actual base and completed no-cache builds on both bases, followed by 11 fresh crates and 93 commands per base with networking disabled. All qualified source/manifest/lock bytes and executable hashes matched across bases; Cargo's verbose OS line was checked separately for Ubuntu 24.04 and 26.04. The same canonical development lane was then replaced reversibly, preserving its full home and task-owned source. No runtime tool installation occurred.

## Fixed Cargo contract

The generated crate uses edition **2021**, `rust-version = "1.98.1"`, a fixed dependency-free package, and identical `overflow-checks = true` / `panic = "abort"` settings in dev and release. There is no claim of an earlier minimum supported compiler. Cargo 1.98.1 generated the qualified format-4 lockfile. The 242-byte manifest SHA-256 is `1355468ebe077f03f1de9f990f243721c0e426a4448d6205ab3540cb2d2f7265`; the 165-byte lock SHA-256 is `185a41f6648ef49c8e7721f3321604abf05fae11c7007f823121c17fe48eec64`. Both include a final LF. These exact bytes are emitted without invoking Cargo during generation.

Each accepted fresh crate passes `cargo check --offline --locked`, debug and release builds, and `cargo run --offline --locked --quiet` in both modes. Separate direct binary execution distinguishes compiler diagnostics from runtime stdout/stderr/status. Input source, manifest and lockfile hashes must remain unchanged. An empty isolated Cargo home and explicit compiler path prevent ambient Cargo/Rust configuration from selecting another toolchain; qualification runs with Docker networking disabled after image construction. A dependency requiring network resolution must fail. See [Cargo's offline and locked contract](https://doc.rust-lang.org/cargo/commands/cargo-run.html) and [profile settings](https://doc.rust-lang.org/cargo/reference/profiles.html).

The narrow semantic profile remains Tasks 001–004: `i64`, `bool`, owned UTF-8 `String`, two explicitly typed by-value parameters, explicit returns, initialized typed locals, assignment and braced conditionals. Generated clones preserve scalar value copies; source move validation independently rejects later reads of moved values. Borrow, clone, print, string and overflow support collapse only after exact complete CST/token validation. Marker comments confer no authority. There are no semantic ownership/reference/Result/exception nodes.

Rust's [left-to-right operand evaluation](https://doc.rust-lang.org/reference/expressions.html#evaluation-order-of-operands) permits direct emission for ordinary operands and calls; Boolean operators retain native short-circuiting. Checked arithmetic uses `i64::overflowing_add/sub/mul/neg`, a private overflow flag and process exit 70 with exactly `semantifold: integer overflow\n` on stderr, matching the existing C/CPP boundary. Known out-of-range operations reject before emission. Safe-integer source literals remain unchanged. Host allocation, stack and output failures remain host failures, not portable exceptions; panic abort prevents unwinding and must never approximate semantic control flow.

The native qualification probe covered all task profiles, owned Unicode/NUL values, repeated reads and mutation, order and short-circuiting, signed extrema, each overflow exit in both modes, compiler rejection of an illegal move, and offline rejection of an uncached dependency. Raw per-base results are retained under `/home/dev/.threadwire/semantifold/task020-20260908T091900Z-evidence/toolchain-{resolute,noble}/results.json`; `toolchain-both-bases.json` reconciles identities and all 186 commands. The qualified executable SHA-256 values are rustc `859254978c0a0402c32f949f6de0d99aee73be8d15f45aac00ae1448aac51e74` and Cargo `da77c8b33849312255ccde3179198ada4c8deb370488d050286146b1d1b27e14`.

## API and exact source spelling

```js
import {generateArtifactSet, parse} from "semantifold"

const module = parse({language: "rust", filename: "input.rs", source: `
fn semantifold_print_string(value: String) { println!("{}", value); }
fn join(left: String, right: String) -> String {
    let saved: String = left.clone();
    return saved + &right;
}
fn main() { semantifold_print_string(join(String::from("é"), String::from("😀"))); }
`})
const crate = generateArtifactSet({language: "rust", module})
```

The ordered paths are always `Cargo.toml`, `Cargo.lock`, `src/main.rs`; roles are `manifest`, `support`, `entry`. The synthetic package is `semantifold-generated` version `0.0.0`, `publish = false`, `build = false`. It has no dependency, feature, workspace, build script or proc macro. Manifest and lock have synthetic provenance related to the module. The entry has rich range mappings and a Source Map v3 with original source content. Single-text APIs fail with `UNSUPPORTED_ROLE`. The only accepted filename override is `src/main.rs`; map directives and map filenames are unsupported. Generation validates the entire IR and all target collisions before returning any artifact and performs no filesystem or compiler work.

Only ASCII ordinary identifiers are supported. Edition-2021 keywords, `_`, `main`, `String`, `std`, `i64`, `bool`, and the `semantifold_` namespace are protected in all user declaration/reference positions. Names such as `gen` and `macro_rules` remain legal ordinary bindings in this fixed edition and are tested with the actual compiler. Raw identifiers and user dispatch are outside the profile.

Integers use canonical unsigned decimal spelling with the exact `i64` suffix, up to the existing safe-integer literal bound; negatives use unary `-`. Hex/octal/binary forms, digit separators, inferred or alternative suffixes are rejected. Booleans use `true` and `false`. Strings use exact `String::from("…")`, with Unicode scalar text and checked `\0`, `\n`, `\r`, `\t`, escaped slash/quotes, ASCII-only two-digit `\xNN`, or scalar `\u{hex}` escapes. Raw/byte strings, multiline content, continuation escapes and lone surrogates are unsupported. Generated controls, NUL, DEL and U+2028/U+2029 use canonical Unicode escapes; native stdout preserves UTF-8 bytes and appends one LF.

Crate-root free functions have exactly two required explicitly typed by-value scalar parameters, explicit scalar return types and explicit return statements. Parameters are semantically immutable. Locals require an initializer and explicit type; `let` is immutable and `let mut` mutable. Simple assignment, every existing scalar unary/binary operator, braced `if`/`else if`/`else`, and parameterless `fn main()` are supported. Tail returns, destructuring, inferred types, references/raw pointers/lifetimes, traits/generics/user types/modules/use/impl/type items, unsafe/extern, closures/async, const/static, match/loops/ranges/casts/indexing, custom dispatch, turbofish, arbitrary macros/attributes, Result/Option/question-mark, panic/assert/unwrap/expect/catch_unwind and main returning Result are rejected.

Only exact `.clone()` on a supported String expression and `+ &` borrowing for a String concatenation operand are source scaffold exceptions. String comparisons borrow operands implicitly. Calls consume String arguments left-to-right; copying a local requires its explicit source clone when later use would otherwise be invalid. Returning a final owned value may move it. Validation tracks moves, temporary comparison borrows, conditional evaluation and continuing branch states separately from IR. For example, moving `left` into a call and later reading it, or `left == take(left, right)` while the left comparison borrow remains active, is rejected at the original use. Reassignment can restore a mutable moved binding. Generated clones preserve value copies without changing these source rules.

Prints call exact private scalar helpers. Those definitions contain one fixed `println!("{}", value)` token shape. Overflow helpers use exact `overflowing_*`, tuple flag checks and fixed exit behavior. Every named/anonymous/extra/error/missing child and macro token is accounted for; altered helpers, doc attributes, duplicate helpers, lookalikes and marker-only comments fail. Ordinary inert comments, including nested block comments, may be omitted after traversal. Generated lint support permits only exact benign unused/dead-code/parenthesis, unconditional-recursion and mixed-case-name warnings; this prevents Cargo warning replay from contaminating otherwise valid runtime output. It does not allow unsafe code or catch failures.

## Limits and acceptance

The qualified legacy parser accepts at most 32767 UTF-16 code units, including generated support. Exhaustive CST traversal is bounded to 512 levels. The backend measures the actual emitted syntax depth as well as byte-independent UTF-16 length, so nested clone/borrow/call wrappers cannot produce a source file outside that contract. Cycles, malformed late nodes, excessive expanded occurrences, impossible known string allocations and known out-of-range integer operations reject transactionally. Host allocation/stack exhaustion and stdout/stderr failures remain host failures; the exact print macro can abort on a host output failure. No panic, Result or exception represents semantic control flow.

With the generated artifacts materialized in a fresh directory, acceptance runs:

```sh
cargo check --offline --locked
cargo build --offline --locked
cargo run --offline --locked --quiet
cargo build --offline --locked --release
cargo run --offline --locked --quiet --release
```

Tests also execute each built binary directly, distinguish build diagnostics from runtime output, require exact stdout/stderr/status and compare all artifact hashes before and after. `SEMANTIFOLD_RUSTC` and `SEMANTIFOLD_CARGO` select absolute discovery overrides. Discovery rejects absent/swapped/unsupported tools, wrong commits and foreign hosts. Test commands use an empty isolated Cargo home, explicit discovered compiler and `CARGO_NET_OFFLINE=true`; a fresh uncached dependency fails without resolving a network package.

Focused product specs cover Tasks001–004 round trips, all 18 operations, strings and ownership, branch/order/divergence behavior, both build modes and every overflow, real rustc E0382/E0505 source rejection, native execution at the generated nesting boundary, malformed IR/helper adversaries, deterministic artifacts and rich/V3 forward/reverse mappings around Unicode. Rust fixtures execute in all original-five native targets, and one original-five source per profile executes in Rust in both modes. Task025 owns the expanded-cohort matrix.

The root packed-consumer proof repeats ordinary npm install and clean npm ci with separate fresh caches, empty configuration files, default install-links=false, isolated modern/legacy runtimes, strict TypeScript and native offline Rust in both modes. The local lane still has the complete home mounted: this proves cleaned-environment behavior, not the external source/home/auth-free boundary. Disposable acceptance inputs and exact local evidence are prepared for the coordinator to run across that boundary before delivery. Local testing uses individual focused files sequentially; TensorBuzz owns full/native aggregate acceptance.
