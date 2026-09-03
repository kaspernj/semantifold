// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

const targets = ["php", "ruby", "javascript", "typescript", "java"]

/**
 * Asserts one stable located frontend diagnostic.
 * @param {{code: string, column?: number, detail?: string, filename: string, language: import("../src/semantic/types.js").SemanticLanguage, line: number, source: string}} input - Expected diagnostic.
 * @returns {void}
 */
function assertDiagnostic({code, column, detail, filename, language, line, source}) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.language == language &&
      error.location?.filename == filename && error.location.start.line == line &&
      (column === undefined || error.location.start.column == column) && (!detail || error.message.includes(detail)),
    filename
  )
}

/** @param {string} expression - Returned expression. @returns {string} TypeScript program. */
function typescriptExpression(expression) {
  return `function invalid(left: number, right: number): boolean {
  if (true) return ${expression}
  else return false
}
console.log(invalid(1, 2))
`
}

/** @param {string} expression - Returned expression. @returns {string} JavaScript program. */
function javascriptExpression(expression) {
  return `/**
 * @param {number} left - Left.
 * @param {number} right - Right.
 * @returns {boolean} Result.
 */
function invalid(left, right) {
  if (true) return ${expression}
  else return false
}
console.log(invalid(1, 2))
`
}

/** @param {string} expression - Returned expression. @returns {string} PHP program. */
function phpExpression(expression) {
  return `<?php
declare(strict_types=1);
function invalid(int $left, int $right): bool {
  if (true) {
    return ${expression};
  } else {
    return false;
  }
}
echo invalid(1, 2), PHP_EOL;
`
}

/**
 * @param {string} expression - Returned string expression.
 * @param {string} left - Left call argument.
 * @param {string} right - Right call argument.
 * @returns {string} PHP program.
 */
function phpStringExpression(expression, left, right) {
  return `<?php
declare(strict_types=1);
function combine(string $left, string $right): string {
  if (true) {
    return ${expression};
  } else {
    return $right;
  }
}
echo combine(${left}, ${right}), PHP_EOL;
`
}

/** @param {string} expression - Returned expression. @returns {string} Ruby program. */
function rubyExpression(expression) {
  return `# @param left [Integer]
# @param right [Integer]
# @return [bool]
def invalid(left, right)
  if true
    return ${expression}
  else
    return false
  end
end
puts invalid(1, 2)
`
}

/** @param {string} expression - Returned expression. @returns {string} Java program. */
function javaExpression(expression) {
  return `public final class Main {
  private static boolean invalid(int left, int right) {
    if (true) {
      return ${expression};
    } else {
      return false;
    }
  }
  public static void main(String[] args) {
    System.out.println(invalid(1, 2));
  }
}
`
}

/** @returns {Promise<import("../src/semantic/types.js").SemanticModule>} Fresh operator module. */
async function operatorModule() {
  const source = await readFile(new URL("fixtures/operators/program.ts", import.meta.url), "utf8")

  return parse({filename: "operators.ts", language: "typescript", source})
}

