# Changelog

## Unreleased

- Add strict-Boolean condition-controlled loops for PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java.
- Resolve `break` and `continue` to deterministic nearest-loop identities across list, ordered-map, and condition-controlled loops, with transactional validation of malformed or cross-function targets.
- Add bounded nominal reference classes with exact constructors, private instance state, fresh stable identities, and resolved receiver method calls for PHP, Ruby, JavaScript/JSDoc, TypeScript, and Java.
- Preserve receiver-before-argument and left-to-right construction/call evaluation while rejecting incomplete initialization, visibility/type/resolution failures, open or inherited classes, reflection, and unsupported target roles before artifact exposure.

Released and delivery-candidate details are retained as timestamped fragments in `changelog.d/`.
