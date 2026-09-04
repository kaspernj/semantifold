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
