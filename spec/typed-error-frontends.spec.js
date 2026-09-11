// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

function semanticMeaning(value) {
  return JSON.parse(JSON.stringify(value, (key, child) =>
    ["id", "location", "provenance", "resolution", "sourceProvenance"].includes(key) ? undefined : child))
}

function rejects(language, filename, source) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
      error.language == language && error.location?.filename == filename
  )
}

describe("typed error frontends", () => {
  it("normalizes the five exact unchecked-error profiles to one semantic meaning", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/errors/${filename}`, import.meta.url), "utf8")

      modules.push(parse({filename, language, source}))
    }

    expect(modules.map((module) => module.errors?.map((error) => error.name))).toEqual([
      ["ValidationError", "ProcessingError"],
      ["ValidationError", "ProcessingError"],
      ["ValidationError", "ProcessingError"],
      ["ValidationError", "ProcessingError"],
      ["ValidationError", "ProcessingError"]
    ])
    expect(modules.map((module) => module.functions[0].body.statements[0].kind)).toEqual([
      "TryStatement", "TryStatement", "TryStatement", "TryStatement", "TryStatement"
    ])
    const expected = semanticMeaning(modules[0])

    for (const module of modules.slice(1)) expect(semanticMeaning(module)).toEqual(expected)
  })

  it("rejects arbitrary throws and unguarded, broad, or finalized JavaScript-family catches", () => {
    rejects("javascript", "arbitrary.js", `/** @returns {string} */
function run() { throw "bad" }
console.log(run())
`)
    rejects("typescript", "unguarded.ts", `class ValidationError extends Error {}
function run(): string {
  try { throw new ValidationError("bad") }
  catch (error) { return error.message }
}
console.log(run())
`)
    rejects("typescript", "finally.ts", `class ValidationError extends Error {}
function run(): string {
  try { throw new ValidationError("bad") }
  catch (error) {
    if (!(error instanceof ValidationError)) { throw error }
    return error.message
  } finally {}
}
console.log(run())
`)
  })

  it("rejects Ruby default rescue, retry, else, and ensure semantics", () => {
    const wrap = (handler) => `class ValidationError < StandardError
end
# @return [String]
def run
  begin
    raise ValidationError, "bad"
${handler}
  end
end
puts run
`

    rejects("ruby", "default.rb", wrap("  rescue => error\n    return error.message"))
    rejects("ruby", "retry.rb", wrap("  rescue ValidationError => error\n    retry"))
    rejects("ruby", "else.rb", wrap("  rescue ValidationError => error\n    return error.message\n  else\n    return \"other\""))
    rejects("ruby", "ensure.rb", wrap("  rescue ValidationError => error\n    return error.message\n  ensure\n    puts \"done\""))
  })

  it("rejects PHP multi-catch, finally, and throw expressions", () => {
    const prefix = `<?php
declare(strict_types=1);
final class ValidationError extends RuntimeException {}
final class ProcessingError extends RuntimeException {}
`

    rejects("php", "multi.php", `${prefix}function run(): string
{
    try { throw new ValidationError("bad"); }
    catch (ValidationError|ProcessingError $error) { return $error->getMessage(); }
}
echo run(), PHP_EOL;
`)
    rejects("php", "finally.php", `${prefix}function run(): string
{
    try { throw new ValidationError("bad"); }
    catch (ValidationError $error) { return $error->getMessage(); }
    finally {}
}
echo run(), PHP_EOL;
`)
    rejects("php", "expression.php", `${prefix}function run(): string
{
    $error = throw new ValidationError("bad");
}
echo run(), PHP_EOL;
`)
  })

  it("rejects Java checked, multi-catch, resource, and finally profiles", () => {
    const main = (declarations, body) => `${declarations}
public final class Main {
  private static String run() {
${body}
  }
  public static void main(String[] args) { System.out.println(run()); }
}
`
    const errors = `final class ValidationError extends RuntimeException {
  ValidationError(String message) { super(message); }
}
final class ProcessingError extends RuntimeException {
  ProcessingError(String message) { super(message); }
}`

    rejects("java", "Main.java", main(`final class ValidationError extends Exception {
  ValidationError(String message) { super(message); }
}`, "    throw new ValidationError(\"bad\");"))
    rejects("java", "Main.java", main(errors, `    try { throw new ValidationError("bad"); }
    catch (ValidationError | ProcessingError error) { return error.getMessage(); }`))
    rejects("java", "Main.java", main(errors, `    try (java.io.StringReader reader = new java.io.StringReader("bad")) { return "ok"; }
    catch (ValidationError error) { return error.getMessage(); }`))
    rejects("java", "Main.java", main(errors, `    try { throw new ValidationError("bad"); }
    catch (ValidationError error) { return error.getMessage(); }
    finally {}`))
  })

  it("rejects noncanonical error declaration bodies and inheritance shapes", () => {
    rejects("javascript", "class.js", `class ValidationError extends Error { constructor(message) { super(message) } }
/** @returns {string} */
function run() { throw new ValidationError("bad") }
console.log(run())
`)
    rejects("typescript", "class.ts", `class ValidationError extends Error { readonly detail: string = "bad" }
function run(): string { throw new ValidationError("bad") }
console.log(run())
`)
    rejects("ruby", "class.rb", `class ValidationError < StandardError
  def detail
    return "bad"
  end
end
# @return [String]
def run
  raise ValidationError, "bad"
end
puts run
`)
    rejects("php", "class.php", `<?php
declare(strict_types=1);
class ValidationError extends RuntimeException {}
function run(): string { throw new ValidationError("bad"); }
echo run(), PHP_EOL;
`)
    rejects("java", "Main.java", `final class ValidationError extends RuntimeException {
  ValidationError(Object message) { super(message.toString()); }
}
public final class Main {
  private static String run() { throw new ValidationError("bad"); }
  public static void main(String[] args) { System.out.println(run()); }
}
`)
  })
})
