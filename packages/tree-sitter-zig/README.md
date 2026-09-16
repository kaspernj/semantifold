# Zig Tree-sitter development workspace

This private workspace owns type checking and declaration generation for Semantifold's isolated Zig parser boundary. It has no public export or publication route.

The nested `runtime/` package is the sole root `file:` dependency. It freezes parser results into parser-neutral plain data with UTF-16 coordinates, keeping `tree-sitter@0.22.4`, `@tree-sitter-grammars/tree-sitter-zig@1.1.2`, and every native parser handle within the private subtree. The selected grammar is the exact MIT-licensed upstream tag/commit `v1.1.2` / `b670c8df85a1568f498aa5c8cae42f51a90473c0`; its npm archive integrity is `sha512-J0L31HZ2isy3F5zb2g5QWQOv2r/pbruQNL9ADhuQv2pn5BQOzxt80WcEJaYXBeuJ8GHxVT42slpCna8k1c8LOw==`.

After editing a shipped `runtime/` file, refresh the materialized dependency with normal root `npm ci`. The root consistency gate compares every packed source byte with the installed payload.
