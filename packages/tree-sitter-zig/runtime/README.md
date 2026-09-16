# Semantifold internal Zig Tree-sitter runtime

This private implementation package is bundled only inside the root Semantifold distribution. It is not published or exported.

`parseCst(source)` serializes the exact `@tree-sitter-grammars/tree-sitter-zig@1.1.2` grammar through isolated `tree-sitter@0.22.4` into recursively frozen `semantifold.parser-cst` version 1 data with UTF-16 indices and positions. Parser, tree, syntax-node, and language handles never leave this package.
