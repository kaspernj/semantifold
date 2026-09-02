# Harden semantic normalization and generation

- Reject unsafe integers, unmodeled function flags, discarded Java syntax, non-local Ruby annotations and parameter forms, and unsupported PHP declarations at frontend boundaries.
- Validate target identifiers, reserved words, exact branch shape, call arity, and Java signed 32-bit integers before generation.
- Pin the custom inline-JSDoc-cast ESLint plugin to an immutable Git commit and cover the package/lockfile contract.
