# Coding standards

Production code is ESM JavaScript with `// @ts-check` and concrete JSDoc contracts. TypeScript runs with `allowJs`, `checkJs`, declaration emission, NodeNext resolution, and strict checking. Parser values may use an opaque external type only at an immediate narrowing boundary; semantic and public values use named concrete types.

Formatting follows the sibling Velocious conventions: no semicolons, double-quoted strings, two-space JavaScript indentation, spaces inside named imports, one expression per readable chain line, and descriptive JSDoc including parameter and return descriptions. ESLint uses the flat configuration with recommended JavaScript, JSDoc, JSDoc inline-cast, and JSDoc tag-line rules.

Keep adapters, semantic types, and backends separate. Never parse source with regex fallbacks. Unsupported syntax and capabilities must be visible diagnostics. Each spec file has one top-level `describe`; generated build/declaration files are never hand-edited.
