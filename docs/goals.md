# Goals

Semantifold's long-term goal is a language-neutral toolkit for understanding, transforming, generating, and eventually executing programs through a shared high-level semantic representation. The representation should make types, control flow, calls, declarations, diagnostics, and source provenance understandable without exposing a language parser's private tree.

The current release candidate proves one minimal vertical slice across PHP, Ruby, JavaScript, TypeScript, and Java. It includes versioned source provenance, deterministic semantic node/symbol identity, range-based generated mappings, Source Map v3 interop, composition, and diagnostic remapping across that slice. It does not yet provide a general analyzer, transformation API, interpreter, optimizer, project graph, debugger integration, coverage remapping, or lossless formatter.

Roadmap candidates include a versioned full semantic schema, more scalar and compound types, expressions and statements, user-authored transformations, richer backend capability negotiation, multi-file modules, cross-language stack/coverage presentation, and a semantic interpreter. LLVM, Wasm, JVM bytecode, package publication automation, and production TensorBuzz changes are explicitly outside this candidate.
