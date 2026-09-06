# `@kaspernj/semantifold-tree-sitter-legacy`

This independently releasable ESM workspace is currently unpublished. It isolates Tree-sitter grammars that require a legacy Node runtime from Semantifold's modern Tree-sitter dependency graph.

The only current export is `@kaspernj/semantifold-tree-sitter-legacy/c`. Its `parseCst(source)` operation returns a recursively frozen `semantifold.parser-cst` version 1 snapshot containing plain structural data and UTF-16 coordinates. Parser, tree, syntax-node, and language handles never cross the package boundary.

```js
import {parseCst} from "@kaspernj/semantifold-tree-sitter-legacy/c"

const snapshot = parseCst("int main(void) { return 0; }\n")
```

The package owns exact runtime dependencies `tree-sitter@0.21.1` and `tree-sitter-c@0.23.2`. A future Rust export may reuse this isolation boundary only after a separate parser qualification; no Rust dependency or export is currently shipped.

Any publication of this workspace is separate from `semantifold` and requires explicit authorization. Semantifold must not adopt it as a runtime dependency until the registry artifact has been published and independently verified.
