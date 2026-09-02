// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const annotationBlock = `# @param left [Integer]
# @param right [Integer]
# @return [Integer]`

describe("Ruby frontend validation", () => {
  it("does not reuse another function's annotation block", () => {
    const source = `${annotationBlock}
def first(left, right)
  if left > right
    return left - right
  else
    return right - left
  end
end

def second(left, right)
  if left > right
    return left - right
  else
    return right - left
  end
end

puts second(4, 9)
`

    assert.throws(
      () => parse({filename: "annotations.rb", language: "ruby", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "MISSING_TYPE" && error.language == "ruby" && error.location?.start.line == 12
    )
  })

  it("rejects rest, optional, keyword, and block parameter forms", () => {
    const parameterLists = [
      "left, right, *others",
      "left, right = 1",
      "left, right, scale:",
      "left, right, &block"
    ]

    for (const parameters of parameterLists) {
      const source = `${annotationBlock}
def difference(${parameters})
  if left > right
    return left - right
  else
    return right - left
  end
end
puts difference(4, 9)
`

      assert.throws(
        () => parse({filename: "parameters.rb", language: "ruby", source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.language == "ruby",
        parameters
      )
    }
  })
})
