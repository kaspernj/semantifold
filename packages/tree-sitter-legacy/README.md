# Legacy Tree-sitter development workspace

This private workspace owns source checking and declaration generation for Semantifold's internal legacy Tree-sitter boundary. It has no public export or publication route.

The runtime package under `runtime/` is installed as an ordinary local package and bundled into the root `semantifold` tarball. Its parser-neutral serializer returns recursively frozen plain data with UTF-16 coordinates. Parser, tree, syntax-node, and language handles remain inside the isolated exact `tree-sitter@0.21.1` and `tree-sitter-c@0.23.2` subtree.

The workspace layer keeps matching legacy development types beside the owned source while leaving the nested `file:` dependency materialized instead of represented as an npm workspace link. It adds no package export or release layer.

Root `acceptDependencies` accepts the exact private runtime version already physically bundled under root `node_modules`; it does not change the `file:` installation source or require an internal registry release. This lets consumers use npm's ordinary `install-links=false` default even though development uses a materialized local copy. Native runtime and grammar version requirements remain exact and unchanged.

After editing any shipped file in `runtime/`, run `npm ci` from the repository root before testing or packing. npm installs a copy of this local package, so building declarations alone cannot refresh its runtime bytes. `npm run verify:legacy-runtime` compares npm's current source pack list with the complete installed payload (excluding registry-owned dependencies), then checks every file byte for byte. Pretest, prepack, lint, and the direct runtime spec reject any mismatch. The packed-consumer proof also compares the archive payload with the owned source.

Task019 adds exact official `tree-sitter-cpp@0.23.4` beside C in the same private runtime. The CPP grammar peer and C grammar dependency resolve to the existing exact native versions. Only recursively frozen parser-neutral values cross this boundary; the root package has no public parser-adapter export. To refresh a changed local manifest’s lock entry, run `npm install --package-lock-only semantifold-tree-sitter-legacy-internal@file:packages/tree-sitter-legacy/runtime`, then normal root `npm ci` and the consistency gate.

Task020 adds qualified official `tree-sitter-rust@0.23.1` to that same runtime and development type graph. Its `^0.21.1` peer uses the existing isolated binding. The schema version and root distribution boundary remain unchanged.
