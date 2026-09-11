// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram, SemantifoldDiagnostic} from "../index.js"

describe("multi-file backend diagnostics", () => {
  it("rejects unsupported target profiles and unavailable Java public-file layouts before generation", () => {
    const program = parseProgram({
      entryModule: "a",
      sources: [{
        filename: "a.ts",
        id: "a",
        language: "typescript",
        source: "console.log(1)\n"
      }, {
        filename: "a/b.ts",
        id: "a.b",
        language: "typescript",
        source: "export function value(): number { return 1 }\n"
      }]
    })

    assert.throws(
      () => generateProgramArtifactSet({language: /** @type {"python"} */ ("python"), program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "python"
    )
    assert.throws(
      () => generateProgramArtifactSet({language: /** @type {"python"} */ ("missing"), program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" && error.language == "missing"
    )

    const unavailable = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `export class User { constructor(readonly name: string) {} }
export function label(user: User): string { return user.name }
console.log(label(new User("Ada")))
`
      }]
    })

    assert.throws(
      () => generateProgramArtifactSet({language: "java", program: unavailable}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "java" && error.detail.includes("multiple public declarations") && error.location?.filename == "main.ts"
    )
  })

  it("rejects target-normalized export collisions at their declarations", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `export function label(): number { return 1 }
export function Label(): number { return 2 }
console.log(label())
`
      }]
    })

    assert.throws(
      () => generateProgramArtifactSet({language: "php", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "php" && error.detail.includes("colliding target export 'Label'") && error.location?.filename == "main.ts"
    )

    const malformedName = structuredClone(program)

    malformedName.modules[0].exports[0].exportedName = "bad-name"
    assert.throws(
      () => generateProgramArtifactSet({language: "javascript", program: malformedName}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "javascript" && error.detail.includes("export identifier 'bad-name'")
    )
  })

  it("rejects ESM export aliases on target profiles without an equivalent public binding", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {display} from \"./library.js\"\nconsole.log(display())\n"
      }, {
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: "function label(): string { return \"Ada\" }\nexport {label as display}\n"
      }]
    })

    for (const language of ["php", "ruby", "java"]) {
      assert.throws(
        () => generateProgramArtifactSet({
          language: /** @type {"php" | "ruby" | "java"} */ (language),
          program
        }),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.detail.includes("export alias 'display'") && error.location?.filename == "library.ts"
      )
    }
  })

  it("rejects reserved generated module and package identifiers", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {value} from \"./class.js\"\nconsole.log(value())\n"
      }, {
        filename: "class.ts",
        id: "class",
        language: "typescript",
        source: "export function value(): number { return 1 }\n"
      }]
    })

    for (const language of ["php", "ruby", "java"]) {
      assert.throws(
        () => generateProgramArtifactSet({
          language: /** @type {"php" | "ruby" | "java"} */ (language),
          program
        }),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.detail.includes("identifier") && error.location?.filename == "class.ts"
      )
    }
  })

  it("rejects distinct logical modules that collapse to one target module name", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import {one} from "./a_b.js"
import {two} from "./a/b.js"
console.log(one() + two())
`
      }, {
        filename: "a_b.ts",
        id: "a_b",
        language: "typescript",
        source: "export function one(): number { return 1 }\n"
      }, {
        filename: "a/b.ts",
        id: "a.b",
        language: "typescript",
        source: "export function two(): number { return 2 }\n"
      }]
    })

    for (const language of ["php", "ruby"]) {
      assert.throws(
        () => generateProgramArtifactSet({language: /** @type {"php" | "ruby"} */ (language), program}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.detail.includes("target module-name collision")
      )
    }
  })

  it("rejects Java import sets with colliding public class names", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import {User as FirstUser} from "./first.js"
import {User as SecondUser} from "./second.js"
console.log(1)
`
      }, {
        filename: "first.ts",
        id: "first",
        language: "typescript",
        source: "export class User { constructor(readonly name: string) {} }\n"
      }, {
        filename: "second.ts",
        id: "second",
        language: "typescript",
        source: "export class User { constructor(readonly name: string) {} }\n"
      }]
    })

    assert.throws(
      () => generateProgramArtifactSet({language: "java", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "java" && error.detail.includes("target import-class collision 'User'")
    )
  })

  it("rejects Ruby dependency modules shadowed by a local record constant", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import {value} from "./library.js"
class Library { constructor(readonly name: string) {} }
console.log(value())
`
      }, {
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: "export function value(): number { return 1 }\n"
      }]
    })

    assert.throws(
      () => generateProgramArtifactSet({language: "ruby", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "ruby" && error.detail.includes("target import-module collision 'Library'")
    )
  })

  it("normalizes malformed caller-authored program members to a backend diagnostic", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript", source: "console.log(1)\n"}]
    })
    const malformed = structuredClone(program)

    malformed.modules[0].imports = /** @type {never} */ ([null])
    assert.throws(
      () => generateProgramArtifactSet({language: "typescript", program: malformed}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "typescript" && error.location?.filename == "main.ts"
    )

    const unknownSource = structuredClone(program)

    unknownSource.modules[0].sourceFilename = "missing.ts"
    assert.throws(
      () => generateProgramArtifactSet({language: "typescript", program: unknownSource}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "typescript" && error.detail.includes("source identity")
    )

    const malformedEntry = structuredClone(program)

    malformedEntry.modules[0].entryPoint.body = /** @type {never} */ (null)
    assert.throws(
      () => generateProgramArtifactSet({language: "typescript", program: malformedEntry}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "typescript" && error.detail.includes("block")
    )
  })

  it("rejects caller-authored import aliases that collide with local target declarations", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: "export function value(): number { return 1 }\n"
      }, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import {value} from "./library.js"
function local(): number { return 2 }
console.log(value())
`
      }]
    })
    const colliding = structuredClone(program)

    colliding.modules[1].imports[0].localName = "local"
    assert.throws(
      () => generateProgramArtifactSet({language: "typescript", program: colliding}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "typescript" && error.detail.includes("target import-name collision 'local'")
    )
  })

  it("rejects caller-authored import and export kind drift before target validation", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: "export function value(): number { return 1 }\n"
      }, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {value} from \"./library.js\"\nconsole.log(value())\n"
      }]
    })
    const importDrift = structuredClone(program)
    const exportDrift = structuredClone(program)

    importDrift.modules[1].imports[0].symbolKind = "record"
    exportDrift.modules[0].exports[0].symbolKind = "record"
    for (const drifted of [importDrift, exportDrift]) {
      assert.throws(
        () => generateProgramArtifactSet({language: "typescript", program: drifted}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "typescript" && error.detail.includes("declaration kind")
      )
    }
  })
})
