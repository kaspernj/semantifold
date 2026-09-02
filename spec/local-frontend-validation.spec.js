// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

/**
 * Asserts one frontend diagnostic.
 * @param {object} input - Expected diagnostic.
 * @param {string} input.code - Diagnostic code.
 * @param {string} [input.detail] - Message fragment.
 * @param {string} input.filename - Source filename.
 * @param {import("../src/semantic/types.js").SemanticLanguage} input.language - Source language.
 * @param {string} input.source - Source text.
 * @returns {void}
 */
function assertDiagnostic({code, detail, filename, language, source}) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => {
      assert.ok(error instanceof SemantifoldDiagnostic)
      assert.equal(error.code, code)
      assert.equal(error.language, language)
      assert.equal(error.location?.filename, filename)
      if (detail) assert.ok(error.message.includes(detail), error.message)

      return true
    }
  )
}

/** @param {string} statement - Function-prefix statement. @returns {string} JavaScript source. */
function javascriptProgram(statement) {
  return `/**
 * @param {boolean} flag - Flag.
 * @param {string} fallback - Fallback.
 * @returns {string} Result.
 */
function select(flag, fallback) {
  ${statement}
  if (flag) return fallback
  else return fallback
}
console.log(select(true, "no"))
`
}

/** @param {string} statement - Function-prefix statement. @returns {string} TypeScript source. */
function typescriptProgram(statement) {
  return `function select(flag: boolean, fallback: string): string {
  ${statement}
  if (flag) return fallback
  else return fallback
}
console.log(select(true, "no"))
`
}

/** @param {string} statement - Function-prefix statement. @returns {string} Ruby source. */
function rubyProgram(statement) {
  return `# @param flag [bool]
# @param fallback [String]
# @return [String]
def select(flag, fallback)
  ${statement}
  if flag
    return fallback
  else
    return fallback
  end
end
puts select(true, "no")
`
}

/** @param {string} statement - Function-prefix statement. @returns {string} PHP source. */
function phpProgram(statement) {
  return `<?php
declare(strict_types=1);
function select(bool $flag, string $fallback): string {
  ${statement}
  if ($flag) {
    return $fallback;
  } else {
    return $fallback;
  }
}
echo select(true, "no"), PHP_EOL;
`
}

/** @param {string} statement - Function-prefix statement. @returns {string} Java source. */
function javaProgram(statement) {
  return `public final class Main {
  private static String select(boolean flag, String fallback) {
    ${statement}
    if (flag) {
      return fallback;
    } else {
      return fallback;
    }
  }
  public static void main(String[] args) {
    System.out.println(select(true, "no"));
  }
}
`
}

