// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse} from "../index.js"

const fixtures = [
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["php", "program.php"],
  ["java", "Main.java"]
]

describe("immutable collection frontends", () => {
  it("adapts the exact original-five list and map profiles equivalently", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/collections/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})

      expect(module.functions.map(({parameters, returnType}) => [parameters[0].type.kind, returnType.kind])).toEqual([
        ["ListType", "ListType"], ["MapType", "MapType"]
      ])
      expect(module.entryPoint.body.statements.slice(0, 5).map((statement) =>
        /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (statement).initializer.kind)).toEqual([
        "ListLiteral", "MapLiteral", "ListLiteral", "MapLiteral", "ListLiteral"
      ])
      expect(module.entryPoint.body.statements.slice(5).map((statement) =>
        /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression.kind)).toEqual([
        "ListIndexExpression", "ListIndexExpression", "ListIndexExpression", "MapLookupExpression",
        "CollectionSizeExpression", "CollectionSizeExpression", "ListIndexExpression", "CollectionSizeExpression",
        "CollectionSizeExpression"
      ])
    }
  })

  it("accepts bounded whitespace inside Ruby recursive type comments", () => {
    const module = parse({
      filename: "spaced.rb",
      language: "ruby",
      source: `# @param values [Hash[String, Array[Integer]]]
# @return [Hash[String, Array[Integer]]]
def pass(values)
  return values
end
# @type [Hash[String, Array[Integer]]]
values = {"items" => [1]}
puts values.fetch("items").size
`
    })

    expect(module.functions[0].returnType.kind).toEqual("MapType")
  })

  it("propagates explicit PHP collection types into empty returns, assignments, and call arguments", () => {
    const source = `<?php
declare(strict_types=1);

/** @return list<int> */
function empty_list(): array {
    return [];
}

/** @return array<string,int> */
function empty_map(): array {
    return [];
}

/** @return list<int> */
function assigned_list(): array {
    /** @var list<int> $values */
    $values = [1];
    $values = [];
    return $values;
}

/** @return array<string,int> */
function assigned_map(): array {
    /** @var array<string,int> $values */
    $values = ["answer" => 42];
    $values = [];
    return $values;
}

/** @param list<int> $values */
function list_size(array $values): int {
    return count($values);
}

/** @param array<string,int> $values */
function map_size(array $values): int {
    return count($values);
}

echo count(empty_list()), PHP_EOL;
echo count(empty_map()), PHP_EOL;
echo count(assigned_list()), PHP_EOL;
echo count(assigned_map()), PHP_EOL;
echo list_size([]), PHP_EOL;
echo map_size([]), PHP_EOL;
`
    const module = parse({filename: "empty-context.php", language: "php", source})
    const generated = generate({language: "php", module})
    const reparsed = parse({filename: "empty-context.php", language: "php", source: generated})

    expect(module.functions.slice(0, 2).map((declaration) =>
      /** @type {import("../src/semantic/types.js").ReturnStatement} */ (declaration.body.statements[0]).expression?.kind)).toEqual([
      "ListLiteral", "MapLiteral"
    ])
    expect(module.functions.slice(2, 4).map((declaration) =>
      /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (declaration.body.statements[1]).expression.kind)).toEqual([
      "ListLiteral", "MapLiteral"
    ])
    expect(module.entryPoint.body.statements.slice(4).map((statement) =>
      /** @type {import("../src/semantic/types.js").CallExpression} */ (
        /** @type {import("../src/semantic/types.js").PrintStatement} */ (statement).expression
      ).arguments[0].kind)).toEqual([
      "ListLiteral", "MapLiteral"
    ])
    expect(reparsed.functions).toHaveLength(6)
  })
})
