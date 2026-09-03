// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

/**
 * Removes only source locations from semantic values.
 * @param {import("../src/semantic/types.js").SemanticNode} node - Semantic node.
 * @returns {import("../src/semantic/types.js").SemanticNodeWithoutLocations} Location-free value.
 */
function withoutLocations(node) {
  return JSON.parse(JSON.stringify(node, (key, value) =>
    key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : value))
}

/**
 * Builds one TypeScript program with a caller-provided restricted function prefix.
 * @param {string} prefix - Statements before the terminal conditional.
 * @param {string} [consequentPrefix] - Statements before the consequent return.
 * @param {string} [alternatePrefix] - Statements before the alternate return.
 * @returns {string} TypeScript source.
 */
function typescriptProgram(prefix, consequentPrefix = "", alternatePrefix = "") {
  return `function select(flag: boolean, fallback: string): string {
${prefix}
  if (flag) {
${consequentPrefix}
    return fallback
  } else {
${alternatePrefix}
    return fallback
  }
}
console.log(select(true, "no"))
`
}

/**
 * Asserts one stable semantic diagnostic.
 * @param {object} input - Expected failure.
 * @param {string} input.code - Diagnostic code.
 * @param {number} input.line - One-based source line.
 * @param {string} input.source - Source text.
 * @param {import("../src/semantic/types.js").SemanticLanguage} [input.language] - Source language.
 * @param {string} [input.filename] - Source filename.
 * @returns {void}
 */
function assertSemanticDiagnostic({code, filename = "locals.ts", language = "typescript", line, source}) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.location?.start.line == line
  )
}

describe("local declarations and assignment", () => {
  it("models typed TypeScript locals and simple assignment", async () => {
    const source = await readFile(new URL("fixtures/locals/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const [preferred, result, branch] = module.functions[0].body
    const assignment = /** @type {import("../src/semantic/types.js").IfStatement} */ (branch).consequent[0]

    assert.deepEqual(
      JSON.parse(JSON.stringify([preferred, result, assignment], (key, value) =>
        key == "location" || key == "sourceProvenance" ? undefined : value)),
      [
        {
          initializer: {kind: "StringLiteral", value: "yes"},
          kind: "LocalDeclaration",
          mutable: false,
          name: "preferred",
          type: {kind: "TypeReference", name: "string"}
        },
        {
          initializer: {kind: "IdentifierExpression", name: "fallback"},
          kind: "LocalDeclaration",
          mutable: true,
          name: "result",
          type: {kind: "TypeReference", name: "string"}
        },
        {
          expression: {kind: "IdentifierExpression", name: "preferred"},
          kind: "AssignmentStatement",
          target: {kind: "IdentifierExpression", name: "result"}
        }
      ]
    )
    assert.equal(branch.kind, "IfStatement")
    assert.equal(preferred.location.start.line, 2)
    assert.equal(preferred.initializer.location.start.line, 2)
    assert.equal(assignment.target.location.start.line, 5)
    assert.equal(assignment.expression.location.start.line, 5)
  })

  it("normalizes all five local declaration profiles to equivalent meaning", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/locals/${filename}`, import.meta.url), "utf8")

      modules.push(parse({filename, language, source}))
    }

    for (const module of modules.slice(1)) {
      assert.deepEqual(withoutLocations(module), withoutLocations(modules[0]))
    }
  })

  it("rejects duplicate, shadowed, unresolved, and use-before-declaration bindings", () => {
    assertSemanticDiagnostic({
      code: "DUPLICATE_BINDING",
      filename: "locals.rb",
      language: "ruby",
      line: 8,
      source: `# @param flag [bool]
# @param fallback [String]
# @return [String]
def select(flag, fallback)
  # @type [String]
  value = fallback
  # @type [String]
  value = "yes"
  if flag
    return value
  else
    return fallback
  end
end
puts select(true, "no")
`
    })
    assertSemanticDiagnostic({
      code: "DUPLICATE_BINDING",
      line: 4,
      source: typescriptProgram("  let value: string = fallback", "    const value: string = \"yes\"")
    })
    assertSemanticDiagnostic({
      code: "USE_BEFORE_DECLARATION",
      line: 2,
      source: typescriptProgram("  let value: string = later\n  const later: string = \"yes\"")
    })
    assertSemanticDiagnostic({
      code: "USE_BEFORE_DECLARATION",
      line: 2,
      source: typescriptProgram("  let value: string = value")
    })
    assertSemanticDiagnostic({
      code: "UNRESOLVED_BINDING",
      line: 2,
      source: typescriptProgram("  let value: string = missing")
    })
    assertSemanticDiagnostic({
      code: "UNRESOLVED_BINDING",
      line: 6,
      source: `function select(flag: boolean, fallback: string): string {
  if (flag) {
    const local: string = "yes"
    return local
  } else {
    return local
  }
}
console.log(select(true, "no"))
`
    })
  })

  it("rejects callable names in parameter, local, and entry binding scopes", () => {
    const helper = `function helper(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
`

    assertSemanticDiagnostic({
      code: "DUPLICATE_BINDING",
      line: 5,
      source: `${helper}function select(helper: boolean, fallback: string): string {
  if (helper) return fallback
  else return fallback
}
console.log(select(true, "no"))
`
    })
    assertSemanticDiagnostic({
      code: "DUPLICATE_BINDING",
      line: 6,
      source: `${helper}function select(flag: boolean, fallback: string): string {
  let helper: string = fallback
  if (flag) return helper(true, fallback)
  else return fallback
}
console.log(select(true, "no"))
`
    })
    assertSemanticDiagnostic({
      code: "DUPLICATE_BINDING",
      filename: "callable-entry.php",
      language: "php",
      line: 23,
      source: `<?php
declare(strict_types=1);

function helper(bool $flag, string $fallback): string
{
    if ($flag) {
        return $fallback;
    } else {
        return $fallback;
    }
}

function select(bool $flag, string $fallback): string
{
    if ($flag) {
        return $fallback;
    } else {
        return $fallback;
    }
}

/** @var string $helper */
$helper = "captured";
echo select(true, $helper), PHP_EOL;
`
    })
  })

  it("enforces immutable parameters and locals with exact type preservation", () => {
    assertSemanticDiagnostic({
      code: "IMMUTABLE_ASSIGNMENT",
      line: 2,
      source: typescriptProgram("  flag = true")
    })
    assertSemanticDiagnostic({
      code: "IMMUTABLE_ASSIGNMENT",
      line: 3,
      source: typescriptProgram("  const value: string = fallback\n  value = \"yes\"")
    })
    assertSemanticDiagnostic({
      code: "TYPE_MISMATCH",
      line: 2,
      source: typescriptProgram("  let value: string = true")
    })
    assertSemanticDiagnostic({
      code: "TYPE_MISMATCH",
      line: 3,
      source: typescriptProgram("  let value: string = fallback\n  value = true")
    })
  })

  it("validates assignment right-hand expressions before resolving targets", () => {
    assertSemanticDiagnostic({
      code: "UNRESOLVED_BINDING",
      line: 2,
      source: typescriptProgram("  missing = unknown")
    })
  })
})
