// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

const targets = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
])

/**
 * Removes source-specific metadata.
 * @param {unknown} value - Semantic value.
 * @returns {unknown} Location-free value.
 */
function withoutLocations(value) {
  return JSON.parse(JSON.stringify(value, (key, child) =>
    key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : child))
}

/**
 * Requires a backend capability failure for every emitter.
 * @param {import("../src/semantic/types.js").SemanticModule} module - Malformed module.
 * @param {string} detail - Expected message fragment.
 * @returns {void}
 */
function expectAllBackendsReject(module, detail) {
  for (const language of targets) {
    assert.throws(() => generate({language, module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && error.language == language && error.message.includes(detail))
  }
}

describe("sequenced block backend validation and generation", () => {
  it("validates malformed block shape and unsupported statements before every emitter", async () => {
    const source = await readFile(new URL("fixtures/statements/program.ts", import.meta.url), "utf8")
    const invalidBlock = structuredClone(parse({filename: "program.ts", language: "typescript", source}))

    Reflect.set(invalidBlock.functions[0], "body", {kind: "Block", location: invalidBlock.functions[0].location})
    expectAllBackendsReject(invalidBlock, "block statements")

    const invalidStatement = structuredClone(parse({filename: "program.ts", language: "typescript", source}))
    const statementLocation = invalidStatement.functions[0].body.statements[0].location

    invalidStatement.functions[0].body.statements[0] = /** @type {never} */ ({kind: "WhileStatement", location: statementLocation})
    expectAllBackendsReject(invalidStatement, "statement WhileStatement")

    const incomplete = structuredClone(parse({filename: "program.ts", language: "typescript", source}))

    incomplete.functions[0].body.statements.pop()
    expectAllBackendsReject(incomplete, "does not return on every reachable path")

    const unreachable = structuredClone(parse({filename: "program.ts", language: "typescript", source}))
    const returned = unreachable.functions[0].body.statements.at(-1)

    assert.ok(returned)
    unreachable.functions[0].body.statements.push(returned)
    expectAllBackendsReject(unreachable, "unreachable")
  })

  it("reparses every generated target to the equivalent nested block model", async () => {
    const source = await readFile(new URL("fixtures/statements/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames.get(language), language, source: generated})

      expect({language, module: withoutLocations(reparsed)}).toEqual({language, module: withoutLocations(module)})
    }
  })

  it("rejects function locals that capture generated print receivers", () => {
    const module = parse({
      filename: "capture.ts",
      language: "typescript",
      source: `function choose(flag: boolean, fallback: string): string {
  let console: string = fallback
  console.log(console)
  return console
}
console.log(choose(true, "safe"))
`
    })

    assert.throws(() => generate({language: "javascript", module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && error.location?.start.line == 2)
    const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[0])

    declaration.name = "System"
    assert.throws(() => generate({language: "java", module}), (error) => error instanceof SemantifoldDiagnostic &&
      error.code == "UNSUPPORTED_CAPABILITY" && error.location?.start.line == 2)
  })

  it("rejects function parameters that capture generated print receivers", () => {
    const source = `function choose(flag: boolean, fallback: string): string {
  console.log(fallback)
  return fallback
}
console.log(choose(true, "safe"))
`

    for (const [language, name] of [["javascript", "console"], ["typescript", "console"], ["java", "System"]]) {
      const module = parse({filename: "parameter-capture.ts", language: "typescript", source})

      module.functions[0].parameters[0].name = name

      assert.throws(() => generate({language, module}), (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_CAPABILITY" && error.language == language &&
        error.location?.filename == "parameter-capture.ts" && error.location.start.line == 1 &&
        error.message.includes(`function parameter '${name}' captures backend scaffolding`), language)
    }
  })

  it("round-trips an empty entry block in every target", () => {
    const module = parse({
      filename: "empty-entry.ts",
      language: "typescript",
      source: "function choose(flag: boolean, fallback: string): string { return fallback }\n"
    })

    expect(module.entryPoint.body.statements).toEqual([])
    for (const language of targets) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames.get(language), language, source: generated})

      expect({language, body: withoutLocations(reparsed.entryPoint.body)})
        .toEqual({language, body: withoutLocations(module.entryPoint.body)})
    }
  })
})
