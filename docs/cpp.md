# C++ source and target profile

`cpp` is an independent frontend and single-text native backend for Tasks 001–004. The official `tree-sitter-cpp@0.23.4` grammar runs inside the existing private, root-bundled Tree-sitter 0.21.1 boundary. C uses its own grammar and profile. No compiler, preprocessor, source-mode guess or source-text recovery supplies semantic meaning.

## Toolchain and artifacts

Generation returns exactly `program.cpp`, including fixed inline scalar support. `generate`, `generateArtifact` and `generateArtifactSet` all support CPP. Rich and Source Map v3 data accompany the artifact; no map directive, alternate map filename, header, build file, dependency project or additional semantic module is emitted. The filename must be exactly `program.cpp`; map metadata uses `program.cpp.map` and the directive is `none`.

The selected profile is C++20, Ubuntu Clang 21.1.8, Linux x86-64 (`x86_64-pc-linux-gnu`), eight-bit bytes, 64-bit int64/size/ptrdiff, and libstdc++ with its C++11 owned-string ABI (`_GLIBCXX_USE_CXX11_ABI == 1`). The canonical development lane supplies libstdc++-15-dev 15.2.0-16ubuntu1. The Noble CI lane explicitly installs g++-13 and its libstdc++-13 headers and records the installed version. These are the two image-owned library builds of the same selected standard-library/ABI profile; libc++ and the old libstdc++ string ABI are excluded. Static assertions reject incompatible native byte/ABI settings. Local execution qualifies the development build; exact-head TensorBuzz must qualify the checked-in Noble lane.

Discovery ID `clangpp` uses canonical `clang++` or the absolute `SEMANTIFOLD_CLANGPP` override. In the development container use `/usr/bin/clang++-21`; the C lane retains `SEMANTIFOLD_CLANG=/usr/bin/clang-21`. Discovery resolves real paths, so compile and link both explicitly pass `--driver-mode=g++`; this preserves C++ driver semantics when clang++ is a symlink to clang. Discovery never installs or substitutes a tool.

Compile flags, in addition to `-O0` or `-O2`, are:

```text
--no-default-config --driver-mode=g++ -std=c++20 -stdlib=libstdc++
-Wall -Wextra -Werror -pedantic-errors -Wconversion -Wsign-conversion -Wshadow -Wformat=2
-fno-exceptions -fno-rtti -ftrapv -finput-charset=UTF-8 -fexec-charset=UTF-8 -fno-color-diagnostics
```