describe("typed operator validation", () => {
  it("rejects every excluded operator family at parser-owned expression locations", () => {
    const cases = [
      ["division.ts", "typescript", typescriptExpression("left / right"), 2, "BinaryExpression"],
      ["remainder.php", "php", phpExpression("$left % $right"), 5, "binary %"],
      ["exponent.rb", "ruby", rubyExpression("left ** right"), 6, "CallNode"],
      ["bitwise.js", "javascript", javascriptExpression("left & right"), 7, "BinaryExpression"],
      ["shift.java", "java", javaExpression("left << right"), 4, "binary <<"],
      ["update.js", "javascript", javascriptExpression("left++"), 7, "UpdateExpression"],
      ["ternary.ts", "typescript", typescriptExpression("left < right ? true : false"), 2, "ConditionalExpression"],
      ["nullish.ts", "typescript", typescriptExpression("left ?? right"), 2, "LogicalExpression"],
      ["spaceship.php", "php", phpExpression("$left <=> $right"), 5, "binary <=>"],
      ["suppression.php", "php", phpExpression("@$left"), 5, "silent"],
      ["regex.rb", "ruby", rubyExpression("left =~ right"), 6, "CallNode"],
      ["range.rb", "ruby", rubyExpression("left..right"), 6, "RangeNode"],
      ["safe-navigation.rb", "ruby", rubyExpression("left&.to_s"), 6, "CallNode"],
      ["operator-cardinality.rb", "ruby", rubyExpression("left.+(right, left)"), 6, "CallNode"],
      ["optional-chain.js", "javascript", javascriptExpression("left?.value"), 7, "OptionalMemberExpression"],
      ["floating.ts", "typescript", typescriptExpression("left < 1.5"), 2, "non-safe integer literal"]
    ]

    for (const [filename, language, source, line, detail] of cases) {
      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail, filename, language, line, source})
    }
  })

  it("rejects loose equality, precedence variants, updates, and compound concatenation", () => {
    const cases = [
      ["loose.js", "javascript", javascriptExpression("left == right"), 7, "coercive equality =="],
      ["loose.php", "php", phpExpression("$left != $right"), 5, "coercive equality !="],
      ["and.rb", "ruby", rubyExpression("left == right").replace("if true", "if left == right and true"), 5, "precedence-sensitive boolean and"],
      ["or.php", "php", phpExpression("$left === $right or true"), 5, "precedence-sensitive boolean or"]
    ]

    for (const [filename, language, source, line, detail] of cases) {
      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail, filename, language, line, source})
    }

    const compound = phpExpression("$left === $right").replace("  if (true)", "  /** @var string $text */\n  $text = \"x\";\n  $text .= \"y\";\n  if (true)")

    assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail: "assignment .=", filename: "concat-assignment.php", language: "php", line: 6, source: compound})
  })

  it("rejects truthiness, mixed equality, object equality, and casts or assertions", () => {
    assertDiagnostic({
      code: "NON_BOOLEAN_CONDITION",
      filename: "truthy.rb",
      language: "ruby",
      line: 5,
      source: rubyExpression("left == right").replace("if true", "if left")
    })

    assertDiagnostic({
      code: "MISMATCHED_EQUALITY_TYPES",
      filename: "mixed-equality.ts",
      language: "typescript",
      line: 2,
      source: typescriptExpression("left === right").replace("right: number", "right: string").replace("invalid(1, 2)", "invalid(1, \"2\")")
    })

    assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail: "ArrayExpression", filename: "collection-equality.ts", language: "typescript", line: 2, source: typescriptExpression("[] === []")})
    assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail: "TSAsExpression", filename: "assertion.ts", language: "typescript", line: 2, source: typescriptExpression("(left as number) === right")})
    assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail: "CastExpression", filename: "cast.java", language: "java", line: 4, source: javaExpression("(int) left < right")})

    assertDiagnostic({code: "INVALID_OPERAND_TYPE", filename: "value-return.js", language: "javascript", line: 7, source: javascriptExpression("left && right")})

    const numericString = phpExpression("$left + $right")
      .replace("int $right", "string $right")
      .replace("invalid(1, 2)", "invalid(1, \"2\")")

    assertDiagnostic({code: "INVALID_OPERAND_TYPE", filename: "numeric-string.php", language: "php", line: 5, source: numericString})
  })

  it("reserves PHP string concatenation for dot instead of arithmetic plus", () => {
    for (const [filename, left, right] of [
      ["numeric-strings.php", '"1"', '"2"'],
      ["ordinary-strings.php", '"left"', '"right"']
    ]) {
      assertDiagnostic({
        code: "UNSUPPORTED_SYNTAX",
        column: 12,
        detail: "binary +",
        filename,
        language: "php",
        line: 5,
        source: phpStringExpression("$left + $right", left, right)
      })
    }

    const module = parse({
      filename: "concat.php",
      language: "php",
      source: phpStringExpression("$left . $right", '"left"', '"right"')
    })
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])
    const expression = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (branch.consequent[0].expression)

    expect({operation: expression.operation, type: expression.type}).toEqual({operation: "StringConcat", type: "string"})
  })

  it("rejects Java reference equality and malformed parser-native equals calls", () => {
    const source = (expression) => `public final class Main {
  private static boolean invalid(String left, String right) {
    if (true) {
      return ${expression};
    } else {
      return false;
    }
  }
  public static void main(String[] args) {
    System.out.println(invalid("a", "b"));
  }
}
`

    for (const expression of ["left == right", "left != right"]) {
      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail: "reference equality", filename: "Main.java", language: "java", line: 4, source: source(expression)})
    }
    for (const expression of ["left.equals()", "left.equals(right, left)"]) {
      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", detail: "string equals invocation", filename: "Main.java", language: "java", line: 4, source: source(expression)})
    }
  })

  it("retains literal operation trees instead of constant folding", () => {
    const module = parse({
      filename: "constants.ts",
      language: "typescript",
      source: `function value(left: number, right: number): number {
  if (true) return 1 + 2 * 3
  else return left
}
console.log(value(0, 0))
`
    })
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])
    const expression = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (branch.consequent[0].expression)

    expect({kind: expression.kind, operation: expression.operation, rightKind: expression.right.kind}).toEqual({
      kind: "BinaryExpression",
      operation: "IntegerAdd",
      rightKind: "BinaryExpression"
    })
  })

  it("rejects unknown operations and malformed operation shapes before every emitter", async () => {
    for (const language of targets) {
      const module = await operatorModule()
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])
      const expression = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (branch.consequent[0].expression)

      Reflect.set(expression, "operation", "IntegerDivide")
      assert.throws(
        () => generate({language, module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == language &&
          error.location?.filename == "operators.ts" && error.location.start.line == 3,
        language
      )
    }

    for (const malformed of ["missing left", "missing result", "wrong result", "missing operand", "transient source intent"]) {
      const module = await operatorModule()
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])
      const expression = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (branch.consequent[0].expression)
      const unary = /** @type {import("../src/semantic/types.js").UnaryExpression} */ (expression.left)

      if (malformed == "missing left") Reflect.deleteProperty(expression, "left")
      else if (malformed == "missing result") Reflect.deleteProperty(expression, "type")
      else if (malformed == "wrong result") Reflect.set(expression, "type", "boolean")
      else if (malformed == "missing operand") Reflect.deleteProperty(unary, "operand")
      else {
        Reflect.deleteProperty(expression, "operation")
        Reflect.set(expression, "operator", "+")
      }

      assert.throws(
        () => generate({language: "java", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.location?.filename == "operators.ts" && error.location.start.line == 3,
        malformed
      )
    }
  })

  it("enforces Java bounds for literals and compile-time-known operation results", async () => {
    const cases = [
      "2147483647 + 1",
      "(-2147483647) - 2",
      "1073741824 * 2",
      "-(-2147483648)"
    ]

    for (const operation of cases) {
      const module = parse({
        filename: "overflow.ts",
        language: "typescript",
        source: `function overflow(left: number, right: number): number {
  if (true) return ${operation}
  else return left
}
console.log(overflow(0, 0))
`
      })

      assert.throws(
        () => generate({language: "java", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.location?.filename == "overflow.ts" && error.message.includes("signed 32-bit int range"),
        operation
      )
    }

    const minimum = parse({
      filename: "minimum.ts",
      language: "typescript",
      source: `function minimum(left: number, right: number): number {
  if (true) return -2147483648
  else return left
}
console.log(minimum(0, 0))
`
    })

    expect(generate({language: "java", module: minimum})).toContain("(-2147483648)")
  })
})