describe("local declaration frontend validation", () => {
  it("enforces JavaScript JSDoc, declaration shape, and plain standalone assignment", () => {
    const cases = [
      ["MISSING_TYPE", undefined, "let value = fallback"],
      ["MISSING_TYPE", undefined, "/** @type {String} */\n  let value = fallback"],
      ["UNSUPPORTED_SYNTAX", "var declaration", "/** @type {string} */\n  var value = fallback"],
      ["UNSUPPORTED_SYNTAX", "uninitialized declaration", "/** @type {string} */\n  let value"],
      ["UNSUPPORTED_SYNTAX", "let declaration", "/** @type {string} */\n  let first = fallback, second = fallback"],
      ["UNSUPPORTED_SYNTAX", "ArrayPattern", "/** @type {string} */\n  let [value] = [fallback]"],
      ["UNSUPPORTED_SYNTAX", "assignment +=", "/** @type {string} */\n  let value = fallback\n  value += fallback"],
      ["UNSUPPORTED_SYNTAX", "ExpressionStatement", "/** @type {string} */\n  let value = fallback\n  value++"],
      ["UNRESOLVED_BINDING", undefined, "value = fallback"]
    ]

    for (const [code, detail, statement] of cases) {
      assertDiagnostic({code, detail, filename: "locals.js", language: "javascript", source: javascriptProgram(statement)})
    }
  })

  it("enforces TypeScript explicit declarations and assignment exclusions", () => {
    const cases = [
      ["MISSING_TYPE", undefined, "let value = fallback"],
      ["UNSUPPORTED_SYNTAX", "var declaration", "var value: string = fallback"],
      ["UNSUPPORTED_SYNTAX", "uninitialized declaration", "let value: string"],
      ["UNSUPPORTED_SYNTAX", "uninitialized declaration", "let value!: string"],
      ["UNSUPPORTED_SYNTAX", "let declaration", "let first: string = fallback, second: string = fallback"],
      ["UNSUPPORTED_SYNTAX", "ObjectPattern", "let {value}: {value: string} = {value: fallback}"],
      ["UNSUPPORTED_SYNTAX", "assignment +=", "let value: string = fallback\n  value += fallback"],
      ["UNSUPPORTED_SYNTAX", "ExpressionStatement", "let value: string = fallback\n  value++"]
    ]

    for (const [code, detail, statement] of cases) {
      assertDiagnostic({code, detail, filename: "locals.ts", language: "typescript", source: typescriptProgram(statement)})
    }
  })

  it("enforces Ruby local carriers and rejects non-simple writes", () => {
    const cases = [
      ["MISSING_TYPE", undefined, "value = fallback"],
      ["UNSUPPORTED_SYNTAX", "malformed local type metadata", "# @type [String]\n  # @semantifold-immutable true\n  value = fallback"],
      ["UNSUPPORTED_SYNTAX", "MultiWriteNode", "# @type [String]\n  value, other = fallback, fallback"],
      ["UNSUPPORTED_SYNTAX", "LocalVariableOperatorWriteNode", "# @type [String]\n  value = fallback\n  value += fallback"],
      ["UNSUPPORTED_SYNTAX", "GlobalVariableWriteNode", "# @type [String]\n  $value = fallback"],
      ["PARSE_ERROR", undefined, "# @type [String]\n  Value = fallback"],
      ["IMMUTABLE_ASSIGNMENT", undefined, "# @type [String]\n  # @semantifold-immutable\n  value = fallback\n  value = \"yes\""]
    ]

    for (const [code, detail, statement] of cases) {
      assertDiagnostic({code, detail, filename: "locals.rb", language: "ruby", source: rubyProgram(statement)})
    }
  })

  it("enforces PHP local docblocks and rejects ambiguous assignment forms", () => {
    const cases = [
      ["MISSING_TYPE", undefined, "$value = $fallback;"],
      ["UNSUPPORTED_SYNTAX", "malformed local type metadata", "/** @var string $other */\n  $value = $fallback;"],
      ["UNSUPPORTED_SYNTAX", "dynamic variable", "/** @var string $value */\n  ${$value} = $fallback;"],
      ["UNSUPPORTED_SYNTAX", "list", "/** @var string $value */\n  [$value] = [$fallback];"],
      ["UNSUPPORTED_SYNTAX", "assignref", "/** @var string $value */\n  $value =& $fallback;"],
      ["UNSUPPORTED_SYNTAX", "assignment +=", "/** @var string $value */\n  $value = $fallback;\n  $value += $fallback;"],
      ["UNSUPPORTED_SYNTAX", "global", "global $value;"],
      ["UNSUPPORTED_SYNTAX", "static", "static $value = \"yes\";"],
      ["IMMUTABLE_ASSIGNMENT", undefined, "/**\n   * @var string $value\n   * @semantifold-immutable\n   */\n  $value = $fallback;\n  $value = \"yes\";"]
    ]

    for (const [code, detail, statement] of cases) {
      assertDiagnostic({code, detail, filename: "locals.php", language: "php", source: phpProgram(statement)})
    }
  })

  it("enforces Java explicit single initialized scalar locals and simple assignment", () => {
    const cases = [
      ["UNSUPPORTED_SYNTAX", "var local declaration", "var value = fallback;"],
      ["UNSUPPORTED_SYNTAX", "multiple local declarators", "String first = fallback, second = fallback;"],
      ["UNSUPPORTED_SYNTAX", "uninitialized local declaration", "String value;"],
      ["UNSUPPORTED_SYNTAX", "unsupported local type", "String[] values = {fallback};"],
      ["UNSUPPORTED_SYNTAX", "compound assignment", "String value = fallback;\n    value += fallback;"],
      ["UNSUPPORTED_SYNTAX", "ExpressionStatement", "int value = 1;\n    value++;"],
      ["IMMUTABLE_ASSIGNMENT", undefined, "final String value = fallback;\n    value = \"yes\";"]
    ]

    for (const [code, detail, statement] of cases) {
      assertDiagnostic({code, detail, filename: "Main.java", language: "java", source: javaProgram(statement)})
    }
  })

  it("rejects assignment expressions hidden in conditions in every frontend", () => {
    const cases = [
      ["javascript", "hidden.js", javascriptProgram("/** @type {string} */\n  let value = fallback").replace("if (flag)", "if (flag = true)")],
      ["typescript", "hidden.ts", typescriptProgram("let value: string = fallback").replace("if (flag)", "if (flag = true)")],
      ["ruby", "hidden.rb", rubyProgram("# @type [String]\n  value = fallback").replace("if flag", "if flag = true")],
      ["php", "hidden.php", phpProgram("/** @var string $value */\n  $value = $fallback;").replace("if ($flag)", "if ($flag = true)")],
      ["java", "Main.java", javaProgram("String value = fallback;").replace("if (flag)", "if (flag = true)")]
    ]

    for (const [language, filename, source] of cases) {
      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", filename, language, source})
    }
  })
})
