// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const unsafeLiteralSources = [
  ["javascript", "unsafe.js", `
/**
 * Computes a difference.
 * @param {number} left - Left integer.
 * @param {number} right - Right integer.
 * @returns {number} Result.
 */
function difference(left, right) {
  if (left > right) return 9007199254740993
  else return right - left
}
console.log(difference(4, 9))
`],
  ["typescript", "unsafe.ts", `
function difference(left: number, right: number): number {
  if (left > right) return 9007199254740993
  else return right - left
}
console.log(difference(4, 9))
`],
  ["php", "unsafe.php", `<?php
declare(strict_types=1);
function difference(int $left, int $right): int {
  if ($left > $right) {
    return 9007199254740993;
  } else {
    return $right - $left;
  }
}
echo difference(4, 9), PHP_EOL;
`],
  ["ruby", "unsafe.rb", `
# @param left [Integer]
# @param right [Integer]
# @return [Integer]
def difference(left, right)
  if left > right
    return 9007199254740993
  else
    return right - left
  end
end
puts difference(4, 9)
`]
]

const flaggedFunctions = [
  ["javascript", "async.js", "async function"],
  ["javascript", "generator.js", "function*"],
  ["typescript", "async.ts", "async function"],
  ["typescript", "generator.ts", "function*"]
]

describe("frontend numeric and function-flag validation", () => {
  it("rejects unsafe integer literals in every numeric frontend", () => {
    for (const [language, filename, source] of unsafeLiteralSources) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == language,
        language
      )
    }
  })

  it("rejects async and generator declarations in JavaScript and TypeScript", () => {
    for (const [language, filename, declaration] of flaggedFunctions) {
      const jsdoc = language == "javascript" ? `
/**
 * Computes a difference.
 * @param {number} left - Left integer.
 * @param {number} right - Right integer.
 * @returns {number} Result.
 */` : ""
      const types = language == "typescript" ? ": number" : ""
      const parameters = language == "typescript" ? "left: number, right: number" : "left, right"
      const source = `${jsdoc}
${declaration} difference(${parameters})${types} {
  if (left > right) return left - right
  else return right - left
}
console.log(difference(4, 9))
`

      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.location?.filename == filename,
        `${language} ${declaration}`
      )
    }
  })
})
