// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

describe("immutable collection static local access", () => {
  it("classifies a Java map get from its typed receiver when the key is a known final local", () => {
    const module = parse({
      filename: "Main.java",
      language: "java",
      source: `public final class Main {
  private static int identity(int value) { return value; }
  public static void main(String[] args) {
    final java.util.Map<String,Integer> values = java.util.Map.of("answer", 42);
    final String key = "answer";
    System.out.println(values.get(key));
  }
}
`
    })
    const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements.at(-1))

    expect(print.expression.kind).toEqual("MapLookupExpression")
    expect(/** @type {import("../src/semantic/types.js").MapLookupExpression} */ (print.expression).totality).toEqual("proven")
  })

  it("classifies PHP accesses from typed receivers when indices and keys are known immutable locals", () => {
    const module = parse({
      filename: "static-access.php",
      language: "php",
      source: `<?php
declare(strict_types=1);
function identity(int $value): int { return $value; }
/**
 * @var list<int> $numbers
 * @semantifold-immutable
 */
$numbers = [4, 7];
/**
 * @var int $index
 * @semantifold-immutable
 */
$index = 1;
/**
 * @var array<string,int> $values
 * @semantifold-immutable
 */
$values = ["answer" => 42];
/**
 * @var string $key
 * @semantifold-immutable
 */
$key = "answer";
echo $numbers[$index], PHP_EOL;
echo $values[$key], PHP_EOL;
`
    })
    const accesses = module.entryPoint.body.statements.slice(-2).map((statement) =>
      /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression)

    expect(accesses.map(({kind}) => kind)).toEqual(["ListIndexExpression", "MapLookupExpression"])
    expect(accesses.map((expression) =>
      /** @type {import("../src/semantic/types.js").ListIndexExpression | import("../src/semantic/types.js").MapLookupExpression} */ (
        expression
      ).totality)).toEqual(["proven", "proven"])
  })

  it("routes genuinely dynamic Java and PHP map reads through semantic totality validation", () => {
    const cases = [
      {
        filename: "Main.java",
        language: "java",
        source: `public final class Main {
  private static int read(java.util.Map<String,Integer> values, String key) {
    return values.get(key);
  }
  public static void main(String[] args) {
    System.out.println(read(java.util.Map.of("answer", 42), "answer"));
  }
}
`
      },
      {
        filename: "dynamic.php",
        language: "php",
        source: `<?php
declare(strict_types=1);
/**
 * @param array<string,int> $values
 */
function read(array $values, string $key): int {
    return $values[$key];
}
echo read(["answer" => 42], "answer"), PHP_EOL;
`
      }
    ]

    for (const {filename, language, source} of cases) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNCHECKED_COLLECTION_ACCESS"
      )
    }
  })
})
