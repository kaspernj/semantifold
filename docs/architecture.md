# Architecture

Semantifold has three explicit layers.

1. Frontend adapters in `src/frontends/` invoke mature language parsers and translate only recognized syntax. Babel owns JavaScript and TypeScript parsing, `php-parser` owns PHP, Prism owns Ruby, and Lezer owns Java. Their AST/CST objects never appear in the public API. Adapters enumerate supported children and reject every other parser node; filtering syntax away is not a normalization strategy.
2. `src/semantic/` defines the shared JSDoc-typed discriminated representation and one-based, filename-bearing source locations. The initial nodes are module, function, parameter, entry point, if, return, print, identifier, safe integer literal, binary expression, and two-argument call.
3. Source backends in `src/backends/` validate their semantic capabilities before emitting target syntax. Shared validation owns exact branch/entry shape, recursively complete expressions, and target identifier checks. Target-specific validation adds constraints such as Java's signed 32-bit `int` range. A backend either returns a complete executable program or raises `UNSUPPORTED_CAPABILITY`; it never silently drops nodes or lets an emitter discover malformed shape through a `TypeError`.

`index.js` is the public boundary. `parse({language, filename, source})` dispatches to an adapter. `generate({language, module})` validates and dispatches to a backend.

## Round trips

The tested semantic round trip is source → semantic module → generated source → equivalent semantic module. It preserves modeled meaning, not original spelling, comments, whitespace, visibility, braces, or formatting. Locations on the generated parse refer to generated source; they are not mappings back to the original. `number` in JS/TypeScript is deliberately narrowed to semantic `integer` for this fixture even though those languages permit fractional and special numeric values; only safe integer literals can enter the representation.

Frontend source capabilities and backend target capabilities are intentionally separate. A source-valid semantic name can be rejected for a target reserved word, and a safe semantic integer can be rejected by Java's narrower `int` range. These are target diagnostics at the original semantic node location, not generation fallbacks.
