# Features

- Normalize parser-confirmed JavaScript and TypeScript no-substitution template literals and Java Unicode string escapes into portable semantic string values.

# Fixes

- Apply Java Unicode translation before ordinary string-escape decoding, preserving chained-escape eligibility and rejecting invalid translated string boundaries.
- Preserve php-parser UTF-16 source locations for non-ASCII string literals.
