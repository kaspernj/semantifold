// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

describe("ordered map iteration language registry", () => {
  it("advertises the canonical capability only for the original five", () => {
    expect(languageCapabilities.filter(({features}) => features.orderedMapIteration).map(({id}) => id))
      .toEqual(["php", "ruby", "javascript", "typescript", "java"])
    for (const descriptor of languageCapabilities) expect(typeof descriptor.features.orderedMapIteration).toEqual("boolean")
  })
})
