// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

describe("JavaScript and TypeScript parse diagnostic location", () => {
  it("normalizes Babel failures to each requested filename and useful start", () => {
    for (const [language, filename] of [["javascript", "broken.js"], ["typescript", "broken.ts"]]) {
      const source = "function broken( {"

      assert.throws(() => parse({filename, language, source}), (error) => {
        assert.ok(error instanceof SemantifoldDiagnostic)
        expect({code: error.code, filename: error.location?.filename, language: error.language})
          .toEqual({code: "PARSE_ERROR", filename, language})
        expect(error.location).toEqual({
          end: {column: 19, line: 1, offset: 18},
          filename,
          start: {column: 19, line: 1, offset: 18}
        })
        return true
      })
    }
  })
})
