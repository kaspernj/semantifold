// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

function rejects(language, filename, source, codes = ["UNSUPPORTED_SYNTAX"]) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && codes.includes(error.code) &&
      error.language == language && error.location?.filename == filename
  )
}

const ruby = (body) => `# @param value [String?]
# @return [String]
def label(value)
${body}
end
puts label(nil)
`

const javascript = (body, call = "console.log(label(null))") => `/**
 * @param {string|null} value
 * @returns {string}
 */
function label(value) {
${body}
}
${call}
`

const typescript = (body, call = "console.log(label(null))", prefix = "") => `${prefix}function label(value: string | null): string {
${body}
}
${call}
`

const php = (body, call = "echo label(null), PHP_EOL;") => `<?php
declare(strict_types=1);
function label(?string $value): string
{
${body}
}
${call}
`

const java = (method, call = "System.out.println(label(java.util.Optional.empty()));") => `public final class Main {
${method}
  public static void main(String[] args) {
    ${call}
  }
}
`

describe("optional value frontend validation", () => {
  it("rejects Ruby truthiness, safe navigation, defaulting, nonoptional nil, and arbitrary unions", () => {
    rejects("ruby", "invalid.rb", ruby("  if value\n    return value\n  else\n    return \"absent\"\n  end"))
    rejects("ruby", "invalid.rb", ruby("  if value&.nil?\n    return \"absent\"\n  else\n    return value\n  end"))
    rejects("ruby", "invalid.rb", ruby("  unless !value.nil?\n    return value\n  else\n    return \"absent\"\n  end"))
    rejects("ruby", "invalid.rb", ruby("  return value&.to_s"))
    rejects("ruby", "invalid.rb", ruby("  return value || \"absent\""))
    rejects("ruby", "invalid.rb", "# @return [String]\ndef bad()\n  return nil\nend\nputs bad()\n")
    rejects("ruby", "invalid.rb", "# @param value [String | Integer]\n# @return [String]\ndef bad(value)\n  return \"bad\"\nend\nputs bad(1)\n",
      ["MISSING_TYPE", "UNSUPPORTED_SYNTAX"])
  })

  it("rejects JavaScript undefined, omissions, loose tests, optional chains, coalescing, and arbitrary unions", () => {
    rejects("javascript", "invalid.js", "/** @returns {string|null} */\nfunction bad() { return undefined }\nconsole.log(bad())\n")
    rejects("javascript", "invalid.js", javascript("  if (value !== null) return value\n  else return \"absent\"", "console.log(label())"),
      ["TYPE_MISMATCH"])
    rejects("javascript", "invalid.js", javascript("  if (value != null) return value\n  else return \"absent\""))
    rejects("javascript", "invalid.js", javascript("  return value?.toString()"))
    rejects("javascript", "invalid.js", javascript("  return value ?? \"absent\""))
    rejects("javascript", "invalid.js", "/** @param {string|number} value @returns {string} */\nfunction bad(value) { return \"bad\" }\nconsole.log(bad(1))\n")
  })

  it("rejects TypeScript undefined, optional/default parameters, assertions, chains, coalescing, wider unions, and opt-out directives", () => {
    rejects("typescript", "invalid.ts", "function bad(value: string | undefined): string { return \"bad\" }\nconsole.log(bad(undefined))\n")
    rejects("typescript", "invalid.ts", "function bad(value?: string): string { return \"bad\" }\nconsole.log(bad())\n")
    rejects("typescript", "invalid.ts", "function bad(value: string | null = null): string { return \"bad\" }\nconsole.log(bad())\n")
    rejects("typescript", "invalid.ts", typescript("  return value!"))
    rejects("typescript", "invalid.ts", typescript("  return value?.toString()"))
    rejects("typescript", "invalid.ts", typescript("  return value ?? \"absent\""))
    rejects("typescript", "invalid.ts", "function bad(value: string | number | null): string { return \"bad\" }\nconsole.log(bad(null))\n")
    rejects("typescript", "invalid.ts", typescript("  if (value !== null) return value\n  else return \"absent\"", undefined, "// @ts-nocheck\n"))
  })

  it("rejects PHP untyped nullability, union profiles, loose tests, nullsafe access, and coalescing", () => {
    rejects("php", "invalid.php", "<?php\ndeclare(strict_types=1);\nfunction bad(string $value): string { return $value; }\necho bad(null), PHP_EOL;\n")
    rejects("php", "invalid.php", "<?php\ndeclare(strict_types=1);\nfunction bad(string|null $value): string { return \"bad\"; }\necho bad(null), PHP_EOL;\n")
    rejects("php", "invalid.php", "<?php\ndeclare(strict_types=1);\nfunction bad(string|int|null $value): string { return \"bad\"; }\necho bad(null), PHP_EOL;\n")
    rejects("php", "invalid.php", php("    if ($value) { return $value; } else { return \"absent\"; }"))
    rejects("php", "invalid.php", php("    if ($value != null) { return $value; } else { return \"absent\"; }"))
    rejects("php", "invalid.php", php("    return $value?->toString();"))
    rejects("php", "invalid.php", php("    return $value ?? \"absent\";"))
  })

  it("rejects Java nullability, unchecked get, nested optionals, annotations, and ofNullable", () => {
    rejects("java", "Main.java", java("  private static String label(String value) { return value; }", "System.out.println(label(null));"))
    rejects("java", "Main.java", java("  private static java.util.Optional<String> label(java.util.Optional<String> value) { return java.util.Optional.of(null); }"))
    rejects("java", "Main.java", java("  private static String label(java.util.Optional<String> value) { return value.get(); }"),
      ["UNCHECKED_OPTIONAL_UNWRAP"])
    rejects("java", "Main.java", java("  private static java.util.Optional<java.util.Optional<String>> label(java.util.Optional<String> value) { return java.util.Optional.of(value); }"),
      ["INVALID_OPTIONAL_CONSTITUENT"])
    rejects("java", "Main.java", java("  private static String label(@javax.annotation.Nullable String value) { return value; }", "System.out.println(label(\"x\"));"))
    rejects("java", "Main.java", java("  private static java.util.Optional<String> label(String value) { return java.util.Optional.ofNullable(value); }", "System.out.println(label(\"x\").isPresent());"))
  })
})
