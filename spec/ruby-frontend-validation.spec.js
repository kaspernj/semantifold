// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const annotationBlock = `# @param left [Integer]
# @param right [Integer]
# @return [Integer]`

describe("Ruby frontend validation", () => {
  it("reads later function and local metadata after multibyte source text", () => {
    const source = `# @param flag [bool]
# @param fallback [String]
# @return [String]
def first(flag, fallback)
  if flag
    return "☃"
  else
    return fallback
  end
end

# @param flag [bool]
# @param fallback [String]
# @return [String]
def second(flag, fallback)
  # @type [String]
  # @semantifold-immutable
  preferred = "yes"
  if flag
    return preferred
  else
    return fallback
  end
end
puts second(true, "no")
`
    const module = parse({filename: "multibyte-metadata.rb", language: "ruby", source})
    const second = module.functions[1]
    const preferred = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (second.body.statements[0])

    expect({
      functionLine: second.location.start.line,
      functionOffset: second.location.start.offset,
      localLine: preferred.location.start.line,
      localOffset: preferred.location.start.offset,
      mutable: preferred.mutable,
      name: second.name,
      parameterTypes: second.parameters.map((parameter) => parameter.type.name),
      preferredType: preferred.type.name
    }).toEqual({
      functionLine: 15,
      functionOffset: source.indexOf("def second"),
      localLine: 18,
      localOffset: source.indexOf("preferred ="),
      mutable: false,
      name: "second",
      parameterTypes: ["boolean", "string"],
      preferredType: "string"
    })
  })

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
