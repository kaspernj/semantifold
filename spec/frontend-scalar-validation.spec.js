// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

/**
 * Asserts one source-located scalar frontend diagnostic.
 * @param {{code: string, detail?: string, filename: string, language: import("../src/semantic/types.js").SemanticLanguage, line: number, source: string}} input - Diagnostic expectation.
 * @returns {void}
 */
function assertDiagnostic({code, detail, filename, language, line, source}) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => {
      assert.ok(error instanceof SemantifoldDiagnostic)
      assert.equal(error.code, code)
      assert.equal(error.language, language)
      assert.equal(error.location?.filename, filename)
      assert.equal(error.location?.start.line, line)
      if (detail) assert.ok(error.message.includes(detail))

      return true
    }
  )
}

describe("scalar frontend validation", () => {
  it("rejects boxed, inferred, literal-only, broad, and union annotations", () => {
    const types = ["Boolean", "String", "Flag", "any", "unknown", "true", "boolean | string"]

    for (const type of types) {
      const source = `function label(flag: ${type}, fallback: string): string {
  if (flag) return "yes"
  else return fallback
}
console.log(label(true, "no"))
`

      assertDiagnostic({
        code: "UNSUPPORTED_SYNTAX",
        detail: "unsupported scalar type",
        filename: "boxed.ts",
        language: "typescript",
        line: 1,
        source
      })
    }

    assertDiagnostic({
      code: "MISSING_TYPE",
      filename: "inferred.ts",
      language: "typescript",
      line: 1,
      source: `function label(flag, fallback: string): string {
  if (flag) return "yes"
  else return fallback
}
console.log(label(true, "no"))
`
    })

    for (const type of ["Boolean", "String"]) {
      assertDiagnostic({
        code: "MISSING_TYPE",
        filename: "boxed.js",
        language: "javascript",
        line: 7,
        source: `/**
 * Selects a string.
 * @param {${type}} flag - Selection flag.
 * @param {string} fallback - Fallback string.
 * @returns {string} Selected string.
 */
function label(flag, fallback) {
  if (flag) return "yes"
  else return fallback
}
console.log(label(true, "no"))
`
      })
    }
  })

  it("rejects source interpolation with a stable diagnostic detail", () => {
    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "interpolated string",
      filename: "interpolation.js",
      language: "javascript",
      line: 8,
      source: `/**
 * Selects a string.
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback string.
 * @returns {string} Selected string.
 */
function label(flag, fallback) {
  if (flag) return \`yes \${fallback}\`
  else return fallback
}
console.log(label(true, "no"))
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "interpolated string",
      filename: "interpolation.rb",
      language: "ruby",
      line: 6,
      source: `# @param flag [bool]
# @param fallback [String]
# @return [String]
def label(flag, fallback)
  if flag
    return "yes #{fallback}"
  else
    return fallback
  end
end
puts label(true, "no")
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "interpolated string",
      filename: "interpolation.php",
      language: "php",
      line: 5,
      source: `<?php
declare(strict_types=1);
function label(bool $flag, string $fallback): string {
  if ($flag) {
    return "yes $fallback";
  } else {
    return $fallback;
  }
}
echo label(true, 'no'), PHP_EOL;
`
    })
  })

  it("rejects language-specific excluded scalar forms", () => {
    assertDiagnostic({
      code: "MISSING_TYPE",
      filename: "boolish.rb",
      language: "ruby",
      line: 4,
      source: `# @param flag [boolish]
# @param fallback [String]
# @return [String]
def label(flag, fallback)
  if flag
    return "yes"
  else
    return fallback
  end
end
puts label(true, "no")
`
    })

    assertDiagnostic({
      code: "MISSING_TYPE",
      filename: "boolean.php",
      language: "php",
      line: 3,
      source: `<?php
declare(strict_types=1);
function label(boolean $flag, string $fallback): string {
  if ($flag) return 'yes';
  else return $fallback;
}
echo label(true, 'no'), PHP_EOL;
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "unsupported scalar type",
      filename: "Main.java",
      language: "java",
      line: 2,
      source: `public final class Main {
  private static String label(Boolean flag, String fallback) {
    if (flag) return "yes";
    else return fallback;
  }
  public static void main(String[] args) {
    System.out.println(label(true, "no"));
  }
}
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "unsupported scalar type",
      filename: "nullable.php",
      language: "php",
      line: 3,
      source: `<?php
declare(strict_types=1);
function label(?bool $flag, string $fallback): string {
  if ($flag) return 'yes';
  else return $fallback;
}
echo label(true, 'no'), PHP_EOL;
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "unsupported scalar type",
      filename: "Main.java",
      language: "java",
      line: 2,
      source: `public final class Main {
  private static String label(char flag, String fallback) {
    if (true) return "yes";
    else return fallback;
  }
  public static void main(String[] args) {
    System.out.println(label('y', "no"));
  }
}
`
    })
  })

  it("rejects excluded literals and invalid Unicode scalar data", () => {
    const javascriptLiterals = ["1.5", "1n", "/yes/u", "Symbol(\"yes\")"]

    for (const literal of javascriptLiterals) {
      const source = `/**
 * Selects a string.
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback string.
 * @returns {string} Selected string.
 */
function label(flag, fallback) {
  if (flag) return ${literal}
  else return fallback
}
console.log(label(true, "no"))
`

      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", filename: "literal.js", language: "javascript", line: 8, source})
    }

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "invalid Unicode string literal",
      filename: "surrogate.js",
      language: "javascript",
      line: 8,
      source: `/**
 * Selects a string.
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback string.
 * @returns {string} Selected string.
 */
function label(flag, fallback) {
  if (flag) return "\\uD800"
  else return fallback
}
console.log(label(true, "no"))
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      filename: "null.ts",
      language: "typescript",
      line: 2,
      source: `function label(flag: boolean, fallback: string): string {
  if (flag) return null
  else return fallback
}
console.log(label(true, "no"))
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      filename: "symbol.rb",
      language: "ruby",
      line: 6,
      source: `# @param flag [bool]
# @param fallback [String]
# @return [String]
def label(flag, fallback)
  if flag
    return :yes
  else
    return fallback
  end
end
puts label(true, "no")
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      detail: "invalid Unicode string literal",
      filename: "encoding.rb",
      language: "ruby",
      line: 7,
      source: `# encoding: utf-8
# @param flag [bool]
# @param fallback [String]
# @return [String]
def label(flag, fallback)
  if flag
    return "\\xFF"
  else
    return fallback
  end
end
puts label(true, "no")
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      filename: "Main.java",
      language: "java",
      line: 4,
      source: `public final class Main {
  private static String label(boolean flag, String fallback) {
    if (flag) {
      return null;
    } else {
      return fallback;
    }
  }
  public static void main(String[] args) {
    System.out.println(label(true, "no"));
  }
}
`
    })

    for (const [filename, opening] of [["heredoc.php", "<<<TEXT"], ["nowdoc.php", "<<<'TEXT'"]]) {
      const source = `<?php
declare(strict_types=1);
function label(bool $flag, string $fallback): string {
  if ($flag) {
    return ${opening}
yes
TEXT;
  } else {
    return $fallback;
  }
}
echo label(true, 'no'), PHP_EOL;
`

      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", filename, language: "php", line: 5, source})
    }

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      filename: "Main.java",
      language: "java",
      line: 4,
      source: `public final class Main {
  private static String label(boolean flag, String fallback) {
    if (flag) {
      return """
        yes
        """;
    } else {
      return fallback;
    }
  }
  public static void main(String[] args) {
    System.out.println(label(true, "no"));
  }
}
`
    })
  })

  it("enforces strict semantic condition, return, and call argument types", () => {
    const cases = [
      ["condition.ts", "  if (fallback) return \"yes\"", 2],
      ["return.ts", "  if (flag) return true", 2],
      ["argument.ts", "  if (flag) return \"yes\"", 5],
      ["operator.ts", "  if (flag) return \"yes\" + fallback", 2]
    ]

    for (const [filename, branch, line] of cases) {
      const call = filename == "argument.ts" ? "console.log(label(\"true\", \"no\"))" : "console.log(label(true, \"no\"))"
      const source = `function label(flag: boolean, fallback: string): string {
${branch}
  else return fallback
}
${call}
`

      assertDiagnostic({code: "UNSUPPORTED_SYNTAX", filename, language: "typescript", line, source})
    }

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      filename: "identifier.ts",
      language: "typescript",
      line: 2,
      source: `function label(flag: boolean, fallback: string): string {
  if (missing) return "yes"
  else return fallback
}
console.log(label(true, "no"))
`
    })

    assertDiagnostic({
      code: "UNSUPPORTED_SYNTAX",
      filename: "callee.ts",
      language: "typescript",
      line: 5,
      source: `function label(flag: boolean, fallback: string): string {
  if (flag) return "yes"
  else return fallback
}
console.log(other(true, "no"))
`
    })
  })
})
