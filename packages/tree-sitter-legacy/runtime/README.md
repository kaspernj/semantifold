# Semantifold internal legacy Tree-sitter runtime

This package is private implementation code bundled only inside the root `semantifold` distribution. It is not published or exported by Semantifold.

`parseCst(source, language = "c")` selects exactly "c", "cpp" or "rust" and serializes that official grammar’s results into recursively frozen `semantifold.parser-cst` version 1 plain data with UTF-16 indices and positions. Native Parser, Tree, Node, and language handles never leave this package.

The package owns exact `tree-sitter@0.21.1`, `tree-sitter-c@0.23.2`, `tree-sitter-cpp@0.23.4` and `tree-sitter-rust@0.23.1` dependencies. npm bundles their registry contents, including licenses, platform prebuilds, and source fallbacks, into the root tarball.
