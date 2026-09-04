// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, parse, SemantifoldDiagnostic} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

/**
 * Removes source-specific metadata for semantic equivalence.
 * @param {unknown} value - Semantic value.
 * @returns {unknown} Location-free value.
 */
function withoutLocations(value) {
  return JSON.parse(JSON.stringify(value, (key, child) =>
    key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : child))
}

/**
 * Requires a located frontend diagnostic.
 * @param {() => unknown} callback - Parse operation.
 * @param {string} code - Expected code.
 * @param {number} line - Expected one-based line.
 * @returns {void}
 */
function expectDiagnostic(callback, code, line) {
  assert.throws(callback, (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
    error.location?.start.line == line)
}

describe("statement sequencing and general conditionals", () => {
  it("normalizes ordered located blocks, nested else-if, and optional else across all five frontends", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/statements/${filename}`, import.meta.url), "utf8")

      modules.push(parse({filename, language, source}))
    }

    for (const module of modules) {
      const declaration = module.functions[0]
      const outer = declaration.body.statements[1]

      expect(declaration.body.kind).toEqual("Block")
      expect(module.entryPoint.body.kind).toEqual("Block")
      expect(declaration.body.location.start.line > 0).toEqual(true)
      assert.equal(outer.kind, "IfStatement")
      assert.equal(outer.alternate, undefined)
      assert.equal(outer.consequent.kind, "Block")
      const nested = outer.consequent.statements[2]

      assert.equal(nested.kind, "IfStatement")
      assert.equal(nested.alternate?.statements[0].kind, "IfStatement")
      assert.equal(module.entryPoint.body.statements.length, 5)
    }

    const expected = withoutLocations(modules[0])

    for (const module of modules.slice(1)) expect(withoutLocations(module)).toEqual(expected)
  })

  it("reports non-boolean conditions, missing returns, unreachable statements, and illegal entry returns", () => {
    expectDiagnostic(() => parse({
      filename: "truthy.js",
      language: "javascript",
      source: `/**
 * @param {number} value - Value.
 * @param {number} fallback - Fallback.
 * @returns {number} Value.
 */
function choose(value, fallback) {
  if (value) return value
  return fallback
}
console.log(choose(1, 2))
`
    }), "NON_BOOLEAN_CONDITION", 7)

    expectDiagnostic(() => parse({
      filename: "truthy.php",
      language: "php",
      source: `<?php
function choose(int $value, int $fallback): int {
  if ($value) {
    return $value;
  }
  return $fallback;
}
echo choose(1, 2), PHP_EOL;
`
    }), "NON_BOOLEAN_CONDITION", 3)

    expectDiagnostic(() => parse({
      filename: "truthy.rb",
      language: "ruby",
      source: `# @param value [Integer]
# @param fallback [Integer]
# @return [Integer]
def choose(value, fallback)
  if value
    return value
  end
  return fallback
end
puts choose(1, 2)
`
    }), "NON_BOOLEAN_CONDITION", 5)

    expectDiagnostic(() => parse({
      filename: "missing.ts",
      language: "typescript",
      source: `function choose(flag: boolean, fallback: string): string {
  if (flag) return fallback
}
console.log(choose(true, "no"))
`
    }), "MISSING_RETURN", 1)

    expectDiagnostic(() => parse({
      filename: "unreachable.ts",
      language: "typescript",
      source: `function choose(flag: boolean, fallback: string): string {
  return fallback
  return "never"
}
console.log(choose(true, "no"))
`
    }), "UNREACHABLE_STATEMENT", 3)

    expectDiagnostic(() => parse({
      filename: "entry-return.php",
      language: "php",
      source: `<?php
function choose(bool $flag, string $fallback): string { return $fallback; }
return choose(true, "no");
`
    }), "ILLEGAL_RETURN_CONTEXT", 3)
  })

  it("rejects parser-owned unsupported statements and implicit Ruby returns at their locations", () => {
    const cases = [
      ["javascript", "switch.js", `/**
 * @param {boolean} flag - Flag.
 * @param {string} fallback - Fallback.
 * @returns {string} Value.
 */
function choose(flag, fallback) { switch (flag) { default: return fallback } }
console.log(choose(true, "no"))
`, 6],
      ["typescript", "directive.ts", `function choose(flag: boolean, fallback: string): string {
  "use strict"
  return fallback
}
console.log(choose(true, "no"))
`, 2],
      ["php", "match.php", `<?php
function choose(bool $flag, string $fallback): string { return match ($flag) { true => $fallback, false => $fallback }; }
echo choose(true, "no"), PHP_EOL;
`, 2],
      ["ruby", "implicit.rb", `# @param flag [bool]
# @param fallback [String]
# @return [String]
def choose(flag, fallback)
  fallback
end
puts choose(true, "no")
`, 5],
      ["ruby", "unless.rb", `# @param flag [bool]
# @param fallback [String]
# @return [String]
def choose(flag, fallback)
  unless flag
    return fallback
  end
  return fallback
end
puts choose(true, "no")
`, 5],
      ["ruby", "case.rb", `# @param flag [bool]
# @param fallback [String]
# @return [String]
def choose(flag, fallback)
  case flag
  when true
    return fallback
  end
  return fallback
end
puts choose(true, "no")
`, 5],
      ["ruby", "modifier.rb", `# @param flag [bool]
# @param fallback [String]
# @return [String]
def choose(flag, fallback)
  return fallback if flag
  return fallback
end
puts choose(true, "no")
`, 5],
      ["php", "alternative.php", `<?php
function choose(bool $flag, string $fallback): string {
  if ($flag):
    return $fallback;
  endif;
  return $fallback;
}
echo choose(true, "no"), PHP_EOL;
`, 3],
      ["java", "Main.java", `public final class Main {
  private static String choose(boolean flag, String fallback) {
    class Local {}
    return fallback;
  }
  public static void main(String[] args) { System.out.println(choose(true, "no")); }
}
`, 3]
    ]

    for (const [language, filename, source, line] of cases) {
      expectDiagnostic(() => parse({filename, language, source}), "UNSUPPORTED_SYNTAX", line)
    }
  })

  it("keeps nested declarations lexical and unavailable after their block", () => {
    expectDiagnostic(() => parse({
      filename: "scope.ts",
      language: "typescript",
      source: `function choose(flag: boolean, fallback: string): string {
  if (flag) {
    let nested: string = fallback
    console.log(nested)
  }
  return nested
}
console.log(choose(true, "no"))
`
    }), "UNRESOLVED_BINDING", 6)
  })

  it("maps block and nested statement occurrences in source order", async () => {
    const source = await readFile(new URL("fixtures/statements/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const artifact = generateArtifact({filename: "program.js", language: "javascript", module})
    const paths = artifact.mapping.nodes.map((node) => node.path)

    expect(paths.includes("/functions/0/body")).toEqual(true)
    expect(paths.includes("/functions/0/body/statements/1/consequent/statements/2/alternate/statements/0")).toEqual(true)
    expect(paths.includes("/entryPoint/body/statements/4")).toEqual(true)
    const consequent = artifact.mapping.nodes.find((node) => node.path == "/functions/0/body/statements/1/consequent")

    assert.ok(consequent)
    assert.ok(artifact.mapping.spans.some((span) => span.nodeId == consequent.id))
    for (let index = 1; index < artifact.mapping.spans.length; index++) {
      assert.ok(artifact.mapping.spans[index - 1].generated.end.offset <= artifact.mapping.spans[index].generated.start.offset)
    }
  })
})
