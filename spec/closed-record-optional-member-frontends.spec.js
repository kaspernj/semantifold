// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"

const javascript = `class Measure {
  /**
   * @param {number} length
   * @param {number} size
   */
  constructor(length, size) {
    /** @readonly */
    this.length = length
    /** @readonly */
    this.size = size
    Object.freeze(this)
  }
}

/**
 * @param {Measure|null} value
 * @returns {number}
 */
function total(value) {
  if (value !== null) return value.length + value.size
  else return 0
}

console.log(total(new Measure(2, 3)))
`

const typescript = `class Measure {
  constructor(readonly length: number, readonly size: number) {}
}

function total(value: Measure | null): number {
  if (value !== null) return value.length + value.size
  else return 0
}

console.log(total(new Measure(2, 3)))
`

const ruby = `class Measure
  # @type [Integer]
  attr_reader :length
  # @type [Integer]
  attr_reader :size

  # @param length [Integer]
  # @param size [Integer]
  def initialize(length, size)
    @length = length
    @size = size
    freeze
  end
end

# @param value [Measure?]
# @return [Integer]
def total(value)
  unless value.nil?
    return value.length + value.size
  else
    return 0
  end
end

puts total(Measure.new(2, 3))
`

describe("optional closed-record member frontends", () => {
  it("resolves length and size as nominal fields after a proven presence guard", () => {
    for (const [language, filename, source] of [
      ["javascript", "measure.js", javascript],
      ["typescript", "measure.ts", typescript],
      ["ruby", "measure.rb", ruby]
    ]) {
      const module = parse({filename, language, source})
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements[0])
      const returned = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (branch.consequent.statements[0])
      const sum = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (returned.expression)

      expect(sum.left).toMatchObject({field: "record:0:field:0", kind: "MemberRead"})
      expect(sum.right).toMatchObject({field: "record:0:field:1", kind: "MemberRead"})
    }
  })
})
