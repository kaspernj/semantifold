// @ts-check

import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const languages = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = {java: "Main.java", javascript: "program.js", php: "program.php", ruby: "program.rb", typescript: "program.ts"}
const parseFailures = {
  java: "public final class Main { private static int broken( {",
  javascript: "function broken( {",
  php: "<?php\ndeclare(strict_types=1);\nfunction broken( {",
  ruby: "def broken(\n",
  typescript: "function broken( {"
}
const unsupportedForms = {
  java: `public final class Main {
  private static int identity(int value) { return Math.abs(value); }
  public static void main(String[] args) { System.out.println(identity(1)); }
}
`,
  javascript: `/**
 * @param {number} value
 * @returns {number}
 */
async function identity(value) { return value }
console.log(identity(1))
`,
  php: `<?php
declare(strict_types=1);
function same(int $left, int $right): bool { return $left == $right; }
echo same(1, 1), PHP_EOL;
`,
  ruby: `# @param value [Integer]
# @return [Integer]
def identity(value = 1)
  return value
end
puts identity(1)
`,
  typescript: `function identity(value: number): number { return value }
const values: ReadonlyMap<string, number> = new Map([["a", 1]])
for (const value of values) { console.log(value) }
`
}
const unsupportedFormCodes = {java: "UNSUPPORTED_SYNTAX", javascript: "UNSUPPORTED_SYNTAX", php: "UNSUPPORTED_SYNTAX", ruby: "UNSUPPORTED_SYNTAX", typescript: "TYPE_MISMATCH"}
const missingTypes = {
  java: `public final class Main {
  private static void visit(java.util.List<Integer> values) {
    for (Integer value : missing) {}
  }
  public static void main(String[] args) {}
}
`,
  javascript: `/**
 * @param {string} fallback
 * @returns {string}
 */
function choose(fallback) { let value = fallback; return value }
console.log(choose("safe"))
`,
  php: `<?php
declare(strict_types=1);
function choose(string $fallback): string { $value = $fallback; return $value; }
echo choose("safe"), PHP_EOL;
`,
  ruby: `# @param fallback [String]
# @return [String]
def choose(fallback)
  value = fallback
  return value
end
puts choose("safe")
`,
  typescript: `function choose(fallback: string): string { let value = fallback; return value }
console.log(choose("safe"))
`
}
const semanticPrograms = {
  java: {
    flow: `public final class Main {
  private static int choose(boolean flag) { if (flag) { return 1; } }
  public static void main(String[] args) { System.out.println(choose(true)); }
}
`,
    resolution: `public final class Main {
  private static int zero() { return 0; }
  public static void main(String[] args) { System.out.println(missing()); }
}
`,
    type: `public final class Main {
  private static String identity(String value) { return value; }
  public static void main(String[] args) { System.out.println(identity(1)); }
}
`
  },
  javascript: {
    flow: `/**
 * @param {boolean} flag
 * @returns {number}
 */
function choose(flag) { if (flag) { return 1 } }
console.log(choose(true))
`,
    resolution: `/** @returns {number} */ function zero() { return 0 }
console.log(missing())
`,
    type: `/**
 * @param {string} value
 * @returns {string}
 */
function identity(value) { return value }
console.log(identity(1))
`
  },
  php: {
    flow: `<?php
declare(strict_types=1);
function choose(bool $flag): int { if ($flag) { return 1; } }
echo choose(true), PHP_EOL;
`,
    resolution: `<?php
declare(strict_types=1);
function zero(): int { return 0; }
echo missing(), PHP_EOL;
`,
    type: `<?php
declare(strict_types=1);
function identity(string $value): string { return $value; }
echo identity(1), PHP_EOL;
`
  },
  ruby: {
    flow: `# @param flag [bool]
# @return [Integer]
def choose(flag)
  if flag
    return 1
  end
end
puts choose(true)
`,
    resolution: `# @return [Integer]
def zero()
  return 0
end
puts missing()
`,
    type: `# @param value [String]
# @return [String]
def identity(value)
  return value
end
puts identity(1)
`
  },
  typescript: {
    flow: `function choose(flag: boolean): number { if (flag) { return 1 } }
console.log(choose(true))
`,
    resolution: `function zero(): number { return 0 }
console.log(missing())
`,
    type: `function identity(value: string): string { return value }
console.log(identity(1))
`
  }
}
const phaseBoundaryCases = [
  {
    code: "TYPE_MISMATCH", filename: "ruby-map-iteration.rb", language: "ruby",
    source: `# @return [Integer]
def zero()
  return 0
end
# @type [Hash[String,Integer]]
# @semantifold-immutable
values = {"a" => 1}
values.each do |value|
  puts value
end
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "javascript-undefined.js", language: "javascript",
    source: `/** @returns {string|null} */ function missing() { return undefined }
console.log("safe")
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "javascript-loose-equality.js", language: "javascript",
    source: `/**
 * @param {number} value
 * @returns {boolean}
 */
function same(value) { return value == 1 }
console.log(same(1))
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "typescript-wide-union.ts", language: "typescript",
    source: `function label(value: string | number | null): string { return "safe" }
console.log(label("safe"))
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "typescript-assertion.ts", language: "typescript",
    source: `function identity(value: number): number { return value }
console.log(identity(1 as number))
`
  },
  {
    code: "INVALID_MAP_KEY", filename: "php-key.php", language: "php",
    source: `<?php
declare(strict_types=1);
function zero(): int { return 0; }
/** @var array<string,int> $values */
$values = ["1" => 1];
echo zero(), PHP_EOL;
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "php-named-call.php", language: "php",
    source: `<?php
declare(strict_types=1);
function identity(int $value): int { return $value; }
echo identity(value: 1), PHP_EOL;
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "java-null.java", language: "java",
    source: `public final class Main {
  private static String missing() { return null; }
  public static void main(String[] args) { System.out.println(missing()); }
}
`
  },
  {
    code: "UNSUPPORTED_SYNTAX", filename: "java-basic-for.java", language: "java",
    source: `public final class Main {
  private static int zero() { return 0; }
  public static void main(String[] args) { for (int index = 0; index < 1; index = index + 1) {} }
}
`
  }
]

