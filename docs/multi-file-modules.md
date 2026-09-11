# Multi-file modules and names

Task 010 adds an explicit original-five project boundary without filesystem or package discovery. `parseProgram({entryModule, sources})` receives every PHP, Ruby, JavaScript/JSDoc, TypeScript, or Java source as `{id, filename, language, source}`. All sources in one request use the same language profile. Logical IDs are stable parser-neutral identities; filenames and native module/package spellings are resolution metadata, not semantic meaning.

```js
import {generateProgramArtifactSet, parseProgram} from "semantifold"

const program = parseProgram({
  entryModule: "main",
  sources: [{
    id: "main",
    filename: "main.ts",
    language: "typescript",
    source: `import {label} from "./labels.js"
console.log(label("Ada"))
`
  }, {
    id: "labels",
    filename: "labels.ts",
    language: "typescript",
    source: `export function label(value: string): string { return value }
`
  }]
})

const artifacts = generateProgramArtifactSet({language: "java", program})
```

The returned `SemanticProgram` contains dependency-first `modules`, the selected `entryModule`, and the complete caller-order source registry. Each program module has its logical `id`, `sourceFilename`, stable module-qualified declaration IDs such as `labels#function:0`, explicit resolved `imports` and `exports`, and an entry point only when selected. Identity rebasing changes only declaration/reference identity fields; equal literal, name, and filename strings remain source data. Imports retain the remote declaration identity separately from their source-local binding name. Record types, calls, and member reads continue to resolve by semantic declaration identity. Import/export nodes and generated artifacts retain filename-bearing rich and Source Map v3 provenance; aliased ESM exported names map to the exact `SemanticExport` `exportedName` token.

Source-profile qualifiers such as Ruby `Labels.label` or Java `Labels.label` remain source spelling and provenance, not target bindings. When emitting an unqualified-import target, generation chooses the imported declaration name by identity; genuine ESM/PHP local aliases remain explicit bindings and are preserved where the target can represent them.

`generateProgramArtifactSet` validates the complete graph, dense non-empty selected entry body, source-owned canonical module/header/node locations, declaration visibility, and every target layout before it allocates a writer. It returns the existing immutable `GeneratedArtifactSet` envelope in deterministic dependency order with exactly one entry artifact and never writes files. JavaScript and TypeScript include a synthetic `package.json` declaring ESM, followed by one `.js` or `.ts` artifact per semantic module. Ruby emits one `.rb` file per module with literal `require_relative`, one module wrapper, the canonical module-function profile, and explicit private method/constant markers for unexported declarations. PHP emits one `.php` file per namespace with explicit `use`/`use function` bindings and matching literal `require_once __DIR__` edges; because top-level namespace declarations have no module-private visibility, a module containing an unexported declaration is rejected. Java emits package-directory `.java` files with a selected public `Main`, public exported classes/methods, package-private unexported record classes, and private-static unexported functions.

The accepted source profiles are deliberately narrow:

- JavaScript and TypeScript use relative named ESM imports/exports. Type-only imports may name records only in semantic type positions; a declaration available only through type-only imports cannot be constructed, while a separate value import remains valid for construction. Type-only exports are explicitly outside this profile. Default, star, dynamic, side-effect-only, bare-package, attributed and CommonJS forms, re-exports, namespaces, ambient modules, export assignment, and path aliases are rejected.
- Ruby uses literal `require_relative`, exactly one simple module, explicit qualified record/function references, and `module_function`; generated exact `private_class_method`/`private_constant` markers preserve unexported declarations on reparse. Gems, load paths, dynamic require, autoload, mixins, cross-file module reopening, and top-level constant fallback are rejected.
- PHP uses one unbracketed namespace, explicit ungrouped class/function imports, and literal `require_once __DIR__` paths. Include paths, Composer/autoload, dynamic or other include/require forms, grouped uses, namespace fallback, and multiple namespace blocks are rejected.
- Java uses one package, direct non-static non-wildcard imports, and one matching final class/file; exported/entry classes are public while an unexported record class may be package-private. Duplicate fully qualified native class identities are rejected before import resolution. JPMS, classpath discovery, unnamed-package mixing, split or mismatched packages, annotations, and multiple public classes are rejected.

Module IDs, export names, import bindings, visibility and kinds must be unique and resolved. Exactly one supplied module is selected as a non-empty entry. All dependency cycles are rejected. Target-reserved module/declaration names, case-folded PHP collisions, unsafe or colliding paths, and unavailable Java public-file layouts fail with a located diagnostic. ESM export aliases, including aliases beside a same-name direct export, are preserved by JavaScript/TypeScript; targets without an equivalent public alias reject them instead of changing behavior.

This API never reads source files, searches load paths/classpaths, resolves packages or networks, invokes a package manager, writes output, flattens modules, or returns a partial artifact set. Package/provider and standard-library work remains outside Task 010. Existing `parse`, `generate`, `generateArtifact`, and single-module `generateArtifactSet` behavior is unchanged; callers opt into projects only by using the two new APIs.
