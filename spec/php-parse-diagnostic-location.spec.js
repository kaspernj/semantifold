// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

describe("PHP parse diagnostic location", () => {
  it("normalizes a native parser failure to the requested filename and useful start", () => {
    const filename = "broken.php"
    const source = "<?php\ndeclare(strict_types=1);\nfunction broken( {"

    assert.throws(() => parse({filename, language: "php", source}), (error) => {
      assert.ok(error instanceof SemantifoldDiagnostic)
      expect({code: error.code, filename: error.location?.filename, language: error.language})
        .toEqual({code: "PARSE_ERROR", filename, language: "php"})
      expect(error.location).toEqual({
        end: {column: 19, line: 3, offset: 49},
        filename,
        start: {column: 18, line: 3, offset: 48}
      })
      return true
    })
  })
})
