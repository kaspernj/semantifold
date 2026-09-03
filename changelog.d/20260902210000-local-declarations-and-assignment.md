# Features

- Add parser-independent typed local declarations, lexical binding validation, mutability-preserving simple assignment, and executable five-language round trips.
- Define exact Ruby and PHP local type carriers with `@semantifold-immutable` metadata for immutable declarations.
- Prevent locals and parameters from capturing module callables, and reject target-specific locals or functions that capture backend-owned print or launcher scaffolding.
- Convert Prism byte offsets before reading Ruby function and local metadata after multibyte source text.
- Reject misspelled Ruby local profile tags and malformed external task-002 expressions with stable located diagnostics.
- Validate every external local-declaration and assignment field structurally before target-specific checks or emission.
- Reject TypeScript strict-mode `arguments` and `eval` binding names before emission without changing other targets' identifier policies.
- Reject malformed call fields nested in caller-supplied local initializers and assignment expressions with located backend diagnostics.
- Enforce proven TypeScript, PHP, and Ruby runtime identifier restrictions only for the binding roles each target rejects.