Compilation (`-c program.cpp -o program.o`), linking (`--no-default-config --driver-mode=g++ -stdlib=libstdc++ -O0 program.o -o program`) and execution are separate stages. All stages run in a fresh directory with fixed `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `TZ=UTC`, captured output and bounded execution. Both optimizations also run with `-g -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer` at compile and link, plus `ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:allocator_may_return_null=1` and `UBSAN_OPTIONS=halt_on_error=1`. Missing compilers, runtime libraries, sanitizer support, failed stages and failed cleanup are failures.

## Scalar values and errors

| Semantic value | Exact CPP form | Behavior |
| --- | --- | --- |
| integer | `std::int64_t` | JavaScript-safe nonnegative literal magnitude, explicit semantic negation, checked signed-64 arithmetic |
| boolean | `bool` | Exact true/false, strict typed conditions, Boolean short circuit |
| string | owned `std::string` | UTF-8 bytes, by-value locals/arguments/returns, scalar value equality |

Integer literals use exact `std::int64_t(123)` construction. Bare native integers, suffixes, deduction and arbitrary casts are rejected, so a source expression cannot silently perform narrower `int` arithmetic. String literals use exact `std::string("bytes", byteCount)` construction: an ordinary parser-owned literal and a matching canonical decimal UTF-8 byte count. Raw UTF-8, supported simple byte escapes and bounded octal/hex byte escapes are decoded strictly; concatenated/prefixed/raw literals, universal escapes, invalid UTF-8 and parser-split hexadecimal escapes are rejected. Generated literals use three-digit octal bytes, preserving Unicode and embedded NUL independently of source encoding or locale. The byte count belongs only to the exact literal scaffold, not to semantic user size/pointer operations.

Raw CR or LF inside an ordinary literal is rejected at its parser-owned content node, including the bare CR that the official grammar accepts as `string_content`. Clang treats that CR as a source line break. Escaped `\r`/`\n`, Unicode/NUL values, LF/CRLF source lines and CR whitespace between declarations retain their supported behavior.

Add, subtract, multiply and negate use checked helpers. Known literal-only results outside signed int64 fail before artifacts; dynamic overflow writes exactly `semantifold: integer overflow\n` to stderr and exits 70. No generated arithmetic relies on signed-overflow undefined behavior. `-ftrapv` additionally protects raw caller arithmetic in the selected compiler profile; caller code needing the generated status-70 policy uses the exact checked helper forms. There is no promise to normalize native traps from arbitrary raw source execution into semantic exceptions.

Strings are owned values: copying, concatenating, assigning, passing and returning them cannot expose alias identity, moved-from state, references or lifetime effects. No explicit move/borrow is generated. Fixed helpers receive by-value scalars; compiler copy elision/moves are permitted only by normal as-if semantics. String concatenation checks its native maximum size; known impossible object lengths reject before generation. Byte-counted `std::fwrite` output preserves NUL and UTF-8. Integer formatting uses unsigned magnitude and ASCII digits, including both signed extrema; Boolean output is ASCII `true`/`false`, followed by one newline. Output failure and checked string-size failure exit 70 with the corresponding fixed diagnostic.

The support contains no `throw`, `try` or `catch`. Exceptions and RTTI are disabled. Library allocation exhaustion, failed allocation during value copying, stack exhaustion, library termination and external process termination are host-resource failures; they do not become portable user exceptions or semantic RAII cleanup effects. Normal successful scope exit destroys native string storage. Fatal process termination is not an unwinding contract. ASan/UBSan/leak executions cover long strings, copies, reassignment, concatenation, returns and all arithmetic fatal paths.

## Accepted source and exact scaffolds

A source translation unit contains the exact generated inline support, followed by namespace-scope semantic functions and one canonical final `int main() { ... return 0; }`. Each semantic function has a unique non-overloaded name, exactly two required by-value scalar parameters, explicit scalar result type and explicit returns on every path. Locals are initialized with an explicit scalar type; `const` records semantic immutability. Plain assignment, supported typed operators, exact print helper calls, braced nested/empty/fallthrough branches and `else if` normalization are supported. Caller functions must be defined before calls, apart from self-recursion. Generated exact prototypes support forward calls and mutual recursion. Namespace-scope function-address discards are unnecessary in CPP and are not emitted; unused parameters/locals use exact inert generated discards.

The frontend traverses every named, anonymous, comment and field-bearing child and rejects error, missing and recovered nodes. Only complete CPP child shapes collapse: qualified `std::int64_t`/`std::string`, the precise include/support prefix, literal construction, print helpers, generated prototypes, main and ordered regions. Qualified names are resolved through CPP `scope`/`name` edges and `::`; conditions use CPP `condition_clause` nodes. Ordinary comments/whitespace may vary, but preprocessing-sensitive comments and unrecognized scaffold comments reject.

The shared backend-only occurrence planner leaves semantic IR unchanged. It plans every initializer, assignment, return, print argument, call argument and condition; eager operands and arguments execute left to right. Each nontrivial occurrence gets a six-digit `semantifold_ordered_` name with exact `std::int64_t`, `bool` or owned `std::string` type. Short-circuit RHS steps stay in the corresponding conditional block.

Each statement has paired `semantifold:ordered-expression:cpp:v1` comments with a deterministic statement number and semantic signature. The CPP frontend reconstructs candidate expressions, requires linear temporary consumption and exact conditional/final-consumer shapes, resolves semantic types, then compares every significant original CPP node, field and token against a newly parsed canonical CPP plan. The digest supplements this structural proof. Partial, forged, reordered, duplicate, wrong-type, wrong-number, wrong-dependency, wrong-consumer, escaping, colliding and C-tagged regions reject. Caller-authored semantic or scalar-helper calls nested in operands/arguments remain rejected; ordinary CPP syntax does not establish the portable evaluation order. Literal construction alone is pure and may nest.

No templates/concepts, deduction/auto, user overloads/operators/conversions, references, pointers, arrays, classes/records/enums, constructors/destructors, inheritance/virtuals, namespaces/using outside exact support, exceptions/specifications, RTTI, casts outside exact literal/support scaffolds, initializer lists, lambdas, coroutines, ranges, user literals, macros, general standard-library calls, C compatibility mode or user build system enters semantic IR. The protected `semantifold_` namespace, implementation-reserved names/double underscores, CPP keywords and included C library names/macros are unavailable to user declarations. Standard implementation internals in exact support are not portable code or an extension of the planned stdlib architecture.

CPP additionally reserves `WEOF` and `wint_t`, introduced by the qualified libstdc++ `<string>` include chain as a macro and global typedef. Functions, parameters and locals with these exact names fail target validation before any artifact is returned. This protection belongs to CPP's header environment; C keeps its existing identifier contract, and ordinary CPP names such as `WEOFValue` and `wint_type` remain valid.

## Bounds, diagnostics and provenance

The qualified binding accepts at most 32,767 UTF-16 code units, including all inline support, comments and whitespace. Frontend input and an exact private backend size preflight enforce that limit. Semantic graph cycles, depth above 512 and expanded occurrence counts above 999,999 reject before recursive validation/provenance; CPP CST depth is also bounded at 512. Native parser failures retain a source-file range when no finer node exists. Statically known owned string sizes above the qualified signed-64 object limit reject; native `std::string::max_size()` remains checked for runtime concatenation. This lane does not inherit C17's 4,095-byte literal limit.

Malformed IR, unsupported target options/identifiers/types and unrepresentable integer/string/source bounds use `UNSUPPORTED_CAPABILITY` before any artifact. Unsupported source forms use located frontend diagnostics; malformed generated regions normalize semantic/capability failures to `UNSUPPORTED_SYNTAX`. Parser recovery uses `PARSE_ERROR`.

Original operators, call targets, types and statement consumers retain rich/v3 provenance. Runtime code, prototypes, discards, marker comments, temporary declarations/uses and short-circuit control have explicit synthetic origins related to semantic occurrences. Generation/reparse is deterministic, including shared semantic objects, Unicode/CRLF source positions, serialized maps and stale-provenance rebuilding. Tests use the complete C distinguishable-call matrix, five CPP fixture profiles, original-five crossings and real native execution; expanded language-cohort matrices remain Task025 work.