describe("Task 013 five-language compatibility diagnostics", () => {
  it("reports every required diagnostic class for every original language with useful stable context", () => {
    for (const language of languages) {
      expectDiagnostic({code: "PARSE_ERROR", filename: `parse-failure.${extension(language)}`, language, source: parseFailures[language]})
      expectDiagnostic({code: unsupportedFormCodes[language], filename: `unsupported.${extension(language)}`, language, source: unsupportedForms[language]})
      expectDiagnostic({code: "MISSING_TYPE", filename: `missing-type.${extension(language)}`, language, source: missingTypes[language]})
      expectDiagnostic({code: "UNRESOLVED_BINDING", filename: `resolution.${extension(language)}`, language, source: semanticPrograms[language].resolution})
      expectDiagnostic({code: "TYPE_MISMATCH", filename: `type.${extension(language)}`, language, source: semanticPrograms[language].type})
      expectDiagnostic({code: "MISSING_RETURN", filename: `flow.${extension(language)}`, language, source: semanticPrograms[language].flow})
    }
  })

  it("keeps representative interaction-sensitive Phase 0/1 shortcuts outside the IR", () => {
    for (const rejection of phaseBoundaryCases) expectDiagnostic(rejection)
    expect(phaseBoundaryCases.map(({language}) => language).sort())
      .toEqual(["java", "java", "javascript", "javascript", "php", "php", "ruby", "typescript", "typescript"])
  })

  it("rejects malformed external IR transactionally through every generation API for every target", () => {
    const generators = [generate, generateArtifact, generateArtifactSet]

    for (const language of languages) {
      for (const generator of generators) {
        const filename = filenames[language]
        const source = readFileSync(new URL(`fixtures/compatibility/${filename}`, import.meta.url), "utf8")
        const module = parse({filename, language, source})
        const print = module.entryPoint.body.statements.find((statement) => statement.kind == "PrintStatement")

        assert.ok(print?.kind == "PrintStatement")
        Reflect.set(print.expression, "kind", "UnsupportedExpression")
        assert.throws(() => generator({language, module}), (error) => {
          assert.ok(error instanceof SemantifoldDiagnostic)
          expect({code: error.code, filename: error.location?.filename, language: error.language})
            .toEqual({code: "UNSUPPORTED_CAPABILITY", filename, language})
          assertUsefulLocation(error)
          return true
        })
      }
    }
  })

  it("preflights target names, Java integer range, and PHP key rules before emission", () => {
    for (const language of languages) {
      const module = parse({
        filename: `reserved-${language}.ts`, language: "typescript",
        source: "function safe(): number { return 1 }\nconsole.log(safe())\n"
      })
      const reserved = {java: "class", javascript: "class", php: "class", ruby: "BEGIN", typescript: "class"}[language]

      module.functions[0].name = reserved
      expectCapability(() => generate({language, module}), language, `reserved-${language}.ts`)
    }

    const javaRange = parse({
      filename: "java-range.ts", language: "typescript",
      source: "function safe(): number { return 1 }\nconsole.log(2147483648)\n"
    })

    expectCapability(() => generate({language: "java", module: javaRange}), "java", "java-range.ts")

    const phpKey = parse({
      filename: "php-key.ts", language: "typescript",
      source: "function safe(): number { return 1 }\nconst values: ReadonlyMap<string, number> = new Map([[\"safe\", 1]])\nconsole.log(safe())\n"
    })
    const map = /** @type {import("../src/semantic/types.js").MapLiteral} */ (
      /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (phpKey.entryPoint.body.statements[0]).initializer
    )

    map.entries[0].key.value = "1"
    expectCapability(() => generate({language: "php", module: phpKey}), "php", "php-key.ts")
  })
})

/** @param {{code: string, filename: string, language: string, source: string}} input */
function expectDiagnostic(input) {
  assert.throws(() => parse(input), (error) => {
    assert.ok(error instanceof SemantifoldDiagnostic)
    expect({code: error.code, filename: error.location?.filename, language: error.language})
      .toEqual({code: input.code, filename: input.filename, language: input.language})
    assertUsefulLocation(error)
    return true
  })
}

/** @param {() => unknown} action @param {string} language @param {string} filename */
function expectCapability(action, language, filename) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof SemantifoldDiagnostic)
    expect({code: error.code, filename: error.location?.filename, language: error.language})
      .toEqual({code: "UNSUPPORTED_CAPABILITY", filename, language})
    assertUsefulLocation(error)
    return true
  })
}

/** @param {SemantifoldDiagnostic} error */
function assertUsefulLocation(error) {
  assert.ok(error.location)
  assert.ok(error.location.start.line >= 1)
  assert.ok(error.location.start.column >= 1)
  assert.ok(error.location.start.offset >= 0)
  assert.ok(error.location.end.offset >= error.location.start.offset)
}

/** @param {string} language */
function extension(language) {
  return {java: "java", javascript: "js", php: "php", ruby: "rb", typescript: "ts"}[language]
}
