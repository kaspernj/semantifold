// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {parse, SemantifoldDiagnostic} from "../index.js"

describe("PHP frontend validation", () => {
  it("rejects declare directives other than strict_types=1", () => {
    const source = `<?php
declare(ticks=1);
function difference(int $left, int $right): int {
  if ($left > $right) {
    return $left - $right;
  } else {
    return $right - $left;
  }
}
echo difference(4, 9), PHP_EOL;
`

    assert.throws(
      () => parse({filename: "ticks.php", language: "php", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == "php" && error.location?.start.line == 2
    )
  })
})
